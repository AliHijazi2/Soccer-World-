/**
 * Marktpool und Knappheit (GDD §5.2).
 *
 * Der wichtigste Satz des ganzen Designs steht in diesem Abschnitt:
 * **Knappheit ist kein Nebeneffekt, sie ist das Produkt.** Bei 150 Spielern
 * und drei Vereinen bekäme jeder alles, was er will, ohne je zu bieten — und
 * der Kern des Spiels fiele aus.
 */

import type { Rng } from "./rng.ts";

export type Tier = "world_class" | "very_good" | "solid";

/** Spieler je Verein im aktiven Pool. */
export const POOL_PER_CLUB = 16;

/**
 * Wie viele Spieler je Stufe und Verein im aktiven Pool stehen.
 *
 * 1,5 Weltklassespieler je Verein heißt: Bei vier Vereinen konkurrieren alle
 * um sechs Stars, und jeder hätte gern zwei. Genau daraus entstehen
 * Bieterkriege.
 */
export const TIER_PER_CLUB: Record<Tier, number> = {
  world_class: 1.5,
  very_good: 4.0,
  solid: 10.5,
};

export function poolComposition(clubCount: number): Record<Tier, number> {
  const worldClass = Math.round(clubCount * TIER_PER_CLUB.world_class);
  const veryGood = Math.round(clubCount * TIER_PER_CLUB.very_good);
  return {
    world_class: worldClass,
    very_good: veryGood,
    solid: clubCount * POOL_PER_CLUB - worldClass - veryGood,
  };
}

export const MARKET = {
  /** Mindestpreis einer Auktion, als Anteil des Marktwerts */
  MIN_PRICE_SHARE: 0.55,
  /** Anteil der Auktionen, auf denen die Außenwelt mitbietet (GDD §5.4) */
  OUTSIDE_BID_SHARE: 0.30,
  /** Obergrenze der Außenwelt — sie gewinnt nie gegen einen entschlossenen Menschen */
  OUTSIDE_BID_CEILING: 0.90,
  /** Neue Auktionen je Markttag */
  NEW_AUCTIONS_PER_DAY_MIN: 3,
  NEW_AUCTIONS_PER_DAY_MAX: 6,
  /** Ein Verein muss mindestens so viele Spieler behalten */
  MIN_SQUAD_SIZE: 14,
} as const;

export function minimumPrice(marketValue: number): number {
  return Math.round(marketValue * MARKET.MIN_PRICE_SHARE);
}

/**
 * Gebot der Außenwelt auf eine Auktion.
 *
 * Zweck: Der Markt fühlt sich bei drei Freunden nicht leer an, und niemand
 * bekommt einen 100-Mio-Star für zwei Millionen, nur weil die anderen gerade
 * arbeiten. Die Obergrenze von 90 Prozent stellt sicher, dass ein Mensch, der
 * den Spieler wirklich will, immer gewinnen kann — ein Bieterkrieg, den man
 * gegen einen Algorithmus verliert, ist kein Drama, sondern Ärger.
 */
export function outsideWorldBid(
  marketValue: number, currentBid: number | null, rng: Rng,
): number | null {
  if (!rng.chance(MARKET.OUTSIDE_BID_SHARE)) return null;
  const ceiling = Math.round(marketValue * MARKET.OUTSIDE_BID_CEILING);
  const target = Math.round(marketValue * rng.gaussian(0.72, 0.12, 0.5, MARKET.OUTSIDE_BID_CEILING));
  if (currentBid !== null && target <= currentBid) return null;
  return Math.min(target, ceiling);
}

/**
 * Marktwert nach Positionsknappheit (GDD §4.5).
 *
 * Der interessante Teil: Der Markt reagiert auf das Verhalten der Freunde.
 * Brauchen zwei von vier Vereinen dringend einen Torwart, steigt der Wert
 * aller Torhüter — nicht weil eine Tabelle das sagt, sondern weil die Gruppe
 * sich so verhalten hat.
 */
export function scarcityFactor(
  demandingClubs: number, availableAtPosition: number, clubCount: number,
): number {
  if (clubCount === 0) return 1;
  const demand = demandingClubs / clubCount;
  const supply = availableAtPosition / Math.max(clubCount, 1);
  const pressure = demand - Math.min(supply, 1);
  return Math.max(0.85, Math.min(1.35, 1 + pressure * 0.35));
}

export function newAuctionsForDay(rng: Rng): number {
  return rng.int(MARKET.NEW_AUCTIONS_PER_DAY_MIN, MARKET.NEW_AUCTIONS_PER_DAY_MAX);
}
