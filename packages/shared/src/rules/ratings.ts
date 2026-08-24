/**
 * Ableitung von Spieler- und Mannschaftsstärke.
 *
 * Alle Funktionen hier sind rein: gleiche Eingabe, gleiches Ergebnis, keine I/O.
 * Sie werden sowohl von der Simulation als auch vom Marktwertmodell benutzt.
 */

import type {
  Attributes, MatchPlayer, MatchSquad, Position,
} from "../types/match.ts";

/** Gewichte für den Gesamtwert (OVR) je Position. Summe jeweils 1. */
const OVR_WEIGHTS: Record<Position, Attributes> = {
  GK: { goalkeeping: 0.80, tackling: 0.05, vision: 0.09, technique: 0.05, pace: 0.01, finishing: 0.00 },
  CB: { tackling: 0.45, pace: 0.20, vision: 0.15, technique: 0.15, finishing: 0.05, goalkeeping: 0.00 },
  LB: { tackling: 0.32, pace: 0.30, technique: 0.20, vision: 0.13, finishing: 0.05, goalkeeping: 0.00 },
  RB: { tackling: 0.32, pace: 0.30, technique: 0.20, vision: 0.13, finishing: 0.05, goalkeeping: 0.00 },
  DM: { tackling: 0.35, vision: 0.28, technique: 0.22, pace: 0.10, finishing: 0.05, goalkeeping: 0.00 },
  CM: { vision: 0.32, technique: 0.28, tackling: 0.18, pace: 0.12, finishing: 0.10, goalkeeping: 0.00 },
  AM: { vision: 0.30, technique: 0.30, finishing: 0.20, pace: 0.12, tackling: 0.08, goalkeeping: 0.00 },
  LW: { pace: 0.30, technique: 0.28, finishing: 0.22, vision: 0.15, tackling: 0.05, goalkeeping: 0.00 },
  RW: { pace: 0.30, technique: 0.28, finishing: 0.22, vision: 0.15, tackling: 0.05, goalkeeping: 0.00 },
  ST: { finishing: 0.42, technique: 0.22, pace: 0.20, vision: 0.11, tackling: 0.05, goalkeeping: 0.00 },
};

/** Zonen für die Mannschaftsbewertung: wie stark zählt eine Position wo mit. */
const ZONE_WEIGHTS: Record<Position, { def: number; mid: number; att: number }> = {
  GK: { def: 0.00, mid: 0.00, att: 0.00 },
  CB: { def: 1.00, mid: 0.15, att: 0.00 },
  LB: { def: 0.85, mid: 0.35, att: 0.10 },
  RB: { def: 0.85, mid: 0.35, att: 0.10 },
  DM: { def: 0.50, mid: 0.90, att: 0.10 },
  CM: { def: 0.25, mid: 1.00, att: 0.30 },
  AM: { def: 0.10, mid: 0.80, att: 0.60 },
  LW: { def: 0.10, mid: 0.40, att: 0.85 },
  RW: { def: 0.10, mid: 0.40, att: 0.85 },
  ST: { def: 0.05, mid: 0.20, att: 1.00 },
};

/** Gruppen für die Entfernung zwischen zwei Positionen. */
const POSITION_GROUP: Record<Position, number> = {
  GK: 0, CB: 1, LB: 1, RB: 1, DM: 2, CM: 2, AM: 2, LW: 3, RW: 3, ST: 3,
};

/** Abzug bei Einsatz außerhalb der natürlichen Position (GDD §7.2: −10 bis −25). */
export function positionPenalty(natural: Position, played: Position): number {
  if (natural === played) return 0;
  const isKeeper = natural === "GK" || played === "GK";
  if (isKeeper) return 25;
  const distance = Math.abs(POSITION_GROUP[natural] - POSITION_GROUP[played]);
  if (distance === 0) return 4;      // z. B. LB auf RB
  if (distance === 1) return 10;
  if (distance === 2) return 18;
  return 25;
}

/**
 * Wirksame Attribute eines Spielers in einer konkreten Partie.
 * Berücksichtigt Positionsabzug, Form, Fitness und Moral.
 */
export function effectiveAttributes(player: MatchPlayer): Attributes {
  const penalty = positionPenalty(player.naturalPosition, player.position);

  // Form: ±6 um den Mittelwert 50 (GDD §8.3)
  const formShift = ((player.form - 50) / 50) * 6;

  // Fitness wirkt erst unterhalb von 70, dann linear bis −18 bei 0
  const fitnessShift = player.fitness >= 70
    ? 0
    : -((70 - player.fitness) / 70) * 18;

  // Moral ist der schwächste der drei Faktoren
  const moraleShift = ((player.morale - 50) / 50) * 3;

  const shift = formShift + fitnessShift + moraleShift - penalty;
  const apply = (value: number): number => clamp(value + shift, 1, 99);

  return {
    finishing: apply(player.attrs.finishing),
    technique: apply(player.attrs.technique),
    vision: apply(player.attrs.vision),
    tackling: apply(player.attrs.tackling),
    pace: apply(player.attrs.pace),
    goalkeeping: apply(player.attrs.goalkeeping),
  };
}

/** Gesamtwert eines Spielers auf einer Position, ohne Tagesform. */
export function overall(attrs: Attributes, position: Position): number {
  const w = OVR_WEIGHTS[position];
  const value =
    attrs.finishing * w.finishing +
    attrs.technique * w.technique +
    attrs.vision * w.vision +
    attrs.tackling * w.tackling +
    attrs.pace * w.pace +
    attrs.goalkeeping * w.goalkeeping;
  return Math.round(value);
}

export interface TeamRatings {
  /** Verteidigung ohne Torwart */
  defence: number;
  /** Ballbesitz und Aufbau */
  midfield: number;
  /** Chancenerzeugung und Abschluss */
  attack: number;
  /** Torwartqualität */
  keeper: number;
  /** Gewichteter Gesamtwert — nur für Anzeige und Erwartungswerte */
  overall: number;
}

/**
 * Mannschaftsstärke aus der Startelf.
 *
 * Wichtig: Die Zonenwerte sind gewichtete Mittel, keine Summen. Der elfte Star
 * bringt dadurch kaum noch etwas — der abnehmende Grenznutzen aus GDD §19.2
 * steckt genau hier und nicht in einer nachträglichen Deckelung.
 */
export function teamRatings(squad: MatchSquad): TeamRatings {
  const keeperPlayer = squad.starters.find((p) => p.position === "GK");
  const keeperAttrs = keeperPlayer ? effectiveAttributes(keeperPlayer) : null;
  // Kein Torwart aufgestellt: ein Feldspieler muss ins Tor, das kostet massiv
  const keeper = keeperAttrs ? keeperAttrs.goalkeeping : 25;

  let defSum = 0, defWeight = 0;
  let midSum = 0, midWeight = 0;
  let attSum = 0, attWeight = 0;

  for (const player of squad.starters) {
    if (player.position === "GK") continue;
    const a = effectiveAttributes(player);
    const z = ZONE_WEIGHTS[player.position];

    defSum += (a.tackling * 0.55 + a.pace * 0.25 + a.vision * 0.20) * z.def;
    defWeight += z.def;
    midSum += (a.vision * 0.45 + a.technique * 0.35 + a.tackling * 0.20) * z.mid;
    midWeight += z.mid;
    attSum += (a.finishing * 0.45 + a.technique * 0.30 + a.pace * 0.25) * z.att;
    attWeight += z.att;
  }

  // Eine unbesetzte Zone ist eine echte Schwäche, kein neutraler Wert
  const defence = defWeight > 0.3 ? defSum / defWeight : 35;
  const midfield = midWeight > 0.3 ? midSum / midWeight : 35;
  const attack = attWeight > 0.3 ? attSum / attWeight : 35;

  // Kabinenklima: ±5 Teamstärke (GDD §8.3)
  const chemistryShift = ((squad.chemistry - 50) / 50) * 5;

  return {
    defence: clamp(defence + chemistryShift, 1, 99),
    midfield: clamp(midfield + chemistryShift, 1, 99),
    attack: clamp(attack + chemistryShift, 1, 99),
    keeper: clamp(keeper + chemistryShift, 1, 99),
    overall: clamp(
      (defence * 0.30 + midfield * 0.30 + attack * 0.28 + keeper * 0.12) + chemistryShift,
      1, 99,
    ),
  };
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
