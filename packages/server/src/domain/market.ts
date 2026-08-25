/**
 * Der Markt im laufenden Spielbetrieb (GDD §5).
 *
 * Bisher konnten Auktionen zwar abgewickelt werden, aber niemand stellte
 * Spieler ein. Hier kommt zusammen, was den Markt am Leben hält: der aktive
 * Pool, der tägliche Nachschub, die Gebote der Außenwelt und die Meldungen im
 * Feed.
 */

import { createRng, hashSeed } from "../../../shared/src/rules/rng.ts";
import {
  MARKET, minimumPrice, newAuctionsForDay, outsideWorldBid, poolComposition,
  type Tier,
} from "../../../shared/src/rules/market.ts";
import { inTransaction, type Pool, type PoolClient } from "../db/pool.ts";
import { placeBid } from "./auction.ts";

/**
 * Zieht den aktiven Marktpool einer Liga aus dem Gesamtbestand.
 *
 * Der Rest bleibt Reserve und rückt zwischen den Saisons nach. Ohne diese
 * Skalierung gäbe es bei drei Vereinen und 150 Spielern keine Knappheit —
 * und damit keinen Bieterkrieg (GDD §5.2).
 */
export async function drawActivePool(
  client: PoolClient, leagueId: string, clubCount: number,
): Promise<Record<Tier, number>> {
  const composition = poolComposition(clubCount);

  // Erst alles in die Reserve, dann je Stufe die Besten zurückholen.
  // Der umgekehrte Weg schlägt fehl, weil der Standardwert bereits 'active'
  // ist und ungezogene Spieler damit aktiv blieben.
  await client.query(
    `UPDATE player_instance SET pool_state = 'reserve'
      WHERE league_id = $1 AND club_id IS NULL AND pool_state <> 'retired'`,
    [leagueId]);

  for (const [tier, count] of Object.entries(composition) as [Tier, number][]) {
    if (count <= 0) continue;
    await client.query(
      `UPDATE player_instance SET pool_state = 'active'
        WHERE id IN (
          SELECT p.id FROM player_instance p
            JOIN player_template t ON t.id = p.template_id
           WHERE p.league_id = $1 AND p.club_id IS NULL
             AND p.pool_state = 'reserve' AND t.tier = $2
           ORDER BY p.overall DESC
           LIMIT $3)`,
      [leagueId, tier, count]);
  }

  return composition;
}

/** Stellt einen freien Agenten in die Auktion. */
export async function listFreeAgent(
  client: PoolClient, leagueId: string, playerId: string,
  opensAt: Date, closesAt: Date,
): Promise<string | null> {
  const { rows } = await client.query<{ market_value: number }>(
    `SELECT market_value FROM player_instance
      WHERE id = $1 AND club_id IS NULL AND pool_state = 'active'`, [playerId]);
  const player = rows[0];
  if (!player) return null;

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO auction
       (league_id, player_instance_id, min_price, opens_at, closes_at, original_closes_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [leagueId, playerId, minimumPrice(player.market_value), opensAt, closesAt]);
  return inserted.rows[0]?.id ?? null;
}

export interface ListForSaleResult {
  ok: boolean;
  auctionId?: string;
  reason?: "not_found" | "not_owner" | "squad_too_small" | "already_listed";
}

/**
 * Ein Verein stellt einen eigenen Spieler zum Verkauf.
 *
 * Der Mindestkader wird hart geprüft: Wer unter vierzehn Spieler fällt, kann
 * keinen Spieltag mehr bestreiten — und drei Anstöße pro Tag verzeihen das
 * nicht.
 */
export async function listForSale(
  pool: Pool, clubId: string, playerId: string,
  minPrice: number, closesAt: Date,
): Promise<ListForSaleResult> {
  return inTransaction(pool, async (client) => {
    const { rows } = await client.query<{ league_id: string; club_id: string | null }>(
      `SELECT league_id, club_id FROM player_instance WHERE id = $1 FOR UPDATE`, [playerId]);
    const player = rows[0];
    if (!player) return { ok: false, reason: "not_found" };
    if (player.club_id !== clubId) return { ok: false, reason: "not_owner" };

    const squad = await client.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM player_instance WHERE club_id = $1", [clubId]);
    if ((squad.rows[0]?.n ?? 0) <= MARKET.MIN_SQUAD_SIZE) {
      return { ok: false, reason: "squad_too_small" };
    }

    const open = await client.query<{ id: string }>(
      `SELECT id FROM auction WHERE player_instance_id = $1
        AND status IN ('open','awaiting_seller')`, [playerId]);
    if (open.rows.length > 0) return { ok: false, reason: "already_listed" };

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO auction
         (league_id, player_instance_id, seller_club_id, min_price,
          opens_at, closes_at, original_closes_at)
       VALUES ($1, $2, $3, $4, now(), $5, $5) RETURNING id`,
      [player.league_id, playerId, clubId, minPrice, closesAt]);
    return { ok: true, auctionId: inserted.rows[0]!.id };
  });
}

export interface MarketRefreshReport {
  opened: number;
  outsideBids: number;
}

/**
 * Täglicher Marktnachschub plus Gebote der Außenwelt.
 *
 * Läuft morgens, damit die neuen Auktionen bis zum Abschluss um 16 Uhr Zeit
 * haben, sich zu füllen.
 */
export async function refreshMarket(
  pool: Pool, leagueId: string, matchday: number, closesAt: Date, now = new Date(),
): Promise<MarketRefreshReport> {
  const rng = createRng(hashSeed("market", leagueId, matchday));
  const report: MarketRefreshReport = { opened: 0, outsideBids: 0 };

  const opened = await inTransaction(pool, async (client) => {
    const free = await client.query<{ id: string }>(
      `SELECT p.id FROM player_instance p
        WHERE p.league_id = $1 AND p.club_id IS NULL AND p.pool_state = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM auction a WHERE a.player_instance_id = p.id
              AND a.status IN ('open','awaiting_seller'))
        ORDER BY p.overall DESC`,
      [leagueId]);
    if (free.rows.length === 0) return [] as string[];

    const count = Math.min(newAuctionsForDay(rng), free.rows.length);
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      // Gemischt ziehen, damit nicht immer zuerst die Besten kommen
      const index = rng.int(0, free.rows.length - 1);
      const [row] = free.rows.splice(index, 1);
      if (!row) continue;
      const auctionId = await listFreeAgent(client, leagueId, row.id, now, closesAt);
      if (auctionId) ids.push(auctionId);
    }
    return ids;
  });
  report.opened = opened.length;

  report.outsideBids = await placeOutsideBids(pool, leagueId, matchday, now);
  return report;
}

/**
 * Die Außenwelt bietet mit (GDD §5.4).
 *
 * Sie tritt als eigener, nicht spielbarer Verein auf, damit ihre Gebote
 * dieselbe Escrow-Prüfung durchlaufen wie alle anderen. Ein Sonderpfad, der
 * die Invarianten umgeht, wäre die naheliegendste Stelle für einen Fehler.
 */
async function placeOutsideBids(
  pool: Pool, leagueId: string, matchday: number, now: Date,
): Promise<number> {
  const outsideId = await ensureOutsideWorldClub(pool, leagueId);
  const rng = createRng(hashSeed("outside", leagueId, matchday));

  const { rows } = await pool.query<{
    id: string; market_value: number; current_bid: number | null;
  }>(
    `SELECT a.id, p.market_value, a.current_bid
       FROM auction a JOIN player_instance p ON p.id = a.player_instance_id
      WHERE a.league_id = $1 AND a.status = 'open' AND a.seller_club_id IS NULL
      ORDER BY a.id`,
    [leagueId]);

  let placed = 0;
  for (const auction of rows) {
    const amount = outsideWorldBid(auction.market_value, auction.current_bid, rng);
    if (amount === null) continue;
    // Die Spielzeit muss durchgereicht werden: Ein Gebot gegen die Systemuhr
    // wird abgelehnt, sobald die Simulation nicht im Jetzt läuft — im Test,
    // beim Nachholen verpasster Jobs und bei jedem Wiederanlauf.
    const result = await placeBid(pool, {
      auctionId: auction.id, clubId: outsideId, maxAmount: amount, now,
    });
    if (result.ok) placed++;
  }
  return placed;
}

/**
 * Der Verein, unter dem die Außenwelt bietet.
 *
 * Er ist als Bot markiert, taucht in keiner Tabelle auf und hat ein Budget,
 * das nie zur Neige geht — er ist keine Mannschaft, sondern ein Marktakteur.
 */
async function ensureOutsideWorldClub(pool: Pool, leagueId: string): Promise<string> {
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM club WHERE league_id = $1 AND is_outside_world`, [leagueId]);
  if (existing.rows.length > 0) {
    // Budget auffüllen, damit ein Gebot nie an der Deckung scheitert
    await pool.query(
      "UPDATE club SET cash = 2000000000 WHERE id = $1", [existing.rows[0]!.id]);
    return existing.rows[0]!.id;
  }
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO club (league_id, user_id, is_bot, is_outside_world, name, short_name, cash)
     VALUES ($1, NULL, true, true, 'Auswärtige Vereine', 'AUS', 2000000000) RETURNING id`,
    [leagueId]);
  return inserted.rows[0]!.id;
}

/** Vereine, die für den Spielplan zählen — die Außenwelt gehört nicht dazu. */
export async function playingClubs(
  client: PoolClient, leagueId: string,
): Promise<{ id: string }[]> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM club WHERE league_id = $1 AND NOT is_outside_world
      ORDER BY created_at, id`, [leagueId]);
  return rows;
}

/**
 * Ergänzt bei ungerader Spielerzahl einen Bot-Verein (GDD §9.5).
 *
 * Drei Prinzipien aus dem Design:
 * 1. Er füllt auf, er konkurriert nicht — sein Kader kommt aus dem
 *    Reservebestand, nicht aus dem aktiven Marktpool.
 * 2. Er ist der Maßstab — sein Kaderwert wird auf den Median der
 *    menschlichen Vereine kalibriert.
 * 3. Er ist sichtbar ein Bot.
 */
export async function ensureBotClub(
  client: PoolClient, leagueId: string, squadSize = 17,
): Promise<string | null> {
  const humans = await client.query<{ id: string }>(
    `SELECT id FROM club WHERE league_id = $1 AND NOT is_bot`, [leagueId]);
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM club WHERE league_id = $1 AND is_bot AND NOT is_outside_world`,
    [leagueId]);

  if (humans.rows.length % 2 === 0) {
    // Gerade Zahl: Der Bot wird nicht gebraucht und verschwindet
    if (existing.rows.length > 0) {
      await client.query(
        "UPDATE player_instance SET club_id = NULL, pool_state = 'reserve' WHERE club_id = $1",
        [existing.rows[0]!.id]);
      await client.query("DELETE FROM club WHERE id = $1", [existing.rows[0]!.id]);
    }
    return null;
  }
  if (existing.rows.length > 0) return existing.rows[0]!.id;

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO club (league_id, user_id, is_bot, name, short_name, cash)
     VALUES ($1, NULL, true, 'FC Automat', 'BOT', 400000000) RETURNING id`,
    [leagueId]);
  const botId = inserted.rows[0]!.id;

  // Kaderwert auf den Median der menschlichen Vereine (GDD §9.5)
  const median = await client.query<{ target: number }>(
    `SELECT COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (
              ORDER BY total), 300000000)::bigint AS target
       FROM (SELECT SUM(p.market_value) AS total
               FROM player_instance p JOIN club c ON c.id = p.club_id
              WHERE c.league_id = $1 AND NOT c.is_bot
              GROUP BY c.id) AS totals`, [leagueId]);
  const target = median.rows[0]?.target ?? 300_000_000;

  // Positionsgerecht aus der Reserve bestücken, nicht aus dem aktiven Pool:
  // Der Bot darf den Freunden keinen einzigen Spieler wegnehmen.
  const NEEDS = ["GK", "GK", "CB", "CB", "CB", "LB", "RB", "DM",
                 "CM", "CM", "AM", "LW", "RW", "ST", "ST", "ST", "CM"];
  let remaining = target;
  for (const [index, position] of NEEDS.slice(0, squadSize).entries()) {
    const slotsLeft = squadSize - index - 1;
    const budget = slotsLeft > 0 ? remaining / (slotsLeft + 1) : remaining;
    const { rows } = await client.query<{ id: string; market_value: number }>(
      `SELECT id, market_value FROM player_instance
        WHERE league_id = $1 AND club_id IS NULL AND pool_state = 'reserve'
          AND primary_position = $2
        ORDER BY ABS(market_value - $3::bigint) LIMIT 1`,
      [leagueId, position, Math.round(budget)]);
    const pick = rows[0];
    if (!pick) continue;
    await client.query("UPDATE player_instance SET club_id = $2 WHERE id = $1",
      [pick.id, botId]);
    remaining -= pick.market_value;
  }
  return botId;
}
