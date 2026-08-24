/**
 * Ereignisse zustellen, auflösen und ihre Folgen buchen (GDD §10).
 *
 * Die Definitionen und die Auswahl stehen als reine Funktionen in
 * shared/rules/events; hier kommt dazu, was nur die Datenbank weiß: welcher
 * Spieler betroffen ist, wie viel Geld da ist und was daraus folgt.
 */

import { createRng, hashSeed } from "../../../shared/src/rules/rng.ts";
import { EVENTS, EVENTS_BY_KEY } from "../../../shared/src/rules/events/definitions.ts";
import {
  eventsForDay, isDeliveryMatchday, selectEvents,
} from "../../../shared/src/rules/events/selection.ts";
import type {
  Effect, EventContext, EventDefinition, SubjectSelector,
} from "../../../shared/src/rules/events/types.ts";
import { inTransaction, type Pool, type PoolClient } from "../db/pool.ts";

/** Kein Ereignis darf mehr als diesen Anteil des Vermögens vernichten (GDD §10.7). */
export const MAX_CASH_LOSS_SHARE = 0.08;

interface SubjectRow {
  id: string; full_name: string; age: number; overall: number;
  wage_per_matchday: number; market_value: number;
}

/** Sucht den Spieler, um den es geht. */
async function findSubject(
  client: PoolClient, clubId: string, selector: SubjectSelector, seed: number,
): Promise<SubjectRow | null> {
  if (selector === null) return null;

  const order = {
    best: "p.overall DESC",
    worst: "p.overall ASC",
    oldest: "p.age DESC",
    youngest: "p.age ASC",
    highest_paid: "p.wage_per_matchday DESC",
    random: "p.id",
  }[selector];

  const { rows } = await client.query<SubjectRow>(
    `SELECT p.id, t.full_name, p.age, p.overall, p.wage_per_matchday, p.market_value
       FROM player_instance p JOIN player_template t ON t.id = p.template_id
      WHERE p.club_id = $1 AND p.injured_until_matchday IS NULL
      ORDER BY ${order}
      LIMIT ${selector === "random" ? 50 : 1}`,
    [clubId]);

  if (rows.length === 0) return null;
  if (selector !== "random") return rows[0]!;
  return rows[createRng(seed).int(0, rows.length - 1)]!;
}

async function loadContext(
  client: PoolClient, leagueId: string, clubId: string, season: number, matchday: number,
): Promise<EventContext> {
  const { rows } = await client.query<{
    cash: number; fan_mood: number; stadium_condition: number; expected_ppg: number;
    points: number; played: number; win_streak: number; loss_streak: number;
    squad_size: number; injured: number; club_count: number; rank: number;
  }>(
    `WITH ranked AS (
       SELECT s.club_id,
              RANK() OVER (ORDER BY (s.points::numeric / NULLIF(s.played,0)) DESC NULLS LAST) AS rank,
              COUNT(*) OVER () AS club_count
         FROM standing s WHERE s.league_id = $1 AND s.season = $3)
     SELECT c.cash, c.fan_mood, c.stadium_condition, c.expected_ppg,
            COALESCE(s.points,0) AS points, COALESCE(s.played,0) AS played,
            COALESCE(s.win_streak,0) AS win_streak, COALESCE(s.loss_streak,0) AS loss_streak,
            (SELECT COUNT(*)::int FROM player_instance p WHERE p.club_id = c.id) AS squad_size,
            (SELECT COUNT(*)::int FROM player_instance p
              WHERE p.club_id = c.id AND p.injured_until_matchday IS NOT NULL) AS injured,
            COALESCE(r.club_count, 1)::int AS club_count,
            COALESCE(r.rank, 1)::int AS rank
       FROM club c
       LEFT JOIN standing s ON s.club_id = c.id AND s.season = $3
       LEFT JOIN ranked r ON r.club_id = c.id
      WHERE c.id = $2`,
    [leagueId, clubId, season]);

  const row = rows[0]!;
  const actual = row.played > 0 ? row.points / row.played : row.expected_ppg;
  return {
    rank: row.rank, clubCount: row.club_count, cash: row.cash,
    fanMood: row.fan_mood, stadiumCondition: row.stadium_condition,
    winStreak: row.win_streak, lossStreak: row.loss_streak,
    expectationDelta: actual - row.expected_ppg,
    squadSize: row.squad_size, injuredPlayers: row.injured, matchday,
  };
}

/** Wann welches Ereignis zuletzt zugestellt wurde. */
async function loadLastSeen(
  client: PoolClient, clubId: string,
): Promise<Map<string, number>> {
  const { rows } = await client.query<{ template_key: string; last: number }>(
    `SELECT template_key, MAX(matchday)::int AS last FROM club_event
      WHERE club_id = $1 GROUP BY template_key`, [clubId]);
  return new Map(rows.map((row) => [row.template_key, row.last]));
}

export interface DeliveryReport {
  delivered: number;
  linked: number;
}

/**
 * Stellt die Ereignisse eines Tages zu.
 *
 * Läuft nur zum Tagesbeginn, nicht nach jedem Spieltag — bei drei Anstößen
 * täglich wären das sonst über dreißig Entscheidungen pro Woche (GDD §10.2).
 */
export async function deliverEvents(
  pool: Pool, leagueId: string, season: number, matchday: number,
): Promise<DeliveryReport> {
  if (!isDeliveryMatchday(matchday)) return { delivered: 0, linked: 0 };

  return inTransaction(pool, async (client) => {
    const clubs = await client.query<{ id: string; name: string; is_bot: boolean }>(
      "SELECT id, name, is_bot FROM club WHERE league_id = $1 ORDER BY id", [leagueId]);
    const report: DeliveryReport = { delivered: 0, linked: 0 };
    const humanClubs = clubs.rows.filter((club) => !club.is_bot);

    for (const club of humanClubs) {
      // Bot-Vereine bekommen keine Ereignisse (GDD §9.5)
      const rng = createRng(hashSeed("events", leagueId, season, matchday, club.id));
      const context = await loadContext(client, leagueId, club.id, season, matchday);
      const lastSeen = await loadLastSeen(client, club.id);
      const chosen = selectEvents(EVENTS, context, lastSeen, rng, eventsForDay(rng));

      for (const definition of chosen) {
        const subject = await findSubject(
          client, club.id, definition.subject,
          hashSeed("subject", club.id, definition.key, matchday));
        // Ein Ereignis über einen Spieler ohne Spieler wird übersprungen
        if (definition.subject !== null && !subject) continue;

        const payload: Record<string, string | number> = {};
        if (subject) payload.player = subject.full_name;
        if (definition.key === "squad.training_injury") {
          payload.matchdays = rng.int(1, 6);
        }
        if (definition.key === "economy.tax_bill") {
          // Gedeckelt auf 4 % — kein Ereignis darf ruinieren (GDD §10.7)
          payload.amount = Math.round(context.cash * 0.04);
        }

        let linkedTo: string | null = null;
        if (definition.key === "market.rival_interest") {
          const rivals = humanClubs.filter((other) => other.id !== club.id);
          if (rivals.length === 0) continue;
          const rival = rivals[rng.int(0, rivals.length - 1)]!;
          payload.rival = rival.name;
          linkedTo = rival.id;
        }

        const inserted = await client.query<{ id: string }>(
          `INSERT INTO club_event
             (league_id, club_id, season, matchday, template_key, category,
              payload, subject_player_id, options, default_option, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() + interval '20 hours')
           RETURNING id`,
          [leagueId, club.id, season, matchday, definition.key, definition.category,
           payload, subject?.id ?? null,
           JSON.stringify(definition.options.map((option) => option.key)),
           definition.defaultOption]);
        report.delivered++;
        if (linkedTo) report.linked++;
        void inserted;
      }
    }
    return report;
  });
}

// ── Auflösung ─────────────────────────────────────────────────────────────

export interface ResolveResult {
  ok: boolean;
  reason?: "not_found" | "already_resolved" | "invalid_option";
}

/** Wendet die Wahl eines Spielers an. */
export async function resolveEvent(
  pool: Pool, eventId: string, optionIndex: number,
): Promise<ResolveResult> {
  return inTransaction(pool, async (client) => {
    const { rows } = await client.query<{
      id: string; club_id: string; league_id: string; season: number; matchday: number;
      template_key: string; subject_player_id: string | null;
      options: string[]; resolved_at: Date | null;
    }>(
      `SELECT id, club_id, league_id, season, matchday, template_key,
              subject_player_id, options, resolved_at
         FROM club_event WHERE id = $1 FOR UPDATE`, [eventId]);
    const event = rows[0];
    if (!event) return { ok: false, reason: "not_found" };
    if (event.resolved_at) return { ok: false, reason: "already_resolved" };

    const definition = EVENTS_BY_KEY.get(event.template_key);
    if (!definition) return { ok: false, reason: "not_found" };

    const option = definition.options[optionIndex];
    if (definition.options.length > 0 && !option) {
      return { ok: false, reason: "invalid_option" };
    }

    if (option) {
      await applyEffects(client, event, option.effects,
        hashSeed("resolve", eventId, optionIndex));
    }

    await client.query(
      "UPDATE club_event SET chosen_option = $2, resolved_at = now() WHERE id = $1",
      [eventId, optionIndex]);
    return { ok: true };
  });
}

/**
 * Löst alle abgelaufenen Ereignisse mit ihrer Standardoption auf.
 *
 * Wer nicht reagiert, bekommt die neutrale Antwort — ein Ereignis darf nie
 * unentschieden im Posteingang liegen bleiben und den Verein blockieren.
 */
export async function resolveExpired(pool: Pool, now = new Date()): Promise<number> {
  const { rows } = await pool.query<{ id: string; default_option: number }>(
    `SELECT id, default_option FROM club_event
      WHERE resolved_at IS NULL AND expires_at <= $1`, [now]);
  return resolveAll(pool, rows);
}

/**
 * Löst alle noch offenen Ereignisse einer Liga auf, unabhängig von der Frist.
 *
 * Nötig am Saisonende: Danach kommt kein Spieltag mehr, an dem die Frist
 * ablaufen könnte, und die Ereignisse blieben für immer im Posteingang.
 */
export async function resolveOpen(pool: Pool, leagueId: string): Promise<number> {
  const { rows } = await pool.query<{ id: string; default_option: number }>(
    `SELECT id, default_option FROM club_event
      WHERE league_id = $1 AND resolved_at IS NULL`, [leagueId]);
  return resolveAll(pool, rows);
}

async function resolveAll(
  pool: Pool, rows: readonly { id: string; default_option: number }[],
): Promise<number> {
  let count = 0;
  for (const row of rows) {
    const result = await resolveEvent(pool, row.id, row.default_option);
    if (result.ok) count++;
  }
  return count;
}

interface EventRow {
  id: string; club_id: string; league_id: string;
  season: number; matchday: number; subject_player_id: string | null;
}

async function applyEffects(
  client: PoolClient, event: EventRow, effects: readonly Effect[], seed: number,
): Promise<void> {
  const rng = createRng(seed);

  for (const effect of effects) {
    switch (effect.kind) {
      case "cash": {
        const { rows } = await client.query<{ cash: number }>(
          "SELECT cash FROM club WHERE id = $1", [event.club_id]);
        const cash = rows[0]?.cash ?? 0;
        let amount = effect.amount ?? Math.round((effect.shareOfCash ?? 0) * cash);
        // Deckelung nach GDD §10.7 — Katastrophen sind unterhaltsam,
        // Willkür ist es nicht
        const floor = -Math.abs(cash * MAX_CASH_LOSS_SHARE);
        if (amount < floor) amount = Math.round(floor);
        if (amount !== 0) {
          await client.query(
            `INSERT INTO ledger_entry
               (league_id, club_id, season, matchday, category, amount, reference_type, reference_id, description)
             VALUES ($1, $2, $3, $4, 'other', $5, 'event', $6, 'Ereignis')`,
            [event.league_id, event.club_id, event.season, event.matchday, amount, event.id]);
          await client.query("UPDATE club SET cash = cash + $2 WHERE id = $1",
            [event.club_id, amount]);
        }
        break;
      }
      case "mood":
        await client.query(
          `UPDATE club SET fan_mood = GREATEST(0, LEAST(100, fan_mood + $2)) WHERE id = $1`,
          [event.club_id, effect.delta]);
        break;
      case "fans":
        await client.query(
          `UPDATE club SET fan_count = GREATEST(1000, ROUND(fan_count * (1 + $2::numeric / 100)))
            WHERE id = $1`, [event.club_id, effect.sharePercent]);
        break;
      case "morale":
        await client.query(
          `UPDATE player_instance
              SET morale = GREATEST(0, LEAST(100, morale + $2))
            WHERE club_id = $1 ${effect.target === "subject" ? "AND id = $3" : ""}`,
          effect.target === "subject"
            ? [event.club_id, effect.delta, event.subject_player_id]
            : [event.club_id, effect.delta]);
        break;
      case "fitness":
        await client.query(
          `UPDATE player_instance
              SET fitness = GREATEST(0, LEAST(100, fitness + $2))
            WHERE club_id = $1 ${effect.target === "subject" ? "AND id = $3" : ""}`,
          effect.target === "subject"
            ? [event.club_id, effect.delta, event.subject_player_id]
            : [event.club_id, effect.delta]);
        break;
      case "wage":
        if (event.subject_player_id) {
          await client.query(
            `UPDATE player_instance SET wage_per_matchday = ROUND(wage_per_matchday * $2::numeric)
              WHERE id = $1`, [event.subject_player_id, effect.factor]);
        }
        break;
      case "marketValue":
        if (event.subject_player_id) {
          await client.query(
            `UPDATE player_instance SET market_value = ROUND(market_value * $2::numeric)
              WHERE id = $1`, [event.subject_player_id, effect.factor]);
        }
        break;
      case "injury":
        if (event.subject_player_id) {
          await client.query(
            `UPDATE player_instance SET injured_until_matchday = $2 WHERE id = $1`,
            [event.subject_player_id, event.matchday + effect.matchdays]);
        }
        break;
      case "trait":
        if (event.subject_player_id) {
          await client.query(
            `UPDATE player_instance SET traits = array_append(traits, $2)
              WHERE id = $1 AND NOT ($2 = ANY(traits))`,
            [event.subject_player_id, effect.trait]);
        }
        break;
      case "stadiumCondition":
        await client.query(
          `UPDATE club SET stadium_condition = GREATEST(0, LEAST(100, stadium_condition + $2))
            WHERE id = $1`, [event.club_id, effect.delta]);
        break;
      case "chance":
        await applyEffects(client, event,
          rng.chance(effect.probability) ? effect.then : effect.otherwise, rng.int(1, 2 ** 30));
        break;
    }
  }
}

export { EVENTS, EVENTS_BY_KEY, type EventDefinition };

// ── Darstellung ───────────────────────────────────────────────────────────

import { render, type Payload } from "../../../shared/src/text/engine.ts";
import { EVENT_TEMPLATES } from "../../../shared/src/text/events.de.ts";

export interface RenderedEvent {
  id: string;
  matchday: number;
  category: string;
  title: string;
  body: string;
  options: { index: number; text: string }[];
  chosenOption: number | null;
  resolved: boolean;
}

/** Lädt den Posteingang eines Vereins und setzt die Texte zusammen. */
export async function readEvents(
  client: PoolClient, clubId: string, limit = 20,
): Promise<RenderedEvent[]> {
  const { rows } = await client.query<{
    id: string; matchday: number; category: string; template_key: string;
    payload: Payload; options: string[]; chosen_option: number | null;
    resolved_at: Date | null;
  }>(
    `SELECT id, matchday, category, template_key, payload, options,
            chosen_option, resolved_at
       FROM club_event WHERE club_id = $1
      ORDER BY matchday DESC, id DESC LIMIT $2`,
    [clubId, limit]);

  return rows.map((row) => {
    const seed = hashSeed("event", row.id);
    const text = (key: string) =>
      render(key, row.payload, { templates: EVENT_TEMPLATES, seed });
    return {
      id: row.id, matchday: row.matchday, category: row.category,
      title: text(`${row.template_key}.title`),
      body: text(`${row.template_key}.body`),
      options: row.options.map((option, index) => ({
        index, text: text(`${row.template_key}.${option}`),
      })),
      chosenOption: row.chosen_option,
      resolved: row.resolved_at !== null,
    };
  });
}
