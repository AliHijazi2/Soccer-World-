/** Erzeugt synthetische Mannschaften mit einer gewünschten Zielstärke. */

import {
  DEFAULT_TACTICS, type MatchPlayer, type MatchSquad, type Position,
} from "../../../packages/shared/src/types/match.ts";
import type { Rng } from "../../../packages/shared/src/rules/rng.ts";

const FORMATION_442: Position[] = [
  "GK", "LB", "CB", "CB", "RB", "LW", "CM", "CM", "RW", "ST", "ST",
];
const BENCH: Position[] = ["GK", "CB", "CM", "RW", "ST"];

function makePlayer(
  id: string, position: Position, strength: number, spread: number, rng: Rng,
): MatchPlayer {
  const v = (): number => Math.max(1, Math.min(99,
    Math.round(strength + (spread > 0 ? rng.gaussian(0, spread) : 0))));
  return {
    id, name: id, position, naturalPosition: position,
    attrs: {
      finishing: v(), technique: v(), vision: v(),
      tackling: v(), pace: v(), goalkeeping: v(),
    },
    form: 50, fitness: 100, morale: 60, traits: [],
  };
}

/**
 * Mannschaft mit gleichmäßiger Stärke. Alle Attribute liegen auf demselben
 * Niveau, damit die Zielkurve aus GDD §8.2 den reinen Stärkeunterschied misst
 * und nicht die Kaderform.
 */
export function makeSquad(
  clubId: string, strength: number, rng: Rng, spread = 0,
): MatchSquad {
  return {
    clubId,
    clubName: clubId,
    starters: FORMATION_442.map((pos, i) =>
      makePlayer(`${clubId}-s${i}`, pos, strength, spread, rng)),
    bench: BENCH.map((pos, i) =>
      makePlayer(`${clubId}-b${i}`, pos, strength - 6, spread, rng)),
    tactics: { ...DEFAULT_TACTICS },
    chemistry: 50,
  };
}
