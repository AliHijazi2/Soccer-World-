import { test } from "node:test";
import assert from "node:assert/strict";

import { createRng } from "../src/rules/rng.ts";
import { EVENTS, EVENTS_BY_KEY } from "../src/rules/events/definitions.ts";
import {
  effectiveWeight, eventsForDay, isDeliveryMatchday, selectEvents,
} from "../src/rules/events/selection.ts";
import {
  hasDecision, worstCashLoss, type EventContext, type Effect,
} from "../src/rules/events/types.ts";
import { render, validateTemplates } from "../src/text/engine.ts";
import { EVENT_TEMPLATES } from "../src/text/events.de.ts";

const context: EventContext = {
  rank: 2, clubCount: 4, cash: 300_000_000, fanMood: 60, stadiumCondition: 95,
  winStreak: 0, lossStreak: 0, expectationDelta: 0,
  squadSize: 16, injuredPlayers: 1, matchday: 10,
};

test("Es gibt zwanzig Ereignisse", () => {
  assert.equal(EVENTS.length, 20);
  assert.equal(new Set(EVENTS.map((e) => e.key)).size, 20, "Doppelte Schlüssel");
});

test("Mindestens 70 Prozent bieten eine echte Entscheidung", () => {
  const share = EVENTS.filter(hasDecision).length / EVENTS.length;
  assert.ok(share >= 0.7, `nur ${Math.round(share * 100)} % mit Entscheidung`);
});

test("Die Kategorieverteilung entspricht dem Design", () => {
  const target = { squad: 30, economy: 20, fans: 15, stadium: 10, market: 15, tabloid: 10 };
  const weights = new Map<string, number>();
  let total = 0;
  for (const event of EVENTS) {
    weights.set(event.category, (weights.get(event.category) ?? 0) + event.weight);
    total += event.weight;
  }
  for (const [category, expected] of Object.entries(target)) {
    const actual = Math.round((weights.get(category) ?? 0) / total * 100);
    assert.equal(actual, expected, `${category}: ${actual} % statt ${expected} %`);
  }
});

test("Keine Option dominiert alle anderen", () => {
  // Die richtige Frage ist nicht "hat diese Option einen Nachteil", sondern
  // "ist sie in jeder Hinsicht mindestens so gut wie alle anderen". Verzicht
  // auf Geld ist ein echter Preis, auch wenn er nirgends als Minus steht —
  // eine Option ohne expliziten Nachteil kann trotzdem eine Entscheidung sein.
  interface Profile {
    cash: number; mood: number; subject: number; squad: number;
    value: number; available: number;
  }

  const profile = (effects: readonly Effect[], weight = 1): Profile => {
    const sum: Profile = { cash: 0, mood: 0, subject: 0, squad: 0, value: 0, available: 0 };
    for (const effect of effects) {
      switch (effect.kind) {
        case "cash":
          sum.cash += (effect.amount ?? (effect.shareOfCash ?? 0) * 100_000_000) * weight;
          break;
        case "mood": sum.mood += effect.delta * weight; break;
        case "fans": sum.mood += effect.sharePercent * weight; break;
        case "morale":
          if (effect.target === "subject") sum.subject += effect.delta * weight;
          else sum.squad += effect.delta * weight;
          break;
        case "fitness": sum.available += effect.delta * weight; break;
        case "wage": sum.cash -= (effect.factor - 1) * 8_000_000 * weight; break;
        case "marketValue": sum.value += (effect.factor - 1) * 100 * weight; break;
        case "injury": sum.available -= effect.matchdays * 5 * weight; break;
        case "trait": sum.subject -= 5 * weight; break;
        case "stadiumCondition": sum.mood += effect.delta * 0.5 * weight; break;
        case "chance": {
          const win = profile(effect.then, weight * effect.probability);
          const lose = profile(effect.otherwise, weight * (1 - effect.probability));
          for (const field of Object.keys(sum) as (keyof Profile)[]) {
            sum[field] += win[field] + lose[field];
          }
          break;
        }
      }
    }
    return sum;
  };

  const dominates = (a: Profile, b: Profile): boolean => {
    const fields = Object.keys(a) as (keyof Profile)[];
    return fields.every((field) => a[field] >= b[field] - 0.001) &&
           fields.some((field) => a[field] > b[field] + 0.001);
  };

  for (const event of EVENTS) {
    if (!hasDecision(event)) continue;
    const profiles = event.options.map((option) => profile(option.effects));
    for (const [index, own] of profiles.entries()) {
      const dominatesAll = profiles.every((other, j) => j === index || dominates(own, other));
      assert.ok(!dominatesAll,
        `${event.key}: Option "${event.options[index]!.key}" ist in jeder Hinsicht ` +
        "besser als alle anderen und damit keine Entscheidung");
    }
  }
});

test("Jedes Ereignis hat eine gültige Standardoption", () => {
  for (const event of EVENTS) {
    if (event.options.length === 0) {
      assert.equal(event.defaultOption, 0, `${event.key}: reine Meldung`);
    } else {
      assert.ok(event.defaultOption < event.options.length,
        `${event.key}: Standardoption ${event.defaultOption} existiert nicht`);
    }
  }
});

test("Kein Ereignis kann einen Verein ruinieren", () => {
  // GDD §10.7: höchstens 8 Prozent des Vermögens auf einen Schlag
  const cash = 100_000_000;
  for (const event of EVENTS) {
    for (const option of event.options) {
      const loss = worstCashLoss(option.effects, cash);
      assert.ok(Math.abs(loss) <= cash * 0.08,
        `${event.key}/${option.key}: ${Math.abs(loss)} von ${cash} — über der Grenze`);
    }
  }
});

test("Alle Sperrfristen sind gesetzt", () => {
  for (const event of EVENTS) {
    assert.ok(event.cooldownMatchdays >= 5,
      `${event.key}: Sperrfrist ${event.cooldownMatchdays} ist zu kurz`);
  }
});

test("Erfolg zieht Forderungen und Abwerbeversuche an", () => {
  // Getarntes Rubberbanding aus §10.5 — es trifft das Umfeld, nie das Spiel
  const leader = { ...context, rank: 1, expectationDelta: +0.5, winStreak: 4 };
  const trailer = { ...context, rank: 4, expectationDelta: -0.5, lossStreak: 4 };

  for (const key of ["squad.contract_demand", "market.poach_offer"]) {
    const definition = EVENTS_BY_KEY.get(key)!;
    assert.ok(effectiveWeight(definition, leader) > effectiveWeight(definition, trailer),
      `${key} müsste den Führenden häufiger treffen`);
  }
});

test("Wer hinten liegt, bekommt mehr Gelegenheiten", () => {
  const leader = { ...context, rank: 1 };
  const trailer = { ...context, rank: 4 };
  const sponsor = EVENTS_BY_KEY.get("economy.sponsor_offer")!;
  assert.ok(effectiveWeight(sponsor, trailer) > effectiveWeight(sponsor, leader));

  const loyalty = EVENTS_BY_KEY.get("fans.loyalty_action")!;
  assert.ok(
    effectiveWeight(loyalty, { ...context, lossStreak: 4 }) >
    effectiveWeight(loyalty, { ...context, lossStreak: 0 }),
    "Nach einer Niederlagenserie sollen die Fans zusammenrücken");
});

test("Ein armer Verein bekommt keine Steuernachzahlung", () => {
  const tax = EVENTS_BY_KEY.get("economy.tax_bill")!;
  assert.equal(effectiveWeight(tax, { ...context, cash: 1_000_000 }), 0);
  assert.ok(effectiveWeight(tax, { ...context, cash: 100_000_000 }) > 0);
});

test("Sperrfristen schließen Ereignisse aus der Auswahl aus", () => {
  const rng = createRng(1);
  const lastSeen = new Map(EVENTS.map((event) => [event.key, context.matchday - 1]));
  assert.equal(selectEvents(EVENTS, context, lastSeen, rng, 2).length, 0);
  assert.ok(selectEvents(EVENTS, context, new Map(), rng, 2).length > 0);
});

test("An einem Tag kommt nie zweimal dieselbe Kategorie", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const chosen = selectEvents(EVENTS, context, new Map(), createRng(seed), 2);
    const categories = chosen.map((event) => event.category);
    assert.equal(new Set(categories).size, categories.length,
      `Seed ${seed}: ${categories.join(", ")}`);
  }
});

test("Ein bis zwei Ereignisse pro Tag", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const count = eventsForDay(createRng(seed));
    assert.ok(count >= 1 && count <= 2, `${count} Ereignisse`);
  }
});

test("Ereignisse kommen nur zum Tagesbeginn", () => {
  // Bei drei Anstößen täglich wären es sonst über dreißig pro Woche
  assert.equal(isDeliveryMatchday(1), true);
  assert.equal(isDeliveryMatchday(2), false);
  assert.equal(isDeliveryMatchday(3), false);
  assert.equal(isDeliveryMatchday(4), true);
  const days = Array.from({ length: 21 }, (_, i) => isDeliveryMatchday(i + 1))
    .filter(Boolean).length;
  assert.equal(days, 7, "Genau sieben Zustelltage pro Saison");
});

test("Jedes Ereignis hat Titel, Beschreibung und Optionstexte", () => {
  for (const event of EVENTS) {
    assert.ok(EVENT_TEMPLATES[`${event.key}.title`], `${event.key}: Titel fehlt`);
    assert.ok(EVENT_TEMPLATES[`${event.key}.body`], `${event.key}: Beschreibung fehlt`);
    for (const option of event.options) {
      assert.ok(EVENT_TEMPLATES[`${event.key}.${option.key}`],
        `${event.key}: Text für Option "${option.key}" fehlt`);
    }
  }
});

test("Kein Ereignistext lässt einen Platzhalter stehen", () => {
  const payload = { player: "Kane", rival: "Marco FC", matchdays: 4, amount: 2_400_000 };
  for (const key of Object.keys(EVENT_TEMPLATES)) {
    for (let seed = 0; seed < 6; seed++) {
      const text = render(key, payload, { templates: EVENT_TEMPLATES, seed: seed * 977 });
      assert.ok(!text.includes("{"), `${key}: "${text}"`);
      assert.ok(text.length > 5, `${key} liefert zu wenig Text`);
    }
  }
});

test("Die Ereignistexte sind formal gültig", () => {
  assert.deepEqual(validateTemplates(EVENT_TEMPLATES, {}, {}), []);
});
