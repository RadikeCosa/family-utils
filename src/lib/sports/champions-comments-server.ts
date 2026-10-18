import { getPool } from "@/db";
import { championsEnabled } from "./config";
import { commentInput, SPORTS_UUID } from "./rules";
import { activeSportsActor, privateHeaders, reject, sportsActor, sportsBody, sportsResponseError } from "./request";

// Dedicated storage and routes keep the legacy day/match conversations isolated.
export async function championsComments(request: Request, roundId: string, commentId?: string) {
  if (!championsEnabled()) return Response.json({ error: "No encontrado." }, { status: 404, headers: privateHeaders });
  const c = await getPool().connect();
  try {
    const actor = await sportsActor(request);
    await c.query("BEGIN");
    await activeSportsActor(c, actor);
    if (!SPORTS_UUID.test(roundId) || (commentId && !SPORTS_UUID.test(commentId))) reject(400, "Conversación inválida.");
    const body = request.method === "GET" ? null : await sportsBody(request);
    if (body && (Object.hasOwn(body, "familyId") || Object.hasOwn(body, "memberId") || Object.hasOwn(body, "roundId") || body.contextDate || body.contextEventId)) reject(400, "La conversación pertenece a la jornada indicada.");
    const member = (await c.query<{role:string}>("SELECT role FROM members WHERE id=$1 AND family_id=$2",[actor.memberId,actor.familyId])).rows[0];
    const round = (await c.query("SELECT r.id FROM sports_football_rounds r JOIN sports_football_seasons s ON s.id=r.season_id AND s.family_id=r.family_id WHERE r.id=$1 AND r.family_id=$2 AND s.competition='champions' FOR SHARE OF r", [roundId, actor.familyId])).rows[0];
    if (!round) reject(404, "No encontramos esta jornada.");
    if (request.method === "GET") {
      const comments = (await c.query(`SELECT c.id,c.author_member_id AS "authorMemberId",m.name AS "authorName",c.body,c.version,c.created_at AS "createdAt",c.updated_at AS "updatedAt"
        FROM sports_football_round_comments c JOIN members m ON m.id=c.author_member_id AND m.family_id=c.family_id
        WHERE c.family_id=$1 AND c.round_id=$2 AND c.retired_at IS NULL ORDER BY c.created_at,c.id`, [actor.familyId, roundId])).rows;
      await c.query("COMMIT"); return Response.json({ comments, priorDates: [] }, { headers: privateHeaders });
    }
    let id: string, version: number, action: string;
    if (!commentId && request.method === "POST") {
      const text = commentInput(body?.body);
      if (!text) reject(400, "Escribí un comentario de hasta 2.000 caracteres.");
      ({ id, version } = (await c.query("INSERT INTO sports_football_round_comments(family_id,round_id,author_member_id,body) VALUES($1,$2,$3,$4) RETURNING id,version", [actor.familyId, roundId, actor.memberId, text])).rows[0]);
      action = "created";
    } else if (commentId && request.method === "PATCH") {
      const previous = (await c.query("SELECT id,author_member_id,version FROM sports_football_round_comments WHERE id=$1 AND family_id=$2 AND round_id=$3 AND retired_at IS NULL FOR UPDATE", [commentId, actor.familyId, roundId])).rows[0];
      if (!previous) reject(404, "No encontramos este comentario.");
      const mine = previous.author_member_id === actor.memberId;
      if (body?.action !== "edit" && body?.action !== "retire") reject(400, "Acción inválida.");
      if ((!mine && body.action === "edit") || (!mine && member.role !== "administrator")) reject(403, "Solo podés editar tus comentarios; administración puede retirarlos.");
      if (body.expectedVersion !== previous.version) reject(409, "El comentario cambió. Actualizá antes de volver a intentarlo.");
      if (body.action === "retire") {
        await c.query("UPDATE sports_football_round_comments SET retired_at=clock_timestamp(),retired_by_member_id=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1", [commentId, actor.memberId]); action = "retired";
      } else {
        const text = commentInput(body.body);
        if (!text) reject(400, "Escribí un comentario de hasta 2.000 caracteres.");
        await c.query("UPDATE sports_football_round_comments SET body=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1", [commentId, text]); action = "edited";
      }
      id = commentId; version = previous.version + 1;
    } else reject(405, "Acción no disponible.");
    await c.query(`INSERT INTO audit_events(family_id,actor_member_id,entity_type,entity_id,action,"after") VALUES($1,$2,'sports_champions_comment',$3,$4,$5::jsonb)`, [actor.familyId, actor.memberId, id, action, JSON.stringify({ roundId })]);
    await c.query("COMMIT");
    return Response.json({ id, version, ...(action === "retired" ? { retired: true } : {}) }, { status: action === "created" ? 201 : 200, headers: privateHeaders });
  } catch (error) {
    await c.query("ROLLBACK"); const response = sportsResponseError(error); for (const [k,v] of Object.entries(privateHeaders)) response.headers.set(k,v); return response;
  } finally { c.release(); }
}
