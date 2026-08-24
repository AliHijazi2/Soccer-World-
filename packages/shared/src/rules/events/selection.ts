/**
 * Ereignisauswahl (GDD §10.2, §10.5).
 *
 * Ein bis zwei Ereignisse je Tag, morgens gebündelt — ausdrücklich nicht je
 * Spieltag. Bei 21 Spieltagen in sieben Tagen wären das über 30 Entscheidungen
 * pro Woche, und der Posteingang würde zur Pflichtübung.
 */

import type { Rng } from "../rng.ts";
import type { EventContext, EventDefinition } from "./types.ts";

export const EVENT_RHYTHM = {
  /** Ereignisse je Tag und Verein */
  MIN_PER_DAY: 1,
  MAX_PER_DAY: 2,
  /** Ein Ereignis wird nur an diesen Spieltagen zugestellt (Tagesbeginn) */
  DELIVER_ON_MATCHDAY_MODULO: 1,
} as const;

/**
 * Wirksames Gewicht eines Ereignisses in der aktuellen Lage.
 *
 * Hier steckt das getarnte Rubberbanding aus §10.5: Der Tabellenführer zieht
 * mehr Forderungen und Abwerbeversuche an, der Letzte mehr Gelegenheiten. Es
 * trifft nie das Spielergebnis — nur das Umfeld. Wenn Spieler merken, dass die
 * Simulation sie beim Führen benachteiligt, ist das Vertrauen sofort weg.
 */
export function effectiveWeight(
  definition: EventDefinition, context: EventContext,
): number {
  if (definition.precondition && !definition.precondition(context)) return 0;
  const modifier = definition.situationalWeight?.(context) ?? 1;
  return Math.max(0, definition.weight * Math.max(0, modifier));
}

/**
 * Wählt die Ereignisse eines Tages.
 *
 * Sperrfristen werden hart eingehalten: Zweimal dasselbe innerhalb weniger
 * Spieltage entwertet jedes Ereignis, egal wie gut es geschrieben ist.
 */
export function selectEvents(
  definitions: readonly EventDefinition[],
  context: EventContext,
  lastSeen: ReadonlyMap<string, number>,
  rng: Rng,
  count: number,
): EventDefinition[] {
  const available = definitions.filter((definition) => {
    const last = lastSeen.get(definition.key);
    if (last !== undefined && context.matchday - last <= definition.cooldownMatchdays) {
      return false;
    }
    return effectiveWeight(definition, context) > 0;
  });

  const selected: EventDefinition[] = [];
  const pool = [...available];

  for (let i = 0; i < count && pool.length > 0; i++) {
    const pick = rng.weighted(pool, (definition) => effectiveWeight(definition, context));
    selected.push(pick);
    // Innerhalb eines Tages nie zweimal dasselbe, und nie zweimal dieselbe
    // Kategorie — sonst kommen zwei Vertragsforderungen am selben Morgen
    const index = pool.indexOf(pick);
    pool.splice(index, 1);
    for (let j = pool.length - 1; j >= 0; j--) {
      if (pool[j]!.category === pick.category) pool.splice(j, 1);
    }
  }
  return selected;
}

/** Wie viele Ereignisse ein Verein an diesem Tag bekommt. */
export function eventsForDay(rng: Rng): number {
  return rng.int(EVENT_RHYTHM.MIN_PER_DAY, EVENT_RHYTHM.MAX_PER_DAY);
}

/** Ereignisse werden zum Tagesbeginn zugestellt, also vor dem ersten Anstoß. */
export function isDeliveryMatchday(matchday: number): boolean {
  return (matchday - 1) % 3 === 0;
}
