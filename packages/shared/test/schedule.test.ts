import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SEASON, generateFixtures, marketCloseAt, matchdaySlot, planKickoffs, zonedTimeToUtc,
} from "../src/rules/schedule.ts";

test("Ungerade Vereinszahl wird abgelehnt statt still verarbeitet", () => {
  assert.throws(() => generateFixtures(3), /Bot-Verein/);
  assert.throws(() => generateFixtures(5), /Bot-Verein/);
});

test("Jede gerade Vereinszahl ergibt genau 21 Spieltage", () => {
  for (const clubs of [2, 4, 6, 8]) {
    const fixtures = generateFixtures(clubs);
    const matchdays = new Set(fixtures.map((f) => f.matchday));
    assert.equal(matchdays.size, SEASON.MATCHDAYS);
    assert.equal(fixtures.length, SEASON.MATCHDAYS * (clubs / 2));
  }
});

test("An einem Spieltag spielt kein Verein zweimal", () => {
  for (const clubs of [4, 6, 8]) {
    const fixtures = generateFixtures(clubs);
    for (let matchday = 1; matchday <= SEASON.MATCHDAYS; matchday++) {
      const playing = fixtures.filter((f) => f.matchday === matchday);
      const involved = playing.flatMap((f) => [f.homeIndex, f.awayIndex]);
      assert.equal(new Set(involved).size, involved.length,
        `Spieltag ${matchday} bei ${clubs} Vereinen: ein Verein doppelt`);
      assert.equal(involved.length, clubs, "Alle Vereine müssen antreten");
    }
  }
});

test("Kein Verein spielt gegen sich selbst", () => {
  for (const clubs of [4, 6, 8]) {
    for (const f of generateFixtures(clubs)) {
      assert.notEqual(f.homeIndex, f.awayIndex);
    }
  }
});

test("Bei 4 und 8 Vereinen hat jeder gleich viele Spiele", () => {
  // 21 geht durch 3 (bei 4 Vereinen) und durch 7 (bei 8) glatt auf
  for (const clubs of [4, 8]) {
    const fixtures = generateFixtures(clubs);
    const counts = new Array(clubs).fill(0);
    for (const f of fixtures) { counts[f.homeIndex]++; counts[f.awayIndex]++; }
    assert.deepEqual(new Set(counts), new Set([SEASON.MATCHDAYS]),
      `${clubs} Vereine: ungleiche Spielanzahl ${counts.join(",")}`);
  }
});

test("Bei 6 Vereinen weicht die Spielanzahl um höchstens eins ab", () => {
  // 21 durch 5 geht nicht auf — die letzte Runde bleibt unvollständig (GDD §9.1)
  const fixtures = generateFixtures(6);
  const counts = new Array(6).fill(0);
  for (const f of fixtures) { counts[f.homeIndex]++; counts[f.awayIndex]++; }
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1,
    `Spielanzahl zu ungleich: ${counts.join(",")}`);
});

test("Heimspiele sind einigermaßen gleich verteilt", () => {
  for (const clubs of [4, 6, 8]) {
    const fixtures = generateFixtures(clubs);
    const home = new Array(clubs).fill(0);
    for (const f of fixtures) home[f.homeIndex]++;
    const spread = Math.max(...home) - Math.min(...home);
    assert.ok(spread <= 3,
      `${clubs} Vereine: Heimspiele ${home.join(",")} — Spanne ${spread}`);
  }
});

test("Jede Paarung kommt über die Saison etwa gleich oft vor", () => {
  const fixtures = generateFixtures(4);
  const pairings = new Map<string, number>();
  for (const f of fixtures) {
    const key = [f.homeIndex, f.awayIndex].sort().join("-");
    pairings.set(key, (pairings.get(key) ?? 0) + 1);
  }
  const counts = [...pairings.values()];
  assert.equal(pairings.size, 6, "Bei 4 Vereinen gibt es 6 Paarungen");
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1,
    `Paarungen ungleich verteilt: ${counts.join(",")}`);
});

test("Spieltage verteilen sich auf drei Anstöße pro Tag", () => {
  assert.deepEqual(matchdaySlot(1), { matchday: 1, day: 0, slot: 0 });
  assert.deepEqual(matchdaySlot(3), { matchday: 3, day: 0, slot: 2 });
  assert.deepEqual(matchdaySlot(4), { matchday: 4, day: 1, slot: 0 });
  assert.deepEqual(matchdaySlot(21), { matchday: 21, day: 6, slot: 2 });
});

test("Eine Saison passt in genau sieben Tage", () => {
  assert.equal(matchdaySlot(SEASON.MATCHDAYS).day, 6);
});

// ── Zeitzonen ─────────────────────────────────────────────────────────────

test("Lokale Zeit wird korrekt nach UTC umgerechnet", () => {
  // Winterzeit: Berlin ist UTC+1
  const winter = zonedTimeToUtc(2026, 1, 15, 20, 0, "Europe/Berlin");
  assert.equal(winter.toISOString(), "2026-01-15T19:00:00.000Z");
  // Sommerzeit: Berlin ist UTC+2
  const summer = zonedTimeToUtc(2026, 7, 15, 20, 0, "Europe/Berlin");
  assert.equal(summer.toISOString(), "2026-07-15T18:00:00.000Z");
});

test("Über die Zeitumstellung bleibt der Anstoß auf 20 Uhr Ortszeit", () => {
  // Umstellung auf Sommerzeit in Europa: 29. März 2026
  const start = { year: 2026, month: 3, day: 27 };
  const plans = planKickoffs(start, ["17:00", "20:00", "22:00"], "Europe/Berlin");

  const formatter = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  for (const plan of plans) {
    const local = formatter.format(plan.kickoffAt);
    const expected = ["17:00", "20:00", "22:00"][matchdaySlot(plan.matchday).slot];
    assert.equal(local, expected,
      `Spieltag ${plan.matchday} startet um ${local} statt ${expected} Ortszeit`);
  }
});

test("Die Anstöße laufen streng chronologisch", () => {
  const plans = planKickoffs(
    { year: 2026, month: 3, day: 27 }, ["17:00", "20:00", "22:00"], "Europe/Berlin");
  assert.equal(plans.length, SEASON.MATCHDAYS);
  for (let i = 1; i < plans.length; i++) {
    assert.ok(plans[i]!.kickoffAt > plans[i - 1]!.kickoffAt,
      `Spieltag ${i + 1} liegt nicht nach Spieltag ${i}`);
  }
});

test("Der Marktabschluss liegt am selben Tag vor dem ersten Anstoß", () => {
  const plans = planKickoffs(
    { year: 2026, month: 5, day: 4 }, ["17:00", "20:00", "22:00"], "Europe/Berlin");
  for (const plan of plans) {
    const close = marketCloseAt(plan.kickoffAt, "16:00", "Europe/Berlin");
    assert.ok(close < plan.kickoffAt,
      `Marktabschluss von Spieltag ${plan.matchday} liegt nach dem Anstoß`);
    assert.ok(plan.kickoffAt.getTime() - close.getTime() <= 7 * 3600 * 1000,
      "Marktabschluss darf nicht mehr als sieben Stunden vor dem Anstoß liegen");
  }
});

test("Falsche Anzahl Anstoßzeiten wird abgelehnt", () => {
  assert.throws(
    () => planKickoffs({ year: 2026, month: 5, day: 4 }, ["17:00"], "Europe/Berlin"),
    /genau 3/);
});
