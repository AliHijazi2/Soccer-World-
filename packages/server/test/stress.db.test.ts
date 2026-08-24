/**
 * Härtetest: der Marktabschluss zwischen 16 und 17 Uhr in verdichteter Form.
 *
 * Sechs Vereine bieten gleichzeitig auf acht Auktionen, mit knappem Budget,
 * sodass die Deckungsprüfung ständig greift. Genau hier müssen die Invarianten
 * halten — wenn nicht, verliert die Gruppe das Vertrauen in den Markt und das
 * Spiel ist tot.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { placeBid, settleAuction } from "../src/domain/auction.ts";
import type { Pool } from "../src/db/pool.ts";
import { checkInvariants, freshPool, seed } from "./helpers.ts";

let pool: Pool;
before(async () => { pool = await freshPool("sw_test_stress"); });
after(async () => { await pool.end(); });

const MIO = 1_000_000;

test("240 gleichzeitige Gebote auf 8 Auktionen bleiben konsistent", async () => {
  const CLUBS = 6, AUCTIONS = 8, BUDGET = 120 * MIO;
  const fx = await seed(pool, CLUBS, AUCTIONS, BUDGET);

  // Deterministische Gebotsfolge, damit ein Fehlschlag reproduzierbar ist
  let state = 20240824;
  const rand = (): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };

  const commands = Array.from({ length: 240 }, () => ({
    auctionId: fx.auctions[Math.floor(rand() * AUCTIONS)]!.id,
    clubId: fx.clubs[Math.floor(rand() * CLUBS)]!.id,
    maxAmount: Math.round((5 + rand() * 55) * MIO),
  }));

  const started = Date.now();
  const settled = await Promise.allSettled(commands.map((cmd) => placeBid(pool, cmd)));
  const duration = Date.now() - started;

  const crashed = settled.filter((r) => r.status === "rejected");
  assert.equal(crashed.length, 0,
    "Keine Transaktion darf abstürzen: " +
    crashed.slice(0, 3).map((r) => String((r as PromiseRejectedResult).reason)).join(" | "));

  const accepted = settled.filter(
    (r) => r.status === "fulfilled" && r.value.ok).length;

  const violations = await checkInvariants(pool);
  assert.deepEqual(violations, [], "Invarianten verletzt: " + JSON.stringify(violations));

  // Jeder Verein darf höchstens sein gesamtes Budget gebunden haben
  const held = await pool.query<{ id: string; held: number }>(
    `SELECT c.id, COALESCE(SUM(e.amount), 0) AS held
       FROM club c LEFT JOIN escrow_hold e ON e.club_id = c.id AND e.released_at IS NULL
      WHERE c.league_id = $1
      GROUP BY c.id`, [fx.leagueId]);
  for (const row of held.rows) {
    assert.ok(row.held <= BUDGET,
      `Verein ${row.id} hat ${row.held} gebunden bei ${BUDGET} Budget`);
  }

  console.log(`      ${accepted} von 240 Geboten angenommen, ${duration} ms, ` +
    `${held.rows.filter((r) => r.held > 0).length} Vereine mit gebundenem Geld`);
});

test("Nach dem Abschluss aller Auktionen stimmt die Buchhaltung", async () => {
  const fx = await seed(pool, 4, 5, 200 * MIO);

  for (let round = 0; round < 6; round++) {
    await Promise.allSettled(fx.auctions.flatMap((auction) =>
      fx.clubs.map((club, i) => placeBid(pool, {
        auctionId: auction.id, clubId: club.id,
        maxAmount: (10 + round * 6 + i * 3) * MIO,
      }))));
  }

  await pool.query(
    "UPDATE auction SET closes_at = now() - interval '1 minute' WHERE league_id = $1",
    [fx.leagueId]);
  const outcomes = await Promise.all(
    fx.auctions.map((auction) => settleAuction(pool, auction.id)));
  assert.ok(outcomes.every((o) => o.ok), "Jede Auktion muss abschließbar sein");

  // Nach dem Abschluss darf nichts mehr gebunden sein
  const open = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM escrow_hold e
       JOIN auction a ON a.id = e.auction_id
      WHERE a.league_id = $1 AND e.released_at IS NULL`, [fx.leagueId]);
  assert.equal(open.rows[0]!.n, 0, "Alle Sperren müssen freigegeben sein");

  // Kassenbestand jedes Vereins = Startkapital + Summe seiner Buchungen
  const cash = await pool.query<{ id: string; cash: number; booked: number }>(
    `SELECT c.id, c.cash, COALESCE(SUM(l.amount), 0) AS booked
       FROM club c LEFT JOIN ledger_entry l ON l.club_id = c.id
      WHERE c.league_id = $1 GROUP BY c.id, c.cash`, [fx.leagueId]);
  for (const row of cash.rows) {
    assert.equal(row.cash, 200 * MIO + row.booked,
      `Verein ${row.id}: Kasse ${row.cash}, erwartet ${200 * MIO + row.booked}`);
  }

  // Jeder verkaufte Spieler gehört genau einem Verein
  const orphans = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM auction a
       JOIN player_instance p ON p.id = a.player_instance_id
      WHERE a.league_id = $1 AND a.status = 'completed' AND p.club_id IS NULL`,
    [fx.leagueId]);
  assert.equal(orphans.rows[0]!.n, 0, "Ein verkaufter Spieler muss einen Verein haben");

  assert.deepEqual(await checkInvariants(pool), []);
});
