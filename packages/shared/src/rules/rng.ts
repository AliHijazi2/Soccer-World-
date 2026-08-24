/**
 * Deterministischer Zufallszahlengenerator.
 *
 * Math.random() ist bewusst nirgends im Regelwerk erlaubt: Die Simulation muss
 * aus einem gespeicherten Seed exakt reproduzierbar sein (Architektur §7).
 * mulberry32 ist klein, schnell und auf allen Plattformen bitgleich.
 */

export interface Rng {
  /** Gleichverteilt in [0, 1) */
  next(): number;
  /** Ganzzahl in [min, max] */
  int(min: number, max: number): number;
  /** true mit Wahrscheinlichkeit p */
  chance(p: number): boolean;
  /** Zufälliges Element */
  pick<T>(items: readonly T[]): T;
  /** Gewichtete Auswahl; Gewichte müssen > 0 sein */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T;
  /** Normalverteilt (Box-Muller), auf [min, max] begrenzt */
  gaussian(mean: number, stdDev: number, min?: number, max?: number): number;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number =>
    min + Math.floor(next() * (max - min + 1));

  const pick = <T,>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error("pick() auf leerer Liste");
    return items[int(0, items.length - 1)] as T;
  };

  const weighted = <T,>(items: readonly T[], weight: (item: T) => number): T => {
    if (items.length === 0) throw new Error("weighted() auf leerer Liste");
    let total = 0;
    for (const item of items) total += Math.max(0, weight(item));
    if (total <= 0) return pick(items);
    let roll = next() * total;
    for (const item of items) {
      roll -= Math.max(0, weight(item));
      if (roll <= 0) return item;
    }
    return items[items.length - 1] as T;
  };

  const gaussian = (mean: number, stdDev: number, min?: number, max?: number): number => {
    const u = Math.max(next(), Number.EPSILON);
    const v = next();
    const value = mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    if (min !== undefined && value < min) return min;
    if (max !== undefined && value > max) return max;
    return value;
  };

  return { next, int, chance: (p) => next() < p, pick, weighted, gaussian };
}

/**
 * Stabiler 32-Bit-Hash für Seed-Ableitungen.
 * Erzeugt aus Liga, Saison, Spieltag und Vereinen einen reproduzierbaren Seed.
 */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const str = String(part);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0x9e3779b9;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
