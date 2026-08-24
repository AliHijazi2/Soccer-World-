import { test } from "node:test";
import assert from "node:assert/strict";

import { createRng, hashSeed } from "../src/rules/rng.ts";
import { overall, positionPenalty, teamRatings } from "../src/rules/ratings.ts";
import { simulateMatch } from "../src/rules/match/simulate.ts";
import { DEFAULT_TACTICS, type MatchPlayer, type MatchSquad, type Position }
  from "../src/types/match.ts";

const FORMATION: Position[] = [
  "GK", "LB", "CB", "CB", "RB", "LW", "CM", "CM", "RW", "ST", "ST",
];

function squad(clubId: string, strength: number): MatchSquad {
  const make = (id: string, position: Position, s: number): MatchPlayer => ({
    id, name: id, position, naturalPosition: position,
    attrs: {
      finishing: s, technique: s, vision: s,
      tackling: s, pace: s, goalkeeping: s,
    },
    form: 50, fitness: 100, morale: 60, traits: [],
  });
  return {
    clubId, clubName: clubId,
    starters: FORMATION.map((p, i) => make(`${clubId}-s${i}`, p, strength)),
    bench: (["GK", "CB", "CM", "ST", "RW"] as Position[])
      .map((p, i) => make(`${clubId}-b${i}`, p, strength - 6)),
    tactics: { ...DEFAULT_TACTICS },
    chemistry: 50,
  };
}

test("RNG ist deterministisch und stabil über Instanzen", () => {
  const a = createRng(12345);
  const b = createRng(12345);
  const seqA = Array.from({ length: 50 }, () => a.next());
  const seqB = Array.from({ length: 50 }, () => b.next());
  assert.deepEqual(seqA, seqB);
  assert.ok(seqA.every((v) => v >= 0 && v < 1));
});

test("hashSeed ist stabil und unterscheidet Argumentgrenzen", () => {
  assert.equal(hashSeed("liga", 3, 14), hashSeed("liga", 3, 14));
  // "ab"+"c" darf nicht denselben Seed ergeben wie "a"+"bc"
  assert.notEqual(hashSeed("ab", "c"), hashSeed("a", "bc"));
});

test("RNG-Verteilung ist grob gleichmäßig", () => {
  const rng = createRng(7);
  const buckets = new Array(10).fill(0);
  for (let i = 0; i < 100_000; i++) buckets[Math.floor(rng.next() * 10)]++;
  for (const count of buckets) {
    assert.ok(Math.abs(count - 10_000) < 700, `Bucket weicht zu stark ab: ${count}`);
  }
});

test("Positionsabzug bleibt im Rahmen des Designs (0 bis 25)", () => {
  assert.equal(positionPenalty("ST", "ST"), 0);
  assert.equal(positionPenalty("LB", "RB"), 4);
  assert.ok(positionPenalty("ST", "CB") >= 18);
  assert.equal(positionPenalty("ST", "GK"), 25);
  assert.equal(positionPenalty("GK", "ST"), 25);
});

test("OVR gewichtet positionsgerecht", () => {
  const poacher = {
    finishing: 90, technique: 70, vision: 60, tackling: 40, pace: 80, goalkeeping: 10,
  };
  // Derselbe Spieler ist als Stürmer deutlich wertvoller denn als Innenverteidiger
  assert.ok(overall(poacher, "ST") > overall(poacher, "CB") + 15);
});

test("Teamstärke wächst monoton mit der Spielerstärke", () => {
  const weak = teamRatings(squad("W", 65)).overall;
  const mid = teamRatings(squad("M", 75)).overall;
  const strong = teamRatings(squad("S", 85)).overall;
  assert.ok(weak < mid && mid < strong);
});

test("Kabinenklima verschiebt die Teamstärke um höchstens 5 Punkte", () => {
  const neutral = squad("N", 75);
  const toxic = { ...squad("T", 75), chemistry: 0 };
  const great = { ...squad("G", 75), chemistry: 100 };
  const base = teamRatings(neutral).overall;
  assert.ok(Math.abs(teamRatings(toxic).overall - base - -5) < 0.01);
  assert.ok(Math.abs(teamRatings(great).overall - base - 5) < 0.01);
});

test("Simulation ist bei gleichem Seed bitgleich", () => {
  const h = squad("H", 80);
  const a = squad("A", 74);
  const ctx = { homeSupport: 0.7, isDerby: true };
  const first = simulateMatch(h, a, ctx, 999);
  const second = simulateMatch(h, a, ctx, 999);
  assert.deepEqual(first, second);
});

test("Unterschiedliche Seeds ergeben unterschiedliche Partien", () => {
  const h = squad("H", 78);
  const a = squad("A", 78);
  const ctx = { homeSupport: 0.5, isDerby: false };
  const results = new Set(
    Array.from({ length: 40 }, (_, i) => {
      const r = simulateMatch(h, a, ctx, i + 1);
      return `${r.homeGoals}:${r.awayGoals}`;
    }),
  );
  assert.ok(results.size >= 6, `zu wenig Ergebnisvielfalt: ${results.size}`);
});

test("Der Ticker beginnt mit Anstoß und endet mit Abpfiff", () => {
  const r = simulateMatch(squad("H", 78), squad("A", 74), { homeSupport: 0.6, isDerby: false }, 42);
  assert.equal(r.events[0]?.type, "kickoff");
  assert.equal(r.events.at(-1)?.type, "fulltime");
  assert.ok(r.events.some((e) => e.type === "halftime"));
  // Fortlaufende, lückenlose Nummerierung — die Reihenfolge muss stabil sein
  r.events.forEach((e, i) => assert.equal(e.sequence, i));
});

test("Tore im Ticker stimmen mit dem Endstand überein", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const home = squad("H", 82);
    const away = squad("A", 70);
    const r = simulateMatch(home, away, { homeSupport: 0.6, isDerby: false }, seed);
    const homeGoalEvents = r.events.filter((e) => e.type === "goal" && e.clubId === "H").length;
    const awayGoalEvents = r.events.filter((e) => e.type === "goal" && e.clubId === "A").length;
    assert.equal(homeGoalEvents, r.homeGoals, `Seed ${seed}: Heimtore weichen ab`);
    assert.equal(awayGoalEvents, r.awayGoals, `Seed ${seed}: Auswärtstore weichen ab`);
    assert.equal(r.home.goals + r.away.goals, r.homeGoals + r.awayGoals);
    assert.equal(r.home.possession + r.away.possession, 100);
  }
});

test("Spielernoten decken die gesamte Startelf beider Teams ab", () => {
  const r = simulateMatch(squad("H", 76), squad("A", 76), { homeSupport: 0.5, isDerby: false }, 5);
  assert.equal(r.ratings.length, 22);
  assert.ok(r.ratings.every((rating) => rating.rating >= 1 && rating.rating <= 10));
});

test("Ohne Heimvorteil ist das Spiel bei gleicher Stärke symmetrisch", () => {
  let homeWins = 0, awayWins = 0;
  for (let seed = 1; seed <= 4000; seed++) {
    const r = simulateMatch(squad("H", 75), squad("A", 75), { homeSupport: 0, isDerby: false }, seed);
    if (r.homeGoals > r.awayGoals) homeWins++;
    else if (r.homeGoals < r.awayGoals) awayWins++;
  }
  const bias = Math.abs(homeWins - awayWins) / 4000;
  assert.ok(bias < 0.03, `Systematische Verzerrung: ${(bias * 100).toFixed(1)} %`);
});
