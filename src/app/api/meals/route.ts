import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { families, mealAttendance, mealSelections, mealSlots, mealSuggestions, members } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { addDays, getDayInTimeZone, isValidDate, startOfWeek } from "@/lib/meals/rules";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "No family access" }, { status: 403 });

  const suppliedWeek = new URL(request.url).searchParams.get("weekStart");
  if (suppliedWeek && !isValidDate(suppliedWeek)) return NextResponse.json({ error: "Invalid week" }, { status: 400 });
  const weekStart = startOfWeek(suppliedWeek ?? getDayInTimeZone(new Date(), actor.familyTimeZone));
  const weekEnd = addDays(weekStart, 6);
  const db = getDb();
  const [familyState] = await db.select({ menusRevision: families.menusRevision })
    .from(families).where(eq(families.id, actor.familyId)).limit(1);
  const revision = familyState?.menusRevision ?? 0;
  const etag = `"menus-${actor.familyId}-r${revision}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "private, no-cache" } });
  }

  const [activeMembers, allMembers, slots] = await Promise.all([
    db.select({ id: members.id, name: members.name, role: members.role }).from(members)
      .where(and(eq(members.familyId, actor.familyId), isNull(members.archivedAt))).orderBy(asc(members.createdAt)),
    db.select({ id: members.id, name: members.name }).from(members).where(eq(members.familyId, actor.familyId)),
    db.select().from(mealSlots).where(and(
      eq(mealSlots.familyId, actor.familyId),
      gte(mealSlots.mealDate, weekStart),
      lte(mealSlots.mealDate, weekEnd),
    )),
  ]);
  const slotIds = slots.map((slot) => slot.id);
  const [suggestions, attendance, selections] = slotIds.length ? await Promise.all([
    db.select({
      id: mealSuggestions.id,
      slotId: mealSuggestions.slotId,
      authorMemberId: mealSuggestions.authorMemberId,
      authorName: members.name,
      title: mealSuggestions.title,
      note: mealSuggestions.note,
      version: mealSuggestions.version,
      withdrawnAt: mealSuggestions.withdrawnAt,
      createdAt: mealSuggestions.createdAt,
      updatedAt: mealSuggestions.updatedAt,
    }).from(mealSuggestions)
      .innerJoin(members, eq(mealSuggestions.authorMemberId, members.id))
      .where(inArray(mealSuggestions.slotId, slotIds))
      .orderBy(asc(mealSuggestions.createdAt)),
    db.select().from(mealAttendance).where(inArray(mealAttendance.slotId, slotIds)),
    (() => {
      const confirmer = alias(members, "meal_confirmer");
      return db.select({
        slotId: mealSelections.slotId,
        suggestionId: mealSelections.suggestionId,
        confirmedByMemberId: mealSelections.confirmedByMemberId,
        confirmedByName: confirmer.name,
        confirmedAt: mealSelections.confirmedAt,
        version: mealSelections.version,
      }).from(mealSelections).innerJoin(confirmer, eq(mealSelections.confirmedByMemberId, confirmer.id))
        .where(inArray(mealSelections.slotId, slotIds));
    })(),
  ]) : [[], [], []];

  const namesById = new Map(allMembers.map((profile) => [profile.id, profile.name]));
  const suggestionsBySlot = new Map<string, typeof suggestions>();
  for (const suggestion of suggestions) {
    if (suggestion.withdrawnAt) continue;
    suggestionsBySlot.set(suggestion.slotId, [...(suggestionsBySlot.get(suggestion.slotId) ?? []), suggestion]);
  }
  const attendanceBySlot = new Map<string, typeof attendance>();
  for (const record of attendance) attendanceBySlot.set(record.slotId, [...(attendanceBySlot.get(record.slotId) ?? []), record]);
  const selectionBySlot = new Map(selections.map((selection) => [selection.slotId, selection]));
  const suggestionById = new Map(suggestions.map((suggestion) => [suggestion.id, suggestion]));
  const slotByKey = new Map(slots.map((slot) => [`${slot.mealDate}:${slot.mealType}`, slot]));
  const meals = Array.from({ length: 7 }, (_, offset) => addDays(weekStart, offset)).flatMap((day) => (["lunch", "dinner"] as const).map((mealType) => {
    const slot = slotByKey.get(`${day}:${mealType}`);
    const slotAttendance = slot ? attendanceBySlot.get(slot.id) ?? [] : [];
    const attendanceByMember = new Map(slotAttendance.map((record) => [record.memberId, record]));
    const storedSelection = slot ? selectionBySlot.get(slot.id) : undefined;
    const selectedSuggestion = storedSelection?.suggestionId ? suggestionById.get(storedSelection.suggestionId) : undefined;
    return {
      date: day,
      mealType,
      slotId: slot?.id ?? null,
      attendance: activeMembers.map((profile) => {
        const record = attendanceByMember.get(profile.id);
        return {
          memberId: profile.id,
          status: record?.status ?? "unknown",
          source: record?.status ? "manual" : "unknown",
          version: record?.version ?? 0,
          updatedByMemberId: record?.updatedByMemberId ?? null,
          updatedByName: record?.updatedByMemberId ? namesById.get(record.updatedByMemberId) ?? "Integrante archivado" : null,
          updatedAt: record?.updatedAt?.toISOString() ?? null,
        };
      }),
      suggestions: slot ? suggestionsBySlot.get(slot.id) ?? [] : [],
      selection: storedSelection?.suggestionId ? {
        suggestionId: storedSelection.suggestionId,
        title: selectedSuggestion?.title ?? null,
        proposedById: selectedSuggestion?.authorMemberId ?? null,
        proposedByName: selectedSuggestion?.authorName ?? null,
        confirmedByMemberId: storedSelection.confirmedByMemberId,
        confirmedByName: storedSelection.confirmedByName,
        confirmedAt: storedSelection.confirmedAt,
        version: storedSelection.version,
      } : null,
      selectionVersion: storedSelection?.version ?? 0,
    };
  }));

  return NextResponse.json({
    weekStart,
    weekEnd,
    today: getDayInTimeZone(new Date(), actor.familyTimeZone),
    timeZone: actor.familyTimeZone,
    revision,
    currentMemberId: actor.memberId,
    currentRole: actor.role,
    members: activeMembers,
    meals,
  }, { headers: { ETag: etag, "Cache-Control": "private, no-cache" } });
}
