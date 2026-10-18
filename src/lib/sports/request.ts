import type { PoolClient } from "pg";
import { getMemberContext, type MemberContext } from "@/lib/auth/context";
export class SportsRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function reject(status: number, message: string): never {
  throw new SportsRequestError(status, message);
}
export async function sportsActor(
  request: Request,
  admin = false,
): Promise<MemberContext> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    reject(403, "Origen no permitido.");
  const actor = await getMemberContext(request.headers);
  if (!actor || (admin && actor.role !== "administrator"))
    reject(
      403,
      admin
        ? "Solo administración puede importar resultados."
        : "Ingresá a tu familia.",
    );
  return actor;
}
export async function activeSportsActor(
  tx: PoolClient,
  actor: MemberContext,
  admin = false,
  lockRows = true,
) {
  const { rows } = await tx.query(
    `SELECT m.id FROM members m JOIN member_devices d ON d.member_id=m.id WHERE m.id=$1 AND m.family_id=$2 AND d.auth_user_id=$3 AND m.archived_at IS NULL AND d.revoked_at IS NULL AND ($4=false OR m.role='administrator')${lockRows ? " FOR SHARE OF m,d" : ""}`,
    [actor.memberId, actor.familyId, actor.authUser.id, admin],
  );
  if (!rows.length) reject(403, "Tu acceso ya no está disponible.");
}
export async function sportsBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) reject(400, "Faltan los datos.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) {
        await reader.cancel();
        reject(413, "El archivo supera el tamaño permitido.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    reject(400, "El JSON no es válido.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    reject(400, "Revisá el formato del archivo.");
  return body as Record<string, unknown>;
}
export function sportsResponseError(error: unknown) {
  if (error instanceof SportsRequestError)
    return Response.json({ error: error.message }, { status: error.status });
  console.error("sports_operation_failed", {
    code:
      error && typeof error === "object" && "code" in error
        ? error.code
        : "unknown",
  });
  return Response.json(
    { error: "No se pudo completar. Conservamos los datos anteriores." },
    { status: 500 },
  );
}
export const privateHeaders = { "Cache-Control": "no-store", Vary: "Cookie" };
