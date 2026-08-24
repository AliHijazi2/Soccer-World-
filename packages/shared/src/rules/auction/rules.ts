/**
 * Auktionsregeln (GDD §6.1).
 *
 * Reine Funktionen ohne Datenbank und ohne Uhr — die Zeit wird hereingereicht.
 * Der Datenbankcode in packages/server wickelt das nur noch in eine Transaktion.
 */

export const AUCTION = {
  /** Mindestschritt: max(250.000, 3 % des aktuellen Gebots) */
  MIN_INCREMENT_ABSOLUTE: 250_000,
  MIN_INCREMENT_PERCENT: 0.03,
  /** Ein Gebot innerhalb dieses Fensters vor Schluss verlängert die Auktion */
  SOFT_CLOSE_WINDOW_MS: 3 * 60 * 1000,
  SOFT_CLOSE_EXTENSION_MS: 3 * 60 * 1000,
  /** Sicherung gegen Endlosschleifen bei der Proxy-Auflösung */
  MAX_PROXY_ROUNDS: 64,
} as const;

export function minIncrement(currentBid: number): number {
  return Math.max(
    AUCTION.MIN_INCREMENT_ABSOLUTE,
    Math.ceil((currentBid * AUCTION.MIN_INCREMENT_PERCENT) / 10_000) * 10_000,
  );
}

/** Kleinster Betrag, mit dem man das aktuelle Gebot überbieten darf. */
export function minimumNextBid(currentBid: number | null, minPrice: number): number {
  if (currentBid === null) return Math.max(minPrice, AUCTION.MIN_INCREMENT_ABSOLUTE);
  return currentBid + minIncrement(currentBid);
}

export interface ProxyBid {
  clubId: string;
  /** Geheimes Maximum. Ein Gebot ohne Proxy setzt maxAmount = amount. */
  maxAmount: number;
  /** Reihenfolge des Eingangs — entscheidet nur bei exakt gleichem Maximum */
  placedAt: number;
}

export interface AuctionState {
  leaderClubId: string | null;
  /** Öffentlich sichtbarer Preis */
  displayPrice: number;
  /** Maximum des Führenden — niemals an andere Clients (Architektur §9) */
  leaderMax: number;
}

/**
 * Bestimmt aus allen abgegebenen Proxy-Geboten den Führenden und den Preis.
 *
 * Entscheidend für asynchrones Bieten: Das Ergebnis hängt **nur** von den
 * hinterlegten Maxima ab, nicht davon, wer zuerst geklickt hat. Bei exakt
 * gleichem Maximum gewinnt das frühere Gebot — sonst wäre das Ergebnis nicht
 * eindeutig. Ohne diese Eigenschaft gewinnt, wer zufällig um 16:47 wach ist,
 * und die Auktion wäre für eine asynchrone Runde unbrauchbar.
 */
export function resolveAuction(bids: readonly ProxyBid[], minPrice: number): AuctionState {
  if (bids.length === 0) {
    return { leaderClubId: null, displayPrice: minPrice, leaderMax: 0 };
  }

  // Pro Verein zählt nur das höchste Maximum; bei Gleichstand das früheste
  const best = new Map<string, ProxyBid>();
  for (const bid of bids) {
    const existing = best.get(bid.clubId);
    if (!existing || bid.maxAmount > existing.maxAmount) best.set(bid.clubId, bid);
  }

  const ranked = [...best.values()].sort((a, b) =>
    b.maxAmount - a.maxAmount || a.placedAt - b.placedAt);

  const leader = ranked[0]!;
  const runnerUp = ranked[1];

  if (!runnerUp) {
    return {
      leaderClubId: leader.clubId,
      displayPrice: Math.max(minPrice, Math.min(leader.maxAmount, minimumNextBid(null, minPrice))),
      leaderMax: leader.maxAmount,
    };
  }

  // Der Führende zahlt einen Schritt über dem zweithöchsten Maximum,
  // höchstens aber sein eigenes Maximum.
  const target = Math.min(leader.maxAmount, runnerUp.maxAmount + minIncrement(runnerUp.maxAmount));
  return {
    leaderClubId: leader.clubId,
    displayPrice: Math.max(minPrice, target),
    leaderMax: leader.maxAmount,
  };
}

export type BidRejection =
  | "auction_closed"
  | "below_minimum"
  | "below_min_price"
  | "insufficient_funds"
  | "own_player"
  | "already_leading";

export interface BidCheckInput {
  status: string;
  closesAt: number;
  minPrice: number;
  currentBid: number | null;
  currentLeaderClubId: string | null;
  sellerClubId: string | null;
  bidderClubId: string;
  /** Kassenbestand minus bereits gebundener Sperren, ohne die eigene auf diese Auktion */
  availableFunds: number;
  amount: number;
  now: number;
}

/**
 * Prüft ein Gebot, bevor irgendetwas geschrieben wird.
 *
 * Wichtig ist die Deckungsprüfung gegen `amount`, also gegen das **Maximum**
 * und nicht gegen den angezeigten Preis: Wer 100 Mio als Proxy hinterlegt, muss
 * 100 Mio haben. Sonst könnte man mit ungedeckten Maxima Preise hochtreiben und
 * anschließend nicht zahlen.
 */
export function checkBid(input: BidCheckInput): BidRejection | null {
  if (input.status !== "open") return "auction_closed";
  if (input.now >= input.closesAt) return "auction_closed";
  if (input.sellerClubId === input.bidderClubId) return "own_player";
  if (input.currentLeaderClubId === input.bidderClubId) return "already_leading";
  if (input.amount < input.minPrice) return "below_min_price";
  if (input.amount < minimumNextBid(input.currentBid, input.minPrice)) return "below_minimum";
  if (input.amount > input.availableFunds) return "insufficient_funds";
  return null;
}

/** Verlängert das Auktionsende, wenn kurz vor Schluss geboten wurde. */
export function applySoftClose(closesAt: number, now: number): number {
  const remaining = closesAt - now;
  if (remaining > AUCTION.SOFT_CLOSE_WINDOW_MS) return closesAt;
  return now + AUCTION.SOFT_CLOSE_EXTENSION_MS;
}
