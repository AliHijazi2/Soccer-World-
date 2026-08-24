import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AVERAGE_POINTS_PER_GAME, expectedPointsPerGame, expectedRank, seasonGoal,
} from "../src/rules/economy/expectations.ts";
import {
  applyMoodChange, fanCountChange, moodChangeAfterMatch, moodZone, occupancy,
} from "../src/rules/economy/fans.ts";
import {
  ECONOMY, matchBonus, merchandise, placementPrize, sponsorTerms,
  ticketIncome, tvBasePerMatchday, tvPerformanceShare, upkeep,
} from "../src/rules/economy/revenue.ts";

const MIO = 1_000_000;

// ── Erwartung ─────────────────────────────────────────────────────────────

test("Ein durchschnittlicher Kader erwartet den Ligadurchschnitt", () => {
  assert.equal(expectedPointsPerGame(400 * MIO, 400 * MIO), AVERAGE_POINTS_PER_GAME);
});

test("Ein teurerer Kader erzeugt eine höhere Erwartung", () => {
  const average = expectedPointsPerGame(400 * MIO, 400 * MIO);
  const rich = expectedPointsPerGame(800 * MIO, 400 * MIO);
  const poor = expectedPointsPerGame(200 * MIO, 400 * MIO);
  assert.ok(rich > average && average > poor);
});

test("Die Erwartung bleibt im mechanisch Erreichbaren", () => {
  // Eine Erwartung über dem, was die Simulation hergibt, wäre keine
  // Herausforderung, sondern eine Falle
  const absurd = expectedPointsPerGame(5000 * MIO, 100 * MIO);
  assert.ok(absurd <= 2.35, `Erwartung ${absurd} ist nicht erreichbar`);
  const tiny = expectedPointsPerGame(1 * MIO, 400 * MIO);
  assert.ok(tiny >= 0.65);
});

test("Der teuerste Kader bekommt das Saisonziel Meisterschaft", () => {
  const values = [900 * MIO, 500 * MIO, 400 * MIO, 200 * MIO];
  assert.equal(expectedRank(values, 0), 1);
  assert.equal(expectedRank(values, 3), 4);
  assert.equal(seasonGoal(1, 4), "title");
  assert.equal(seasonGoal(4, 4), "avoid_last");
});

// ── Fans ──────────────────────────────────────────────────────────────────

test("Dasselbe Ergebnis wirkt je nach Erwartung gegensätzlich", () => {
  // Der Kern der Fanmechanik (GDD §11.2): Ein 1:1 ist für den Favoriten eine
  // Katastrophe und für den Außenseiter ein Fest
  const shared = { points: 1, goalsFor: 1, goalsAgainst: 1, ticketPrice: 40, isHome: true };
  const favourite = moodChangeAfterMatch({ ...shared, expectedPoints: 2.1 });
  const underdog = moodChangeAfterMatch({ ...shared, expectedPoints: 0.8 });

  assert.ok(favourite < -1, `Für den Favoriten muss es wehtun, war ${favourite.toFixed(2)}`);
  assert.ok(underdog > 0, `Für den Außenseiter muss es gut sein, war ${underdog.toFixed(2)}`);
});

test("Ein hoher Sieg wirkt stärker als ein knapper", () => {
  const base = { points: 3, expectedPoints: 1.4, ticketPrice: 40, isHome: true };
  const narrow = moodChangeAfterMatch({ ...base, goalsFor: 1, goalsAgainst: 0 });
  const rout = moodChangeAfterMatch({ ...base, goalsFor: 5, goalsAgainst: 0 });
  assert.ok(rout > narrow);
});

test("Ein hoher Ticketpreis kostet Stimmung", () => {
  const base = { points: 3, expectedPoints: 1.4, goalsFor: 2, goalsAgainst: 0, isHome: true };
  const cheap = moodChangeAfterMatch({ ...base, ticketPrice: 25 });
  const pricey = moodChangeAfterMatch({ ...base, ticketPrice: 70 });
  assert.ok(cheap > pricey, "Billigere Tickets müssen besser für die Stimmung sein");
});

test("Auswärts wirkt der Ticketpreis nicht", () => {
  const base = { points: 1, expectedPoints: 1.4, goalsFor: 1, goalsAgainst: 1, isHome: false };
  assert.equal(
    moodChangeAfterMatch({ ...base, ticketPrice: 25 }),
    moodChangeAfterMatch({ ...base, ticketPrice: 90 }));
});

test("Die Stimmung bleibt zwischen 0 und 100", () => {
  assert.equal(applyMoodChange(98, +50), 100);
  assert.equal(applyMoodChange(3, -50), 0);
});

test("Die Stimmung zieht ohne Ereignisse zur Mitte", () => {
  assert.ok(applyMoodChange(95, 0) < 95, "Hohe Stimmung fällt langsam zurück");
  assert.ok(applyMoodChange(10, 0) > 10, "Niedrige Stimmung erholt sich langsam");
});

test("Die Stimmungszonen entsprechen dem Design", () => {
  assert.equal(moodZone(92), "euphoric");
  assert.equal(moodZone(70), "content");
  assert.equal(moodZone(45), "restless");
  assert.equal(moodZone(20), "hostile");
});

test("Auslastung folgt Stimmung und Preis", () => {
  assert.ok(occupancy(95, 40) > occupancy(70, 40));
  assert.ok(occupancy(70, 40) > occupancy(45, 40));
  assert.ok(occupancy(20, 40) < 0.6, "Feindselige Fans bleiben weg");
  assert.ok(occupancy(70, 80) < occupancy(70, 40), "Teure Tickets leeren das Stadion");
  assert.ok(occupancy(95, 20) <= 1.0, "Auslastung kann 100 % nicht überschreiten");
});

test("Fans wandern bei feindseliger Stimmung ab", () => {
  assert.ok(fanCountChange(350_000, 95) > 0);
  assert.ok(fanCountChange(350_000, 70) > 0);
  assert.ok(fanCountChange(350_000, 45) < 0);
  assert.ok(fanCountChange(350_000, 15) < fanCountChange(350_000, 45));
});

// ── Einnahmen ─────────────────────────────────────────────────────────────

test("Der TV-Sockel macht 60 Prozent aus", () => {
  const season = tvBasePerMatchday() * ECONOMY.MATCHDAYS_PER_SEASON;
  const share = season / ECONOMY.TV_PER_SEASON;
  assert.ok(Math.abs(share - 0.6) < 0.01, `Sockelanteil ist ${(share * 100).toFixed(1)} %`);
});

test("Auch der Tabellenletzte bekommt substanzielles TV-Geld", () => {
  // Der Sockel ist der Grund, warum ein schwacher Verein nicht abstirbt
  const base = tvBasePerMatchday() * ECONOMY.MATCHDAYS_PER_SEASON;
  const last = base + tvPerformanceShare(4, 4, 0.15);
  const first = base + tvPerformanceShare(1, 4, 0.35);
  assert.ok(last > first * 0.5,
    `Der Letzte bekommt ${(last / first * 100).toFixed(0)} % des Ersten — zu wenig`);
});

test("Prämien bleiben flach genug für das Anti-Snowball-Ziel", () => {
  const clubCount = 4;
  const spread = placementPrize(1, clubCount) - placementPrize(clubCount, clubCount);
  // Dazu die Siegprämiendifferenz zwischen einer starken und schwachen Saison
  const bonusSpread = (15 * ECONOMY.WIN_BONUS) - (4 * ECONOMY.WIN_BONUS);
  const totalSpread = spread + bonusSpread;
  const seasonRevenue = 71 * MIO;
  assert.ok(totalSpread / seasonRevenue <= 0.21,
    `Prämienspanne ist ${(totalSpread / seasonRevenue * 100).toFixed(1)} % ` +
    "der Saisoneinnahmen, erlaubt sind 21 % (GDD §19.1)");
});

test("Die Prämienspanne ist unabhängig von der Vereinszahl", () => {
  for (const clubCount of [3, 4, 6, 8]) {
    assert.equal(placementPrize(1, clubCount), ECONOMY.PLACEMENT_TOP);
    assert.equal(placementPrize(clubCount, clubCount), ECONOMY.PLACEMENT_BOTTOM);
  }
});

test("Sieg und Unentschieden werden unterschiedlich belohnt", () => {
  assert.ok(matchBonus(3) > matchBonus(1));
  assert.equal(matchBonus(0), 0);
});

test("Merchandise folgt Fanzahl und Stimmung", () => {
  assert.ok(merchandise(350_000, 95) > merchandise(350_000, 70));
  assert.ok(merchandise(350_000, 70) > merchandise(350_000, 20));
  assert.ok(merchandise(700_000, 70) > merchandise(350_000, 70));
});

test("Ein verfallenes Stadion kostet mehr Unterhalt, nicht weniger", () => {
  assert.ok(upkeep(25_000, 60) > upkeep(25_000, 100));
  assert.ok(upkeep(50_000, 100) > upkeep(25_000, 100));
});

test("Das kontroverse Sponsorangebot zahlt am besten und kostet Stimmung", () => {
  const safe = sponsorTerms("safe");
  const controversial = sponsorTerms("controversial");
  assert.ok(controversial.basePerMatchday > safe.basePerMatchday);
  assert.ok(controversial.moodImmediate < 0 && controversial.moodPerMatchday < 0);
  assert.equal(safe.moodImmediate, 0);
});

test("Ein Referenzverein erreicht die Zielaufteilung aus GDD §13.1", () => {
  // 350.000 Fans, 25.000 Plätze, Stimmung 60, Ticketpreis 40 — der Startzustand
  const matchdays = ECONOMY.MATCHDAYS_PER_SEASON;
  const homeGames = Math.round(matchdays / 2);

  const tv = tvBasePerMatchday() * matchdays + tvPerformanceShare(2, 4, 0.25);
  const sponsors = sponsorTerms("safe").basePerMatchday * matchdays;
  const merch = merchandise(350_000, 60) * matchdays;
  const rate = occupancy(60, 40);
  const tickets = ticketIncome(25_000, rate, 40).income * homeGames;
  const prizes = 8 * ECONOMY.WIN_BONUS + 6 * ECONOMY.DRAW_BONUS + placementPrize(2, 4);

  const total = tv + sponsors + merch + tickets + prizes;
  const costs = upkeep(25_000, 100) * matchdays;

  const inMio = (v: number) => (v / MIO).toFixed(1);
  const detail = `TV ${inMio(tv)} · Sponsoren ${inMio(sponsors)} · Merch ${inMio(merch)} ` +
    `· Tickets ${inMio(tickets)} · Prämien ${inMio(prizes)} = ${inMio(total)} Mio, ` +
    `Betrieb ${inMio(costs)} Mio`;

  assert.ok(total > 55 * MIO && total < 90 * MIO,
    `Saisoneinnahmen liegen bei ${inMio(total)} Mio, Ziel sind rund 71 Mio. ${detail}`);
  assert.ok(costs > 8 * MIO && costs < 18 * MIO,
    `Betriebskosten liegen bei ${inMio(costs)} Mio, Ziel sind rund 12 Mio`);
});
