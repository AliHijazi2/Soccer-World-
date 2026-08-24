/**
 * Spielt eine vollständige Saison durch und druckt das Ergebnis.
 *
 * Der sichtbare Nachweis für den Meilenstein aus ARCHITECTURE.md §15: Das
 * Spiel läuft ohne Benutzeroberfläche von selbst durch.
 *
 *   DATABASE_URL=... npm run season:demo
 */

import { createPool, migrate } from "../../../packages/server/src/db/pool.ts";
import { handlers, startSeason } from "../../../packages/server/src/domain/season.ts";
import { drain } from "../../../packages/server/src/scheduler/runner.ts";
import { seedLeague } from "../../../packages/server/test/helpers.ts";

const CLUBS = Number(process.env.CLUBS ?? 4);
const url = process.env.DATABASE_URL ??
  "postgresql://postgres@localhost/postgres?host=/tmp&port=5433";

const admin = createPool(url);
try { await admin.query("CREATE DATABASE sw_demo"); } catch { /* existiert bereits */ }
await admin.end();

const demoUrl = new URL(url);
demoUrl.pathname = "/sw_demo";
const pool = createPool(demoUrl.toString());
await migrate(pool);
await pool.query(`TRUNCATE transfer, ledger_entry, escrow_hold, bid, auction, job,
  match_event, match, standing, lineup, player_instance, player_template, club, league,
  app_user CASCADE`);

const pad = (s: string, n: number) => s.padEnd(n);
const padL = (s: string, n: number) => s.padStart(n);
const mio = (v: number) => `${(v / 1_000_000).toFixed(1)} Mio`;

console.log(`\nSoccer World — Saisondurchlauf mit ${CLUBS} Vereinen\n`);

const fx = await seedLeague(pool, CLUBS);
const started = await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
console.log(`Spielplan: ${started.matchesCreated} Partien, erster Anstoß ` +
  started.firstKickoff.toLocaleString("de-DE", { timeZone: "Europe/Berlin" }));

const begin = Date.now();
const result = await drain(pool, handlers, new Date("2027-01-01T00:00:00Z"));
const duration = Date.now() - begin;
console.log(`Jobs: ${result.processed} verarbeitet, ${result.failed} gescheitert, ${duration} ms\n`);

const table = await pool.query<{
  name: string; played: number; won: number; drawn: number; lost: number;
  goals_for: number; goals_against: number; points: number; cash: number;
}>(
  `SELECT c.name, s.played, s.won, s.drawn, s.lost, s.goals_for, s.goals_against,
          s.points, c.cash
     FROM standing s JOIN club c ON c.id = s.club_id
    WHERE s.league_id = $1
    ORDER BY (s.points::numeric / NULLIF(s.played, 0)) DESC NULLS LAST,
             (s.goals_for - s.goals_against) DESC, s.goals_for DESC`,
  [fx.leagueId]);

console.log("ABSCHLUSSTABELLE");
console.log("─".repeat(78));
console.log(pad("#", 4) + pad("Verein", 14) + padL("Sp", 4) + padL("S", 4) +
  padL("U", 4) + padL("N", 4) + padL("Tore", 10) + padL("Diff", 7) +
  padL("Pkt", 6) + padL("Kasse", 16));
console.log("─".repeat(78));
table.rows.forEach((row, i) => {
  console.log(
    pad(String(i + 1) + ".", 4) + pad(row.name, 14) +
    padL(String(row.played), 4) + padL(String(row.won), 4) +
    padL(String(row.drawn), 4) + padL(String(row.lost), 4) +
    padL(`${row.goals_for}:${row.goals_against}`, 10) +
    padL(String(row.goals_for - row.goals_against), 7) +
    padL(String(row.points), 6) + padL(mio(row.cash), 16));
});
console.log("─".repeat(78));

const stats = await pool.query<{
  matches: number; goals: number; events: number; injuries: number; reds: number;
}>(
  `SELECT (SELECT COUNT(*)::int FROM match WHERE league_id = $1) AS matches,
          (SELECT COALESCE(SUM(home_goals + away_goals), 0)::int FROM match WHERE league_id = $1) AS goals,
          (SELECT COUNT(*)::int FROM match_event e JOIN match m ON m.id = e.match_id
            WHERE m.league_id = $1) AS events,
          (SELECT COUNT(*)::int FROM player_instance
            WHERE league_id = $1 AND injured_until_matchday IS NOT NULL) AS injuries,
          (SELECT COUNT(*)::int FROM match_event e JOIN match m ON m.id = e.match_id
            WHERE m.league_id = $1 AND e.type = 'red_card') AS reds`,
  [fx.leagueId]);
const s = stats.rows[0]!;
console.log(`\n${s.matches} Partien · ${s.goals} Tore (${(s.goals / s.matches).toFixed(2)} pro Spiel)` +
  ` · ${s.events} Ticker-Ereignisse · ${s.injuries} Verletzte · ${s.reds} Platzverweise`);

const fitness = await pool.query<{ avg: number; min: number; below: number }>(
  `SELECT ROUND(AVG(fitness))::int AS avg, MIN(fitness)::int AS min,
          COUNT(*) FILTER (WHERE fitness < 70)::int AS below
     FROM player_instance WHERE league_id = $1`, [fx.leagueId]);
const f = fitness.rows[0]!;
console.log(`Fitness am Saisonende: Schnitt ${f.avg}, Tiefstwert ${f.min}, ` +
  `${f.below} Spieler unter der Leistungsgrenze von 70`);

const money = await pool.query<{ category: string; total: number }>(
  `SELECT category, SUM(amount)::bigint AS total FROM ledger_entry
    WHERE league_id = $1 GROUP BY category ORDER BY SUM(amount) DESC`, [fx.leagueId]);
console.log("\nGELDFLUSS DER LIGA");
console.log("─".repeat(78));
for (const row of money.rows) {
  console.log(pad(row.category, 20) + padL(mio(row.total), 16));
}
console.log("─".repeat(78) + "\n");

const ticker = await pool.query<{ minute: number; type: string; text_key: string }>(
  `SELECT e.minute, e.type, e.text_key FROM match_event e
     JOIN match m ON m.id = e.match_id
    WHERE m.league_id = $1 AND m.matchday = 1
    ORDER BY m.id, e.sequence LIMIT 12`, [fx.leagueId]);
console.log("TICKER-AUSZUG (Spieltag 1)");
console.log("─".repeat(78));
for (const row of ticker.rows) {
  console.log(padL(`${row.minute}'`, 5) + "  " + pad(row.type, 16) + row.text_key);
}
console.log("─".repeat(78) + "\n");

await pool.end();
