import { createHmac } from "node:crypto";
import type { PoolClient } from "pg";
import {
  ufcSnapshot,
  ufcRanking,
  fightDeadline,
  freezeClosedBlocks,
  refreshUfcClose,
  type UfcResultRow,
} from "./predictions-server";
import { closedAt } from "./prediction-rules";
import { reject } from "./request";
import type { ResultEntry, ResultsBundle } from "./results-rules";
const label = (
  result: UfcResultRow | undefined,
  firstId: string,
  firstName: string,
  secondName: string,
) =>
  !result
    ? "Pendiente"
    : result.outcome === "winner"
      ? `Ganador: ${result.winner_id === firstId ? firstName : secondName}`
      : {
          draw: "Empate",
          no_contest: "Sin resultado válido",
          cancelled: "Cancelada",
        }[result.outcome];
export async function inspectUfcResults(
  tx: PoolClient,
  familyId: string,
  entry: ResultEntry,
) {
  const {
    rows: [event],
  } = await tx.query(
    "SELECT * FROM sports_events WHERE id=$1 AND family_id=$2 AND kind='ufc_card' FOR UPDATE",
    [entry.eventId, familyId],
  );
  if (!event) reject(400, "No encontramos esa cartelera en la familia.");
  const refreshed = await refreshUfcClose(tx, familyId, event.id);
  const snapshot = await ufcSnapshot(tx, familyId, refreshed);
  const after = [...snapshot.results];
  const fights = [];
  for (const item of entry.fights ?? []) {
    const fight = snapshot.fights.find((f) => f.id === item.fightId);
    if (!fight) reject(400, "La pelea no pertenece a esta cartelera.");
    if (!item.result) continue;
    if (fight.removed_at && item.result.outcome !== "cancelled")
      reject(409, "La pelea fue retirada; solo se admite cancelación.");
    if (
      item.result.outcome !== "cancelled" &&
      !closedAt(fightDeadline(snapshot, fight), snapshot.now)
    )
      reject(409, "La cartelera no cerró o su primer bloque no tiene horario confirmado.");
    if (
      item.result.outcome === "winner" &&
      item.result.winnerId !== fight.first_fighter_id &&
      item.result.winnerId !== fight.second_fighter_id
    )
      reject(400, "El ganador no pertenece a esa pelea.");
    const previous = after.find((r) => r.fight_id === fight.id);
    const next: UfcResultRow = {
      fight_id: fight.id,
      outcome: item.result.outcome,
      winner_id: item.result.winnerId,
    };
    const changed =
      !previous ||
      previous.outcome !== next.outcome ||
      previous.winner_id !== next.winner_id;
    const index = after.findIndex((r) => r.fight_id === fight.id);
    if (index >= 0) after[index] = next;
    else after.push(next);
    fights.push({
      fightId: fight.id,
      title: `${fight.first_fighter} vs ${fight.second_fighter}`,
      before: label(
        previous,
        fight.first_fighter_id,
        fight.first_fighter,
        fight.second_fighter,
      ),
      after: label(
        next,
        fight.first_fighter_id,
        fight.first_fighter,
        fight.second_fighter,
      ),
      changed,
    });
  }
  const beforeRanking = ufcRanking(snapshot),
    afterRanking = ufcRanking(snapshot, after);
  const points = afterRanking
    .filter(
      (row) =>
        row.points !==
        beforeRanking.find((p) => p.memberId === row.memberId)?.points,
    )
    .map((row) => ({
      name: row.name,
      before:
        beforeRanking.find((p) => p.memberId === row.memberId)?.points ?? 0,
      after: row.points,
    }));
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) reject(503, "Falta configurar la validación de importaciones.");
  const state = createHmac("sha256", secret)
    .update(
      JSON.stringify({
        event,
        fights: snapshot.fights,
        results: snapshot.results,
        votes: snapshot.votes,
        closures: snapshot.closures,
        members: snapshot.members,
      }),
    )
    .digest("hex");
  return {
    state,
    preview: {
      eventId: event.id,
      title: event.title,
      before: null,
      after: null,
      changed: fights.some((f) => f.changed),
      fights,
      points,
    },
    snapshot,
  };
}
export async function applyUfcResults(
  tx: PoolClient,
  familyId: string,
  memberId: string,
  entry: ResultEntry,
  bundle: ResultsBundle,
) {
  const current = await inspectUfcResults(tx, familyId, entry);
  await freezeClosedBlocks(tx, familyId, current.snapshot.event);
  for (const item of entry.fights ?? []) {
    if (
      !item.result ||
      !current.preview.fights.find((f) => f.fightId === item.fightId)?.changed
    )
      continue;
    await tx.query(
      "INSERT INTO sports_fight_results(fight_id,family_id,event_id,outcome,winner_id,source,checked_at,updated_by_member_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(fight_id) DO UPDATE SET outcome=excluded.outcome,winner_id=excluded.winner_id,source=excluded.source,checked_at=excluded.checked_at,updated_by_member_id=excluded.updated_by_member_id,updated_at=now()",
      [
        item.fightId,
        familyId,
        entry.eventId,
        item.result.outcome,
        item.result.winnerId,
        bundle.source,
        bundle.checkedAt,
        memberId,
      ],
    );
  }
  const {
    rows: [state],
  } = await tx.query(
    "SELECT count(*) FILTER(WHERE f.removed_at IS NULL AND r.fight_id IS NULL)::int AS pending FROM sports_fights f LEFT JOIN sports_fight_results r ON r.fight_id=f.id AND r.family_id=f.family_id WHERE f.family_id=$1 AND f.event_id=$2",
    [familyId, entry.eventId],
  );
  await tx.query(
    "UPDATE sports_events SET card_status=$3,status=$4,updated_at=now() WHERE id=$1 AND family_id=$2",
    [
      entry.eventId,
      familyId,
      state.pending === 0 ? "finalized" : "upcoming",
      state.pending === 0 ? "completed" : "scheduled",
    ],
  );
  await tx.query(
    "INSERT INTO audit_events(family_id,actor_member_id,entity_type,entity_id,action,\"after\") VALUES($1,$2,'sports_result',$3,'curated_result_imported',$4::jsonb)",
    [
      familyId,
      memberId,
      entry.eventId,
      JSON.stringify({
        fights: current.preview.fights,
        source: bundle.source,
        checkedAt: bundle.checkedAt,
      }),
    ],
  );
}
