/**
 * Ende-zu-Ende: eine vollständige Saison ohne Benutzeroberfläche.
 *
 * Das ist der Meilenstein aus ARCHITECTURE.md §15: Ab hier läuft das Spiel von
 * selbst durch und alles Weitere ist Darstellung statt Risiko.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { SEASON } from "../../shared/src/rules/schedule.ts";
import { handlers, matchdayKey, startSeason } from "../src/domain/season.ts";
import { runMatchday } from "../src/domain/matchday.ts";
import { drain, enqueue, tick } from "../src/scheduler/runner.ts";
import type { Pool } from "../src/db/pool.ts";
import { freshPool, seedLeague } from "./helpers.ts";

let pool: Pool;
before(async () => { pool = await freshPool("sw_test_season"); });
after(async () => { await pool.end(); });

const FAR_FUTURE = new Date("2027-01-01T00:00:00Z");

test("Eine Saison läuft von selbst durch: 21 Spieltage, 4 Vereine", async () => {
  const fx = await seedLeague(pool, 4);

  const started = await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  assert.equal(started.matchesCreated, SEASON.MATCHDAYS * 2, "21 Spieltage à 2 Partien");

  const result = await drain(pool, handlers, FAR_FUTURE);
  assert.equal(result.failed, 0,
    "Kein Job darf scheitern: " + JSON.stringify(result.errors.slice(0, 3)));

  const matches = await pool.query<{ total: number; simulated: number }>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'simulated')::int AS simulated
       FROM match WHERE league_id = $1`, [fx.leagueId]);
  assert.equal(matches.rows[0]!.total, 42);
  assert.equal(matches.rows[0]!.simulated, 42, "Alle Partien müssen gespielt sein");

  const league = await pool.query<{ status: string; current_matchday: number }>(
    "SELECT status, current_matchday FROM league WHERE id = $1", [fx.leagueId]);
  assert.equal(league.rows[0]!.current_matchday, SEASON.MATCHDAYS);
  assert.equal(league.rows[0]!.status, "between_seasons");
});

test("Die Tabelle stimmt mit den Ergebnissen überein", async () => {
  const fx = await seedLeague(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const standings = await pool.query<{
    club_id: string; played: number; won: number; drawn: number; lost: number;
    goals_for: number; goals_against: number; points: number;
  }>("SELECT * FROM standing WHERE league_id = $1", [fx.leagueId]);
  assert.equal(standings.rows.length, 4);

  let totalPlayed = 0, totalFor = 0, totalAgainst = 0;
  for (const row of standings.rows) {
    assert.equal(row.won + row.drawn + row.lost, row.played, "Bilanz passt nicht zur Spielzahl");
    assert.equal(row.points, row.won * 3 + row.drawn, "Punkte stimmen nicht");
    assert.equal(row.played, SEASON.MATCHDAYS, "Bei 4 Vereinen spielt jeder 21 Mal");
    totalPlayed += row.played; totalFor += row.goals_for; totalAgainst += row.goals_against;
  }
  assert.equal(totalPlayed, 42 * 2, "Jede Partie zählt für zwei Vereine");
  assert.equal(totalFor, totalAgainst, "Erzielte und kassierte Tore müssen sich decken");

  const goals = await pool.query<{ sum: number }>(
    "SELECT COALESCE(SUM(home_goals + away_goals), 0)::int AS sum FROM match WHERE league_id = $1",
    [fx.leagueId]);
  assert.equal(totalFor, goals.rows[0]!.sum, "Tabelle und Partien weichen voneinander ab");
});

test("Jede Partie hinterlässt einen vollständigen Ticker", async () => {
  const fx = await seedLeague(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const perMatch = await pool.query<{ match_id: string; events: number; goals: number }>(
    `SELECT m.id AS match_id, COUNT(e.id)::int AS events,
            COUNT(e.id) FILTER (WHERE e.type = 'goal')::int AS goals
       FROM match m LEFT JOIN match_event e ON e.match_id = m.id
      WHERE m.league_id = $1 GROUP BY m.id`, [fx.leagueId]);

  for (const row of perMatch.rows) {
    assert.ok(row.events >= 3, `Partie ${row.match_id} hat nur ${row.events} Ticker-Einträge`);
  }
  const totalTickerGoals = perMatch.rows.reduce((sum, row) => sum + row.goals, 0);
  const scored = await pool.query<{ sum: number }>(
    "SELECT COALESCE(SUM(home_goals + away_goals), 0)::int AS sum FROM match WHERE league_id = $1",
    [fx.leagueId]);
  assert.equal(totalTickerGoals, scored.rows[0]!.sum,
    "Tore im Ticker und im Ergebnis müssen übereinstimmen");
});

test("Fitness sinkt über die Saison spürbar — der Kader ist zu schmal", async () => {
  // Bei 21 Spieltagen in sieben Tagen kann niemand durchspielen (GDD §7.3).
  // Genau das soll die Simulation zeigen.
  const fx = await seedLeague(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const fitness = await pool.query<{ avg: number; min: number; below: number }>(
    `SELECT AVG(fitness)::numeric AS avg, MIN(fitness)::numeric AS min,
            COUNT(*) FILTER (WHERE fitness < 70)::int AS below
       FROM player_instance WHERE league_id = $1`, [fx.leagueId]);
  const row = fitness.rows[0]!;
  assert.ok(row.avg < 100, "Nach 21 Spieltagen darf niemand bei voller Fitness sein");
  assert.ok(row.below > 0,
    "Mindestens ein Spieler muss unter die Leistungsgrenze von 70 gefallen sein");
});

test("Die Buchhaltung stimmt nach der kompletten Saison", async () => {
  const fx = await seedLeague(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const clubs = await pool.query<{ id: string; cash: number; booked: number }>(
    `SELECT c.id, c.cash, COALESCE(SUM(l.amount), 0) AS booked
       FROM club c LEFT JOIN ledger_entry l ON l.club_id = c.id
      WHERE c.league_id = $1 AND NOT c.is_outside_world
      GROUP BY c.id, c.cash`, [fx.leagueId]);

  for (const club of clubs.rows) {
    assert.equal(club.cash, 400_000_000 + club.booked,
      `Verein ${club.id}: Kasse ${club.cash}, erwartet ${400_000_000 + club.booked}`);
  }

  const categories = await pool.query<{ category: string; total: number }>(
    `SELECT category, SUM(amount)::bigint AS total FROM ledger_entry
      WHERE league_id = $1 GROUP BY category`, [fx.leagueId]);
  const byCategory = Object.fromEntries(categories.rows.map((r) => [r.category, r.total]));
  assert.ok(byCategory.wages! < 0, "Gehälter müssen als Ausgabe gebucht sein");
  assert.ok(byCategory.ticket! > 0, "Ticketeinnahmen müssen gebucht sein");

  // Jeder Verein hat genau 21 Gehaltsbuchungen — eine je Spieltag
  const wageCount = await pool.query<{ club_id: string; n: number }>(
    `SELECT club_id, COUNT(*)::int AS n FROM ledger_entry
      WHERE league_id = $1 AND category = 'wages' GROUP BY club_id`, [fx.leagueId]);
  for (const row of wageCount.rows) {
    assert.equal(row.n, SEASON.MATCHDAYS, `Verein ${row.club_id}: ${row.n} Gehaltsbuchungen`);
  }
});

test("Ein zweimal ausgeführter Spieltag ändert nichts", async () => {
  // Idempotenz: Startet der Prozess mitten im Spieltag neu, darf nicht doppelt
  // simuliert werden (Architektur §5).
  const fx = await seedLeague(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });

  const first = await runMatchday(pool, fx.leagueId, 1, 1);
  assert.equal(first.matchesPlayed, 2);

  const snapshot = await pool.query(
    `SELECT club_id, points, goals_for FROM standing WHERE league_id = $1 ORDER BY club_id`,
    [fx.leagueId]);
  const cashBefore = await pool.query(
    "SELECT id, cash FROM club WHERE league_id = $1 ORDER BY id", [fx.leagueId]);

  const second = await runMatchday(pool, fx.leagueId, 1, 1);
  assert.equal(second.matchesPlayed, 0, "Der zweite Lauf darf nichts spielen");

  const after = await pool.query(
    `SELECT club_id, points, goals_for FROM standing WHERE league_id = $1 ORDER BY club_id`,
    [fx.leagueId]);
  assert.deepEqual(after.rows, snapshot.rows, "Die Tabelle darf sich nicht verändern");
  const cashAfter = await pool.query(
    "SELECT id, cash FROM club WHERE league_id = $1 ORDER BY id", [fx.leagueId]);
  assert.deepEqual(cashAfter.rows, cashBefore.rows, "Es darf nicht doppelt gebucht werden");
});

test("Derselbe Idempotenzschlüssel wird nur einmal eingeplant", async () => {
  const fx = await seedLeague(pool, 2);
  const key = matchdayKey(fx.leagueId, 1, 7);
  const first = await enqueue(pool, {
    leagueId: fx.leagueId, type: "run_matchday",
    payload: { season: 1, matchday: 7 }, runAt: new Date(), idempotencyKey: key });
  const second = await enqueue(pool, {
    leagueId: fx.leagueId, type: "run_matchday",
    payload: { season: 1, matchday: 7 }, runAt: new Date(), idempotencyKey: key });

  assert.equal(first, true, "Der erste Job muss angelegt werden");
  assert.equal(second, false, "Der zweite Versuch darf nichts anlegen");

  const { rows } = await pool.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM job WHERE idempotency_key = $1", [key]);
  assert.equal(rows[0]!.n, 1);
});

test("Ein Job ohne Handler scheitert kontrolliert und wird dreimal versucht", async () => {
  await enqueue(pool, {
    type: "gibt_es_nicht", runAt: new Date(0),
    idempotencyKey: `unbekannt-${Math.random()}` });

  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await tick(pool, handlers, new Date(FAR_FUTURE));
    assert.ok(result.failed >= 1, `Versuch ${attempt} hätte fehlschlagen müssen`);
  }
  const { rows } = await pool.query<{ status: string; attempts: number; last_error: string }>(
    "SELECT status, attempts, last_error FROM job WHERE type = 'gibt_es_nicht'");
  assert.equal(rows[0]!.status, "failed", "Nach drei Versuchen muss der Job aufgeben");
  assert.equal(rows[0]!.attempts, 3);
  assert.match(rows[0]!.last_error, /Kein Handler/);
});

test("Ein Spielplan wird nicht zweimal angelegt", async () => {
  const fx = await seedLeague(pool, 2);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await assert.rejects(
    () => startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 }),
    /bereits einen Spielplan/);
});
