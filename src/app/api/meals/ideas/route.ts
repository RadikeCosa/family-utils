import { writeRecipe } from "@/lib/recipes/server";
import { and, asc, eq, isNull, isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { mealIdeas, members } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
export const runtime="nodejs";
export async function GET(request:Request) {
 const actor=await getMemberContext(request.headers);
 if(!actor)return NextResponse.json({error:"No family access"},{status:403});
 const archived=new URL(request.url).searchParams.get("archived")==="1";
 const ideas=await getDb().select({id:mealIdeas.id,authorMemberId:mealIdeas.authorMemberId,authorName:members.name,title:mealIdeas.title,note:mealIdeas.note,mealTypes:mealIdeas.mealTypes,packedSuitable:mealIdeas.packedSuitable,version:mealIdeas.version,archivedAt:mealIdeas.archivedAt,createdAt:mealIdeas.createdAt,updatedAt:mealIdeas.updatedAt})
 .from(mealIdeas).innerJoin(members,eq(mealIdeas.authorMemberId,members.id)).where(and(eq(mealIdeas.familyId,actor.familyId),isNull(mealIdeas.mergedIntoId),archived?isNotNull(mealIdeas.archivedAt):isNull(mealIdeas.archivedAt))).orderBy(asc(mealIdeas.title));
 return NextResponse.json({ideas},{headers:{"Cache-Control":"private, no-store"}});
}
export async function POST(request: Request) { return writeRecipe(request, undefined, true); }
