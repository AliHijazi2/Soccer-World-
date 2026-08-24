/**
 * Welche Boulevard-Meldung wann entsteht (GDD §16.1).
 *
 * Reine Funktionen: Sie bekommen einen Zustandsschnappschuss und liefern
 * Kandidaten. Ob eine Meldung tatsächlich erscheint, entscheidet der Server
 * anhand der Sperrfristen — sonst steht dreimal am Tag dasselbe im Feed.
 */

export interface ClubSnapshot {
  clubId: string;
  name: string;
  isBot: boolean;
  rank: number;
  points: number;
  played: number;
  expectedPpg: number;
  fanMood: number;
  fanCount: number;
  cash: number;
  winStreak: number;
  lossStreak: number;
  tiredPlayers: number;
  injuredPlayers: number;
  squadSize: number;
}

export interface MatchSnapshot {
  homeName: string;
  awayName: string;
  homeGoals: number;
  awayGoals: number;
  /** Erwartete Punkte je Spiel — daraus wird eine Überraschung erkannt */
  homeExpectedPpg: number;
  awayExpectedPpg: number;
}

export interface FeedCandidate {
  templateKey: string;
  payload: Record<string, string | number>;
  subjectClubId?: string;
  /** 1 normal, 2 bemerkenswert, 3 Schlagzeile */
  importance: number;
  /** Frühestens nach so vielen Spieltagen darf dieselbe Meldung wiederkommen */
  cooldownMatchdays: number;
}

const THRESHOLDS = {
  THRASHING_MARGIN: 3,
  UPSET_EXPECTATION_GAP: 0.35,
  STREAK: 3,
  HOSTILE_MOOD: 35,
  RESTLESS_MOOD: 50,
  EUPHORIC_MOOD: 85,
  /**
   * Anteil des Kaders unter der Leistungsgrenze. Bewusst relativ: Ein fester
   * Schwellwert wie "5 Spieler" ist am Saisonende immer erfüllt, weil die
   * Fitness über 21 Spieltage bei allen fällt — die Meldung wäre dann kein
   * Hinweis mehr, sondern Rauschen.
   */
  TIRED_SHARE: 0.7,
  INJURY_CRISIS: 4,
  EXPECTATION_GAP: 0.35,
  /** Erst ab hier ist eine Erwartungsdifferenz aussagekräftig */
  EXPECTATION_MIN_MATCHDAYS: 7,
} as const;

/** Meldungen zu einzelnen Partien. */
export function matchFeed(match: MatchSnapshot): FeedCandidate[] {
  const candidates: FeedCandidate[] = [];
  const margin = Math.abs(match.homeGoals - match.awayGoals);
  const homeWon = match.homeGoals > match.awayGoals;
  const drawn = match.homeGoals === match.awayGoals;

  if (margin >= THRESHOLDS.THRASHING_MARGIN) {
    candidates.push({
      templateKey: "match.thrashing",
      payload: {
        winner: homeWon ? match.homeName : match.awayName,
        loser: homeWon ? match.awayName : match.homeName,
        // Die Tore müssen in derselben Reihenfolge stehen wie die Namen,
        // sonst liest sich "A schlägt B 1:4" — sachlich richtig, sprachlich falsch
        home: Math.max(match.homeGoals, match.awayGoals),
        away: Math.min(match.homeGoals, match.awayGoals),
      },
      importance: 2, cooldownMatchdays: 0,
    });
  }

  if (!drawn) {
    // Eine Überraschung ist es nur, wenn der Verlierer deutlich mehr erwarten durfte
    const winnerExpected = homeWon ? match.homeExpectedPpg : match.awayExpectedPpg;
    const loserExpected = homeWon ? match.awayExpectedPpg : match.homeExpectedPpg;
    if (loserExpected - winnerExpected >= THRESHOLDS.UPSET_EXPECTATION_GAP) {
      candidates.push({
        templateKey: "match.upset",
        payload: {
          winner: homeWon ? match.homeName : match.awayName,
          loser: homeWon ? match.awayName : match.homeName,
          home: Math.max(match.homeGoals, match.awayGoals),
          away: Math.min(match.homeGoals, match.awayGoals),
        },
        importance: 3, cooldownMatchdays: 0,
      });
    }
  }

  return candidates;
}

/** Meldungen zum Zustand eines Vereins. */
export function clubFeed(club: ClubSnapshot, matchday: number): FeedCandidate[] {
  const candidates: FeedCandidate[] = [];
  const base = { subjectClubId: club.clubId };

  if (club.winStreak >= THRESHOLDS.STREAK) {
    candidates.push({ ...base, templateKey: "match.win_streak",
      payload: { club: club.name, count: club.winStreak },
      importance: 2, cooldownMatchdays: 2 });
  }
  if (club.lossStreak >= THRESHOLDS.STREAK) {
    candidates.push({ ...base, templateKey: "match.losing_streak",
      payload: { club: club.name, count: club.lossStreak },
      importance: 2, cooldownMatchdays: 2 });
  }

  // Der Bot bekommt keine eigenen Vereinsmeldungen — er hat keine Fans,
  // keine Wirtschaft und keinen Ruf zu verlieren (GDD §9.5)
  if (club.isBot) {
    if (club.rank <= 2) {
      candidates.push({ templateKey: "bot.leading",
        payload: { rank: club.rank, count: club.rank - 1 },
        importance: 3, cooldownMatchdays: 6 });
    }
    return candidates;
  }

  if (club.fanMood < THRESHOLDS.HOSTILE_MOOD) {
    candidates.push({ ...base, templateKey: "fans.hostile",
      payload: { club: club.name, mood: Math.round(club.fanMood) },
      importance: 3, cooldownMatchdays: 5 });
  } else if (club.fanMood < THRESHOLDS.RESTLESS_MOOD) {
    candidates.push({ ...base, templateKey: "fans.protest",
      payload: { club: club.name, mood: Math.round(club.fanMood) },
      importance: 2, cooldownMatchdays: 4 });
  } else if (club.fanMood >= THRESHOLDS.EUPHORIC_MOOD) {
    candidates.push({ ...base, templateKey: "fans.euphoric",
      payload: { club: club.name, mood: Math.round(club.fanMood), fans: club.fanCount },
      importance: 2, cooldownMatchdays: 5 });
  }

  if (club.cash < 0) {
    candidates.push({ ...base, templateKey: "club.broke",
      payload: { club: club.name, cash: club.cash },
      importance: 3, cooldownMatchdays: 3 });
  }

  const tiredShare = club.squadSize > 0 ? club.tiredPlayers / club.squadSize : 0;
  if (tiredShare >= THRESHOLDS.TIRED_SHARE) {
    candidates.push({ ...base, templateKey: "squad.tired",
      payload: { club: club.name, count: club.tiredPlayers },
      importance: 1, cooldownMatchdays: 7 });
  }
  if (club.injuredPlayers >= THRESHOLDS.INJURY_CRISIS) {
    candidates.push({ ...base, templateKey: "squad.injury_crisis",
      payload: { club: club.name, count: club.injuredPlayers },
      importance: 2, cooldownMatchdays: 6 });
  }

  // Erwartungsdifferenz erst, wenn genug Spiele gelaufen sind
  if (club.played >= THRESHOLDS.EXPECTATION_MIN_MATCHDAYS) {
    const actual = club.points / club.played;
    const delta = actual - club.expectedPpg;
    if (delta <= -THRESHOLDS.EXPECTATION_GAP) {
      candidates.push({ ...base, templateKey: "expectation.missed",
        payload: { club: club.name, rank: club.rank, delta, fee: 0 },
        importance: 3, cooldownMatchdays: 5 });
    } else if (delta >= THRESHOLDS.EXPECTATION_GAP) {
      candidates.push({ ...base, templateKey: "expectation.exceeded",
        payload: { club: club.name, rank: club.rank, delta },
        importance: 2, cooldownMatchdays: 5 });
    }
  }

  return candidates;
}

/**
 * Wählt aus allen Kandidaten die Meldungen aus, die tatsächlich erscheinen.
 *
 * Begrenzt auf wenige je Spieltag und nach Wichtigkeit sortiert: Ein Feed, in
 * dem alles steht, wird genauso wenig gelesen wie einer, in dem nichts steht.
 */
export function selectFeed(
  candidates: readonly FeedCandidate[],
  lastSeen: ReadonlyMap<string, number>,
  matchday: number,
  limit = 5,
): FeedCandidate[] {
  return candidates
    .filter((candidate) => {
      const key = `${candidate.templateKey}:${candidate.subjectClubId ?? "-"}`;
      const last = lastSeen.get(key);
      return last === undefined || matchday - last > candidate.cooldownMatchdays;
    })
    .sort((a, b) => b.importance - a.importance)
    .slice(0, limit);
}
