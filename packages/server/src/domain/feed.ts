/**
 * Erzeugt den Boulevard-Feed nach jedem Spieltag.
 *
 * Die Auswahlregeln stehen als reine Funktionen in shared/rules/feed.ts;
 * hier kommt nur der Zustand aus der Datenbank und die Sperrfristenprüfung dazu.
 */

import {
  clubFeed, matchFeed, selectFeed,
  type ClubSnapshot, type FeedCandidate, type MatchSnapshot,
} from "../../../shared/src/rules/feed.ts";
import type { PoolClient } from "../db/pool.ts";

export interface MatchOutcome {
  homeClubId: string;
  awayClubId: string;
  homeGoals: number;
  awayGoals: number;
}

interface ClubRow {
  id: string; name: string; is_bot: boolean;
  expected_ppg: number; fan_mood: number; fan_count: number; cash: number;
  points: number; played: number;
  win_streak: number; loss_streak: number;
  tired: number; injured: number; squad_size: number;
}

async function loadSnapshots(
  client: PoolClient, leagueId: string, season: number,
): Promise<ClubSnapshot[]> {
  const { rows } = await client.query<ClubRow>(
    `SELECT c.id, c.name, c.is_bot, c.expected_ppg, c.fan_mood, c.fan_count, c.cash,
            COALESCE(s.points, 0) AS points, COALESCE(s.played, 0) AS played,
            COALESCE(s.win_streak, 0) AS win_streak,
            COALESCE(s.loss_streak, 0) AS loss_streak,
            (SELECT COUNT(*)::int FROM player_instance p
              WHERE p.club_id = c.id AND p.fitness < 70) AS tired,
            (SELECT COUNT(*)::int FROM player_instance p
              WHERE p.club_id = c.id AND p.injured_until_matchday IS NOT NULL) AS injured,
            (SELECT COUNT(*)::int FROM player_instance p WHERE p.club_id = c.id) AS squad_size
       FROM club c
       LEFT JOIN standing s ON s.club_id = c.id AND s.season = $2
      WHERE c.league_id = $1`,
    [leagueId, season],
  );

  // Rang nach Punkten pro Spiel, wie in der Tabelle (GDD §9.1)
  const ranked = [...rows].sort((a, b) =>
    (b.points / Math.max(b.played, 1)) - (a.points / Math.max(a.played, 1)));

  return ranked.map((row, index) => ({
    clubId: row.id, name: row.name, isBot: row.is_bot,
    rank: index + 1, points: row.points, played: row.played,
    expectedPpg: row.expected_ppg, fanMood: row.fan_mood,
    fanCount: row.fan_count, cash: row.cash,
    winStreak: row.win_streak, lossStreak: row.loss_streak,
    tiredPlayers: row.tired, injuredPlayers: row.injured, squadSize: row.squad_size,
  }));
}

/** Sperrfristen: Wann stand welche Meldung zuletzt im Feed? */
async function loadLastSeen(
  client: PoolClient, leagueId: string, season: number,
): Promise<Map<string, number>> {
  const { rows } = await client.query<{
    template_key: string; subject_club_id: string | null; last: number;
  }>(
    `SELECT template_key, subject_club_id, MAX(matchday)::int AS last
       FROM feed_item WHERE league_id = $1 AND season = $2
      GROUP BY template_key, subject_club_id`,
    [leagueId, season],
  );
  return new Map(rows.map((row) =>
    [`${row.template_key}:${row.subject_club_id ?? "-"}`, row.last]));
}

/** Schreibt die Serien fort — aus der Tabelle allein sind sie nicht ablesbar. */
export async function updateStreaks(
  client: PoolClient, leagueId: string, season: number,
  clubId: string, points: number,
): Promise<void> {
  await client.query(
    `UPDATE standing
        SET win_streak = CASE WHEN $4 = 3 THEN win_streak + 1 ELSE 0 END,
            loss_streak = CASE WHEN $4 = 0 THEN loss_streak + 1 ELSE 0 END
      WHERE league_id = $1 AND season = $2 AND club_id = $3`,
    [leagueId, season, clubId, points]);
}

/**
 * Erzeugt die Meldungen eines Spieltags.
 *
 * Bewusst begrenzt: Ein Feed, in dem alles steht, wird genauso wenig gelesen
 * wie einer, in dem nichts steht.
 */
export async function generateFeed(
  client: PoolClient, leagueId: string, season: number, matchday: number,
  matches: readonly MatchOutcome[],
): Promise<number> {
  const snapshots = await loadSnapshots(client, leagueId, season);
  const byId = new Map(snapshots.map((snapshot) => [snapshot.clubId, snapshot]));

  const candidates: FeedCandidate[] = [];

  for (const match of matches) {
    const home = byId.get(match.homeClubId);
    const away = byId.get(match.awayClubId);
    if (!home || !away) continue;
    const snapshot: MatchSnapshot = {
      homeName: home.name, awayName: away.name,
      homeGoals: match.homeGoals, awayGoals: match.awayGoals,
      homeExpectedPpg: home.expectedPpg, awayExpectedPpg: away.expectedPpg,
    };
    candidates.push(...matchFeed(snapshot));
  }

  for (const snapshot of snapshots) {
    candidates.push(...clubFeed(snapshot, matchday));
  }

  const lastSeen = await loadLastSeen(client, leagueId, season);
  const selected = selectFeed(candidates, lastSeen, matchday);

  for (const item of selected) {
    await client.query(
      `INSERT INTO feed_item
         (league_id, season, matchday, template_key, payload, subject_club_id, importance)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [leagueId, season, matchday, item.templateKey, item.payload,
       item.subjectClubId ?? null, item.importance]);
  }
  return selected.length;
}

// ── Darstellung ───────────────────────────────────────────────────────────

import { render, type Payload } from "../../../shared/src/text/engine.ts";
import { FEED_TEMPLATES, FEED_WORDS } from "../../../shared/src/text/feed.de.ts";
import { TICKER_TEMPLATES, TICKER_WORDS } from "../../../shared/src/text/ticker.de.ts";
import { hashSeed } from "../../../shared/src/rules/rng.ts";

export interface RenderedFeedItem {
  id: number;
  matchday: number;
  importance: number;
  text: string;
}

/**
 * Lädt den Feed und setzt die Sätze zusammen.
 *
 * Der Seed hängt an der Zeilen-Id: Dieselbe Meldung liest sich bei jedem Aufruf
 * gleich, unterschiedliche Meldungen desselben Typs aber verschieden.
 */
export async function readFeed(
  client: PoolClient, leagueId: string, limit = 30,
): Promise<RenderedFeedItem[]> {
  const { rows } = await client.query<{
    id: number; matchday: number; importance: number;
    template_key: string; payload: Payload;
  }>(
    `SELECT id, matchday, importance, template_key, payload
       FROM feed_item WHERE league_id = $1
      ORDER BY matchday DESC, importance DESC, id DESC LIMIT $2`,
    [leagueId, limit],
  );
  return rows.map((row) => ({
    id: row.id, matchday: row.matchday, importance: row.importance,
    text: render(row.template_key, row.payload, {
      templates: FEED_TEMPLATES, words: FEED_WORDS, seed: hashSeed("feed", row.id),
    }),
  }));
}

export interface RenderedTickerLine {
  minute: number;
  type: string;
  text: string;
}

/**
 * Lädt den Ticker einer Partie und löst dabei die Spielernamen auf.
 *
 * Die Datenbank speichert nur Ids — der Name kommt aus dem Join, damit ein
 * später umbenannter Spieler auch rückwirkend richtig heißt.
 */
export async function readTicker(
  client: PoolClient, matchId: string,
): Promise<RenderedTickerLine[]> {
  const { rows } = await client.query<{
    minute: number; sequence: number; type: string; text_key: string;
    payload: Payload; player_name: string | null; second_name: string | null;
  }>(
    `SELECT e.minute, e.sequence, e.type, e.text_key, e.payload,
            pt.full_name AS player_name, st.full_name AS second_name
       FROM match_event e
       LEFT JOIN player_instance pi ON pi.id = e.player_instance_id
       LEFT JOIN player_template pt ON pt.id = pi.template_id
       LEFT JOIN player_instance si ON si.id = e.secondary_player_id
       LEFT JOIN player_template st ON st.id = si.template_id
      WHERE e.match_id = $1 ORDER BY e.sequence`,
    [matchId],
  );

  return rows.map((row) => ({
    minute: row.minute,
    type: row.type,
    text: render(row.text_key, {
      ...row.payload,
      minute: row.minute,
      player: row.player_name,
      // Bei Torvorlagen ist der zweite Spieler der Vorbereiter, bei Wechseln
      // der Ausgewechselte, beim Schuss der Torwart — der Schlüssel entscheidet
      assist: row.second_name,
      keeper: row.second_name,
    }, {
      templates: TICKER_TEMPLATES, words: TICKER_WORDS,
      seed: hashSeed("ticker", matchId, row.sequence),
    }),
  }));
}
