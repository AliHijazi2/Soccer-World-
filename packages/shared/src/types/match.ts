/** Domänentypen für die Spielsimulation. Bewusst frei von Datenbankdetails. */

export type Position =
  | "GK" | "CB" | "LB" | "RB" | "DM" | "CM" | "AM" | "LW" | "RW" | "ST";

export const POSITIONS: readonly Position[] = [
  "GK", "CB", "LB", "RB", "DM", "CM", "AM", "LW", "RW", "ST",
];

export interface Attributes {
  finishing: number;
  technique: number;
  vision: number;
  tackling: number;
  pace: number;
  goalkeeping: number;
}

export type Trait =
  | "ego" | "leader" | "injury_prone" | "big_game" | "fan_favourite"
  | "late_bloomer" | "mercenary" | "hothead" | "iron_man";

/** Ein Spieler, wie ihn die Simulation braucht — nicht die volle Spielerinstanz. */
export interface MatchPlayer {
  id: string;
  name: string;
  /** Position, auf der er in dieser Partie aufgestellt ist */
  position: Position;
  /** Natürliche Position — Abweichung kostet Leistung (GDD §7.2) */
  naturalPosition: Position;
  attrs: Attributes;
  /** 0..100 */
  form: number;
  /** 0..100 */
  fitness: number;
  /** 0..100 */
  morale: number;
  traits: readonly Trait[];
}

export interface Tactics {
  /** 0 kontrolliert … 100 direkt */
  tempo: number;
  /** 0 tief … 100 hoch */
  pressing: number;
  /** 0 defensiv … 100 offensiv */
  risk: number;
  focus: "left" | "central" | "right";
}

export const DEFAULT_TACTICS: Tactics = {
  tempo: 50, pressing: 50, risk: 50, focus: "central",
};

export interface MatchSquad {
  clubId: string;
  clubName: string;
  /** Genau 11 */
  starters: readonly MatchPlayer[];
  bench: readonly MatchPlayer[];
  tactics: Tactics;
  /** Kabinenklima 0..100 (GDD §7.4) */
  chemistry: number;
}

export interface MatchContext {
  /**
   * Heimvorteil 0..1, abgeleitet aus Auslastung × Fanstimmung.
   * 0 = feindseliges Publikum, 1 = ausverkauft und euphorisch (GDD §11.4).
   */
  homeSupport: number;
  isDerby: boolean;
}

export type TickerEventType =
  | "kickoff" | "goal" | "big_chance" | "shot_saved" | "shot_off"
  | "yellow_card" | "red_card" | "injury" | "substitution"
  | "halftime" | "fulltime" | "woodwork" | "penalty_scored" | "penalty_missed";

export interface TickerEvent {
  minute: number;
  sequence: number;
  type: TickerEventType;
  clubId?: string;
  playerId?: string;
  playerName?: string;
  secondaryPlayerId?: string;
  secondaryPlayerName?: string;
  /** Template-Schlüssel — der Satz entsteht erst beim Rendern (Architektur §11) */
  textKey: string;
  payload?: Record<string, string | number>;
}

export interface TeamMatchStats {
  possession: number;
  shots: number;
  shotsOnTarget: number;
  bigChances: number;
  expectedGoals: number;
  goals: number;
  yellowCards: number;
  redCards: number;
}

export interface PlayerRating {
  playerId: string;
  rating: number;
  goals: number;
  assists: number;
  minutesPlayed: number;
}

export interface MatchResult {
  homeGoals: number;
  awayGoals: number;
  events: readonly TickerEvent[];
  home: TeamMatchStats;
  away: TeamMatchStats;
  ratings: readonly PlayerRating[];
  /** Spieler, die sich verletzt haben, mit Ausfalldauer in Spieltagen */
  injuries: readonly { playerId: string; matchdays: number }[];
  /** Spieler mit Rot — Sperre in Spieltagen */
  suspensions: readonly { playerId: string; matchdays: number }[];
}
