/**
 * Die Aufbauphase (GDD §2.4).
 *
 * Der Fehler, den diese Tests festhalten: Die Liga startete früher sofort mit
 * der Ligagründung. Der erste Spieltag kam, bevor irgendjemand elf Spieler
 * hatte, der Job scheiterte an der Kadergrenze — und weil die Spieltage eine
 * Kette bilden, stand die Liga danach für alle still.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { inTransaction, type Pool } from "../src/db/pool.ts";
import { assignFreeAgents, openInitialMarket, SQUAD_MINIMUM } from "../src/domain/lobby.ts";
import { checkInvariants, freshPool, seedLeagueWithMarket } from "./helpers.ts";

let pool: Pool;
before(async () => { pool = await freshPool("sw_test_lobby"); });
after(async () => { await pool.end(); });

const CLOSES = new Date("2026-05-05T16:00:00Z");
const NOW = new Date("2026-05-04T12:00:00Z");

/** Leert die Kader, als hätte niemand geboten */
async function emptyAllSquads(pool: Pool, leagueId: string): Promise<void> {
  await pool.query(
    `UPDATE player_instance SET club_id = NULL WHERE league_id = $1`, [leagueId]);
}

async function squadSizes(pool: Pool, leagueId: string) {
  const { rows } = await pool.query<{
    club_id: string; total: number; keepers: number; defenders: number;
  }>(
    `SELECT c.id AS club_id, COUNT(p.id)::int AS total,
            COUNT(p.id) FILTER (WHERE p.primary_position = 'GK')::int AS keepers,
            COUNT(p.id) FILTER (WHERE p.primary_position IN ('CB','RB','LB'))::int AS defenders
       FROM club c LEFT JOIN player_instance p ON p.club_id = c.id
      WHERE c.league_id = $1 AND NOT c.is_outside_world
      GROUP BY c.id`, [leagueId]);
  return rows;
}

test("Der Eröffnungsmarkt schreibt den gesamten aktiven Pool aus", async () => {
  const fx = await seedLeagueWithMarket(pool, 4);
  await emptyAllSquads(pool, fx.leagueId);

  const opened = await openInitialMarket(pool, fx.leagueId, CLOSES, NOW);

  const free = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM player_instance
      WHERE league_id = $1 AND club_id IS NULL AND pool_state = 'active'`, [fx.leagueId]);
  const auctions = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM auction WHERE league_id = $1 AND status = 'open'`,
    [fx.leagueId]);

  // Anders als der laufende Markt legt die Aufbauphase alles auf einmal hin —
  // die Freunde sollen sehen, worum sie konkurrieren
  assert.equal(opened, free.rows[0]!.n, "nicht der ganze Pool wurde ausgeschrieben");
  assert.equal(auctions.rows[0]!.n, opened);

  // Ohne Schlussjobs liefen die Auktionen ewig weiter
  const jobs = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM job
      WHERE league_id = $1 AND type = 'close_auction' AND status = 'pending'`,
    [fx.leagueId]);
  assert.equal(jobs.rows[0]!.n, opened, "je Auktion muss ein Schlussjob geplant sein");
});

test("Ein zweiter Aufruf schreibt nichts doppelt aus", async () => {
  const fx = await seedLeagueWithMarket(pool, 4);
  await emptyAllSquads(pool, fx.leagueId);

  const first = await openInitialMarket(pool, fx.leagueId, CLOSES, NOW);
  const second = await openInitialMarket(pool, fx.leagueId, CLOSES, NOW);

  assert.ok(first > 0);
  assert.equal(second, 0, "bereits ausgeschriebene Spieler wurden erneut gelistet");
});

test("Wer die Aufbauphase verschläft, bekommt einen spielfähigen Kader", async () => {
  const fx = await seedLeagueWithMarket(pool, 4);
  await emptyAllSquads(pool, fx.leagueId);

  const report = await inTransaction(pool, (client) =>
    assignFreeAgents(client, fx.leagueId));

  assert.equal(report.length, 4, "alle vier leeren Kader hätten gefüllt werden müssen");
  for (const squad of await squadSizes(pool, fx.leagueId)) {
    assert.ok(squad.total >= SQUAD_MINIMUM.total,
      `Kader hat ${squad.total} Spieler, Minimum ist ${SQUAD_MINIMUM.total}`);
    // Vierzehn Feldspieler ohne Torwart wären kein spielfähiger Kader
    assert.ok(squad.keepers >= SQUAD_MINIMUM.goalkeepers, "kein Torwart zugeteilt");
    assert.ok(squad.defenders >= SQUAD_MINIMUM.defenders,
      `nur ${squad.defenders} Verteidiger zugeteilt`);
  }

  assert.deepEqual(await checkInvariants(pool), []);
});

test("Zwangszuteilung kostet Aufschlag und lässt volle Kader in Ruhe", async () => {
  const fx = await seedLeagueWithMarket(pool, 4);
  await emptyAllSquads(pool, fx.leagueId);
  await inTransaction(pool, (client) => assignFreeAgents(client, fx.leagueId));

  // 120 % Gehalt: Die Zuteilung ist eine Strafe, keine Hilfe (GDD §2.4)
  const { rows } = await pool.query<{ over: number }>(
    `SELECT COUNT(*)::int AS over
       FROM player_instance p
       JOIN player_template t ON t.id = p.template_id
       JOIN transfer tr ON tr.player_instance_id = p.id AND tr.channel = 'assignment'
      WHERE p.league_id = $1 AND p.wage_per_matchday > t.base_wage`, [fx.leagueId]);
  assert.ok(rows[0]!.over > 0, "zugeteilte Spieler kosten kein erhöhtes Gehalt");

  // Ein zweiter Durchlauf darf niemandem einen fünfzehnten Spieler schenken
  const again = await inTransaction(pool, (client) =>
    assignFreeAgents(client, fx.leagueId));
  assert.deepEqual(again, [], "volle Kader wurden erneut aufgefüllt");
});
