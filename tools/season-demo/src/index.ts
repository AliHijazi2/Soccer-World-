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
import { readFeed, readTicker } from "../../../packages/server/src/domain/feed.ts";
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

const fans = await pool.query<{
  name: string; fan_count: number; fan_mood: number; expected_ppg: number;
  season_goal: string; points: number; played: number;
}>(
  `SELECT c.name, c.fan_count, c.fan_mood, c.expected_ppg, c.season_goal,
          s.points, s.played
     FROM club c JOIN standing s ON s.club_id = c.id
    WHERE c.league_id = $1 ORDER BY c.expected_ppg DESC`, [fx.leagueId]);
console.log("\nERWARTUNG GEGEN WIRKLICHKEIT (GDD §11.2)");
console.log("─".repeat(78));
console.log(pad("Verein", 14) + pad("Saisonziel", 13) + padL("erwartet", 10) +
  padL("erreicht", 10) + padL("Differenz", 11) + padL("Stimmung", 10) + padL("Fans", 10));
console.log("─".repeat(78));
for (const row of fans.rows) {
  const actual = row.points / Math.max(row.played, 1);
  const diff = actual - row.expected_ppg;
  console.log(
    pad(row.name, 14) + pad(row.season_goal, 13) +
    padL(row.expected_ppg.toFixed(2), 10) + padL(actual.toFixed(2), 10) +
    padL((diff >= 0 ? "+" : "") + diff.toFixed(2), 11) +
    padL(Math.round(row.fan_mood) + "", 10) +
    padL(Math.round(row.fan_count / 1000) + "k", 10));
}
console.log("─".repeat(78));

const money = await pool.query<{ category: string; total: number }>(
  `SELECT category, SUM(amount)::bigint AS total FROM ledger_entry
    WHERE league_id = $1 GROUP BY category ORDER BY SUM(amount) DESC`, [fx.leagueId]);
const clubCount = table.rows.length;
console.log("\nWIRTSCHAFT JE VEREIN UND SAISON (Zielwerte aus GDD §13.1)");
console.log("─".repeat(78));
// Zielwerte aus GDD §13.1 in der korrigierten Fassung
const TARGETS: Record<string, number> = {
  tv: 18, tv_bonus: 12, sponsor: 15, ticket: 9, merch: 7, prize: 7,
  wages: -40, maintenance: -12,
};
let income = 0, expense = 0;
for (const row of money.rows) {
  const perClub = row.total / clubCount / 1_000_000;
  if (perClub > 0) income += perClub; else expense += perClub;
  const target = TARGETS[row.category];
  const mark = target === undefined ? " "
    : Math.abs(perClub - target) <= Math.max(3, Math.abs(target) * 0.35) ? "✓" : "✗";
  console.log(
    pad(`${mark} ${row.category}`, 20) + padL(perClub.toFixed(1) + " Mio", 14) +
    padL(target === undefined ? "" : `Ziel ${target} Mio`, 18));
}
console.log("─".repeat(78));
console.log(pad("Einnahmen", 20) + padL(income.toFixed(1) + " Mio", 14) + padL("Ziel 68 Mio", 18));
console.log(pad("Ausgaben", 20) + padL(expense.toFixed(1) + " Mio", 14) + padL("Ziel -52 Mio", 18));
console.log(pad("Ergebnis", 20) + padL((income + expense).toFixed(1) + " Mio", 14) +
  padL("Ziel +10 bis +22", 18));
const wageShare = Math.abs((TARGETS.wages ? (money.rows.find((r) => r.category === "wages")?.total ?? 0) : 0)
  / clubCount / 1_000_000) / Math.max(income, 1) * 100;
console.log(pad("Gehaltsquote", 20) + padL(wageShare.toFixed(0) + " %", 14) +
  padL("Ziel 45-60 %", 18));
console.log("─".repeat(78));

// Warum die Gehaltsquote von der Kadergröße abweicht: Das Gehalt hängt am
// Können, der Marktwert zusätzlich am Alter (GDD §13.2). Ein Kader voller
// Altersschnäppchen ist billig gekauft und teuer im Unterhalt.
const squads = await pool.query<{
  name: string; market_value: number; wage_season: number; avg_age: number;
}>(
  `SELECT c.name,
          COALESCE(SUM(p.market_value), 0)::bigint AS market_value,
          (COALESCE(SUM(p.wage_per_matchday), 0) * 21)::bigint AS wage_season,
          ROUND(AVG(p.age), 1)::numeric AS avg_age
     FROM club c LEFT JOIN player_instance p ON p.club_id = c.id
    WHERE c.league_id = $1 GROUP BY c.name ORDER BY c.name`, [fx.leagueId]);
console.log("\nKADERSTRUKTUR — Ablöse gegen Gehalt");
console.log("─".repeat(78));
console.log(pad("Verein", 14) + padL("Kaderwert", 14) + padL("Gehalt/Saison", 16) +
  padL("Quote", 9) + padL("Ø Alter", 10));
console.log("─".repeat(78));
for (const row of squads.rows) {
  const ratio = row.market_value > 0 ? row.wage_season / row.market_value * 100 : 0;
  console.log(
    pad(row.name, 14) + padL(mio(row.market_value), 14) +
    padL(mio(row.wage_season), 16) + padL(ratio.toFixed(0) + " %", 9) +
    padL(String(row.avg_age), 10));
}
console.log("─".repeat(78));
console.log("Ein Kader im besten Alter läge bei rund 8 % — höhere Werte bedeuten:");
console.log("billig eingekauft, teuer im Unterhalt.\n");

const client = await pool.connect();

const firstMatch = await client.query<{ id: string }>(
  `SELECT id FROM match WHERE league_id = $1 AND matchday = 1 ORDER BY id LIMIT 1`,
  [fx.leagueId]);
const lines = await readTicker(client, firstMatch.rows[0]!.id);
console.log("TICKER — erste Partie des ersten Spieltags");
console.log("─".repeat(78));
for (const line of lines.slice(0, 16)) {
  console.log(padL(`${line.minute}'`, 5) + "  " + line.text);
}
if (lines.length > 16) console.log(padL("", 5) + `  … ${lines.length - 16} weitere`);
console.log("─".repeat(78));

const feed = await readFeed(client, fx.leagueId, 18);
const feedTotal = await client.query<{ n: number }>(
  "SELECT COUNT(*)::int AS n FROM feed_item WHERE league_id = $1", [fx.leagueId]);
console.log(`\nBOULEVARD-FEED — ${feedTotal.rows[0]!.n} Meldungen über die Saison`);
console.log("─".repeat(78));
for (const item of feed) {
  const mark = item.importance >= 3 ? "🔥" : item.importance === 2 ? "⚡" : "· ";
  console.log(`${mark} ST ${String(item.matchday).padStart(2)}  ${item.text}`);
}
console.log("─".repeat(78) + "\n");

client.release();

await pool.end();
