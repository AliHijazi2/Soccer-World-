/**
 * Fanmodell (GDD §11).
 *
 * Zwei getrennte Werte, weil sie unterschiedlich schnell reagieren:
 * Die Fanzahl ist träge und wächst über Tage, die Stimmung ist volatil und
 * kippt innerhalb eines Abends. Ein einziger Fan-Wert wäre der häufigste
 * Modellierungsfehler in einem Spiel dieser Art.
 */

import { clamp } from "../ratings.ts";

export const FANS = {
  /**
   * Wie stark ein Ergebnis über oder unter der Erwartung auf die Stimmung
   * schlägt. Bewusst niedrig: Bei 21 Spieltagen in sieben Tagen würde eine
   * hohe Sensitivität die Stimmung dreimal täglich zwischen Euphorie und
   * Aufstand springen lassen.
   */
  RESULT_SENSITIVITY: 2.2,
  /** Zusatzwirkung der Tordifferenz — ein 5:0 fühlt sich anders an als ein 1:0 */
  GOAL_DIFFERENCE_WEIGHT: 0.3,
  GOAL_DIFFERENCE_CAP: 2.0,
  /** Wirkung des Ticketpreises je Prozent Abweichung vom Referenzpreis */
  PRICE_SENSITIVITY: 0.25,
  /** Referenzpreis, an dem sich die Fans orientieren */
  REFERENCE_TICKET_PRICE: 40,
  /** Die Stimmung zieht pro Spieltag leicht zur Mitte zurück */
  REGRESSION_PER_MATCHDAY: 0.35,
} as const;

export type MoodZone = "euphoric" | "content" | "restless" | "hostile";

export function moodZone(mood: number): MoodZone {
  if (mood >= 85) return "euphoric";
  if (mood >= 60) return "content";
  if (mood >= 35) return "restless";
  return "hostile";
}

/** Auslastung nach Stimmungszone (GDD §11.4). */
const ZONE_OCCUPANCY: Record<MoodZone, number> = {
  euphoric: 1.00,
  content: 0.85,
  restless: 0.68,
  hostile: 0.47,
};

/**
 * Stadionauslastung aus Stimmung und Ticketpreis.
 *
 * Der Preisfaktor ist der Grund, warum der Ticketpreis eine echte Entscheidung
 * ist: Kurzfristige Gier füllt die Kasse und leert das Stadion — und ein leeres
 * Stadion kostet zusätzlich den Heimvorteil (GDD §8.3).
 */
export function occupancy(mood: number, ticketPrice: number): number {
  const zone = ZONE_OCCUPANCY[moodZone(mood)];
  const deviation = ticketPrice / FANS.REFERENCE_TICKET_PRICE - 1;
  const priceFactor = clamp(1 - deviation * 0.55, 0.25, 1.15);
  return clamp(zone * priceFactor, 0.10, 1.0);
}

export interface MatchMoodInput {
  /** Tatsächlich geholte Punkte: 3, 1 oder 0 */
  points: number;
  /** Erwartete Punkte pro Spiel aus dem Kaderwert */
  expectedPoints: number;
  goalsFor: number;
  goalsAgainst: number;
  ticketPrice: number;
  /** Nur Heimspiele wirken über den Ticketpreis */
  isHome: boolean;
}

/**
 * Stimmungsänderung nach einer Partie.
 *
 * Der Kern: gemessen wird die **Differenz zur Erwartung**, nicht das Ergebnis.
 * Ein 1:1 gegen den Letzten ist für den Meister eine Katastrophe und für den
 * Außenseiter ein Fest — mit denselben Zahlen auf der Anzeigetafel.
 */
export function moodChangeAfterMatch(input: MatchMoodInput): number {
  const performance = (input.points - input.expectedPoints) * FANS.RESULT_SENSITIVITY;

  const margin = clamp(
    (input.goalsFor - input.goalsAgainst) * FANS.GOAL_DIFFERENCE_WEIGHT,
    -FANS.GOAL_DIFFERENCE_CAP, FANS.GOAL_DIFFERENCE_CAP,
  );

  const price = input.isHome
    ? -((input.ticketPrice / FANS.REFERENCE_TICKET_PRICE - 1) * 100) *
      FANS.PRICE_SENSITIVITY / 10
    : 0;

  return performance + margin + price;
}

/** Wendet eine Änderung an und zieht die Stimmung leicht zur Mitte. */
export function applyMoodChange(current: number, change: number): number {
  const pulled = current + (50 - current) * (FANS.REGRESSION_PER_MATCHDAY / 100);
  return clamp(pulled + change, 0, 100);
}

/**
 * Wachstum der Fanbasis — träge und an die Stimmung gekoppelt.
 *
 * Nur anhaltende Zufriedenheit lässt die Fanzahl steigen; ein einzelner Sieg
 * bringt nichts. Umgekehrt wandern Fans in der feindseligen Zone spürbar ab.
 */
export function fanCountChange(fanCount: number, mood: number): number {
  const zone = moodZone(mood);
  const rate = zone === "euphoric" ? 0.006
    : zone === "content" ? 0.0015
    : zone === "restless" ? -0.002
    : -0.006;
  return Math.round(fanCount * rate);
}
