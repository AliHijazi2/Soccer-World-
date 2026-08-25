import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatMoney, formatOrdinal, render, validateTemplates,
} from "../src/text/engine.ts";
import {
  FEED_PLACEHOLDERS, FEED_TEMPLATES, FEED_WORDS,
} from "../src/text/feed.de.ts";
import {
  TICKER_PLACEHOLDERS, TICKER_TEMPLATES, TICKER_WORDS,
} from "../src/text/ticker.de.ts";
import {
  clubFeed, matchFeed, selectFeed, type ClubSnapshot, type FeedCandidate,
} from "../src/rules/feed.ts";

const TEMPLATES = { greet: ["Hallo {name}!"], money: ["{fee:money}"] };

test("Platzhalter werden aus der Nutzlast gefüllt", () => {
  assert.equal(render("greet", { name: "Marco" }, { templates: TEMPLATES }), "Hallo Marco!");
});

test("Ein fehlender Schlüssel wird sichtbar, nicht still verschluckt", () => {
  // Eine leere Zeile ließe einen den Fehler in der Datenbank suchen
  assert.equal(render("gibt_es_nicht", {}, { templates: TEMPLATES }), "[gibt_es_nicht]");
});

test("Geldbeträge werden einheitlich formatiert", () => {
  assert.equal(formatMoney(148_000_000), "148 Mio");
  assert.equal(formatMoney(51_500_000), "51,5 Mio");
  assert.equal(formatMoney(-4_200_000), "-4,2 Mio");
  assert.equal(formatMoney(250_000), "250k");
  assert.equal(formatMoney(-12), "-12");
});

test("Ordnungszahlen werden ausgeschrieben", () => {
  assert.equal(formatOrdinal(1), "Erster");
  assert.equal(formatOrdinal(3), "Dritter");
  assert.equal(formatOrdinal(99), "99.");
});

test("Derselbe Seed ergibt denselben Satz", () => {
  const many = { templates: { k: ["a {x}", "b {x}", "c {x}", "d {x}"] } };
  const first = render("k", { x: 1 }, { ...many, seed: 4242 });
  const second = render("k", { x: 1 }, { ...many, seed: 4242 });
  assert.equal(first, second);
});

test("Verschiedene Seeds nutzen verschiedene Varianten", () => {
  const many = { templates: { k: ["a", "b", "c", "d", "e"] } };
  const seen = new Set(
    Array.from({ length: 60 }, (_, i) => render("k", {}, { ...many, seed: i * 7919 })));
  assert.ok(seen.size >= 3, `nur ${seen.size} Varianten genutzt`);
});

test("Optionale Platzhalter verschwinden rückstandslos", () => {
  const t = { templates: { k: ["Start {#extra} Ende"] } };
  assert.equal(render("k", {}, t), "Start Ende");
  assert.equal(render("k", { extra: "Mitte" }, t), "Start Mitte Ende");
});

test("Fehlende Pflichtplatzhalter bleiben stehen statt zu verschwinden", () => {
  const t = { templates: { k: ["Hallo {name}"] } };
  assert.equal(render("k", {}, t), "Hallo {name}");
});

test("Alle Ticker-Templates sind gültig", () => {
  const problems = validateTemplates(TICKER_TEMPLATES, TICKER_WORDS, TICKER_PLACEHOLDERS);
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("Alle Feed-Templates sind gültig", () => {
  const problems = validateTemplates(FEED_TEMPLATES, FEED_WORDS, FEED_PLACEHOLDERS);
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("Es gibt genug Varianten, damit sich nichts abnutzt", () => {
  const all = { ...TICKER_TEMPLATES, ...FEED_TEMPLATES };
  const total = Object.values(all).flat().length;
  assert.ok(total >= 100, `nur ${total} Templates, das Design nennt 100 bis 150`);
  for (const [key, variants] of Object.entries(all)) {
    assert.ok(variants.length >= 3, `${key} hat nur ${variants.length} Varianten`);
  }
});

test("Kein Template enthält einen unaufgelösten Platzhalter im Ergebnis", () => {
  const payload = {
    player: "Kane", assist: "Musiala", keeper: "Neuer", club: "FC Test",
    winner: "A", loser: "B", minute: 42, home: 3, away: 1, fee: 40_000_000,
    pct: 120, value: 30_000_000, cash: -1_000_000, mood: 42, fans: 300_000,
    count: 4, rank: 2, delta: -0.5, matchdays: 3, wages: 40_000_000,
    bidders: 3, points: 41, goals: 37, loss: 20_000_000,
  };
  for (const [templates, words] of [
    [TICKER_TEMPLATES, TICKER_WORDS], [FEED_TEMPLATES, FEED_WORDS],
  ] as const) {
    for (const key of Object.keys(templates)) {
      for (let seed = 0; seed < 12; seed++) {
        const text = render(key, payload, { templates, words, seed: seed * 1013 });
        assert.ok(!text.includes("{"), `${key} (Seed ${seed}): "${text}"`);
        assert.ok(text.length > 3, `${key} liefert zu wenig Text: "${text}"`);
      }
    }
  }
});

// ── Feed-Regeln ───────────────────────────────────────────────────────────

test("Bei einem Kantersieg stehen Sieger und Tore in derselben Reihenfolge", () => {
  // Ein Auswärtssieg 1:4 darf nicht als "Gast schlägt Heim 1:4" erscheinen
  const items = matchFeed({
    homeName: "Heim", awayName: "Gast", homeGoals: 1, awayGoals: 4,
    homeExpectedPpg: 1.4, awayExpectedPpg: 1.4,
  });
  const thrashing = items.find((item) => item.templateKey === "match.thrashing");
  assert.ok(thrashing);
  assert.equal(thrashing.payload.winner, "Gast");
  assert.equal(thrashing.payload.home, 4, "Die erste Zahl gehört zum Sieger");
  assert.equal(thrashing.payload.away, 1);
});

test("Eine Überraschung braucht einen echten Erwartungsunterschied", () => {
  const even = matchFeed({
    homeName: "A", awayName: "B", homeGoals: 2, awayGoals: 1,
    homeExpectedPpg: 1.4, awayExpectedPpg: 1.4,
  });
  assert.ok(!even.some((i) => i.templateKey === "match.upset"));

  const upset = matchFeed({
    homeName: "A", awayName: "B", homeGoals: 2, awayGoals: 1,
    homeExpectedPpg: 0.9, awayExpectedPpg: 2.0,
  });
  assert.ok(upset.some((i) => i.templateKey === "match.upset"));
});

const club: ClubSnapshot = {
  clubId: "c1", name: "Test FC", isBot: false, rank: 2, points: 20, played: 14,
  expectedPpg: 1.4, fanMood: 65, fanCount: 350_000, cash: 100_000_000,
  winStreak: 0, lossStreak: 0, tiredPlayers: 2, injuredPlayers: 1,
  squadSize: 16, squadValue: 400_000_000,
};

test("Erschöpfung wird am Kaderanteil gemessen, nicht an einer festen Zahl", () => {
  // Sonst ist die Meldung am Saisonende immer erfüllt und damit wertlos
  const few = clubFeed({ ...club, tiredPlayers: 5, squadSize: 16 }, 10);
  assert.ok(!few.some((i) => i.templateKey === "squad.tired"));
  const many = clubFeed({ ...club, tiredPlayers: 13, squadSize: 16 }, 10);
  assert.ok(many.some((i) => i.templateKey === "squad.tired"));
});

test("Der Bot bekommt keine Fan- oder Wirtschaftsmeldungen", () => {
  const bot = clubFeed({ ...club, isBot: true, fanMood: 10, cash: -5_000_000 }, 10);
  assert.ok(!bot.some((i) => i.templateKey.startsWith("fans.")));
  assert.ok(!bot.some((i) => i.templateKey === "club.broke"));
});

test("Ein führender Bot ist eine Schlagzeile", () => {
  const bot = clubFeed({ ...club, isBot: true, rank: 1 }, 10);
  const item = bot.find((i) => i.templateKey === "bot.leading");
  assert.ok(item);
  assert.equal(item.importance, 3);
});

test("Die Erwartungsdifferenz zählt erst nach genug Spielen", () => {
  const early = clubFeed({ ...club, played: 4, points: 1, expectedPpg: 2.0 }, 4);
  assert.ok(!early.some((i) => i.templateKey === "expectation.missed"));
  const late = clubFeed({ ...club, played: 14, points: 8, expectedPpg: 2.0 }, 14);
  assert.ok(late.some((i) => i.templateKey === "expectation.missed"));
});

test("Sperrfristen verhindern Wiederholungen", () => {
  const candidates: FeedCandidate[] = [
    { templateKey: "fans.protest", payload: {}, subjectClubId: "c1",
      importance: 2, cooldownMatchdays: 4 },
  ];
  const lastSeen = new Map([["fans.protest:c1", 10]]);
  assert.equal(selectFeed(candidates, lastSeen, 12).length, 0, "innerhalb der Frist");
  assert.equal(selectFeed(candidates, lastSeen, 15).length, 1, "nach der Frist");
});

test("Wichtige Meldungen verdrängen unwichtige", () => {
  const candidates: FeedCandidate[] = Array.from({ length: 12 }, (_, i) => ({
    templateKey: `k${i}`, payload: {}, importance: i % 3 + 1, cooldownMatchdays: 0,
  }));
  const selected = selectFeed(candidates, new Map(), 5, 4);
  assert.equal(selected.length, 4);
  assert.ok(selected.every((item) => item.importance === 3),
    "Bei Platzmangel müssen die Schlagzeilen gewinnen");
});
