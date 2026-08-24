/**
 * Ballbesitz-Ketten-Simulation einer Partie (GDD §8).
 *
 * Reine Funktion: gleiche Eingabe plus gleicher Seed ergibt immer exakt dasselbe
 * Ergebnis, denselben Ticker und dieselben Noten. Kein Math.random, kein Date,
 * kein Datenbankzugriff (Architektur §7).
 */

import { createRng, type Rng } from "../rng.ts";
import { clamp, effectiveAttributes, teamRatings, type TeamRatings } from "../ratings.ts";
import type {
  MatchContext, MatchPlayer, MatchResult, MatchSquad,
  PlayerRating, Position, TeamMatchStats, TickerEvent,
} from "../../types/match.ts";

/**
 * Stellschrauben der Simulation.
 *
 * Diese Werte sind gegen die Zielkurve aus GDD §8.2 kalibriert. Wer hier etwas
 * ändert, muss `npm run balance` laufen lassen und die Kurve erneut prüfen.
 */
export const TUNING = {
  /** Minuten pro Partie */
  MINUTES: 90,
  /** Wie stark sich Stärkeunterschiede auf Ballbesitz auswirken */
  POSSESSION_EXPONENT: 2.0,
  /** Wie stark sich Stärkeunterschiede auf Chancen und Abschluss auswirken */
  STRENGTH_EXPONENT: 1.65,
  /** Chancenwahrscheinlichkeit pro Ballbesitzminute bei Gleichstand × 2 */
  CHANCE_BASE: 0.276,
  /** Torwahrscheinlichkeit je Chance bei Gleichstand × 2 */
  XG_BASE: 0.475,
  /** Maximaler Heimvorteil in Punkten Teamstärke bei ausverkauft und euphorisch */
  HOME_ADVANTAGE_MAX: 7,
  /** Zusätzliche Zufallsstreuung der Tagesform pro Team und Partie */
  TEAM_NOISE_STDDEV: 3.5,
  /** Streuung im Derby zusätzlich (GDD §8.3) */
  DERBY_NOISE_STDDEV: 3.0,
  /** Gelbe Karten pro Partie und Team (Erwartungswert) */
  YELLOW_RATE: 1.7,
  /** Rote Karten pro Partie und Team (Erwartungswert) */
  RED_RATE: 0.06,
  /** Verletzungen pro Partie und Team (Erwartungswert) */
  INJURY_RATE: 0.20,
  /** Anteil der Tore, zu denen es eine Vorlage gibt */
  ASSIST_SHARE: 0.68,
  /** Anteil der Chancen, die als Großchance im Ticker auftauchen */
  BIG_CHANCE_THRESHOLD: 0.30,
} as const;

/** a^p / (a^p + b^p) — der zentrale Stärkevergleich. */
function ratio(a: number, b: number, exponent: number): number {
  const pa = Math.pow(Math.max(a, 1), exponent);
  const pb = Math.pow(Math.max(b, 1), exponent);
  return pa / (pa + pb);
}

interface TeamState {
  squad: MatchSquad;
  ratings: TeamRatings;
  onPitch: MatchPlayer[];
  bench: MatchPlayer[];
  stats: TeamMatchStats;
  goalsByPlayer: Map<string, number>;
  assistsByPlayer: Map<string, number>;
  ratingAdjust: Map<string, number>;
  substitutionsLeft: number;
  sentOff: Set<string>;
}

function emptyStats(): TeamMatchStats {
  return {
    possession: 0, shots: 0, shotsOnTarget: 0, bigChances: 0,
    expectedGoals: 0, goals: 0, yellowCards: 0, redCards: 0,
  };
}

function createTeamState(squad: MatchSquad, noise: number): TeamState {
  const base = teamRatings(squad);
  return {
    squad,
    ratings: {
      defence: clamp(base.defence + noise, 1, 99),
      midfield: clamp(base.midfield + noise, 1, 99),
      attack: clamp(base.attack + noise, 1, 99),
      keeper: clamp(base.keeper + noise, 1, 99),
      overall: clamp(base.overall + noise, 1, 99),
    },
    onPitch: [...squad.starters],
    bench: [...squad.bench],
    stats: emptyStats(),
    goalsByPlayer: new Map(),
    assistsByPlayer: new Map(),
    ratingAdjust: new Map(),
    substitutionsLeft: 5,
    sentOff: new Set(),
  };
}

/** Taktikeinfluss: Risiko erhöht Chancen und erlaubt gleichzeitig mehr Gegenchancen. */
function riskFactors(squad: MatchSquad): { attack: number; concede: number } {
  const risk = (squad.tactics.risk - 50) / 50;   // −1 … +1
  return { attack: 1 + risk * 0.18, concede: 1 + risk * 0.14 };
}

/** Pressing verschiebt den Ballbesitz, kostet aber Absicherung. */
function pressingShift(squad: MatchSquad): { midfield: number; defence: number } {
  const pressing = (squad.tactics.pressing - 50) / 50;
  return { midfield: pressing * 3.5, defence: -pressing * 2.5 };
}

function pickScorer(team: TeamState, rng: Rng): MatchPlayer {
  const candidates = team.onPitch.filter((p) => p.position !== "GK");
  if (candidates.length === 0) return team.onPitch[0] as MatchPlayer;
  return rng.weighted(candidates, (p) => {
    const a = effectiveAttributes(p);
    const zone = ATTACK_SHARE[p.position];
    return Math.max(0.01, a.finishing * zone);
  });
}

function pickAssister(team: TeamState, scorerId: string, rng: Rng): MatchPlayer | null {
  const candidates = team.onPitch.filter(
    (p) => p.id !== scorerId && p.position !== "GK",
  );
  if (candidates.length === 0) return null;
  return rng.weighted(candidates, (p) => {
    const a = effectiveAttributes(p);
    return Math.max(0.01, a.vision * 0.6 + a.technique * 0.4);
  });
}

/** Wie stark eine Position an Torabschlüssen beteiligt ist. */
const ATTACK_SHARE: Record<Position, number> = {
  GK: 0.00, CB: 0.06, LB: 0.05, RB: 0.05, DM: 0.08,
  CM: 0.16, AM: 0.28, LW: 0.36, RW: 0.36, ST: 1.00,
};

export function simulateMatch(
  home: MatchSquad,
  away: MatchSquad,
  context: MatchContext,
  seed: number,
): MatchResult {
  const rng = createRng(seed);

  // Tagesform der Mannschaft: einmal pro Partie gezogen, für beide Teams getrennt.
  // Das ist die Streuung, die aus einer klaren Papierform ein echtes Fußballspiel macht.
  const noiseStdDev = TUNING.TEAM_NOISE_STDDEV +
    (context.isDerby ? TUNING.DERBY_NOISE_STDDEV : 0);
  const homeNoise = rng.gaussian(0, noiseStdDev);
  const awayNoise = rng.gaussian(0, noiseStdDev);

  const h = createTeamState(home, homeNoise);
  const a = createTeamState(away, awayNoise);

  // Heimvorteil skaliert mit Auslastung × Stimmung. Bei feindseligem Publikum
  // ist er null — nicht negativ (GDD §11.4).
  const homeBonus = TUNING.HOME_ADVANTAGE_MAX * clamp(context.homeSupport, 0, 1);
  h.ratings = {
    defence: clamp(h.ratings.defence + homeBonus, 1, 99),
    midfield: clamp(h.ratings.midfield + homeBonus, 1, 99),
    attack: clamp(h.ratings.attack + homeBonus, 1, 99),
    keeper: clamp(h.ratings.keeper + homeBonus * 0.5, 1, 99),
    overall: clamp(h.ratings.overall + homeBonus, 1, 99),
  };

  const hPress = pressingShift(home);
  const aPress = pressingShift(away);
  const hRisk = riskFactors(home);
  const aRisk = riskFactors(away);

  const hMid = h.ratings.midfield + hPress.midfield;
  const aMid = a.ratings.midfield + aPress.midfield;
  const hDef = h.ratings.defence + hPress.defence;
  const aDef = a.ratings.defence + aPress.defence;

  const homePossessionShare = ratio(hMid, aMid, TUNING.POSSESSION_EXPONENT);

  const events: TickerEvent[] = [];
  let sequence = 0;
  const push = (event: Omit<TickerEvent, "sequence">): void => {
    events.push({ ...event, sequence: sequence++ });
  };

  push({ minute: 0, type: "kickoff", textKey: "match.kickoff" });

  const injuries: { playerId: string; matchdays: number }[] = [];
  const suspensions: { playerId: string; matchdays: number }[] = [];

  for (let minute = 1; minute <= TUNING.MINUTES; minute++) {
    if (minute === 46) {
      push({
        minute: 45, type: "halftime", textKey: "match.halftime",
        payload: { home: h.stats.goals, away: a.stats.goals },
      });
    }

    const homeHasBall = rng.chance(homePossessionShare);
    const attacker = homeHasBall ? h : a;
    const defender = homeHasBall ? a : h;
    const attackRisk = homeHasBall ? hRisk : aRisk;
    const defendRisk = homeHasBall ? aRisk : hRisk;
    const attackRating = attacker.ratings.attack;
    const defenceRating = homeHasBall ? aDef : hDef;

    if (homeHasBall) h.stats.possession++; else a.stats.possession++;

    // Unterzahl senkt die Angriffskraft und erhöht die des Gegners spürbar
    const numbers = attacker.onPitch.length / Math.max(defender.onPitch.length, 1);

    const chanceProbability =
      TUNING.CHANCE_BASE *
      ratio(attackRating, defenceRating, TUNING.STRENGTH_EXPONENT) *
      attackRisk.attack * defendRisk.concede * numbers;

    if (rng.chance(chanceProbability)) {
      resolveChance(attacker, defender, minute, rng, push, homeHasBall ? home : away);
    }

    // Karten und Verletzungen betreffen beide Mannschaften, unabhängig vom Ballbesitz
    resolveDiscipline(h, minute, rng, push, context, suspensions);
    resolveDiscipline(a, minute, rng, push, context, suspensions);
    resolveInjury(h, minute, rng, push, injuries);
    resolveInjury(a, minute, rng, push, injuries);
  }

  push({
    minute: 90, type: "fulltime", textKey: "match.fulltime",
    payload: { home: h.stats.goals, away: a.stats.goals },
  });

  const totalPossession = h.stats.possession + a.stats.possession || 1;
  h.stats.possession = Math.round((h.stats.possession / totalPossession) * 100);
  a.stats.possession = 100 - h.stats.possession;

  return {
    homeGoals: h.stats.goals,
    awayGoals: a.stats.goals,
    events,
    home: h.stats,
    away: a.stats,
    ratings: [...buildRatings(h, a.stats.goals), ...buildRatings(a, h.stats.goals)],
    injuries,
    suspensions,
  };
}

function resolveChance(
  attacker: TeamState,
  defender: TeamState,
  minute: number,
  rng: Rng,
  push: (event: Omit<TickerEvent, "sequence">) => void,
  squad: MatchSquad,
): void {
  const shooter = pickScorer(attacker, rng);
  const shooterAttrs = effectiveAttributes(shooter);

  const xg = clamp(
    TUNING.XG_BASE *
      ratio(shooterAttrs.finishing, defender.ratings.keeper, TUNING.STRENGTH_EXPONENT) *
      rng.gaussian(1, 0.35, 0.25, 2.2),
    0.02, 0.92,
  );

  attacker.stats.shots++;
  attacker.stats.expectedGoals += xg;
  const isBigChance = xg >= TUNING.BIG_CHANCE_THRESHOLD;
  if (isBigChance) attacker.stats.bigChances++;

  if (rng.chance(xg)) {
    attacker.stats.goals++;
    attacker.stats.shotsOnTarget++;
    attacker.goalsByPlayer.set(shooter.id, (attacker.goalsByPlayer.get(shooter.id) ?? 0) + 1);

    const assister = rng.chance(TUNING.ASSIST_SHARE)
      ? pickAssister(attacker, shooter.id, rng)
      : null;
    if (assister) {
      attacker.assistsByPlayer.set(
        assister.id, (attacker.assistsByPlayer.get(assister.id) ?? 0) + 1,
      );
    }

    push({
      minute, type: "goal", clubId: squad.clubId,
      playerId: shooter.id, playerName: shooter.name,
      secondaryPlayerId: assister?.id, secondaryPlayerName: assister?.name,
      textKey: assister ? "goal.assisted" : "goal.solo",
      payload: { xg: Math.round(xg * 100) / 100 },
    });
    return;
  }

  // Kein Tor: gehalten, vorbei oder Aluminium
  const roll = rng.next();
  if (roll < 0.42) {
    attacker.stats.shotsOnTarget++;
    const keeper = defender.onPitch.find((p) => p.position === "GK");
    push({
      minute, type: "shot_saved", clubId: squad.clubId,
      playerId: shooter.id, playerName: shooter.name,
      secondaryPlayerId: keeper?.id, secondaryPlayerName: keeper?.name,
      textKey: isBigChance ? "chance.big_saved" : "chance.saved",
    });
  } else if (roll < 0.48) {
    push({
      minute, type: "woodwork", clubId: squad.clubId,
      playerId: shooter.id, playerName: shooter.name,
      textKey: "chance.woodwork",
    });
  } else if (isBigChance) {
    push({
      minute, type: "big_chance", clubId: squad.clubId,
      playerId: shooter.id, playerName: shooter.name,
      textKey: "chance.big_missed",
    });
  } else if (roll < 0.74) {
    push({
      minute, type: "shot_off", clubId: squad.clubId,
      playerId: shooter.id, playerName: shooter.name,
      textKey: "chance.off_target",
    });
  }
  // Ganz harmlose Fernschüsse bleiben ungenannt — sonst wird der Ticker zur Liste
}

function resolveDiscipline(
  team: TeamState,
  minute: number,
  rng: Rng,
  push: (event: Omit<TickerEvent, "sequence">) => void,
  context: MatchContext,
  suspensions: { playerId: string; matchdays: number }[],
): void {
  const derbyFactor = context.isDerby ? 1.4 : 1.0;
  const candidates = team.onPitch.filter((p) => p.position !== "GK");
  if (candidates.length === 0) return;

  const perMinute = (TUNING.YELLOW_RATE * derbyFactor) / TUNING.MINUTES;
  if (!rng.chance(perMinute)) return;

  const player = rng.weighted(candidates, (p) => {
    const hothead = p.traits.includes("hothead") ? 1.2 : 1.0;
    const aggression = effectiveAttributes(p).tackling;
    return aggression * hothead;
  });

  const redChance = (TUNING.RED_RATE / TUNING.YELLOW_RATE) *
    (player.traits.includes("hothead") ? 1.2 : 1.0);

  if (rng.chance(redChance)) {
    team.stats.redCards++;
    team.sentOff.add(player.id);
    team.onPitch = team.onPitch.filter((p) => p.id !== player.id);
    team.ratingAdjust.set(player.id, (team.ratingAdjust.get(player.id) ?? 0) - 2.5);
    suspensions.push({ playerId: player.id, matchdays: rng.int(1, 2) });
    push({
      minute, type: "red_card", clubId: team.squad.clubId,
      playerId: player.id, playerName: player.name, textKey: "card.red",
    });
  } else {
    team.stats.yellowCards++;
    team.ratingAdjust.set(player.id, (team.ratingAdjust.get(player.id) ?? 0) - 0.3);
    push({
      minute, type: "yellow_card", clubId: team.squad.clubId,
      playerId: player.id, playerName: player.name, textKey: "card.yellow",
    });
  }
}

function resolveInjury(
  team: TeamState,
  minute: number,
  rng: Rng,
  push: (event: Omit<TickerEvent, "sequence">) => void,
  injuries: { playerId: string; matchdays: number }[],
): void {
  if (team.onPitch.length === 0) return;
  const perMinute = TUNING.INJURY_RATE / TUNING.MINUTES;
  if (!rng.chance(perMinute)) return;

  const player = rng.weighted(team.onPitch, (p) => {
    // Verletzungsanfällig ×1,8 (GDD §4.3), müde Spieler deutlich häufiger
    const prone = p.traits.includes("injury_prone") ? 1.8 : 1.0;
    const tired = p.fitness < 60 ? 1 + (60 - p.fitness) / 60 : 1;
    return prone * tired;
  });

  const matchdays = rng.weighted([1, 2, 3, 5, 8, 12], (d) => 1 / d);
  injuries.push({ playerId: player.id, matchdays });
  team.onPitch = team.onPitch.filter((p) => p.id !== player.id);

  push({
    minute, type: "injury", clubId: team.squad.clubId,
    playerId: player.id, playerName: player.name,
    textKey: "injury.forced_off", payload: { matchdays },
  });

  // Ersatz von der Bank, wenn möglich
  const replacement = team.bench.shift();
  if (replacement && team.substitutionsLeft > 0) {
    team.substitutionsLeft--;
    team.onPitch.push({ ...replacement, position: player.position });
    push({
      minute, type: "substitution", clubId: team.squad.clubId,
      playerId: replacement.id, playerName: replacement.name,
      secondaryPlayerId: player.id, secondaryPlayerName: player.name,
      textKey: "sub.injury",
    });
  }
}

function buildRatings(team: TeamState, goalsConceded: number): PlayerRating[] {
  return team.squad.starters.map((player) => {
    const goals = team.goalsByPlayer.get(player.id) ?? 0;
    const assists = team.assistsByPlayer.get(player.id) ?? 0;
    const adjust = team.ratingAdjust.get(player.id) ?? 0;

    let rating = 6.0 + goals * 1.1 + assists * 0.6 + adjust;
    if (player.position === "GK") rating += goalsConceded === 0 ? 1.0 : -goalsConceded * 0.25;
    if (team.stats.goals > goalsConceded) rating += 0.4;
    else if (team.stats.goals < goalsConceded) rating -= 0.3;

    return {
      playerId: player.id,
      rating: Math.round(clamp(rating, 1, 10) * 10) / 10,
      goals, assists,
      minutesPlayed: team.sentOff.has(player.id) ? 60 : 90,
    };
  });
}
