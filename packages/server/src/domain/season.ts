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
import {
  expectedPointsPerGame, expectedRank, seasonGoal,
} from "../../../shared/src/rules/economy/expectations.ts";
import {
  placementPrize, sponsorTerms, tvPerformanceShare, type SponsorProfile,
} from "../../../shared/src/rules/economy/revenue.ts";
import { inTransaction, type Pool, type PoolClient } from "../db/pool.ts";
import { enqueue, type Job, type JobHandler } from "../scheduler/runner.ts";
import { deliverEvents, resolveExpired, resolveOpen } from "./events.ts";
import { drawActivePool, ensureBotClub, refreshMarket } from "./market.ts";
import { runMatchday } from "./matchday.ts";
import { settleAuction } from "./auction.ts";

export const JOB = {
  RUN_MATCHDAY: "run_matchday",
  CLOSE_AUCTION: "close_auction",
  DELIVER_EVENTS: "deliver_events",
  REFRESH_MARKET: "refresh_market",
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

    // Bei ungerader Spielerzahl füllt ein Bot-Verein auf (GDD §9.5) — sonst
    // scheitert die Spielplanerzeugung, und zwar zu Recht
    await ensureBotClub(client, leagueId);

    // Die Außenwelt ist ein Marktakteur und spielt nicht mit (GDD §5.4)
    const clubsResult = await client.query<{ id: string }>(
      `SELECT id FROM club WHERE league_id = $1 AND NOT is_outside_world
        ORDER BY created_at, id`, [leagueId]);
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

    await setExpectations(client, leagueId, season, clubs);

    // Aktiven Marktpool ziehen, falls noch freie Spieler im Bestand sind.
    // Der Rest bleibt Reserve und rückt zwischen den Saisons nach (GDD §5.2).
    const free = await client.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM player_instance WHERE league_id = $1 AND club_id IS NULL",
      [leagueId]);
    if ((free.rows[0]?.n ?? 0) > 0) {
      await drawActivePool(client, leagueId, clubs.length);
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

  // Ereignisse kommen morgens, lange vor dem Marktabschluss (GDD §1.1)
  await enqueue(client, {
    leagueId, type: JOB.DELIVER_EVENTS,
    payload: { season, matchday },
    runAt: new Date(closeAt.getTime() - 8 * 3600 * 1000),
    idempotencyKey: `events:${leagueId}:s${season}:md${matchday}`,
  });

  // Neue Auktionen ebenfalls morgens, damit sie bis zum Abschluss Zeit haben,
  // sich zu füllen. Sie enden im selben Fenster wie alle anderen.
  await enqueue(client, {
    leagueId, type: JOB.REFRESH_MARKET,
    payload: { season, matchday, closesAt: closeAt.toISOString() },
    runAt: new Date(closeAt.getTime() - 9 * 3600 * 1000),
    idempotencyKey: `market:${leagueId}:s${season}:md${matchday}`,
  });
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

/**
 * Legt Erwartungswerte, Saisonziele und Sponsoren fest.
 *
 * Der teuerste Kader bekommt "Meister werden", der billigste "Nicht Letzter".
 * Beides steht danach fest — eine Erwartung, die sich innerhalb der Saison
 * mitbewegt, könnte man einfach abhängen und wäre wirkungslos (GDD §11.2).
 */
async function setExpectations(
  client: PoolClient, leagueId: string, season: number, clubs: readonly string[],
): Promise<void> {
  const values: number[] = [];
  for (const clubId of clubs) {
    const { rows } = await client.query<{ total: number }>(
      `SELECT COALESCE(SUM(market_value), 0)::bigint AS total
         FROM player_instance WHERE club_id = $1`, [clubId]);
    values.push(rows[0]?.total ?? 0);
  }
  const average = values.reduce((sum, value) => sum + value, 0) / Math.max(clubs.length, 1);

  // Sponsorenwahl in inverser Reihenfolge der Kaderwerte: Wer wenig hat, wählt
  // zuerst (GDD §14.1). Das schwächste Team bekommt das lukrativste Angebot.
  const profiles: SponsorProfile[] = ["safe", "performance", "controversial"];

  for (const [index, clubId] of clubs.entries()) {
    const rank = expectedRank(values, index);
    const ppg = expectedPointsPerGame(values[index]!, average);

    await client.query(
      `UPDATE club SET squad_index = $2, expected_ppg = $3, season_goal = $4,
                       season_start_squad_value = $5
        WHERE id = $1`,
      [clubId, index, ppg, seasonGoal(rank, clubs.length), values[index]!]);
    await client.query(
      `INSERT INTO standing (league_id, season, club_id) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`, [leagueId, season, clubId]);

    const terms = sponsorTerms(profiles[index % profiles.length]!);
    await client.query(
      `INSERT INTO sponsor_contract
         (club_id, slot, sponsor_name, profile, base_per_matchday,
          bonus_per_win, title_bonus, mood_per_matchday, until_season)
       VALUES ($1, 'shirt', $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (club_id, slot) DO NOTHING`,
      [clubId, `Sponsor ${terms.profile}`, terms.profile, terms.basePerMatchday,
       terms.bonusPerWin, terms.titleBonus, terms.moodPerMatchday, season]);
    if (terms.moodImmediate !== 0) {
      await client.query(
        "UPDATE club SET fan_mood = GREATEST(0, fan_mood + $2) WHERE id = $1",
        [clubId, terms.moodImmediate]);
    }
  }
}

export interface SeasonFinishRow {
  clubId: string; rank: number; points: number;
  placementPrize: number; tvShare: number; titleBonus: number;
}

/**
 * Saisonabschluss: Platzierungsprämie und leistungsabhängiger TV-Anteil.
 *
 * Bewusst flach gehalten — sportlicher Erfolg soll Ruhm bringen, nicht
 * ökonomische Unschlagbarkeit (GDD §9.3).
 */
export async function finishSeason(
  pool: Pool, leagueId: string, season: number,
): Promise<SeasonFinishRow[]> {
  return inTransaction(pool, async (client) => {
    const standings = await client.query<{
      club_id: string; points: number; played: number;
      goals_for: number; goals_against: number; fan_count: number;
    }>(
      `SELECT s.club_id, s.points, s.played, s.goals_for, s.goals_against, c.fan_count
         FROM standing s JOIN club c ON c.id = s.club_id
        WHERE s.league_id = $1 AND s.season = $2
        ORDER BY (s.points::numeric / NULLIF(s.played, 0)) DESC NULLS LAST,
                 (s.goals_for - s.goals_against) DESC, s.goals_for DESC`,
      [leagueId, season]);

    const clubCount = standings.rows.length;
    const totalFans = standings.rows.reduce((sum, row) => sum + row.fan_count, 0) || 1;
    const result: SeasonFinishRow[] = [];

    for (const [index, row] of standings.rows.entries()) {
      const rank = index + 1;
      const prize = placementPrize(rank, clubCount);
      const tv = tvPerformanceShare(rank, clubCount, row.fan_count / totalFans);

      const sponsor = await client.query<{ title_bonus: number }>(
        "SELECT COALESCE(SUM(title_bonus), 0)::bigint AS title_bonus FROM sponsor_contract WHERE club_id = $1",
        [row.club_id]);
      const titleBonus = rank === 1 ? (sponsor.rows[0]?.title_bonus ?? 0) : 0;

      for (const [category, amount, text] of [
        ["prize", prize, "Platzierungsprämie"],
        // Eigene Kategorie: Sockel und Leistungsanteil in einen Topf zu werfen
        // macht die Bilanz unlesbar — man sieht dann nicht mehr, wie viel
        // solidarisch verteilt wurde und wie viel am Erfolg hing.
        ["tv_bonus", tv, "TV-Leistungsanteil"],
        ["sponsor", titleBonus, "Meisterbonus des Sponsors"],
      ] as const) {
        if (amount === 0) continue;
        await client.query(
          `INSERT INTO ledger_entry
             (league_id, club_id, season, matchday, category, amount, description)
           VALUES ($1, $2, $3, 21, $4, $5, $6)`,
          [leagueId, row.club_id, season, category, amount, text]);
        await client.query("UPDATE club SET cash = cash + $2 WHERE id = $1",
          [row.club_id, amount]);
      }

      result.push({
        clubId: row.club_id, rank, points: row.points,
        placementPrize: prize, tvShare: tv, titleBonus,
      });
    }
    return result;
  });
}

// ── Job-Handler ───────────────────────────────────────────────────────────

const runMatchdayHandler: JobHandler = async (job: Job, pool: Pool) => {
  const season = Number(job.payload.season);
  const matchday = Number(job.payload.matchday);
  if (!job.leagueId) throw new Error("run_matchday ohne Liga");

  // Abgelaufene Ereignisse zuerst: Wer nicht reagiert hat, bekommt die neutrale
  // Antwort, und zwar bevor der Spieltag angepfiffen wird.
  // Maßgeblich ist die Anstoßzeit des Jobs, nicht die Systemuhr — sonst hängt
  // das Verhalten davon ab, wann der Prozess zufällig läuft.
  await resolveExpired(pool, job.runAt);
  await runMatchday(pool, job.leagueId, season, matchday);

  if (matchday >= SEASON.MATCHDAYS) {
    // Am Saisonende darf kein Ereignis offen liegen bleiben — es gäbe keinen
    // Spieltag mehr, an dem es aufgelöst würde
    await resolveOpen(pool, job.leagueId);
    await finishSeason(pool, job.leagueId, season);
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

/**
 * Stellt die Ereignisse eines Tages zu.
 *
 * Läuft zum Tagesbeginn, nicht nach jedem Spieltag — sonst wären es über
 * dreißig Entscheidungen pro Woche (GDD §10.2).
 */
const deliverEventsHandler: JobHandler = async (job: Job, pool: Pool) => {
  if (!job.leagueId) throw new Error("deliver_events ohne Liga");
  await deliverEvents(pool, job.leagueId,
    Number(job.payload.season), Number(job.payload.matchday));
};

/** Legt neue Auktionen an und lässt die Außenwelt mitbieten (GDD §5.4). */
const refreshMarketHandler: JobHandler = async (job: Job, pool: Pool) => {
  if (!job.leagueId) throw new Error("refresh_market ohne Liga");
  const closesAt = new Date(String(job.payload.closesAt));
  await refreshMarket(pool, job.leagueId, Number(job.payload.matchday), closesAt, job.runAt);

  // Die neuen Auktionen brauchen ihre eigenen Abschluss-Jobs, gestaffelt
  const auctions = await pool.query<{ id: string }>(
    `SELECT id FROM auction WHERE league_id = $1 AND status = 'open'
      ORDER BY opens_at`, [job.leagueId]);
  for (const [index, auction] of auctions.rows.entries()) {
    await enqueue(pool, {
      leagueId: job.leagueId, type: JOB.CLOSE_AUCTION,
      payload: { auctionId: auction.id },
      runAt: new Date(closesAt.getTime() + index * 2 * 60 * 1000),
      idempotencyKey: `market_close:${auction.id}:md${job.payload.matchday}`,
    });
  }
};

const closeAuctionHandler: JobHandler = async (job: Job, pool: Pool) => {
  const auctionId = String(job.payload.auctionId);
  // Auch hier die Spielzeit, nicht die Systemuhr: Sonst schließt ein
  // nachgeholter Job Auktionen, die zu ihrer Zeit noch liefen.
  const result = await settleAuction(pool, auctionId, job.runAt);

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
  [JOB.DELIVER_EVENTS]: deliverEventsHandler,
  [JOB.REFRESH_MARKET]: refreshMarketHandler,
};
