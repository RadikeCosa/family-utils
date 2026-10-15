import type { PoolClient } from "pg";
import { getPool } from "@/db";
import { sportsFeatures } from "./config";
import { SPORTS_UUID } from "./rules";
import {
  sportsActor,
  activeSportsActor,
  sportsBody,
  reject,
  sportsResponseError,
  privateHeaders,
} from "./request";
import {
  closedAt,
  ranked,
  type UfcView,
  type Outcome,
} from "./prediction-rules";
export type UfcEventRow = {
  id: string;
  title: string;
  kind: string;
  status: string;
  hidden: boolean;
  source_absent_at: Date | null;
  event_date: string;
  main_card_starts_at: Date | null;
  preliminary_starts_at: Date | null;
  early_preliminaries_starts_at: Date | null;
  updated_at: Date;
  card_status: string | null;
};
export type UfcFightRow = {
  is_main_event: boolean;
  prediction_closed_at: Date | null;
  id: string;
  first_fighter: string;
  second_fighter: string;
  first_fighter_id: string;
  second_fighter_id: string;
  bout_block: string;
  removed_at: Date | null;
  updated_at: Date;
};
export type UfcResultRow = {
  fight_id: string;
  outcome: Outcome;
  winner_id: string | null;
  updated_at?: Date;
};
export type UfcVoteRow = {
  member_id: string;
  fight_id: string;
  winner_id: string;
};
export type UfcSnapshot = {
  event: UfcEventRow;
  fights: UfcFightRow[];
  results: UfcResultRow[];
  votes: UfcVoteRow[];
  members: Array<{ id: string; name: string }>;
  closures: Array<{ block: string; closed_at: Date }>;
  now: Date;
};
export function blockDeadline(event: UfcEventRow, block: string) {
  return block === "main"
    ? event.main_card_starts_at
    : block === "preliminaries"
      ? event.preliminary_starts_at
      : block === "early_preliminaries"
        ? event.early_preliminaries_starts_at
        : null;
}
export function deadline(snapshot: UfcSnapshot, block: string) {
  return (
    snapshot.closures.find((row) => row.block === block)?.closed_at ??
    blockDeadline(snapshot.event, block)
  );
}
export function fightDeadline(snapshot: UfcSnapshot, fight: UfcFightRow) {
  return fight.prediction_closed_at ?? deadline(snapshot, fight.bout_block);
}
export async function ufcSnapshot(
  tx: PoolClient,
  familyId: string,
  event: UfcEventRow,
): Promise<UfcSnapshot> {
  // A transaction uses one connection; keep its queries sequential.
  const fights = await tx.query(
    "SELECT * FROM sports_fights WHERE family_id=$1 AND event_id=$2 ORDER BY bout_order,id",
    [familyId, event.id],
  );
  const results = await tx.query(
    "SELECT * FROM sports_fight_results WHERE family_id=$1 AND event_id=$2 ORDER BY fight_id",
    [familyId, event.id],
  );
  const votes = await tx.query(
    "SELECT member_id,fight_id,winner_id FROM sports_predictions WHERE family_id=$1 AND event_id=$2 ORDER BY member_id,fight_id",
    [familyId, event.id],
  );
  const members = await tx.query(
    "SELECT id,name FROM members WHERE family_id=$1 ORDER BY name,id",
    [familyId],
  );
  const closures = await tx.query(
    "SELECT block,closed_at FROM sports_block_closures WHERE family_id=$1 AND event_id=$2 ORDER BY block",
    [familyId, event.id],
  );
  const clock = await tx.query("SELECT clock_timestamp() AS now");
  return {
    event,
    fights: fights.rows,
    results: results.rows,
    votes: votes.rows,
    members: members.rows,
    closures: closures.rows,
    now: clock.rows[0].now,
  };
}
export function ufcRanking(snapshot: UfcSnapshot, results = snapshot.results) {
  const points = new Map<string, number>();
  for (const vote of snapshot.votes) {
    const fight = snapshot.fights.find((f) => f.id === vote.fight_id);
    const result = results.find((r) => r.fight_id === vote.fight_id);
    if (
      !snapshot.event.source_absent_at &&
      snapshot.event.status !== "cancelled" &&
      fight &&
      !fight.removed_at &&
      closedAt(fightDeadline(snapshot, fight), snapshot.now) &&
      result?.outcome === "winner" &&
      result.winner_id === vote.winner_id
    )
      points.set(vote.member_id, (points.get(vote.member_id) ?? 0) + 1);
  }
  return ranked(
    snapshot.members.map((member) => ({
      memberId: member.id,
      name: member.name,
      points: points.get(member.id) ?? 0,
    })),
  );
}
export function ufcView(snapshot: UfcSnapshot, memberId: string): UfcView {
  const fights = snapshot.fights.map((fight) => {
    const close = fightDeadline(snapshot, fight);
    const closed = closedAt(close, snapshot.now);
    const result = snapshot.results.find((r) => r.fight_id === fight.id);
    return {
      isMainEvent: fight.is_main_event,
      id: fight.id,
      firstFighter: fight.first_fighter,
      secondFighter: fight.second_fighter,
      firstFighterId: fight.first_fighter_id,
      secondFighterId: fight.second_fighter_id,
      block: fight.bout_block,
      removed:
        !!fight.removed_at ||
        !!snapshot.event.source_absent_at ||
        snapshot.event.status === "cancelled",
      cancelled: result?.outcome === "cancelled",
      closed,
      closesAt: close?.toISOString() ?? null,
      ownWinnerId:
        snapshot.votes.find(
          (v) => v.fight_id === fight.id && v.member_id === memberId,
        )?.winner_id ?? null,
      result: result
        ? { outcome: result.outcome, winnerId: result.winner_id }
        : null,
      choices: closed
        ? snapshot.votes
            .filter((v) => v.fight_id === fight.id)
            .map((v) => ({
              memberId: v.member_id,
              name:
                snapshot.members.find((m) => m.id === v.member_id)?.name ??
                "Integrante",
              winnerId: v.winner_id,
            }))
        : [],
    };
  });
  return {
    fights,
    ranking: ufcRanking(snapshot),
    final: fights.length > 0 && fights.every((f) => f.removed || !!f.result),
    chosen: fights.filter((f) => !f.removed && !f.cancelled && f.ownWinnerId)
      .length,
    total: fights.filter((f) => !f.removed && !f.cancelled).length,
  };
}
export async function sportsPredictions(request: Request, eventId: string) {
  if (!sportsFeatures().ufc)
    return Response.json({ error: "No encontrado." }, { status: 404 });
  let tx: PoolClient | undefined;
  try {
    if (!SPORTS_UUID.test(eventId)) reject(400, "Evento inválido.");
    const actor = await sportsActor(request);
    const body = request.method === "GET" ? null : await sportsBody(request);
    tx = await getPool().connect();
    await tx.query("BEGIN");
    await activeSportsActor(tx, actor);
    const {
      rows: [event],
    } = await tx.query(
      `SELECT * FROM sports_events WHERE id=$1 AND family_id=$2 AND kind='ufc_card' AND hidden=false ${request.method === "GET" ? "FOR SHARE" : "FOR UPDATE"}`,
      [eventId, actor.familyId],
    );
    if (!event) reject(404, "No encontramos la cartelera.");
    const snapshot = await ufcSnapshot(tx, actor.familyId, event);
    if (body) {
      if (event.source_absent_at || event.status === "cancelled")
        reject(
          409,
          "La cartelera fue retirada. Tus elecciones quedan anuladas.",
        );
      if (typeof body.fightId !== "string" || !SPORTS_UUID.test(body.fightId))
        reject(400, "Pelea inválida.");
      const fight = snapshot.fights.find((f) => f.id === body.fightId);
      if (
        !fight ||
        fight.removed_at ||
        snapshot.results.some((r) => r.fight_id === fight.id)
      )
        reject(409, "Esta pelea ya no admite elecciones.");
      const close = fightDeadline(snapshot, fight);
      if (!close) reject(409, "El bloque todavía no tiene horario confirmado.");
      if (closedAt(close, snapshot.now))
        reject(409, "El bloque cerró. Tu elección no se guardó.");
      if (request.method === "DELETE") {
        const {
          rows: [clock],
        } = await tx.query("SELECT clock_timestamp() AS now");
        if (closedAt(close, clock.now))
          reject(409, "El bloque cerró. Tu elección no se retiró.");
        const removed = await tx.query(
          "DELETE FROM sports_predictions WHERE family_id=$1 AND fight_id=$2 AND member_id=$3 AND $4::timestamptz>clock_timestamp()",
          [actor.familyId, fight.id, actor.memberId, close],
        );
        if (
          !removed.rowCount &&
          snapshot.votes.some(
            (v) => v.member_id === actor.memberId && v.fight_id === fight.id,
          )
        )
          reject(409, "El bloque cerró. Tu elección no se retiró.");
      } else {
        if (
          body.winnerId !== fight.first_fighter_id &&
          body.winnerId !== fight.second_fighter_id
        )
          reject(400, "Elegí un peleador de este enfrentamiento.");
        const saved = await tx.query(
          "INSERT INTO sports_predictions(family_id,event_id,fight_id,member_id,winner_id) SELECT $1,$2,$3,$4,$5 WHERE $6::timestamptz>clock_timestamp() ON CONFLICT(family_id,member_id,fight_id) DO UPDATE SET winner_id=excluded.winner_id,updated_at=now() WHERE $6::timestamptz>clock_timestamp() RETURNING id",
          [
            actor.familyId,
            eventId,
            fight.id,
            actor.memberId,
            body.winnerId,
            close,
          ],
        );
        if (!saved.rowCount)
          reject(409, "El bloque cerró. Tu elección no se guardó.");
      }
    }
    const view = ufcView(
      body ? await ufcSnapshot(tx, actor.familyId, event) : snapshot,
      actor.memberId,
    );
    await tx.query("COMMIT");
    return Response.json(view, { headers: privateHeaders });
  } catch (error) {
    if (tx) await tx.query("ROLLBACK");
    return sportsResponseError(error);
  } finally {
    tx?.release();
  }
}
export async function freezeClosedBlocks(
  tx: PoolClient,
  familyId: string,
  event: UfcEventRow,
) {
  for (const block of ["main", "preliminaries", "early_preliminaries"]) {
    const {
      rows: [stored],
    } = await tx.query(
      "SELECT closed_at FROM sports_block_closures WHERE family_id=$1 AND event_id=$2 AND block=$3",
      [familyId, event.id, block],
    );
    const at = stored?.closed_at ?? blockDeadline(event, block);
    if (!at) continue;
    await tx.query(
      "INSERT INTO sports_block_closures(event_id,family_id,block,closed_at) SELECT $1,$2,$3,$4 WHERE $4::timestamptz<=clock_timestamp() ON CONFLICT(event_id,block) DO NOTHING",
      [event.id, familyId, block, at],
    );
    await tx.query(
      "UPDATE sports_fights SET prediction_closed_at=$4 WHERE event_id=$1 AND family_id=$2 AND bout_block=$3 AND prediction_closed_at IS NULL AND $4::timestamptz<=clock_timestamp()",
      [event.id, familyId, block, at],
    );
  }
}
