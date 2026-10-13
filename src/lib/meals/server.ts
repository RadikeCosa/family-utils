import { and, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { MemberContext } from "@/lib/auth/context";
import { getDb } from "@/db";
import { families, mealSlots, mealGroups, mealDistributions, mealExceptions, mealRoutines, memberDevices, members } from "@/db/schema";
import { hasMealAttendance, resolveParticipation, isMealType, isValidDate, getDayInTimeZone, type MealType } from "./rules";
import { NextResponse } from "next/server";
import { getMemberContext } from "@/lib/auth/context";

export type MealTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export async function lockFamilyActor(tx: MealTransaction, actor: MemberContext) {
  await tx.execute(sql`SELECT id FROM ${families} WHERE id = ${actor.familyId} FOR UPDATE`);
  const [current] = await tx.select({ memberId: members.id, role: members.role })
    .from(memberDevices)
    .innerJoin(members, eq(memberDevices.memberId, members.id))
    .where(and(
      eq(memberDevices.authUserId, actor.authUser.id),
      isNull(memberDevices.revokedAt),
      isNull(members.archivedAt),
      eq(members.familyId, actor.familyId),
    ))
    .limit(1);
  return current ?? null;
}

export async function lockMealSlot(tx: MealTransaction, familyId: string, day: string, mealType: MealType) {
  await tx.insert(mealSlots).values({ familyId, mealDate: day, mealType }).onConflictDoNothing();
  const [slot] = await tx.select().from(mealSlots)
    .where(and(eq(mealSlots.familyId, familyId), eq(mealSlots.mealDate, day), eq(mealSlots.mealType, mealType)))
    .for("update")
    .limit(1);
  return slot ?? null;
}

export async function bumpMenusRevision(tx: MealTransaction, familyId: string) {
  await tx.execute(sql`UPDATE ${families} SET menus_revision = menus_revision + 1, updated_at = now() WHERE id = ${familyId}`);
}

export class MealError extends Error {
  constructor(message: string, public status = 400, public code?: string) { super(message); }
}


export async function ensureMealGroup(tx: MealTransaction, slotId: string, kind: "home" | "packed" | "shared") {
  await tx.insert(mealGroups).values({slotId,kind,isDefault:true,name:kind === "home" ? "Casa" : kind === "packed" ? "Lunchera" : "Compartido"}).onConflictDoNothing();
  const [group] = await tx.select().from(mealGroups).where(and(eq(mealGroups.slotId,slotId),eq(mealGroups.kind,kind),eq(mealGroups.isDefault,true))).limit(1);
  if (!group) throw new Error("Missing default meal group");
  return group;
}

export async function effectiveParticipation(tx: MealTransaction, familyId: string, slot: typeof mealSlots.$inferSelect) {
  const profiles = await tx.select({id:members.id}).from(members).where(and(eq(members.familyId,familyId),isNull(members.archivedAt)));
  const groups = await tx.select().from(mealGroups).where(eq(mealGroups.slotId,slot.id));
  const routines = await tx.select().from(mealRoutines).where(eq(mealRoutines.familyId,familyId));
  const exceptions = await tx.select().from(mealExceptions).where(eq(mealExceptions.slotId,slot.id));
  const distributions = await tx.select().from(mealDistributions).where(eq(mealDistributions.slotId,slot.id));
  return resolveParticipation({memberIds:profiles.map(p=>p.id),date:slot.mealDate,mealType:slot.mealType,
    homeId:groups.find(g=>g.kind==="home")?.id??null,packedId:groups.find(g=>g.kind==="packed"&&g.isDefault)?.id??null,
    routines,exceptions:exceptions.map(e=>({...e,updatedAt:e.updatedAt.toISOString()})),snapshot:distributions[0]?.participants});
}

export async function freezeDistribution(tx: MealTransaction, familyId: string, slot: typeof mealSlots.$inferSelect, actorId: string) {
  if (!hasMealAttendance(slot.mealType)) return;
  const [existing] = await tx.select().from(mealDistributions).where(eq(mealDistributions.slotId,slot.id)).limit(1);
  if (existing) return;
  const people = await effectiveParticipation(tx,familyId,slot);
  if (people.some(p=>p.status==="packed"&&!p.groupId)) {
    const packed=await ensureMealGroup(tx,slot.id,"packed");
    for(const person of people) if(person.status==="packed"&&!person.groupId) person.groupId=packed.id;
  }
  const home=await ensureMealGroup(tx,slot.id,"home");
  for(const person of people) if(person.status==="home"&&!person.groupId) person.groupId=home.id;
  await tx.insert(mealDistributions).values({slotId:slot.id,participants:people,updatedByMemberId:actorId});
}

type MutationContext = {tx:MealTransaction;slot:typeof mealSlots.$inferSelect;actor:MemberContext;memberId:string;role:"administrator"|"member";body:Record<string,unknown>};
export async function mutateMeal(request: Request, adultOnly: boolean, action:(context:MutationContext)=>Promise<unknown>) {
  const actor=await getMemberContext(request.headers);
  if(!actor) return NextResponse.json({error:"No family access"},{status:403});
  try {
    let body:Record<string,unknown>;
    try {const value=await request.json();if(!value||typeof value!=="object"||Array.isArray(value))throw new Error();body=value;} catch {throw new MealError("Revisá los datos de la comida.");}
    if(!isValidDate(body.date)||!isMealType(body.mealType))throw new MealError("Revisá la fecha y la comida.");
    const date=body.date,mealType=body.mealType;
    const result=await getDb().transaction(async tx=>{
      const current=await lockFamilyActor(tx,actor);
      if(!current||(adultOnly&&current.role!=="administrator"))throw new MealError("No tenés permiso para realizar este cambio.",403);
      if(date<getDayInTimeZone(new Date(),actor.familyTimeZone))throw new MealError("Este día ya no se puede editar.",403,"MEAL_DAY_CLOSED");
      const slot=await lockMealSlot(tx,actor.familyId,date,mealType);
      if(!slot)throw new Error("Missing slot");
      await ensureMealGroup(tx,slot.id,hasMealAttendance(mealType)?"home":"shared");
      return action({tx,slot,actor,memberId:current.memberId,role:current.role,body});
    });
    return NextResponse.json(result??{ok:true});
  } catch(error) {
    if(error instanceof MealError)return NextResponse.json({error:error.message,...(error.code?{code:error.code}:{})},{status:error.status});
    throw error;
  }
}
