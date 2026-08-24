/**
 * Ticker-Texte, deutsch.
 *
 * Ton: Boulevard, bissig, aber ohne Slapstick (GDD F12). Vier bis acht
 * Varianten pro Schlüssel, damit sich nichts nach drei Spieltagen abnutzt.
 */

import type { TemplateSet, WordLists } from "./engine.ts";

export const TICKER_WORDS: WordLists = {
  power: ["wuchtig", "trocken", "eiskalt", "unhaltbar", "brutal"],
  praise: ["Klasse", "Übersicht", "Frechheit", "Ruhe", "Präzision"],
  relief: ["Glück", "Erleichterung", "Schweiß auf der Stirn"],
  disbelief: ["Unfassbar", "Kaum zu glauben", "Das darf nicht wahr sein"],
  frustration: ["Wut", "Verzweiflung", "Ratlosigkeit"],
};

export const TICKER_TEMPLATES: TemplateSet = {
  "match.kickoff": [
    "Anpfiff.",
    "Der Ball rollt.",
    "Es geht los.",
  ],
  "match.halftime": [
    "Halbzeit. {home}:{away}.",
    "Pause beim Stand von {home}:{away}.",
    "Zur Pause steht es {home}:{away}.",
  ],
  "match.fulltime": [
    "Abpfiff. Endstand {home}:{away}.",
    "Schluss. {home}:{away}.",
    "Vorbei — {home}:{away}.",
  ],

  "goal.solo": [
    "{minute:minute} Minute: {player} {~power} ins Netz. TOR!",
    "TOR! {player} macht das alleine — {minute:minute} Minute.",
    "{player} zieht ab und trifft. {minute:minute} Minute.",
    "Da ist er! {player} mit dem Treffer in der {minute:minute} Minute.",
    "{minute:minute} Minute: {player} lässt sich das nicht nehmen. TOR!",
  ],
  "goal.assisted": [
    "TOR! {assist} legt auf, {player} vollstreckt. {minute:minute} Minute.",
    "{minute:minute} Minute: {assist} mit der {~praise}, {player} trifft.",
    "{player} nach Vorlage von {assist} — {~power} eingeschoben.",
    "Die Kombination sitzt: {assist} auf {player}, drin. {minute:minute} Minute.",
    "{minute:minute} Minute: {assist} sieht {player}, und der macht ihn rein.",
  ],

  "chance.saved": [
    "{player} zieht ab, {keeper} ist da.",
    "{keeper} pariert gegen {player}.",
    "Schuss {player} — gehalten.",
    "{keeper} hält, was zu halten ist.",
  ],
  "chance.big_saved": [
    "Riesenchance {player} — und {keeper} macht sie zunichte!",
    "{keeper} mit einer Parade, die keiner erwartet hat. {player} fasst sich an den Kopf.",
    "{~disbelief}: {player} frei vor {keeper}, und der hält.",
    "Was für eine Rettungstat von {keeper} gegen {player}!",
  ],
  "chance.woodwork": [
    "{player} trifft nur den Pfosten. {~relief} auf der Gegenseite.",
    "Aluminium! {player} hat Pech.",
    "Latte! {player} kann es nicht fassen.",
    "{player} an den Pfosten — Zentimeter fehlen.",
  ],
  "chance.big_missed": [
    "{player} vergibt frei vor dem Tor. {~disbelief}.",
    "Das muss rein! {player} setzt den Ball daneben.",
    "Riesenchance vertan von {player}.",
    "{player} allein durch — und drüber. {~frustration} auf den Rängen.",
  ],
  "chance.off_target": [
    "{player} zielt daneben.",
    "Versuch von {player}, kein Problem.",
    "{player} schießt vorbei.",
    "Schuss {player} — weit drüber.",
  ],

  "card.yellow": [
    "Gelb für {player}. {minute:minute} Minute.",
    "{player} sieht die Gelbe Karte.",
    "Verwarnung gegen {player}.",
    "{minute:minute} Minute: {player} geht zu hart rein, Gelb.",
  ],
  "card.red": [
    "ROT! {player} muss runter. {minute:minute} Minute.",
    "{player} sieht Rot — das war es für ihn.",
    "Platzverweis für {player}. Die Mannschaft spielt in Unterzahl weiter.",
    "{minute:minute} Minute: Rote Karte gegen {player}. Bitter.",
  ],

  "injury.forced_off": [
    "{player} bleibt liegen und kann nicht weiter. Ausfall: {matchdays} Spieltage.",
    "Verletzung {player} — {matchdays} Spieltage Pause.",
    "{player} muss verletzt raus. {matchdays} Spieltage fehlt er.",
    "{minute:minute} Minute: {player} greift sich in die Muskulatur. {matchdays} Spieltage Pause.",
  ],
  "sub.injury": [
    "{player} kommt für den verletzten {assist}.",
    "Zwangswechsel: {player} ersetzt {assist}.",
    "{assist} raus, {player} rein.",
  ],
};

/** Platzhalter, die je Schlüssel erlaubt sind — Grundlage der Prüfung. */
export const TICKER_PLACEHOLDERS: Record<string, readonly string[]> = {
  "match.kickoff": [],
  "match.halftime": ["home", "away"],
  "match.fulltime": ["home", "away"],
  "goal.solo": ["player", "minute", "xg"],
  "goal.assisted": ["player", "assist", "minute", "xg"],
  "chance.saved": ["player", "keeper", "minute"],
  "chance.big_saved": ["player", "keeper", "minute"],
  "chance.woodwork": ["player", "minute"],
  "chance.big_missed": ["player", "minute"],
  "chance.off_target": ["player", "minute"],
  "card.yellow": ["player", "minute"],
  "card.red": ["player", "minute"],
  "injury.forced_off": ["player", "minute", "matchdays"],
  "sub.injury": ["player", "assist", "minute"],
};
