import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { families, mealAttendance, mealDailyPlans, mealDistributions, mealExceptions, mealGroups, mealSelections, mealSlots, mealSuggestions, members } from "@/db/schema";
import { MEAL_TYPES, addDays, hasMealAttendance, type MealType } from "./rules";
import { translateLegacy, type DailyIdea, type DailyPlan, type LegacyInput } from "./daily";
import type { MealTransaction } from "./server";

export type PlannerMeal = {
  date: string; mealType: MealType; slotId: string | null; version: string;
  plan: DailyPlan; readOnly: boolean; reason: string | null;
  suggestions: DailyIdea[]; previous: LegacyInput | null;
};
export type PlannerWeek = {
  weekStart: string; today: string; timeZone: string; currentMemberId: string;
  currentRole: "administrator" | "member";
  members: { id: string; name: string; role: "administrator" | "member" }[];
  meals: PlannerMeal[];
};

export async function loadPlanner(db: MealTransaction, familyId: string, first: string, last: string) {
  // One transaction owns one PostgreSQL connection: execute its reads in order.
  const profiles = await db.select({ id: members.id, name: members.name, role: members.role }).from(members).where(and(eq(members.familyId, familyId), isNull(members.archivedAt))).orderBy(asc(members.createdAt));
  const slots = await db.select().from(mealSlots).where(and(eq(mealSlots.familyId, familyId), gte(mealSlots.mealDate, first), lte(mealSlots.mealDate, last)));
  const state = await db.select({ revision: families.menusRevision }).from(families).where(eq(families.id, familyId));
  const ids = slots.map(s => s.id);
  const groups = ids.length ? await db.select().from(mealGroups).where(inArray(mealGroups.slotId, ids)).orderBy(asc(mealGroups.createdAt)) : [];
  const ideas = ids.length ? await db.select().from(mealSuggestions).where(inArray(mealSuggestions.slotId, ids)).orderBy(asc(mealSuggestions.createdAt)) : [];
  const distributions = ids.length ? await db.select().from(mealDistributions).where(inArray(mealDistributions.slotId, ids)) : [];
  const exceptions = ids.length ? await db.select().from(mealExceptions).where(inArray(mealExceptions.slotId, ids)) : [];
  const attendance = ids.length ? await db.select().from(mealAttendance).where(inArray(mealAttendance.slotId, ids)) : [];
  const selections = ids.length ? await db.select().from(mealSelections).where(inArray(mealSelections.slotId, ids)) : [];
  const saved = ids.length ? await db.select().from(mealDailyPlans).where(inArray(mealDailyPlans.slotId, ids)) : [];
  const memberIds = profiles.map(p => p.id);
  const names = new Map(profiles.map(p => [p.id, p.name]));
  const meals: PlannerMeal[] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) for (const mealType of MEAL_TYPES) {
    const slot = slots.find(s => s.mealDate === date && s.mealType === mealType);
    const slotIdeas = ideas.filter(i => i.slotId === slot?.id);
    const distribution = distributions.find(d => d.slotId === slot?.id);
    const selection = selections.find(s => s.slotId === slot?.id);
    const oldIdea = slotIdeas.find(i => i.id === selection?.suggestionId);
    const legacy: LegacyInput = {
      memberIds,
      groups: groups.filter(g => g.slotId === slot?.id).map(g => ({ ...g, confirmedAt: g.confirmedAt?.toISOString() ?? null })),
      suggestions: slotIdeas.map(i => ({ id: i.id, title: i.title, note: i.note })),
      participants: distribution?.participants ?? exceptions.filter(e => e.slotId === slot?.id).map(e => ({ memberId: e.memberId, status: e.status, groupId: e.groupId })),
      attendance: attendance.filter(a => a.slotId === slot?.id).map(a => ({ memberId: a.memberId, status: a.status })),
      selection: oldIdea && selection ? { suggestionId: oldIdea.id, title: oldIdea.title, note: oldIdea.note, confirmedByMemberId: selection.confirmedByMemberId, confirmedAt: selection.confirmedAt.toISOString() } : null,
    };
    const row = saved.find(s => s.slotId === slot?.id);
    const translated = translateLegacy(legacy);
    const plan = row ? { ...row.plan, people: memberIds.map(id => row.plan.people.find(p => p.memberId === id) ?? { memberId: id, status: "unknown" as const, menu: null }) } : translated.plan;
    if (!hasMealAttendance(mealType)) plan.people = [];
    meals.push({ date, mealType, slotId: slot?.id ?? null, version: row ? `daily:${row.version}` : `legacy:${state[0]?.revision ?? 0}`,
      plan, readOnly: !row && translated.readOnly, reason: !row ? translated.reason : null,
      previous: row ? (row.original && typeof row.original === "object" && "memberIds" in row.original ? row.original as LegacyInput : null) : slot && (legacy.groups.length || legacy.participants.length || legacy.attendance.length || legacy.selection) ? legacy : null,
      suggestions: slotIdeas.filter(i => !i.withdrawnAt).map(i => ({ id: i.id, title: i.title, note: i.note, authorName: names.get(i.authorMemberId) ?? "Integrante anterior" })),
    });
  }
  return { members: profiles, meals };
}
