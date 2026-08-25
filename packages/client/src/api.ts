/**
 * Zugriff auf die Schnittstelle.
 *
 * Der Client kennt nur Absichten und Anzeigedaten. Alles, was er sendet, wird
 * serverseitig neu geprüft; alles, was er bekommt, hat die Projektionsschicht
 * passiert (Architektur §9).
 */

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
  morale?: number;
  injuredUntil: number | null;
  suspended: number;
  marketValue: number;
  wage?: number;
  potential: { min: number; max: number; confidence: "low" | "medium" | "high" };
  clubId: string | null;
}

export interface PublicAuction {
  id: string;
  playerId: string;
  sellerClubId: string | null;
  minPrice: number;
  currentBid: number | null;
  leaderName: string | null;
  leaderIsYou: boolean;
  closesAt: string;
  status: string;
  yourMaximum?: number;
}

export interface TableRow {
  id: string;
  name: string;
  shortName: string;
  isBot: boolean;
  fanCount: number;
  fanMood: number;
  prestige: number;
  expectedPointsPerGame: number;
  seasonGoal: string;
  played: number; won: number; drawn: number; lost: number;
  goalsFor: number; goalsAgainst: number; points: number;
  cash?: number;
  availableFunds?: number;
  ticketPrice?: number;
}

export interface FeedItem {
  id: number;
  matchday: number;
  importance: number;
  text: string;
}

export interface ClubEvent {
  id: string;
  matchday: number;
  category: string;
  title: string;
  body: string;
  options: { index: number; text: string }[];
  chosenOption: number | null;
  resolved: boolean;
}

export interface TickerLine {
  minute: number;
  type: string;
  text: string;
}

let clubId = localStorage.getItem("clubId") ?? "";

export function setClubId(id: string): void {
  clubId = id;
  localStorage.setItem("clubId", id);
}
export function getClubId(): string { return clubId; }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(clubId ? { "x-club-id": clubId } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json() as { error?: string };
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "Fehler");
  }
  return body as T;
}

export const api = {
  state: (leagueId: string) =>
    request<{ league: { name: string; current_matchday: number; current_season: number; status: string };
              table: TableRow[] }>(`/leagues/${leagueId}/state`),
  market: (leagueId: string) =>
    request<{ auctions: PublicAuction[]; players: PublicPlayer[] }>(`/leagues/${leagueId}/market`),
  squad: (id: string) => request<{ players: PublicPlayer[] }>(`/clubs/${id}/squad`),
  feed: (leagueId: string, limit = 40) =>
    request<{ items: FeedItem[] }>(`/leagues/${leagueId}/feed?limit=${limit}`),
  events: (id: string) => request<{ events: ClubEvent[] }>(`/clubs/${id}/events`),
  ticker: (matchId: string) =>
    request<{ match: { home: string; away: string; home_goals: number; away_goals: number;
                       matchday: number }; lines: TickerLine[] }>(`/matches/${matchId}/ticker`),

  bid: (auctionId: string, maxAmount: number) =>
    request<{ leaderIsYou: boolean; displayPrice: number; closesAt: string }>(
      `/auctions/${auctionId}/bid`,
      { method: "POST", body: JSON.stringify({ maxAmount }) }),
  list: (playerId: string, minPrice: number, hours = 24) =>
    request<{ auctionId: string }>(`/players/${playerId}/list`,
      { method: "POST", body: JSON.stringify({ minPrice, hours }) }),
  resolveEvent: (eventId: string, option: number) =>
    request<{ ok: boolean }>(`/events/${eventId}/resolve`,
      { method: "POST", body: JSON.stringify({ option }) }),
};

// ── Anzeigehilfen ─────────────────────────────────────────────────────────

export function money(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const mio = value / 1_000_000;
    return `${mio.toFixed(Math.abs(mio) >= 100 ? 0 : 1).replace(".", ",")} Mio`;
  }
  if (abs >= 1000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
}

export function number(value: number): string {
  return Math.round(value).toLocaleString("de-DE");
}

/** Verbleibende Zeit bis zum Auktionsende, kurz und ohne Sekundenzappeln. */
export function timeLeft(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "beendet";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

/** Farbcode für Fitness und Stimmung — dieselbe Skala überall. */
export function healthTone(value: number): string {
  if (value >= 80) return "good";
  if (value >= 60) return "ok";
  if (value >= 35) return "warn";
  return "bad";
}
