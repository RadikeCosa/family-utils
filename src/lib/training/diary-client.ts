import type { DiaryContext, DiaryEntry } from "./diary";
export async function diaryRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers); headers.set("X-Training-Contract", "3");
  if (init?.body) headers.set("Content-Type", "application/json");
  const result = await fetch(`/api/training/${path}`, { ...init, headers, cache: "no-store" });
  let body;
  try { body = await result.json(); } catch { throw new Error("No se pudo confirmar la respuesta. Tu formulario se conserva."); }
  if (!result.ok) throw Object.assign(new Error(body.error ?? "No se pudo completar la operación."), { code: body.code, status: result.status });
  return body as T;
}
export type EntryResponse = DiaryContext & { item: DiaryEntry };
export type EntryPage = DiaryContext & { items: DiaryEntry[]; nextCursor: string | null; revision: string };
