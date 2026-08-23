# Soccer World — Game Design Document

**Version:** 0.1 (Konzeptphase, noch keine Implementierung)
**Genre:** Asynchrones Multiplayer-Strategie- und Wirtschaftsspiel im Fußballkontext
**Zielgruppe:** Geschlossene Freundesgruppen (4–8 Personen), Mobile-first
**Pitch in einem Satz:** *Ihr baut gemeinsam ein Fußball-Universum auf — und ruiniert euch dabei gegenseitig die Transfers.*

---

## 0. Grundannahmen (getroffen, nicht vorgegeben)

Diese Annahmen sind Designentscheidungen, die ich getroffen habe, weil sie nicht spezifiziert waren. Jede ist einzeln umstoßbar.

| # | Annahme | Begründung | Risiko bei Änderung |
|---|---|---|---|
| A1 | **4–8 Spieler pro Liga, Sweet Spot 6.** | Unter 4 stirbt der Transfermarkt, über 8 wird Verhandeln unübersichtlich und die Saison zu lang. | Bei >8 braucht es Konferenz-Spieltage und Ligagruppen. |
| A2 | **Asynchron, nicht Echtzeit.** Spieler öffnen die App 1–3× am Tag für je 3–8 Minuten. | Freundesgruppen haben nie gleichzeitig Zeit. Async ist die einzige Form, die 6 Wochen durchhält. | Echtzeit würde eine komplett andere Auktionsmechanik erfordern. |
| A3 | **Ein Spieltag pro echtem Tag**, feste Anstoßzeit (Default 20:00 Ortszeit der Lobby). | Erzeugt einen täglichen Termin ("gleich ist Spieltag") ohne Dauerpräsenz. | Bei 2 Spieltagen/Tag: halbe Saisondauer, aber weniger Zeit für Verhandlungen. |
| A4 | **Saison = Doppelrunde.** Bei 6 Spielern → 10 Spieltage ≈ 2 Wochen inkl. 2 Transfertage. | Kurz genug, dass ein "Neuanfang" (nächste Saison) nie weit weg ist. | Dreifachrunde für mehr Sim-Signal, aber Ermüdungsrisiko. |
| A5 | **Fiktive Spielernamen und Vereine**, keine Lizenzen. | Lizenzkosten sind für ein Freundes-Projekt nicht tragbar. | Reale Namen wären ein rechtliches und kein Design-Problem. |
| A6 | **Keine Echtgeld-Käufe, keine Pay-to-Win-Ökonomie.** | Das Spiel lebt von wahrgenommener Fairness unter Freunden. Ein Kauf-Button zerstört sie sofort. | Monetarisierung ggf. über kosmetische Vereinsidentität oder Lobby-Slots. |
| A7 | **Spielsimulation ist textbasiert** (Live-Ticker + Statistik), keine 2D/3D-Darstellung. | Der Reiz liegt im Vorher (Entscheidung) und Nachher (Schadenfreude), nicht im Zusehen. | Eine 2D-Ansicht ist ein späteres Upgrade, kein MVP-Feature. |
| A8 | **Die Liga besteht ausschließlich aus Freunden.** NPC-Vereine existieren nur als abstrakte "Außenwelt" auf dem Transfermarkt. | Jedes Spiel muss gegen einen echten Menschen sein, sonst gibt es keine Schadenfreude. Die Außenwelt liefert trotzdem Marktdruck und Abwerbe-Ereignisse. | NPC-Vereine in der Liga würden die emotionale Dichte verwässern. |
| A9 | **Server ist autoritativ**, Simulation läuft serverseitig mit gespeichertem Seed. | Reproduzierbarkeit, Cheat-Schutz, identischer Ticker für alle. | Ohne Server-Autorität ist ein Multiplayer-Wirtschaftsspiel nicht haltbar. |
| A10 | **Der Besitzer verlässt nie die Vogelperspektive.** Kein Ingame-Coaching während des Spiels. | Hält die Sitzung kurz und den Fokus auf Wirtschaft/Strategie. | Live-Eingriffe würden Async-Spieler benachteiligen. |

---

## 1. Core Gameplay Loop

Das Spiel hat drei ineinander verschachtelte Schleifen. Die kleinste ist das tägliche Ritual, die größte hält die Gruppe über Monate zusammen.

### 1.1 Micro-Loop — der Spieltag (3–8 Minuten, 1–2× täglich)

```
  ┌─> [1] Posteingang: Ereignisse & Entscheidungen
  │        "Dein Kapitän fordert mehr Gehalt. 3 Optionen."
  │
  │    [2] Markt: Gebote prüfen, überbieten, verhandeln
  │        "Marco hat dein Gebot auf Ferreira um 400k überboten."
  │
  │    [3] Verein: Aufstellung, Taktik, Ticketpreis, Bau
  │
  │    [4] ANSTOSS (20:00, automatisch, ohne Spieler)
  │
  │    [5] Ergebnis + Ticker + Tabelle + Bilanz
  │
  └─── [6] Gruppenchat: Trash-Talk, Vorwürfe, neue Deals
```

Der entscheidende Designpunkt: **Schritt 4 passiert ohne den Spieler.** Die Spannung entsteht daraus, dass man seine Entscheidungen abgibt und dann *warten* muss. Das ist derselbe Mechanismus wie bei Fantasy-Football-Ligen und der Grund, warum die dort funktionieren.

### 1.2 Meso-Loop — die Saison (10–14 Tage)

```
Eröffnungsauktion → Spieltage 1–5 → Transferfenster → Spieltage 6–10 → Saisonabschluss & Ehrungen
```

### 1.3 Macro-Loop — das Universum (unbegrenzt)

```
Saison → Alterung & Entwicklung → Verträge & Talente → Liga-Abstimmung über Regeln → nächste Saison
                                                                     ↑
                                              Prestige-Punkte kumulieren über alle Saisons
```

Der Macro-Loop ist das eigentliche Produkt. Eine Einzelsaison ist ein Spiel; zehn Saisons sind eine gemeinsame Geschichte. Alles, was Spuren hinterlässt (Vereinsvermögen, Stadion, Eigengewächse, alte Rivalitäten, die ewige Tabelle), zahlt darauf ein.

---

## 2. Spielstart

### 2.1 Lobby

Ein Spieler eröffnet eine Liga und lädt per Code ein. Er legt fest: Spielerzahl, Startbudget, Spieltagszeit, Saisonlänge, Auktionsmodus. Ab Saison 2 werden diese Regeln nicht mehr vom Host, sondern per Abstimmung geändert (→ §16.5).

### 2.2 Vereinsgründung

Jeder Spieler wählt: Name, Kürzel, Stadt, Trikotfarben, Wappen (Baukasten). Optional ein Vereinsmotto, das im Boulevard-Feed zitiert wird. Kosten: nichts, aber Identität ist der günstigste Bindungsmechanismus, den es gibt.

### 2.3 Identische Startbedingungen

| Ressource | Startwert |
|---|---|
| Budget | 25.000.000 |
| Stadion | 8.000 Plätze, Zustand 100 % |
| Fans | 5.000, Stimmung 60/100 |
| Kader | 5 Pflicht-Jugendspieler (OVR 45–55, Minimalgehalt) |
| Sponsor | Ein Übergangs-Basisvertrag, läuft nach Spieltag 3 aus |
| Akademie | Stufe 0 |

Die 5 Jugendspieler sind kein Geschenk, sondern eine Versicherung: Sie stellen sicher, dass niemand nach einer katastrophalen Auktion spielunfähig ist. Sie sind bewusst schlecht.

### 2.4 Die Eröffnungsauktion ("Draft Night")

Der wichtigste Moment des gesamten Spiels und der Grund, warum Leute die App überhaupt installieren.

- Ein Pool von **ca. 18 Spielern pro Teilnehmer** (bei 6 Spielern: 108 Profis) wird veröffentlicht, sortier- und filterbar, mit Scoutingberichten.
- Der Pool ist **absichtlich knapp**: Es gibt weniger echte Topspieler als Vereine, die einen brauchen. Bei 6 Teilnehmern existieren z. B. nur 4 Spieler mit OVR ≥ 85 und nur 3 echte Mittelstürmer der Spitzenklasse.
- **Modus A (empfohlen, "Draft Night"):** ein 60–90-minütiger Live-Termin, den die Gruppe verabredet. Reihum nominiert je ein Spieler einen Profi; dann läuft eine 45-Sekunden-Auktion mit Soft-Close für alle. Maximale soziale Dichte.
- **Modus B (Fallback, "Marktwoche"):** 48 Stunden asynchrone Auktionen in drei Wellen à 16 Stunden. Für Gruppen, die keinen gemeinsamen Termin hinbekommen.
- **Pflichtkader:** Am Ende braucht jeder Verein mindestens 14 Spieler inkl. 1 Torwart pro Formation. Wer das nicht schafft, bekommt automatisch Freie Agenten zugewiesen — schlecht und trotzdem teuer im Gehalt.
- **Budgetdisziplin:** Wer sein gesamtes Budget in drei Stars steckt, hat eine großartige Startelf, keine Bank, keine Rücklage für Reparaturen und wird beim ersten Verletzungsereignis bestraft. Das ist beabsichtigt und wird im Tutorial *nicht* verhindert, nur gewarnt.

### 2.5 Onboarding

Kein Tutorial-Level. Stattdessen: ein 6-Karten-Onboarding vor der Auktion ("So verdient dein Verein Geld", "So funktioniert ein Bieterkrieg", "Was Fans von dir erwarten") und danach kontextuelle Hinweise beim ersten Auftreten jeder Mechanik. Die Auktion selbst ist das Tutorial, weil sie alles gleichzeitig lehrt.

---

## 3. Vereinssystem

Ein Verein ist die Summe von sechs Werten, die alle miteinander verkoppelt sind:

| Attribut | Bedeutung | Verändert sich durch |
|---|---|---|
| **Kapital** | Liquide Mittel | Alles |
| **Kaderwert** | Summe der Marktwerte | Transfers, Entwicklung, Alterung |
| **Fanbasis** | Anzahl (träge) | Erfolg, Ticketpreis, Identität, Stadion |
| **Fanstimmung** | 0–100 (volatil) | Ergebnisse, Entscheidungen, Ereignisse |
| **Infrastruktur** | Stadion + Akademie + Personal | Investitionen |
| **Prestige** | Historischer Ruf über alle Saisons | Titel, Rekorde, Rankings |

**Prestige** ist die einzige Größe, die eine Saison überdauert und *nicht* zurücksetzbar ist. Es öffnet keine mechanischen Vorteile (das wäre Snowball), sondern kosmetische und narrative: Sterne am Wappen, bessere Startposition in Boulevard-Schlagzeilen, ein leichter Bonus bei Spieler-Überzeugung ("dieser Verein hat Geschichte") — bewusst schwach, ca. 3 % Verhandlungsvorteil pro Titel, gedeckelt.

**Vorstand / Erwartung:** Jeder Verein bekommt zu Saisonbeginn ein Saisonziel, das sich **am Kaderwert relativ zur Liga** bemisst, nicht an absoluter Stärke. Der teuerste Kader der Liga bekommt "Meister werden". Der billigste bekommt "Nicht Letzter werden". Das ist der wichtigste Anti-Snowball-Hebel des ganzen Spiels (→ §19.2).

---

## 4. Spielersystem

### 4.1 Attribute (bewusst schlank)

Sechs sichtbare Attribute, 1–99. Mehr wäre Simulationstiefe ohne Entscheidungstiefe.

| Attribut | Wirkt auf |
|---|---|
| **Torabschluss** | Chancenverwertung |
| **Technik** | Ballkontrolle, Dribbling, Standards |
| **Übersicht** | Chancenerzeugung, Aufbauspiel |
| **Zweikampf** | Defensive, Balleroberung |
| **Tempo** | Konter, Raumgewinn, Defensivabsicherung |
| **Torwart** | Nur für TW relevant, sonst irrelevant |

Daraus abgeleitet: **OVR** (positionsgewichtet). Ein Innenverteidiger mit Torabschluss 80 hat trotzdem einen niedrigen OVR — was die Auktion interessant macht, weil manche Spieler *aussehen* wie Schnäppchen.

### 4.2 Zustandswerte

- **Alter** (16–38) — bestimmt Entwicklungsrichtung
- **Potenzial** — **verdeckt**, für Spieler nur als Scouting-Range sichtbar ("70–86, Vertrauen: mittel")
- **Form** (0–100) — kurzfristig, schwankt über Spieltage
- **Fitness** (0–100) — sinkt pro Einsatz, regeneriert bei Pausen
- **Moral** (0–100) — Einsatzzeit, Erfolg, Gehaltsgerechtigkeit, Ereignisse
- **Verletzung** — Dauer in Spieltagen

### 4.3 Traits (der Ereignis-Motor)

Jeder Spieler hat 0–2 Traits. Traits sind keine reinen Boni, sondern **Hooks, an denen das Ereignissystem andockt**. Sie sind der Grund, warum ein Transfer eine Geschichte wird statt einer Zahl.

| Trait | Mechanik | Erzeugt Ereignisse wie |
|---|---|---|
| **Ego** | +3 OVR, verlangt Stammplatz und Spitzengehalt | Kabinenstreit, Wechselforderung |
| **Anführer** | +Moral im gesamten Team | Kapitänsdiskussion |
| **Glasknochen** | Verletzungsrisiko ×1,8 | Langzeitausfall zum ungünstigsten Zeitpunkt |
| **Big-Game-Player** | +8 Form in Spitzenspielen und Derbys | Heldengeschichten |
| **Fanliebling** | Verkauf kostet 15 Stimmungspunkte | Fanproteste bei Transfer |
| **Spätzünder** | Entwicklung erst ab 25 | Der "Fehlkauf", der Saison 3 explodiert |
| **Söldner** | Wechselt für Geld ohne Loyalität | Abwerbeangebote |
| **Chaot** | 20 % höheres Rote-Karte-Risiko, +5 Zweikampf | Sperren, Boulevard |
| **Eigengewächs** | −25 % Gehaltsforderung, Fans lieben ihn | Identitätsereignisse |

### 4.4 Verträge

Gehalt pro Spieltag, Laufzeit in Spieltagen, optionale Klauseln (Ausstiegsklausel, Weiterverkaufsbeteiligung, Bonus pro Tor). Läuft ein Vertrag aus, ohne dass verlängert wird, ist der Spieler nach der Saison **ablösefrei** — und alle Freunde sehen den Countdown. Vertragsmanagement ist eine öffentliche Angreifbarkeit, kein privates Häkchen.

### 4.5 Marktwert

```
Marktwert = f(OVR, Alter, Potenzial-Erwartung, Form, Vertragsrestlaufzeit, Positionsknappheit in der Liga)
```

**Positionsknappheit** ist der interessante Term: Wenn in der Liga vier Vereine dringend einen Torwart brauchen, steigt der Marktwert aller Torhüter. Der Markt reagiert also auf das Verhalten der Freunde — nicht auf eine statische Tabelle.

---

## 5. Transfermarkt

Ein einziger, für alle gemeinsamer Markt. Drei getrennte Kanäle:

### 5.1 Kanal A — Auktionshaus (Spieler gegen Spieler gegen die Außenwelt)

Hier landen: Spieler aus dem Startpool, Freie Agenten, von Freunden zum Verkauf gestellte Profis, Talente aus der Außenwelt. Rollierendes Angebot: pro Transfertag erscheinen 3–6 neue Spieler.

**NPC-Konkurrenz ("die Außenwelt"):** Auf ca. 30 % der Auktionen bietet ein anonymer Auswärtsverein mit — begrenzt, berechenbar, mit einem harten Ceiling bei ca. 90 % des Marktwerts. Zweck: Der Markt fühlt sich nicht leer an, wenn nur zwei Freunde online sind, und niemand bekommt einen 40-Mio-Spieler für 1 Mio, nur weil gerade alle schlafen. Die Außenwelt gewinnt nie einen Bieterkrieg gegen einen entschlossenen Menschen.

### 5.2 Kanal B — Direkttransfer (Freund zu Freund)

Verhandlung im 1:1-Dialog. Das ist der Kanal, in dem die interessantesten Geschichten entstehen, weil hier **verhandelt statt geboten** wird (→ §16.2).

### 5.3 Kanal C — Leihmarkt

Ein Spieler wechselt für X Spieltage, der abgebende Verein zahlt anteilig weiter Gehalt. Zweck: Kaderbreite für Arme, Gehaltsentlastung für Überinvestierte, und ein enormer Trash-Talk-Generator ("Dein Meistertitel gehört zur Hälfte mir").

### 5.4 Transferfenster

Der Markt ist **nicht dauerhaft offen**. Das ist wichtig, sonst wird jede Niederlage sofort mit Geld korrigiert.

| Fenster | Wann | Was geht |
|---|---|---|
| **Eröffnung** | Vor Spieltag 1 | Alles |
| **Winterfenster** | Nach Spieltag 5 (24–48 h) | Alles |
| **Notfalltransfer** | Jederzeit | Nur Freie Agenten, nur bei ≥2 Ausfällen auf einer Position, nur zu 130 % Gehalt |
| **Nachsaison** | Zwischen Saisons | Alles, inkl. ablösefreier Spieler |

### 5.5 Marktfenster-Zeiten (Anti-3-Uhr-nachts-Design)

Auktionen enden **ausschließlich zwischen 18:00 und 22:00** Lobby-Zeit. Niemand muss nachts wach bleiben, um nicht gesnipet zu werden. Dieses Detail entscheidet darüber, ob die Gruppe das Spiel nach zwei Wochen noch mag.

---

## 6. Transferregeln und Bieterkriege

### 6.1 Auktionsmechanik

- **Englische Auktion** mit sichtbarem Höchstgebot.
- **Mindestschritt:** max(50.000, 5 % des aktuellen Gebots).
- **Soft-Close / Anti-Sniping:** Jedes Gebot in den letzten 2 Minuten verlängert die Auktion um 2 Minuten. Kein Sniping, dafür echte Nervenkriege.
- **Escrow:** Ein Gebot **bindet das Geld sofort**. Man kann nicht auf fünf Spieler gleichzeitig bieten, wenn man nur Geld für zwei hat. Das erzeugt die zentrale strategische Frage: *Wo binde ich meine Liquidität?*
- **Proxy-Gebot (Maximalgebot):** Optional hinterlegt man ein geheimes Limit; das System bietet automatisch bis dorthin in Mindestschritten. Notwendig für Async-Fairness.
- **Transparenz:** Man sieht **wer** mitbietet, aber nicht dessen Maximalgebot. Namen sind sichtbar, weil Schadenfreude einen Adressaten braucht.

### 6.2 Der Fluch des Gewinners (bewusst eingebaut)

Die Gehaltsforderung eines Spielers skaliert mit der gezahlten Ablöse:

```
gefordertes Gehalt = Basisgehalt(OVR, Alter) × (1 + 0,35 × max(0, Ablöse/Marktwert − 1))
```

Wer 80 % über Marktwert bietet, zahlt also dauerhaft ca. 28 % Gehaltsaufschlag. Ein gewonnener Bieterkrieg ist damit **nicht automatisch ein Gewinn** — und die anderen wissen das und können hochtreiben. Das ist die schärfste Waffe im Spiel: *Man kann einen Freund ruinieren, indem man ihn gewinnen lässt.*

Schutz vor Missbrauch: Wer eine Auktion hochtreibt und dann selbst gewinnt, zahlt eben. Und wer dreimal in Folge Höchstbieter war und zurückzog, bekommt ein sichtbares Boulevard-Etikett ("Preistreiber"). Reputation reguliert das, keine Regel.

### 6.3 Verdeckte Auktionen (Spezialformat)

Für ausgewählte Highlight-Spieler (1–2 pro Transferfenster): **ein einziges verdecktes Gebot**, alle gleichzeitig, Höchstgebot gewinnt und zahlt sein Gebot. Maximale Bauchschmerzen, maximale Auflösung im Gruppenchat. Sollte selten bleiben, sonst nutzt es sich ab.

### 6.4 Regeln gegen Absprachen

Absprachen unter Freunden sind Teil des Spiels und sollen nicht verboten werden — aber Verschiebebahnhöfe müssen Kosten haben:

- **Transfersteuer:** 5 % jeder Ablöse verfällt (Solidartopf → §19.5).
- **Marktwert-Korridor bei Direkttransfers:** Preise unter 40 % oder über 250 % des Marktwerts erzeugen einen öffentlichen Boulevard-Artikel ("Skandalpreis!") und eine Prüfung durch den Verband: Fanstimmung −8 für beide Vereine.
- **Kein Rückkauf innerhalb von 3 Spieltagen** an denselben Verein.

Das verhindert Kollusion nicht — es macht sie sichtbar und teuer, was in einer Freundesgruppe wirksamer ist als jedes Verbot.

### 6.5 Spielerzustimmung

Ein Transfer kann scheitern, weil der **Spieler nicht will**. Wahrscheinlichkeit hängt ab von: Gehaltsangebot, Prestige, erwarteter Einsatzzeit, Traits (Söldner sagt fast immer ja, Fanliebling fast immer nein). Das ist die dritte Partei am Tisch und der Grund, warum der reichste Verein nicht automatisch jeden bekommt.

---

## 7. Kader und Aufstellung

### 7.1 Was der Spieler einstellt

- **Formation** aus 6–8 Presets (4-4-2, 4-3-3, 3-5-2, 5-3-2, 4-2-3-1 …)
- **Startelf + 5 Bank**, Drag & Drop, mit Auto-Aufstellung als Default
- **Drei Taktikregler:** Tempo (kontrolliert ↔ direkt), Pressing (tief ↔ hoch), Risiko (defensiv ↔ offensiv)
- **Angriffsfokus:** links / zentral / rechts
- **Rollen:** Kapitän, Elfmeter, Standards
- **Eine Spielanweisung** pro Partie (z. B. "Gegenspieler XY doppeln", "Zeit spielen ab Führung")

### 7.2 Positionstreue und Chemie

- Spieler außerhalb ihrer Position: −10 bis −25 OVR je nach Distanz.
- **Kabinenklima** (0–100): sinkt durch zu viele Ego-Spieler, durch Gehaltsungerechtigkeit (ein Spieler verdient >2,5× den Kaderdurchschnitt) und durch unzufriedene Bankdrücker. Bei niedrigem Klima: −Form für alle, höhere Ereignisrate.
- Das **Kabinenklima ist die zweitwichtigste Anti-Snowball-Mechanik**: Elf gekaufte Superstars sind nachweislich schlechter als acht Stars und drei zufriedene Rollenspieler.

### 7.3 Aufwand für den Spieler

Wer nichts tut, bekommt die letzte Aufstellung mit automatischer Ersetzung von Verletzten. Ein aufmerksamer Spieler gewinnt vielleicht 5–8 % Teamstärke gegenüber Autopilot. Das ist genug Belohnung für Aufmerksamkeit und wenig genug, dass ein verpasster Tag nicht die Saison kostet.

---

## 8. Spielsimulation

### 8.1 Modell

Ereignisbasierte **Ballbesitz-Ketten-Simulation**, ca. 90 Ticks à 1 Spielminute, serverseitig, deterministisch aus einem gespeicherten Seed.

Pro Tick:
1. Ballbesitz wird zwischen den Teams entschieden (gewichtet nach Übersicht + Zweikampf + Pressing + Heimvorteil).
2. Die ballbesitzende Mannschaft versucht Raumgewinn (Tempo, Technik vs. Zweikampf).
3. Bei erfolgreichem Vordringen: Chance mit einem xG-Wert aus Torabschluss vs. Torwart + Positionsqualität.
4. Nebenereignisse: Fouls, Karten, Verletzungen, Standards.

Der Ticker protokolliert 15–25 Schlüsselmomente in natürlicher Sprache, plus Statistik (Ballbesitz, Schüsse, xG, Zweikämpfe, Noten).

### 8.2 Varianz (der wichtigste Balancing-Parameter des Spiels)

Zielkurve für die Siegwahrscheinlichkeit:

| Stärkedifferenz | Sieg Favorit | Unentschieden | Sieg Außenseiter |
|---|---|---|---|
| 0 (gleich stark) | 38 % | 24 % | 38 % |
| +5 OVR | 50 % | 23 % | 27 % |
| +10 OVR | 62 % | 20 % | 18 % |
| +20 OVR (extrem) | 76 % | 15 % | 9 % |

Selbst ein um 20 OVR überlegenes Team verliert also jedes elfte Spiel. **Das ist Absicht.** Ein Spiel, in dem der stärkste Kader 95 % der Spiele gewinnt, ist nach drei Spieltagen entschieden und die Gruppe hört auf zu spielen. Fußball ist emotional attraktiv *weil* er ungerecht ist — dieses Design lehnt sich bewusst an die reale Varianz an.

### 8.3 Modifikatoren

| Faktor | Effekt |
|---|---|
| Heimvorteil | +3 bis +7 Teamstärke, skaliert mit Auslastung × Fanstimmung |
| Form | ±6 pro Spieler |
| Fitness < 70 | linear abnehmende Leistung, Verletzungsrisiko ↑ |
| Kabinenklima | ±5 Teamstärke |
| Derby | +Varianz, +Kartenrisiko, Big-Game-Player-Bonus |
| Taktik-Konter | Rock-Paper-Scissors-Schicht, max. ±4, damit Lesen des Gegners belohnt wird ohne zu dominieren |

### 8.4 Präsentation

Der Ticker wird **nicht in Echtzeit über 90 Minuten** ausgerollt, sondern in einer 60–90-Sekunden-Wiedergabe, überspringbar. Wer zur Anstoßzeit da ist, sieht ihn gemeinsam mit den anderen (mit Live-Reaktionen im Chat). Wer später kommt, sieht dasselbe als Zusammenfassung.

---

## 9. Liga-System

### 9.1 Format

- Doppelrunde, jeder gegen jeden, Hin- und Rückspiel. Bei 6 Spielern: 10 Spieltage.
- 3 / 1 / 0 Punkte. Tiebreaker: Direktvergleich → Tordifferenz → Tore.
- Ein Spieltag pro Tag, feste Uhrzeit, alle Partien gleichzeitig (Konferenz-Ansicht).

### 9.2 Pokal (parallel, ab MVP+1)

K.-o.-System über die Saison verteilt, mit Losglück und hoher Varianz. Zweck: Auch der Tabellenletzte hat am Spieltag 8 noch etwas zu gewinnen. Preisgeld deutlich, aber nicht liga-entscheidend.

### 9.3 Preisgelder (bewusst flach)

| Platz (bei 6) | Prämie |
|---|---|
| 1 | 9,0 Mio |
| 2 | 7,5 Mio |
| 3 | 6,5 Mio |
| 4 | 6,0 Mio |
| 5 | 5,5 Mio |
| 6 | 5,0 Mio |

Der Abstand zwischen Erstem und Letztem beträgt nur 4 Mio bei einem Startbudget von 25 Mio. **Sportlicher Erfolg soll Ruhm bringen, nicht ökonomische Unschlagbarkeit.** Wer die Liga über Geld dominieren will, muss das über Fans, Stadion und clevere Transfers tun — also über Entscheidungen, nicht über einen Tabellenplatz.

### 9.4 Auf-/Abstieg

Nicht in einer Freundesliga. Stattdessen: Die Tabelle bestimmt die **Draft-Reihenfolge** für Nachwuchstalente in der nächsten Saison (invers) und die Reihenfolge der Sponsorenwahl (invers). Der Letzte wird belohnt, ohne dass er dafür verlieren *will*, weil Prestige und Prämien weiterhin am Erfolg hängen.

---

## 10. Ereignissystem

### 10.1 Grundprinzip: Ereignisse sind Entscheidungen, keine Nachrichten

Ein Ereignis ohne Entscheidung ist eine Push-Notification. Ein Ereignis mit zwei schlechten Optionen ist Gameplay. **Mindestens 70 % aller Ereignisse müssen 2–3 Optionen mit echten Trade-offs bieten.** Kein Ereignis darf eine offensichtlich beste Antwort haben.

Beispiel:

> **"Kapitän Duarte fordert einen neuen Vertrag."**
> Er hat 4 der letzten 5 Spiele stark gespielt und weiß es. Sein Berater nennt +60 % Gehalt.
>
> - **Zustimmen** → Moral +20, Kabinenklima −8 (die anderen wollen jetzt auch), Gehaltslast +60 %
> - **Verhandeln** (60 % Erfolg) → +30 % Gehalt, Moral +5. Bei Scheitern: Moral −25, Trait "Söldner" wird aktiv
> - **Ablehnen** → 12.000 gespart pro Spieltag, Moral −30, Fanstimmung −5, 25 % Chance auf Wechselforderung im Winter

### 10.2 Kategorien und Verteilung

| Kategorie | Anteil | Beispiele |
|---|---|---|
| **Kader** | 30 % | Verletzung, Vertragsforderung, Kabinenstreit, Formhoch, Sperre |
| **Wirtschaft** | 20 % | Sponsorangebot, Steuernachzahlung, Merch-Boom, Kreditangebot |
| **Fans** | 15 % | Protest, Choreo, Ultras fordern niedrigere Preise, Fanclub-Gründung |
| **Stadion** | 10 % | Rasenschaden, Sturmschaden, Behördenauflage, Baustellenverzug |
| **Markt** | 15 % | Abwerbeangebot eines Freundes, Talent aufgetaucht, Berater meldet sich |
| **Boulevard** | 10 % | Gerüchte, Skandale, Interview-Entgleisung, Trainerkritik |

### 10.3 Gewichtung nach Situation (getarntes Rubberbanding)

Die Ereigniswahrscheinlichkeit ist **kontextabhängig**, und zwar so, dass es sich wie Erzählung anfühlt und nicht wie eine Handbremse:

| Situation | Häufigere Ereignisse | Narrative Begründung |
|---|---|---|
| Tabellenführer | Abwerbeangebote, Gehaltsforderungen, Erwartungsdruck, Belastungsverletzungen | "Erfolg zieht Aufmerksamkeit an" |
| Tabellenletzter | Talentfund, günstiges Sponsorangebot, Fan-Solidaritätsaktion, motivierter Außenseiter | "Wer nichts zu verlieren hat" |
| Hohe Gehaltsquote | Liquiditätswarnungen, Beraterdruck | "Die Bank ruft an" |
| Serie von 3+ Siegen | Überheblichkeit (Moral-Risiko), Boulevard-Hype, +Merch | "Höhenflug" |
| Serie von 3+ Niederlagen | Fanproteste, Trainerdiskussion, aber auch: Kabinen-Zusammenrücken (+Moral) | "Krisenmodus" |

Wichtig: Das Rubberbanding trifft nie das Spielergebnis direkt. Es trifft das **Umfeld**. Der Führende wird nicht schwächer gemacht — es wird nur teurer und komplizierter, vorne zu bleiben.

### 10.4 Ereignisse, die Freunde verbinden

Die wertvollste Ereignisklasse: Ereignisse, die bei **zwei Spielern gleichzeitig** landen.

- *"Dein Stürmer will unbedingt zu Marcos Verein."* → Marco bekommt zeitgleich: *"Ein unzufriedener Star ist zu haben — 30 % Rabatt, 24 Stunden."*
- *"Ein Sponsor will exklusiv nur einen Verein der Liga."* → Alle bekommen die Ausschreibung, nur einer gewinnt.
- *"Die Fans deines Rivalen verspotten euch."* → Derby-Modifikator für beide.

### 10.5 Dosierung

1–2 Ereignisse pro Verein pro Spieltag. Ein Cooldown pro Ereignistyp (nicht zweimal dasselbe innerhalb von 4 Spieltagen). Kein Ereignis darf mehr als ca. 8 % des Vereinsvermögens auf einen Schlag vernichten — Katastrophen sind unterhaltsam, Willkür ist es nicht.

---

## 11. Fans

### 11.1 Zwei getrennte Werte

Der häufigste Designfehler wäre ein einziger "Fan"-Wert. Es braucht zwei, weil sie unterschiedlich schnell reagieren:

- **Fanzahl** (träge, Wochen): bestimmt Ticketnachfrage-Obergrenze, Merch-Basis, TV-Attraktivität.
- **Fanstimmung** 0–100 (volatil, Tage): bestimmt Auslastung, Heimvorteil, Merch-Multiplikator, Ereignisrisiko.

### 11.2 Erwartungsdifferenz statt Absolutergebnis

Der Kern der Fanmechanik:

```
Stimmungsänderung ≈ (tatsächliche Leistung − erwartete Leistung) × Sensitivität
erwartete Leistung = f(Kaderwert relativ zum Ligadurchschnitt, letzte Saison, Prestige)
```

Ein 1:1 gegen den Tabellenletzten ist für den Meister eine **Katastrophe** (−6 Stimmung) und für den Aufsteiger ein **Fest** (+5). Damit ist reine Stärke keine Freikarte: Wer sich den teuersten Kader kauft, kauft sich gleichzeitig die härtesten Fans.

### 11.3 Weitere Einflüsse

| Faktor | Wirkung |
|---|---|
| Ticketpreis über/unter Referenzpreis | ±0,4 Stimmung pro % Abweichung pro Spieltag |
| Verkauf eines Fanlieblings | −15 sofort |
| Kauf eines Stars | +8 sofort, verpufft in 3 Spieltagen ohne Erfolg |
| Stadionausbau abgeschlossen | +10 |
| Baustelle aktiv | −3 pro Spieltag |
| Eigengewächs in der Startelf | +1 pro Spieltag |
| Derby gewonnen / verloren | +12 / −12 |

### 11.4 Stimmungszonen

| Zone | Stimmung | Effekte |
|---|---|---|
| Euphorie | 85–100 | Auslastung 100 %, Heimvorteil max, Merch ×1,4, Fanzahl wächst |
| Zufrieden | 60–84 | Normalbetrieb |
| Unruhig | 35–59 | Auslastung −20 %, Protestereignisse möglich |
| Feindselig | 0–34 | Auslastung −45 %, Heimvorteil = 0, Spielermoral −10, Boykotte, Abwanderung |

Die Feindselig-Zone ist eine echte Todesspirale — deshalb muss sie **immer mit Aufwand verlassen werden können** (Ticketpreis senken, Fanaktion finanzieren, Eigengewächs aufstellen, Derby gewinnen). Eine Spirale ohne Ausgang ist Frust, eine mit teurem Ausgang ist Drama.

---

## 12. Stadion

### 12.1 Ausbaustufen

| Stufe | Kapazität | Kosten | Bauzeit |
|---|---|---|---|
| 1 (Start) | 8.000 | — | — |
| 2 | 14.000 | 6 Mio | 3 Spieltage |
| 3 | 22.000 | 12 Mio | 4 Spieltage |
| 4 | 34.000 | 22 Mio | 5 Spieltage |
| 5 | 50.000 | 40 Mio | 6 Spieltage |

Progressiv steigende Kosten bei linear steigendem Ertrag = eingebaute Bremse gegen unendliches Wachstum.

### 12.2 Baustellenrisiko (eine der besten Mechaniken im Spiel)

Während des Baus:
- Kapazität **−35 %** (weniger Ticketeinnahmen genau dann, wenn man Geld gebunden hat)
- Fanstimmung −3 pro Spieltag
- 12 % Chance pro Spieltag auf ein Verzögerungsereignis (+1 Spieltag, +8 % Kosten)

Damit ist "Wann baue ich?" eine echte Risikoentscheidung mit Timing: In der Winterpause bauen (sicher, aber langsam) oder mitten in der Aufholjagd (mutig, kann den Titel kosten). Genau die Art von Entscheidung, über die eine Gruppe streitet.

### 12.3 Module (unabhängig von der Kapazität)

| Modul | Effekt |
|---|---|
| VIP-Logen | +Ticketertrag pro Zuschauer, +Sponsoreninteresse |
| Fanshop | +Merch-Einnahmen |
| Trainingszentrum | +Entwicklungsrate, −Verletzungsrisiko |
| Medizinische Abteilung | −Verletzungsdauer |
| Rasenheizung / Flutlicht | −Ausfallrisiko-Ereignisse |

### 12.4 Verfall

Der Stadionzustand sinkt um 1,5 % pro Spieltag. Unter 70 %: Kapazitätsabzüge und Auflagen-Ereignisse. Instandhaltung ist eine langweilige, unvermeidliche Geldsenke — genau deshalb notwendig, damit Kapital nicht endlos akkumuliert.

---

## 13. Finanzen

### 13.1 Abrechnung

Bilanz **pro Spieltag**, sichtbar als kleine, lesbare Aufstellung. Kein Excel — eine Seite, sechs Zeilen, ein Trend-Pfeil.

### 13.2 Einnahmen

| Quelle | Formel (vereinfacht) |
|---|---|
| **Tickets** | Kapazität × Auslastung(Stimmung, Preis, Gegner) × Ticketpreis, nur Heimspiele |
| **Merchandise** | Fanzahl × Basiswert × Stimmungsmultiplikator × (1 + Shop-Modul) |
| **Sponsoren** | Fixum + Erfolgsboni (→ §14) |
| **TV-Gelder** | 60 % Sockel (für alle gleich) + 40 % nach Tabellenplatz und Fanzahl |
| **Prämien** | Sieg/Unentschieden, Tabellenplatz, Pokal |
| **Transfererlöse** | Verkäufe, Weiterverkaufsbeteiligungen, Leihgebühren |

Der **60-%-Sockel bei den TV-Geldern** ist ein bewusster Anti-Snowball-Hebel und der Grund, warum ein schwacher Verein nie finanziell abstirbt.

### 13.3 Ausgaben

| Posten | Anmerkung |
|---|---|
| **Spielergehälter** | Größter Posten, typisch 45–60 % der Einnahmen. Wächst mit Erfolg. |
| **Transferausgaben** | Einmalig oder in Raten |
| **Stadioninstandhaltung** | Skaliert mit Kapazität — großes Stadion = teure Fixkosten |
| **Personal** | Trainer, Scouts, Physios, Jugendtrainer |
| **Akademie** | Fixkosten pro Stufe |
| **Reparaturen** | Ereignisgetrieben |
| **Zinsen** | Auf laufende Kredite |

### 13.4 Kredite und Insolvenz

- Kreditrahmen: 60 % der erwarteten Saisoneinnahmen. Zins 6–12 % je nach Bonität (Stimmung, Tabellenplatz, Gehaltsquote).
- **Bei Kontostand < 0:** kein Game Over. Stattdessen eine Eskalationsleiter:
  1. Transfersperre
  2. Zwangsverkauf des wertvollsten Spielers unter Marktwert (öffentlich, Boulevard-Schlagzeile)
  3. −3 Punkte in der Tabelle
  4. Notverwaltung: Gehälter werden gedeckelt, alle Spieler mit Ego/Söldner-Trait fordern Wechsel

Bankrott soll **peinlich** sein, nicht endgültig. Ein ausgeschiedener Spieler ist ein Freund, der nicht mehr mitspielt — der teuerste Fehler, den dieses Design machen könnte.

### 13.5 Ticketpreis als aktive Entscheidung

Ein Regler pro Spieltag, mit sofort sichtbarer Prognose ("bei 32 € erwarten wir 71 % Auslastung"). Kurzfristige Gier kostet langfristig Fanstimmung. Einfachste denkbare Mechanik, erzeugt trotzdem jede Saison eine Diskussion.

---

## 14. Sponsoren

### 14.1 Struktur

Drei Slots: **Trikot**, **Stadionname**, **Ausrüster**. Verträge laufen über 1–2 Saisons.

### 14.2 Angebote als Risikoprofil

Bei jeder Neuvergabe stehen drei Angebote zur Wahl, die sich nicht in der Höhe, sondern im **Risikoprofil** unterscheiden:

| Typ | Beispiel |
|---|---|
| **Sicher** | 800k Fixum pro Spieltag, keine Bedingungen |
| **Leistung** | 300k Fixum + 1,5 Mio pro Sieg + 6 Mio bei Meisterschaft |
| **Kontrovers** | 1,6 Mio Fixum, aber −12 Fanstimmung sofort und −1 pro Spieltag ("Wettanbieter", "Investorengruppe aus Übersee") |

Das dritte Angebot ist das interessanteste: Es verwandelt Fanstimmung in eine handelbare Währung. Verzweifelte Vereine nehmen es, und die Freunde werden sie dafür verspotten.

### 14.3 Klauseln

Sponsoren können Bedingungen stellen: "Mindestens 3 Eigengewächse im Kader", "Kein Transfer über 20 Mio", "Top-3-Platzierung, sonst Vertragsstrafe". Diese Klauseln sind für die Gruppe **öffentlich sichtbar** — womit ein Freund gezielt Druck aufbauen kann, indem er den Spieler abwirbt, den man laut Vertrag halten muss.

---

## 15. Jugendakademie

### 15.1 Stufen

| Stufe | Aufbaukosten | Laufende Kosten/Spieltag | Talente pro Jahrgang | Potenzialrange |
|---|---|---|---|---|
| 0 | — | 0 | 1 | 45–62 |
| 1 | 4 Mio | 120k | 2 | 52–70 |
| 2 | 9 Mio | 260k | 2 | 58–78 |
| 3 | 18 Mio | 500k | 3 | 63–86 |

### 15.2 Jahrgang

Alle 5 Spieltage erscheint ein Jahrgang. Jedes Talent hat: sichtbare Attribute, **verdecktes Potenzial** (nur als Scouting-Range), Alter 16–19, minimales Gehalt, Trait "Eigengewächs".

### 15.3 Warum die Akademie zentral ist

Die Akademie ist die **strategische Antwort der Armen**. Sie ist:
- die einzige Quelle für Spieler mit fast keinen Gehaltskosten,
- die einzige Möglichkeit, Wert zu *erzeugen* statt zu kaufen,
- ein Fanstimmungs-Generator (Eigengewächse in der Startelf),
- ein Exportgeschäft ("Talent für 14 Mio an den Freund verkauft, der es dann verheizt").

Sie amortisiert sich frühestens nach 1,5 Saisons — also eine echte Wette gegen die Gegenwart. Genau das braucht ein Spiel, das über mehrere Saisons tragen soll.

### 15.4 Draft-Priorität

Die Talent-Verteilung pro Jahrgang folgt (bei gleicher Akademiestufe) der **inversen Tabelle**. Der Letzte sieht seinen Jahrgang zuerst und darf zuerst zugreifen.

---

## 16. Freundesinteraktionen

Dieser Abschnitt entscheidet, ob das Spiel gespielt oder nach vier Tagen deinstalliert wird. Alles hier ist Kernfeature, nichts ist Beiwerk.

### 16.1 Der Liga-Feed

Ein gemeinsamer chronologischer Kanal, in dem automatisch alles Peinliche und alles Beeindruckende auftaucht:

> ⚡ *"Marco zahlt 22 Mio für Okonkwo — 140 % über Marktwert. Experten sprechen von Panik."*
> 💸 *"Lisas Verein rutscht ins Minus. Die Bank hat angerufen."*
> 🔥 *"Toms Fans fordern seinen Rücktritt nach dem 0:4."*
> 🏆 *"Sarah gewinnt zum dritten Mal in Folge. Die Liga schaut zu."*

Emoji-Reaktionen und Kommentare direkt am Eintrag. **Der Feed ist der Motor der Schadenfreude** und der günstigste Retention-Mechanismus, den es gibt: Man öffnet die App, um zu sehen, was den anderen passiert ist.

### 16.2 Verhandlungen (Direkttransfer)

Ein strukturierter Deal-Builder statt Freitext. Zusammensetzbar aus:

- Ablösesumme (auch in Raten über X Spieltage)
- Spieler im Tausch
- Weiterverkaufsbeteiligung (in %)
- Rückkaufoption (Preis, Frist)
- Bonuszahlungen ("+2 Mio, wenn er 5 Tore schießt")
- Leihe mit Kaufpflicht/Kaufoption

Gegenangebote gehen hin und her, alles läuft mit einer Frist. **Ratenzahlung und Weiterverkaufsbeteiligung sind der Schlüssel**: Sie verketten die Vereine der Freunde finanziell über Saisons hinweg. Nach drei Saisons schuldet jeder jedem etwas — und das ist das Fußball-Universum, das im Zielbild steht.

### 16.3 Rivalitäten und Derbys

Rivalitäten entstehen **dynamisch**, nicht per Zuweisung. Ein Rivalitäts-Score zwischen je zwei Vereinen steigt durch: knappe Ergebnisse gegeneinander, gewonnene Bieterkriege gegeneinander, abgeworbene Spieler, Tabellennähe, Kommentare im Feed.

Ab Schwelle wird die Paarung zum **Derby**:
- höhere Varianz, mehr Karten
- doppelte Fanstimmungsänderung (±12)
- Sonderprämie für den Sieger
- eigener Feed-Bereich mit Bilanz ("Marco vs. Tom: 4–1–3")

### 16.4 Nebenwetten

Zwei Spieler können vor einem Spieltag eine Wette abschließen: Geld, ein Spieler, oder eine Demütigung (der Verlierer muss eine Saison lang ein vom Gewinner gewähltes Trikot tragen; sein Vereinsname bekommt einen Zusatz). Freiwillig, beidseitig bestätigt, gedeckelt bei 10 % des Vermögens.

### 16.5 Die Liga-Verfassung

Zwischen zwei Saisons stimmt die Gruppe über Regeländerungen ab (einfache Mehrheit, 3 Vorschläge pro Saison, jeder Spieler darf einen einbringen):

- Gehaltsobergrenze einführen?
- Transfersteuer auf 10 % erhöhen?
- Fremdgehen mit der Außenwelt verbieten?
- Saisonlänge auf Dreifachrunde?
- Solidartopf-Verteilung ändern?

Damit gehört die Liga der Gruppe und nicht dem Entwickler. Das ist der stärkste denkbare Langzeit-Bindungsmechanismus und kostet fast nichts an Implementierung.

---

## 17. Saison-System

### 17.1 Mehrere Wettbewerbe um mehrere Titel

Am Saisonende wird **nicht ein Sieger** gekürt, sondern acht:

| Trophäe | Kriterium | Prestige |
|---|---|---|
| 🏆 **Meister** | Tabellenerster | 10 |
| 💰 **Reichster Verein** | Höchstes Kapital | 6 |
| 📣 **Größte Fanbase** | Meiste Fans | 6 |
| 💎 **Wertvollster Kader** | Höchster Kaderwert | 5 |
| 📈 **Bester Transfer** | Größte Wertsteigerung eines gekauften Spielers | 6 |
| 🚀 **Größter Aufsteiger** | Beste Platzverbesserung ggü. Vorsaison / Erwartung | 6 |
| ⚽ **Torschützenkönig** | Meiste Tore (Spielerauszeichnung, Prestige an den Verein) | 4 |
| 🎓 **Talentschmiede** | Wertvollstes selbst ausgebildetes Talent | 5 |

Und, weil Schadenfreude ein Kernziel ist, zwei negative Auszeichnungen:

| Anti-Trophäe | Kriterium |
|---|---|
| 🤡 **Fehleinkauf der Saison** | Größter Wertverlust nach Kauf |
| 🔥 **Sturz der Saison** | Größter Absturz gegenüber Erwartung |

### 17.2 Warum das mechanisch wichtig ist

Wenn nach Spieltag 6 die Meisterschaft entschieden ist, kämpfen die anderen fünf Spieler immer noch aktiv um sechs weitere Trophäen — mit *unterschiedlichen*, teils gegenläufigen Strategien. Der Spieler, der auf "Reichster Verein" spielt, verkauft am letzten Transfertag seine Stars an den Titelanwärter und beeinflusst damit die Meisterschaft. **Multi-Ziel-Design ist die eleganteste Lösung gegen tote Saisonphasen.**

### 17.3 Saisonabschluss

Eine geführte Abschluss-Sequenz (die "Gala"): Trophäenvergabe, Bilanz, Highlights, Rekorde, die ewige Tabelle, ein automatisch generierter Saisonrückblick pro Verein, teilbar als Bild in den echten Gruppenchat.

---

## 18. Fortschritt zwischen Saisons

Ablauf der Zwischensaison (3–5 Tage Echtzeit, mit eigenen Entscheidungspunkten):

1. **Ehrungen & Prestige-Verbuchung** (§17)
2. **Alterung:**
   - 16–23: Entwicklung +2 bis +8 OVR, abhängig von Einsatzzeit, Trainingszentrum, Potenzial
   - 24–28: Stabil, ±2
   - 29–32: −1 bis −3
   - 33+: −3 bis −7, Rücktrittswahrscheinlichkeit steigt
3. **Potenzial-Enthüllung:** Bei Spielern über 24 wird das echte Potenzial sichtbar. Der Moment, in dem sich zeigt, wer beim Draft richtig lag.
4. **Rücktritte** und Nachrücken von Talenten in den Kader
5. **Vertragsablauf:** Auslaufende Verträge → Verlängerungsverhandlung oder ablösefreier Abgang in den Pool
6. **Bauprojekte** werden fertiggestellt
7. **Sponsoren-Neuvergabe** in inverser Tabellenreihenfolge
8. **TV-Vertrag** wird auf Basis der Ligagesamtattraktivität neu berechnet (steigt, wenn die Liga insgesamt wächst → gemeinsames Interesse an einem gesunden Universum)
9. **Talent-Draft** in inverser Tabellenreihenfolge
10. **Liga-Abstimmung** über Regeländerungen (§16.5)
11. **Neuer Spielerpool** aus der Außenwelt, kalibriert auf die Ligastärke
12. **Neue Saisonziele** vom Vorstand, basierend auf relativem Kaderwert

**Was persistiert:** Kapital, Kader, Stadion, Akademie, Fans, Prestige, Rivalitäten, Schulden, Klauseln, Rekorde, Feed-Historie.
**Was zurückgesetzt wird:** Tabelle, Form, Saisonziele, Sponsorenboni, Verletzungen.

**Neue Spieler mittendrin:** Wer später zur Gruppe stößt, startet mit dem Median-Vermögen der Liga, einem Basisstadion und erstem Zugriff auf den Talent-Draft. Nicht mit dem Startbudget von Saison 1 — sonst ist er chancenlos und hört nach zwei Tagen auf.

---

## 19. Balancing

### 19.1 Startwerte im Verhältnis (die eigentlichen Balancing-Zahlen)

| Verhältnis | Zielwert | Warum |
|---|---|---|
| Startbudget / durchschnittlicher Marktwert Spitzenspieler | 25 Mio / 18 Mio ≈ 1,4 | Man kann sich **einen** Star leisten, nicht zwei. Erzwingt Prioritäten. |
| Saisoneinnahmen / Startbudget | ≈ 1,1 | Eine Saison verdoppelt das Vermögen nicht. |
| Gehaltslast / Einnahmen (gesund) | 45–60 % | Darüber wird es eng, darunter verschenkt man Potenzial. |
| Prämienspanne 1. vs. letzter Platz | ≤ 20 % der Saisoneinnahmen | Erfolg zahlt sich aus, aber nicht entscheidend. |
| Stadion-Amortisation Stufe 2 | ≈ 8 Spieltage | Fast eine Saison — echte Investitionsentscheidung. |
| Akademie-Amortisation Stufe 1 | ≈ 1,5 Saisons | Langfristwette. |

### 19.2 Anti-Snowball: die neun Bremsen

Das ausdrücklich wichtigste Designproblem. Eine einzelne Bremse reicht nicht — es braucht ein Netz, in dem jede Bremse an einem anderen Punkt greift und **keine sich wie eine Bestrafung anfühlt.**

| # | Mechanik | Greift bei | Wirkung | Fühlt sich an wie |
|---|---|---|---|---|
| **1** | **Erwartungsdruck** (§11.2) | Hoher Kaderwert | Fans messen relativ; Siege werden erwartet, Unentschieden bestraft | Ruhm hat Verpflichtungen |
| **2** | **Gehaltsspirale** (§6.2, §4.4) | Erfolg, hohe Ablösen | Gehaltsforderungen skalieren superlinear mit OVR und Erfolg | Stars sind teuer |
| **3** | **Kabinenklima** (§7.2) | Zu viele Stars | Gehaltsungerechtigkeit und Ego senken die Teamleistung | Eine Mannschaft, keine Sammlung |
| **4** | **Abnehmender Grenznutzen** | Kaderqualität | Teamstärke wächst logarithmisch, nicht linear; die Elf ist gedeckelt | Der elfte Star bringt kaum was |
| **5** | **Hohe Simulationsvarianz** (§8.2) | Immer | Selbst +20 OVR gewinnt nur 76 % | Fußball halt |
| **6** | **Ereignisgewichtung** (§10.3) | Tabellenführung | Mehr Abwerbeversuche, Belastungsverletzungen, Forderungen | Erfolg zieht Aufmerksamkeit an |
| **7** | **Flache Prämien & TV-Sockel** (§9.3, §13.2) | Immer | Erfolg zahlt Ruhm, nicht Dominanz | Solidarische Liga |
| **8** | **Inverse Prioritäten** (§9.4, §15.4, §18) | Schlechte Platzierung | Erster Zugriff auf Talente und Sponsoren | Wer unten steht, bekommt Perspektive |
| **9** | **Solidarabgabe** (§19.5) | Vermögen > 180 % Ligadurchschnitt | Progressive Abgabe in den gemeinsamen Topf | Neid-Steuer |

**Zusätzlich, sozial statt mechanisch:** Die anderen fünf Spieler *können sich absprechen*. Wenn einer davonzieht, hat die Gruppe die Werkzeuge — gemeinsam überbieten, ihm nichts verkaufen, ihn im Derby als Ziel markieren, per Verfassung eine Gehaltsobergrenze beschließen. Das ist der beste Anti-Snowball-Mechanismus überhaupt, weil er von den Spielern kommt und nicht vom System.

### 19.3 Was ausdrücklich *nicht* gemacht wird

- **Kein direktes Gummiband auf Spielergebnisse.** Wenn Spieler merken, dass die Sim sie beim Führen benachteiligt, verlieren sie sofort das Vertrauen. Alle Bremsen greifen im *Umfeld*, nie im Spiel selbst.
- **Kein Reset.** Fortschritt persistiert, sonst gibt es kein Universum.
- **Keine Belohnung für Passivität.** Alle Aufholmechaniken (Talente, Sponsoren, Draft-Priorität) erfordern eine *Entscheidung*, um Wert zu erzeugen. Wer schlecht spielt und nichts tut, bleibt schlecht.

### 19.4 Anti-Runaway-Ziel in Zahlen

- Der Spieltag, an dem die Meisterschaft rechnerisch entschieden ist, soll bei **≥ 80 % der Spieltage** liegen (bei 10 Spieltagen also frühestens Spieltag 8).
- Der Vermögens-Gini-Koeffizient der Liga soll am Saisonende **unter 0,35** liegen.
- Kein Verein soll nach Saison 3 mehr als **2,2× den Kaderwert** des schwächsten Vereins haben.
- **Mindestens 4 verschiedene Spieler** sollen über eine 3-Saisons-Historie mindestens eine Trophäe gewonnen haben.

Diese vier Zahlen sind die Balancing-Abnahmekriterien. Wenn sie nicht erreicht werden, sind die Bremsen in §19.2 zu schwach eingestellt.

### 19.5 Solidartopf

Gespeist aus: 5 % Transfersteuer, Strafzahlungen, progressive Abgabe der Reichsten. Ausgeschüttet am Saisonende in inverser Tabellenreihenfolge. Öffentlich sichtbar, weil "Marco hat 3 Mio in den Topf gezahlt, Tom hat 3 Mio bekommen" ein Gesprächsanlass ist.

### 19.6 Telemetrie für das Live-Balancing

Zu messen ab dem ersten Playtest: Spieltag der Meisterschaftsentscheidung, Vermögens-Gini, Auktionsbeteiligung pro Spieler, Anteil Auktionen mit ≥3 Bietern, durchschnittliche Ablöse/Marktwert-Ratio, Anteil Spieler mit Autopilot-Aufstellung, Sitzungen pro Spieler pro Spieltag, Abbruchspieltag bei Aussteigern, Verteilung der Trophäen.

---

## 20. MVP — die erste spielbare Version

Ziel des MVP: **eine vollständige Saison mit 4–6 Freunden durchspielen** und beantworten, ob die Gruppe nach dem Saisonende eine zweite Saison starten will. Das ist die einzige Metrik, die zählt.

### 20.1 Im MVP enthalten

| Bereich | Umfang |
|---|---|
| **Lobby** | Liga erstellen, Beitritt per Code, 4–6 Spieler, Vereinsname + Farben |
| **Start** | Gleiche Startwerte, 5 Jugendspieler, Spielerpool |
| **Auktion** | Asynchrone Auktionen mit Soft-Close, Escrow, Proxy-Gebot, sichtbare Bieter |
| **Kader** | 4 Formationen, Startelf + Bank, 3 Taktikregler, Auto-Aufstellung |
| **Simulation** | Ballbesitz-Ketten-Sim, Textticker, Statistik, deterministischer Seed |
| **Liga** | Doppelrunde, Tabelle, Spielplan, 1 Spieltag/Tag |
| **Ereignisse** | 20 handgeschriebene Ereignisse, davon 14 mit Entscheidungen |
| **Fans** | Fanzahl + Stimmung, Erwartungsdifferenz-Modell |
| **Stadion** | 3 Ausbaustufen, Bauzeit, Baustellenmalus, Zustand/Instandhaltung |
| **Finanzen** | Spieltagsbilanz, Tickets, Merch, TV, 1 Sponsorenslot, Gehälter, Kredit |
| **Transfers** | Auktionshaus + einfacher Direkttransfer (Geld gegen Spieler) |
| **Akademie** | Stufe 0–1, ein Talentjahrgang pro Saison |
| **Social** | Liga-Feed mit Auto-Meldungen, Emoji-Reaktionen, Gruppenchat |
| **Saisonende** | 5 Trophäen (Meister, Reichster, Fanbase, Kaderwert, Bester Transfer) + 1 Anti-Trophäe |
| **Technik** | Server-autoritativ, Push-Benachrichtigungen (Überboten / Spieltag / Ereignis) |

### 20.2 Explizit *nicht* im MVP

Pokalwettbewerb · Leihgeschäfte · Weiterverkaufsbeteiligung und Rückkaufoptionen · Ratenzahlung · Personal (Trainer/Scouts) · Stadionmodule · Nebenwetten · Liga-Verfassung/Abstimmung · Dynamische Derbys · Verdeckte Auktionen · Mehrere Sponsorenslots · Live-Draft-Night-Modus · Mehrere parallele Ligen · Akademiestufen 2–3

Diese Liste ist keine Absage — es ist die Reihenfolge des Ausbaus. Jeder Punkt hat einen klaren Platz in einem Post-MVP-Release.

### 20.3 Was im MVP überdurchschnittlich gut sein muss

Drei Dinge tragen das gesamte MVP. Wenn eines davon mittelmäßig ist, funktioniert nichts:

1. **Die Auktion.** Sie muss sich schnell, spannend und absolut fair anfühlen. Push-Benachrichtigung "Du wurdest überboten" innerhalb von Sekunden. Kein Zweifel darf jemals daran aufkommen, dass die Auktion sauber gelaufen ist.
2. **Der Liga-Feed.** Er ist der Grund, warum jemand die App am nächsten Morgen öffnet. Die Texte müssen gut geschrieben, bissig und spezifisch sein — kein Generator-Kauderwelsch.
3. **Der Spieltag-Moment.** Um 20:00 passiert etwas. Alle bekommen gleichzeitig eine Benachrichtigung. Das ist das Herz des Produkts.

### 20.4 Grober Aufwandsrahmen

| Phase | Inhalt | Wochen (1–2 Entwickler) |
|---|---|---|
| 0 | Datenmodell, Server, Auth, Lobby | 2–3 |
| 1 | Spielergenerator, Kader, Simulation, Ticker | 3–4 |
| 2 | Auktionssystem inkl. Escrow und Soft-Close | 2–3 |
| 3 | Wirtschaft, Fans, Stadion, Bilanz | 2–3 |
| 4 | Ereignissystem + 20 Ereignisse | 1–2 |
| 5 | Feed, Push, Saisonende, Trophäen | 2 |
| 6 | Balancing-Playtest mit echter Gruppe | 2–3 |

Realistisch **14–20 Wochen** bis zur ersten vollständigen Testsaison.

### 20.5 Playtest-Plan

1. **Solo-Simulation:** 1.000 Saisons headless durchrechnen, gegen die Zielwerte aus §19.4 prüfen.
2. **Trockentest:** Auktion allein mit 4 Testkonten, ohne Liga.
3. **Kurzsaison:** 6 Spieltage mit echter Gruppe, 2 Spieltage pro Tag.
4. **Vollsaison:** 10 Spieltage im echten Rhythmus. Erfolgskriterium: **≥ 80 % der Gruppe wollen Saison 2.**

---

## 21. Die 5–10 Mechaniken, die dieses Spiel einzigartig machen

Aus allem oben stehenden die Mechaniken, die es so in keinem Fußballmanager gibt und die den Charakter des Spiels ausmachen — in der Reihenfolge ihrer Bedeutung:

### 1. Der geteilte Transfermarkt als soziale Arena
Ein Markt, ein Pool, alle Freunde. Jeder Kauf ist zugleich ein Entzug bei jemand anderem. Klassische Manager simulieren einen anonymen Markt; hier hat jedes Gebot ein Gesicht. **Das ist der Kern des gesamten Spiels — alles andere ist darum herum gebaut.**

### 2. Der Fluch des Gewinners als Waffe
Weil die Gehaltsforderung mit der Ablöse skaliert (§6.2), kann man einen Freund gezielt in einen ruinösen Sieg treiben, ohne selbst zu kaufen. *Man kann jemanden schädigen, indem man ihn gewinnen lässt.* Diese eine Formel erzeugt mehr Verhandlung, Bluff und Paranoia als jedes andere System im Dokument.

### 3. Erwartungsdruck statt Absolutleistung
Fans bewerten den Verein relativ zu seinem Kaderwert (§11.2). Der teuerste Kader hat automatisch die unzufriedensten Fans. Damit ist der Anti-Snowball-Mechanismus keine aufgesetzte Regel, sondern **narrativ vollkommen plausibel** — und genau deshalb funktioniert er, ohne dass sich der Führende betrogen fühlt.

### 4. Verdecktes Potenzial und die Enthüllung nach der Saison
Man bietet auf eine Range, nicht auf eine Zahl. Zwei Saisons später zeigt sich, wer recht hatte. Der 22-Mio-Flop und das 800k-Wunder sind die Geschichten, die die Gruppe jahrelang erzählt — und der Preis für einen Fehlkauf ist nicht nur Geld, sondern eine Anti-Trophäe und ein Feed-Eintrag.

### 5. Der Liga-Feed als öffentliche Demütigungsmaschine
Ein automatisch geschriebener Boulevard-Kanal, der Fehler sichtbar macht: Panikkäufe, Kontostände im Minus, Fanproteste, verlorene Serien. Schadenfreude ist ein erklärtes Designziel — dieser Feed ist das Werkzeug dafür und gleichzeitig der stärkste Retention-Treiber im Produkt.

### 6. Verkettete Deals über Saisonsgrenzen hinweg
Ratenzahlung, Weiterverkaufsbeteiligung, Rückkaufoption, Bonusklauseln (§16.2). Nach drei Saisons schuldet jeder jedem etwas, und ein Transfer von vor zwei Jahren spült plötzlich Geld an einen Rivalen. **Das ist der Mechanismus, der aus einer Liga ein Universum macht.**

### 7. Multi-Trophäen statt eines Siegers
Acht Titel und zwei Anti-Titel (§17.1) mit teils gegenläufigen Strategien. Kein toter Saisonabschnitt, kein Spieler ohne Ziel, und ein Kingmaker-Effekt am letzten Transfertag, wenn der Kandidat für "Reichster Verein" entscheidet, wem er seine Stars verkauft.

### 8. Baustellenrisiko
Ein Stadionausbau macht dich für vier Spieltage **schwächer und ärmer** (§12.2). Damit ist die klassisch langweilige Manager-Investition ("Gebäude bauen") plötzlich eine Timing-Entscheidung mit echtem Risiko und potenzieller Schadenfreude.

### 9. Die Liga-Verfassung
Die Gruppe stimmt zwischen den Saisons über Regeln ab (§16.5). Gehaltsobergrenzen, Steuersätze, Saisonlänge. Kein Fußballspiel gibt seinen Spielern die Regelhoheit — und für eine Freundesgruppe ist genau das der Unterschied zwischen "ein Spiel spielen" und "unsere Liga führen".

### 10. Fanstimmung als handelbare Währung
Der kontroverse Sponsor (§14.2), der hohe Ticketpreis, der verkaufte Fanliebling: Man kann Fanwohlwollen jederzeit in Bargeld tauschen. Damit wird ein weicher Wert zu einer echten Ressource mit Wechselkurs — und jede verzweifelte Entscheidung ist öffentlich sichtbar.

---

## 22. Offene Fragen für die nächste Runde

1. **Live-Draft oder rein asynchron?** Der Live-Modus ist emotional deutlich stärker, aber terminabhängig. Empfehlung: async bauen, Live als Aufsatz.
2. **Wie viele Spieler kennt der Markt?** Ein handkuratierter Pool von ca. 400 Spielern erzeugt Wiedererkennung über Saisons ("der alte Ferreira!"); ein prozeduraler Generator skaliert besser. Empfehlung: kuratierter Kern + prozedurale Ergänzung.
3. **Sichtbarkeit der Bieter:** Namen zeigen (mehr Trash-Talk, aber auch mehr gezielte Preistreiberei) oder anonym? Empfehlung: sichtbar, weil Konflikt gewollt ist.
4. **Zeitzonen** in verteilten Freundesgruppen — eine feste Lobby-Zeit oder pro Spieler verschobene Fenster?
5. **Aussteiger mitten in der Saison:** Vereinsübernahme durch einen neuen Freund, KI-Übernahme oder Auflösung? Empfehlung: KI-Übernahme im Autopilot, Übergabe jederzeit möglich.
6. **Plattform:** Native App (bessere Push-Erfahrung, entscheidend für die Auktion) oder Web/PWA (schnellere Iteration)? Empfehlung für den MVP: PWA mit Web-Push, native App nach dem ersten erfolgreichen Playtest.
