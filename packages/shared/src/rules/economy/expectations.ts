/**
 * Erwartungswerte (GDD §11.2, §3).
 *
 * Der wichtigste Anti-Snowball-Hebel des Spiels: Fans und Vorstand bewerten
 * einen Verein **relativ zu seinem Kaderwert**, nicht absolut. Wer sich den
 * teuersten Kader kauft, kauft sich damit gleichzeitig die härtesten Fans.
 *
 * Das ist kein aufgesetztes Gummiband — es ist narrativ vollkommen plausibel,
 * und genau deshalb funktioniert es, ohne dass sich der Führende betrogen fühlt.
 */

import { clamp } from "../ratings.ts";

/** Punkte pro Spiel, die eine durchschnittliche Mannschaft holt. */
export const AVERAGE_POINTS_PER_GAME = 1.38;

/**
 * Erwartete Punkte pro Spiel aus dem Kaderwert relativ zur Liga.
 *
 * Der Exponent unter 1 dämpft die Erwartung an den teuersten Kader bewusst:
 * Ein doppelt so teurer Kader gewinnt nicht doppelt so viel — die Simulation
 * gibt das gar nicht her (GDD §8.2). Eine Erwartung, die höher liegt als das
 * mechanisch Erreichbare, wäre keine Herausforderung, sondern eine Falle.
 */
export function expectedPointsPerGame(squadValue: number, leagueAverageValue: number): number {
  if (leagueAverageValue <= 0) return AVERAGE_POINTS_PER_GAME;
  const relative = squadValue / leagueAverageValue;
  return clamp(AVERAGE_POINTS_PER_GAME * Math.pow(relative, 0.55), 0.65, 2.35);
}

/** Erwartete Platzierung: Rang nach Kaderwert, 1-basiert. */
export function expectedRank(squadValues: readonly number[], clubIndex: number): number {
  const own = squadValues[clubIndex] ?? 0;
  return squadValues.filter((value) => value > own).length + 1;
}

export type SeasonGoal = "title" | "top_half" | "mid_table" | "avoid_last";

/**
 * Saisonziel des Vorstands, abgeleitet aus der erwarteten Platzierung.
 * Der teuerste Kader bekommt "Meister werden", der billigste "Nicht Letzter".
 */
export function seasonGoal(rank: number, clubCount: number): SeasonGoal {
  if (rank === 1) return "title";
  if (rank <= Math.ceil(clubCount / 3)) return "top_half";
  if (rank < clubCount) return "mid_table";
  return "avoid_last";
}
