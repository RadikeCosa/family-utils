import { createHash } from "node:crypto";
import { UUID_PATTERN } from "./rules.ts";
export function cursorScope(parts: unknown[]) { return createHash("sha256").update(JSON.stringify(parts)).digest("hex"); }
export function encodeCursor(scope: string, at: string, id: string) { return Buffer.from(JSON.stringify({ scope, at, id })).toString("base64url"); }
export function decodeCursor(value: string | null, scope: string): { at: string; id: string } | null {
  if (!value) return null;
  if (value.length > 1024) throw new Error("Cursor inválido. Actualizá la colección.");
  try {
    const data = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (data.scope !== scope || typeof data.at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(data.at) || !Number.isFinite(Date.parse(data.at)) || Number(data.at.slice(0, 4)) < 1 || new Date(data.at).toISOString().slice(0, 19) !== data.at.slice(0, 19) || typeof data.id !== "string" || !UUID_PATTERN.test(data.id)) throw new Error();
    return { at: data.at, id: data.id };
  } catch { throw new Error("Cursor inválido. Actualizá la colección."); }
}
