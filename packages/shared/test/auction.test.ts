import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AUCTION, applySoftClose, checkBid, minIncrement, minimumNextBid,
  resolveAuction, type ProxyBid,
} from "../src/rules/auction/rules.ts";

const MIN_PRICE = 1_000_000;

test("Mindestschritt ist der größere aus Sockel und Prozentsatz", () => {
  assert.equal(minIncrement(1_000_000), 250_000);   // 3 % wären 30.000
  assert.equal(minIncrement(50_000_000), 1_500_000); // 3 % schlagen den Sockel
  assert.ok(minIncrement(100_000_000) >= 3_000_000);
});

test("Erstes Gebot muss den Mindestpreis erreichen", () => {
  assert.equal(minimumNextBid(null, 40_000_000), 40_000_000);
  assert.equal(minimumNextBid(40_000_000, 40_000_000), 40_000_000 + minIncrement(40_000_000));
});

test("Ohne Gebote steht die Auktion beim Mindestpreis", () => {
  const state = resolveAuction([], MIN_PRICE);
  assert.equal(state.leaderClubId, null);
  assert.equal(state.displayPrice, MIN_PRICE);
});

test("Ein einzelner Bieter zahlt nicht sein Maximum", () => {
  const state = resolveAuction([{ clubId: "A", maxAmount: 80_000_000, placedAt: 1 }], MIN_PRICE);
  assert.equal(state.leaderClubId, "A");
  assert.ok(state.displayPrice < 80_000_000,
    "Ohne Gegengebot darf niemand sein Maximum zahlen");
});

test("Das höhere Maximum führt, unabhängig vom Eingangszeitpunkt", () => {
  const early: ProxyBid = { clubId: "A", maxAmount: 30_000_000, placedAt: 1 };
  const late: ProxyBid = { clubId: "B", maxAmount: 55_000_000, placedAt: 99 };
  assert.equal(resolveAuction([early, late], MIN_PRICE).leaderClubId, "B");
  assert.equal(resolveAuction([late, early], MIN_PRICE).leaderClubId, "B");
});

test("Der Führende zahlt einen Schritt über dem zweithöchsten Maximum", () => {
  const state = resolveAuction([
    { clubId: "A", maxAmount: 90_000_000, placedAt: 1 },
    { clubId: "B", maxAmount: 60_000_000, placedAt: 2 },
  ], MIN_PRICE);
  assert.equal(state.leaderClubId, "A");
  assert.equal(state.displayPrice, 60_000_000 + minIncrement(60_000_000));
  assert.ok(state.displayPrice < 90_000_000);
});

test("Bei gleichem Maximum gewinnt das frühere Gebot", () => {
  const a: ProxyBid = { clubId: "A", maxAmount: 50_000_000, placedAt: 10 };
  const b: ProxyBid = { clubId: "B", maxAmount: 50_000_000, placedAt: 20 };
  assert.equal(resolveAuction([a, b], MIN_PRICE).leaderClubId, "A");
  assert.equal(resolveAuction([b, a], MIN_PRICE).leaderClubId, "A");
});

test("Der Preis übersteigt nie das Maximum des Führenden", () => {
  for (let leaderMax = 5_000_000; leaderMax <= 150_000_000; leaderMax += 5_000_000) {
    for (let rivalMax = 1_000_000; rivalMax < leaderMax; rivalMax += 7_000_000) {
      const state = resolveAuction([
        { clubId: "A", maxAmount: leaderMax, placedAt: 1 },
        { clubId: "B", maxAmount: rivalMax, placedAt: 2 },
      ], MIN_PRICE);
      assert.ok(state.displayPrice <= leaderMax,
        `Preis ${state.displayPrice} über Maximum ${leaderMax}`);
    }
  }
});

test("Das Ergebnis ist unabhängig von der Reihenfolge der Gebote", () => {
  // Das ist die zentrale Eigenschaft für asynchrones Bieten: Wer zuerst klickt,
  // darf keinen Vorteil haben — sonst gewinnt, wer zufällig wach ist.
  const bids: ProxyBid[] = [
    { clubId: "A", maxAmount: 42_000_000, placedAt: 1 },
    { clubId: "B", maxAmount: 71_000_000, placedAt: 2 },
    { clubId: "C", maxAmount: 68_500_000, placedAt: 3 },
    { clubId: "D", maxAmount: 12_000_000, placedAt: 4 },
  ];
  const expected = resolveAuction(bids, MIN_PRICE);

  const permute = <T,>(items: T[]): T[][] =>
    items.length <= 1 ? [items] : items.flatMap((item, i) =>
      permute([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));

  for (const order of permute(bids)) {
    const state = resolveAuction(order, MIN_PRICE);
    assert.equal(state.leaderClubId, expected.leaderClubId);
    assert.equal(state.displayPrice, expected.displayPrice);
  }
});

test("Ein Verein, der mehrfach bietet, zählt nur mit seinem höchsten Maximum", () => {
  const state = resolveAuction([
    { clubId: "A", maxAmount: 20_000_000, placedAt: 1 },
    { clubId: "A", maxAmount: 90_000_000, placedAt: 2 },
    { clubId: "B", maxAmount: 55_000_000, placedAt: 3 },
  ], MIN_PRICE);
  assert.equal(state.leaderClubId, "A");
  assert.equal(state.displayPrice, 55_000_000 + minIncrement(55_000_000));
});

// ── Gebotsprüfung ─────────────────────────────────────────────────────────

const base = {
  status: "open", closesAt: 10_000, minPrice: 1_000_000,
  currentBid: 10_000_000, currentLeaderClubId: "B", sellerClubId: "S",
  bidderClubId: "A", availableFunds: 500_000_000,
  amount: 20_000_000, now: 0,
};

test("Ein gültiges Gebot wird angenommen", () => {
  assert.equal(checkBid(base), null);
});

test("Nach Ablauf wird nicht mehr geboten", () => {
  assert.equal(checkBid({ ...base, now: 10_000 }), "auction_closed");
  assert.equal(checkBid({ ...base, status: "awaiting_seller" }), "auction_closed");
});

test("Unter dem Mindestschritt wird abgelehnt", () => {
  assert.equal(checkBid({ ...base, amount: 10_100_000 }), "below_minimum");
});

test("Ungedeckte Gebote werden abgelehnt — geprüft wird gegen das Maximum", () => {
  assert.equal(checkBid({ ...base, availableFunds: 19_999_999 }), "insufficient_funds");
  assert.equal(checkBid({ ...base, availableFunds: 20_000_000 }), null);
});

test("Auf eigene Spieler und als Führender wird nicht geboten", () => {
  assert.equal(checkBid({ ...base, bidderClubId: "S" }), "own_player");
  assert.equal(checkBid({ ...base, bidderClubId: "B" }), "already_leading");
});

// ── Soft-Close ────────────────────────────────────────────────────────────

test("Soft-Close verlängert nur innerhalb des Fensters", () => {
  const closesAt = 1_000_000;
  const early = closesAt - AUCTION.SOFT_CLOSE_WINDOW_MS - 1;
  assert.equal(applySoftClose(closesAt, early), closesAt);

  const late = closesAt - 30_000;
  assert.equal(applySoftClose(closesAt, late), late + AUCTION.SOFT_CLOSE_EXTENSION_MS);
});

test("Wiederholte Gebote kurz vor Schluss verlängern immer weiter", () => {
  let closesAt = 1_000_000;
  let now = closesAt - 60_000;
  for (let i = 0; i < 10; i++) {
    closesAt = applySoftClose(closesAt, now);
    assert.ok(closesAt > now, "Auktion darf durch ein Gebot nie sofort enden");
    now = closesAt - 30_000;
  }
  assert.ok(closesAt > 1_000_000 + 9 * AUCTION.SOFT_CLOSE_EXTENSION_MS * 0.4,
    "Zehn Gebote am Ende müssen die Auktion deutlich verlängert haben");
});
