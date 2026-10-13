import { and, eq, isNull } from "drizzle-orm";
import { auditEvents, mealDistributions, mealExceptions, mealGroups, members } from "@/db/schema";
import { hasMealAttendance, isParticipationStatus, isUuid, type Participation } from "@/lib/meals/rules";
import { mutateMeal, ensureMealGroup, bumpMenusRevision, MealError } from "@/lib/meals/server";

export const runtime = "nodejs";
export async function PUT(request: Request) {
  return mutateMeal(request,false,async ({tx,slot,actor,memberId,body})=>{
    if(!hasMealAttendance(slot.mealType))throw new MealError("Esta comida no tiene distribución de personas.");
    const target=body.memberId??memberId;
    if(!isUuid(target)||(!isParticipationStatus(body.status)&&body.status!=="inherit"))throw new MealError("Revisá la persona y su participación.");
    const [profile]=await tx.select({id:members.id}).from(members).where(and(eq(members.id,target),eq(members.familyId,actor.familyId),isNull(members.archivedAt))).limit(1);
    if(!profile)throw new MealError("El perfil no está activo en esta familia.");
    const [distribution]=await tx.select().from(mealDistributions).where(eq(mealDistributions.slotId,slot.id)).limit(1);
    if(body.status==="inherit") {
      if(distribution)throw new MealError("Usá Volver a la rutina para descartar una distribución guardada.",409);
      const before=await tx.select().from(mealExceptions).where(and(eq(mealExceptions.slotId,slot.id),eq(mealExceptions.memberId,target)));
      await tx.delete(mealExceptions).where(and(eq(mealExceptions.slotId,slot.id),eq(mealExceptions.memberId,target)));
      await tx.insert(auditEvents).values({familyId:actor.familyId,actorMemberId:memberId,entityType:"meal_participation",entityId:slot.id,action:"inherited",before,after:{memberId:target}});
    } else {
      let groupId:string|null=null;
      if(body.status==="home") groupId=(await ensureMealGroup(tx,slot.id,"home")).id;
      if(body.status==="packed") {
        if(body.groupId!=null) {
          if(!isUuid(body.groupId))throw new MealError("Grupo inválido.");
          const [group]=await tx.select().from(mealGroups).where(and(eq(mealGroups.id,body.groupId),eq(mealGroups.slotId,slot.id),eq(mealGroups.kind,"packed"))).limit(1);
          if(!group)throw new MealError("La lunchera ya no existe. Actualizá la pantalla.",409);
          groupId=group.id;
        } else groupId=(await ensureMealGroup(tx,slot.id,"packed")).id;
      }
      const after:Participation={memberId:target,status:body.status,groupId,updatedByMemberId:memberId,updatedAt:new Date().toISOString()};
      let before:unknown=null;
      if(distribution) {
        before=distribution;
        const participants=distribution.participants.filter(p=>p.memberId!==target).concat(after);
        await tx.update(mealDistributions).set({participants,adjusted:true,updatedByMemberId:memberId,updatedAt:new Date()}).where(eq(mealDistributions.slotId,slot.id));
      } else {
        [before]=await tx.select().from(mealExceptions).where(and(eq(mealExceptions.slotId,slot.id),eq(mealExceptions.memberId,target)));
        const values={slotId:slot.id,memberId:target,status:body.status,groupId,updatedByMemberId:memberId,updatedAt:new Date()};
        await tx.insert(mealExceptions).values(values).onConflictDoUpdate({target:[mealExceptions.slotId,mealExceptions.memberId],set:values});
      }
      await tx.insert(auditEvents).values({familyId:actor.familyId,actorMemberId:memberId,entityType:"meal_participation",entityId:slot.id,action:"updated",before,after});
    }
    await bumpMenusRevision(tx,actor.familyId);
    return {ok:true};
  });
}
