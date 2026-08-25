/**
 * Die Schnittstelle, insbesondere ihre Sichtbarkeitsregeln (Architektur §9).
 *
 * Der wichtigste Test hier prüft die Gegenrichtung der Server-Autorität:
 * Es gibt Daten, die niemals ausgeliefert werden dürfen. Ein Feld, das im
 * Netzwerk-Tab auftaucht, macht die Mechanik dahinter für immer wertlos.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";

import { buildServer } from "../src/api/server.ts";
import { findForbiddenFields } from "../src/api/projections.ts";
import { handlers, startSeason } from "../src/domain/season.ts";
import { refreshMarket } from "../src/domain/market.ts";
import { drain } from "../src/scheduler/runner.ts";
import type { Pool } from "../src/db/pool.ts";
import { freshPool, seedLeagueWithMarket, TEST_DATABASE_URL_FOR } from "./helpers.ts";

let app: FastifyInstance;
let pool: Pool;

before(async () => {
  // freshPool legt die Datenbank an und migriert sie — buildServer setzt eine
  // vorhandene Datenbank voraus
  const setup = await freshPool("sw_test_api");
  await setup.end();

  const built = await buildServer({
    databaseUrl: TEST_DATABASE_URL_FOR("sw_test_api"), poolMax: 6,
  });
  app = built.app;
  pool = built.pool;
});
after(async () => { await app.close(); });

async function get(url: string, clubId?: string) {
  const response = await app.inject({
    method: "GET", url,
    headers: clubId ? { "x-club-id": clubId } : {},
  });
  return { status: response.statusCode, body: response.json() as Record<string, unknown> };
}

async function post(url: string, payload: Record<string, unknown>, clubId?: string) {
  const response = await app.inject({
    method: "POST", url, payload,
    headers: clubId ? { "x-club-id": clubId } : {},
  });
  return { status: response.statusCode, body: response.json() as Record<string, unknown> };
}

test("Keine Antwort enthält ein verbotenes Feld", async () => {
  const fx = await seedLeagueWithMarket(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await refreshMarket(pool, fx.leagueId, 1, new Date(Date.now() + 3600_000));
  await drain(pool, handlers, new Date("2027-01-01T00:00:00Z"));

  const club = fx.clubIds[0]!;
  const match = await pool.query<{ id: string }>(
    "SELECT id FROM match WHERE league_id = $1 LIMIT 1", [fx.leagueId]);

  const responses = await Promise.all([
    get(`/api/leagues/${fx.leagueId}/state`, club),
    get(`/api/leagues/${fx.leagueId}/market`, club),
    get(`/api/leagues/${fx.leagueId}/feed`, club),
    get(`/api/clubs/${club}/squad`, club),
    get(`/api/clubs/${fx.clubIds[1]!}/squad`, club),
    get(`/api/clubs/${club}/events`, club),
    get(`/api/matches/${match.rows[0]!.id}/ticker`, club),
  ]);

  for (const response of responses) {
    const leaks = findForbiddenFields(response.body);
    assert.deepEqual(leaks, [],
      "Verbotene Felder in der Antwort: " + leaks.join(", "));
  }
});

test("Das verdeckte Potenzial verlässt den Server nie", async () => {
  const fx = await seedLeagueWithMarket(pool, 3);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });

  const club = fx.clubIds[0]!;
  const { body } = await get(`/api/clubs/${club}/squad`, club);
  const players = body.players as { potential: { min: number; max: number } }[];
  assert.ok(players.length > 0);

  const raw = JSON.stringify(body);
  assert.ok(!raw.includes("true_potential") && !raw.includes("truePotential"),
    "Das wahre Potenzial darf in keiner Form ausgeliefert werden");

  // Stattdessen nur eine Spanne mit Vertrauensangabe
  for (const player of players) {
    assert.ok(player.potential.max >= player.potential.min);
  }
});

test("Fremde Kader zeigen weder Moral noch Gehalt", async () => {
  const fx = await seedLeagueWithMarket(pool, 3);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });

  const own = await get(`/api/clubs/${fx.clubIds[0]!}/squad`, fx.clubIds[0]!);
  const foreign = await get(`/api/clubs/${fx.clubIds[1]!}/squad`, fx.clubIds[0]!);

  const ownPlayer = (own.body.players as Record<string, unknown>[])[0]!;
  const foreignPlayer = (foreign.body.players as Record<string, unknown>[])[0]!;

  assert.ok("morale" in ownPlayer, "Der eigene Kader zeigt die Moral");
  assert.ok("wage" in ownPlayer, "Der eigene Kader zeigt die Gehälter");
  assert.ok(!("morale" in foreignPlayer), "Fremde Moral bleibt verborgen");
  assert.ok(!("wage" in foreignPlayer), "Fremde Gehälter bleiben verborgen");

  // Marktwert und Stärke sind bewusst öffentlich — ohne sie gäbe es keine
  // Einschätzung der Konkurrenz und damit keine Konkurrenz
  assert.ok("marketValue" in foreignPlayer);
  assert.ok("overall" in foreignPlayer);
});

test("Der Kassenstand fremder Vereine bleibt privat", async () => {
  const fx = await seedLeagueWithMarket(pool, 3);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });

  const { body } = await get(`/api/leagues/${fx.leagueId}/state`, fx.clubIds[0]!);
  const table = body.table as Record<string, unknown>[];

  const own = table.find((row) => row.id === fx.clubIds[0]!)!;
  const others = table.filter((row) => row.id !== fx.clubIds[0]!);

  assert.ok("cash" in own && "availableFunds" in own,
    "Der eigene Verein sieht Kasse und verfügbares Budget");
  for (const other of others) {
    assert.ok(!("cash" in other), "Fremde Kassenstände legen jede Auktionsstrategie offen");
    assert.ok(!("availableFunds" in other));
    // Fanzahl und Stimmung sind öffentlich — sie sind die Grundlage der
    // Schadenfreude
    assert.ok("fanMood" in other && "fanCount" in other);
  }
});

test("Nur das eigene Proxy-Maximum ist sichtbar", async () => {
  const fx = await seedLeagueWithMarket(pool, 3);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await refreshMarket(pool, fx.leagueId, 1, new Date(Date.now() + 3600_000));

  // Eine Auktion ohne bestehendes Gebot wählen und sicher darüber bieten.
  // Zwei Fallstricke stecken hier: Ohne feste Sortierung erwischt LIMIT 1 mal
  // einen Weltklassespieler, dessen Mindestpreis über dem Gebot liegt. Und auf
  // Auktionen mit laufendem Gebot hat oft schon die Außenwelt geboten, die bis
  // 90 Prozent des Marktwerts geht — dann wird das Gebot zwar angenommen,
  // führt aber nicht.
  const auctions = await pool.query<{ id: string; min_price: number }>(
    `SELECT id, min_price FROM auction
      WHERE league_id = $1 AND status = 'open' AND current_bid IS NULL
      ORDER BY min_price, id LIMIT 1`,
    [fx.leagueId]);
  if (auctions.rows.length === 0) return;
  const auctionId = auctions.rows[0]!.id;
  const amount = auctions.rows[0]!.min_price + 1_000_000;

  const bidder = fx.clubIds[0]!, rival = fx.clubIds[1]!;
  const bid = await post(`/api/auctions/${auctionId}/bid`, { maxAmount: amount }, bidder);
  assert.equal(bid.status, 200);

  const asBidder = await get(`/api/leagues/${fx.leagueId}/market`, bidder);
  const asRival = await get(`/api/leagues/${fx.leagueId}/market`, rival);

  const own = (asBidder.body.auctions as Record<string, unknown>[])
    .find((row) => row.id === auctionId)!;
  const foreign = (asRival.body.auctions as Record<string, unknown>[])
    .find((row) => row.id === auctionId)!;

  assert.equal(own.yourMaximum, amount);
  assert.ok(!("yourMaximum" in foreign),
    "Das Maximum eines Gegners zu kennen, entscheidet jeden Bieterkrieg");

  // Der Bietername ist dagegen bewusst sichtbar (GDD F14)
  assert.ok(foreign.leaderName, "Bieter sind namentlich sichtbar");
  assert.equal(foreign.leaderIsYou, false);
  assert.equal(own.leaderIsYou, true);
});

test("Der Posteingang eines anderen Vereins ist gesperrt", async () => {
  const fx = await seedLeagueWithMarket(pool, 3);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });

  const response = await get(`/api/clubs/${fx.clubIds[1]!}/events`, fx.clubIds[0]!);
  assert.equal(response.status, 403);
});

test("Ohne Verein kann nicht geboten werden", async () => {
  const fx = await seedLeagueWithMarket(pool, 3);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await refreshMarket(pool, fx.leagueId, 1, new Date(Date.now() + 3600_000));

  const auctions = await pool.query<{ id: string }>(
    "SELECT id FROM auction WHERE league_id = $1 AND status = 'open' LIMIT 1", [fx.leagueId]);
  if (auctions.rows.length === 0) return;

  const response = await post(
    `/api/auctions/${auctions.rows[0]!.id}/bid`, { maxAmount: 10_000_000 });
  assert.equal(response.status, 401);
});

test("Unsinnige Gebote werden abgewiesen", async () => {
  const fx = await seedLeagueWithMarket(pool, 3);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await refreshMarket(pool, fx.leagueId, 1, new Date(Date.now() + 3600_000));

  const auctions = await pool.query<{ id: string }>(
    "SELECT id FROM auction WHERE league_id = $1 AND status = 'open' LIMIT 1", [fx.leagueId]);
  if (auctions.rows.length === 0) return;
  const url = `/api/auctions/${auctions.rows[0]!.id}/bid`;
  const club = fx.clubIds[0]!;

  for (const payload of [
    { maxAmount: -5 }, { maxAmount: 0 }, { maxAmount: "viel" }, {},
  ]) {
    const response = await post(url, payload, club);
    assert.equal(response.status, 400, `${JSON.stringify(payload)} muss abgelehnt werden`);
  }
});

test("Ein fremdes Ereignis kann nicht entschieden werden", async () => {
  const fx = await seedLeagueWithMarket(pool, 3);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await drain(pool, handlers, new Date("2027-01-01T00:00:00Z"));

  const event = await pool.query<{ id: string; club_id: string }>(
    "SELECT id, club_id FROM club_event WHERE league_id = $1 LIMIT 1", [fx.leagueId]);
  if (event.rows.length === 0) return;

  const other = fx.clubIds.find((id) => id !== event.rows[0]!.club_id)!;
  const response = await post(
    `/api/events/${event.rows[0]!.id}/resolve`, { option: 0 }, other);
  assert.equal(response.status, 403);
});

test("Der Markt liefert Auktionen samt Spielern", async () => {
  const fx = await seedLeagueWithMarket(pool, 4);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await refreshMarket(pool, fx.leagueId, 1, new Date(Date.now() + 3600_000));

  const { body } = await get(`/api/leagues/${fx.leagueId}/market`, fx.clubIds[0]!);
  const auctions = body.auctions as { playerId: string }[];
  const players = body.players as { id: string; name: string }[];

  assert.ok(auctions.length > 0, "Der Markt muss offene Auktionen zeigen");
  const known = new Set(players.map((player) => player.id));
  for (const auction of auctions) {
    assert.ok(known.has(auction.playerId),
      "Zu jeder Auktion muss der Spieler mitgeliefert werden");
  }
  assert.ok(players.every((player) => player.name.length > 1));
});

test("Ein Gebot über die Schnittstelle wirkt", async () => {
  const fx = await seedLeagueWithMarket(pool, 3);
  await startSeason(pool, fx.leagueId, { year: 2026, month: 5, day: 4 });
  await refreshMarket(pool, fx.leagueId, 1, new Date(Date.now() + 3600_000));

  const auction = await pool.query<{ id: string; min_price: number }>(
    `SELECT id, min_price FROM auction
      WHERE league_id = $1 AND status = 'open' ORDER BY min_price LIMIT 1`, [fx.leagueId]);
  if (auction.rows.length === 0) return;

  const amount = auction.rows[0]!.min_price + 5_000_000;
  const response = await post(
    `/api/auctions/${auction.rows[0]!.id}/bid`, { maxAmount: amount }, fx.clubIds[0]!);

  assert.equal(response.status, 200);
  assert.equal(response.body.leaderIsYou, true);

  const stored = await pool.query<{ current_bidder_club_id: string }>(
    "SELECT current_bidder_club_id FROM auction WHERE id = $1", [auction.rows[0]!.id]);
  assert.equal(stored.rows[0]!.current_bidder_club_id, fx.clubIds[0]!);
});
