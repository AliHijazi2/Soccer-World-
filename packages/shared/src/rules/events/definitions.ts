/**
 * Die zwanzig Ereignisse des MVP (GDD §10.2).
 *
 * Verteilung nach Kategorie: Kader 30 %, Wirtschaft 20 %, Fans 15 %,
 * Stadion 10 %, Markt 15 %, Boulevard 10 %.
 *
 * Beim Schreiben galt eine Regel: **Keine Option darf offensichtlich die beste
 * sein.** Wo eine Option nur Vorteile hat, fehlt der Trade-off — und das
 * Ereignis ist dann eine Bestätigungsklick statt einer Entscheidung.
 */

import type { EventDefinition } from "./types.ts";

export const EVENTS: EventDefinition[] = [
  // ── Kader (6) ───────────────────────────────────────────────────────────
  {
    key: "squad.contract_demand",
    category: "squad", subject: "best", weight: 9, cooldownMatchdays: 6,
    defaultOption: 1,
    // Erfolg zieht Forderungen an (GDD §10.5)
    situationalWeight: (c) => 1 + Math.max(0, c.expectationDelta) * 0.8 + (c.winStreak >= 3 ? 0.5 : 0),
    options: [
      { key: "accept", effects: [
        { kind: "morale", target: "subject", delta: +20 },
        { kind: "morale", target: "squad", delta: -4 },   // die anderen wollen jetzt auch
        { kind: "wage", target: "subject", factor: 1.6 },
      ] },
      { key: "negotiate", effects: [
        { kind: "chance", probability: 0.6,
          then: [
            { kind: "wage", target: "subject", factor: 1.3 },
            { kind: "morale", target: "subject", delta: +5 },
          ],
          otherwise: [
            { kind: "morale", target: "subject", delta: -25 },
            { kind: "trait", target: "subject", trait: "mercenary" },
          ] },
      ] },
      { key: "refuse", effects: [
        { kind: "morale", target: "subject", delta: -30 },
        { kind: "mood", delta: -5 },
      ] },
    ],
  },
  {
    key: "squad.dressing_room_row",
    category: "squad", subject: "highest_paid", weight: 7, cooldownMatchdays: 8,
    defaultOption: 2,
    situationalWeight: (c) => 1 + (c.lossStreak >= 2 ? 0.8 : 0),
    options: [
      { key: "back_star", effects: [
        { kind: "morale", target: "subject", delta: +15 },
        { kind: "morale", target: "squad", delta: -8 },
      ] },
      { key: "back_squad", effects: [
        { kind: "morale", target: "subject", delta: -18 },
        { kind: "morale", target: "squad", delta: +8 },
      ] },
      { key: "stay_out", effects: [
        { kind: "morale", target: "squad", delta: -4 },
        { kind: "morale", target: "subject", delta: -4 },
      ] },
    ],
  },
  {
    key: "squad.training_injury",
    category: "squad", subject: "random", weight: 6, cooldownMatchdays: 5,
    defaultOption: 0,
    // Reine Meldung: Gegen eine Trainingsverletzung gibt es nichts zu entscheiden
    options: [],
    situationalWeight: (c) => 1 + (c.injuredPlayers >= 3 ? -0.4 : 0),
  },
  {
    key: "squad.form_surge",
    category: "squad", subject: "random", weight: 5, cooldownMatchdays: 6,
    defaultOption: 1,
    options: [
      { key: "promote", effects: [
        { kind: "morale", target: "subject", delta: +12 },
        { kind: "marketValue", target: "subject", factor: 1.12 },
        { kind: "morale", target: "squad", delta: -3 },
      ] },
      { key: "keep_calm", effects: [
        { kind: "morale", target: "subject", delta: -3 },
        { kind: "morale", target: "squad", delta: +3 },
      ] },
    ],
  },
  {
    key: "squad.veteran_doubt",
    category: "squad", subject: "oldest", weight: 5, cooldownMatchdays: 8,
    defaultOption: 2,
    options: [
      { key: "guarantee_place", effects: [
        { kind: "morale", target: "subject", delta: +18 },
        { kind: "morale", target: "squad", delta: -6 },
        { kind: "mood", delta: +3 },
      ] },
      { key: "offer_farewell", effects: [
        { kind: "morale", target: "subject", delta: -10 },
        { kind: "marketValue", target: "subject", factor: 0.85 },
        { kind: "mood", delta: -6 },
      ] },
      { key: "no_promise", effects: [
        { kind: "morale", target: "subject", delta: -12 },
      ] },
    ],
  },
  {
    key: "squad.youngster_pushes",
    category: "squad", subject: "youngest", weight: 4, cooldownMatchdays: 7,
    defaultOption: 2,
    options: [
      { key: "give_minutes", effects: [
        { kind: "morale", target: "subject", delta: +15 },
        { kind: "marketValue", target: "subject", factor: 1.10 },
        { kind: "morale", target: "squad", delta: -4 },
      ] },
      { key: "loan_out", effects: [
        { kind: "cash", amount: 400_000 },
        { kind: "morale", target: "subject", delta: +5 },
        { kind: "marketValue", target: "subject", factor: 1.05 },
        // Der Nachteil ist der Spieler selbst: Er steht acht Spieltage nicht
        // zur Verfügung. Bei 21 Spieltagen in sieben Tagen und Fitness als
        // härtester Grenze ist ein fehlender Mann ein echter Preis.
        { kind: "injury", target: "subject", matchdays: 8 },
      ] },
      { key: "wait", effects: [
        { kind: "morale", target: "subject", delta: -14 },
        { kind: "marketValue", target: "subject", factor: 0.95 },
      ] },
    ],
  },

  // ── Wirtschaft (4) ──────────────────────────────────────────────────────
  {
    key: "economy.sponsor_offer",
    category: "economy", subject: null, weight: 8, cooldownMatchdays: 7,
    defaultOption: 2,
    // Wer hinten liegt, bekommt eher ein Angebot (GDD §10.5)
    situationalWeight: (c) => 1 + (c.rank > c.clubCount / 2 ? 0.6 : 0),
    options: [
      { key: "take_lucrative", effects: [
        { kind: "cash", amount: 9_000_000 },
        { kind: "mood", delta: -14 },
      ] },
      { key: "take_modest", effects: [
        { kind: "cash", amount: 3_500_000 },
        { kind: "mood", delta: -2 },
      ] },
      { key: "decline", effects: [
        { kind: "mood", delta: +4 },
      ] },
    ],
  },
  {
    key: "economy.tax_bill",
    category: "economy", subject: null, weight: 5, cooldownMatchdays: 10,
    defaultOption: 0,
    // Reine Meldung, gedeckelt auf 4 % des Vermögens (GDD §10.7)
    options: [],
    precondition: (c) => c.cash > 5_000_000,
  },
  {
    key: "economy.merch_boom",
    category: "economy", subject: null, weight: 5, cooldownMatchdays: 8,
    defaultOption: 1,
    situationalWeight: (c) => 1 + (c.fanMood > 70 ? 0.7 : -0.3),
    options: [
      { key: "push_hard", effects: [
        { kind: "cash", amount: 3_000_000 },
        { kind: "mood", delta: -5 },
      ] },
      { key: "moderate", effects: [
        { kind: "cash", amount: 1_200_000 },
      ] },
    ],
  },
  {
    key: "economy.loan_offer",
    category: "economy", subject: null, weight: 6, cooldownMatchdays: 9,
    defaultOption: 2,
    situationalWeight: (c) => 1 + (c.cash < 20_000_000 ? 1.2 : -0.5),
    options: [
      { key: "take_large", effects: [
        { kind: "cash", amount: 25_000_000 },
        { kind: "mood", delta: -3 },
      ] },
      { key: "take_small", effects: [
        { kind: "cash", amount: 10_000_000 },
      ] },
      { key: "decline", effects: [] },
    ],
  },

  // ── Fans (3) ────────────────────────────────────────────────────────────
  {
    key: "fans.ticket_protest",
    category: "fans", subject: null, weight: 7, cooldownMatchdays: 7,
    defaultOption: 2,
    situationalWeight: (c) => 1 + (c.fanMood < 55 ? 1.0 : -0.4),
    options: [
      { key: "lower_prices", effects: [
        { kind: "mood", delta: +12 },
        { kind: "cash", shareOfCash: -0.015 },
      ] },
      { key: "meet_ultras", effects: [
        { kind: "mood", delta: +5 },
        { kind: "cash", amount: -300_000 },
      ] },
      { key: "ignore", effects: [
        { kind: "mood", delta: -8 },
        { kind: "fans", sharePercent: -1.5 },
      ] },
    ],
  },
  {
    key: "fans.choreo_request",
    category: "fans", subject: null, weight: 6, cooldownMatchdays: 8,
    defaultOption: 1,
    options: [
      { key: "fund", effects: [
        { kind: "cash", amount: -800_000 },
        { kind: "mood", delta: +10 },
        { kind: "fans", sharePercent: +1.0 },
      ] },
      { key: "decline", effects: [
        { kind: "mood", delta: -5 },
      ] },
    ],
  },
  {
    key: "fans.loyalty_action",
    category: "fans", subject: null, weight: 5, cooldownMatchdays: 9,
    defaultOption: 0,
    // Reine Meldung — die Fans stellen sich hinter den Verein, ohne dass man
    // dafür etwas tun müsste. Ein positives Ereignis ohne Haken darf es geben,
    // solange es selten bleibt.
    options: [],
    situationalWeight: (c) => 1 + (c.lossStreak >= 3 ? 1.5 : -0.6),
  },

  // ── Stadion (2) ─────────────────────────────────────────────────────────
  {
    key: "stadium.pitch_damage",
    category: "stadium", subject: null, weight: 7, cooldownMatchdays: 8,
    defaultOption: 2,
    situationalWeight: (c) => 1 + (c.stadiumCondition < 80 ? 1.0 : 0),
    options: [
      { key: "full_repair", effects: [
        { kind: "cash", amount: -2_500_000 },
        { kind: "stadiumCondition", delta: +12 },
      ] },
      { key: "patch", effects: [
        { kind: "cash", amount: -700_000 },
        { kind: "stadiumCondition", delta: +4 },
      ] },
      { key: "play_on", effects: [
        { kind: "stadiumCondition", delta: -6 },
        { kind: "fitness", target: "squad", delta: -4 },
        { kind: "mood", delta: -3 },
      ] },
    ],
  },
  {
    key: "stadium.storm_damage",
    category: "stadium", subject: null, weight: 5, cooldownMatchdays: 10,
    defaultOption: 1,
    options: [
      { key: "repair_now", effects: [
        { kind: "cash", shareOfCash: -0.04 },
        { kind: "stadiumCondition", delta: +8 },
      ] },
      { key: "minimal", effects: [
        { kind: "cash", shareOfCash: -0.01 },
        { kind: "stadiumCondition", delta: -5 },
        { kind: "mood", delta: -4 },
      ] },
    ],
  },

  // ── Markt (3) ───────────────────────────────────────────────────────────
  {
    key: "market.poach_offer",
    category: "market", subject: "best", weight: 7, cooldownMatchdays: 6,
    defaultOption: 2,
    // Der Tabellenführer wird häufiger abgeworben (GDD §10.5)
    situationalWeight: (c) => 1 + (c.rank === 1 ? 1.0 : 0) + Math.max(0, c.expectationDelta),
    options: [
      { key: "sell", effects: [
        { kind: "cash", amount: 30_000_000 },
        { kind: "mood", delta: -12 },
        { kind: "morale", target: "squad", delta: -5 },
      ] },
      { key: "demand_more", effects: [
        { kind: "chance", probability: 0.45,
          then: [
            { kind: "cash", amount: 42_000_000 },
            { kind: "mood", delta: -12 },
          ],
          otherwise: [
            { kind: "morale", target: "subject", delta: -12 },
          ] },
      ] },
      { key: "refuse", effects: [
        { kind: "mood", delta: +6 },
        { kind: "morale", target: "subject", delta: -8 },
      ] },
    ],
  },
  {
    key: "market.agent_call",
    category: "market", subject: null, weight: 5, cooldownMatchdays: 7,
    defaultOption: 1,
    options: [
      // Ohne Gewinnchance wäre "Auflegen" in jeder Hinsicht besser und das
      // ganze Ereignis eine Bestätigungsklick. Jetzt steht eine sichere
      // kleine Ausgabe gegen die Aussicht auf einen lukrativen Vermittlungs-
      // deal — und die Fans finden Beraterprovisionen unappetitlich.
      { key: "listen", effects: [
        { kind: "cash", amount: -600_000 },
        { kind: "mood", delta: -3 },
        { kind: "chance", probability: 0.5,
          then: [{ kind: "cash", amount: 2_500_000 }],
          otherwise: [] },
      ] },
      { key: "hang_up", effects: [] },
    ],
  },
  {
    key: "market.rival_interest",
    category: "market", subject: "best", weight: 6, cooldownMatchdays: 8,
    defaultOption: 2,
    // Dieses Ereignis wird beim Zustellen mit einem Gegenstück beim Rivalen
    // verknüpft — die wertvollste Ereignisklasse des Designs (GDD §10.6)
    situationalWeight: (c) => 1 + (c.rank <= 2 ? 0.6 : 0),
    options: [
      { key: "open_talks", effects: [
        { kind: "morale", target: "subject", delta: +6 },
        { kind: "mood", delta: -6 },
      ] },
      { key: "raise_price", effects: [
        { kind: "morale", target: "subject", delta: -6 },
        { kind: "marketValue", target: "subject", factor: 1.15 },
      ] },
      { key: "block", effects: [
        { kind: "morale", target: "subject", delta: -12 },
        { kind: "mood", delta: +4 },
      ] },
    ],
  },

  // ── Boulevard (2) ───────────────────────────────────────────────────────
  {
    key: "tabloid.interview_slip",
    category: "tabloid", subject: "random", weight: 7, cooldownMatchdays: 8,
    defaultOption: 2,
    situationalWeight: (c) => 1 + (c.lossStreak >= 2 ? 0.8 : 0),
    options: [
      { key: "apologise", effects: [
        { kind: "mood", delta: +3 },
        { kind: "morale", target: "subject", delta: -8 },
      ] },
      { key: "fine_player", effects: [
        { kind: "cash", amount: 250_000 },
        { kind: "morale", target: "subject", delta: -15 },
        { kind: "morale", target: "squad", delta: -3 },
      ] },
      { key: "back_him", effects: [
        { kind: "morale", target: "subject", delta: +10 },
        { kind: "mood", delta: -6 },
      ] },
    ],
  },
  {
    key: "tabloid.rumour",
    category: "tabloid", subject: "best", weight: 5, cooldownMatchdays: 6,
    defaultOption: 0,
    // Reine Meldung — ein Gerücht ist kein Vorgang, auf den man reagieren kann
    options: [],
  },
];

export const EVENTS_BY_KEY = new Map(EVENTS.map((event) => [event.key, event]));
