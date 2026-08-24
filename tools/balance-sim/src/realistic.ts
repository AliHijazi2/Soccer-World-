/**
 * Kader aus dem echten Spielerpool bauen.
 *
 * Der Kurventest mit gleichmäßigen Kunstwerten (squads.ts) prüft den reinen
 * Stärkeunterschied. Dieser hier prüft, ob die Kalibrierung auch mit echten
 * Spielern hält — die haben schiefe Profile: ein Stürmer mit Zweikampf 45 zieht
 * die Defensivbewertung anders als ein künstlich gleichmäßiger Spieler.
 */

import { readFileSync } from "node:fs";
import {
  DEFAULT_TACTICS, type MatchPlayer, type MatchSquad, type Position, type Trait,
} from "../../../packages/shared/src/types/match.ts";
import { teamRatings } from "../../../packages/shared/src/rules/ratings.ts";

export interface PoolPlayer {
  externalKey: string;
  fullName: string;
  age: number;
  primaryPosition: Position;
  tier: string;
  overall: number;
  attributes: MatchPlayer["attrs"];
  traits: Trait[];
  baseValue: number;
  baseWage: number;
}

export function loadPool(): PoolPlayer[] {
  const raw = JSON.parse(readFileSync("data/players.json", "utf8")) as { players: PoolPlayer[] };
  return raw.players;
}

const FORMATION: Position[] = [
  "GK", "LB", "CB", "CB", "RB", "LW", "CM", "CM", "RW", "ST", "ST",
];
const BENCH_SLOTS: Position[] = ["GK", "CB", "CM", "RW", "ST"];

function toMatchPlayer(p: PoolPlayer, slot: Position): MatchPlayer {
  return {
    id: p.externalKey, name: p.fullName,
    position: slot, naturalPosition: p.primaryPosition,
    attrs: p.attributes,
    form: 50, fitness: 100, morale: 60,
    traits: p.traits,
  };
}

/**
 * Wählt für jede Position den verfügbaren Spieler, dessen OVR dem Zielwert am
 * nächsten liegt. Passt keiner auf die Position, wird der beste Näherungswert
 * genommen — mit Positionsabzug, genau wie im Spiel.
 */
export function buildRealisticSquad(
  clubId: string, targetOvr: number, pool: PoolPlayer[], used: Set<string>,
): MatchSquad {
  const take = (slot: Position): MatchPlayer => {
    const exact = pool.filter((p) => !used.has(p.externalKey) && p.primaryPosition === slot);
    const candidates = exact.length > 0
      ? exact
      : pool.filter((p) => !used.has(p.externalKey) && p.primaryPosition !== "GK");
    if (candidates.length === 0) throw new Error("Pool erschöpft");
    let best = candidates[0]!;
    for (const c of candidates) {
      if (Math.abs(c.overall - targetOvr) < Math.abs(best.overall - targetOvr)) best = c;
    }
    used.add(best.externalKey);
    return toMatchPlayer(best, slot);
  };

  const starters = FORMATION.map(take);
  const bench = BENCH_SLOTS.map(take);
  return {
    clubId, clubName: clubId, starters, bench,
    tactics: { ...DEFAULT_TACTICS }, chemistry: 50,
  };
}

export function squadStrength(squad: MatchSquad): number {
  return teamRatings(squad).overall;
}

export function squadValue(squad: MatchSquad, pool: PoolPlayer[]): number {
  const byKey = new Map(pool.map((p) => [p.externalKey, p]));
  return [...squad.starters, ...squad.bench]
    .reduce((sum, p) => sum + (byKey.get(p.id)?.baseValue ?? 0), 0);
}

export function squadWage(squad: MatchSquad, pool: PoolPlayer[]): number {
  const byKey = new Map(pool.map((p) => [p.externalKey, p]));
  return [...squad.starters, ...squad.bench]
    .reduce((sum, p) => sum + (byKey.get(p.id)?.baseWage ?? 0), 0);
}
