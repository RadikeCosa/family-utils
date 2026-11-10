import { createHmac, timingSafeEqual } from "node:crypto";
export type RecipeCursor = {
  v: 1; family: string; query: string; revision: string;
  last: { used: string | null; updated: string; created: string; id: string };
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:\d{2})?)$/;
function signature(payload: string, secret: string) { return createHmac("sha256", secret).update(`recipes-cursor-v1:${payload}`).digest(); }
export function encodeRecipeCursor(value: RecipeCursor, secret: string): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}
export function decodeRecipeCursor(value: string, secret: string): RecipeCursor {
  if (value.length > 16384) throw new Error("Cursor inválido.");
  const [payload, mac, extra] = value.split(".");
  if (!payload || !mac || extra) throw new Error("Cursor inválido.");
  const expected = signature(payload, secret), actual = Buffer.from(mac, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Cursor inválido.");
  const c = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (c?.v !== 1 || typeof c.family !== "string" || !uuid.test(c.family) || typeof c.query !== "string" ||
    typeof c.revision !== "string" || !/^\d+$/.test(c.revision) || !c.last || !uuid.test(c.last.id) ||
    typeof c.last.updated !== "string" || !timestamp.test(c.last.updated) || typeof c.last.created !== "string" || !timestamp.test(c.last.created) ||
    !(c.last.used === null || (typeof c.last.used === "string" && timestamp.test(c.last.used)))) throw new Error("Cursor inválido.");
  return c;
}
