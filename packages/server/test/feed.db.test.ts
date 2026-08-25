/**
 * Feed im laufenden Betrieb.
 *
 * Der Feed ist laut GDD §20.3 einer von drei Bausteinen, die überdurchschnittlich
 * gut sein müssen — er ist der Grund, warum jemand morgens die App öffnet.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { handlers, startSeason } from "../src/domain/season.ts";
import { readFeed, readTicker } from "../src/domain/feed.ts";
import { drain } from "../src/scheduler/runner.ts";
import type { Pool } from "../src/db/pool.ts";
import { freshPool, seedLeague } from "./helpers.ts";

let pool: Pool;
before(async () => { pool = await freshPool("sw_test_feed"); });
after(async () => { await pool.end(); });

const FAR_FUTURE = new Date("2027-01-01T00:00:00Z");

test("Eine Saison erzeugt einen lesbaren Feed", async () => {
  const fx = await seedLeague(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const client = await pool.connect();
  try {
    const items = await readFeed(client, fx.leagueId, 100);
    assert.ok(items.length >= 10, `nur ${items.length} Meldungen über 21 Spieltage`);
    assert.ok(items.length <= 80,
      `${items.length} Meldungen — ein Feed, in dem alles steht, wird nicht gelesen`);

    for (const item of items) {
      assert.ok(!item.text.includes("{"),
        `Unaufgelöster Platzhalter: "${item.text}"`);
      assert.ok(!item.text.startsWith("["),
        `Unbekannter Template-Schlüssel: "${item.text}"`);
      assert.ok(item.text.length > 10, `Zu kurze Meldung: "${item.text}"`);
    }
  } finally { client.release(); }
});

test("Der Feed enthält verschiedene Meldungsarten", async () => {
  const fx = await seedLeague(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const { rows } = await pool.query<{ template_key: string; n: number }>(
    `SELECT template_key, COUNT(*)::int AS n FROM feed_item
      WHERE league_id = $1 GROUP BY template_key`, [fx.leagueId]);
  assert.ok(rows.length >= 4,
    `nur ${rows.length} verschiedene Meldungsarten: ${rows.map((r) => r.template_key).join(", ")}`);
});

test("Sperrfristen werden über die Saison eingehalten", async () => {
  const fx = await seedLeague(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const { rows } = await pool.query<{
    template_key: string; subject_club_id: string | null; matchday: number;
  }>(
    `SELECT template_key, subject_club_id, matchday FROM feed_item
      WHERE league_id = $1 AND template_key LIKE 'fans.%'
      ORDER BY template_key, subject_club_id, matchday`, [fx.leagueId]);

  for (let i = 1; i < rows.length; i++) {
    const previous = rows[i - 1]!, current = rows[i]!;
    if (previous.template_key !== current.template_key) continue;
    if (previous.subject_club_id !== current.subject_club_id) continue;
    assert.ok(current.matchday - previous.matchday >= 4,
      `${current.template_key} kam an Spieltag ${previous.matchday} und ${current.matchday} — ` +
      "die Sperrfrist wurde nicht eingehalten");
  }
});

test("Jede Partie hat einen lesbaren Ticker", async () => {
  const fx = await seedLeague(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const client = await pool.connect();
  try {
    const matches = await client.query<{ id: string; home_goals: number; away_goals: number }>(
      `SELECT id, home_goals, away_goals FROM match
        WHERE league_id = $1 ORDER BY matchday LIMIT 6`, [fx.leagueId]);

    for (const match of matches.rows) {
      const lines = await readTicker(client, match.id);
      assert.ok(lines.length >= 3, `Partie ${match.id} hat nur ${lines.length} Zeilen`);
      assert.match(lines[0]!.text, /Anpfiff|Ball rollt|geht los/);

      for (const line of lines) {
        assert.ok(!line.text.includes("{"),
          `Unaufgelöster Platzhalter im Ticker: "${line.text}"`);
        assert.ok(!line.text.startsWith("["),
          `Unbekannter Ticker-Schlüssel: "${line.text}"`);
      }

      // Der Endstand im letzten Ticker-Eintrag muss zum Ergebnis passen
      const last = lines.at(-1)!.text;
      assert.ok(last.includes(`${match.home_goals}:${match.away_goals}`),
        `Abpfiff nennt nicht den Endstand ${match.home_goals}:${match.away_goals}: "${last}"`);
    }
  } finally { client.release(); }
});

test("Torschützen und Vorlagengeber erscheinen mit Namen", async () => {
  const fx = await seedLeague(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const client = await pool.connect();
  try {
    // ORDER BY ist hier nicht Kosmetik: Ohne feste Reihenfolge liefert Postgres
    // bei LIMIT 1 eine beliebige Zeile und der Test wird sporadisch rot.
    const match = await client.query<{ id: string; player: string; assist: string }>(
      `SELECT m.id, pt.full_name AS player, st.full_name AS assist
         FROM match m
         JOIN match_event e ON e.match_id = m.id
         JOIN player_instance pi ON pi.id = e.player_instance_id
         JOIN player_template pt ON pt.id = pi.template_id
         JOIN player_instance si ON si.id = e.secondary_player_id
         JOIN player_template st ON st.id = si.template_id
        WHERE m.league_id = $1 AND e.text_key = 'goal.assisted'
        ORDER BY m.matchday, e.sequence LIMIT 1`, [fx.leagueId]);
    if (match.rows.length === 0) return;
    const expected = match.rows[0]!;

    const lines = await readTicker(client, expected.id);
    // Nach der Torzeile suchen, nicht nach der ersten Zeile mit dem Namen:
    // Ein Spieler taucht oft schon vorher bei einem Fehlschuss auf, und dort
    // steht naturgemäß kein Vorlagengeber.
    const goal = lines.find(
      (line) => line.type === "goal" && line.text.includes(expected.player));
    // Gegen die echten Namen prüfen statt gegen ein Muster: Der Pool enthält
    // Namen wie "İlkay Gündoğan" und "Dušan Vlahović", an denen jede
    // handgeschriebene Regex früher oder später scheitert.
    assert.ok(goal,
      `Torschütze "${expected.player}" taucht im Ticker nicht auf:\n` +
      lines.map((l) => "  " + l.text).join("\n"));
    assert.ok(goal.text.includes(expected.assist),
      `Vorlagengeber "${expected.assist}" fehlt: "${goal.text}"`);
  } finally { client.release(); }
});
