/**
 * Legt eine spielbereite Liga an.
 *
 *   npm run new-league -- "Freitagsliga" Ali Marco Lisa Tom
 *
 * Gibt am Ende für jeden Verein eine Kennung aus — die tragen die Freunde beim
 * ersten Start in die App ein.
 */

import { readFileSync } from "node:fs";

import { createPool, migrate } from "../../../packages/server/src/db/pool.ts";
import { startSeason } from "../../../packages/server/src/domain/season.ts";
import { drawActivePool } from "../../../packages/server/src/domain/market.ts";

interface PoolPlayer {
  externalKey: string; fullName: string; birthYear: number; age: number;
  primaryPosition: string; tier: string; overall: number;
  attributes: Record<string, number>; potentialMin: number; potentialMax: number;
  traits: string[]; baseValue: number; baseWage: number;
}

const [leagueName, ...managers] = process.argv.slice(2);
if (!leagueName || managers.length < 3) {
  console.error('Aufruf: npm run new-league -- "Liganame" Name1 Name2 Name3 [...]');
  console.error("Mindestens drei Freunde; bei ungerader Zahl füllt ein Bot auf.");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(1);
}

const pool = createPool(url, 4);
await migrate(pool);

const inviteCode = Math.random().toString(36).slice(2, 8).toUpperCase();
const league = await pool.query<{ id: string }>(
  `INSERT INTO league (name, invite_code, rng_salt, timezone)
   VALUES ($1, $2, $3, $4) RETURNING id`,
  [leagueName, inviteCode, Math.floor(Math.random() * 2 ** 30),
   process.env.TZ ?? "Europe/Berlin"]);
const leagueId = league.rows[0]!.id;

// Startkader nach GDD §2.3: fünf Jugendspieler als Versicherung gegen eine
// katastrophale Aufbauphase. Alles Weitere kommt vom Markt.
const clubs: { name: string; id: string }[] = [];
for (const manager of managers) {
  const user = await pool.query<{ id: string }>(
    `INSERT INTO app_user (email, display_name) VALUES ($1, $2) RETURNING id`,
    [`${manager.toLowerCase()}-${inviteCode.toLowerCase()}@soccer.local`, manager]);
  const club = await pool.query<{ id: string }>(
    `INSERT INTO club (league_id, user_id, name, short_name, cash)
     VALUES ($1, $2, $3, $4, 400000000) RETURNING id`,
    [leagueId, user.rows[0]!.id, `${manager} FC`,
     manager.slice(0, 3).toUpperCase()]);
  clubs.push({ name: `${manager} FC`, id: club.rows[0]!.id });
}

// Den gesamten Spielerbestand in die Liga holen
const raw = JSON.parse(readFileSync("data/players.json", "utf8")) as { players: PoolPlayer[] };
for (const player of raw.players) {
  const template = await pool.query<{ id: string }>(
    `INSERT INTO player_template
       (external_key, full_name, birth_year, primary_position, tier,
        attributes, potential_min, potential_max, base_value, base_wage)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (external_key) DO UPDATE SET full_name = EXCLUDED.full_name
     RETURNING id`,
    [player.externalKey, player.fullName, player.birthYear, player.primaryPosition,
     player.tier, player.attributes, player.potentialMin, player.potentialMax,
     player.baseValue, player.baseWage]);
  await pool.query(
    `INSERT INTO player_instance
       (league_id, template_id, primary_position, attributes, traits, age,
        overall, true_potential, market_value, wage_per_matchday, pool_state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active')
     ON CONFLICT (league_id, template_id) DO NOTHING`,
    [leagueId, template.rows[0]!.id, player.primaryPosition, player.attributes,
     player.traits, player.age, player.overall,
     // Das wahre Potenzial wird je Liga neu gewürfelt (Datenmodell §1)
     player.potentialMin + Math.floor(Math.random() * (player.potentialMax - player.potentialMin + 1)),
     player.baseValue, player.baseWage]);
}

const client = await pool.connect();
try {
  await drawActivePool(client, leagueId, clubs.length);
} finally { client.release(); }

const today = new Date();
await startSeason(pool, leagueId, {
  year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate(),
});

console.log(`\n  Liga "${leagueName}" angelegt.\n`);
console.log(`  Liga-Kennung   ${leagueId}\n`);
console.log("  Diese Kennungen an die Freunde geben:\n");
for (const club of clubs) {
  console.log(`    ${club.name.padEnd(16)} ${club.id}`);
}
console.log(`\n  Spieltage: täglich 17:00, 20:00 und 22:00 Uhr.`);
console.log(`  Marktabschluss: täglich zwischen 16:00 und 17:00 Uhr.\n`);

await pool.end();
