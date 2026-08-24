/**
 * Einnahmen und laufende Kosten (GDD §13).
 *
 * Alle Werte sind auf die Zielaufteilung aus GDD §13.1 kalibriert:
 * rund 71 Mio Saisoneinnahmen je Verein, verteilt auf TV 30, Sponsoren 15,
 * Tickets 12, Merchandise 8 und Prämien 6 Mio.
 */

import { clamp } from "../ratings.ts";
import { moodZone } from "./fans.ts";

export const ECONOMY = {
  MATCHDAYS_PER_SEASON: 21,

  /** TV-Geld je Verein und Saison */
  TV_PER_SEASON: 30_000_000,
  /** Anteil, der als Sockel gleichmäßig verteilt wird (GDD §13.2) */
  TV_BASE_SHARE: 0.60,

  /** Merchandise je Fan und Spieltag bei neutraler Stimmung */
  MERCH_PER_FAN: 1.10,

  /** Betriebskosten je Stadionplatz und Spieltag */
  UPKEEP_PER_SEAT: 22.9,
  /** Zustandsverlust des Stadions je Spieltag, in Prozentpunkten */
  CONDITION_DECAY: 0.6,

  /**
   * Prämien — bewusst flach (GDD §9.3).
   *
   * Diese Zahlen weichen stark von der ersten Fassung des Designs ab, siehe
   * den Hinweis unten bei `placementPrize`.
   */
  WIN_BONUS: 220_000,
  DRAW_BONUS: 70_000,
  PLACEMENT_TOP: 7_000_000,
  PLACEMENT_BOTTOM: 4_000_000,
} as const;

/** Sockelanteil des TV-Geldes, ausgezahlt je Spieltag. */
export function tvBasePerMatchday(): number {
  return Math.round(
    (ECONOMY.TV_PER_SEASON * ECONOMY.TV_BASE_SHARE) / ECONOMY.MATCHDAYS_PER_SEASON,
  );
}

/**
 * Leistungsabhängiger TV-Anteil am Saisonende.
 *
 * Der Sockel von 60 % ist ein bewusster Anti-Snowball-Hebel: Er ist der Grund,
 * warum ein schwacher Verein nie finanziell abstirbt (GDD §19.2, Nr. 8).
 */
export function tvPerformanceShare(
  rank: number, clubCount: number, fanShare: number,
): number {
  const pool = ECONOMY.TV_PER_SEASON * (1 - ECONOMY.TV_BASE_SHARE);
  const rankScore = clubCount > 1 ? (clubCount - rank) / (clubCount - 1) : 1;
  // Halb nach Tabellenplatz, halb nach Reichweite
  return Math.round(pool * (0.5 * rankScore + 0.5 * clamp(fanShare * clubCount, 0, 2) / 2) * 2);
}

/** Merchandise-Erlös eines Spieltags. */
export function merchandise(fanCount: number, mood: number, hasShop = false): number {
  const zone = moodZone(mood);
  const multiplier = zone === "euphoric" ? 1.4
    : zone === "content" ? 1.0
    : zone === "restless" ? 0.75
    : 0.5;
  return Math.round(fanCount * ECONOMY.MERCH_PER_FAN * multiplier * (hasShop ? 1.25 : 1));
}

/** Ticketerlös eines Heimspiels. */
export function ticketIncome(
  capacity: number, occupancyRate: number, ticketPrice: number,
): { attendance: number; income: number } {
  const attendance = Math.round(capacity * occupancyRate);
  return { attendance, income: attendance * ticketPrice };
}

/** Betriebskosten je Spieltag — skalieren mit der Stadiongröße. */
export function upkeep(capacity: number, condition: number): number {
  // Ein heruntergekommenes Stadion ist teurer im Unterhalt, nicht billiger
  const conditionFactor = condition >= 90 ? 1 : 1 + (90 - condition) / 100;
  return Math.round(capacity * ECONOMY.UPKEEP_PER_SEAT * conditionFactor);
}

export function matchBonus(points: number): number {
  return points === 3 ? ECONOMY.WIN_BONUS : points === 1 ? ECONOMY.DRAW_BONUS : 0;
}

/**
 * Platzierungsprämie am Saisonende.
 *
 * **Abweichung vom ursprünglichen Design.** GDD §9.3 nannte 40 Mio für den
 * Ersten und 25 Mio für den Letzten. Das ist mit der Zielaufteilung aus §13.1
 * nicht vereinbar: Dort sind Prämien mit 6 Mio je Verein und Saison
 * veranschlagt, bei Gesamteinnahmen von 71 Mio. Die alten Zahlen hätten die
 * Prämien zur mit Abstand größten Einnahmequelle gemacht — in einem Abschnitt,
 * der ausdrücklich "bewusst flach" überschrieben ist und dessen Zweck es ist,
 * sportlichen Erfolg **nicht** in ökonomische Dominanz umzumünzen.
 *
 * Die Spanne beträgt jetzt 3 Mio, zusammen mit den Siegprämien rund 5 Mio —
 * etwa 7 % der Saisoneinnahmen und damit klar unter der Obergrenze von 21 %
 * aus GDD §19.1.
 */
export function placementPrize(rank: number, clubCount: number): number {
  if (clubCount <= 1) return ECONOMY.PLACEMENT_TOP;
  const share = (clubCount - rank) / (clubCount - 1);
  return Math.round(
    ECONOMY.PLACEMENT_BOTTOM +
    (ECONOMY.PLACEMENT_TOP - ECONOMY.PLACEMENT_BOTTOM) * share,
  );
}

// ── Sponsoren (GDD §14.2) ─────────────────────────────────────────────────

export type SponsorProfile = "safe" | "performance" | "controversial";

export interface SponsorTerms {
  profile: SponsorProfile;
  /** Fixum je Spieltag */
  basePerMatchday: number;
  bonusPerWin: number;
  titleBonus: number;
  /** Einmalige Stimmungswirkung beim Abschluss */
  moodImmediate: number;
  /** Laufende Stimmungswirkung je Spieltag */
  moodPerMatchday: number;
}

/**
 * Die drei Angebote unterscheiden sich nicht in der Höhe, sondern im
 * Risikoprofil. Das dritte ist das interessanteste: Es verwandelt Fanstimmung
 * in eine handelbare Währung — verzweifelte Vereine nehmen es, und die Freunde
 * verspotten sie dafür.
 */
export function sponsorTerms(profile: SponsorProfile): SponsorTerms {
  const perMatchday = (perSeason: number) =>
    Math.round(perSeason / ECONOMY.MATCHDAYS_PER_SEASON);

  switch (profile) {
    case "safe":
      return { profile, basePerMatchday: perMatchday(15_000_000), bonusPerWin: 0,
        titleBonus: 0, moodImmediate: 0, moodPerMatchday: 0 };
    case "performance":
      return { profile, basePerMatchday: perMatchday(5_000_000), bonusPerWin: 700_000,
        titleBonus: 12_000_000, moodImmediate: 0, moodPerMatchday: 0 };
    case "controversial":
      return { profile, basePerMatchday: perMatchday(28_000_000), bonusPerWin: 0,
        titleBonus: 0, moodImmediate: -12, moodPerMatchday: -0.4 };
  }
}
