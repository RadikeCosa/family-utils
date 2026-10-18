import { getPool } from "@/db";
import { sportsFeatures } from "./config";
import { sportsActor, activeSportsActor, sportsResponseError, privateHeaders } from "./request";
import { buildUfcDashboard, type DashboardEvent, type DashboardFight } from "./ufc-dashboard-rules";
import type { PoolClient } from "pg";

export async function loadUfcDashboard(request: Request) {
  if (!sportsFeatures().ufc) return Response.json({ error: "No encontrado." }, { status: 404 });
  let tx: PoolClient | undefined;
  try {
    const actor = await sportsActor(request);
    tx = await getPool().connect();
    await tx.query("BEGIN READ ONLY");
    await activeSportsActor(tx, actor);
    const { rows: cards } = await tx.query(
      `SELECT id,title,event_date::text AS event_date
       FROM sports_events
       WHERE family_id=$1 AND kind='ufc_card' AND hidden=false AND source_absent_at IS NULL
         AND status='completed' AND card_status='finalized'
         AND COALESCE(ufc_prediction_closed_at,ufc_prediction_closes_at) <= clock_timestamp()
       ORDER BY event_date DESC,id DESC`,
      [actor.familyId],
    );
    const ids = cards.map((card) => card.id);
    const { rows: familyMembers } = await tx.query(
      "SELECT id,name,archived_at FROM members WHERE family_id=$1 ORDER BY name,id",
      [actor.familyId],
    );
    const { rows } = ids.length ? await tx.query(
      `SELECT f.id AS fight_id,f.event_id,f.first_fighter,f.second_fighter,
        f.first_fighter_id,f.second_fighter_id,f.is_main_event,f.prode_eligible,f.removed_at,
        r.outcome,r.winner_id,o.first_decimal_odds,o.second_decimal_odds,o.bookmaker,o.source AS odds_source,o.reference_at,
        p.member_id,p.winner_id AS pick_winner_id,m.name AS member_name,m.archived_at
       FROM sports_fights f
       JOIN sports_events e ON e.id=f.event_id AND e.family_id=f.family_id
       JOIN sports_fight_results r ON r.fight_id=f.id AND r.family_id=f.family_id
       LEFT JOIN sports_ufc_odds o ON o.fight_id=f.id AND o.family_id=f.family_id AND o.event_id=f.event_id
       LEFT JOIN sports_predictions p ON p.fight_id=f.id AND p.event_id=f.event_id AND p.family_id=f.family_id
       LEFT JOIN members m ON m.id=p.member_id AND m.family_id=p.family_id
       WHERE f.family_id=$1 AND f.event_id=ANY($2::uuid[])
       ORDER BY e.event_date DESC,e.id DESC,f.bout_order,p.member_id`,
      [actor.familyId, ids],
    ) : { rows: [] };
    const eventMap = new Map<string, DashboardEvent>(cards.map((card) => [card.id, { id: card.id, title: card.title, eventDate: card.event_date, fights: [] }]));
    const memberMap = new Map<string, { id: string; name: string; archived: boolean }>(
      familyMembers.map((member) => [member.id,{ id: member.id,name: member.name,archived: !!member.archived_at }]),
    );
    const fightMap = new Map<string, DashboardFight>();
    for (const row of rows) {
      if (!eventMap.has(row.event_id)) continue;
      let fight = fightMap.get(row.fight_id);
      if (!fight) {
        fight = {
          id: row.fight_id,eventId: row.event_id,eventTitle: eventMap.get(row.event_id)!.title,
          eventDate: eventMap.get(row.event_id)!.eventDate,firstFighter: row.first_fighter,
          secondFighter: row.second_fighter,firstFighterId: row.first_fighter_id,
          secondFighterId: row.second_fighter_id,mainEvent: row.is_main_event,
          eligible: row.prode_eligible,removed: !!row.removed_at,result: row.outcome,
          winnerId: row.winner_id,firstOdds: row.first_decimal_odds === null ? null : Number(row.first_decimal_odds),
          secondOdds: row.second_decimal_odds === null ? null : Number(row.second_decimal_odds),
          bookmaker: row.bookmaker,source: row.odds_source,
          referenceAt: row.reference_at?.toISOString?.() ?? null,choices: [],
        };
        fightMap.set(row.fight_id, fight);
        eventMap.get(row.event_id)!.fights.push(fight);
      }
      if (row.member_id && row.member_name) {
        memberMap.set(row.member_id,{ id: row.member_id,name: row.member_name,archived: !!row.archived_at });
        fight.choices.push({ memberId: row.member_id,name: row.member_name,winnerId: row.pick_winner_id });
      }
    }
    const complete = [...eventMap.values()].filter((event) =>
      event.fights.length > 0 && event.fights.every((fight) => !fight.eligible || fight.removed || fight.result !== null),
    );
    const data = buildUfcDashboard(complete,[...memberMap.values()]);
    await tx.query("COMMIT");
    return Response.json(data,{headers:privateHeaders});
  } catch (error) {
    if (tx) await tx.query("ROLLBACK");
    return sportsResponseError(error);
  } finally {
    tx?.release();
  }
}
