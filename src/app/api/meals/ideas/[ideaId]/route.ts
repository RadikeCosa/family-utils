import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditEvents, mealIdeas } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { isUuid, parseIdeaFields } from "@/lib/meals/rules";
import { lockFamilyActor, bumpMenusRevision, MealError } from "@/lib/meals/server";
export const runtime="nodejs";
export async function PATCH(request:Request,{params}:{params:Promise<{ideaId:string}>}) {
 const actor=await getMemberContext(request.headers);
 if(!actor)return NextResponse.json({error:"No family access"},{status:403});
 try {
  const {ideaId}=await params;if(!isUuid(ideaId))throw new MealError("No se encontró la idea.",404);
  let body:Record<string,unknown>;
  try{body=await request.json();if(!body||typeof body!=="object"||Array.isArray(body))throw new Error();}catch{throw new MealError("Revisá la idea.");}
  if(!Number.isSafeInteger(body.expectedVersion)||(body.expectedVersion as number)<1)throw new MealError("Revisá la versión de la idea.");
  const action=body.action??"edit";
  if(!["edit","archive","restore"].includes(String(action)))throw new MealError("Acción inválida.");
  const fields=action==="edit"?parseIdeaFields(body):null;
  if(action==="edit"&&!fields)throw new MealError("Revisá el nombre, nota y etiquetas.");
  const idea=await getDb().transaction(async tx=>{
   const current=await lockFamilyActor(tx,actor);if(!current)throw new MealError("No tenés acceso a esta familia.",403);
   const [before]=await tx.select().from(mealIdeas).where(and(eq(mealIdeas.id,ideaId),eq(mealIdeas.familyId,actor.familyId))).limit(1);
   if(!before)throw new MealError("No se encontró la idea.",404);
   if(current.role!=="administrator"&&before.authorMemberId!==current.memberId)throw new MealError("Solo podés administrar tus propias ideas.",403);
   if(before.version!==body.expectedVersion)throw new MealError("La idea cambió mientras editabas. Tu borrador se conserva; volvé al banco para consultar la versión actual.",409);
   const [after]=await tx.update(mealIdeas).set({...fields,...(action==="archive"?{archivedAt:new Date()}:action==="restore"?{archivedAt:null}:{}),version:before.version+1,updatedAt:new Date()}).where(eq(mealIdeas.id,before.id)).returning();
   await tx.insert(auditEvents).values({familyId:actor.familyId,actorMemberId:current.memberId,entityType:"meal_idea",entityId:before.id,action:action==="edit"?"updated":action==="archive"?"archived":"restored",before,after});
   await bumpMenusRevision(tx,actor.familyId);return after;
  });
  return NextResponse.json({idea});
 }catch(error){if(error instanceof MealError)return NextResponse.json({error:error.message},{status:error.status});throw error;}
}
