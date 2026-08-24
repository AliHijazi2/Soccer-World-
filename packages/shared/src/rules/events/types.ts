/**
 * Ereignissystem (GDD §10).
 *
 * Grundprinzip: Ein Ereignis ohne Entscheidung ist eine Push-Nachricht. Ein
 * Ereignis mit zwei schlechten Optionen ist Gameplay. Mindestens 70 % aller
 * Ereignisse bieten deshalb echte Trade-offs, und **kein Ereignis darf eine
 * offensichtlich beste Antwort haben.**
 */

import type { Trait } from "../../types/match.ts";

export type EventCategory =
  | "squad" | "economy" | "fans" | "stadium" | "market" | "tabloid";

/** Wen ein Ereignis betrifft, falls es einen konkreten Spieler braucht. */
export type SubjectSelector =
  | "best" | "worst" | "oldest" | "youngest" | "random" | "highest_paid" | null;

/**
 * Effekte sind deklarativ, nicht als Code hinterlegt.
 *
 * Das erlaubt es, jedes Ereignis zu prüfen, ohne es auszuführen — etwa gegen
 * die Regel aus §10.7, dass kein Ereignis mehr als 8 % des Vereinsvermögens
 * auf einen Schlag vernichten darf.
 */
export type Effect =
  /** Fester Betrag oder Anteil am Kassenbestand */
  | { kind: "cash"; amount?: number; shareOfCash?: number }
  | { kind: "mood"; delta: number }
  | { kind: "fans"; sharePercent: number }
  | { kind: "morale"; target: "subject" | "squad"; delta: number }
  | { kind: "fitness"; target: "subject" | "squad"; delta: number }
  | { kind: "wage"; target: "subject"; factor: number }
  | { kind: "injury"; target: "subject"; matchdays: number }
  | { kind: "trait"; target: "subject"; trait: Trait }
  | { kind: "stadiumCondition"; delta: number }
  | { kind: "marketValue"; target: "subject"; factor: number }
  /** Verzweigung — die Grundlage jeder Verhandlungsoption */
  | { kind: "chance"; probability: number; then: Effect[]; otherwise: Effect[] };

export interface EventOption {
  key: string;
  effects: Effect[];
}

export interface EventContext {
  /** Tabellenplatz, 1-basiert */
  rank: number;
  clubCount: number;
  cash: number;
  fanMood: number;
  stadiumCondition: number;
  winStreak: number;
  lossStreak: number;
  /** Punkte je Spiel minus Erwartung */
  expectationDelta: number;
  squadSize: number;
  injuredPlayers: number;
  matchday: number;
}

export interface EventDefinition {
  key: string;
  category: EventCategory;
  subject: SubjectSelector;
  /** Grundgewicht in der Auswahl */
  weight: number;
  /** Sperrfrist in Spieltagen (GDD §10.7) */
  cooldownMatchdays: number;
  /** Optionen; ein leeres Array bedeutet: reine Meldung ohne Entscheidung */
  options: EventOption[];
  /** Welche Option greift, wenn der Spieler nicht reagiert */
  defaultOption: number;
  /** Muss erfüllt sein, damit das Ereignis überhaupt auftreten kann */
  precondition?: (context: EventContext) => boolean;
  /**
   * Situationsabhängiges Gewicht (GDD §10.5).
   * Getarntes Rubberbanding: Der Führende zieht mehr Forderungen und
   * Abwerbeversuche an, der Letzte mehr Gelegenheiten. Das trifft nie das
   * Spielergebnis, nur das Umfeld.
   */
  situationalWeight?: (context: EventContext) => number;
}

export function hasDecision(definition: EventDefinition): boolean {
  return definition.options.length >= 2;
}

/** Größter möglicher Geldverlust eines Ereignisses, für die Prüfung nach §10.7. */
export function worstCashLoss(effects: readonly Effect[], cash: number): number {
  let worst = 0;
  for (const effect of effects) {
    if (effect.kind === "cash") {
      const amount = effect.amount ?? (effect.shareOfCash ?? 0) * cash;
      if (amount < 0) worst += amount;
    } else if (effect.kind === "chance") {
      worst += Math.min(
        worstCashLoss(effect.then, cash), worstCashLoss(effect.otherwise, cash));
    }
  }
  return worst;
}
