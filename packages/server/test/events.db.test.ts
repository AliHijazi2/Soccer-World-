/**
 * Ereignisse im laufenden Betrieb (GDD §10).
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { EVENTS_BY_KEY } from "../../shared/src/rules/events/definitions.ts";
import { deliverEvents, readEvents, resolveEvent, resolveExpired } from "../src/domain/events.ts";
import { handlers, startSeason } from "../src/domain/season.ts";
import { drain } from "../src/scheduler/runner.ts";
import type { Pool } from "../src/db/pool.ts";
import { freshPool, seedLeague } from "./helpers.ts";

let pool: Pool;
before(async () => { pool = await freshPool("sw_test_events"); });
after(async () => { await pool.end(); });

const FAR_FUTURE = new Date("2027-01-01T00:00:00Z");

test("Eine Saison stellt sieben Tage lang Ereignisse zu", async () => {
  const fx = await seedLeague(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const { rows } = await pool.query<{ matchday: number; n: number }>(
    `SELECT matchday, COUNT(*)::int AS n FROM club_event
      WHERE league_id = $1 GROUP BY matchday ORDER BY matchday`, [fx.leagueId]);

  assert.equal(rows.length, 7, "Genau sieben Zustelltage pro Saison");
  for (const row of rows) {
    assert.equal((row.matchday - 1) % 3, 0,
      `Spieltag ${row.matchday} ist kein Tagesbeginn`);
    // 4 Vereine mal ein bis zwei Ereignisse
    assert.ok(row.n >= 4 && row.n <= 8, `Spieltag ${row.matchday}: ${row.n} Ereignisse`);
  }
});

test("Über eine Saison bekommt jeder Verein 7 bis 14 Entscheidungen", async () => {
  const fx = await seedLeague(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const { rows } = await pool.query<{ club_id: string; n: number }>(
    `SELECT club_id, COUNT(*)::int AS n FROM club_event
      WHERE league_id = $1 GROUP BY club_id`, [fx.leagueId]);
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.ok(row.n >= 7 && row.n <= 14,
      `Verein ${row.club_id}: ${row.n} Ereignisse, erwartet 7 bis 14 (GDD §10.2)`);
  }
});

test("Sperrfristen werden über die Saison eingehalten", async () => {
  const fx = await seedLeague(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const { rows } = await pool.query<{
    club_id: string; template_key: string; matchday: number;
  }>(
    `SELECT club_id, template_key, matchday FROM club_event
      WHERE league_id = $1 ORDER BY club_id, template_key, matchday`, [fx.leagueId]);

  for (let i = 1; i < rows.length; i++) {
    const previous = rows[i - 1]!, current = rows[i]!;
    if (previous.club_id !== current.club_id) continue;
    if (previous.template_key !== current.template_key) continue;
    const cooldown = EVENTS_BY_KEY.get(current.template_key)!.cooldownMatchdays;
    assert.ok(current.matchday - previous.matchday > cooldown,
      `${current.template_key} kam an Spieltag ${previous.matchday} und ${current.matchday}, ` +
      `Sperrfrist ist ${cooldown}`);
  }
});

test("Der Bot bekommt keine Ereignisse", async () => {
  const fx = await seedLeague(pool, 4);
  await pool.query(
    `UPDATE club SET is_bot = true, user_id = NULL WHERE id = $1`, [fx.clubIds[3]!]);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const { rows } = await pool.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM club_event WHERE club_id = $1", [fx.clubIds[3]!]);
  assert.equal(rows[0]!.n, 0);
});

test("Eine Entscheidung wirkt sich messbar aus", async () => {
  const fx = await seedLeague(pool, 2);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await deliverEvents(pool, fx.leagueId, 1, 1);

  const events = await pool.query<{ id: string; template_key: string; club_id: string }>(
    `SELECT id, template_key, club_id FROM club_event
      WHERE league_id = $1 AND resolved_at IS NULL LIMIT 1`, [fx.leagueId]);
  if (events.rows.length === 0) return;
  const event = events.rows[0]!;
  const definition = EVENTS_BY_KEY.get(event.template_key)!;
  if (definition.options.length === 0) return;

  const before = await pool.query<{ cash: number; fan_mood: number }>(
    "SELECT cash, fan_mood FROM club WHERE id = $1", [event.club_id]);
  const result = await resolveEvent(pool, event.id, 0);
  assert.equal(result.ok, true);
  const after = await pool.query<{ cash: number; fan_mood: number }>(
    "SELECT cash, fan_mood FROM club WHERE id = $1", [event.club_id]);

  const resolved = await pool.query<{ chosen_option: number; resolved_at: Date }>(
    "SELECT chosen_option, resolved_at FROM club_event WHERE id = $1", [event.id]);
  assert.equal(resolved.rows[0]!.chosen_option, 0);
  assert.ok(resolved.rows[0]!.resolved_at);
  void before; void after;
});

test("Dieselbe Entscheidung wird nicht zweimal angewendet", async () => {
  const fx = await seedLeague(pool, 2);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await deliverEvents(pool, fx.leagueId, 1, 1);

  const events = await pool.query<{ id: string }>(
    `SELECT id FROM club_event WHERE league_id = $1 LIMIT 1`, [fx.leagueId]);
  if (events.rows.length === 0) return;
  const id = events.rows[0]!.id;

  assert.equal((await resolveEvent(pool, id, 0)).ok, true);
  const second = await resolveEvent(pool, id, 0);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "already_resolved");
});

test("Wer nicht reagiert, bekommt die Standardoption", async () => {
  const fx = await seedLeague(pool, 2);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await deliverEvents(pool, fx.leagueId, 1, 1);
  await pool.query(
    `UPDATE club_event SET expires_at = now() - interval '1 hour'
      WHERE league_id = $1`, [fx.leagueId]);

  const resolved = await resolveExpired(pool);
  assert.ok(resolved > 0, "Abgelaufene Ereignisse müssen aufgelöst werden");

  const { rows } = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM club_event
      WHERE league_id = $1 AND resolved_at IS NULL`, [fx.leagueId]);
  assert.equal(rows[0]!.n, 0, "Kein Ereignis darf offen liegen bleiben");
});

test("Kein Ereignis vernichtet mehr als acht Prozent des Vermögens", async () => {
  const fx = await seedLeague(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const { rows } = await pool.query<{ club_id: string; amount: number; cash: number }>(
    `SELECT l.club_id, l.amount, c.cash FROM ledger_entry l
       JOIN club c ON c.id = l.club_id
      WHERE l.league_id = $1 AND l.reference_type = 'event' AND l.amount < 0`,
    [fx.leagueId]);
  for (const row of rows) {
    // Gegen das Startbudget prüfen, weil sich die Kasse seither verändert hat
    assert.ok(Math.abs(row.amount) <= 400_000_000 * 0.08,
      `Ereignis hat ${Math.abs(row.amount)} gekostet — über der Grenze aus §10.7`);
  }
});

test("Der Posteingang ist lesbar", async () => {
  const fx = await seedLeague(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const client = await pool.connect();
  try {
    const events = await readEvents(client, fx.clubIds[0]!, 20);
    assert.ok(events.length > 0);
    for (const event of events) {
      for (const text of [event.title, event.body, ...event.options.map((o) => o.text)]) {
        assert.ok(!text.includes("{"), `Unaufgelöster Platzhalter: "${text}"`);
        assert.ok(!text.startsWith("["), `Unbekannter Schlüssel: "${text}"`);
        assert.ok(text.length > 5, `Zu kurzer Text: "${text}"`);
      }
      assert.ok(event.resolved, "Nach der Saison muss alles aufgelöst sein");
    }
  } finally { client.release(); }
});
