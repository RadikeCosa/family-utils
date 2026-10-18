import { SPORTS_UUID } from "./rules.ts";
export type RiverLineupBundle = { version: 1; eventId: string; body: string; source: string; checkedAt: string };
export function parseRiverLineup(value: unknown, now = new Date()): RiverLineupBundle | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || v.example === true || typeof v.eventId !== "string" || !SPORTS_UUID.test(v.eventId) || typeof v.body !== "string" || !v.body.trim() || Array.from(v.body.trim()).length > 4000 || typeof v.source !== "string" || v.source.length > 1000 || typeof v.checkedAt !== "string" || !Number.isFinite(Date.parse(v.checkedAt)) || Date.parse(v.checkedAt) > now.getTime() + 600000) return null;
  try { const u = new URL(v.source); if (u.protocol !== "https:" || u.username || u.password) return null; } catch { return null; }
  return { version: 1, eventId: v.eventId, body: v.body.trim(), source: v.source, checkedAt: new Date(v.checkedAt).toISOString() };
}
