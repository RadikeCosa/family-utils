import { eq } from "drizzle-orm";
import { auditEvents, mealDistributions, mealExceptions } from "@/db/schema";
import { hasMealAttendance } from "@/lib/meals/rules";
import { mutateMeal, bumpMenusRevision, effectiveParticipation, MealError } from "@/lib/meals/server";

export const runtime="nodejs";
export async function DELETE(request:Request) {
 return mutateMeal(request,false,async({tx,slot,actor,memberId})=>{
  if(!hasMealAttendance(slot.mealType))throw new MealError("Esta comida no tiene distribución.");
  const before=await effectiveParticipation(tx,actor.familyId,slot);
  await tx.delete(mealDistributions).where(eq(mealDistributions.slotId,slot.id));
  await tx.delete(mealExceptions).where(eq(mealExceptions.slotId,slot.id));
  const after=await effectiveParticipation(tx,actor.familyId,slot);
  await tx.insert(auditEvents).values({familyId:actor.familyId,actorMemberId:memberId,entityType:"meal_distribution",entityId:slot.id,action:"returned_to_routine",before,after});
  await bumpMenusRevision(tx,actor.familyId);
  return {participants:after};
 });
}
