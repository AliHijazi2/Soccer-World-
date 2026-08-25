/**
 * Projektionen — die einzige Stelle, an der Domänenobjekte den Server verlassen
 * (Architektur §9).
 *
 * Der Server ist autoritativ, und der oft übersehene Teil davon ist die
 * Gegenrichtung: Es gibt Daten, die niemals ausgeliefert werden dürfen, auch
 * nicht versehentlich in einem verschachtelten Objekt.
 *
 * | Niemals an den Client        | Warum |
 * |------------------------------|-------|
 * | true_potential               | Das verdeckte Potenzial ist die zentrale Informationsökonomie (GDD §15). Einmal im Netzwerk-Tab sichtbar, ist die Mechanik für immer tot. |
 * | Fremde Proxy-Maxima          | Das Maximum eines Gegners zu kennen, entscheidet jeden Bieterkrieg. |
 * | Fremde Aufstellungen         | Sonst ist die Taktikschicht wertlos. |
 * | Fremde Scoutingberichte      | Wer bezahlt hat, soll seinen Vorsprung behalten. |
 * | Offene Ereignisse anderer    | |
 *
 * Umgesetzt wird das nicht durch Disziplin beim Schreiben von Endpunkten,
 * sondern hier: **Datenbankzeilen werden nirgends direkt serialisiert.**
 */

export interface PlayerRow {
  id: string;
  full_name: string;
  age: number;
  primary_position: string;
  overall: number;
  attributes: Record<string, number>;
  traits: string[];
  form: number;
  fitness: number;
  morale: number;
  injured_until_matchday: number | null;
  suspension_matches: number;
  market_value: number;
  wage_per_matchday: number;
  club_id: string | null;
  /** ⚠ Darf dieses Modul niemals verlassen */
  true_potential: number;
  potential_min: number;
  potential_max: number;
}

export interface PublicPlayer {
  id: string;
  name: string;
  age: number;
  position: string;
  overall: number;
  attributes: Record<string, number>;
  traits: string[];
  form: number;
  fitness: number;
  /** Nur der eigene Verein sieht die Moral seiner Spieler */
  morale?: number;
  injuredUntil: number | null;
  suspended: number;
  marketValue: number;
  /** Nur der eigene Verein sieht, was er zahlt */
  wage?: number;
  /** Geschätzte Spanne, nie der wahre Wert */
  potential: { min: number; max: number; confidence: "low" | "medium" | "high" };
  clubId: string | null;
}

export interface ScoutReport {
  revealedMin: number;
  revealedMax: number;
  traitsRevealed: boolean;
}

/**
 * Setzt einen Spieler für die Anzeige zusammen.
 *
 * Die Potenzialspanne kommt aus der Vorlage oder, falls der Verein gescoutet
 * hat, aus seinem Bericht. Der wahre Wert wird an keiner Stelle gelesen —
 * er ist in `PlayerRow` nur deshalb enthalten, weil die Abfrage ihn liefert,
 * und wird hier bewusst verworfen.
 */
export function toPublicPlayer(
  row: PlayerRow, viewerClubId: string | null, scout?: ScoutReport,
): PublicPlayer {
  const isOwn = row.club_id !== null && row.club_id === viewerClubId;

  const range = scout
    ? { min: scout.revealedMin, max: scout.revealedMax }
    : { min: row.potential_min, max: row.potential_max };
  const width = range.max - range.min;

  return {
    id: row.id,
    name: row.full_name,
    age: row.age,
    position: row.primary_position,
    overall: row.overall,
    attributes: row.attributes,
    traits: scout?.traitsRevealed || isOwn ? row.traits : [],
    form: row.form,
    fitness: row.fitness,
    ...(isOwn ? { morale: row.morale, wage: row.wage_per_matchday } : {}),
    injuredUntil: row.injured_until_matchday,
    suspended: row.suspension_matches,
    marketValue: row.market_value,
    potential: {
      min: range.min,
      max: range.max,
      confidence: width <= 4 ? "high" : width <= 9 ? "medium" : "low",
    },
    clubId: row.club_id,
  };
}

export interface AuctionRow {
  id: string;
  player_instance_id: string;
  seller_club_id: string | null;
  min_price: number;
  current_bid: number | null;
  current_bidder_club_id: string | null;
  current_bidder_name: string | null;
  closes_at: Date;
  status: string;
}

export interface PublicAuction {
  id: string;
  playerId: string;
  sellerClubId: string | null;
  minPrice: number;
  currentBid: number | null;
  /** Bieter sind namentlich sichtbar (GDD F14) — Schadenfreude braucht einen Adressaten */
  leaderName: string | null;
  leaderIsYou: boolean;
  closesAt: string;
  status: string;
  /** Nur das eigene hinterlegte Maximum, nie das eines anderen */
  yourMaximum?: number;
}

export function toPublicAuction(
  row: AuctionRow, viewerClubId: string | null, ownMaximum?: number | null,
): PublicAuction {
  return {
    id: row.id,
    playerId: row.player_instance_id,
    sellerClubId: row.seller_club_id,
    minPrice: row.min_price,
    currentBid: row.current_bid,
    leaderName: row.current_bidder_name,
    leaderIsYou: row.current_bidder_club_id === viewerClubId,
    closesAt: row.closes_at.toISOString(),
    status: row.status,
    // Das eigene Maximum darf man sehen, das der anderen nie — es würde
    // jeden Bieterkrieg entscheiden
    ...(ownMaximum != null ? { yourMaximum: ownMaximum } : {}),
  };
}

export interface ClubRow {
  id: string;
  name: string;
  short_name: string;
  is_bot: boolean;
  cash: number;
  fan_count: number;
  fan_mood: number;
  stadium_capacity: number;
  stadium_condition: number;
  ticket_price: number;
  prestige: number;
  expected_ppg: number;
  season_goal: string;
}

export interface PublicClub {
  id: string;
  name: string;
  shortName: string;
  isBot: boolean;
  fanCount: number;
  fanMood: number;
  stadiumCapacity: number;
  prestige: number;
  expectedPointsPerGame: number;
  seasonGoal: string;
  /** Nur der eigene Verein zeigt seine Kasse und den Stadionzustand */
  cash?: number;
  stadiumCondition?: number;
  ticketPrice?: number;
  /** Verfügbar heißt: Kasse minus gebundener Gebote */
  availableFunds?: number;
}

/**
 * Fanzahl, Stimmung und Kaderwert sind bewusst öffentlich.
 *
 * Sie sind die Grundlage für Schadenfreude und für die Einschätzung der
 * Konkurrenz — ein Spiel, in dem man die Lage der anderen nicht sieht, hat
 * keine Konkurrenz. Der Kassenstand bleibt privat, weil er sonst jede
 * Auktionsstrategie offenlegt.
 */
export function toPublicClub(
  row: ClubRow, viewerClubId: string | null, availableFunds?: number,
): PublicClub {
  const isOwn = row.id === viewerClubId;
  return {
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    isBot: row.is_bot,
    fanCount: row.fan_count,
    fanMood: row.fan_mood,
    stadiumCapacity: row.stadium_capacity,
    prestige: row.prestige,
    expectedPointsPerGame: row.expected_ppg,
    seasonGoal: row.season_goal,
    ...(isOwn ? {
      cash: row.cash,
      stadiumCondition: row.stadium_condition,
      ticketPrice: row.ticket_price,
      ...(availableFunds != null ? { availableFunds } : {}),
    } : {}),
  };
}

/**
 * Prüft rekursiv, ob eine Antwort ein verbotenes Feld enthält.
 *
 * Läuft in den Tests über jede Endpunktantwort. Ein Feld, das hier auftaucht,
 * ist im Netzwerk-Tab sichtbar — und damit die Mechanik dahinter tot.
 */
export const FORBIDDEN_FIELDS = [
  "true_potential", "truePotential",
  "max_amount", "maxAmount",
  "rng_salt", "rngSalt",
  "seed",
  "email",
] as const;

export function findForbiddenFields(value: unknown, path = "$"): string[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findForbiddenFields(item, `${path}[${index}]`));
  }
  const found: string[] = [];
  for (const [key, nested] of Object.entries(value)) {
    if ((FORBIDDEN_FIELDS as readonly string[]).includes(key)) {
      found.push(`${path}.${key}`);
    }
    found.push(...findForbiddenFields(nested, `${path}.${key}`));
  }
  return found;
}
