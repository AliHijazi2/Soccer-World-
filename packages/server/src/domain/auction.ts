/**
 * Auktionsabwicklung — der kritische Pfad des gesamten Systems
 * (Architektur §6).
 *
 * Die Regeln selbst stehen als reine Funktionen in shared/rules/auction.
 * Hier kommt nur dazu, was die Datenbank beisteuern muss: die richtige
 * Sperrreihenfolge und die atomare Umbuchung der Escrow-Sperren.
 */

import {
  applySoftClose, checkBid, resolveAuction,
  type BidRejection, type ProxyBid,
} from "../../../shared/src/rules/auction/rules.ts";
import { inTransaction, type Pool, type PoolClient } from "../db/pool.ts";

export interface PlaceBidCommand {
  auctionId: string;
  clubId: string;
  /** Höchstbetrag, den der Verein zu zahlen bereit ist. */
  maxAmount: number;
  now?: Date;
}

export type PlaceBidResult =
  | { ok: true; leaderClubId: string; displayPrice: number; closesAt: Date; youLead: boolean }
  | { ok: false; reason: BidRejection | "not_found" };

interface AuctionRow {
  id: string;
  league_id: string;
  seller_club_id: string | null;
  min_price: number;
  current_bid: number | null;
  current_bidder_club_id: string | null;
  closes_at: Date;
  status: string;
}

/**
 * Verfügbares Budget: Kassenbestand minus aller offenen Sperren.
 *
 * Die eigene Sperre auf genau diese Auktion wird ausgenommen — sie wird durch
 * das neue Gebot ersetzt und darf nicht doppelt zählen.
 */
async function availableFunds(
  client: PoolClient, clubId: string, exceptAuctionId: string,
): Promise<number> {
  const { rows } = await client.query<{ available: number }>(
    `SELECT c.cash - COALESCE((
        SELECT SUM(e.amount) FROM escrow_hold e
         WHERE e.club_id = c.id AND e.released_at IS NULL AND e.auction_id <> $2
     ), 0) AS available
       FROM club c WHERE c.id = $1`,
    [clubId, exceptAuctionId],
  );
  return rows[0]?.available ?? 0;
}

export async function placeBid(pool: Pool, cmd: PlaceBidCommand): Promise<PlaceBidResult> {
  const now = cmd.now ?? new Date();

  return inTransaction(pool, async (client) => {
    // Sperrreihenfolge: IMMER erst die Auktion, dann der Verein.
    // Ohne diese feste Reihenfolge entstehen Deadlocks, sobald zwei Vereine
    // sich wechselseitig auf zwei Auktionen überbieten — beim Marktabschluss
    // ist das garantiert der Fall.
    const auctionResult = await client.query<AuctionRow>(
      `SELECT id, league_id, seller_club_id, min_price, current_bid,
              current_bidder_club_id, closes_at, status
         FROM auction WHERE id = $1 FOR UPDATE`,
      [cmd.auctionId],
    );
    const auction = auctionResult.rows[0];
    if (!auction) return { ok: false, reason: "not_found" };

    await client.query("SELECT id FROM club WHERE id = $1 FOR UPDATE", [cmd.clubId]);

    const available = await availableFunds(client, cmd.clubId, cmd.auctionId);

    const rejection = checkBid({
      status: auction.status,
      closesAt: auction.closes_at.getTime(),
      minPrice: auction.min_price,
      currentBid: auction.current_bid,
      currentLeaderClubId: auction.current_bidder_club_id,
      sellerClubId: auction.seller_club_id,
      bidderClubId: cmd.clubId,
      availableFunds: available,
      amount: cmd.maxAmount,
      now: now.getTime(),
    });
    if (rejection) return { ok: false, reason: rejection };

    await client.query(
      `INSERT INTO bid (auction_id, club_id, amount, max_amount, created_at)
       VALUES ($1, $2, $3, $3, $4)`,
      [cmd.auctionId, cmd.clubId, cmd.maxAmount, now],
    );

    // Proxy-Auflösung über alle bisherigen Gebote. Das Ergebnis hängt nur von
    // den hinterlegten Maxima ab, nicht von der Eintreffreihenfolge.
    const bidRows = await client.query<{ club_id: string; max_amount: number; sequence: number }>(
      `SELECT club_id, max_amount, sequence FROM bid WHERE auction_id = $1 ORDER BY sequence`,
      [cmd.auctionId],
    );
    const proxies: ProxyBid[] = bidRows.rows.map((row) => ({
      clubId: row.club_id, maxAmount: row.max_amount, placedAt: Number(row.sequence),
    }));
    const state = resolveAuction(proxies, auction.min_price);

    // Genau eine offene Sperre je Auktion, und zwar die des Führenden in Höhe
    // seines Maximums. Alles andere wird freigegeben.
    await client.query(
      `UPDATE escrow_hold SET released_at = $2
        WHERE auction_id = $1 AND released_at IS NULL
          AND NOT (club_id = $3 AND amount = $4)`,
      [cmd.auctionId, now, state.leaderClubId, state.leaderMax],
    );
    await client.query(
      `INSERT INTO escrow_hold (club_id, auction_id, amount, created_at)
       SELECT $1, $2, $3, $4
        WHERE NOT EXISTS (
          SELECT 1 FROM escrow_hold
           WHERE auction_id = $2 AND released_at IS NULL)`,
      [state.leaderClubId, cmd.auctionId, state.leaderMax, now],
    );

    const newClosesAt = new Date(applySoftClose(auction.closes_at.getTime(), now.getTime()));
    await client.query(
      `UPDATE auction
          SET current_bid = $2, current_bidder_club_id = $3, closes_at = $4
        WHERE id = $1`,
      [cmd.auctionId, state.displayPrice, state.leaderClubId, newClosesAt],
    );

    return {
      ok: true,
      leaderClubId: state.leaderClubId as string,
      displayPrice: state.displayPrice,
      closesAt: newClosesAt,
      youLead: state.leaderClubId === cmd.clubId,
    };
  });
}

export type SettleResult =
  | { ok: true; outcome: "sold"; buyerClubId: string; fee: number }
  | { ok: true; outcome: "awaiting_seller"; buyerClubId: string; fee: number }
  | { ok: true; outcome: "expired" }
  | { ok: false; reason: "not_found" | "still_open" | "already_settled" };

/** Transfersteuer laut GDD §6.4 — pauschal, nicht steigend. */
export const TRANSFER_TAX_RATE = 0.05;

/**
 * Schließt eine abgelaufene Auktion ab.
 *
 * Freie Agenten werden sofort abgewickelt (GDD F17: kein Vetorecht, der
 * Höchstbieter bekommt den Spieler). Gehört der Spieler einem Freund,
 * entscheidet der Verkäufer — und die Sperre des Höchstbieters bleibt so lange
 * bestehen, sonst könnte er das Geld zwischenzeitlich ausgeben.
 */
export async function settleAuction(
  pool: Pool, auctionId: string, now = new Date(),
): Promise<SettleResult> {
  return inTransaction(pool, async (client) => {
    const { rows } = await client.query<AuctionRow & { player_instance_id: string }>(
      `SELECT id, league_id, seller_club_id, min_price, current_bid,
              current_bidder_club_id, closes_at, status, player_instance_id
         FROM auction WHERE id = $1 FOR UPDATE`,
      [auctionId],
    );
    const auction = rows[0];
    if (!auction) return { ok: false, reason: "not_found" };
    if (auction.status !== "open") return { ok: false, reason: "already_settled" };
    // Ein Soft-Close kann das Ende verschoben haben — dann später erneut versuchen
    if (auction.closes_at.getTime() > now.getTime()) return { ok: false, reason: "still_open" };

    const fee = auction.current_bid ?? 0;
    const buyer = auction.current_bidder_club_id;

    if (!buyer || fee < auction.min_price) {
      await client.query(
        `UPDATE escrow_hold SET released_at = $2
          WHERE auction_id = $1 AND released_at IS NULL`, [auctionId, now]);
      await client.query(
        `UPDATE auction SET status = 'expired', settled_at = $2 WHERE id = $1`,
        [auctionId, now]);
      return { ok: true, outcome: "expired" };
    }

    if (auction.seller_club_id !== null) {
      // Der Verkäufer entscheidet; Sperre bleibt bestehen
      await client.query(
        `UPDATE auction SET status = 'awaiting_seller', seller_deadline = $2 WHERE id = $1`,
        [auctionId, new Date(now.getTime() + 24 * 3600 * 1000)]);
      return { ok: true, outcome: "awaiting_seller", buyerClubId: buyer, fee };
    }

    await completeTransfer(client, auction, buyer, fee, now);
    return { ok: true, outcome: "sold", buyerClubId: buyer, fee };
  });
}

async function completeTransfer(
  client: PoolClient,
  auction: AuctionRow & { player_instance_id: string },
  buyerClubId: string,
  fee: number,
  now: Date,
): Promise<void> {
  const tax = Math.round(fee * TRANSFER_TAX_RATE);

  await client.query(
    `UPDATE escrow_hold SET released_at = $2
      WHERE auction_id = $1 AND released_at IS NULL`, [auction.id, now]);

  // Geld wird nie gesetzt, sondern gebucht (Datenmodell §9).
  // club.cash ist der Cache, der in derselben Transaktion mitgeführt wird.
  const book = async (clubId: string, category: string, amount: number, text: string) => {
    await client.query(
      `INSERT INTO ledger_entry
         (league_id, club_id, season, matchday, category, amount, reference_type, reference_id, description)
       VALUES ($1, $2, 1, 0, $3, $4, 'auction', $5, $6)`,
      [auction.league_id, clubId, category, amount, auction.id, text]);
    await client.query("UPDATE club SET cash = cash + $2 WHERE id = $1", [clubId, amount]);
  };

  // Die Außenwelt ist ein Marktakteur, kein Verein: Gewinnt sie, verlässt der
  // Spieler die Liga, statt in einem Bot-Kader zu landen (GDD §5.4).
  // Wer nicht mitbietet, verliert ihn ans Ausland — das ist der Druck, den
  // die Außenwelt erzeugen soll.
  const outside = await client.query<{ is_outside_world: boolean }>(
    "SELECT is_outside_world FROM club WHERE id = $1", [buyerClubId]);
  const toOutsideWorld = outside.rows[0]?.is_outside_world ?? false;

  if (!toOutsideWorld) {
    await book(buyerClubId, "transfer_in", -fee, "Ablöse");
  }
  if (auction.seller_club_id) {
    await book(auction.seller_club_id, "transfer_out", fee - tax, "Ablöse abzüglich Steuer");
  }

  await client.query(
    toOutsideWorld
      ? `UPDATE player_instance SET club_id = NULL, pool_state = 'reserve' WHERE id = $1`
      : `UPDATE player_instance SET club_id = $2 WHERE id = $1`,
    toOutsideWorld
      ? [auction.player_instance_id]
      : [auction.player_instance_id, buyerClubId]);

  await client.query(
    `INSERT INTO transfer
       (league_id, player_instance_id, from_club_id, to_club_id, fee, tax, channel, season, matchday)
     VALUES ($1, $2, $3, $4, $5, $6, 'auction', 1, 0)`,
    [auction.league_id, auction.player_instance_id, auction.seller_club_id,
     toOutsideWorld ? null : buyerClubId, fee, tax]);

  await client.query(
    `UPDATE auction SET status = 'completed', settled_at = $2 WHERE id = $1`,
    [auction.id, now]);

  await reportTransfer(client, auction, buyerClubId, fee, toOutsideWorld);
}

/**
 * Meldet den Transfer im Boulevard-Feed.
 *
 * Ein Transfer ohne öffentliche Reaktion ist eine Buchung. Erst die Meldung
 * macht daraus einen Vorgang, über den geredet wird — und der Panikkauf eines
 * Freundes ist der Kern der Schadenfreude, auf die das Design zielt (§16.1).
 */
async function reportTransfer(
  client: PoolClient,
  auction: AuctionRow & { player_instance_id: string },
  buyerClubId: string,
  fee: number,
  toOutsideWorld: boolean,
): Promise<void> {
  const info = await client.query<{
    player: string; value: number; buyer: string; season: number; matchday: number;
  }>(
    `SELECT t.full_name AS player, p.market_value AS value, c.name AS buyer,
            l.current_season AS season, l.current_matchday AS matchday
       FROM player_instance p
       JOIN player_template t ON t.id = p.template_id
       JOIN club c ON c.id = $2
       JOIN league l ON l.id = $3
      WHERE p.id = $1`,
    [auction.player_instance_id, buyerClubId, auction.league_id]);
  const row = info.rows[0];
  if (!row) return;

  const bidders = await client.query<{ n: number }>(
    "SELECT COUNT(DISTINCT club_id)::int AS n FROM bid WHERE auction_id = $1", [auction.id]);
  const bidderCount = bidders.rows[0]?.n ?? 1;

  const ratio = row.value > 0 ? fee / row.value : 1;
  const percent = Math.round(Math.abs(ratio - 1) * 100);

  let templateKey = "transfer.completed";
  let importance = 1;
  if (toOutsideWorld) {
    templateKey = "transfer.to_abroad";
    importance = 2;
  } else if (bidderCount >= 3) {
    templateKey = "transfer.bidding_war";
    importance = 2;
  } else if (ratio >= 1.4) {
    templateKey = "transfer.overpaid";
    importance = 3;
  } else if (ratio <= 0.7) {
    templateKey = "transfer.bargain";
    importance = 2;
  }

  await client.query(
    `INSERT INTO feed_item
       (league_id, season, matchday, template_key, payload, subject_club_id, importance)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [auction.league_id, row.season, Math.max(row.matchday, 1), templateKey,
     { club: row.buyer, player: row.player, fee, value: row.value,
       pct: percent, bidders: bidderCount },
     toOutsideWorld ? null : buyerClubId, importance]);
}
