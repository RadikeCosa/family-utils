import { and, asc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditEvents, mealRoutines, members } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { getDayInTimeZone, hasMealAttendance, isMealType, isParticipationStatus, isUuid, isValidDate, type WeeklyParticipation } from "@/lib/meals/rules";
import { lockFamilyActor, bumpMenusRevision, MealError } from "@/lib/meals/server";
export const runtime="nodejs";
export async function GET(request:Request) {
 const actor=await getMemberContext(request.headers);
 if(!actor)return NextResponse.json({error:"No family access"},{status:403});
 const routines=await getDb().select().from(mealRoutines).where(eq(mealRoutines.familyId,actor.familyId)).orderBy(asc(mealRoutines.startsOn));
 return NextResponse.json({routines},{headers:{"Cache-Control":"private, no-store"}});
}
export async function PUT(request:Request) {
 const actor=await getMemberContext(request.headers);
 if(!actor)return NextResponse.json({error:"No family access"},{status:403});
 try {
  let body:Record<string,unknown>;
  try {body=await request.json();if(!body||typeof body!=="object"||Array.isArray(body))throw new Error();}catch{throw new MealError("Revisá la rutina.");}
  const {memberId,mealType,startsOn,weekdays}=body;
  const name=typeof body.name==="string"?body.name.trim():"Rutina habitual";
  if(!isUuid(memberId)||!isMealType(mealType)||!hasMealAttendance(mealType)||!isValidDate(startsOn)||!Array.isArray(weekdays)||weekdays.length!==7||!weekdays.every(isParticipationStatus)||!name||name.length>80)throw new MealError("Revisá persona, fecha y los siete días de la rutina.");
  const saved=await getDb().transaction(async tx=>{
   const current=await lockFamilyActor(tx,actor);
   if(!current||current.role!=="administrator")throw new MealError("Solo adultos pueden administrar rutinas.",403);
   if(startsOn<getDayInTimeZone(new Date(),actor.familyTimeZone))throw new MealError("La rutina debe comenzar hoy o en el futuro.");
   const [profile]=await tx.select({id:members.id}).from(members).where(and(eq(members.id,memberId),eq(members.familyId,actor.familyId),isNull(members.archivedAt))).limit(1);
   if(!profile)throw new MealError("El perfil no está activo en esta familia.");
   const [before]=await tx.select().from(mealRoutines).where(and(eq(mealRoutines.memberId,memberId),eq(mealRoutines.mealType,mealType),eq(mealRoutines.startsOn,startsOn))).limit(1);
   const values={familyId:actor.familyId,memberId,mealType,startsOn,weekdays:weekdays as WeeklyParticipation,name,updatedByMemberId:current.memberId,updatedAt:new Date()};
   const [after]=await tx.insert(mealRoutines).values(values).onConflictDoUpdate({target:[mealRoutines.memberId,mealRoutines.mealType,mealRoutines.startsOn],set:values}).returning();
   await tx.insert(auditEvents).values({familyId:actor.familyId,actorMemberId:current.memberId,entityType:"meal_routine",entityId:after.id,action:before?"updated":"created",before:before??null,after});
   await bumpMenusRevision(tx,actor.familyId);
   return after;
  });
  return NextResponse.json({routine:saved});
 }catch(error){if(error instanceof MealError)return NextResponse.json({error:error.message},{status:error.status});throw error;}
}
