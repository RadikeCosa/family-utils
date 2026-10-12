import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { getPool } from "@/db";
import { getMemberContext, type MemberContext } from "@/lib/auth/context";
import { libraryEnabled } from "./config";
import { cursorScope, decodeCursor, encodeCursor } from "./cursor";
import { normalizeLibraryText, UUID_PATTERN, workInput } from "./rules";
import { PERSONAL_STATUSES, WORK_KINDS, type LibraryWork, type WorkKind, type PersonalEntry } from "./types";

class LibraryError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}
function fail(status: number, code: string, message: string): never { throw new LibraryError(status, code, message); }
function errorResponse(error: unknown) {
  if (error instanceof LibraryError) return NextResponse.json({ error: error.message, code: error.code, ...error.extra }, { status: error.status });
  console.error("library_request_failed", { code: error && typeof error === "object" && "code" in error ? error.code : "unknown" });
  return NextResponse.json({ error: "No se pudo completar la operación. Conservamos tu borrador.", code: "UNAVAILABLE" }, { status: 500 });
}
export function libraryUnavailable() { return NextResponse.json({ error: "No encontrado.", code: "NOT_FOUND" }, { status: 404 }); }
async function activeActor(tx: PoolClient, actor: MemberContext) {
  const { rows: [member] } = await tx.query("SELECT m.id FROM members m JOIN member_devices d ON d.member_id=m.id WHERE m.id=$1 AND m.family_id=$2 AND d.auth_user_id=$3 AND m.archived_at IS NULL AND d.revoked_at IS NULL", [actor.memberId, actor.familyId, actor.authUser.id]);
  if (!member) fail(403, "NO_ACCESS", "Tu acceso a la familia ya no está disponible.");
}
async function revision(tx: PoolClient, actor: MemberContext) {
  const { rows: [family] } = await tx.query("SELECT library_revision, revision FROM families WHERE id=$1", [actor.familyId]);
  return { revision: Number(family.library_revision), accessRevision: Number(family.revision) };
}
async function profiles(tx: PoolClient, familyId: string) {
  return (await tx.query('SELECT id, name, archived_at AS "archivedAt" FROM members WHERE family_id=$1 ORDER BY created_at,id', [familyId])).rows;
}
type WorkRow = { id: string; family_id: string; title: string; kind: WorkKind; creator: string | null; year: number | null; reference_url: string | null; version: number; archived_at: Date | null; created_at: Date; updated_at: Date; activity_at: string };
const activitySql = "greatest(w.created_at, coalesce((SELECT max(c.created_at) FROM library_contributions c WHERE c.work_id=w.id), w.created_at))";
const activityColumn = `to_char(${activitySql} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS activity_at`;
async function mapWorks(tx: PoolClient, rows: WorkRow[]): Promise<LibraryWork[]> {
  const personalRows = rows.length ? (await tx.query('SELECT work_id,member_id AS "memberId",status,rating,version FROM library_personal WHERE work_id=ANY($1::uuid[])', [rows.map((row) => row.id)])).rows : [];
  return rows.map((row) => ({ id: row.id, title: row.title, kind: row.kind, creator: row.creator, year: row.year, referenceUrl: row.reference_url, version: row.version, archivedAt: row.archived_at?.toISOString() ?? null, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), activityAt: row.activity_at,
    personal: personalRows.filter((entry) => entry.work_id === row.id).map(({ memberId, status, rating, version }) => ({ memberId, status, rating, version }) as PersonalEntry) }));
}
export async function readLibrary(request: Request, workId?: string) {
  if (!libraryEnabled()) return libraryUnavailable();
  let tx: PoolClient | undefined;
  try {
    const actor = await getMemberContext(request.headers);
    if (!actor) fail(403, "NO_ACCESS", "Ingresá a tu familia.");
    if (workId && !UUID_PATTERN.test(workId)) fail(400, "INVALID", "Identificador inválido.");
    const url = new URL(request.url);
    const q = normalizeLibraryText(url.searchParams.get("q") ?? "");
    const kind = url.searchParams.get("kind") ?? "", status = url.searchParams.get("status") ?? "";
    const archived = url.searchParams.get("archived") === "true";
    if (Array.from(q).length > 200 || (kind && !WORK_KINDS.includes(kind as never)) || (status && !PERSONAL_STATUSES.includes(status as never) && status !== "none")) fail(400, "INVALID", "Filtros inválidos.");
    const scope = cursorScope([actor.familyId, workId ?? "collection", q, kind, status, archived, status ? actor.memberId : null]);
    let cursor;
    try { cursor = decodeCursor(url.searchParams.get("cursor"), scope); } catch (error) { fail(400, "INVALID", (error as Error).message); }
    tx = await getPool().connect();
    await tx.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await activeActor(tx, actor);
    const rev = await revision(tx, actor);
    const etag = `"library-${cursorScope([scope, actor.memberId, rev.revision, rev.accessRevision, url.searchParams.get("cursor")])}"`;
    const headers = { ETag: etag, "Cache-Control": "private, no-cache", Vary: "Cookie" };
    if (request.headers.get("if-none-match") === etag) { await tx.query("COMMIT"); return new NextResponse(null, { status: 304, headers }); }
    const members = await profiles(tx, actor.familyId);
    const base = { currentMemberId: actor.memberId, familyId: actor.familyId, revision: rev.revision, members };
    if (url.searchParams.get("revisionOnly") === "true") {
      await tx.query("COMMIT"); return NextResponse.json({ ...base }, { headers });
    }
    if (workId) {
      const { rows } = await tx.query<WorkRow>(`SELECT w.*, ${activityColumn} FROM library_works w WHERE w.id=$1 AND w.family_id=$2`, [workId, actor.familyId]);
      if (!rows.length) fail(404, "NOT_FOUND", "No encontramos esa obra.");
      const [work] = await mapWorks(tx, rows);
      await tx.query("COMMIT");
      return NextResponse.json({ ...base, work, contributions: [], nextCursor: null }, { headers });
    }
    const values: unknown[] = [actor.familyId];
    const where = ["w.family_id=$1", archived ? "w.archived_at IS NOT NULL" : "w.archived_at IS NULL"];
    const arg = (value: unknown) => { values.push(value); return `$${values.length}`; };
    if (q) { const query = arg(q); where.push(`(strpos(w.titulo_normalizado,${query})>0 OR strpos(w.creador_normalizado,${query})>0)`); }
    if (kind) where.push(`w.kind=${arg(kind)}`);
    if (status) {
      const person = arg(actor.memberId);
      where.push(status === "none" ? `NOT EXISTS(SELECT 1 FROM library_personal p WHERE p.work_id=w.id AND p.member_id=${person} AND p.status IS NOT NULL)` : `EXISTS(SELECT 1 FROM library_personal p WHERE p.work_id=w.id AND p.member_id=${person} AND p.status=${arg(status)})`);
    }
    if (cursor) where.push(`(${activitySql},w.id)<(${arg(cursor.at)}::timestamptz,${arg(cursor.id)}::uuid)`);
    const { rows } = await tx.query<WorkRow>(`SELECT w.*,${activityColumn} FROM library_works w WHERE ${where.join(" AND ")} ORDER BY ${activitySql} DESC,w.id DESC LIMIT 51`, values);
    const page = rows.slice(0, 50), last = page.at(-1);
    const works = await mapWorks(tx, page);
    const nextCursor = rows.length > 50 && last ? encodeCursor(scope, last.activity_at, last.id) : null;
    await tx.query("COMMIT");
    return NextResponse.json({ ...base, works, nextCursor }, { headers });
  } catch (error) { if (tx) await tx.query("ROLLBACK"); return errorResponse(error); }
  finally { tx?.release(); }
}
async function record(tx: PoolClient, actor: MemberContext, entityType: string, entityId: string, action: string, metadata: unknown = null) {
  await tx.query('INSERT INTO audit_events(family_id,actor_member_id,entity_type,entity_id,action,"after") VALUES($1,$2,$3,$4,$5,$6::jsonb)', [actor.familyId, actor.memberId, entityType, entityId, action, JSON.stringify(metadata)]);
  await tx.query("UPDATE families SET library_revision=library_revision+1 WHERE id=$1", [actor.familyId]);
}
export async function mutateLibrary(request: Request, command: "create" | "manage", workId?: string) {
  if (!libraryEnabled()) return libraryUnavailable();
  let tx: PoolClient | undefined;
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) fail(403, "NO_ACCESS", "Origen no permitido.");
    const actor = await getMemberContext(request.headers);
    if (!actor) fail(403, "NO_ACCESS", "Ingresá a tu familia.");
    if (workId && !UUID_PATTERN.test(workId)) fail(400, "INVALID", "Identificador inválido.");
    let body: Record<string, unknown>;
    try { body = await request.json(); if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(); } catch { fail(400, "INVALID", "Datos inválidos."); }
    tx = await getPool().connect(); await tx.query("BEGIN"); await activeActor(tx, actor);
    let current: WorkRow | undefined;
    if (command !== "create") {
      current = (await tx.query<WorkRow>("SELECT * FROM library_works WHERE id=$1 AND family_id=$2 FOR UPDATE", [workId, actor.familyId])).rows[0];
      if (!current) fail(404, "NOT_FOUND", "No encontramos esa obra.");
      await activeActor(tx, actor);
      if (current.version !== body.expectedVersion) fail(409, "CONFLICT", "Hubo otro cambio. Actualizá y revisá los datos antes de reintentar.");
      if (body.action === "archive" || body.action === "restore") {
        const archive = body.action === "archive";
        if (archive !== !!current.archived_at) {
          await tx.query("UPDATE library_works SET archived_at=CASE WHEN $1 THEN now() ELSE NULL END,version=version+1,updated_at=now(),updated_by_member_id=$2 WHERE id=$3", [archive, actor.memberId, workId]);
          await record(tx, actor, "library_work", workId!, body.action);
        }
        await tx.query("COMMIT"); return NextResponse.json({ id: workId });
      }
      if (body.action !== "edit") fail(400, "INVALID", "Acción inválida.");
      if (current.archived_at) fail(403, "ARCHIVED", "Restaurá la ficha antes de editarla.");
    }
    const input = workInput(body);
    if (!input) fail(400, "INVALID", "Revisá título, tipo y datos opcionales.");
    const changedIdentity = !current || current.title !== input.title || current.kind !== input.kind;
    if (changedIdentity && body.confirmDuplicate !== true) {
      const { rows: duplicates } = await tx.query('SELECT id,title,archived_at AS "archivedAt" FROM library_works WHERE family_id=$1 AND kind=$2 AND titulo_normalizado=$3 AND ($4::uuid IS NULL OR id<>$4) ORDER BY created_at DESC,id DESC LIMIT 20', [actor.familyId, input.kind, normalizeLibraryText(input.title), current?.id ?? null]);
      if (duplicates.length) throw new LibraryError(409, "DUPLICATE", "Encontramos obras parecidas. Abrí una ficha o confirmá que es otra obra.", { duplicates });
    }
    const values = [input.title, normalizeLibraryText(input.title), input.kind, input.creator, normalizeLibraryText(input.creator ?? ""), input.year, input.referenceUrl, actor.memberId];
    let id: string;
    if (current) {
      await tx.query("UPDATE library_works SET title=$1,titulo_normalizado=$2,kind=$3,creator=$4,creador_normalizado=$5,year=$6,reference_url=$7,updated_by_member_id=$8,updated_at=now(),version=version+1 WHERE id=$9", [...values, workId]);
      id = current.id;
    } else {
      id = (await tx.query("INSERT INTO library_works(title,titulo_normalizado,kind,creator,creador_normalizado,year,reference_url,created_by_member_id,updated_by_member_id,family_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) RETURNING id", [...values, actor.familyId])).rows[0].id;
    }
    await record(tx, actor, "library_work", id, current ? "edited" : "created");
    await tx.query("COMMIT"); return NextResponse.json({ id }, { status: current ? 200 : 201 });
  } catch (error) { if (tx) await tx.query("ROLLBACK"); return errorResponse(error); }
  finally { tx?.release(); }
}
