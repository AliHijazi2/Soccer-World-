/**
 * Erzeugt data/players.json aus der handgepflegten data/roster.json.
 *
 * Der Roster nennt nur Name, Position, Zielgesamtwert, Jahrgang, Archetyp und
 * Traits. Attribute, Potenzialrange und Marktwert werden hier abgeleitet — und
 * zwar so, dass der berechnete OVR den Zielwert exakt trifft. Von Hand gesetzte
 * Attribute für 150 Spieler wären nie konsistent zu halten.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { overall } from "../../../packages/shared/src/rules/ratings.ts";
import type { Attributes, Position, Trait }
  from "../../../packages/shared/src/types/match.ts";

interface RosterEntry {
  name: string;
  pos: Position;
  ovr: number;
  born: number;
  arch: string;
  traits: Trait[];
}

/**
 * Archetypen formen das Attributprofil um den Zielwert herum.
 * Ohne sie hätte jeder Spieler dasselbe Profil und der Markt wäre langweilig:
 * Ein Abschlussstürmer und ein Wandspieler mit gleichem OVR sollen sich
 * unterschiedlich anfühlen und unterschiedlich gut in eine Elf passen.
 */
const ARCHETYPES: Record<string, Partial<Attributes>> = {
  shot_stopper:    { goalkeeping: +4, technique: -8, vision: -6, pace: -12, tackling: -10, finishing: -30 },
  sweeper_keeper:  { goalkeeping: +2, technique: +4, vision: +6, pace: -6, tackling: -8, finishing: -28 },
  destroyer:       { tackling: +7, pace: -3, technique: -6, vision: -4, finishing: -18 },
  ballplaying:     { tackling: +2, technique: +7, vision: +6, pace: -2, finishing: -14 },
  flying_fullback: { pace: +9, tackling: +1, technique: +2, vision: -3, finishing: -12 },
  anchor:          { tackling: +8, vision: +2, technique: -1, pace: -5, finishing: -12 },
  playmaker:       { vision: +8, technique: +7, tackling: -3, pace: -6, finishing: -6 },
  box_to_box:      { pace: +4, tackling: +4, vision: +1, finishing: -2 },
  creator:         { vision: +10, technique: +7, finishing: +1, tackling: -8, pace: -3 },
  technician:      { technique: +10, vision: +3, pace: +2, finishing: +2, tackling: -10 },
  explosive:       { pace: +11, technique: +4, finishing: +1, vision: -3, tackling: -9 },
  poacher:         { finishing: +10, pace: +1, technique: -1, vision: -5, tackling: -12 },
  target:          { finishing: +8, technique: +1, pace: -8, vision: -2, tackling: -4 },
};

const ATTRIBUTE_KEYS = [
  "finishing", "technique", "vision", "tackling", "pace", "goalkeeping",
] as const;

/**
 * Verschiebt alle Attribute so lange, bis der gewichtete OVR den Zielwert
 * trifft. Nötig ist die Schleife nur wegen der Deckelung bei 1 und 99:
 * Ohne Deckelung wäre eine einzige Verschiebung exakt.
 */
function solveAttributes(target: number, position: Position, arch: string): Attributes {
  const deltas = ARCHETYPES[arch];
  if (!deltas) throw new Error(`Unbekannter Archetyp: ${arch}`);

  const attrs: Attributes = {
    finishing: target + (deltas.finishing ?? 0),
    technique: target + (deltas.technique ?? 0),
    vision: target + (deltas.vision ?? 0),
    tackling: target + (deltas.tackling ?? 0),
    pace: target + (deltas.pace ?? 0),
    goalkeeping: position === "GK" ? target + (deltas.goalkeeping ?? 0) : 14,
  };

  for (let pass = 0; pass < 30; pass++) {
    const current = overall(attrs, position);
    const gap = target - current;
    if (gap === 0) break;

    // Nur Attribute anpassen, die noch Spielraum haben
    const movable = ATTRIBUTE_KEYS.filter((key) => {
      if (position !== "GK" && key === "goalkeeping") return false;
      if (position === "GK" && key === "finishing") return false;
      const value = attrs[key];
      return gap > 0 ? value < 99 : value > 1;
    });
    if (movable.length === 0) break;

    const step = gap > 0 ? 1 : -1;
    for (const key of movable) {
      attrs[key] = Math.max(1, Math.min(99, attrs[key] + step));
      if (overall(attrs, position) === target) break;
    }
  }

  for (const key of ATTRIBUTE_KEYS) attrs[key] = Math.round(attrs[key]);
  return attrs;
}

/** Marktwertkurve, verankert an den Spannen aus GDD §5.2. */
const VALUE_ANCHORS: [number, number][] = [
  [60, 2_000_000], [68, 5_000_000], [77, 22_000_000],
  [78, 25_000_000], [84, 65_000_000], [85, 70_000_000], [94, 150_000_000],
];

function baseValue(ovr: number): number {
  const first = VALUE_ANCHORS[0] as [number, number];
  const last = VALUE_ANCHORS[VALUE_ANCHORS.length - 1] as [number, number];
  if (ovr <= first[0]) return first[1];
  if (ovr >= last[0]) return last[1];
  for (let i = 1; i < VALUE_ANCHORS.length; i++) {
    const [x1, y1] = VALUE_ANCHORS[i - 1] as [number, number];
    const [x2, y2] = VALUE_ANCHORS[i] as [number, number];
    if (ovr <= x2) return y1 + ((ovr - x1) / (x2 - x1)) * (y2 - y1);
  }
  return last[1];
}

/** Junge Spieler tragen Zukunftswert, alte verlieren schnell. */
function ageFactor(age: number): number {
  if (age <= 20) return 1.18;
  if (age <= 23) return 1.10;
  if (age <= 28) return 1.00;
  if (age <= 30) return 0.85;
  if (age <= 32) return 0.62;
  if (age <= 34) return 0.40;
  return 0.24;
}

/** Potenzialrange: je jünger, desto breiter die Wette (GDD §15.1). */
function potentialRange(ovr: number, age: number): [number, number] {
  let min: number, max: number;
  if (age <= 19)      { min = ovr + 1; max = ovr + 14; }
  else if (age <= 21) { min = ovr + 1; max = ovr + 11; }
  else if (age <= 23) { min = ovr;     max = ovr + 8; }
  else if (age <= 25) { min = ovr - 1; max = ovr + 5; }
  else if (age <= 28) { min = ovr - 1; max = ovr + 3; }
  else if (age <= 31) { min = ovr - 4; max = ovr + 1; }
  else                { min = ovr - 8; max = ovr; }
  return [Math.max(40, Math.round(min)), Math.min(96, Math.round(max))];
}

/**
 * Gehalt hängt am Können, nicht am Marktwert.
 *
 * Das ist eine bewusste Abweichung von der ersten Fassung des GDD: Wäre das
 * Gehalt an den alterskorrigierten Marktwert gekoppelt, wäre ein 35-jähriger
 * Weltklassespieler billig zu kaufen UND billig zu halten — ein Sofortkauf ohne
 * Nachteil. So ist er billig zu kaufen und trotzdem teuer zu halten: Man bekommt
 * zwei starke Saisons und danach einen Gehaltsklotz, den niemand abnimmt.
 */
function baseWage(ovr: number): number {
  return Math.round((baseValue(ovr) * 0.004) / 1000) * 1000;
}

function tierOf(ovr: number): "world_class" | "very_good" | "solid" {
  return ovr >= 85 ? "world_class" : ovr >= 78 ? "very_good" : "solid";
}

function externalKey(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ── Aufbau ────────────────────────────────────────────────────────────────

const roster = JSON.parse(readFileSync("data/roster.json", "utf8")) as {
  seasonYear: number; players: RosterEntry[];
};

const built = roster.players.map((entry) => {
  const age = roster.seasonYear - entry.born;
  const attrs = solveAttributes(entry.ovr, entry.pos, entry.arch);
  const computed = overall(attrs, entry.pos);
  const [potMin, potMax] = potentialRange(entry.ovr, age);
  return {
    externalKey: externalKey(entry.name),
    fullName: entry.name,
    birthYear: entry.born,
    age,
    primaryPosition: entry.pos,
    tier: tierOf(entry.ovr),
    overall: computed,
    attributes: attrs,
    potentialMin: potMin,
    potentialMax: potMax,
    traits: entry.traits,
    baseValue: Math.round(baseValue(entry.ovr) * ageFactor(age) / 100_000) * 100_000,
    baseWage: baseWage(entry.ovr),
  };
});

// ── Prüfungen ─────────────────────────────────────────────────────────────

const problems: string[] = [];
for (let i = 0; i < built.length; i++) {
  const player = built[i]!;
  const target = roster.players[i]!.ovr;
  if (player.overall !== target) {
    problems.push(`${player.fullName}: OVR ${player.overall}, Ziel ${target}`);
  }
  if (player.traits.length > 2) problems.push(`${player.fullName}: mehr als 2 Traits`);
}
const keys = new Set(built.map((p) => p.externalKey));
if (keys.size !== built.length) problems.push("Doppelte externalKeys");

if (problems.length > 0) {
  console.error("✗ Der Datensatz ist nicht konsistent:");
  for (const problem of problems) console.error("  - " + problem);
  process.exit(1);
}

writeFileSync("data/players.json", JSON.stringify({
  generatedFrom: "data/roster.json",
  seasonYear: roster.seasonYear,
  count: built.length,
  players: built,
}, null, 2) + "\n");

// ── Bericht ───────────────────────────────────────────────────────────────

const GROUP: Record<Position, string> = {
  GK: "GK", CB: "DEF", LB: "DEF", RB: "DEF",
  DM: "MID", CM: "MID", AM: "MID", LW: "ATT", RW: "ATT", ST: "ATT",
};
const pad = (s: string, n: number) => s.padEnd(n);
const padL = (s: string, n: number) => s.padStart(n);
const mio = (v: number) => `${(v / 1_000_000).toFixed(1)} Mio`;

console.log(`\n✓ data/players.json erzeugt — ${built.length} Spieler, OVR trifft überall den Zielwert\n`);

console.log("STUFEN");
console.log("─".repeat(66));
for (const tier of ["world_class", "very_good", "solid"] as const) {
  const group = built.filter((p) => p.tier === tier);
  const values = group.map((p) => p.baseValue).sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  console.log(
    pad(tier, 14) + padL(String(group.length), 4) + " Spieler" +
    padL(`Wert ${mio(values[0] ?? 0)} – ${mio(values.at(-1) ?? 0)}`, 28) +
    padL(`Summe ${mio(sum)}`, 18),
  );
}
console.log("─".repeat(66));

console.log("\nPOSITIONSGRUPPEN");
console.log("─".repeat(66));
for (const g of ["GK", "DEF", "MID", "ATT"]) {
  const group = built.filter((p) => GROUP[p.primaryPosition] === g);
  const byTier = (t: string) => group.filter((p) => p.tier === t).length;
  console.log(
    pad(g, 6) + padL(String(group.length), 4) + " gesamt" +
    padL(`Weltklasse ${byTier("world_class")}`, 20) +
    padL(`sehr gut ${byTier("very_good")}`, 18) +
    padL(`solide ${byTier("solid")}`, 16),
  );
}
console.log("─".repeat(66));

console.log("\nTRAGFÄHIGKEIT DES POOLS (aktiver Pool = Vereine × 16, GDD §5.2)");
console.log("─".repeat(66));
for (const clubs of [3, 4, 6, 8]) {
  const needed = clubs * 16;
  const stars = Math.round(clubs * 1.5);
  const gkNeeded = clubs * 2;
  const ok = needed <= built.length && gkNeeded <= built.filter((p) => p.primaryPosition === "GK").length;
  console.log(
    pad(`${ok ? "✓" : "✗"} ${clubs} Vereine`, 14) +
    padL(`${needed} Spieler nötig`, 20) +
    padL(`${stars} Weltklasse im Pool`, 26) +
    padL(`${gkNeeded} Torhüter`, 16),
  );
}
console.log("─".repeat(66));

console.log("\nALTERSSCHNÄPPCHEN — billig zu kaufen, teuer zu halten");
console.log("─".repeat(66));
const bargains = built
  .filter((p) => p.overall >= 80)
  .map((p) => ({ ...p, ratio: p.baseWage * 21 / p.baseValue }))
  .sort((a, b) => b.ratio - a.ratio)
  .slice(0, 5);
for (const p of bargains) {
  console.log(
    pad(p.fullName, 24) + padL(`${p.overall} OVR`, 9) + padL(`${p.age} J.`, 8) +
    padL(`Ablöse ${mio(p.baseValue)}`, 20) +
    padL(`Gehalt/Saison ${mio(p.baseWage * 21)}`, 26),
  );
}
console.log("─".repeat(66));
console.log("Ein Jahresgehalt über der Ablöse heißt: Der Spieler kostet mehr, als er wert ist.");

const avgSquad = built.slice().sort((a, b) => b.overall - a.overall);
const topSixteen = avgSquad.slice(0, 16).reduce((s, p) => s + p.baseValue, 0);
console.log(`\nTeuerste 16 Spieler zusammen: ${mio(topSixteen)}`);
console.log(`Startbudget laut GDD §2.3:    400,0 Mio`);
console.log(`→ Niemand kann sich den Traumkader leisten. Genau so soll es sein.\n`);
