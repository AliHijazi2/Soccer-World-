/**
 * Nebenläufigkeitstests gegen echtes PostgreSQL.
 *
 * Laut docs/ARCHITECTURE.md §13 geht das System ohne diese Tests nicht in
 * Betrieb: Sie sind der einzige Nachweis, dass die Escrow-Invarianten auch
 * dann halten, wenn mehrere Freunde in derselben Sekunde bieten.
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { placeBid, settleAuction } from "../src/domain/auction.ts";
import type { Pool } from "../src/db/pool.ts";
import { checkInvariants, freshPool, seed } from "./helpers.ts";

let pool: Pool;
before(async () => { pool = await freshPool("sw_test_auction"); });
after(async () => { await pool.end(); });

const MIO = 1_000_000;

describe("Auktion unter Nebenläufigkeit", () => {
  test("20 gleichzeitige Gebote lassen genau einen Höchstbieter zurück", async () => {
    const fx = await seed(pool, 4, 1, 400 * MIO);
    const auctionId = fx.auctions[0]!.id;

    // Alle vier Vereine feuern gleichzeitig, mit verschiedenen Maxima
    const amounts = [12, 18, 25, 31, 14, 22, 28, 35, 16, 20,
                     26, 33, 13, 19, 24, 30, 15, 21, 27, 40];
    const results = await Promise.all(
      amounts.map((mio, i) => placeBid(pool, {
        auctionId,
        clubId: fx.clubs[i % fx.clubs.length]!.id,
        maxAmount: mio * MIO,
      })),
    );

    const accepted = results.filter((r) => r.ok).length;
    assert.ok(accepted > 0, "Kein einziges Gebot wurde angenommen");

    const auction = await pool.query(
      "SELECT current_bid, current_bidder_club_id FROM auction WHERE id = $1", [auctionId]);
    assert.ok(auction.rows[0]!.current_bidder_club_id, "Kein Höchstbieter gesetzt");

    const holds = await pool.query(
      "SELECT COUNT(*)::int AS n FROM escrow_hold WHERE auction_id = $1 AND released_at IS NULL",
      [auctionId]);
    assert.equal(holds.rows[0]!.n, 1, "Es muss genau eine offene Sperre geben");

    const violations = await checkInvariants(pool);
    assert.deepEqual(violations, [], "Invarianten verletzt: " + JSON.stringify(violations));
  });

  test("Der Verein mit dem höchsten Maximum führt, egal wer zuerst kam", async () => {
    const fx = await seed(pool, 3, 1, 400 * MIO);
    const auctionId = fx.auctions[0]!.id;
    const a = fx.clubs[0]!, b = fx.clubs[1]!, c = fx.clubs[2]!;

    await Promise.all([
      placeBid(pool, { auctionId, clubId: a.id, maxAmount: 30 * MIO }),
      placeBid(pool, { auctionId, clubId: b.id, maxAmount: 90 * MIO }),
      placeBid(pool, { auctionId, clubId: c.id, maxAmount: 55 * MIO }),
    ]);

    const { rows } = await pool.query<{ current_bidder_club_id: string; current_bid: number }>(
      "SELECT current_bidder_club_id, current_bid FROM auction WHERE id = $1", [auctionId]);
    assert.equal(rows[0]!.current_bidder_club_id, b.id, "Höchstes Maximum muss führen");
    assert.ok(rows[0]!.current_bid < 90 * MIO, "Der Führende darf sein Maximum nicht zahlen");
    assert.ok(rows[0]!.current_bid > 55 * MIO, "Der Preis muss über dem zweithöchsten liegen");
  });

  test("Ein Verein kann sein Geld nicht mehrfach binden", async () => {
    // 100 Mio Kasse, fünf Auktionen, auf jede ein Gebot über 30 Mio:
    // höchstens drei dürfen durchgehen.
    const fx = await seed(pool, 2, 5, 100 * MIO);
    const club = fx.clubs[0]!.id;

    const results = await Promise.all(
      fx.auctions.map((auction) =>
        placeBid(pool, { auctionId: auction.id, clubId: club, maxAmount: 30 * MIO })),
    );
    const accepted = results.filter((r) => r.ok).length;
    assert.ok(accepted <= 3, `${accepted} Gebote angenommen, höchstens 3 sind gedeckt`);
    assert.ok(accepted >= 1, "Mindestens ein Gebot musste durchgehen");

    const held = await pool.query<{ held: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS held FROM escrow_hold
        WHERE club_id = $1 AND released_at IS NULL`, [club]);
    assert.ok(held.rows[0]!.held <= 100 * MIO,
      `Es sind ${held.rows[0]!.held} gebunden, verfügbar waren 100 Mio`);

    assert.deepEqual(await checkInvariants(pool), []);
  });

  test("Wechselseitiges Überbieten auf zwei Auktionen erzeugt keinen Deadlock", async () => {
    // Genau das Szenario, gegen das die feste Sperrreihenfolge schützt:
    // zwei Vereine überbieten sich gleichzeitig auf zwei Auktionen.
    const fx = await seed(pool, 2, 2, 400 * MIO);
    const x = fx.clubs[0]!, y = fx.clubs[1]!;
    const first = fx.auctions[0]!, second = fx.auctions[1]!;

    const rounds: Promise<unknown>[] = [];
    for (let i = 1; i <= 15; i++) {
      rounds.push(placeBid(pool, { auctionId: first.id, clubId: x.id, maxAmount: i * 2 * MIO }));
      rounds.push(placeBid(pool, { auctionId: second.id, clubId: y.id, maxAmount: i * 2 * MIO }));
      rounds.push(placeBid(pool, { auctionId: second.id, clubId: x.id, maxAmount: i * 3 * MIO }));
      rounds.push(placeBid(pool, { auctionId: first.id, clubId: y.id, maxAmount: i * 3 * MIO }));
    }
    const settled = await Promise.allSettled(rounds);
    const failures = settled.filter((r) => r.status === "rejected");
    assert.equal(failures.length, 0,
      "Keine Transaktion darf mit einem Fehler abbrechen: " +
      failures.map((f) => String((f as PromiseRejectedResult).reason)).join("; "));

    assert.deepEqual(await checkInvariants(pool), []);
  });

  test("Überbotene Vereine bekommen ihr Geld sofort zurück", async () => {
    const fx = await seed(pool, 2, 1, 400 * MIO);
    const auctionId = fx.auctions[0]!.id;
    const a = fx.clubs[0]!, b = fx.clubs[1]!;

    await placeBid(pool, { auctionId, clubId: a.id, maxAmount: 20 * MIO });
    let held = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM escrow_hold
        WHERE club_id = $1 AND released_at IS NULL`, [a.id]);
    assert.equal(held.rows[0]!.n, 1, "Der Führende muss Geld gebunden haben");

    await placeBid(pool, { auctionId, clubId: b.id, maxAmount: 60 * MIO });
    held = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM escrow_hold
        WHERE club_id = $1 AND released_at IS NULL`, [a.id]);
    assert.equal(held.rows[0]!.n, 0, "Wer überboten wurde, darf kein Geld mehr gebunden haben");
  });
});

describe("Abschluss der Auktion", () => {
  test("Ein freier Agent wechselt sofort und wird korrekt gebucht", async () => {
    const fx = await seed(pool, 2, 1, 400 * MIO);
    const auctionId = fx.auctions[0]!.id;
    const buyer = fx.clubs[0]!.id;

    await placeBid(pool, { auctionId, clubId: buyer, maxAmount: 30 * MIO });
    await pool.query("UPDATE auction SET closes_at = now() - interval '1 minute' WHERE id = $1",
      [auctionId]);

    const result = await settleAuction(pool, auctionId);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.outcome, "sold");

    const player = await pool.query<{ club_id: string }>(
      "SELECT club_id FROM player_instance WHERE id = $1", [fx.auctions[0]!.playerId]);
    assert.equal(player.rows[0]!.club_id, buyer, "Der Spieler muss dem Käufer gehören");

    const cash = await pool.query<{ cash: number }>(
      "SELECT cash FROM club WHERE id = $1", [buyer]);
    const fee = result.ok && result.outcome === "sold" ? result.fee : 0;
    assert.equal(cash.rows[0]!.cash, 400 * MIO - fee, "Die Ablöse muss abgebucht sein");

    const holds = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM escrow_hold
        WHERE auction_id = $1 AND released_at IS NULL`, [auctionId]);
    assert.equal(holds.rows[0]!.n, 0, "Nach dem Abschluss darf nichts mehr gebunden sein");

    assert.deepEqual(await checkInvariants(pool), []);
  });

  test("Ein Soft-Close verhindert den vorzeitigen Abschluss", async () => {
    const fx = await seed(pool, 2, 1, 400 * MIO);
    const auctionId = fx.auctions[0]!.id;

    // Auktion läuft in einer Minute ab, dann kommt ein Gebot
    await pool.query("UPDATE auction SET closes_at = now() + interval '1 minute' WHERE id = $1",
      [auctionId]);
    const bid = await placeBid(pool, {
      auctionId, clubId: fx.clubs[0]!.id, maxAmount: 25 * MIO });
    assert.equal(bid.ok, true);

    const result = await settleAuction(pool, auctionId);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, "still_open");
  });

  test("Ohne Gebot läuft die Auktion aus, ohne etwas zu buchen", async () => {
    const fx = await seed(pool, 2, 1, 400 * MIO);
    const auctionId = fx.auctions[0]!.id;
    await pool.query("UPDATE auction SET closes_at = now() - interval '1 minute' WHERE id = $1",
      [auctionId]);

    const result = await settleAuction(pool, auctionId);
    assert.equal(result.ok && result.outcome, "expired");

    // Nur diese Liga zählen — andere Tests teilen sich dieselbe Datenbank
    const ledger = await pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM ledger_entry WHERE league_id = $1", [fx.leagueId]);
    assert.equal(ledger.rows[0]!.n, 0, "Eine leere Auktion darf nichts buchen");
  });

  test("Gehört der Spieler einem Verein, entscheidet der Verkäufer", async () => {
    const fx = await seed(pool, 3, 1, 400 * MIO);
    const auctionId = fx.auctions[0]!.id;
    const seller = fx.clubs[0]!.id;
    const buyer = fx.clubs[1]!.id;

    await pool.query("UPDATE auction SET seller_club_id = $2 WHERE id = $1", [auctionId, seller]);
    await pool.query("UPDATE player_instance SET club_id = $2 WHERE id = $1",
      [fx.auctions[0]!.playerId, seller]);

    await placeBid(pool, { auctionId, clubId: buyer, maxAmount: 45 * MIO });
    await pool.query("UPDATE auction SET closes_at = now() - interval '1 minute' WHERE id = $1",
      [auctionId]);

    const result = await settleAuction(pool, auctionId);
    assert.equal(result.ok && result.outcome, "awaiting_seller");

    // Die Sperre bleibt bestehen, sonst könnte der Käufer das Geld anderweitig ausgeben
    const holds = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM escrow_hold
        WHERE auction_id = $1 AND released_at IS NULL`, [auctionId]);
    assert.equal(holds.rows[0]!.n, 1, "Bis zur Entscheidung bleibt das Geld gebunden");

    const player = await pool.query<{ club_id: string }>(
      "SELECT club_id FROM player_instance WHERE id = $1", [fx.auctions[0]!.playerId]);
    assert.equal(player.rows[0]!.club_id, seller, "Der Spieler wechselt noch nicht");
  });

  test("Auf den eigenen Spieler wird nicht geboten", async () => {
    const fx = await seed(pool, 2, 1, 400 * MIO);
    const auctionId = fx.auctions[0]!.id;
    const seller = fx.clubs[0]!.id;
    await pool.query("UPDATE auction SET seller_club_id = $2 WHERE id = $1", [auctionId, seller]);

    const result = await placeBid(pool, { auctionId, clubId: seller, maxAmount: 20 * MIO });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, "own_player");
  });
});
