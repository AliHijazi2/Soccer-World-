/**
 * Spieltagsabwicklung: Kader laden, simulieren, buchen.
 *
 * Das ist die Stelle, an der die reinen Regeln aus shared/rules auf die
 * Datenbank treffen. Die Simulation selbst bleibt eine reine Funktion — hier
 * wird nur Zustand hereingereicht und das Ergebnis weggeschrieben.
 */

import { hashSeed } from "../../../shared/src/rules/rng.ts";
import { simulateMatch } from "../../../shared/src/rules/match/simulate.ts";
import { fitnessAfterMatch, pickBestEleven } from "../../../shared/src/rules/lineup.ts";
import {
  applyMoodChange, fanCountChange, moodChangeAfterMatch, occupancy,
} from "../../../shared/src/rules/economy/fans.ts";
import {
  matchBonus, merchandise, ticketIncome, tvBasePerMatchday, upkeep,
} from "../../../shared/src/rules/economy/revenue.ts";
import type {
  Attributes, MatchPlayer, MatchSquad, Position, Trait,
} from "../../../shared/src/types/match.ts";
import { generateFeed, updateStreaks, type MatchOutcome } from "./feed.ts";
import { inTransaction, type Pool, type PoolClient } from "../db/pool.ts";

interface PlayerRow {
  id: string; club_id: string; primary_position: Position;
  attributes: Attributes; traits: Trait[]; overall: number;
  form: number; fitness: number; morale: number;
  injured_until_matchday: number | null; suspension_matches: number;
  wage_per_matchday: number;
}

async function loadPlayers(
  client: PoolClient, clubId: string,
): Promise<PlayerRow[]> {
  const { rows } = await client.query<PlayerRow>(
    `SELECT id, club_id, primary_position, attributes, traits, overall,
            form, fitness, morale, injured_until_matchday, suspension_matches,
            wage_per_matchday
       FROM player_instance WHERE club_id = $1`,
    [clubId],
  );
  return rows;
}

function toMatchPlayer(row: PlayerRow, slot: Position): MatchPlayer {
  return {
    id: row.id, name: row.id,
    position: slot, naturalPosition: row.primary_position,
    attrs: row.attributes,
    form: row.form, fitness: row.fitness, morale: row.morale,
    traits: row.traits,
  };
}

export interface LoadedSquad {
  squad: MatchSquad;
  starterIds: string[];
  benchIds: string[];
  allIds: string[];
}

/**
 * Baut den Kader für eine Partie.
 *
 * Verletzte und gesperrte Spieler fallen heraus, danach greift die
 * Auto-Aufstellung. Das entspricht der Auto-Korrektur aus GDD §7.2: Wer den
 * Abend verpasst, tritt trotzdem mit einer sinnvollen Elf an — nur eben nicht
 * mit der besten.
 */
export async function loadSquad(
  client: PoolClient, clubId: string, clubName: string, matchday: number,
): Promise<LoadedSquad> {
  const rows = await loadPlayers(client, clubId);
  const selectable = rows.map((row) => ({
    id: row.id,
    naturalPosition: row.primary_position,
    overall: row.overall,
    fitness: row.fitness,
    available:
      (row.injured_until_matchday === null || row.injured_until_matchday < matchday) &&
      row.suspension_matches === 0,
  }));

  const byId = new Map(rows.map((row) => [row.id, row]));
  const { starters, bench } = pickBestEleven(selectable);

  if (starters.length < 11) {
    throw new Error(
      `Verein ${clubId} kann an Spieltag ${matchday} nur ${starters.length} Spieler ` +
      "aufstellen — der Mindestkader von 14 ist unterschritten",
    );
  }

  const squad: MatchSquad = {
    clubId, clubName,
    starters: starters.map((entry) => toMatchPlayer(byId.get(entry.player.id)!, entry.slot)),
    bench: bench.map((entry) => toMatchPlayer(byId.get(entry.id)!, byId.get(entry.id)!.primary_position)),
    tactics: { tempo: 50, pressing: 50, risk: 50, focus: "central" },
    chemistry: 50,
  };

  return {
    squad,
    starterIds: starters.map((entry) => entry.player.id),
    benchIds: bench.map((entry) => entry.id),
    allIds: rows.map((row) => row.id),
  };
}

export interface MatchdayReport {
  matchday: number;
  matchesPlayed: number;
  goals: number;
  injuries: number;
  wagesPaid: number;
  ticketIncome: number;
  feedItems: number;
}

interface MatchRow {
  id: string; home_club_id: string; away_club_id: string;
  seed: number; status: string;
}

/**
 * Simuliert alle Partien eines Spieltags und schreibt alle Folgen fort:
 * Tabelle, Ticker, Fitness, Verletzungen, Sperren, Gehälter, Ticketeinnahmen.
 *
 * Läuft vollständig in einer Transaktion. Bricht irgendetwas ab, ist der
 * Spieltag ungespielt statt halb gespielt — genau das, was der Job-Runner beim
 * nächsten Versuch braucht.
 */
export async function runMatchday(
  pool: Pool, leagueId: string, season: number, matchday: number,
): Promise<MatchdayReport> {
  return inTransaction(pool, async (client) => {
    const league = await client.query<{ rng_salt: number }>(
      "SELECT rng_salt FROM league WHERE id = $1 FOR UPDATE", [leagueId]);
    if (league.rows.length === 0) throw new Error(`Liga ${leagueId} nicht gefunden`);

    const matches = await client.query<MatchRow>(
      `SELECT id, home_club_id, away_club_id, seed, status
         FROM match
        WHERE league_id = $1 AND season = $2 AND matchday = $3
        ORDER BY id
        FOR UPDATE`,
      [leagueId, season, matchday]);

    const report: MatchdayReport = {
      matchday, matchesPlayed: 0, goals: 0, injuries: 0,
      wagesPaid: 0, ticketIncome: 0, feedItems: 0,
    };
    const outcomes: MatchOutcome[] = [];

    // Idempotenz: Ein bereits simulierter Spieltag wird nicht erneut gespielt
    const pending = matches.rows.filter((row) => row.status === "scheduled");
    if (pending.length === 0) return report;

    const played = new Set<string>();
    const substituted = new Set<string>();

    for (const match of pending) {
      const home = await loadSquad(client, match.home_club_id, match.home_club_id, matchday);
      const away = await loadSquad(client, match.away_club_id, match.away_club_id, matchday);

      const support = await homeSupport(client, match.home_club_id);
      const result = simulateMatch(home.squad, away.squad, {
        homeSupport: support.factor, isDerby: false,
      }, match.seed);

      for (const id of [...home.starterIds, ...away.starterIds]) played.add(id);

      await client.query(
        `UPDATE match
            SET status = 'simulated', home_goals = $2, away_goals = $3,
                attendance = $4, stats = $5, simulated_at = now(),
                home_lineup_snapshot = $6, away_lineup_snapshot = $7
          WHERE id = $1`,
        [match.id, result.homeGoals, result.awayGoals, support.attendance,
         { home: result.home, away: result.away },
         // Arrays müssen für jsonb-Spalten explizit serialisiert werden —
         // sonst macht der Treiber daraus ein Postgres-Array-Literal
         JSON.stringify(home.starterIds), JSON.stringify(away.starterIds)]);

      for (const event of result.events) {
        await client.query(
          `INSERT INTO match_event
             (match_id, minute, sequence, type, club_id, player_instance_id,
              secondary_player_id, text_key, payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [match.id, event.minute, event.sequence, event.type,
           event.clubId ?? null, event.playerId ?? null,
           event.secondaryPlayerId ?? null, event.textKey, event.payload ?? {}]);
        if (event.type === "substitution" && event.playerId) substituted.add(event.playerId);
      }

      await updateStanding(client, leagueId, season, match.home_club_id,
        result.homeGoals, result.awayGoals);
      await updateStanding(client, leagueId, season, match.away_club_id,
        result.awayGoals, result.homeGoals);
      await updateStreaks(client, leagueId, season, match.home_club_id,
        pointsFor(result.homeGoals, result.awayGoals));
      await updateStreaks(client, leagueId, season, match.away_club_id,
        pointsFor(result.awayGoals, result.homeGoals));

      outcomes.push({
        homeClubId: match.home_club_id, awayClubId: match.away_club_id,
        homeGoals: result.homeGoals, awayGoals: result.awayGoals,
      });

      for (const injury of result.injuries) {
        await client.query(
          `UPDATE player_instance SET injured_until_matchday = $2 WHERE id = $1`,
          [injury.playerId, matchday + injury.matchdays]);
      }
      for (const suspension of result.suspensions) {
        await client.query(
          `UPDATE player_instance SET suspension_matches = $2 WHERE id = $1`,
          [suspension.playerId, suspension.matchdays]);
      }

      // Ticketeinnahmen nur beim Heimverein
      await book(client, leagueId, match.home_club_id, season, matchday,
        "ticket", support.income, "Ticketverkauf");

      // Fanstimmung nach Erwartungsdifferenz (GDD §11.2) — der wichtigste
      // Anti-Snowball-Hebel des Spiels
      await applyFanEffects(client, match.home_club_id,
        result.homeGoals, result.awayGoals, true, support.ticketPrice);
      await applyFanEffects(client, match.away_club_id,
        result.awayGoals, result.homeGoals, false, 0);

      // Spielprämien
      await book(client, leagueId, match.home_club_id, season, matchday, "prize",
        matchBonus(pointsFor(result.homeGoals, result.awayGoals)), "Spielprämie");
      await book(client, leagueId, match.away_club_id, season, matchday, "prize",
        matchBonus(pointsFor(result.awayGoals, result.homeGoals)), "Spielprämie");

      report.matchesPlayed++;
      report.goals += result.homeGoals + result.awayGoals;
      report.injuries += result.injuries.length;
      report.ticketIncome += support.income;
    }

    report.wagesPaid = await payWages(client, leagueId, season, matchday);
    await payRecurring(client, leagueId, season, matchday);
    await applyFitness(client, leagueId, matchday, played, substituted);
    await client.query(
      `UPDATE player_instance SET suspension_matches = suspension_matches - 1
        WHERE league_id = $1 AND suspension_matches > 0`, [leagueId]);
    await client.query(
      "UPDATE league SET current_matchday = $2 WHERE id = $1", [leagueId, matchday]);

    // Der Feed entsteht zuletzt, damit er den fertigen Zustand sieht:
    // Stimmung, Kassenstand und Fitness sind dann schon fortgeschrieben
    report.feedItems = await generateFeed(client, leagueId, season, matchday, outcomes);

    return report;
  });
}

async function homeSupport(
  client: PoolClient, clubId: string,
): Promise<{ factor: number; attendance: number; ticketPrice: number; income: number }> {
  const { rows } = await client.query<{
    stadium_capacity: number; fan_mood: number; ticket_price: number; fan_count: number;
  }>(
    `SELECT stadium_capacity, fan_mood, ticket_price, fan_count FROM club WHERE id = $1`,
    [clubId]);
  const club = rows[0]!;

  const rate = occupancy(club.fan_mood, club.ticket_price);
  const { attendance, income } = ticketIncome(club.stadium_capacity, rate, club.ticket_price);
  const capped = Math.min(attendance, club.fan_count);

  return {
    // Heimvorteil aus Auslastung mal Stimmung (GDD §8.3)
    factor: (capped / club.stadium_capacity) * (club.fan_mood / 100),
    attendance: capped,
    ticketPrice: club.ticket_price,
    income: capped * club.ticket_price,
  };
}

function pointsFor(scored: number, conceded: number): number {
  return scored > conceded ? 3 : scored === conceded ? 1 : 0;
}

/**
 * Stimmung und Fanzahl nach einer Partie.
 *
 * Gemessen wird gegen die zu Saisonbeginn festgelegte Erwartung, nicht gegen
 * das nackte Ergebnis: Der teuerste Kader hat dadurch automatisch die
 * unzufriedensten Fans (GDD §11.2).
 */
async function applyFanEffects(
  client: PoolClient, clubId: string,
  goalsFor: number, goalsAgainst: number, isHome: boolean, ticketPrice: number,
): Promise<void> {
  const { rows } = await client.query<{
    fan_mood: number; fan_count: number; expected_ppg: number;
  }>("SELECT fan_mood, fan_count, expected_ppg FROM club WHERE id = $1", [clubId]);
  const club = rows[0]!;

  const change = moodChangeAfterMatch({
    points: pointsFor(goalsFor, goalsAgainst),
    expectedPoints: club.expected_ppg,
    goalsFor, goalsAgainst, ticketPrice, isHome,
  });
  const mood = applyMoodChange(club.fan_mood, change);
  const fans = club.fan_count + fanCountChange(club.fan_count, mood);

  await client.query(
    "UPDATE club SET fan_mood = $2, fan_count = GREATEST($3, 1000) WHERE id = $1",
    [clubId, mood, fans]);
}

/**
 * Laufende Posten je Spieltag: TV-Sockel, Merchandise, Sponsoren, Betriebskosten.
 *
 * Der TV-Sockel wird allen gleich ausgezahlt — er ist der Grund, warum ein
 * schwacher Verein nie finanziell abstirbt (GDD §19.2, Nr. 8).
 */
async function payRecurring(
  client: PoolClient, leagueId: string, season: number, matchday: number,
): Promise<void> {
  const { rows } = await client.query<{
    id: string; fan_count: number; fan_mood: number;
    stadium_capacity: number; stadium_condition: number;
  }>(
    `SELECT id, fan_count, fan_mood, stadium_capacity, stadium_condition
       FROM club WHERE league_id = $1 AND NOT is_outside_world`, [leagueId]);

  const tvBase = tvBasePerMatchday();
  for (const club of rows) {
    await book(client, leagueId, club.id, season, matchday, "tv", tvBase, "TV-Sockel");
    await book(client, leagueId, club.id, season, matchday, "merch",
      merchandise(club.fan_count, club.fan_mood), "Merchandise");
    await book(client, leagueId, club.id, season, matchday, "maintenance",
      -upkeep(club.stadium_capacity, club.stadium_condition), "Stadionbetrieb");

    const sponsors = await client.query<{ total: number; mood: number }>(
      `SELECT COALESCE(SUM(base_per_matchday), 0)::bigint AS total,
              COALESCE(SUM(mood_per_matchday), 0)::numeric AS mood
         FROM sponsor_contract WHERE club_id = $1`, [club.id]);
    const sponsor = sponsors.rows[0]!;
    if (sponsor.total > 0) {
      await book(client, leagueId, club.id, season, matchday,
        "sponsor", sponsor.total, "Sponsoren");
    }
    if (sponsor.mood !== 0) {
      await client.query(
        "UPDATE club SET fan_mood = GREATEST(0, LEAST(100, fan_mood + $2)) WHERE id = $1",
        [club.id, sponsor.mood]);
    }
  }

  // Das Stadion verfällt, ob man hinsieht oder nicht (GDD §12.4)
  await client.query(
    `UPDATE club SET stadium_condition = GREATEST(0, stadium_condition - 0.6)
      WHERE league_id = $1 AND NOT is_outside_world`, [leagueId]);
}

async function updateStanding(
  client: PoolClient, leagueId: string, season: number, clubId: string,
  scored: number, conceded: number,
): Promise<void> {
  const points = scored > conceded ? 3 : scored === conceded ? 1 : 0;
  await client.query(
    `INSERT INTO standing
       (league_id, season, club_id, played, won, drawn, lost, goals_for, goals_against, points)
     VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (league_id, season, club_id) DO UPDATE SET
       played = standing.played + 1,
       won = standing.won + $4, drawn = standing.drawn + $5, lost = standing.lost + $6,
       goals_for = standing.goals_for + $7, goals_against = standing.goals_against + $8,
       points = standing.points + $9`,
    [leagueId, season, clubId,
     points === 3 ? 1 : 0, points === 1 ? 1 : 0, points === 0 ? 1 : 0,
     scored, conceded, points]);
}

async function payWages(
  client: PoolClient, leagueId: string, season: number, matchday: number,
): Promise<number> {
  const { rows } = await client.query<{ club_id: string; total: number }>(
    `SELECT p.club_id, SUM(p.wage_per_matchday)::bigint AS total
       FROM player_instance p JOIN club c ON c.id = p.club_id
      WHERE p.league_id = $1 AND NOT c.is_outside_world
      GROUP BY p.club_id`, [leagueId]);
  let paid = 0;
  for (const row of rows) {
    await book(client, leagueId, row.club_id, season, matchday,
      "wages", -row.total, "Spielergehälter");
    paid += row.total;
  }
  return paid;
}

/** Fitness nach dem Spieltag (GDD §7.3). Nach dem letzten Anstoß des Tages wird geschlafen. */
async function applyFitness(
  client: PoolClient, leagueId: string, matchday: number,
  played: Set<string>, substituted: Set<string>,
): Promise<void> {
  const overnight = matchday % 3 === 0;
  const { rows } = await client.query<{ id: string; fitness: number; traits: Trait[] }>(
    `SELECT id, fitness, traits FROM player_instance
      WHERE league_id = $1 AND club_id IS NOT NULL`, [leagueId]);

  for (const row of rows) {
    const role = substituted.has(row.id) ? "substitute"
      : played.has(row.id) ? "played"
      : "out";
    const next = fitnessAfterMatch(
      { fitness: row.fitness, traits: row.traits }, role, overnight);
    await client.query("UPDATE player_instance SET fitness = $2 WHERE id = $1", [row.id, next]);
  }
}

/** Geld wird nie gesetzt, sondern gebucht (Datenmodell §9). */
async function book(
  client: PoolClient, leagueId: string, clubId: string,
  season: number, matchday: number, category: string, amount: number, description: string,
): Promise<void> {
  if (amount === 0) return;
  await client.query(
    `INSERT INTO ledger_entry
       (league_id, club_id, season, matchday, category, amount, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [leagueId, clubId, season, matchday, category, amount, description]);
  await client.query("UPDATE club SET cash = cash + $2 WHERE id = $1", [clubId, amount]);
}

export { hashSeed };
