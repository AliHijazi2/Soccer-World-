/**
 * Headless-Balancing (GDD §20.5, Schritt 1).
 *
 * Prüft die Simulation gegen die Zielkurve aus GDD §8.2, ohne Server und ohne
 * Datenbank. Läuft mit `npm run balance`.
 */

import { createRng, hashSeed } from "../../../packages/shared/src/rules/rng.ts";
import { simulateMatch, TUNING } from "../../../packages/shared/src/rules/match/simulate.ts";
import { teamRatings } from "../../../packages/shared/src/rules/ratings.ts";
import { makeSquad } from "./squads.ts";

const RUNS = Number(process.env.RUNS ?? 20000);
const BASE_STRENGTH = 74;

interface Outcome {
  favWin: number; draw: number; underdogWin: number;
  favGoals: number; underdogGoals: number;
  favXg: number; underdogXg: number;
  yellow: number; red: number; injuries: number; events: number;
}

/** Zielwerte aus GDD §8.2 in Prozent */
const TARGETS: Record<number, [number, number, number]> = {
  0:  [38, 24, 38],
  5:  [50, 23, 27],
  10: [62, 20, 18],
  20: [76, 15,  9],
};

function runSeries(delta: number, homeSupport: number, runs: number): Outcome {
  const out: Outcome = {
    favWin: 0, draw: 0, underdogWin: 0, favGoals: 0, underdogGoals: 0,
    favXg: 0, underdogXg: 0, yellow: 0, red: 0, injuries: 0, events: 0,
  };
  const setupRng = createRng(hashSeed("setup", delta));
  const favourite = makeSquad("FAV", BASE_STRENGTH + delta, setupRng);
  const underdog = makeSquad("UND", BASE_STRENGTH, setupRng);

  for (let i = 0; i < runs; i++) {
    // Favorit spielt abwechselnd zu Hause, damit ein Heimvorteil sich herausmittelt
    const favAtHome = i % 2 === 0;
    const home = favAtHome ? favourite : underdog;
    const away = favAtHome ? underdog : favourite;
    const result = simulateMatch(
      home, away, { homeSupport, isDerby: false }, hashSeed("match", delta, i),
    );

    const favGoals = favAtHome ? result.homeGoals : result.awayGoals;
    const undGoals = favAtHome ? result.awayGoals : result.homeGoals;
    const favStats = favAtHome ? result.home : result.away;
    const undStats = favAtHome ? result.away : result.home;

    if (favGoals > undGoals) out.favWin++;
    else if (favGoals === undGoals) out.draw++;
    else out.underdogWin++;

    out.favGoals += favGoals;
    out.underdogGoals += undGoals;
    out.favXg += favStats.expectedGoals;
    out.underdogXg += undStats.expectedGoals;
    out.yellow += result.home.yellowCards + result.away.yellowCards;
    out.red += result.home.redCards + result.away.redCards;
    out.injuries += result.injuries.length;
    out.events += result.events.length;
  }
  return out;
}

function pct(value: number, total: number): number {
  return Math.round((value / total) * 1000) / 10;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}
function padLeft(text: string, width: number): string {
  return text.length >= width ? text : " ".repeat(width - text.length) + text;
}

console.log(`\nSoccer World — Balancing-Bericht`);
console.log(`${RUNS.toLocaleString("de-DE")} Partien je Stufe, Basisstärke ${BASE_STRENGTH}\n`);

console.log("ZIELKURVE (GDD §8.2) — ohne Heimvorteil");
console.log("─".repeat(74));
console.log(
  pad("Differenz", 11) + padLeft("Sieg Fav", 10) + padLeft("Ziel", 8) +
  padLeft("Remis", 9) + padLeft("Ziel", 8) + padLeft("Sieg Underdog", 16) + padLeft("Ziel", 8),
);
console.log("─".repeat(74));

let maxDeviation = 0;
for (const deltaKey of Object.keys(TARGETS)) {
  const delta = Number(deltaKey);
  const o = runSeries(delta, 0, RUNS);
  const target = TARGETS[delta] as [number, number, number];
  const got: [number, number, number] = [
    pct(o.favWin, RUNS), pct(o.draw, RUNS), pct(o.underdogWin, RUNS),
  ];
  for (let i = 0; i < 3; i++) {
    maxDeviation = Math.max(maxDeviation, Math.abs((got[i] as number) - (target[i] as number)));
  }
  const mark = got.every((v, i) => Math.abs(v - (target[i] as number)) <= 2.5) ? "✓" : "✗";
  console.log(
    pad(`${mark} +${delta} OVR`, 11) +
    padLeft(`${got[0]} %`, 10) + padLeft(`${target[0]} %`, 8) +
    padLeft(`${got[1]} %`, 9) + padLeft(`${target[1]} %`, 8) +
    padLeft(`${got[2]} %`, 16) + padLeft(`${target[2]} %`, 8),
  );
}
console.log("─".repeat(74));
console.log(`Größte Abweichung: ${Math.round(maxDeviation * 10) / 10} Prozentpunkte`);
console.log(`Toleranz: 2,5 Prozentpunkte\n`);

console.log("TORE UND TICKER");
console.log("─".repeat(74));
for (const deltaKey of Object.keys(TARGETS)) {
  const delta = Number(deltaKey);
  const o = runSeries(delta, 0, Math.min(RUNS, 5000));
  const n = Math.min(RUNS, 5000);
  console.log(
    pad(`+${delta} OVR`, 11) +
    padLeft(`Tore ${(o.favGoals / n).toFixed(2)} : ${(o.underdogGoals / n).toFixed(2)}`, 22) +
    padLeft(`xG ${(o.favXg / n).toFixed(2)} : ${(o.underdogXg / n).toFixed(2)}`, 20) +
    padLeft(`Ticker ${(o.events / n).toFixed(1)}`, 16),
  );
}
console.log("─".repeat(74) + "\n");

console.log("HEIMVORTEIL bei gleicher Stärke (Heimteam links)");
console.log("─".repeat(74));
for (const support of [0, 0.35, 0.7, 1.0]) {
  const setupRng = createRng(hashSeed("home", support));
  const home = makeSquad("H", BASE_STRENGTH, setupRng);
  const away = makeSquad("A", BASE_STRENGTH, setupRng);
  let w = 0, d = 0, l = 0;
  const n = Math.min(RUNS, 10000);
  for (let i = 0; i < n; i++) {
    const r = simulateMatch(home, away, { homeSupport: support, isDerby: false },
      hashSeed("homematch", support, i));
    if (r.homeGoals > r.awayGoals) w++;
    else if (r.homeGoals === r.awayGoals) d++;
    else l++;
  }
  console.log(
    pad(`Support ${support.toFixed(2)}`, 16) +
    padLeft(`${pct(w, n)} %`, 10) + padLeft(`${pct(d, n)} %`, 10) + padLeft(`${pct(l, n)} %`, 10),
  );
}
console.log("─".repeat(74) + "\n");

console.log("DISZIPLIN UND VERLETZUNGEN (je Partie)");
console.log("─".repeat(74));
const disc = runSeries(0, 0.5, Math.min(RUNS, 10000));
const dn = Math.min(RUNS, 10000);
console.log(`Gelbe Karten   ${(disc.yellow / dn).toFixed(2)}   (Ziel ca. 3,4 für beide Teams)`);
console.log(`Rote Karten    ${(disc.red / dn).toFixed(3)}   (Ziel ca. 0,12)`);
console.log(`Verletzungen   ${(disc.injuries / dn).toFixed(3)}   (Ziel ca. 0,40)`);
console.log("─".repeat(74) + "\n");

console.log("DETERMINISMUS");
const rngCheck = createRng(hashSeed("det"));
const s1 = makeSquad("X", 78, rngCheck);
const s2 = makeSquad("Y", 72, rngCheck);
const ctx = { homeSupport: 0.6, isDerby: true };
const a1 = simulateMatch(s1, s2, ctx, 123456);
const a2 = simulateMatch(s1, s2, ctx, 123456);
const identical = JSON.stringify(a1) === JSON.stringify(a2);
console.log(identical
  ? "✓ Gleicher Seed ergibt bitgleiches Ergebnis"
  : "✗ FEHLER: Simulation ist nicht deterministisch");
console.log(`  Beispielpartie: ${a1.homeGoals}:${a1.awayGoals}, ${a1.events.length} Ticker-Ereignisse\n`);

const strong = teamRatings(s1);
console.log(`Teamwerte X (Attribute 78): Def ${strong.defence.toFixed(1)}  Mid ${strong.midfield.toFixed(1)}  Att ${strong.attack.toFixed(1)}  TW ${strong.keeper.toFixed(1)}  Gesamt ${strong.overall.toFixed(1)}`);
console.log(`Stellschrauben: CHANCE_BASE ${TUNING.CHANCE_BASE}  XG_BASE ${TUNING.XG_BASE}  STRENGTH_EXP ${TUNING.STRENGTH_EXPONENT}  POSS_EXP ${TUNING.POSSESSION_EXPONENT}\n`);
