import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { mealRoutines } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { retiredMealMutation } from "@/lib/meals/retired";
export const runtime="nodejs";
export async function GET(request:Request) {
 const actor=await getMemberContext(request.headers);
 if(!actor)return NextResponse.json({error:"No family access"},{status:403});
 const routines=await getDb().select().from(mealRoutines).where(eq(mealRoutines.familyId,actor.familyId)).orderBy(asc(mealRoutines.startsOn));
 return NextResponse.json({routines},{headers:{"Cache-Control":"private, no-store"}});
}
export const PUT = retiredMealMutation;
