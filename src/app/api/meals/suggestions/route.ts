import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { auditEvents } from "@/db/schema";
import { getMemberContext } from "@/lib/auth/context";
import { getDayInTimeZone, isMealType, isValidDate } from "@/lib/meals/rules";
import { bumpMenusRevision, lockFamilyActor, lockMealSlot } from "@/lib/meals/server";
import { mealSuggestions } from "@/db/schema";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const actor = await getMemberContext(request.headers);
  if (!actor) return NextResponse.json({ error: "No family access" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid suggestion" }, { status: 400 }); }
  const date = body.date;
  const mealType = body.mealType;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!isValidDate(date) || !isMealType(mealType) || !title || title.length > 160 || note.length > 1000) {
    return NextResponse.json({ error: "El nombre es obligatorio (160 caracteres como máximo) y la nota admite hasta 1.000." }, { status: 400 });
  }

  const result = await getDb().transaction(async (tx) => {
    const currentActor = await lockFamilyActor(tx, actor);
    if (!currentActor) return { kind: "forbidden" as const };
    if (date < getDayInTimeZone(new Date(), actor.familyTimeZone)) return { kind: "past" as const };
    const slot = await lockMealSlot(tx, actor.familyId, date, mealType);
    if (!slot) return { kind: "missing-slot" as const };
    const [suggestion] = await tx.insert(mealSuggestions).values({
      slotId: slot.id,
      authorMemberId: currentActor.memberId,
      title,
      note: note || null,
    }).returning();
    await tx.insert(auditEvents).values({
      familyId: actor.familyId,
      actorMemberId: currentActor.memberId,
      entityType: "meal_suggestion",
      entityId: suggestion.id,
      action: "created",
      after: suggestion,
    });
    await bumpMenusRevision(tx, actor.familyId);
    return { kind: "ok" as const, suggestion };
  });
  if (result.kind === "forbidden") return NextResponse.json({ error: "No family access" }, { status: 403 });
  if (result.kind === "past") return NextResponse.json({ code: "MEAL_DAY_CLOSED", error: "Este día ya no se puede editar." }, { status: 403 });
  return NextResponse.json(result.suggestion, { status: 201 });
}
