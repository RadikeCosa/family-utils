import { and, eq } from "drizzle-orm";
import { auditEvents, mealGroups } from "@/db/schema";
import { hasMealAttendance, isUuid } from "@/lib/meals/rules";
import { mutateMeal, ensureMealGroup, effectiveParticipation, bumpMenusRevision, MealError } from "@/lib/meals/server";

export const runtime="nodejs";
async function change(request:Request,action:"create"|"rename"|"delete") {
 return mutateMeal(request,false,async({tx,slot,actor,memberId,body})=>{
  if(!hasMealAttendance(slot.mealType))throw new MealError("Esta comida tiene un único menú compartido.");
  const name=typeof body.name==="string"?body.name.trim():"";
  if(action!=="delete"&&(!name||name.length>80))throw new MealError("Escribí un nombre de hasta 80 caracteres.");
  let before:typeof mealGroups.$inferSelect|null|undefined=null;
  let after:typeof mealGroups.$inferSelect|null;
  if(action==="create") {
   [after]=await tx.insert(mealGroups).values({slotId:slot.id,kind:"packed",name}).returning();
  } else {
   if(body.groupId==null&&body.groupKind==="packed")before=await ensureMealGroup(tx,slot.id,"packed");
   else {
    if(!isUuid(body.groupId))throw new MealError("Grupo inválido.");
    [before]=await tx.select().from(mealGroups).where(and(eq(mealGroups.id,body.groupId),eq(mealGroups.slotId,slot.id))).limit(1);
   }
   if(!before||before.kind!=="packed")throw new MealError("La lunchera ya no existe o no se puede modificar.",409);
   if(action==="delete") {
    const people=await effectiveParticipation(tx,actor.familyId,slot);
    const target=before;
    if(target.suggestionId||people.some(p=>p.groupId===target.id||(p.status==="packed"&&!p.groupId&&target.isDefault)))throw new MealError("Reasigná las personas y quitá la elección propia antes de eliminar la lunchera.",409);
    await tx.delete(mealGroups).where(eq(mealGroups.id,before.id));
    after=null;
   } else [after]=await tx.update(mealGroups).set({name,updatedAt:new Date()}).where(eq(mealGroups.id,before.id)).returning();
  }
  await tx.insert(auditEvents).values({familyId:actor.familyId,actorMemberId:memberId,entityType:"meal_group",entityId:after?.id??before!.id,action,before,after});
  await bumpMenusRevision(tx,actor.familyId);
  return {group:after};
 });
}
export async function POST(request:Request){return change(request,"create");}
export async function PATCH(request:Request){return change(request,"rename");}
export async function DELETE(request:Request){return change(request,"delete");}
