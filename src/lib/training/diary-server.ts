import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "@/db";
import type { MemberContext } from "@/lib/auth/context";
import { dayInZone, nextCivilDayAt } from "@/lib/calendar/civil";
import { trainingActivityFormEnabled, trainingDiaryEnabled, trainingEnabled } from "./config";
import { actorFor, activeActor, errorResponse, fail, readTrainingBody, response as baseResponse, trainingUnavailable } from "./server";
import { identifier, integer, object, onlyKeys, TrainingValidationError } from "./rules";
import { diaryContent, mergeDiaryContent, diaryDate, diaryStatus, diaryWeek, emptyCounts, SEARCH_MIN, validateDiary, weekDates, type DiaryContext, type DiaryEntry, type DiaryInput } from "./diary";

type Row = { id: string; family_id: string; owner_member_id: string; date: string; kind: DiaryInput["kind"]; plan: DiaryInput["plan"]; result: DiaryInput["result"]; disposition: DiaryInput["disposition"]; source_routine_id: string | null; version: number; archived_at: Date | null; created_at: Date; updated_at: Date };
const columns = "id,family_id,owner_member_id,date::text AS date,kind,plan,result,disposition,source_routine_id,version,archived_at,created_at,updated_at";

function diaryResponse(request: Request, body: Record<string, unknown>, status = 200) {
  // Old cached validators reject unknown content keys. Their views omit timing;
  // their writes preserve the stored interval through mergeDiaryContent.
  if (request.headers.get("x-training-timing") !== "1") {
    const legacy = (item: DiaryEntry) => {
      const content = (value: DiaryEntry["plan"]) => { if (value == null) return value; const copy = { ...value }; delete copy.timing; return copy; };
      return { ...item, plan: content(item.plan), result: content(item.result) };
    };
    if (body.item) body = { ...body, item: legacy(body.item as DiaryEntry) };
    if (Array.isArray(body.items)) body = { ...body, items: body.items.map(legacy) };
  }
  return baseResponse(body, status);
}

function map(row: Row, today: string): DiaryEntry {
  const entry = { id: row.id, date: row.date, kind: row.kind, plan: row.plan, result: row.result, disposition: row.disposition, sourceRoutineId: row.source_routine_id, version: row.version, archivedAt: row.archived_at?.toISOString() ?? null, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
  return { ...entry, status: diaryStatus(entry, today) };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function digest(value: unknown) { return createHash("sha256").update(canonical(value)).digest("hex"); }

function fingerprint(value: unknown): Record<string, unknown> {
  function normalize(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object") {
      const raw = v as Record<string, unknown>;
      const result = Object.fromEntries(Object.entries(raw).map(([key, item]) => [key, typeof item === "string" ? item.trim() : normalize(item)]));
      // Existing optional effort null and omission represent the same operation.
      if ("text" in raw || "title" in raw || "blocks" in raw) { result.effort ??= null; }
      return result;
    }
    return v;
  }
  return normalize(value) as Record<string, unknown>;
}

function legacyFingerprint(id: string | undefined, version: number | undefined, action: string, normalized: Record<string, unknown>, kind?: DiaryInput["kind"]): string | null {
  if (JSON.stringify(normalized).includes('"timing"')) return null;
  try {
    const original = action === "create" || action === "edit" ? { input: validateDiary(normalized.input, "2200-12-31") } : action === "result" && kind && !("date" in normalized) ? { content: diaryContent(normalized.content, kind) } : normalized;
    return digest({ id: id ?? null, version: version ?? null, action, ...original });
  } catch { return null; }
}

function requireTimingForMove(previous: Row | null, date: unknown, content: unknown) {
  if (previous && date !== previous.date && (previous.result ?? previous.plan)?.timing && (!content || !object(content).timing)) fail(409, "TIMING_REQUIRED_FOR_DATE_CHANGE", "Para cambiar la fecha, reenviá los horarios completos. Tu anotación se conserva.");
}

async function owned(tx: PoolClient, actor: MemberContext, id: string): Promise<Row> {
  identifier(id);
  const { rows } = await tx.query<Row>(`SELECT ${columns} FROM training_entries WHERE id=$1 AND owner_member_id=$2 AND family_id=$3`, [id, actor.memberId, actor.familyId]);
  if (!rows[0]) fail(404, "NOT_FOUND", "No encontramos esta anotación.");
  return rows[0];
}
function inputOf(row: Row): DiaryInput { return { date: row.date, kind: row.kind, plan: row.plan, result: row.result, disposition: row.disposition, sourceRoutineId: row.source_routine_id }; }
async function context(tx: PoolClient, actor: MemberContext): Promise<DiaryContext> {
  const state = await tx.query("SELECT transitioned_at FROM training_diary_state WHERE singleton=true FOR SHARE");
  if (!state.rows[0]?.transitioned_at) fail(404, "NOT_FOUND", "El diario todavía no está habilitado.");
  const now = new Date();
  return { today: dayInZone(now, actor.familyTimeZone), timeZone: actor.familyTimeZone, serverNow: now.toISOString(), nextDayAt: nextCivilDayAt(now, actor.familyTimeZone).toISOString(), writable: trainingDiaryEnabled(), activityFormEnabled: trainingActivityFormEnabled() };
}
function originCheck(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) fail(403, "NO_ACCESS", "Origen no permitido.");
}
function queryBoolean(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === "false") return false;
  if (value === true || value === "true") return true;
  throw new TrainingValidationError("Filtro inválido.");
}
export async function diaryRead(request: Request, mode: "entries" | "search" | "summary", id?: string) {
  const response = (body: Record<string, unknown>, status = 200) => diaryResponse(request, body, status);
  if (!trainingEnabled()) return trainingUnavailable();
  let tx: PoolClient | undefined;
  try {
    const actor = await actorFor(request);
    if (request.headers.get("x-training-contract") !== "3") fail(409, "CLIENT_UPDATE_REQUIRED", "Actualizá la página para usar el diario.");
    if (request.method === "POST") originCheck(request);
    const url = new URL(request.url);
    if (url.searchParams.has("q")) throw new TrainingValidationError("La búsqueda debe enviarse en el cuerpo de la consulta.");
    const body = mode === "search" ? await readTrainingBody(request) : Object.fromEntries(url.searchParams);
    onlyKeys(body, mode === "search" ? ["query", "archived", "limit", "cursor"] : mode === "summary" ? ["weekStart"] : ["date", "archived", "limit", "cursor"]);
    tx = await getPool().connect(); await tx.query("BEGIN ISOLATION LEVEL REPEATABLE READ"); await activeActor(tx, actor);
    const ctx = await context(tx, actor);
    if (id) { const item = map(await owned(tx, actor, id), ctx.today); await tx.query("COMMIT"); return response({ item, ...ctx }); }
    const revision = (await tx.query("SELECT revision::text FROM training_diary_revisions WHERE owner_member_id=$1 AND family_id=$2", [actor.memberId, actor.familyId])).rows[0]?.revision ?? "0";
    if (mode === "summary") {
      const start = diaryWeek(body.weekStart), dates = weekDates(start);
      const { rows } = await tx.query<{ date: string; kind: "training" | "rest"; status: "completed" | "missed" | "planned"; count: number }>(`SELECT date::text,kind,CASE WHEN result IS NOT NULL THEN 'completed' WHEN disposition='skipped' OR date<$5::date THEN 'missed' ELSE 'planned' END AS status,count(*)::int AS count
        FROM training_entries WHERE owner_member_id=$1 AND family_id=$2 AND date BETWEEN $3::date AND $4::date AND archived_at IS NULL GROUP BY date,kind,status`, [actor.memberId, actor.familyId, dates[0], dates.at(-1), ctx.today]);
      const days = dates.map(date => ({ date, counts: emptyCounts() }));
      for (const row of rows) days.find(day => day.date === row.date)!.counts[`${row.kind}_${row.status}`] = row.count;
      await tx.query("COMMIT"); return response({ days, weekStart: start, revision, ...ctx });
    }
    let query = "";
    if (mode === "search") {
      if (typeof body.query !== "string" || /[\p{Cc}\p{Cf}]/u.test(body.query)) throw new TrainingValidationError("Búsqueda inválida.");
      query = body.query.trim();
      if (Array.from(query).length < SEARCH_MIN || Array.from(query).length > 200) throw new TrainingValidationError(`Escribí entre ${SEARCH_MIN} y 200 caracteres para buscar.`);
    }
    const date = mode === "entries" ? diaryDate(body.date ?? ctx.today) : null, archived = queryBoolean(body.archived);
    const limit = body.limit === undefined ? 20 : integer(typeof body.limit === "string" && /^\d+$/.test(body.limit) ? Number(body.limit) : body.limit, "Tamaño de página", 50);
    const scope = digest([actor.memberId, actor.familyId, mode, date, archived, query, ctx.today]);
    const args: unknown[] = [actor.memberId, actor.familyId];
    const where = ["owner_member_id=$1", "family_id=$2"];
    if (date) { args.push(date); where.push(`date=$${args.length}::date`); }
    if (!archived) where.push("archived_at IS NULL");
    if (query) { args.push(query.replace(/[\\%_]/g, "\\$&")); where.push(`search_text LIKE '%' || public.normalize_name_v1($${args.length}::text) || '%' ESCAPE '\\'`); }
    if (body.cursor) {
      if (typeof body.cursor !== "string" || body.cursor.length > 2048) throw new TrainingValidationError("Cursor inválido.");
      let cursor;
      try { cursor = JSON.parse(Buffer.from(body.cursor, "base64url").toString("utf8")); diaryDate(cursor.date); identifier(cursor.id); if (cursor.scope !== scope || typeof cursor.revision !== "string") throw new Error(); }
      catch { throw new TrainingValidationError("Cursor inválido. Actualizá el listado."); }
      if (cursor.revision !== revision) fail(409, "LIST_CHANGED", "Las anotaciones cambiaron. Actualizá el listado para continuar.");
      args.push(cursor.date, cursor.id); where.push(`(date,id)<($${args.length - 1}::date,$${args.length}::uuid)`);
    }
    args.push(limit + 1);
    // Project only excerpts: nested exercise arrays are fetched exclusively by detail.
    const preview = `id,family_id,owner_member_id,date::text,kind,CASE WHEN plan IS NULL THEN NULL ELSE jsonb_build_object('title',plan->>'title','text',left(plan->>'text',240)) END AS plan,CASE WHEN result IS NULL THEN NULL ELSE jsonb_build_object('title',result->>'title','text',left(result->>'text',240)) END AS result,disposition,source_routine_id,version,archived_at,created_at,updated_at`;
    const { rows } = await tx.query<Row>(`SELECT ${preview} FROM training_entries WHERE ${where.join(" AND ")} ORDER BY date DESC,id DESC LIMIT $${args.length}`, args);
    const page = rows.slice(0, limit), last = page.at(-1);
    const nextCursor = rows.length > limit && last ? Buffer.from(JSON.stringify({ scope, revision, date: last.date, id: last.id })).toString("base64url") : null;
    await tx.query("COMMIT"); return response({ items: page.map(row => map(row, ctx.today)), nextCursor, revision, ...ctx });
  } catch (error) { if (tx) await tx.query("ROLLBACK"); return errorResponse(error); }
  finally { tx?.release(); }
}
export async function diaryWrite(request: Request, id?: string) {
  const response = (body: Record<string, unknown>, status = 200) => diaryResponse(request, body, status);
  if (!trainingEnabled()) return trainingUnavailable();
  let tx: PoolClient | undefined;
  try {
    originCheck(request); const actor = await actorFor(request);
    if (request.headers.get("x-training-contract") !== "3") fail(409, "CLIENT_UPDATE_REQUIRED", "Actualizá la página para usar el diario.");
    const body = await readTrainingBody(request), operationKey = identifier(body.operationKey);
    const action = typeof body.action === "string" ? body.action : "create";
    let normalized: Record<string, unknown>;
    // Resolve the temporal validation after acquiring the transition lock.
    tx = await getPool().connect(); await tx.query("BEGIN"); await activeActor(tx, actor);
    const ctx = await context(tx, actor);
    if (!ctx.writable) fail(503, "DIARY_READ_ONLY", "El diario está en modo de consulta. Conservamos tu formulario.");
    await tx.query("INSERT INTO training_diary_revisions(owner_member_id,family_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [actor.memberId, actor.familyId]);
    await tx.query("SELECT revision FROM training_diary_revisions WHERE owner_member_id=$1 FOR UPDATE", [actor.memberId]);
    const previous = id ? await owned(tx, actor, id) : null;
    const version = id ? integer(body.version, "Versión", 2147483646) : undefined;
    if (!id && action === "create" || id && action === "edit") {
      onlyKeys(body, ["action", "operationKey", ...(id ? ["version"] : []), "input"]);
      normalized = { input: object(body.input) };
    } else if (!id && action === "copy") {
      onlyKeys(body, ["action", "operationKey", "sourceId", "content", "date", "timing"]);
      if (body.content !== "plan" && body.content !== "result") throw new TrainingValidationError("Elegí qué contenido copiar.");
      normalized = { sourceId: identifier(body.sourceId), content: body.content, date: diaryDate(body.date), ...("timing" in body ? { timing: body.timing } : {}) };
    } else if (id && action === "result") {
      onlyKeys(body, ["action", "operationKey", "version", "content", "date"]); normalized = { content: object(body.content), ...(body.date !== undefined ? { date: diaryDate(body.date) } : {}) };
    } else if (id && ["skip", "reschedule", "archive", "restore"].includes(action)) {
      onlyKeys(body, ["action", "operationKey", "version", ...(action === "reschedule" ? ["date", "timing"] : [])]);
      normalized = action === "reschedule" ? { date: diaryDate(body.date), ...("timing" in body ? { timing: body.timing } : {}) } : {};
    } else throw new TrainingValidationError("Operación inválida.");
    const hash = digest({ id: id ?? null, version: version ?? null, action, ...fingerprint(normalized) });
    const previousOp = (await tx.query("SELECT entry_id,hash,confirmed_version FROM training_diary_operations WHERE owner_member_id=$1 AND family_id=$2 AND operation_key=$3", [actor.memberId, actor.familyId, operationKey])).rows[0];
    if (previousOp) {
      if (previousOp.hash !== hash && previousOp.hash !== legacyFingerprint(id, version, action, normalized, previous?.kind)) fail(409, "OPERATION_CONFLICT", "Este intento ya se confirmó con otros datos.");
      const item = map(await owned(tx, actor, previousOp.entry_id), ctx.today);
      await tx.query("COMMIT"); return response({ item, confirmedVersion: previousOp.confirmed_version, replayed: true, ...ctx });
    }
    if (previous && previous.version !== version) fail(409, "VERSION_CONFLICT", "La anotación cambió en otro dispositivo. Tu plan y resultado sin guardar se conservan para revisar los cambios.");
    let input: DiaryInput, archivedAt: Date | null = previous?.archived_at ?? null;
    if (action === "create" || action === "edit") {
      const raw = object(normalized.input);
      requireTimingForMove(previous, raw.date, raw.result ?? raw.plan);
      input = validateDiary({ ...raw, plan: mergeDiaryContent(raw.plan, previous?.plan), result: mergeDiaryContent(raw.result, previous?.result) }, ctx.today);
      if (previous) {
        if (previous.archived_at) fail(409, "ENTRY_ARCHIVED", "Restaurá la anotación antes de editarla.");
        if (input.kind !== previous.kind || input.sourceRoutineId !== previous.source_routine_id) throw new TrainingValidationError("El tipo y origen de una anotación no se cambian.");
        if (previous.result !== null && (input.result === null || canonical(input.plan) !== canonical(previous.plan))) throw new TrainingValidationError("Corregir lo realizado conserva el plan original.");
      } else if (input.sourceRoutineId) {
        const routine = await tx.query("SELECT archived_at FROM training_routines WHERE id=$1 AND owner_member_id=$2 AND family_id=$3 FOR SHARE", [input.sourceRoutineId, actor.memberId, actor.familyId]);
        if (!routine.rows[0]) fail(404, "NOT_FOUND", "No encontramos esta plantilla.");
        if (routine.rows[0].archived_at) fail(409, "ROUTINE_ARCHIVED", "La plantilla está archivada.");
      }
    } else if (action === "copy") {
      const source = await owned(tx, actor, normalized.sourceId as string), content = source[normalized.content as "plan" | "result"];
      if (content === null) throw new TrainingValidationError("Ese contenido no existe.");
      requireTimingForMove({ ...source, result: content, plan: null }, normalized.date, normalized);
      input = validateDiary({ date: normalized.date, kind: source.kind, plan: "timing" in normalized ? diaryContent({ ...content, timing: normalized.timing }, source.kind) : content, result: null, disposition: "open", sourceRoutineId: source.source_routine_id }, ctx.today);
    } else {
      input = inputOf(previous!);
      if (previous!.archived_at && action !== "restore") fail(409, "ENTRY_ARCHIVED", "Restaurá la anotación primero.");
      if (action === "result") {
        if (normalized.date !== undefined) input.date = normalized.date as string;
        requireTimingForMove(previous, input.date, normalized.content);
        input.result = diaryContent(mergeDiaryContent(normalized.content, previous?.result), input.kind); input.disposition = "open";
      } else if (action === "skip") {
        if (input.result !== null) throw new TrainingValidationError("Una anotación realizada no se puede omitir.");
        input.disposition = "skipped";
      } else if (action === "reschedule") {
        if (input.result !== null || (normalized.date as string) < ctx.today) throw new TrainingValidationError("Solo se reprograman planes sin resultado hacia hoy o el futuro.");
        requireTimingForMove(previous, normalized.date, normalized);
        input.date = normalized.date as string; input.disposition = "open";
        if ("timing" in normalized && input.plan) input.plan = diaryContent({ ...input.plan, timing: normalized.timing }, input.kind);
      } else if (action === "archive") archivedAt = new Date();
      else if (action === "restore") archivedAt = null;
      input = validateDiary(input, ctx.today);
    }
    for (const target of ["plan", "result"] as const) {
      const timing = input[target]?.timing, oldTiming = previous?.[target]?.timing;
      if (timing && canonical(timing) !== canonical(oldTiming ?? null)) {
        if (timing.timeZone !== actor.familyTimeZone) throw new TrainingValidationError("Los horarios nuevos deben usar la zona familiar vigente.");
        if (target === "result" && Date.parse(timing.endAt) > Date.parse(ctx.serverNow)) throw new TrainingValidationError("La actividad no puede finalizar después de ahora en la zona familiar.");
      }
    }
    if (input.kind === "rest" && !archivedAt && (await tx.query("SELECT id FROM training_entries WHERE owner_member_id=$1 AND family_id=$2 AND date=$3::date AND kind='rest' AND archived_at IS NULL AND ($4::uuid IS NULL OR id<>$4)", [actor.memberId, actor.familyId, input.date, id ?? null])).rowCount) fail(409, "REST_ALREADY_EXISTS", "Ya hay un descanso en esa fecha. La anotación se conserva sin cambios.");
    const values = [actor.familyId, actor.memberId, input.date, input.kind, input.plan === null ? null : JSON.stringify(input.plan), input.result === null ? null : JSON.stringify(input.result), input.disposition, input.sourceRoutineId, archivedAt];
    const { rows } = previous
      ? await tx.query<Row>(`UPDATE training_entries SET date=$3::date,kind=$4,plan=$5::jsonb,result=$6::jsonb,disposition=$7,source_routine_id=$8,archived_at=$9,version=version+1,updated_at=now() WHERE id=$10 AND owner_member_id=$2 AND family_id=$1 RETURNING ${columns}`, [...values, id])
      : await tx.query<Row>(`INSERT INTO training_entries(family_id,owner_member_id,date,kind,plan,result,disposition,source_routine_id,archived_at) VALUES($1,$2,$3::date,$4,$5::jsonb,$6::jsonb,$7,$8,$9) RETURNING ${columns}`, values);
    const row = rows[0];
    await tx.query("INSERT INTO training_diary_operations(family_id,owner_member_id,operation_key,hash,entry_id,action,confirmed_version) VALUES($1,$2,$3,$4,$5,$6,$7)", [actor.familyId, actor.memberId, operationKey, hash, row.id, action, row.version]);
    await tx.query(`INSERT INTO audit_events(family_id,actor_member_id,entity_type,entity_id,action,"before","after") VALUES($1,$2,'training_entry',$3,$4,$5::jsonb,$6::jsonb)`, [actor.familyId, actor.memberId, row.id, action, previous ? JSON.stringify({ version: previous.version, date: previous.date }) : null, JSON.stringify({ ownerMemberId: actor.memberId, version: row.version, date: row.date })]);
    await tx.query("COMMIT"); return response({ item: map(row, ctx.today), confirmedVersion: row.version, ...ctx }, previous ? 200 : 201);
  } catch (error) {
    if (tx) await tx.query("ROLLBACK");
    const dbError = error as { code?: string; constraint?: string };
    if (dbError.code === "P3003") return response({ code: "TIMING_REQUIRED_FOR_DATE_CHANGE", error: "Para cambiar la fecha, reenviá los horarios completos. Tu anotación se conserva." }, 409);
    if (dbError.code === "P3004" || dbError.code === "23514" && dbError.constraint?.startsWith("training_activity")) return response({ code: "INVALID", error: "Revisá los horarios y la fecha de la actividad." }, 400);
    if (dbError.code === "P3002") return response({ code: "DAY_FULL", error: "Ese día ya tiene 100 anotaciones activas. Tu formulario se conserva." }, 409);
    if (dbError.code === "23505" && dbError.constraint === "training_entries_rest_unique") return response({ code: "REST_ALREADY_EXISTS", error: "Ya hay un descanso en esa fecha." }, 409);
    return errorResponse(error);
  } finally { tx?.release(); }
}
