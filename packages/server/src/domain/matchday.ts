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
import type {
  Attributes, MatchPlayer, MatchSquad, Position, Trait,
} from "../../../shared/src/types/match.ts";
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
      matchday, matchesPlayed: 0, goals: 0, injuries: 0, wagesPaid: 0, ticketIncome: 0,
    };

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
      const income = support.attendance * support.ticketPrice;
      await book(client, leagueId, match.home_club_id, season, matchday,
        "ticket", income, "Ticketverkauf");

      report.matchesPlayed++;
      report.goals += result.homeGoals + result.awayGoals;
      report.injuries += result.injuries.length;
      report.ticketIncome += income;
    }

    report.wagesPaid = await payWages(client, leagueId, season, matchday);
    await applyFitness(client, leagueId, matchday, played, substituted);
    await client.query(
      `UPDATE player_instance SET suspension_matches = suspension_matches - 1
        WHERE league_id = $1 AND suspension_matches > 0`, [leagueId]);
    await client.query(
      "UPDATE league SET current_matchday = $2 WHERE id = $1", [leagueId, matchday]);

    return report;
  });
}

async function homeSupport(
  client: PoolClient, clubId: string,
): Promise<{ factor: number; attendance: number; ticketPrice: number }> {
  const { rows } = await client.query<{
    stadium_capacity: number; fan_mood: number; ticket_price: number; fan_count: number;
  }>(
    `SELECT stadium_capacity, fan_mood, ticket_price, fan_count FROM club WHERE id = $1`,
    [clubId]);
  const club = rows[0]!;

  // Auslastung nach den Stimmungszonen aus GDD §11.4
  const mood = club.fan_mood;
  const occupancy = mood >= 85 ? 1.0 : mood >= 60 ? 0.8 : mood >= 35 ? 0.6 : 0.35;
  const attendance = Math.min(
    club.stadium_capacity,
    Math.round(club.stadium_capacity * occupancy),
    club.fan_count,
  );
  return {
    factor: attendance / club.stadium_capacity * (mood / 100),
    attendance,
    ticketPrice: club.ticket_price,
  };
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
    `SELECT club_id, SUM(wage_per_matchday)::bigint AS total
       FROM player_instance WHERE league_id = $1 AND club_id IS NOT NULL
      GROUP BY club_id`, [leagueId]);
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
