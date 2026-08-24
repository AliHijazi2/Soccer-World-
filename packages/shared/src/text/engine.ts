/**
 * Textbausteine (GDD F20, Architektur §11).
 *
 * Gespeichert wird nur ein Schlüssel plus Nutzlast, der Satz entsteht erst beim
 * Anzeigen. Das erlaubt es, Formulierungen nach dem Playtest zu schärfen, ohne
 * die Historie zu verfälschen — und macht eine zweite Sprache zu einer Datei
 * statt zu einem Projekt.
 *
 * Die Auswahl unter den Varianten läuft über denselben deterministischen PRNG
 * wie die Simulation. Derselbe Spieltag liest sich damit immer gleich.
 */

import { createRng, hashSeed } from "../rules/rng.ts";

export type TemplateSet = Record<string, readonly string[]>;
export type WordLists = Record<string, readonly string[]>;

export type PlaceholderValue = string | number | null | undefined;
export type Payload = Record<string, PlaceholderValue>;

/** Geldbetrag in der Schreibweise, die im Spiel überall gilt. */
export function formatMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const mio = value / 1_000_000;
    const digits = Math.abs(mio) >= 100 ? 0 : 1;
    return `${mio.toFixed(digits).replace(".", ",")} Mio`;
  }
  if (abs >= 1000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
}

export function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("de-DE");
}

/**
 * Ordnungszahlen als Substantiv: "Zweiter", nicht "2er".
 * Ohne die entstehen Sätze wie "Tabellen2er" — im Boulevard-Ton besonders
 * peinlich, weil er von Sprache lebt.
 */
const ORDINALS = [
  "Nullter", "Erster", "Zweiter", "Dritter", "Vierter", "Fünfter",
  "Sechster", "Siebter", "Achter", "Neunter", "Zehnter",
];

export function formatOrdinal(value: number): string {
  const index = Math.round(value);
  return ORDINALS[index] ?? `${index}.`;
}

const FORMATTERS: Record<string, (value: number) => string> = {
  money: formatMoney,
  number: formatNumber,
  percent: (value) => `${Math.round(value)} %`,
  signed: (value) => (value > 0 ? "+" : "") + Math.round(value),
  minute: (value) => `${Math.round(value)}.`,
  one: (value) => value.toFixed(1).replace(".", ","),
  ordinal: formatOrdinal,
};

export interface RenderOptions {
  templates: TemplateSet;
  words?: WordLists;
  /** Bestimmt die Variantenauswahl — gleicher Seed, gleicher Text */
  seed?: number;
}

const PLACEHOLDER = /\{([~#]?)([a-zA-Z0-9_]+)(?::([a-z]+))?\}/g;

/**
 * Setzt einen Satz aus Schlüssel und Nutzlast zusammen.
 *
 * `{name}` füllt aus der Nutzlast, `{fee:money}` zusätzlich formatiert,
 * `{~panic}` zieht ein Wort aus einer Liste, `{#foo}` ist optional und
 * verschwindet mitsamt umgebendem Leerzeichen, wenn nichts da ist.
 */
export function render(key: string, payload: Payload, options: RenderOptions): string {
  const variants = options.templates[key];
  if (!variants || variants.length === 0) {
    // Ein fehlender Schlüssel darf nie eine leere Zeile erzeugen — sonst sucht
    // man den Fehler in der Datenbank statt in der Textdatei
    return `[${key}]`;
  }

  const seed = options.seed ?? hashSeed(key, JSON.stringify(payload));
  const rng = createRng(seed);
  const template = variants[rng.int(0, variants.length - 1)]!;

  return template.replace(PLACEHOLDER, (match, kind: string, name: string, format?: string) => {
    if (kind === "~") {
      const list = options.words?.[name];
      if (!list || list.length === 0) return match;
      return list[rng.int(0, list.length - 1)]!;
    }

    const value = payload[name];
    if (value === null || value === undefined) return kind === "#" ? "" : match;
    if (typeof value === "number" && format) {
      const formatter = FORMATTERS[format];
      return formatter ? formatter(value) : String(value);
    }
    return String(value);
  }).replace(/\s{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
}

/** Prüft, dass jeder Platzhalter in jeder Variante bedient werden kann. */
export function validateTemplates(
  templates: TemplateSet, words: WordLists, known: Record<string, readonly string[]>,
): string[] {
  const problems: string[] = [];
  for (const [key, variants] of Object.entries(templates)) {
    if (variants.length === 0) {
      problems.push(`${key}: keine Varianten`);
      continue;
    }
    const allowed = known[key];
    for (const [index, template] of variants.entries()) {
      for (const match of template.matchAll(PLACEHOLDER)) {
        const kind = match[1], name = match[2]!;
        if (kind === "~") {
          if (!words[name]) problems.push(`${key}[${index}]: Wortliste "${name}" fehlt`);
        } else if (allowed && !allowed.includes(name)) {
          problems.push(`${key}[${index}]: Platzhalter "${name}" ist nicht vorgesehen`);
        }
      }
    }
  }
  return problems;
}
