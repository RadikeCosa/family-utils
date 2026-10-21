import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { getPool } from "@/db";
import { getMemberContext, type MemberContext } from "@/lib/auth/context";
import { optionalTrainingMetricsEnabled, trainingEnabled } from "./config";
import { cursorScope, decodeCursor, encodeCursor } from "./cursor";
import { identifier, integer, LIMITS, object, onlyKeys, todayInZone, TrainingValidationError, UUID, validateRoutine, validateSession } from "./rules";
import type { RoutineInput, SessionInput, TrainingBlock } from "./types";

type Kind = "routines" | "sessions";
const tables = { routines: "training_routines", sessions: "training_sessions" } as const;
const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
class TrainingError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
function fail(status: number, code: string, message: string): never { throw new TrainingError(status, code, message); }
function missing(): never { return fail(404, "NOT_FOUND", "No encontramos este registro."); }
export function trainingUnavailable() { return NextResponse.json({ error: "No encontrado.", code: "NOT_FOUND" }, { status: 404, headers: privateHeaders }); }
function response(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: privateHeaders }); }
function errorResponse(error: unknown) {
  if (error instanceof TrainingValidationError) return response({ error: error.message, code: "INVALID" }, 400);
  if (error instanceof TrainingError) return response({ error: error.message, code: error.code }, error.status);
  console.error("training_request_failed", { code: error && typeof error === "object" && "code" in error ? error.code : "UNAVAILABLE" });
  return response({ error: "No se pudo guardar o consultar. Conservamos tu formulario para reintentar.", code: "UNAVAILABLE" }, 500);
}
async function actorFor(request: Request) {
  const actor = await getMemberContext(request.headers);
  if (!actor) fail(403, "NO_ACCESS", "Ingresá a tu familia.");
  return actor;
}
async function activeActor(tx: PoolClient, actor: MemberContext) {
  // Follow access/recovery lock ordering: family, member, then device.
  await tx.query("SELECT id FROM families WHERE id=$1 FOR KEY SHARE", [actor.familyId]);
  // Hold identity rows until commit so revocation/archive cannot race a write.
  const { rowCount } = await tx.query(`SELECT m.id FROM members m JOIN member_devices d ON d.member_id=m.id
    WHERE m.id=$1 AND m.family_id=$2 AND d.auth_user_id=$3 AND m.archived_at IS NULL AND d.revoked_at IS NULL FOR SHARE OF m,d`,
  [actor.memberId, actor.familyId, actor.authUser.id]);
  if (!rowCount) fail(403, "NO_ACCESS", "Tu acceso ya no está disponible.");
}
export async function readTrainingBody(request: Request): Promise<Record<string, unknown>> {
  const length = request.headers.get("content-length");
  if (length && Number(length) > LIMITS.bodyBytes) fail(413, "TOO_LARGE", "El formulario supera el tamaño permitido.");
  if (!request.body) throw new TrainingValidationError("Formulario vacío.");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > LIMITS.bodyBytes) { await reader.cancel(); fail(413, "TOO_LARGE", "El formulario supera el tamaño permitido."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return object(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
  catch { throw new TrainingValidationError("Formulario inválido."); }
}
interface TrainingRow {
  id: string; name: string; blocks: TrainingBlock[]; version: number; archived_at?: Date | null;
  created_at: Date; updated_at: Date; cursor_at: string; creation_hash: string;
  source_routine_id?: string; performed_on?: string; duration_seconds?: number | null; effort?: number | null; note?: string;
}
function mapRow(row: TrainingRow, kind: Kind) {
  const common = { id: row.id, name: row.name, blocks: row.blocks, version: row.version, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
  return kind === "routines" ? { ...common, archivedAt: row.archived_at?.toISOString() ?? null }
    : { ...common, sourceRoutineId: row.source_routine_id, performedOn: row.performed_on, durationSeconds: row.duration_seconds, effort: row.effort, note: row.note };
}
const columns = (kind: Kind) => "id,name,blocks,version,created_at,updated_at,creation_hash," + (kind === "sessions" ? "source_routine_id,performed_on::text AS performed_on,duration_seconds,effort,note" : "archived_at");
const cursorColumn = `to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at`;
async function getOwned(tx: PoolClient, kind: Kind, actor: MemberContext, id: string, lock = "") {
  if (!UUID.test(id)) missing();
  const { rows } = await tx.query<TrainingRow>(`SELECT ${columns(kind)},${cursorColumn} FROM ${tables[kind]} WHERE id=$1 AND owner_member_id=$2 AND family_id=$3 ${lock}`, [id, actor.memberId, actor.familyId]);
  if (!rows[0]) missing();
  return rows[0];
}
export async function readTraining(request: Request, kind: Kind, id?: string) {
  if (!trainingEnabled()) return trainingUnavailable();
  let tx: PoolClient | undefined;
  try {
    const actor = await actorFor(request); const today = todayInZone(actor.familyTimeZone);
    if (kind === "sessions" && optionalTrainingMetricsEnabled() && request.headers.get("x-training-contract") !== "2") {
      return response({ error: "Actualizá la página para consultar o registrar entrenamientos.", code: "CLIENT_UPDATE_REQUIRED" }, 409);
    }
    tx = await getPool().connect(); await tx.query("BEGIN"); await activeActor(tx, actor);
    if (id) {
      const item = mapRow(await getOwned(tx, kind, actor, id), kind);
      await tx.query("COMMIT"); return response({ item, today });
    }
    const url = new URL(request.url); const archived = url.searchParams.get("archived") ?? "false";
    if (kind === "routines" && !["false", "true"].includes(archived)) throw new TrainingValidationError("Filtro inválido.");
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit === null ? 20 : integer(/^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN, "Tamaño de página", 50);
    const scope = cursorScope([kind, actor.memberId, actor.familyId, kind === "routines" ? archived : null]);
    const cursor = decodeCursor(url.searchParams.get("cursor"), scope, kind === "sessions");
    const args: unknown[] = [actor.memberId, actor.familyId];
    const where = ["owner_member_id=$1", "family_id=$2"];
    if (kind === "routines") where.push(`archived_at IS ${archived === "true" ? "NOT " : ""}NULL`);
    if (cursor) {
      args.push(cursor.at, cursor.id);
      if (kind === "sessions") { args.push(cursor.date); where.push("(performed_on,created_at,id)<($5::date,$3::timestamptz,$4::uuid)"); }
      else where.push("(created_at,id)<($3::timestamptz,$4::uuid)");
    }
    args.push(limit + 1);
    const { rows } = await tx.query<TrainingRow>(`SELECT ${columns(kind)},${cursorColumn} FROM ${tables[kind]} WHERE ${where.join(" AND ")}
      ORDER BY ${kind === "sessions" ? "performed_on DESC NULLS LAST," : ""}created_at DESC NULLS LAST,id DESC NULLS LAST LIMIT $${args.length}`, args);
    const page = rows.slice(0, limit); const last = page.at(-1);
    const nextCursor = rows.length > limit && last ? encodeCursor({ scope, at: last.cursor_at, id: last.id, ...(kind === "sessions" ? { date: last.performed_on } : {}) }) : null;
    await tx.query("COMMIT"); return response({ items: page.map((row) => mapRow(row, kind)), nextCursor, today });
  } catch (error) { if (tx) await tx.query("ROLLBACK"); return errorResponse(error); }
  finally { tx?.release(); }
}
const routineKeys = ["name", "blocks"];
const sessionKeys = [...routineKeys, "sourceRoutineId", "performedOn", "durationSeconds", "effort", "note"];
export async function mutateTraining(request: Request, kind: Kind, id?: string) {
  if (!trainingEnabled()) return trainingUnavailable();
  let tx: PoolClient | undefined;
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) fail(403, "NO_ACCESS", "Origen no permitido.");
    const actor = await actorFor(request); const today = todayInZone(actor.familyTimeZone);
    if (kind === "sessions" && optionalTrainingMetricsEnabled() && request.headers.get("x-training-contract") !== "2") {
      return response({ error: "Actualizá la página para consultar o registrar entrenamientos.", code: "CLIENT_UPDATE_REQUIRED" }, 409);
    }
    const body = await readTrainingBody(request);
    tx = await getPool().connect(); await tx.query("BEGIN"); await activeActor(tx, actor);
    let item: TrainingRow;
    if (id) {
      const previous = await getOwned(tx, kind, actor, id, "FOR UPDATE");
      const version = integer(body.version, "Versión", 2147483646);
      if (previous.version !== version) fail(409, "VERSION_CONFLICT", "Este registro cambió en otro dispositivo. Podés recargarlo; tu formulario se conserva hasta que lo confirmes.");
      if (kind === "routines" && (body.action === "archive" || body.action === "restore")) {
        onlyKeys(body, ["action", "version"]);
        const { rows } = await tx.query<TrainingRow>(`UPDATE training_routines SET archived_at=${body.action === "archive" ? "now()" : "NULL"},version=version+1,updated_at=now() WHERE id=$1 AND owner_member_id=$2 AND family_id=$3 RETURNING *`, [id, actor.memberId, actor.familyId]);
        item = rows[0];
      } else {
        onlyKeys(body, [...(kind === "sessions" ? sessionKeys : routineKeys), "version"]);
        const input = kind === "sessions" ? validateSession(body, today, optionalTrainingMetricsEnabled()) : validateRoutine(body);
        if (kind === "sessions" && (input as SessionInput).sourceRoutineId !== previous.source_routine_id) throw new TrainingValidationError("La rutina de origen no se puede cambiar.");
        const values: unknown[] = [input.name, JSON.stringify(input.blocks), id, actor.memberId, actor.familyId];
        let extra = "";
        if (kind === "sessions") {
          const session = input as SessionInput; values.push(session.performedOn, session.durationSeconds, session.effort, session.note);
          extra = ",performed_on=$6,duration_seconds=$7,effort=$8,note=$9";
        }
        const { rows } = await tx.query<TrainingRow>(`UPDATE ${tables[kind]} SET name=$1,blocks=$2::jsonb,version=version+1,updated_at=now()${extra} WHERE id=$3 AND owner_member_id=$4 AND family_id=$5 RETURNING ${columns(kind)}`, values);
        item = rows[0];
      }
    } else {
      onlyKeys(body, [...(kind === "sessions" ? sessionKeys : routineKeys), "operationKey"]);
      const operationKey = identifier(body.operationKey);
      const input: RoutineInput | SessionInput = kind === "sessions" ? validateSession(body, today, optionalTrainingMetricsEnabled()) : validateRoutine(body);
      const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      // Serialize matching keys even before the first row exists. Hash collisions only serialize unrelated writes.
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`training:${kind}:${actor.memberId}:${operationKey}`]);
      const { rows: existing } = await tx.query<TrainingRow>(`SELECT ${columns(kind)} FROM ${tables[kind]} WHERE owner_member_id=$1 AND family_id=$2 AND operation_key=$3`, [actor.memberId, actor.familyId, operationKey]);
      if (existing[0]) {
        if (existing[0].creation_hash !== hash) fail(409, "OPERATION_CONFLICT", "Este intento ya se guardó con otros datos. Recargá el registro antes de cambiarlo.");
        await tx.query("COMMIT"); return response({ item: mapRow(existing[0], kind), today });
      }
      const args: unknown[] = [actor.familyId, actor.memberId, input.name, JSON.stringify(input.blocks), operationKey, hash];
      let extraColumns = "", placeholders = "";
      if (kind === "sessions") {
        const session = input as SessionInput;
        const source = await getOwned(tx, "routines", actor, session.sourceRoutineId, "FOR SHARE");
        if (source.archived_at) fail(409, "ROUTINE_ARCHIVED", "Restaurá la rutina antes de registrar un entrenamiento.");
        args.push(session.sourceRoutineId, session.performedOn, session.durationSeconds, session.effort, session.note);
        extraColumns = ",source_routine_id,performed_on,duration_seconds,effort,note"; placeholders = ",$7,$8,$9,$10,$11";
      }
      const { rows } = await tx.query<TrainingRow>(`INSERT INTO ${tables[kind]}(family_id,owner_member_id,name,blocks,operation_key,creation_hash${extraColumns}) VALUES($1,$2,$3,$4::jsonb,$5,$6${placeholders}) RETURNING ${columns(kind)}`, args);
      item = rows[0];
    }
    await tx.query("COMMIT"); return response({ item: mapRow(item, kind), today }, id ? 200 : 201);
  } catch (error) { if (tx) await tx.query("ROLLBACK"); return errorResponse(error); }
  finally { tx?.release(); }
}
