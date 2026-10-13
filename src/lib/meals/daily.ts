import { normalizeMealIdea, type FamilyRole, type ParticipationStatus } from "./rules.ts";

export type MenuNumber = 1 | 2;
export type DailyPerson = { memberId: string; status: ParticipationStatus; menu: MenuNumber | null };
export type DailySelection = { suggestionId: string; title: string; note: string | null; confirmedByMemberId: string | null; confirmedAt: string | null };
export type DailyMenu = { number: MenuNumber; selection: DailySelection | null };
export type DailyPlan = { menus: DailyMenu[]; people: DailyPerson[] };
export type DailyIdea = { id: string; title: string; note: string | null; authorName: string; withdrawnAt?: string | null };
export type LegacyInput = {
  memberIds: string[];
  groups: { id: string; kind: string; followsHome: boolean; suggestionId: string | null; confirmedByMemberId: string | null; confirmedAt: string | null }[];
  suggestions: { id: string; title: string; note: string | null }[];
  participants: { memberId: string; status: string; groupId: string | null }[];
  attendance: { memberId: string; status: string | null }[];
  selection: DailySelection | null;
};
export const STATUS_LABELS: Record<ParticipationStatus, string> = { home: "Está", packed: "Se lleva", away: "No preparar", unknown: "Sin elegir" };
export function needsMeal(status: ParticipationStatus) { return status === "home" || status === "packed"; }
export function canChangePerson(role: FamilyRole, actorId: string, targetId: string) { return role === "administrator" || actorId === targetId; }
export function emptyPlan(memberIds: string[]): DailyPlan {
  return { menus: [{ number: 1, selection: null }], people: memberIds.map(memberId => ({ memberId, status: "unknown", menu: null })) };
}
export function participationSummary(people: DailyPerson[]): string {
  const home = people.filter(p => p.status === "home").length;
  const packed = people.filter(p => p.status === "packed").length;
  const pending = people.filter(p => p.status === "unknown").length;
  if (pending === people.length && pending > 0) return "Falta definir";
  if (!home && !packed) return pending ? `0 para preparar · ${pending} por definir` : "No hay que preparar";
  return `${home} en casa · ${packed} para llevar${pending ? ` · ${pending} por definir` : ""}`;
}
export function menuSummary(plan: DailyPlan, number: MenuNumber): string {
  const people = plan.people.filter(p => p.menu === number && needsMeal(p.status));
  return people.length ? participationSummary(people) : "Sin personas asignadas";
}
export function changePerson(plan: DailyPlan, memberId: string, status: ParticipationStatus, menu?: MenuNumber): DailyPlan {
  return { ...plan, people: plan.people.map(p => p.memberId !== memberId ? p : {
    memberId, status, menu: needsMeal(status) ? menu ?? (needsMeal(p.status) ? p.menu : null) ?? 1 : null,
  }) };
}
export function addSecondMenu(plan: DailyPlan): DailyPlan {
  return plan.menus.length === 2 ? plan : { ...plan, menus: [...plan.menus, { number: 2, selection: null }] };
}
export function removeSecondMenu(plan: DailyPlan): DailyPlan {
  return { menus: plan.menus.filter(m => m.number === 1), people: plan.people.map(p => p.menu === 2 ? { ...p, menu: 1 } : p) };
}
export function duplicateMenu(plan: DailyPlan, number: MenuNumber, selection: DailySelection): boolean {
  return plan.menus.some(m => m.number !== number && m.selection && (m.selection.suggestionId === selection.suggestionId || normalizeMealIdea(m.selection.title) === normalizeMealIdea(selection.title)));
}

/** Projection only: never runs routines or changes the source records. */
export function translateLegacy(input: LegacyInput): { plan: DailyPlan; readOnly: boolean; reason: string | null } {
  const plan = emptyPlan(input.memberIds);
  const groupMenu = new Map<string, MenuNumber>();
  const byIdea = new Map(input.suggestions.map(s => [s.id, s]));
  const main = input.groups.find(g => g.kind !== "packed");
  let reason: string | null = null;
  function attach(groupId: string, selection: DailySelection | null) {
    const same = selection && plan.menus.find(m => m.selection && normalizeMealIdea(m.selection.title) === normalizeMealIdea(selection.title));
    if (same) {
      if (same.selection?.note !== selection?.note) reason = "Hay platos anteriores con el mismo nombre y notas distintas.";
      groupMenu.set(groupId, same.number); return;
    }
    const available = plan.menus.find(m => !m.selection && ![...groupMenu.values()].includes(m.number));
    const number = available?.number ?? (plan.menus.length < 2 ? 2 : null);
    if (!number) { reason = "El plan anterior tiene más de dos menús."; return; }
    if (!available) plan.menus.push({ number, selection }); else available.selection = selection;
    groupMenu.set(groupId, number);
  }
  // Main first, so legacy home remains menu 1 even if the packed group was created first.
  const ordered = [...input.groups].sort((a,b) => Number(b.id === main?.id) - Number(a.id === main?.id));
  for (const group of ordered.filter(g => !g.followsHome)) {
    const idea = group.suggestionId ? byIdea.get(group.suggestionId) : null;
    if (group.suggestionId && !idea) reason = "Hay un plato anterior que no se puede identificar.";
    if (!idea && !input.participants.some(p => p.groupId === group.id && (p.status === "home" || p.status === "packed")) && group.id !== main?.id) continue;
    attach(group.id, idea ? { suggestionId: idea.id, title: idea.title, note: idea.note, confirmedByMemberId: group.confirmedByMemberId, confirmedAt: group.confirmedAt } : null);
  }
  for (const group of input.groups.filter(g => g.followsHome)) {
    const number = main && groupMenu.get(main.id);
    if (number) groupMenu.set(group.id, number); else reason = "Una relación de platos anterior no se puede identificar.";
  }
  if (!input.groups.length && input.selection) plan.menus[0].selection = input.selection;
  for (const person of plan.people) {
    const explicit = input.participants.find(p => p.memberId === person.memberId);
    const old = input.attendance.find(p => p.memberId === person.memberId);
    const raw = explicit?.status ?? (old?.status === "present" ? "home" : old?.status === "absent" ? "away" : "unknown");
    person.status = ["home", "packed", "away", "unknown"].includes(raw) ? raw as ParticipationStatus : "unknown";
    if (needsMeal(person.status)) {
      const number = explicit?.groupId ? groupMenu.get(explicit.groupId) : explicit && plan.menus.length > 1 ? undefined : 1;
      if (!number) reason = "Hay una asignación anterior que no se puede identificar.";
      person.menu = number ?? null;
    }
  }
  return { plan, readOnly: reason !== null, reason };
}
