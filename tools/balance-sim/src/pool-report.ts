/**
 * Zweiter Kalibrierungslauf: Zielkurve mit echten Kadern statt Kunstwerten.
 * Läuft mit `npm run balance:pool`.
 */

import { hashSeed } from "../../../packages/shared/src/rules/rng.ts";
import { simulateMatch } from "../../../packages/shared/src/rules/match/simulate.ts";
import { buildRealisticSquad, loadPool, squadStrength, squadValue, squadWage } from "./realistic.ts";

const RUNS = Number(process.env.RUNS ?? 20000);
const pool = loadPool();

const pad = (s: string, n: number) => s.padEnd(n);
const padL = (s: string, n: number) => s.padStart(n);
const mio = (v: number) => `${(v / 1_000_000).toFixed(0)} Mio`;

console.log(`\nKalibrierung mit echten Kadern — ${pool.length} Spieler im Pool`);
console.log(`${RUNS.toLocaleString("de-DE")} Partien je Paarung\n`);

/** Zielwerte aus GDD §8.2, linear interpoliert für Zwischenwerte. */
const CURVE: [number, number][] = [[0, 38], [5, 50], [10, 62], [20, 76]];
function expectedFavWin(delta: number): number {
  if (delta <= 0) return 38;
  for (let i = 1; i < CURVE.length; i++) {
    const [x1, y1] = CURVE[i - 1]!, [x2, y2] = CURVE[i]!;
    if (delta <= x2) return y1 + ((delta - x1) / (x2 - x1)) * (y2 - y1);
  }
  return 76 + (delta - 20) * 0.5;
}

console.log("PAARUNGEN AUS DEM ECHTEN POOL");
console.log("─".repeat(88));
console.log(
  pad("Ziel-OVR", 14) + padL("echte Stärke", 15) + padL("Differenz", 11) +
  padL("Sieg Fav", 11) + padL("erwartet", 11) + padL("Remis", 9) + padL("Tore", 14),
);
console.log("─".repeat(88));

const pairings: [number, number][] = [[80, 80], [82, 78], [85, 76], [88, 72], [90, 70]];
let worst = 0;

for (const [strongTarget, weakTarget] of pairings) {
  const used = new Set<string>();
  const strong = buildRealisticSquad("FAV", strongTarget, pool, used);
  const weak = buildRealisticSquad("UND", weakTarget, pool, used);
  const sFav = squadStrength(strong), sUnd = squadStrength(weak);
  const delta = sFav - sUnd;

  let favWin = 0, draw = 0, favGoals = 0, undGoals = 0;
  for (let i = 0; i < RUNS; i++) {
    const favHome = i % 2 === 0;
    const r = simulateMatch(
      favHome ? strong : weak, favHome ? weak : strong,
      { homeSupport: 0, isDerby: false }, hashSeed("pool", strongTarget, i),
    );
    const fg = favHome ? r.homeGoals : r.awayGoals;
    const ug = favHome ? r.awayGoals : r.homeGoals;
    if (fg > ug) favWin++; else if (fg === ug) draw++;
    favGoals += fg; undGoals += ug;
  }

  const got = (favWin / RUNS) * 100;
  const expected = expectedFavWin(delta);
  const deviation = Math.abs(got - expected);
  worst = Math.max(worst, deviation);

  console.log(
    pad(`${strongTarget} vs ${weakTarget}`, 14) +
    padL(`${sFav.toFixed(1)} / ${sUnd.toFixed(1)}`, 15) +
    padL(`+${delta.toFixed(1)}`, 11) +
    padL(`${got.toFixed(1)} %`, 11) +
    padL(`${expected.toFixed(1)} %`, 11) +
    padL(`${((draw / RUNS) * 100).toFixed(1)} %`, 9) +
    padL(`${(favGoals / RUNS).toFixed(2)} : ${(undGoals / RUNS).toFixed(2)}`, 14),
  );
}
console.log("─".repeat(88));
console.log(`Größte Abweichung von der Zielkurve: ${worst.toFixed(1)} Prozentpunkte\n`);

console.log("WIRTSCHAFTLICHE TRAGFÄHIGKEIT (16er-Kader, GDD §19.1)");
console.log("─".repeat(88));
for (const target of [88, 84, 80, 76, 72]) {
  const used = new Set<string>();
  const squad = buildRealisticSquad("X", target, pool, used);
  const value = squadValue(squad, pool);
  const wagePerSeason = squadWage(squad, pool) * 21;
  const share = (wagePerSeason / 71_000_000) * 100;
  const affordable = value <= 400_000_000;
  console.log(
    pad(`${affordable ? "✓" : "✗"} Ziel ${target} OVR`, 18) +
    padL(`Stärke ${squadStrength(squad).toFixed(1)}`, 15) +
    padL(`Kaderwert ${mio(value)}`, 20) +
    padL(`Gehalt/Saison ${mio(wagePerSeason)}`, 24) +
    padL(`${share.toFixed(0)} % der Einnahmen`, 22),
  );
}
console.log("─".repeat(88));
console.log("Budget 400 Mio · Saisoneinnahmen 71 Mio · gesunde Gehaltsquote 45–60 %\n");

// ── Draft-Test ────────────────────────────────────────────────────────────
//
// Der wichtigste Test des Pools: Vier Vereine ziehen reihum aus demselben
// Angebot, jeder mit 400 Mio. Wenn die Spannweite der Teamstärken hier schon
// groß ist, ist die Liga vor dem ersten Spieltag entschieden — und die
// Zielwerte aus GDD §19.4 sind nicht zu halten.

import { positionPenalty } from "../../../packages/shared/src/rules/ratings.ts";
import { DEFAULT_TACTICS, type MatchPlayer, type MatchSquad, type Position }
  from "../../../packages/shared/src/types/match.ts";
import type { PoolPlayer } from "./realistic.ts";

const BUDGET = 400_000_000;
const SQUAD_SIZE = 16;
const NEEDS: Position[] = [
  "GK", "GK", "CB", "CB", "CB", "LB", "RB", "DM", "CM", "CM", "AM", "LW", "RW", "ST", "ST", "ST",
];

const XI_SLOTS: Position[] = [
  "GK", "LB", "CB", "CB", "RB", "LW", "CM", "CM", "RW", "ST", "ST",
];

/**
 * Stellt die beste Elf auf, die der Kader hergibt — positionsgerecht.
 *
 * Ohne diesen Schritt misst der Draft-Test nicht die Kaderqualität, sondern die
 * Positionsabzüge einer unsinnigen Aufstellung. Genau das ist beim ersten Lauf
 * passiert und hat die Teamstärken um rund zehn Punkte zu niedrig ausgewiesen.
 */
function bestEleven(clubId: string, squadPlayers: PoolPlayer[]): MatchSquad {
  const available = [...squadPlayers];
  const toPlayer = (p: PoolPlayer, slot: Position): MatchPlayer => ({
    id: p.externalKey, name: p.fullName, position: slot,
    naturalPosition: p.primaryPosition, attrs: p.attributes,
    form: 50, fitness: 100, morale: 60, traits: p.traits,
  });

  const starters: MatchPlayer[] = [];
  for (const slot of XI_SLOTS) {
    if (available.length === 0) break;
    // Passgenauigkeit zuerst, Qualität danach
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < available.length; i++) {
      const p = available[i]!;
      const score = p.overall - positionPenalty(p.primaryPosition, slot);
      if (score > bestScore) { bestScore = score; bestIndex = i; }
    }
    starters.push(toPlayer(available.splice(bestIndex, 1)[0]!, slot));
  }
  return {
    clubId, clubName: clubId, starters,
    bench: available.map((p) => toPlayer(p, p.primaryPosition)),
    tactics: { ...DEFAULT_TACTICS }, chemistry: 50,
  };
}

function runDraft(clubCount: number, seed: number) {
  const poolSize = clubCount * 16;
  // Aktiver Pool nach GDD §5.2: knapp, mit fester Weltklassequote
  const byTier = (t: string) => pool.filter((p) => p.tier === t);
  const active = [
    ...byTier("world_class").slice(0, Math.round(clubCount * 1.5)),
    ...byTier("very_good").slice(0, Math.round(clubCount * 4)),
    ...byTier("solid").slice(0, poolSize - Math.round(clubCount * 1.5) - Math.round(clubCount * 4)),
  ];

  const clubs = Array.from({ length: clubCount }, (_, i) => ({
    id: `C${i + 1}`, budget: BUDGET,
    players: [] as typeof active, needs: [...NEEDS],
  }));
  const taken = new Set<string>();

  // Reihum: jeder nimmt den besten Spieler, den er sich leisten kann und braucht.
  // Bewusst gierig — das ist das aggressivste realistische Verhalten und damit
  // die obere Schranke für die Spreizung.
  for (let round = 0; round < SQUAD_SIZE; round++) {
    for (const club of clubs) {
      const slotsLeft = SQUAD_SIZE - club.players.length;
      // Reserve, damit am Ende noch billige Spieler für offene Plätze bleiben
      const reserve = (slotsLeft - 1) * 3_000_000;
      const affordable = active.filter((p) =>
        !taken.has(p.externalKey) &&
        p.baseValue <= club.budget - reserve &&
        club.needs.includes(p.primaryPosition));
      const fallback = active.filter((p) =>
        !taken.has(p.externalKey) && p.baseValue <= club.budget - reserve);
      const options = affordable.length > 0 ? affordable : fallback;
      if (options.length === 0) continue;
      const pick = options.reduce((a, b) => (b.overall > a.overall ? b : a));
      taken.add(pick.externalKey);
      club.budget -= pick.baseValue;
      club.players.push(pick);
      const idx = club.needs.indexOf(pick.primaryPosition);
      if (idx >= 0) club.needs.splice(idx, 1);
    }
  }

  return clubs.map((club) => {
    const squad = bestEleven(club.id, club.players);
    return {
      id: club.id,
      strength: squadStrength(squad),
      value: club.players.reduce((s, p) => s + p.baseValue, 0),
      wage: club.players.reduce((s, p) => s + p.baseWage, 0) * 21,
      left: club.budget,
      size: club.players.length,
    };
  });
}

console.log("DRAFT AUS DEM GEMEINSAMEN POOL — jeder 400 Mio, gierige Strategie");
console.log("─".repeat(88));
for (const clubCount of [3, 4, 6]) {
  const result = runDraft(clubCount, hashSeed("draft", clubCount));
  const strengths = result.map((r) => r.strength);
  const values = result.map((r) => r.value);
  const spread = Math.max(...strengths) - Math.min(...strengths);
  const valueRatio = Math.max(...values) / Math.max(Math.min(...values), 1);
  const ok = spread <= 6 && valueRatio <= 2.2;
  console.log(
    pad(`${ok ? "✓" : "✗"} ${clubCount} Vereine`, 14) +
    padL(`Stärke ${Math.min(...strengths).toFixed(1)} – ${Math.max(...strengths).toFixed(1)}`, 22) +
    padL(`Spanne ${spread.toFixed(1)}`, 16) + "  " +
    padL(`Kaderwert ${mio(Math.min(...values))} – ${mio(Math.max(...values))}`, 26) +
    padL(`Faktor ${valueRatio.toFixed(2)}`, 14),
  );
}
console.log("─".repeat(88));
console.log("Zielwerte GDD §19.4: Kaderwert-Faktor unter 2,2 · Stärkespanne möglichst unter 6\n");
