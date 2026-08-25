/**
 * Die Aufbauphase (GDD §2.4).
 *
 * Zwischen Lobbystart und erstem Anstoß ist der gesamte aktive Marktpool
 * ausgeschrieben — es gibt keine Draft-Zeremonie, man bietet sofort. Nach
 * Ablauf der Frist startet die Liga, ob die Kader fertig sind oder nicht.
 */

import type { Pool, PoolClient } from "../db/pool.ts";
import { inTransaction } from "../db/pool.ts";
import { listFreeAgent } from "./market.ts";
import { enqueue } from "../scheduler/runner.ts";

/** Mindestkader nach GDD §2.4 */
export const SQUAD_MINIMUM = { total: 14, goalkeepers: 1, defenders: 3 } as const;

const DEFENDER_POSITIONS = ["CB", "RB", "LB"];

/** Zwangszuteilung kostet Aufschlag — sie ist eine Strafe, keine Hilfe (GDD §2.4) */
const FORCED_WAGE_FACTOR = 1.2;

/**
 * Schreibt den kompletten aktiven Pool aus.
 *
 * Anders als der laufende Markt, der täglich ein paar Spieler nachlegt, liegt
 * hier alles auf einmal auf dem Tisch: Die Freunde sollen ihre Kader
 * gegeneinander bauen, und dafür müssen sie sehen, worum sie konkurrieren.
 */
export async function openInitialMarket(
  pool: Pool, leagueId: string, closesAt: Date, now = new Date(),
): Promise<number> {
  return inTransaction(pool, async (client) => {
    const free = await client.query<{ id: string }>(
      `SELECT p.id FROM player_instance p
        WHERE p.league_id = $1 AND p.club_id IS NULL AND p.pool_state = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM auction a WHERE a.player_instance_id = p.id
              AND a.status IN ('open','awaiting_seller'))
        ORDER BY p.overall DESC, p.id`,
      [leagueId]);

    let opened = 0;
    for (const [index, row] of free.rows.entries()) {
      const auctionId = await listFreeAgent(client, leagueId, row.id, now, closesAt);
      if (!auctionId) continue;
      opened++;
      // Gestaffelt, damit der Abschluss eine Stunde Nervenkitzel wird statt
      // eines einzigen Augenblicks (GDD §6.3)
      await enqueue(client, {
        leagueId, type: "close_auction",
        payload: { auctionId },
        runAt: new Date(closesAt.getTime() + index * 60 * 1000),
        idempotencyKey: `market_close:${auctionId}:lobby`,
      });
    }
    return opened;
  });
}

interface ShortSquad {
  clubId: string;
  missingTotal: number;
  missingGoalkeepers: number;
  missingDefenders: number;
}

async function findShortSquads(
  client: PoolClient, leagueId: string,
): Promise<ShortSquad[]> {
  const { rows } = await client.query<{
    club_id: string; total: number; keepers: number; defenders: number;
  }>(
    `SELECT c.id AS club_id,
            COUNT(p.id)::int AS total,
            COUNT(p.id) FILTER (WHERE p.primary_position = 'GK')::int AS keepers,
            COUNT(p.id) FILTER (WHERE p.primary_position = ANY($2))::int AS defenders
       FROM club c
       LEFT JOIN player_instance p ON p.club_id = c.id
      WHERE c.league_id = $1 AND NOT c.is_outside_world
      GROUP BY c.id
      ORDER BY c.created_at, c.id`,
    [leagueId, DEFENDER_POSITIONS]);

  return rows
    .map((row) => ({
      clubId: row.club_id,
      missingTotal: Math.max(0, SQUAD_MINIMUM.total - row.total),
      missingGoalkeepers: Math.max(0, SQUAD_MINIMUM.goalkeepers - row.keepers),
      missingDefenders: Math.max(0, SQUAD_MINIMUM.defenders - row.defenders),
    }))
    .filter((s) => s.missingTotal > 0 || s.missingGoalkeepers > 0 || s.missingDefenders > 0);
}

/**
 * Nimmt den schlechtesten verfügbaren freien Spieler, notfalls auf einer
 * bestimmten Position. Gibt null zurück, wenn der Bestand leer ist.
 */
async function takeWorstFreeAgent(
  client: PoolClient, leagueId: string, positions: string[] | null,
): Promise<{ id: string; wage: number } | null> {
  const { rows } = await client.query<{ id: string; wage_per_matchday: number }>(
    `SELECT id, wage_per_matchday FROM player_instance
      WHERE league_id = $1 AND club_id IS NULL
        AND ($2::text[] IS NULL OR primary_position = ANY($2))
        AND NOT EXISTS (
          SELECT 1 FROM auction a WHERE a.player_instance_id = player_instance.id
            AND a.status IN ('open','awaiting_seller'))
      ORDER BY overall ASC, id
      LIMIT 1
      FOR UPDATE SKIP LOCKED`,
    [leagueId, positions]);
  const row = rows[0];
  return row ? { id: row.id, wage: row.wage_per_matchday } : null;
}

/**
 * Füllt zu kleine Kader mit Freien Agenten auf (GDD §2.4).
 *
 * Bewusst die *schlechtesten* verfügbaren Spieler zu 120 % Gehalt: Wer die
 * Aufbauphase verschläft, soll einen Kader bekommen, der antreten kann — und
 * einen Grund, es beim nächsten Mal selbst zu tun. Ohne diese Zuteilung
 * scheitert der erste Spieltag und die ganze Liga steht.
 */
export async function assignFreeAgents(
  client: PoolClient, leagueId: string,
): Promise<{ clubId: string; assigned: number }[]> {
  const report: { clubId: string; assigned: number }[] = [];

  for (const squad of await findShortSquads(client, leagueId)) {
    let assigned = 0;
    // Erst die Pflichtpositionen, dann auffüllen — sonst bleibt ein Kader von
    // vierzehn Feldspielern ohne Torwart übrig
    const needs: (string[] | null)[] = [
      ...Array<string[]>(squad.missingGoalkeepers).fill(["GK"]),
      ...Array<string[]>(squad.missingDefenders).fill(DEFENDER_POSITIONS),
    ];
    while (needs.length < squad.missingTotal) needs.push(null);

    for (const positions of needs) {
      const player = await takeWorstFreeAgent(client, leagueId, positions)
        // Ist die Position erschöpft, zählt nur noch, dass elf Mann auflaufen
        ?? (positions ? await takeWorstFreeAgent(client, leagueId, null) : null);
      if (!player) break;

      await client.query(
        `UPDATE player_instance
            SET club_id = $2, pool_state = 'active', wage_per_matchday = $3
          WHERE id = $1`,
        [player.id, squad.clubId, Math.round(player.wage * FORCED_WAGE_FACTOR)]);
      await client.query(
        `INSERT INTO transfer
           (league_id, player_instance_id, from_club_id, to_club_id, fee, tax,
            channel, season, matchday)
         VALUES ($1, $2, NULL, $3, 0, 0, 'assignment', 1, 0)`,
        [leagueId, player.id, squad.clubId]);
      assigned++;
    }
    if (assigned > 0) report.push({ clubId: squad.clubId, assigned });
  }
  return report;
}
