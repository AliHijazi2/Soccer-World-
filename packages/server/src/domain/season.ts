/**
 * Saisonstart und Jobkette (Architektur §5).
 *
 * Der Spielplan wird einmal erzeugt, danach plant sich die Jobkette selbst
 * fort: `run_matchday` für Spieltag n legt am Ende `run_matchday` für n+1 an.
 * Es gibt damit keinen globalen Zeitplan, der aus dem Tritt geraten kann.
 */

import { hashSeed } from "../../../shared/src/rules/rng.ts";
import {
  SEASON, generateFixtures, marketCloseAt, planKickoffs,
} from "../../../shared/src/rules/schedule.ts";
import { inTransaction, type Pool } from "../db/pool.ts";
import { enqueue, type Job, type JobHandler } from "../scheduler/runner.ts";
import { runMatchday } from "./matchday.ts";
import { settleAuction } from "./auction.ts";

export const JOB = {
  RUN_MATCHDAY: "run_matchday",
  CLOSE_AUCTION: "close_auction",
} as const;

export function matchdayKey(leagueId: string, season: number, matchday: number): string {
  return `matchday:${leagueId}:s${season}:md${matchday}`;
}

export interface StartSeasonResult {
  matchesCreated: number;
  firstKickoff: Date;
}

/**
 * Legt Spielplan, Partien und den Job für Spieltag 1 an.
 *
 * Verlangt eine gerade Vereinszahl — bei ungerader Zahl muss vorher ein
 * Bot-Verein ergänzt worden sein (GDD §9.5). Der Spielplangenerator wirft
 * sonst, statt still einen kaputten Plan zu erzeugen.
 */
export async function startSeason(
  pool: Pool, leagueId: string, seasonStart: { year: number; month: number; day: number },
): Promise<StartSeasonResult> {
  return inTransaction(pool, async (client) => {
    const leagueResult = await client.query<{
      current_season: number; timezone: string; rng_salt: number;
      kickoff_times: string[]; market_close_from: string;
    }>(
      `SELECT current_season, timezone, rng_salt, kickoff_times, market_close_from
         FROM league WHERE id = $1 FOR UPDATE`, [leagueId]);
    const league = leagueResult.rows[0];
    if (!league) throw new Error(`Liga ${leagueId} nicht gefunden`);
    const season = league.current_season;

    const clubsResult = await client.query<{ id: string }>(
      "SELECT id FROM club WHERE league_id = $1 ORDER BY created_at, id", [leagueId]);
    const clubs = clubsResult.rows.map((row) => row.id);

    const existing = await client.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM match WHERE league_id = $1 AND season = $2",
      [leagueId, season]);
    if ((existing.rows[0]?.n ?? 0) > 0) {
      throw new Error(`Saison ${season} der Liga ${leagueId} hat bereits einen Spielplan`);
    }

    const fixtures = generateFixtures(clubs.length);
    const kickoffs = planKickoffs(
      seasonStart, league.kickoff_times, league.timezone, SEASON.MATCHDAYS);
    const kickoffByMatchday = new Map(kickoffs.map((k) => [k.matchday, k.kickoffAt]));

    for (const [index, clubId] of clubs.entries()) {
      await client.query("UPDATE club SET squad_index = $2 WHERE id = $1", [clubId, index]);
      await client.query(
        `INSERT INTO standing (league_id, season, club_id) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`, [leagueId, season, clubId]);
    }

    for (const fixture of fixtures) {
      const home = clubs[fixture.homeIndex]!;
      const away = clubs[fixture.awayIndex]!;
      const kickoffAt = kickoffByMatchday.get(fixture.matchday)!;
      // Der Seed wird beim Anlegen bestimmt und gespeichert — dieselbe Partie
      // ergibt später immer dasselbe Ergebnis (Architektur §7).
      const seed = hashSeed(leagueId, season, fixture.matchday, home, away, league.rng_salt);
      await client.query(
        `INSERT INTO match
           (league_id, season, matchday, home_club_id, away_club_id, kickoff_at, seed)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [leagueId, season, fixture.matchday, home, away, kickoffAt, seed]);
    }

    const firstKickoff = kickoffByMatchday.get(1)!;
    await client.query(
      `UPDATE league SET status = 'running', current_matchday = 0, season_start = $2
        WHERE id = $1`,
      [leagueId, `${seasonStart.year}-${String(seasonStart.month).padStart(2, "0")}-${String(seasonStart.day).padStart(2, "0")}`]);

    await enqueue(client, {
      leagueId, type: JOB.RUN_MATCHDAY,
      payload: { season, matchday: 1 },
      runAt: firstKickoff,
      idempotencyKey: matchdayKey(leagueId, season, 1),
    });

    // Marktabschluss vor dem ersten Anstoß des Tages
    await scheduleMarketClose(client, leagueId, season, 1, firstKickoff,
      league.market_close_from, league.timezone);

    return { matchesCreated: fixtures.length, firstKickoff };
  });
}

async function scheduleMarketClose(
  client: Parameters<typeof enqueue>[0],
  leagueId: string, season: number, matchday: number,
  kickoffAt: Date, windowStart: string, timeZone: string,
): Promise<void> {
  if ((matchday - 1) % SEASON.KICKOFFS_PER_DAY !== 0) return;  // nur einmal am Tag
  const closeAt = marketCloseAt(kickoffAt, windowStart, timeZone);
  const auctions = await client.query<{ id: string }>(
    `SELECT id FROM auction WHERE league_id = $1 AND status = 'open'`, [leagueId]);
  for (const [index, auction] of auctions.rows.entries()) {
    // Gestaffelt alle zwei Minuten, damit eine Stunde Nervenkitzel entsteht
    await enqueue(client, {
      leagueId, type: JOB.CLOSE_AUCTION,
      payload: { auctionId: auction.id },
      runAt: new Date(closeAt.getTime() + index * 2 * 60 * 1000),
      idempotencyKey: `market_close:${auction.id}:md${matchday}`,
    });
  }
}

// ── Job-Handler ───────────────────────────────────────────────────────────

const runMatchdayHandler: JobHandler = async (job: Job, pool: Pool) => {
  const season = Number(job.payload.season);
  const matchday = Number(job.payload.matchday);
  if (!job.leagueId) throw new Error("run_matchday ohne Liga");

  await runMatchday(pool, job.leagueId, season, matchday);

  if (matchday >= SEASON.MATCHDAYS) {
    await pool.query(
      "UPDATE league SET status = 'between_seasons' WHERE id = $1", [job.leagueId]);
    return;
  }

  // Die Kette schreibt sich selbst fort
  const next = matchday + 1;
  const { rows } = await pool.query<{ kickoff_at: Date }>(
    `SELECT kickoff_at FROM match
      WHERE league_id = $1 AND season = $2 AND matchday = $3 LIMIT 1`,
    [job.leagueId, season, next]);
  const kickoffAt = rows[0]?.kickoff_at;
  if (!kickoffAt) throw new Error(`Kein Anstoß für Spieltag ${next} gefunden`);

  await enqueue(pool, {
    leagueId: job.leagueId, type: JOB.RUN_MATCHDAY,
    payload: { season, matchday: next },
    runAt: kickoffAt,
    idempotencyKey: matchdayKey(job.leagueId, season, next),
  });

  const league = await pool.query<{ market_close_from: string; timezone: string }>(
    "SELECT market_close_from, timezone FROM league WHERE id = $1", [job.leagueId]);
  await scheduleMarketClose(pool, job.leagueId, season, next, kickoffAt,
    league.rows[0]!.market_close_from, league.rows[0]!.timezone);
};

const closeAuctionHandler: JobHandler = async (job: Job, pool: Pool) => {
  const auctionId = String(job.payload.auctionId);
  const result = await settleAuction(pool, auctionId);

  // Ein Soft-Close kann das Ende verschoben haben: dann später erneut versuchen,
  // statt die Auktion vorzeitig zu schließen (Architektur §6).
  if (!result.ok && result.reason === "still_open") {
    const { rows } = await pool.query<{ closes_at: Date }>(
      "SELECT closes_at FROM auction WHERE id = $1", [auctionId]);
    const closesAt = rows[0]?.closes_at;
    if (closesAt) {
      await enqueue(pool, {
        leagueId: job.leagueId, type: JOB.CLOSE_AUCTION,
        payload: { auctionId },
        runAt: new Date(closesAt.getTime() + 1000),
        idempotencyKey: `market_close:${auctionId}:${closesAt.getTime()}`,
      });
    }
  }
};

export const handlers: Record<string, JobHandler> = {
  [JOB.RUN_MATCHDAY]: runMatchdayHandler,
  [JOB.CLOSE_AUCTION]: closeAuctionHandler,
};
