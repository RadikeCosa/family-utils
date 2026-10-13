import { and, eq, isNull } from "drizzle-orm";
import { auditEvents, mealIdeas, mealSuggestions } from "@/db/schema";
import { isUuid } from "@/lib/meals/rules";
import { mutateMeal, bumpMenusRevision, MealError } from "@/lib/meals/server";
export const runtime="nodejs";
export async function POST(request:Request) {
 const response=await mutateMeal(request,false,async({tx,slot,actor,memberId,body})=>{
  let title=typeof body.title==="string"?body.title.trim():"";
  let note=typeof body.note==="string"?body.note.trim():"";
  let catalogIdeaId:string|null=null;
  if(body.catalogIdeaId!=null) {
   if(!isUuid(body.catalogIdeaId))throw new MealError("Idea del banco inválida.");
   const [idea]=await tx.select().from(mealIdeas).where(and(eq(mealIdeas.id,body.catalogIdeaId),eq(mealIdeas.familyId,actor.familyId),isNull(mealIdeas.archivedAt))).limit(1);
   if(!idea)throw new MealError("La idea ya no está disponible en el banco.");
   title=idea.title;note=idea.note??"";catalogIdeaId=idea.id;
  }
  if(!title||title.length>160||note.length>1000)throw new MealError("El nombre es obligatorio (160 caracteres como máximo) y la nota admite hasta 1.000.");
  const [suggestion]=await tx.insert(mealSuggestions).values({slotId:slot.id,authorMemberId:memberId,title,note:note||null,catalogIdeaId}).returning();
  await tx.insert(auditEvents).values({familyId:actor.familyId,actorMemberId:memberId,entityType:"meal_suggestion",entityId:suggestion.id,action:"created",after:suggestion});
  await bumpMenusRevision(tx,actor.familyId);return suggestion;
 });
 return new Response(response.body,{status:response.ok?201:response.status,headers:response.headers});
}
