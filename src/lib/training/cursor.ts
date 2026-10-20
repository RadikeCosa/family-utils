import { createHash } from "node:crypto";
import { calendarDate, identifier, object, TrainingValidationError } from "./rules.ts";
export function cursorScope(parts: unknown[]) { return createHash("sha256").update(JSON.stringify(parts)).digest("hex"); }
export interface TrainingCursor { scope: string; at: string; id: string; date?: string }
export function encodeCursor(value: TrainingCursor) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
export function decodeCursor(value: string | null, scope: string, session: boolean): TrainingCursor | null {
  if (!value) return null;
  try {
    if (value.length > 1024) throw new Error();
    const data = object(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (data.scope !== scope || typeof data.at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(data.at) || !Number.isFinite(Date.parse(data.at)) || new Date(data.at).toISOString().slice(0,19) !== data.at.slice(0,19)) throw new Error();
    return { scope, at: data.at, id: identifier(data.id), ...(session ? { date: calendarDate(data.date) } : {}) };
  } catch { throw new TrainingValidationError("Cursor inválido. Actualizá el listado."); }
}
