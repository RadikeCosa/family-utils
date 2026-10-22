import { and, asc, eq, isNull, isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditEvents, mealIdeas, members } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { normalizeMealIdea, parseIdeaFields } from "@/lib/meals/rules";
import { lockFamilyActor, bumpMenusRevision } from "@/lib/meals/server";
export const runtime="nodejs";
export async function GET(request:Request) {
 const actor=await getMemberContext(request.headers);
 if(!actor)return NextResponse.json({error:"No family access"},{status:403});
 const archived=new URL(request.url).searchParams.get("archived")==="1";
 const ideas=await getDb().select({id:mealIdeas.id,authorMemberId:mealIdeas.authorMemberId,authorName:members.name,title:mealIdeas.title,note:mealIdeas.note,mealTypes:mealIdeas.mealTypes,packedSuitable:mealIdeas.packedSuitable,version:mealIdeas.version,archivedAt:mealIdeas.archivedAt,createdAt:mealIdeas.createdAt,updatedAt:mealIdeas.updatedAt})
 .from(mealIdeas).innerJoin(members,eq(mealIdeas.authorMemberId,members.id)).where(and(eq(mealIdeas.familyId,actor.familyId),isNull(mealIdeas.mergedIntoId),archived?isNotNull(mealIdeas.archivedAt):isNull(mealIdeas.archivedAt))).orderBy(asc(mealIdeas.title));
 return NextResponse.json({ideas},{headers:{"Cache-Control":"private, no-store"}});
}
export async function POST(request:Request) {
 const actor=await getMemberContext(request.headers);
 if(!actor)return NextResponse.json({error:"No family access"},{status:403});
 let body:Record<string,unknown>;
 try{body=await request.json();if(!body||typeof body!=="object"||Array.isArray(body))throw new Error();}catch{return NextResponse.json({error:"Revisá la idea."},{status:400});}
 const fields=parseIdeaFields(body);
 if(!fields)return NextResponse.json({error:"Escribí un nombre de hasta 160 caracteres y revisá la nota y etiquetas."},{status:400});
 const result=await getDb().transaction(async tx=>{
  const current=await lockFamilyActor(tx,actor);if(!current)return null;
  const normalizedTitle=normalizeMealIdea(fields.title).replace(/\s+/g," ");
  const [existing]=await tx.select().from(mealIdeas).where(and(eq(mealIdeas.familyId,actor.familyId),eq(mealIdeas.normalizedTitle,normalizedTitle),isNull(mealIdeas.mergedIntoId))).limit(1);
  if(existing) return { duplicate: true as const };
  const [idea]=await tx.insert(mealIdeas).values({familyId:actor.familyId,authorMemberId:current.memberId,...fields,normalizedTitle}).returning();
  await tx.insert(auditEvents).values({familyId:actor.familyId,actorMemberId:current.memberId,entityType:"meal_idea",entityId:idea.id,action:"created",after:idea});
  await bumpMenusRevision(tx,actor.familyId);return { duplicate: false as const, idea };
 });
 return !result?NextResponse.json({error:"No tenés acceso a esta familia."},{status:403}):result.duplicate?NextResponse.json({error:"Ya existe un plato con ese nombre en el repertorio."},{status:409}):NextResponse.json({idea:result.idea},{status:201});
}
