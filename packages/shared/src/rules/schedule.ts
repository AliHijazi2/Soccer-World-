/**
 * Spielplan und Zeitplanung (GDD §9.1, §1.1).
 *
 * Reine Funktionen: kein Datenbankzugriff, keine Uhr. Der Scheduler in
 * packages/server ruft das hier auf und schreibt nur noch das Ergebnis weg.
 */

export const SEASON = {
  /** Fix, unabhängig von der Spielerzahl (GDD F3) */
  MATCHDAYS: 21,
  /** Anstöße pro Tag */
  KICKOFFS_PER_DAY: 3,
} as const;

export interface Fixture {
  matchday: number;
  homeIndex: number;
  awayIndex: number;
}

/**
 * Erzeugt 21 Spieltage für eine gerade Anzahl Vereine.
 *
 * Nach dem Kreisverfahren: Ein Verein bleibt fest, die übrigen rotieren. Eine
 * volle Runde dauert n−1 Spieltage; die Runden werden zyklisch wiederholt, bis
 * 21 Spieltage voll sind, mit getauschtem Heimrecht in jeder zweiten Runde.
 *
 * Die Vereinszahl ist immer gerade, weil bei ungerader Teilnehmerzahl ein
 * Bot-Verein auffüllt (GDD F16). Freilose gibt es deshalb nicht mehr.
 */
export function generateFixtures(clubCount: number, matchdays = SEASON.MATCHDAYS): Fixture[] {
  if (clubCount < 2) throw new Error("Mindestens zwei Vereine nötig");
  if (clubCount % 2 !== 0) {
    throw new Error(
      `Ungerade Vereinszahl (${clubCount}) — vor der Spielplanerzeugung muss ` +
      "ein Bot-Verein ergänzt werden (GDD §9.5)",
    );
  }

  const perRound = clubCount - 1;
  const half = clubCount / 2;
  const fixtures: Fixture[] = [];

  // Verein 0 bleibt stehen, die übrigen rotieren
  let rotating = Array.from({ length: clubCount - 1 }, (_, i) => i + 1);

  for (let matchday = 1; matchday <= matchdays; matchday++) {
    const roundIndex = Math.floor((matchday - 1) / perRound);
    const swapHome = roundIndex % 2 === 1;
    const slot = (matchday - 1) % perRound;

    if (slot === 0 && matchday > 1) {
      // Neue Runde: Rotation zurücksetzen, damit jede Runde identisch aufgebaut ist
      rotating = Array.from({ length: clubCount - 1 }, (_, i) => i + 1);
    }

    const lineup = [0, ...rotating];
    for (let i = 0; i < half; i++) {
      const a = lineup[i]!;
      const b = lineup[clubCount - 1 - i]!;
      // Verein 0 steht im Kreisverfahren fest und rotiert nie durch die
      // Paarungspositionen. Sein Heimrecht muss deshalb pro Spieltag wechseln,
      // nicht pro Runde — sonst sammelt er bei drei Runden doppelt so viele
      // Heimspiele wie alle anderen.
      const alternate = i === 0 ? slot % 2 === 1 : i % 2 === 1;
      const flip = alternate !== swapHome;
      fixtures.push({
        matchday,
        homeIndex: flip ? b : a,
        awayIndex: flip ? a : b,
      });
    }

    // Rotation für den nächsten Spieltag
    const last = rotating.pop()!;
    rotating.unshift(last);
  }

  return fixtures;
}

export interface ScheduleSlot {
  matchday: number;
  /** Tag der Saison, 0-basiert */
  day: number;
  /** Anstoß-Nummer des Tages, 0-basiert */
  slot: number;
}

export function matchdaySlot(matchday: number): ScheduleSlot {
  return {
    matchday,
    day: Math.floor((matchday - 1) / SEASON.KICKOFFS_PER_DAY),
    slot: (matchday - 1) % SEASON.KICKOFFS_PER_DAY,
  };
}

// ── Zeitzonen ─────────────────────────────────────────────────────────────

/** Versatz einer Zeitzone gegenüber UTC zu einem konkreten Zeitpunkt, in ms. */
function zoneOffset(utcMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(utcMs))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  const asUtc = Date.UTC(
    parts.year!, parts.month! - 1, parts.day!,
    parts.hour! % 24, parts.minute!, parts.second!,
  );
  return asUtc - utcMs;
}

/**
 * Rechnet eine lokale Wanduhrzeit in einen UTC-Zeitpunkt um.
 *
 * Zwei Durchgänge, weil der Versatz selbst vom Zeitpunkt abhängt: An einer
 * Zeitumstellung liefert der erste Versuch den Versatz der falschen Seite.
 * Ohne diese Korrektur verschiebt sich der Anstoß mitten in der Saison um eine
 * Stunde (Architektur §10).
 */
export function zonedTimeToUtc(
  year: number, month: number, day: number,
  hour: number, minute: number, timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let utc = naive - zoneOffset(naive, timeZone);
  utc = naive - zoneOffset(utc, timeZone);
  return new Date(utc);
}

export interface KickoffPlan {
  matchday: number;
  kickoffAt: Date;
}

/**
 * Legt die Anstoßzeiten aller Spieltage fest.
 *
 * Die Umrechnung passiert bewusst pro Tag neu und nicht durch Addition von
 * 24 Stunden — sonst wäre ein Tag mit Zeitumstellung 23 oder 25 Stunden lang
 * und der ganze Rest der Saison verschoben.
 */
export function planKickoffs(
  seasonStart: { year: number; month: number; day: number },
  kickoffTimes: readonly string[],
  timeZone: string,
  matchdays = SEASON.MATCHDAYS,
): KickoffPlan[] {
  if (kickoffTimes.length !== SEASON.KICKOFFS_PER_DAY) {
    throw new Error(`Es müssen genau ${SEASON.KICKOFFS_PER_DAY} Anstoßzeiten sein`);
  }

  const plans: KickoffPlan[] = [];
  for (let matchday = 1; matchday <= matchdays; matchday++) {
    const { day, slot } = matchdaySlot(matchday);
    const time = kickoffTimes[slot]!;
    const [hour, minute] = time.split(":").map(Number) as [number, number];

    // Kalendertag korrekt weiterzählen, unabhängig von Zeitumstellungen
    const date = new Date(Date.UTC(seasonStart.year, seasonStart.month - 1, seasonStart.day));
    date.setUTCDate(date.getUTCDate() + day);

    plans.push({
      matchday,
      kickoffAt: zonedTimeToUtc(
        date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(),
        hour, minute, timeZone,
      ),
    });
  }
  return plans;
}

/**
 * Zeitpunkt des Marktabschlusses am Tag eines Spieltags.
 * Alle Auktionen enden gestaffelt im Fenster davor (GDD F5).
 */
export function marketCloseAt(
  kickoffAt: Date, windowStart: string, timeZone: string,
): Date {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const [year, month, day] = formatter.format(kickoffAt).split("-").map(Number) as
    [number, number, number];
  const [hour, minute] = windowStart.split(":").map(Number) as [number, number];
  return zonedTimeToUtc(year, month, day, hour, minute, timeZone);
}
