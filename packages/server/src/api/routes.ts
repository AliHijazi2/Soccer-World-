/**
 * HTTP-Schnittstelle.
 *
 * Der Client sendet ausschließlich **Absichten** — "biete 42 Mio", "stelle
 * diese Elf auf", "wähle Option 2". Jede wird hier vollständig neu validiert;
 * nichts, was der Client schickt, wird geglaubt (Architektur §9).
 *
 * In der Gegenrichtung verlässt kein Objekt den Server, ohne durch
 * `projections.ts` gegangen zu sein.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";

import { placeBid } from "../domain/auction.ts";
import { readEvents, resolveEvent } from "../domain/events.ts";
import { readFeed, readTicker } from "../domain/feed.ts";
import { listForSale } from "../domain/market.ts";
import type { Pool } from "../db/pool.ts";
import {
  toPublicAuction, toPublicClub, toPublicPlayer,
  type AuctionRow, type ClubRow, type PlayerRow,
} from "./projections.ts";

/**
 * Wer ist das?
 *
 * Für den MVP reicht ein Vereins-Header. Eine echte Anmeldung per
 * E-Mail-Magic-Link kommt beim Ausbau — Passwörter sind reine Haftung
 * (Architektur §14).
 */
function viewerClub(request: FastifyRequest): string | null {
  const header = request.headers["x-club-id"];
  return typeof header === "string" && header.length > 0 ? header : null;
}

const PLAYER_COLUMNS = `
  p.id, t.full_name, p.age, p.primary_position, p.overall, p.attributes,
  p.traits, p.form, p.fitness, p.morale, p.injured_until_matchday,
  p.suspension_matches, p.market_value, p.wage_per_matchday, p.club_id,
  p.true_potential, t.potential_min, t.potential_max`;

export function registerRoutes(app: FastifyInstance, pool: Pool): void {
  // ── Liga ────────────────────────────────────────────────────────────────

  app.get("/api/leagues/:leagueId/state", async (request) => {
    const { leagueId } = request.params as { leagueId: string };
    const viewer = viewerClub(request);

    const league = await pool.query<{
      id: string; name: string; status: string;
      current_season: number; current_matchday: number;
    }>(
      `SELECT id, name, status, current_season, current_matchday
         FROM league WHERE id = $1`, [leagueId]);
    if (league.rows.length === 0) return { error: "not_found" };

    const clubs = await pool.query<ClubRow & { points: number; played: number;
      won: number; drawn: number; lost: number; goals_for: number; goals_against: number }>(
      `SELECT c.*, COALESCE(s.points,0) AS points, COALESCE(s.played,0) AS played,
              COALESCE(s.won,0) AS won, COALESCE(s.drawn,0) AS drawn,
              COALESCE(s.lost,0) AS lost, COALESCE(s.goals_for,0) AS goals_for,
              COALESCE(s.goals_against,0) AS goals_against
         FROM club c
         LEFT JOIN standing s ON s.club_id = c.id AND s.season = $2
        WHERE c.league_id = $1 AND NOT c.is_outside_world
        ORDER BY (COALESCE(s.points,0)::numeric / NULLIF(s.played,0)) DESC NULLS LAST,
                 (COALESCE(s.goals_for,0) - COALESCE(s.goals_against,0)) DESC`,
      [leagueId, league.rows[0]!.current_season]);

    const funds = viewer ? await availableFunds(pool, viewer) : undefined;

    return {
      league: league.rows[0],
      table: clubs.rows.map((row) => ({
        ...toPublicClub(row, viewer, row.id === viewer ? funds : undefined),
        played: row.played, won: row.won, drawn: row.drawn, lost: row.lost,
        goalsFor: row.goals_for, goalsAgainst: row.goals_against, points: row.points,
      })),
    };
  });

  // ── Kader ───────────────────────────────────────────────────────────────

  app.get("/api/clubs/:clubId/squad", async (request) => {
    const { clubId } = request.params as { clubId: string };
    const viewer = viewerClub(request);

    const { rows } = await pool.query<PlayerRow>(
      `SELECT ${PLAYER_COLUMNS}
         FROM player_instance p JOIN player_template t ON t.id = p.template_id
        WHERE p.club_id = $1 ORDER BY p.overall DESC`, [clubId]);

    return { players: rows.map((row) => toPublicPlayer(row, viewer)) };
  });

  // ── Markt ───────────────────────────────────────────────────────────────

  app.get("/api/leagues/:leagueId/market", async (request) => {
    const { leagueId } = request.params as { leagueId: string };
    const viewer = viewerClub(request);

    const auctions = await pool.query<AuctionRow>(
      `SELECT a.id, a.player_instance_id, a.seller_club_id, a.min_price,
              a.current_bid, a.current_bidder_club_id, c.name AS current_bidder_name,
              a.closes_at, a.status
         FROM auction a LEFT JOIN club c ON c.id = a.current_bidder_club_id
        WHERE a.league_id = $1 AND a.status = 'open'
        ORDER BY a.closes_at`, [leagueId]);
    if (auctions.rows.length === 0) return { auctions: [], players: [] };

    const players = await pool.query<PlayerRow>(
      `SELECT ${PLAYER_COLUMNS}
         FROM player_instance p JOIN player_template t ON t.id = p.template_id
        WHERE p.id = ANY($1)`,
      [auctions.rows.map((row) => row.player_instance_id)]);

    // Nur die eigenen Maxima laden — fremde dürfen den Server nicht verlassen
    const own = viewer ? await pool.query<{ auction_id: string; max_amount: number }>(
      `SELECT auction_id, MAX(max_amount)::bigint AS max_amount FROM bid
        WHERE club_id = $1 AND auction_id = ANY($2) GROUP BY auction_id`,
      [viewer, auctions.rows.map((row) => row.id)]) : null;
    const ownMax = new Map(own?.rows.map((row) => [row.auction_id, row.max_amount]) ?? []);

    const scouts = viewer ? await pool.query<{
      player_instance_id: string; revealed_min: number; revealed_max: number;
      traits_revealed: boolean;
    }>(
      `SELECT player_instance_id, revealed_min, revealed_max, traits_revealed
         FROM scout_report WHERE club_id = $1`, [viewer]) : null;
    const scoutByPlayer = new Map(scouts?.rows.map((row) => [row.player_instance_id, {
      revealedMin: row.revealed_min, revealedMax: row.revealed_max,
      traitsRevealed: row.traits_revealed,
    }]) ?? []);

    return {
      auctions: auctions.rows.map((row) =>
        toPublicAuction(row, viewer, ownMax.get(row.id))),
      players: players.rows.map((row) =>
        toPublicPlayer(row, viewer, scoutByPlayer.get(row.id))),
    };
  });

  app.post("/api/auctions/:auctionId/bid", async (request, reply) => {
    const { auctionId } = request.params as { auctionId: string };
    const viewer = viewerClub(request);
    if (!viewer) return reply.code(401).send({ error: "no_club" });

    const body = request.body as { maxAmount?: unknown };
    const maxAmount = Number(body?.maxAmount);
    if (!Number.isFinite(maxAmount) || maxAmount <= 0) {
      return reply.code(400).send({ error: "invalid_amount" });
    }

    const result = await placeBid(pool, { auctionId, clubId: viewer, maxAmount });
    if (!result.ok) return reply.code(409).send({ error: result.reason });
    return {
      leaderIsYou: result.youLead,
      displayPrice: result.displayPrice,
      closesAt: result.closesAt.toISOString(),
    };
  });

  app.post("/api/players/:playerId/list", async (request, reply) => {
    const { playerId } = request.params as { playerId: string };
    const viewer = viewerClub(request);
    if (!viewer) return reply.code(401).send({ error: "no_club" });

    const body = request.body as { minPrice?: unknown; hours?: unknown };
    const minPrice = Number(body?.minPrice);
    const hours = Number(body?.hours ?? 24);
    if (!Number.isFinite(minPrice) || minPrice < 0) {
      return reply.code(400).send({ error: "invalid_price" });
    }

    const result = await listForSale(pool, viewer, playerId, Math.round(minPrice),
      new Date(Date.now() + hours * 3600_000));
    if (!result.ok) return reply.code(409).send({ error: result.reason });
    return { auctionId: result.auctionId };
  });

  // ── Feed und Ticker ─────────────────────────────────────────────────────

  app.get("/api/leagues/:leagueId/feed", async (request) => {
    const { leagueId } = request.params as { leagueId: string };
    const limit = Math.min(Number((request.query as { limit?: string }).limit ?? 30), 100);
    const client = await pool.connect();
    try {
      return { items: await readFeed(client, leagueId, limit) };
    } finally { client.release(); }
  });

  app.get("/api/matches/:matchId/ticker", async (request) => {
    const { matchId } = request.params as { matchId: string };
    const client = await pool.connect();
    try {
      const match = await client.query<{
        home_goals: number; away_goals: number; status: string;
        home: string; away: string; matchday: number;
      }>(
        `SELECT m.home_goals, m.away_goals, m.status, m.matchday,
                h.name AS home, a.name AS away
           FROM match m JOIN club h ON h.id = m.home_club_id
                        JOIN club a ON a.id = m.away_club_id
          WHERE m.id = $1`, [matchId]);
      if (match.rows.length === 0) return { error: "not_found" };
      return { match: match.rows[0], lines: await readTicker(client, matchId) };
    } finally { client.release(); }
  });

  // ── Posteingang ─────────────────────────────────────────────────────────

  app.get("/api/clubs/:clubId/events", async (request, reply) => {
    const { clubId } = request.params as { clubId: string };
    const viewer = viewerClub(request);
    // Der Posteingang eines anderen Vereins geht niemanden etwas an
    if (viewer !== clubId) return reply.code(403).send({ error: "forbidden" });

    const client = await pool.connect();
    try {
      return { events: await readEvents(client, clubId, 20) };
    } finally { client.release(); }
  });

  app.post("/api/events/:eventId/resolve", async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const viewer = viewerClub(request);
    if (!viewer) return reply.code(401).send({ error: "no_club" });

    const owner = await pool.query<{ club_id: string }>(
      "SELECT club_id FROM club_event WHERE id = $1", [eventId]);
    if (owner.rows.length === 0) return reply.code(404).send({ error: "not_found" });
    if (owner.rows[0]!.club_id !== viewer) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const option = Number((request.body as { option?: unknown })?.option);
    if (!Number.isInteger(option) || option < 0) {
      return reply.code(400).send({ error: "invalid_option" });
    }

    const result = await resolveEvent(pool, eventId, option);
    if (!result.ok) return reply.code(409).send({ error: result.reason });
    return { ok: true };
  });
}

async function availableFunds(pool: Pool, clubId: string): Promise<number> {
  const { rows } = await pool.query<{ available: number }>(
    `SELECT c.cash - COALESCE((
        SELECT SUM(e.amount) FROM escrow_hold e
         WHERE e.club_id = c.id AND e.released_at IS NULL), 0) AS available
       FROM club c WHERE c.id = $1`, [clubId]);
  return rows[0]?.available ?? 0;
}
