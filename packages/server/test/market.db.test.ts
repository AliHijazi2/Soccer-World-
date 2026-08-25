/**
 * Der Markt im laufenden Spielbetrieb (GDD §5).
 *
 * Bisher konnten Auktionen abgewickelt werden, aber niemand stellte Spieler
 * ein. Diese Tests prüfen, dass der Markt über eine ganze Saison lebt.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { poolComposition, POOL_PER_CLUB } from "../../shared/src/rules/market.ts";
import { listForSale, refreshMarket } from "../src/domain/market.ts";
import { placeBid, settleAuction } from "../src/domain/auction.ts";
import { readFeed } from "../src/domain/feed.ts";
import { handlers, startSeason } from "../src/domain/season.ts";
import { checkInvariants, freshPool, seedLeague, seedLeagueWithMarket } from "./helpers.ts";
import { drain } from "../src/scheduler/runner.ts";
import type { Pool } from "../src/db/pool.ts";

let pool: Pool;
before(async () => { pool = await freshPool("sw_test_market"); });
after(async () => { await pool.end(); });

const FAR_FUTURE = new Date("2027-01-01T00:00:00Z");
const MIO = 1_000_000;

test("Der aktive Pool skaliert mit der Vereinszahl", async () => {
  const fx = await seedLeagueWithMarket(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });

  const { rows } = await pool.query<{ tier: string; n: number }>(
    `SELECT t.tier, COUNT(*)::int AS n
       FROM player_instance p JOIN player_template t ON t.id = p.template_id
      WHERE p.league_id = $1 AND p.club_id IS NULL AND p.pool_state = 'active'
      GROUP BY t.tier`, [fx.leagueId]);

  const expected = poolComposition(4);
  const actual = Object.fromEntries(rows.map((row) => [row.tier, row.n]));

  // Knappheit ist kein Nebeneffekt, sondern das Produkt: Bei vier Vereinen
  // dürfen nur sechs Weltklassespieler verfügbar sein (GDD §5.2)
  assert.ok((actual.world_class ?? 0) <= expected.world_class,
    `${actual.world_class} Weltklassespieler statt höchstens ${expected.world_class}`);
  const total = rows.reduce((sum, row) => sum + row.n, 0);
  assert.ok(total <= 4 * POOL_PER_CLUB,
    `${total} Spieler im aktiven Pool, erlaubt sind ${4 * POOL_PER_CLUB}`);
});

test("Über die Saison entstehen Auktionen und werden abgeschlossen", async () => {
  const fx = await seedLeagueWithMarket(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const { rows } = await pool.query<{ status: string; n: number }>(
    `SELECT status, COUNT(*)::int AS n FROM auction
      WHERE league_id = $1 GROUP BY status`, [fx.leagueId]);
  const byStatus = Object.fromEntries(rows.map((row) => [row.status, row.n]));
  const total = rows.reduce((sum, row) => sum + row.n, 0);

  assert.ok(total >= 15,
    `nur ${total} Auktionen über 21 Spieltage — der Markt bleibt zu leer`);
  assert.equal(byStatus.open ?? 0, 0, "Am Saisonende darf keine Auktion offen sein");
  assert.ok((byStatus.completed ?? 0) + (byStatus.expired ?? 0) > 0);
});

test("Die Außenwelt bietet mit, gewinnt aber nicht alles", async () => {
  const fx = await seedLeagueWithMarket(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const outside = await pool.query<{ id: string }>(
    "SELECT id FROM club WHERE league_id = $1 AND is_outside_world", [fx.leagueId]);
  assert.equal(outside.rows.length, 1, "Die Außenwelt muss als Marktakteur existieren");

  const bids = await pool.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM bid WHERE club_id = $1", [outside.rows[0]!.id]);
  assert.ok(bids.rows[0]!.n > 0, "Die Außenwelt muss mitgeboten haben");

  // Ihre Gebote laufen über denselben Pfad wie alle anderen — die Invarianten
  // müssen deshalb unverändert halten
  assert.deepEqual(await checkInvariants(pool), []);
});

test("Die Außenwelt taucht in keiner Tabelle und keinem Spielplan auf", async () => {
  const fx = await seedLeagueWithMarket(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const outside = await pool.query<{ id: string }>(
    "SELECT id FROM club WHERE league_id = $1 AND is_outside_world", [fx.leagueId]);
  const id = outside.rows[0]!.id;

  for (const [table, column] of [
    ["standing", "club_id"], ["match", "home_club_id"], ["match", "away_club_id"],
    ["club_event", "club_id"], ["feed_item", "subject_club_id"],
  ] as const) {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM ${table} WHERE ${column} = $1`, [id]);
    assert.equal(rows[0]!.n, 0,
      `Die Außenwelt taucht in ${table}.${column} auf — sie ist keine Mannschaft`);
  }

  // Und sie bekommt keine Gehälter, Einnahmen oder Betriebskosten gebucht
  const ledger = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM ledger_entry
      WHERE club_id = $1 AND category <> 'transfer_out'`, [id]);
  assert.equal(ledger.rows[0]!.n, 0, "Die Außenwelt hat keine Wirtschaft");
});

test("Ein Verein kann einen Spieler zum Verkauf stellen", async () => {
  const fx = await seedLeague(pool, 2, 16);
  const club = fx.clubIds[0]!;
  const player = await pool.query<{ id: string; market_value: number }>(
    "SELECT id, market_value FROM player_instance WHERE club_id = $1 LIMIT 1", [club]);
  const target = player.rows[0]!;

  const result = await listForSale(
    pool, club, target.id, Math.round(target.market_value * 0.6),
    new Date(Date.now() + 3600_000));
  assert.equal(result.ok, true);

  const auction = await pool.query<{ seller_club_id: string; status: string }>(
    "SELECT seller_club_id, status FROM auction WHERE id = $1", [result.auctionId!]);
  assert.equal(auction.rows[0]!.seller_club_id, club);
  assert.equal(auction.rows[0]!.status, "open");
});

test("Der Mindestkader wird beim Verkauf hart geprüft", async () => {
  // Wer unter vierzehn Spieler fällt, kann keinen Spieltag mehr bestreiten —
  // und drei Anstöße pro Tag verzeihen das nicht
  const fx = await seedLeague(pool, 2, 14);
  const club = fx.clubIds[0]!;
  const player = await pool.query<{ id: string }>(
    "SELECT id FROM player_instance WHERE club_id = $1 LIMIT 1", [club]);

  const result = await listForSale(
    pool, club, player.rows[0]!.id, 1 * MIO, new Date(Date.now() + 3600_000));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "squad_too_small");
});

test("Ein fremder Spieler kann nicht verkauft werden", async () => {
  const fx = await seedLeague(pool, 2, 16);
  const foreign = await pool.query<{ id: string }>(
    "SELECT id FROM player_instance WHERE club_id = $1 LIMIT 1", [fx.clubIds[1]!]);
  const result = await listForSale(
    pool, fx.clubIds[0]!, foreign.rows[0]!.id, 1 * MIO, new Date(Date.now() + 3600_000));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_owner");
});

test("Derselbe Spieler steht nie in zwei Auktionen", async () => {
  const fx = await seedLeague(pool, 2, 16);
  const club = fx.clubIds[0]!;
  const player = await pool.query<{ id: string }>(
    "SELECT id FROM player_instance WHERE club_id = $1 LIMIT 1", [club]);
  const closesAt = new Date(Date.now() + 3600_000);

  assert.equal((await listForSale(pool, club, player.rows[0]!.id, 1 * MIO, closesAt)).ok, true);
  const second = await listForSale(pool, club, player.rows[0]!.id, 1 * MIO, closesAt);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "already_listed");
});

test("Ein Panikkauf landet als Schlagzeile im Feed", async () => {
  const fx = await seedLeagueWithMarket(pool, 3);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });

  const closesAt = new Date(Date.now() + 3600_000);
  const opened = await refreshMarket(pool, fx.leagueId, 1, closesAt);
  assert.ok(opened.opened > 0, "Der Marktnachschub muss Auktionen anlegen");

  const auction = await pool.query<{ id: string; value: number }>(
    `SELECT a.id, p.market_value AS value FROM auction a
       JOIN player_instance p ON p.id = a.player_instance_id
      WHERE a.league_id = $1 AND a.status = 'open' ORDER BY a.id LIMIT 1`, [fx.leagueId]);
  const target = auction.rows[0]!;

  // Weit über Marktwert bieten
  const bid = await placeBid(pool, {
    auctionId: target.id, clubId: fx.clubIds[0]!,
    maxAmount: Math.round(target.value * 2.2),
  });
  assert.equal(bid.ok, true);

  await pool.query("UPDATE auction SET closes_at = now() - interval '1 minute' WHERE id = $1",
    [target.id]);
  const settled = await settleAuction(pool, target.id);
  assert.equal(settled.ok && settled.outcome, "sold");

  const client = await pool.connect();
  try {
    const feed = await readFeed(client, fx.leagueId, 10);
    const transfer = feed.find((item) => item.text.includes("Mio"));
    assert.ok(transfer, "Der Transfer muss im Feed auftauchen:\n" +
      feed.map((f) => "  " + f.text).join("\n"));
    assert.ok(!transfer.text.includes("{"), `Unaufgelöster Platzhalter: "${transfer.text}"`);
  } finally { client.release(); }
});

test("Die Buchhaltung bleibt mit lebendigem Markt konsistent", async () => {
  const fx = await seedLeagueWithMarket(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, FAR_FUTURE);

  const clubs = await pool.query<{ id: string; cash: number; booked: number }>(
    `SELECT c.id, c.cash, COALESCE(SUM(l.amount), 0) AS booked
       FROM club c LEFT JOIN ledger_entry l ON l.club_id = c.id
      WHERE c.league_id = $1 AND NOT c.is_outside_world
      GROUP BY c.id, c.cash`, [fx.leagueId]);
  for (const club of clubs.rows) {
    assert.equal(club.cash, 400_000_000 + club.booked,
      `Verein ${club.id}: Kasse und Buchungen weichen ab`);
  }
  assert.deepEqual(await checkInvariants(pool), []);
});
