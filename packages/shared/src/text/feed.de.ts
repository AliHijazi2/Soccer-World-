/**
 * Boulevard-Feed, deutsch (GDD §16.1).
 *
 * Der Feed ist laut §20.3 eines von drei Dingen, die überdurchschnittlich gut
 * sein müssen — er ist der Grund, warum jemand morgens die App öffnet. Die
 * Texte sind deshalb Feature-Arbeit, kein Nebenprodukt.
 *
 * Regel beim Schreiben: Jede Meldung nennt einen Verein beim Namen und eine
 * konkrete Zahl. Allgemeinplätze ("Es läuft nicht rund") sind wertlos.
 */

import type { TemplateSet, WordLists } from "./engine.ts";

/**
 * Wortlisten.
 *
 * **Konvention: Jede Liste ist in sich genus- und numerusgleich.** Sonst
 * entstehen Sätze wie "Ein echter Serie" oder "Erste Unruhe werden laut" —
 * die Vorlage passt dann zu manchen Wörtern und zu anderen nicht. Der
 * Listenname trägt das Geschlecht: `_m`, `_f`, `_n`, `_pl`.
 */
export const FEED_WORDS: WordLists = {
  panic: ["Panik", "Größenwahn", "einem Hilferuf", "später Reue", "Verzweiflung"],
  experts: ["Experten", "Beobachter", "die Konkurrenz", "das halbe Netz"],
  mock: ["Applaus", "Mitleid", "Hohn", "vielsagendes Schweigen"],
  crisis_f: ["Krise", "Talfahrt", "Kernschmelze", "Abwärtsspirale"],
  praise_m: ["Lauf", "Höhenflug", "Aufschwung", "Durchmarsch"],
  doubt_pl: ["Zweifel", "Fragen", "Diskussionen", "Rufe nach Konsequenzen"],
};

export const FEED_TEMPLATES: TemplateSet = {
  // ── Transfermarkt ───────────────────────────────────────────────────────
  "transfer.overpaid": [
    "{club} zahlt {fee:money} für {player} — {pct:percent} über Marktwert. {~experts} sprechen von {~panic}.",
    "{fee:money} für {player}? {club} hat offenbar aufgehört zu rechnen.",
    "Der Markt staunt: {club} überweist {fee:money} für einen Spieler, der {value:money} wert ist.",
    "{club} setzt sich bei {player} durch. Kostenpunkt: {fee:money}. {~mock} von den Rivalen.",
    "Teuerster Transfer des Tages: {player} für {fee:money} zu {club}. {pct:percent} drüber.",
  ],
  "transfer.bargain": [
    "{club} holt {player} für {fee:money} — {pct:percent} unter Marktwert. Da hat jemand geschlafen.",
    "Schnäppchen: {player} wechselt für {fee:money} zu {club}.",
    "{club} greift bei {player} zu, und niemand hat mitgeboten. {fee:money}.",
    "{fee:money} für {player}. {club} lacht sich ins Fäustchen.",
  ],
  "transfer.completed": [
    "{player} wechselt für {fee:money} zu {club}.",
    "Vollzug: {club} verpflichtet {player}. Ablöse {fee:money}.",
    "{club} und {player} — der Deal steht bei {fee:money}.",
  ],
  "transfer.to_abroad": [
    "{player} verlässt die Liga — {fee:money} aus dem Ausland, und niemand von euch hat mitgeboten.",
    "Weg ist er: {player} wechselt für {fee:money} ins Ausland. Keiner hat geboten.",
    "{fee:money} für {player} — kassiert hat ein Verein, den hier niemand kennt.",
    "Ihr habt {player} kampflos ziehen lassen. {fee:money} gingen ins Ausland.",
  ],
  "transfer.bidding_war": [
    "Bieterkrieg um {player}: {bidders} Vereine, Endstand {fee:money}.",
    "{bidders} Interessenten, ein Gewinner: {club} bekommt {player} für {fee:money}.",
    "Der Preis für {player} ist um {pct:percent} gestiegen, seit die Auktion begann.",
  ],

  // ── Wirtschaft ──────────────────────────────────────────────────────────
  "club.broke": [
    "{club} rutscht ins Minus. Die Bank hat angerufen.",
    "Kontostand {club}: {cash:money}. Das wird eng.",
    "{club} steht bei {cash:money}. {~experts} rechnen bereits mit Zwangsverkäufen.",
    "Die Zahlen bei {club} sehen nicht gut aus: {cash:money}.",
  ],
  "club.wage_pressure": [
    "{club} zahlt {wages:money} Gehalt pro Saison — {pct:percent} der Einnahmen.",
    "Die Gehaltsquote bei {club} liegt bei {pct:percent}. Nachhaltig ist das nicht.",
    "{club} lebt über den Verhältnissen: {pct:percent} der Einnahmen gehen an die Spieler.",
  ],

  // ── Ergebnisse ──────────────────────────────────────────────────────────
  "match.thrashing": [
    "{winner} zerlegt {loser} mit {home}:{away}.",
    "{home}:{away} — {loser} wird von {winner} vorgeführt.",
    "Deutlicher geht es kaum: {winner} schlägt {loser} {home}:{away}.",
    "{loser} kassiert {away} Gegentore. {winner} hatte einen guten Abend.",
  ],
  "match.upset": [
    "{winner} schlägt {loser}. Damit hat niemand gerechnet.",
    "Sensation: {winner} gewinnt gegen {loser} mit {home}:{away}.",
    "{loser} verliert gegen {winner} — der Favorit patzt.",
    "{winner} räumt {loser} ab. Die Tabelle wird interessant.",
  ],
  "match.win_streak": [
    "{club} gewinnt zum {count}. Mal in Folge. Die Liga schaut zu.",
    "{count} Siege am Stück für {club}. Ein echter {~praise_m}.",
    "{club} ist nicht zu stoppen: {count} Siege in Serie.",
  ],
  "match.losing_streak": [
    "{count} Niederlagen in Folge für {club}. {~crisis_f}.",
    "{club} verliert zum {count}. Mal hintereinander. Erste {~doubt_pl} werden laut.",
    "Bei {club} geht nichts mehr: {count} Pleiten am Stück.",
  ],

  // ── Fans ────────────────────────────────────────────────────────────────
  "fans.protest": [
    "{club}: Die Fans fordern Antworten. Stimmung auf {mood}.",
    "Proteste im Stadion von {club}. Die Stimmung liegt bei {mood} von 100.",
    "Die Anhänger von {club} haben genug. Stimmungswert: {mood}.",
    "{club} spielt vor unruhigem Publikum. Stimmung {mood}.",
  ],
  "fans.hostile": [
    "Bei {club} ist die Stimmung gekippt: {mood} von 100. Das Stadion bleibt leer.",
    "{club} hat seine Fans verloren. Stimmung {mood}, Auslastung im Keller.",
    "Feindselige Stimmung bei {club}. {mood} von 100 — der Heimvorteil ist weg.",
  ],
  "fans.euphoric": [
    "{club} lebt: Stimmung {mood} von 100, das Stadion ist ausverkauft.",
    "Euphorie bei {club}. {fans:number} Anhänger und kein freier Platz.",
    "{club} reitet auf einer Welle. Stimmungswert {mood}.",
  ],
  "fans.growth": [
    "{club} gewinnt {delta:number} neue Anhänger. Jetzt {fans:number}.",
    "Die Fanbasis von {club} wächst auf {fans:number}.",
    "Erfolg zieht an: {club} zählt jetzt {fans:number} Anhänger.",
    "{delta:number} Menschen haben sich für {club} entschieden. Bestand: {fans:number}.",
  ],
  "fans.exodus": [
    "{club} verliert Anhänger: noch {fans:number}. {delta:count} sind gegangen.",
    "Bei {club} wandern die Fans ab. Bestand: {fans:number}.",
    "{delta:count} Anhänger haben {club} den Rücken gekehrt.",
    "Die Fanbasis von {club} schrumpft auf {fans:number}.",
  ],

  // ── Erwartung ───────────────────────────────────────────────────────────
  "expectation.missed": [
    "{club} sollte um den Titel spielen und steht auf Platz {rank}. {~doubt_pl}.",
    "Der teuerste Kader der Liga, Tabellenplatz {rank}: {club} enttäuscht.",
    "{club} bleibt {delta:one} Punkte pro Spiel hinter der Erwartung zurück.",
    "Für {fee:money} Kaderwert erwartet man mehr als Platz {rank}, {club}.",
  ],
  "expectation.exceeded": [
    "{club} sollte Letzter werden und steht auf Platz {rank}.",
    "Niemand hatte {club} auf Platz {rank} erwartet. Auch {club} selbst nicht.",
    "{club} übertrifft die Erwartung um {delta:one} Punkte pro Spiel.",
  ],

  // ── Kader ───────────────────────────────────────────────────────────────
  "squad.tired": [
    "{club} läuft mit {count} Spielern unter Fitness 70 auf. Rotation? Fehlanzeige.",
    "Bei {club} ist fast der ganze Kader ausgelaugt: {count} Spieler unter der Grenze.",
    "{count} müde Beine bei {club}. Der Kader ist zu schmal.",
    "{club} hat sich verausgabt — {count} Spieler sind am Ende.",
  ],
  "squad.injury_crisis": [
    "{club} hat {count} Ausfälle zu beklagen.",
    "Lazarett bei {club}: {count} Spieler fehlen.",
    "{count} Verletzte bei {club}. Die Aufstellung wird zum Rätsel.",
  ],
  "squad.star_injured": [
    "{player} von {club} fällt {matchdays} Spieltage aus.",
    "Schock bei {club}: {player} ist für {matchdays} Spieltage raus.",
    "{club} verliert {player} für {matchdays} Spieltage.",
  ],

  // ── Bot und Saison ──────────────────────────────────────────────────────
  "bot.leading": [
    "Der Bot steht auf Platz {rank}. {count} von euch liegen dahinter.",
    "Peinlich: {rank:ordinal} der Tabelle ist ein Computer.",
    "Der Bot spielt besser als {count} echte Manager. Nur so als Hinweis.",
  ],
  "season.champion": [
    "{club} ist Meister. {points} Punkte, {goals} Tore.",
    "{club} beendet die Saison als {rank:ordinal} — Meisterschaft.",
    "Die Saison gehört {club}: {points} Punkte.",
    "{club} holt den Titel. Der Rest schaut zu.",
  ],
  "season.bot_champion": [
    "Der Bot war besser als ihr alle. Herzlichen Glückwunsch, {club}, zum Titel des besten Menschen.",
    "Ein Computer hat die Liga gewonnen. {club} ist bester Mensch. Sternchen inklusive.",
    "Tabellenführer: eine Software. Meister: {club}. Fragen dazu?",
    "{club} gewinnt den Titel — hinter einem Algorithmus. Das bleibt in der ewigen Tabelle stehen.",
  ],
  "season.flop": [
    "Fehleinkauf der Saison: {player} für {fee:money}, Wertverlust {loss:money}.",
    "{club} hat {fee:money} für {player} verbrannt. Heute ist er {value:money} wert.",
    "{player} kostete {fee:money} und ist {value:money} wert. {club} schweigt dazu.",
    "Teuerster Irrtum der Saison: {club} und {player}. Minus {loss:money}.",
  ],
};

export const FEED_PLACEHOLDERS: Record<string, readonly string[]> = {
  "transfer.overpaid": ["club", "player", "fee", "pct", "value"],
  "transfer.bargain": ["club", "player", "fee", "pct"],
  "transfer.completed": ["club", "player", "fee"],
  "transfer.bidding_war": ["club", "player", "fee", "pct", "bidders"],
  "transfer.to_abroad": ["player", "fee", "club", "value", "pct"],
  "club.broke": ["club", "cash"],
  "club.wage_pressure": ["club", "wages", "pct"],
  "match.thrashing": ["winner", "loser", "home", "away"],
  "match.upset": ["winner", "loser", "home", "away"],
  "match.win_streak": ["club", "count"],
  "match.losing_streak": ["club", "count"],
  "fans.protest": ["club", "mood"],
  "fans.hostile": ["club", "mood"],
  "fans.euphoric": ["club", "mood", "fans"],
  "fans.growth": ["club", "fans", "delta"],
  "fans.exodus": ["club", "fans", "delta"],
  "expectation.missed": ["club", "rank", "delta", "fee"],
  "expectation.exceeded": ["club", "rank", "delta"],
  "squad.tired": ["club", "count"],
  "squad.injury_crisis": ["club", "count"],
  "squad.star_injured": ["club", "player", "matchdays"],
  "bot.leading": ["rank", "count"],
  "season.champion": ["club", "points", "goals", "rank"],
  "season.bot_champion": ["club"],
  "season.flop": ["club", "player", "fee", "loss", "value"],
};
