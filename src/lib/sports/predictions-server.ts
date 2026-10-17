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
  ufcFightPoints,
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
  ufc_prediction_closes_at: Date | null;
  ufc_prediction_closed_at: Date | null;
  ufc_prediction_transition_at: Date | null;
};
export type UfcFightRow = {
  is_main_event: boolean;
  bout_order: number;
  prode_eligible: boolean;
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
export function deadline(snapshot: UfcSnapshot) {
  return snapshot.event.ufc_prediction_closed_at ?? snapshot.event.ufc_prediction_closes_at;
}
export function fightDeadline(snapshot: UfcSnapshot, _fight?: UfcFightRow) {
  return deadline(snapshot);
}
export async function refreshUfcClose(tx: PoolClient, familyId: string, eventId: string) {
  await tx.query("SELECT public.sports_ufc_refresh_close($1,$2)", [familyId, eventId]);
  const { rows: [event] } = await tx.query<UfcEventRow>(
    "SELECT * FROM sports_events WHERE id=$1 AND family_id=$2 AND kind='ufc_card'", [eventId, familyId],
  );
  return event;
}
export async function ufcSnapshot(
  tx: PoolClient,
  familyId: string,
  event: UfcEventRow,
  memberId?: string,
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
    `SELECT member_id,fight_id,winner_id FROM sports_predictions
     WHERE family_id=$1 AND event_id=$2 AND
       ($3::uuid IS NULL OR member_id=$3 OR $4::timestamptz<=clock_timestamp())
     ORDER BY member_id,fight_id`,
    [familyId, event.id, memberId ?? null, event.ufc_prediction_closed_at ?? event.ufc_prediction_closes_at],
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
  const fightPoints = ufcFightPoints(snapshot.fights);
  for (const vote of snapshot.votes) {
    const fight = snapshot.fights.find((f) => f.id === vote.fight_id);
    const result = results.find((r) => r.fight_id === vote.fight_id);
    if (
      !snapshot.event.source_absent_at &&
      snapshot.event.status !== "cancelled" &&
      fight &&
      !fight.removed_at &&
      fight.prode_eligible &&
      closedAt(fightDeadline(snapshot, fight), snapshot.now) &&
      result?.outcome === "winner" &&
      result.winner_id === vote.winner_id
    )
      points.set(vote.member_id, (points.get(vote.member_id) ?? 0) + (fightPoints.get(fight.id) ?? 0));
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
  const fightPoints = ufcFightPoints(snapshot.fights);
  const fights = snapshot.fights.map((fight) => {
    const close = fightDeadline(snapshot, fight);
    const closed = closedAt(close, snapshot.now);
    const result = snapshot.results.find((r) => r.fight_id === fight.id);
    return {
      isMainEvent: fight.is_main_event,
      isCoMainEvent: fightPoints.get(fight.id) === 3,
      points: fightPoints.get(fight.id) ?? 0,
      id: fight.id,
      firstFighter: fight.first_fighter,
      secondFighter: fight.second_fighter,
      firstFighterId: fight.first_fighter_id,
      secondFighterId: fight.second_fighter_id,
      block: fight.bout_block,
      startsAt: blockDeadline(snapshot.event, fight.bout_block)?.toISOString() ?? null,
      prodeEligible: fight.prode_eligible,
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
    closesAt: deadline(snapshot)?.toISOString() ?? null,
    closed: closedAt(deadline(snapshot), snapshot.now),
    transition: !!snapshot.event.ufc_prediction_transition_at && closedAt(deadline(snapshot), snapshot.event.ufc_prediction_transition_at),
    ranking: ufcRanking(snapshot),
    final: fights.length > 0 && fights.every((f) => f.removed || !f.prodeEligible || !!f.result),
    chosen: fights.filter((f) => !f.removed && f.prodeEligible && !f.cancelled && f.ownWinnerId)
      .length,
    total: fights.filter((f) => !f.removed && f.prodeEligible && !f.cancelled).length,
  };
}
export async function sportsPredictions(request: Request, eventId: string) {
  if (!sportsFeatures().ufc)
    return Response.json({ error: "No encontrado." }, { status: 404 });
  let tx: PoolClient | undefined;
  let predictionFamilyId: string | undefined;
  let hasSavepoint = false;
  try {
    if (!SPORTS_UUID.test(eventId)) reject(400, "Evento inválido.");
    const actor = await sportsActor(request);
    predictionFamilyId = actor.familyId;
    const body = request.method === "GET" ? null : await sportsBody(request);
    tx = await getPool().connect();
    await tx.query("BEGIN");
    await activeSportsActor(tx, actor);
    const {
      rows: [event],
    } = await tx.query(
      `SELECT * FROM sports_events WHERE id=$1 AND family_id=$2 AND kind='ufc_card' AND hidden=false FOR UPDATE`,
      [eventId, actor.familyId],
    );
    if (!event) reject(404, "No encontramos la cartelera.");
    // All readers and writers share the event lock, including pre-deployment writers
    // protected by the database trigger. Refresh BEFORE the savepoint so rejection
    // can roll back a vote without rolling back the permanent closure.
    const current = await refreshUfcClose(tx, actor.familyId, eventId);
    const snapshot = await ufcSnapshot(tx, actor.familyId, current, actor.memberId);
    await tx.query("SAVEPOINT prediction_write");
    hasSavepoint = true;
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
        !fight.prode_eligible ||
        snapshot.results.some((r) => r.fight_id === fight.id)
      )
        reject(409, "Esta pelea ya no admite elecciones.");
      const close = fightDeadline(snapshot, fight);
      if (!close) reject(409, "El primer bloque todavía no tiene horario confirmado.");
      if (closedAt(close, snapshot.now))
        reject(409, "La cartelera ya cerró. Tu cambio no se guardó.");
      if (request.method === "DELETE") {
        const {
          rows: [clock],
        } = await tx.query("SELECT clock_timestamp() AS now");
        if (closedAt(close, clock.now))
          reject(409, "La cartelera ya cerró. Tu cambio no se guardó.");
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
          reject(409, "La cartelera ya cerró. Tu cambio no se guardó.");
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
          reject(409, "La cartelera ya cerró. Tu cambio no se guardó.");
      }
    }
    const view = ufcView(
      body ? await ufcSnapshot(tx, actor.familyId, current, actor.memberId) : snapshot,
      actor.memberId,
    );
    await tx.query("COMMIT");
    return Response.json(view, { headers: privateHeaders });
  } catch (error) {
    if (tx) {
      if (hasSavepoint && predictionFamilyId && error instanceof Error && "status" in error && error.status === 409) {
        await tx.query("ROLLBACK TO SAVEPOINT prediction_write");
        // An exact-boundary write may have been suppressed by the DB trigger.
        // Re-evaluate after rollback, then commit only the closure.
        await refreshUfcClose(tx, predictionFamilyId!, eventId);
        await tx.query("COMMIT");
      } else await tx.query("ROLLBACK");
    }
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
  await refreshUfcClose(tx, familyId, event.id);
}
