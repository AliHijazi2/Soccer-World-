/**
 * Aufstellungshilfen (GDD §7.1, §7.2).
 *
 * Wird an zwei Stellen gebraucht: als Vorschlag für den Spieler und als
 * automatische Korrektur, wenn jemand nicht aufgestellt hat oder Spieler
 * ausfallen.
 */

import { positionPenalty } from "./ratings.ts";
import type { MatchPlayer, Position } from "../types/match.ts";

export const FORMATIONS: Record<string, Position[]> = {
  "4-4-2": ["GK", "LB", "CB", "CB", "RB", "LW", "CM", "CM", "RW", "ST", "ST"],
  "4-3-3": ["GK", "LB", "CB", "CB", "RB", "DM", "CM", "CM", "LW", "ST", "RW"],
  "3-5-2": ["GK", "CB", "CB", "CB", "LW", "DM", "CM", "AM", "RW", "ST", "ST"],
  "5-3-2": ["GK", "LB", "CB", "CB", "CB", "RB", "DM", "CM", "CM", "ST", "ST"],
  "4-2-3-1": ["GK", "LB", "CB", "CB", "RB", "DM", "DM", "LW", "AM", "RW", "ST"],
};

export interface SelectablefPlayer {
  id: string;
  naturalPosition: Position;
  overall: number;
  fitness: number;
  available: boolean;
}

/**
 * Wählt die beste Elf, die der Kader hergibt.
 *
 * Bewertet wird Passgenauigkeit **vor** Qualität: Ein 85er-Stürmer in der
 * Innenverteidigung ist schlechter als ein 74er-Innenverteidiger. Wer nur nach
 * Gesamtwert sortiert, baut eine Elf, die auf dem Papier stark aussieht und
 * auf dem Platz auseinanderfällt.
 *
 * Fitness geht mit ein, aber schwächer als Positionseignung — sonst rotiert
 * die Automatik den besten Spieler bei Fitness 68 grundlos heraus.
 */
export function pickBestEleven<T extends SelectablefPlayer>(
  players: readonly T[], formation: keyof typeof FORMATIONS | Position[] = "4-4-2",
): { starters: { player: T; slot: Position }[]; bench: T[] } {
  const slots = Array.isArray(formation) ? formation : (FORMATIONS[formation] ?? FORMATIONS["4-4-2"]!);
  const pool = players.filter((p) => p.available);
  const starters: { player: T; slot: Position }[] = [];
  const used = new Set<string>();

  for (const slot of slots) {
    let best: T | null = null;
    let bestScore = -Infinity;
    for (const player of pool) {
      if (used.has(player.id)) continue;
      // Der Malus greift schon ab 85, nicht erst an der Leistungsgrenze von 70:
      // Wer erst bei 69 rotiert, schickt seine Stammelf systematisch müde ins
      // Spiel und fährt den Kader über die Saison an die Wand.
      const fitnessMalus = player.fitness >= 85 ? 0 : (85 - player.fitness) * 0.45;
      const score = player.overall - positionPenalty(player.naturalPosition, slot) - fitnessMalus;
      if (score > bestScore) { bestScore = score; best = player; }
    }
    if (!best) break;
    used.add(best.id);
    starters.push({ player: best, slot });
  }

  // Die frischesten Reservisten auf die Bank — sie sollen einwechselbar sein
  const bench = pool
    .filter((p) => !used.has(p.id))
    .sort((a, b) => (b.overall + b.fitness * 0.3) - (a.overall + a.fitness * 0.3))
    .slice(0, 5);

  return { starters, bench };
}

/** Fitnesswerte nach einem Spieltag (GDD §7.3). */
export const FITNESS = {
  PLAYED_FULL: -22,
  SUBSTITUTE: -9,
  ON_BENCH: +6,
  NOT_IN_SQUAD: +14,
  OVERNIGHT: +30,
  IRON_MAN_REDUCTION: 0.6,
} as const;

export function fitnessAfterMatch(
  player: Pick<MatchPlayer, "fitness" | "traits">,
  role: "played" | "substitute" | "bench" | "out",
  overnight: boolean,
): number {
  const base = role === "played" ? FITNESS.PLAYED_FULL
    : role === "substitute" ? FITNESS.SUBSTITUTE
    : role === "bench" ? FITNESS.ON_BENCH
    : FITNESS.NOT_IN_SQUAD;

  // "Eisenmann" wirkt nur auf Verluste, nicht auf die Erholung
  const adjusted = base < 0 && player.traits.includes("iron_man")
    ? base * FITNESS.IRON_MAN_REDUCTION
    : base;

  const value = player.fitness + adjusted + (overnight ? FITNESS.OVERNIGHT : 0);
  return Math.max(0, Math.min(100, value));
}
