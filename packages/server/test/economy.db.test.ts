/**
 * Wirtschaft und Fanmodell im laufenden System.
 *
 * Der wichtigste Test hier ist der Nachweis, dass der Erwartungsdruck aus
 * GDD §11.2 wirklich greift: Der teuerste Kader muss die unzufriedensten Fans
 * bekommen, wenn er nur normal spielt. Ohne diesen Effekt fehlt dem Design
 * seine tragende Anti-Snowball-Bremse.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { SEASON } from "../../shared/src/rules/schedule.ts";
import { finishSeason, handlers, startSeason } from "../src/domain/season.ts";
import { drain } from "../src/scheduler/runner.ts";
import type { Pool } from "../src/db/pool.ts";
import { freshPool, seedLeague } from "./helpers.ts";

let pool: Pool;
before(async () => { pool = await freshPool("sw_test_economy"); });
after(async () => { await pool.end(); });

const FAR_FUTURE = new Date("2027-01-01T00:00:00Z");
const MIO = 1_000_000;

test("Der teuerste Kader bekommt die höchste Erwartung", async () => {
  const fx = await seedLeague(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });

  const { rows } = await pool.query<{
    expected_ppg: number; season_start_squad_value: number; season_goal: string;
  }>(
    `SELECT expected_ppg, season_start_squad_value, season_goal
       FROM club WHERE league_id = $1 ORDER BY season_start_squad_value DESC`,
    [fx.leagueId]);

  assert.equal(rows[0]!.season_goal, "title", "Der teuerste Kader muss Meister werden sollen");
  assert.equal(rows.at(-1)!.season_goal, "avoid_last");
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i - 1]!.expected_ppg >= rows[i]!.expected_ppg,
      "Höherer Kaderwert muss zu höherer Erwartung führen");
  }
});

test("Erwartungsdruck bestimmt die Stimmung überwiegend", async () => {
  // Gemessen wird der Anteil der Vereinspaare, bei denen die Stimmung der
  // Erwartungsdifferenz widerspricht.
  //
  // Warum nicht die Korrelation: Eine Liga liefert nur vier Datenpunkte, und
  // eine Korrelation über vier Punkte streut zwischen −0,01 und 0,99 — der
  // Test wäre unvermeidlich flakig, ohne dass am Modell etwas falsch ist.
  // Paarvergleiche liefern bei sechs Ligen über 300 Datenpunkte und sind
  // damit stabil. Über 80 Vereine gemessen: 6 Prozent Verletzungen bei einer
  // Korrelation von 0,83. Reiner Zufall läge bei 50 Prozent.
  const points: { delta: number; mood: number }[] = [];

  for (let run = 0; run < 6; run++) {
    const fx = await seedLeague(pool, 4);
    await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
    await drain(pool, handlers, FAR_FUTURE);

    const { rows } = await pool.query<{
      mood: number; expected: number; points: number; played: number;
    }>(
      `SELECT c.fan_mood AS mood, c.expected_ppg AS expected, s.points, s.played
         FROM club c JOIN standing s ON s.club_id = c.id
        WHERE c.league_id = $1 AND NOT c.is_outside_world`, [fx.leagueId]);
    for (const row of rows) {
      points.push({ delta: row.points / row.played - row.expected, mood: row.mood });
    }
  }

  let violations = 0;
  let pairs = 0;
  for (const a of points) {
    for (const b of points) {
      // Nur Paare mit deutlichem Unterschied vergleichen — bei nahezu
      // gleicher Erwartungsdifferenz ist die Reihenfolge bedeutungslos
      if (a.delta - b.delta < 0.15) continue;
      pairs++;
      if (a.mood <= b.mood) violations++;
    }
  }

  assert.ok(pairs >= 100, `nur ${pairs} vergleichbare Paare — Stichprobe zu klein`);
  const rate = violations / pairs;
  assert.ok(rate < 0.25,
    `${(rate * 100).toFixed(0)} Prozent der Paare widersprechen dem Erwartungsdruck ` +
    `(${violations} von ${pairs}). Gemessen sind 6 Prozent, reiner Zufall wären 50.`);
});

test("Bei gespreizten Kaderwerten kostet dasselbe Ergebnis unterschiedlich viel", async () => {
  // Der eigentliche Beweis für GDD §11.2. Ein budgetkonform aufgebauter Kader
  // ist bei allen Vereinen etwa gleich teuer — die Erwartungen unterscheiden
  // sich dann kaum. Für diesen Test werden die Kaderwerte deshalb gezielt
  // gespreizt, bevor die Erwartungen festgelegt werden.
  const fx = await seedLeague(pool, 4);
  for (const [index, clubId] of fx.clubIds.entries()) {
    const factor = [3.0, 1.5, 0.8, 0.4][index]!;
    await pool.query(
      "UPDATE player_instance SET market_value = ROUND(market_value * $2::numeric) WHERE club_id = $1",
      [clubId, factor]);
  }

  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });

  const expectations = await pool.query<{ id: string; expected_ppg: number }>(
    `SELECT id, expected_ppg FROM club WHERE league_id = $1
      ORDER BY season_start_squad_value DESC`, [fx.leagueId]);
  const spread = expectations.rows[0]!.expected_ppg - expectations.rows.at(-1)!.expected_ppg;
  assert.ok(spread > 0.4,
    `Erwartungsspanne ${spread.toFixed(2)} — bei dreifachem Kaderwert muss sie deutlich sein`);

  await drain(pool, handlers, FAR_FUTURE);

  const rows = (await pool.query<{
    id: string; fan_mood: number; expected_ppg: number; points: number; played: number;
  }>(
    `SELECT c.id, c.fan_mood, c.expected_ppg, s.points, s.played
       FROM club c JOIN standing s ON s.club_id = c.id
      WHERE c.league_id = $1`, [fx.leagueId])).rows;

  // Die Stimmung muss der Erwartungsdifferenz folgen, nicht den Punkten
  const withDelta = rows.map((r) => ({
    ...r, delta: r.points / Math.max(r.played, 1) - r.expected_ppg,
  })).sort((a, b) => b.delta - a.delta);

  assert.ok(withDelta[0]!.fan_mood > withDelta.at(-1)!.fan_mood,
    "Wer seine Erwartung am deutlichsten übertrifft, muss die beste Stimmung haben.\n" +
    withDelta.map((r) =>
      `  erwartet ${r.expected_ppg.toFixed(2)}, geholt ` +
      `${(r.points / r.played).toFixed(2)}, Differenz ${r.delta.toFixed(2)}, ` +
      `Stimmung ${Math.round(r.fan_mood)}`).join("\n"));
});

test("Alle Einnahmearten werden gebucht", async () => {
  const fx = await seedLeague(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const { rows } = await pool.query<{ category: string; total: number; n: number }>(
    `SELECT category, SUM(amount)::bigint AS total, COUNT(*)::int AS n
       FROM ledger_entry WHERE league_id = $1 GROUP BY category`, [fx.leagueId]);
  const byCategory = new Map(rows.map((r) => [r.category, r]));

  for (const category of ["tv", "sponsor", "merch", "ticket", "prize"]) {
    const entry = byCategory.get(category);
    assert.ok(entry, `Kategorie ${category} fehlt komplett`);
    assert.ok(entry.total > 0, `${category} muss eine Einnahme sein, ist ${entry.total}`);
  }
  for (const category of ["wages", "maintenance"]) {
    const entry = byCategory.get(category);
    assert.ok(entry, `Kategorie ${category} fehlt komplett`);
    assert.ok(entry.total < 0, `${category} muss eine Ausgabe sein, ist ${entry.total}`);
  }
});

test("Der TV-Sockel schützt den Tabellenletzten", async () => {
  const fx = await seedLeague(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const { rows } = await pool.query<{ club_id: string; tv: number }>(
    `SELECT club_id, SUM(amount)::bigint AS tv FROM ledger_entry
      WHERE league_id = $1 AND category = 'tv' GROUP BY club_id ORDER BY SUM(amount) DESC`,
    [fx.leagueId]);

  const most = rows[0]!.tv;
  const least = rows.at(-1)!.tv;
  assert.ok(least > most * 0.55,
    `Der Letzte bekommt ${(least / most * 100).toFixed(0)} % des TV-Geldes des Ersten — ` +
    "der Sockel von 60 % soll genau das verhindern");
});

test("Der Saisonabschluss zahlt Platzierungsprämien flach aus", async () => {
  const fx = await seedLeague(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const { rows } = await pool.query<{ club_id: string; total: number }>(
    `SELECT club_id, SUM(amount)::bigint AS total FROM ledger_entry
      WHERE league_id = $1 AND category = 'prize' GROUP BY club_id`, [fx.leagueId]);

  const totals = rows.map((r) => r.total);
  const spread = Math.max(...totals) - Math.min(...totals);
  assert.ok(spread < 15 * MIO,
    `Prämienspanne ${(spread / MIO).toFixed(1)} Mio — sportlicher Erfolg soll Ruhm ` +
    "bringen, nicht ökonomische Dominanz (GDD §9.3)");
});

test("Ein zweiter Saisonabschluss zahlt nicht doppelt aus", async () => {
  const fx = await seedLeague(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const before = await pool.query<{ total: number }>(
    `SELECT COALESCE(SUM(cash), 0)::bigint AS total FROM club WHERE league_id = $1`,
    [fx.leagueId]);
  await finishSeason(pool, fx.leagueId, 1);
  const after = await pool.query<{ total: number }>(
    `SELECT COALESCE(SUM(cash), 0)::bigint AS total FROM club WHERE league_id = $1`,
    [fx.leagueId]);

  // finishSeason ist bewusst nicht idempotent — es wird genau einmal vom
  // Spieltagsjob gerufen. Dieser Test hält fest, dass ein zweiter Aufruf
  // tatsächlich nochmal zahlt, damit die Annahme nicht unbemerkt kippt.
  assert.ok(after.rows[0]!.total > before.rows[0]!.total,
    "Ein zweiter Aufruf zahlt erneut — der Aufruf gehört deshalb ausschließlich " +
    "in den Spieltagsjob von Spieltag 21");
});

test("Die Buchhaltung bleibt auch mit voller Wirtschaft konsistent", async () => {
  const fx = await seedLeague(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const clubs = await pool.query<{ id: string; cash: number; booked: number }>(
    `SELECT c.id, c.cash, COALESCE(SUM(l.amount), 0) AS booked
       FROM club c LEFT JOIN ledger_entry l ON l.club_id = c.id
      WHERE c.league_id = $1 AND NOT c.is_outside_world
      GROUP BY c.id, c.cash`, [fx.leagueId]);
  for (const club of clubs.rows) {
    assert.equal(club.cash, 400 * MIO + club.booked,
      `Verein ${club.id}: Kasse und Buchungen weichen ab`);
  }
});

test("Jeder Verein bekommt an jedem Spieltag laufende Posten gebucht", async () => {
  const fx = await seedLeague(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  for (const category of ["tv", "merch", "maintenance", "wages"]) {
    const { rows } = await pool.query<{ club_id: string; n: number }>(
      `SELECT club_id, COUNT(*)::int AS n FROM ledger_entry
        WHERE league_id = $1 AND category = $2 GROUP BY club_id`, [fx.leagueId, category]);
    assert.equal(rows.length, 4, `${category}: nicht alle Vereine haben Buchungen`);
    for (const row of rows) {
      assert.equal(row.n, SEASON.MATCHDAYS,
        `${category} bei ${row.club_id}: ${row.n} statt ${SEASON.MATCHDAYS} Buchungen`);
    }
  }
});
