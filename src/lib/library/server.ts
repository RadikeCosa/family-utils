import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { getPool } from "@/db";
import { getMemberContext, type MemberContext } from "@/lib/auth/context";
import { libraryEnabled } from "./config";
import { cursorScope, decodeCursor, encodeCursor } from "./cursor";
import { contributionInput, normalizeLibraryText, personalInput, UUID_PATTERN, workInput } from "./rules";
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
      const values: unknown[] = [workId, actor.familyId];
      let after = "";
      if (cursor) { values.push(cursor.at, cursor.id); after = " AND (c.created_at,c.id)<($3::timestamptz,$4::uuid)"; }
      const contributionRows = (await tx.query(`SELECT c.*,to_char(c.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS published_at,
        ARRAY(SELECT member_id FROM library_companions WHERE contribution_id=c.id ORDER BY member_id) AS companion_ids
        FROM library_contributions c WHERE c.work_id=$1 AND c.family_id=$2 AND c.retired_at IS NULL${after} ORDER BY c.created_at DESC,c.id DESC LIMIT 51`, values)).rows;
      const page = contributionRows.slice(0,50), last = page.at(-1);
      const contributionPage = { contributions: page.map((entry) => ({ id: entry.id, authorMemberId: entry.author_member_id, body: entry.body, spoiler: entry.spoiler,
        experience: { year: entry.experience_year, month: entry.experience_month, day: entry.experience_day }, companionIds: entry.companion_ids, version: entry.version, createdAt: entry.published_at, updatedAt: entry.updated_at.toISOString() })),
        nextCursor: contributionRows.length > 50 && last ? encodeCursor(scope,last.published_at,last.id) : null };
      await tx.query("COMMIT");
      return NextResponse.json({ ...base, work, ...contributionPage }, { headers });
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
export async function mutateLibrary(request: Request, command: "create" | "manage" | "personal" | "contribute", workId?: string, contributionId?: string) {
  if (!libraryEnabled()) return libraryUnavailable();
  let tx: PoolClient | undefined;
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) fail(403, "NO_ACCESS", "Origen no permitido.");
    const actor = await getMemberContext(request.headers);
    if (!actor) fail(403, "NO_ACCESS", "Ingresá a tu familia.");
    if (workId && !UUID_PATTERN.test(workId)) fail(400, "INVALID", "Identificador inválido.");
    if (contributionId && !UUID_PATTERN.test(contributionId)) fail(400, "INVALID", "Identificador inválido.");
    let body: Record<string, unknown>;
    try { body = await request.json(); if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(); } catch { fail(400, "INVALID", "Datos inválidos."); }
    tx = await getPool().connect(); await tx.query("BEGIN"); await activeActor(tx, actor);
    if (command === "contribute") {
      const work = (await tx.query<WorkRow>("SELECT * FROM library_works WHERE id=$1 AND family_id=$2 FOR SHARE", [workId, actor.familyId])).rows[0];
      if (!work) fail(404, "NOT_FOUND", "No encontramos esa obra.");
      await activeActor(tx, actor);
      const previous = contributionId ? (await tx.query("SELECT * FROM library_contributions WHERE id=$1 AND work_id=$2 AND family_id=$3 AND retired_at IS NULL FOR UPDATE", [contributionId, workId, actor.familyId])).rows[0] : null;
      if (contributionId && !previous) fail(404, "NOT_FOUND", "No encontramos ese aporte.");
      if (previous && previous.author_member_id !== actor.memberId) fail(403, "NOT_AUTHOR", "Solo el autor puede editar o retirar su aporte.");
      if (previous && previous.version !== body.expectedVersion) fail(409, "CONFLICT", "El aporte cambió. Revisá la versión actual antes de reintentar.");
      if (previous && body.action === "retire") {
        await tx.query("UPDATE library_contributions SET retired_at=now(),updated_at=now(),version=version+1 WHERE id=$1", [contributionId]);
        await record(tx, actor, "library_contribution", contributionId!, "retired", { workId });
        await tx.query("COMMIT"); return NextResponse.json({ id: contributionId });
      }
      if (work.archived_at) fail(403, "ARCHIVED", "Restaurá la ficha antes de publicar o editar aportes.");
      if (previous && body.action !== "edit") fail(400, "INVALID", "Acción inválida.");
      const input = contributionInput(body);
      if (!input) fail(400, "INVALID", "Revisá el texto, la fecha y la compañía.");
      if (input.companionIds.length) {
        const companions = await tx.query("SELECT id FROM members WHERE family_id=$1 AND id=ANY($2::uuid[])", [actor.familyId, input.companionIds]);
        if (companions.rows.length !== input.companionIds.length) fail(400, "INVALID", "La compañía debe pertenecer a tu familia.");
      }
      const values = [input.body,input.spoiler,input.experience.year,input.experience.month,input.experience.day];
      const id: string = previous ? previous.id : (await tx.query("INSERT INTO library_contributions(body,spoiler,experience_year,experience_month,experience_day,family_id,work_id,author_member_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id", [...values,actor.familyId,workId,actor.memberId])).rows[0].id;
      if (previous) {
        await tx.query("UPDATE library_contributions SET body=$1,spoiler=$2,experience_year=$3,experience_month=$4,experience_day=$5,version=version+1,updated_at=now() WHERE id=$6", [...values,id]);
        await tx.query("DELETE FROM library_companions WHERE contribution_id=$1", [id]);
      }
      for (const memberId of input.companionIds) await tx.query("INSERT INTO library_companions(family_id,contribution_id,member_id) VALUES($1,$2,$3)", [actor.familyId,id,memberId]);
      await record(tx, actor, "library_contribution", id, previous ? "edited" : "published", { workId, spoiler: input.spoiler, experience: input.experience, companionIds: input.companionIds });
      await tx.query("COMMIT"); return NextResponse.json({ id }, { status: previous ? 200 : 201 });
    }
    if (command === "personal") {
      const work = (await tx.query<WorkRow>("SELECT * FROM library_works WHERE id=$1 AND family_id=$2 FOR SHARE", [workId, actor.familyId])).rows[0];
      if (!work) fail(404, "NOT_FOUND", "No encontramos esa obra.");
      await activeActor(tx, actor);
      if (work.archived_at) fail(403, "ARCHIVED", "Restaurá la ficha antes de cambiar tu estado o valoración.");
      const input = personalInput(body);
      if (!input) fail(400, "INVALID", "Revisá el estado y las estrellas.");
      const previous = (await tx.query("SELECT version FROM library_personal WHERE work_id=$1 AND member_id=$2 FOR UPDATE", [workId, actor.memberId])).rows[0];
      if ((previous?.version ?? 0) !== body.expectedVersion) fail(409, "CONFLICT", "Tus datos cambiaron. Actualizá y revisalos antes de reintentar.");
      if (previous) await tx.query("UPDATE library_personal SET status=$1,rating=$2,version=version+1,updated_at=now() WHERE work_id=$3 AND member_id=$4", [input.status, input.rating, workId, actor.memberId]);
      else {
        const result = await tx.query("INSERT INTO library_personal(family_id,work_id,member_id,status,rating) VALUES($1,$2,$3,$4,$5) ON CONFLICT(work_id,member_id) DO NOTHING RETURNING id", [actor.familyId, workId, actor.memberId, input.status, input.rating]);
        if (!result.rows.length) fail(409, "CONFLICT", "Tus datos cambiaron. Actualizá y revisalos antes de reintentar.");
      }
      await record(tx, actor, "library_personal", workId!, "updated", input);
      await tx.query("COMMIT"); return NextResponse.json({ id: workId });
    }
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
