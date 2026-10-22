import { and, desc, eq, ilike, isNull, isNotNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { mealIdeas, members } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { normalizeMealIdea } from "@/lib/meals/rules";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "No family access" }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const archived = params.get("archived") === "1";
  const query = normalizeMealIdea((params.get("q") ?? "").trim().slice(0, 160)).replace(/[\\%_]/g, "\\$&");
  const offset = Math.max(0, Math.min(100_000, Number(params.get("offset")) || 0));
  const limit = Math.max(1, Math.min(50, Number(params.get("limit")) || 20));
  const ideas = await getDb().select({
    id: mealIdeas.id, authorMemberId: mealIdeas.authorMemberId, authorName: members.name,
    title: mealIdeas.title, note: mealIdeas.note, mealTypes: mealIdeas.mealTypes,
    packedSuitable: mealIdeas.packedSuitable, version: mealIdeas.version,
    archivedAt: mealIdeas.archivedAt, lastUsedAt: mealIdeas.lastUsedAt,
  }).from(mealIdeas).innerJoin(members, eq(mealIdeas.authorMemberId, members.id)).where(and(
    eq(mealIdeas.familyId, actor.familyId), isNull(mealIdeas.mergedIntoId),
    archived ? isNotNull(mealIdeas.archivedAt) : isNull(mealIdeas.archivedAt),
    ...(query ? [ilike(mealIdeas.normalizedTitle, `%${query}%`)] : []),
  )).orderBy(sql`${mealIdeas.lastUsedAt} DESC NULLS LAST`, desc(mealIdeas.updatedAt), desc(mealIdeas.createdAt)).limit(limit + 1).offset(offset);
  return NextResponse.json({ ideas: ideas.slice(0, limit), nextOffset: ideas.length > limit ? offset + limit : null }, { headers: { "Cache-Control": "private, no-store" } });
}
