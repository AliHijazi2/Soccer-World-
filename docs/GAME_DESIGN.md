# Soccer World — Game Design Document

**Version:** 0.3 — alle Weichenstellungen entschieden, baubereit (siehe §23 Entscheidungsprotokoll)
**Genre:** Asynchrones Multiplayer-Strategie- und Wirtschaftsspiel im Fußballkontext
**Zielgruppe:** Geschlossene Freundesgruppen, real 3–4 Spieler, ausgelegt bis 8
**Plattform:** Web-App und mobile App
**Status:** Konzeptphase — noch keine Implementierung
**Pitch:** *Ihr baut gemeinsam ein Fußball-Universum auf — und ruiniert euch dabei gegenseitig die Transfers.*

---

## 0. Rahmenbedingungen und Annahmen

### 0.1 Festgelegt

| # | Entscheidung |
|---|---|
| F1 | **3–8 Spieler pro Liga**, realistisch 3–4. Bei ungerader Spielerzahl füllt ein **Bot-Verein** auf (→ §9.5). |
| F2 | **Asynchron.** Spieler öffnen die App 1–3× täglich für je 3–8 Minuten. |
| F3 | **Eine Saison = 7 Tage = 21 Spieltage**, drei Anstöße täglich um **17:00, 20:00 und 22:00**. Die Zahl 21 ist fix, unabhängig von der Spielerzahl. |
| F4 | **Der Transfermarkt ist ab Lobbystart durchgehend offen**, die ganze Saison über. Keine Transferfenster. |
| F5 | **Ein Marktabschluss pro Tag:** Alle Auktionen enden gestaffelt zwischen **16:00 und 17:00**, vor dem Abendblock. |
| F6 | **Keine zusätzliche Marktbremse.** Neuzugänge sind sofort voll einsatzfähig, keine Eingewöhnungszeit, keine steigende Transfersteuer, kein Kaderlimit. |
| F7 | **Echte Profis** mit realen Namen. Privates Projekt ohne kommerzielle Veröffentlichung. Startpool 150 Spieler, gestaffelt nach Qualität, später erweiterbar. |
| F8 | **Keine Jugendakademie.** Spieler kommen ausschließlich über den Transfermarkt. |
| F9 | **Eine Aufstellung pro Verein**, jederzeit änderbar, gilt für alle kommenden Spieltage. |
| F10 | **90-Sekunden-Ticker** pro Partie, live oder später abrufbar. |
| F11 | **Ereignisse 1–2 pro Tag**, morgens gebündelt im Posteingang. 7–14 pro Saison. |
| F12 | **Boulevard-Ton**, bissig und zugespitzt, mit ernsthaft gerechneter Simulation darunter. |
| F13 | **Ausgeglichenes Balancing** nach den Zielwerten in §19.4. |
| F14 | **Bieter sind namentlich sichtbar.** |
| F15 | **Ligastart per Bereit-Button**, spätestens nach 24 Stunden automatisch. **Zwischensaison per Bereit-Button**, spätestens nach 48 Stunden. |
| F16 | **Bei ungerader Spielerzahl spielt ein Bot-Verein mit**, damit jeder an jedem Spieltag antritt. Keine Freilose. |
| F17 | **Spieler haben kein Vetorecht.** Über einen Transfer entscheidet allein der abgebende Verein; freie Agenten gehen immer an den Höchstbieter. |
| F18 | **Spieler können entlassen werden** gegen eine Abfindung von 50 % des Restgehalts. |
| F19 | **Kein Urlaubs- oder Abwesenheitsmodus.** Wer nicht da ist, spielt mit der letzten Aufstellung plus Auto-Korrektur. |
| F20 | **Feed- und Ereignistexte aus handgeschriebenen Templates** mit Platzhaltern, kein Sprachmodell zur Laufzeit. |

### 0.2 Offene Annahmen (meine Setzung, änderbar)

| # | Annahme | Warum |
|---|---|---|
| A1 | **Der Bot-Kader wird aus dem Reservebestand bestückt und auf den Median der menschlichen Vereine kalibriert** — nicht aus dem aktiven Marktpool. | Der Bot soll auffüllen und Maßstab sein, nicht mit euch um dieselben Spieler konkurrieren. Details und Begründung in §9.5. |
| A2 | **Server ist autoritativ**, Simulation läuft serverseitig mit gespeichertem Seed. | Reproduzierbarkeit, Cheat-Schutz, identischer Ticker für alle. |
| A3 | **Spielerdaten liegen in einer austauschbaren Datenschicht** (JSON/DB, nicht im Code). | Ein späterer Wechsel auf Fantasienamen kostet dann Minuten statt Tage. |
| A4 | **Attributwerte werden selbst gesetzt**, nicht aus einem Fremddatensatz übernommen. | Nur so lässt sich die Simulation überhaupt balancieren. Reale Namen, eigene Zahlen. |
| A5 | **Der aktive Marktpool skaliert mit der Spielerzahl** (Vereine × 16), gezogen aus den 150. | Kritisch: Bei 3 Vereinen und 150 verfügbaren Spielern gäbe es keine Knappheit und damit keine Bieterkriege — der Kern des Spiels würde ausfallen. Details in §5.2. |
| A6 | **Web-App zuerst, mobile App als Wrapper** derselben Codebasis. | "Web und App" mit einer Codebasis. Für Auktionen sind zuverlässige Push-Nachrichten wichtig, deshalb die App. |
| A7 | **Ein Verein, ein Mensch.** Kein Zweitteam-Management. | Interessenkonflikte beim Bieten. |

---

## 1. Core Gameplay Loop

### 1.1 Der Tagesablauf (die eigentliche Struktur des Spiels)

Das Spiel hat einen festen, wiederkehrenden Tagesrhythmus. Das ist bewusst so gebaut: Ein Spiel, das jederzeit alles gleichzeitig verlangt, wird zur Last. Ein Spiel mit drei klaren Phasen wird zur Gewohnheit.

```
 MORGENS      Posteingang: 1–2 Ereignisse mit Entscheidungen
              Bilanz des Vortags, Tabelle, Boulevard-Feed
              ↓
 TAGSÜBER     Transfermarkt: bieten, überbieten, verhandeln
              Aufstellung und Taktik anpassen
              Wirtschaft: Ticketpreis, Bau, Sponsoren
              ↓
 16:00–17:00  MARKTABSCHLUSS — alle Auktionen enden gestaffelt
              Der Nervenkitzel des Tages. Push: "Du wurdest überboten"
              ↓
 17:00        SPIELTAG A  ─┐
 20:00        SPIELTAG B   ├─ 90-Sek-Ticker, automatisch, ohne Eingriff
 22:00        SPIELTAG C  ─┘
              ↓
 ABENDS       Ergebnisse, Tabelle, Trash-Talk, neue Deals anbahnen
```

Der entscheidende Punkt: **Zwischen 17:00 und 22:00 muss niemand etwas tun.** Der Markt ist abgeschlossen, die Aufstellung steht. Man schaut zu und redet. Das ist der Unterschied zwischen einem Spiel, das man eine Woche durchhält, und einem, das nach drei Tagen zur Pflicht wird.

### 1.2 Meso-Loop — die Saison (7 Tage)

```
Lobby & Kaderaufbau (max. 24h) → Tag 1–7 mit je 3 Spieltagen → Saisonabschluss & Ehrungen
```

### 1.3 Macro-Loop — das Universum (unbegrenzt)

```
Saison → Ehrungen & Prestige → Alterung, Verträge, Marktnachschub
       → Liga-Abstimmung → Bereit-Button (max. 48h) → nächste Saison
```

Der Macro-Loop ist das eigentliche Produkt. Eine Woche ist ein Spiel; zehn Wochen sind eine gemeinsame Geschichte. Alles, was Spuren hinterlässt — Vermögen, Stadion, alte Rivalitäten, die ewige Tabelle, offene Ratenzahlungen an Freunde — zahlt darauf ein.

---

## 2. Spielstart

### 2.1 Lobby

Ein Spieler eröffnet eine Liga und lädt per Code ein. Er legt fest: Startbudget, Anstoßzeiten, Saisonstart. Ab Saison 2 werden Regeln nicht mehr vom Host, sondern per Abstimmung geändert (→ §16.5).

### 2.2 Vereinsgründung

Name, Kürzel, Stadt, Trikotfarben, Wappen aus einem Baukasten, optional ein Vereinsmotto, das der Boulevard-Feed später zitieren wird. Kostet nichts, aber Identität ist der günstigste Bindungsmechanismus, den es gibt.

### 2.3 Identische Startbedingungen

| Ressource | Startwert |
|---|---|
| Transferbudget | 400 Mio |
| Stadion | 25.000 Plätze, Zustand 100 % |
| Fanbasis | 350.000 Anhänger, Stimmung 60/100 |
| Kader | leer |
| Sponsor | Übergangsvertrag, läuft nach Spieltag 3 aus |
| Ticketpreis | 40 € (frei änderbar) |

Kein Startkader, keine geschenkten Spieler. Alles kommt vom Markt.

### 2.4 Die Aufbauphase

**Sobald die Lobby steht, ist der Transfermarkt offen.** Es gibt keine separate Draft-Zeremonie — man fängt sofort an zu bieten, zu überbieten und Mannschaften zusammenzustellen.

- **Pflichtkader:** mindestens **14 Spieler**, davon mindestens 1 Torwart und 3 Verteidiger.
- **Bereit-Button:** Wer seinen Kader für fertig hält, drückt "Bereit". Sind alle bereit, startet die Liga zum nächsten regulären Anstoß.
- **24-Stunden-Deadline:** Spätestens 24 Stunden nach Lobbystart beginnt die Liga automatisch. Wer dann keinen vollen Kader hat, bekommt Freie Agenten zugewiesen — die schlechtesten verfügbaren Spieler, zu 120 % Gehalt.
- **Sichtbarer Fortschritt:** Jeder sieht in der Lobby, wie weit die anderen sind ("Marco: 11/14 · 180 Mio übrig"). Das erzeugt Druck, Vergleich und die ersten Gespräche noch vor dem ersten Spieltag.

### 2.5 Onboarding

Kein Tutorial-Level. Sechs Erklärkarten vor dem ersten Gebot ("So verdient dein Verein Geld", "So funktioniert eine Auktion", "Was Fans von dir erwarten"), danach kontextuelle Hinweise beim ersten Auftreten jeder Mechanik. Die Aufbauphase ist das Tutorial, weil sie alles gleichzeitig lehrt.

---

## 3. Vereinssystem

Ein Verein ist die Summe von sechs gekoppelten Werten:

| Attribut | Bedeutung | Verändert sich durch |
|---|---|---|
| **Kapital** | Liquide Mittel | Alles |
| **Kaderwert** | Summe der Marktwerte | Transfers, Entwicklung, Alterung |
| **Fanbasis** | Anzahl Anhänger (träge) | Erfolg, Ticketpreis, Identität, Stadion |
| **Fanstimmung** | 0–100 (volatil) | Ergebnisse, Entscheidungen, Ereignisse |
| **Infrastruktur** | Stadion + Module | Investitionen |
| **Prestige** | Historischer Ruf über alle Saisons | Titel, Rekorde, Rankings |

**Prestige** ist die einzige Größe, die eine Saison überdauert und nicht zurückgesetzt wird. Es öffnet bewusst **keine mechanischen Vorteile** — das wäre Snowball —, sondern kosmetische und narrative: Sterne am Wappen, Vorrang in Boulevard-Schlagzeilen, ein leichter Bonus bei der Spielerüberzeugung ("dieser Verein hat Geschichte"), gedeckelt bei 3 % pro Titel, maximal 12 %.

**Vorstand und Erwartung:** Jeder Verein bekommt zu Saisonbeginn ein Saisonziel, das sich **am Kaderwert relativ zur Liga** bemisst, nicht an absoluter Stärke. Der teuerste Kader bekommt "Meister werden". Der billigste bekommt "Nicht Letzter werden". Das ist der wichtigste Anti-Snowball-Hebel des ganzen Spiels (→ §19.2).

---

## 4. Spielersystem

### 4.1 Attribute

Sechs sichtbare Attribute, 1–99. Mehr wäre Simulationstiefe ohne Entscheidungstiefe.

| Attribut | Wirkt auf |
|---|---|
| **Torabschluss** | Chancenverwertung |
| **Technik** | Ballkontrolle, Dribbling, Standards |
| **Übersicht** | Chancenerzeugung, Aufbauspiel |
| **Zweikampf** | Defensive, Balleroberung |
| **Tempo** | Konter, Raumgewinn, Defensivabsicherung |
| **Torwart** | Nur für TW relevant |

Daraus abgeleitet: **OVR**, positionsgewichtet. Ein Innenverteidiger mit Torabschluss 85 hat trotzdem einen mittelmäßigen OVR — was den Markt interessant macht, weil manche Spieler *aussehen* wie Schnäppchen.

Die Attributwerte werden für alle 150 Spieler von Hand gesetzt und auf die Simulation kalibriert (A4). Reale Namen, eigene Zahlen.

### 4.2 Zustandswerte

- **Alter** (17–38) — bestimmt die Entwicklungsrichtung
- **Potenzial** — **verdeckt**, für Spieler nur als Scouting-Range sichtbar ("74–88, Vertrauen: mittel")
- **Form** (0–100) — schwankt über Spieltage
- **Fitness** (0–100) — sinkt pro Einsatz, regeneriert bei Pausen. Bei 3 Spieltagen täglich der zentrale Ressourcenwert (→ §7.3)
- **Moral** (0–100) — Einsatzzeit, Erfolg, Gehaltsgerechtigkeit, Ereignisse
- **Verletzung** — Dauer in Spieltagen

### 4.3 Traits

Jeder Spieler hat 0–2 Traits. Traits sind keine reinen Boni, sondern **Hooks, an denen das Ereignissystem andockt**. Sie sind der Grund, warum ein Transfer eine Geschichte wird statt einer Zahl.

| Trait | Mechanik | Erzeugt Ereignisse wie |
|---|---|---|
| **Ego** | +3 OVR, verlangt Stammplatz und Spitzengehalt | Kabinenstreit, Wechselforderung |
| **Anführer** | +Moral im gesamten Team | Kapitänsdiskussion |
| **Verletzungsanfällig** | Verletzungsrisiko ×1,8 | Langzeitausfall zum ungünstigsten Zeitpunkt |
| **Big-Game-Player** | +8 Form in Spitzenspielen und Derbys | Heldengeschichten |
| **Publikumsliebling** | Verkauf kostet 15 Stimmungspunkte | Fanproteste bei Transfer |
| **Spätzünder** | Entwicklung erst ab 26 | Der Fehlkauf, der Saison 3 explodiert |
| **Söldner** | Moral hängt fast nur am Gehalt, kaum an Erfolg oder Einsatzzeit | Gehaltsforderungen, Abwerbegerüchte |
| **Hitzkopf** | +20 % Rote-Karte-Risiko, +5 Zweikampf | Sperren, Boulevard |
| **Eisenmann** | −40 % Fitnessverlust pro Einsatz | Der Dauerbrenner im 3-Spiele-Tag |

**Eisenmann** ist bei drei Spieltagen pro Tag der heimlich wertvollste Trait — und genau deshalb ein guter Test, ob Spieler die Fitness-Mechanik verstanden haben.

### 4.4 Verträge

Gehalt pro Spieltag, Laufzeit in Spieltagen, optionale Klauseln (Ausstiegsklausel, Weiterverkaufsbeteiligung, Torbonus). Läuft ein Vertrag aus, ohne dass verlängert wird, ist der Spieler nach der Saison **ablösefrei** — und alle Freunde sehen den Countdown im Kaderprofil. Vertragsmanagement ist eine öffentliche Angreifbarkeit, kein privates Häkchen.

**Vertragsauflösung (F18):** Ein Spieler kann jederzeit entlassen werden. Kosten: **50 % des restlichen Vertragswerts**, sofort fällig. Dazu Fanstimmung −5, bei einem Publikumsliebling −15, und ein Eintrag im Feed.

Das ist bewusst ein **teurer Notausgang**, kein bequemer. Ein Fehlkauf für 90 Mio, den niemand haben will, kostet beim Entlassen immer noch mehrere Millionen — aber man fährt sich nicht unrettbar fest. Ein festgefahrener Freund hört auf zu spielen, und das ist der teuerste Fehler, den dieses Design machen könnte.

### 4.5 Marktwert

```
Marktwert = f(OVR, Alter, Potenzial-Erwartung, Form, Vertragsrestlaufzeit, Positionsknappheit in der Liga)
```

**Positionsknappheit** ist der interessante Term: Wenn zwei von vier Vereinen dringend einen Torwart brauchen, steigt der Marktwert aller Torhüter. Der Markt reagiert damit auf das Verhalten der Freunde, nicht auf eine statische Tabelle.

---

## 5. Transfermarkt

### 5.1 Grundregel: immer offen

**Der Markt ist ab Lobbystart bis zum Saisonende durchgehend geöffnet.** Es gibt keine Transferfenster, keine Eingewöhnungszeit, keine steigende Steuer und kein Kaderlimit (F6). Ein Neuzugang, der um 16:30 den Zuschlag bekommt, kann um 17:00 in der Startelf stehen.

> **Balancing-Hinweis:** Das ist die riskanteste Einzelentscheidung im Design. Sie macht Geld zur mächtigsten Ressource und erlaubt es einem gut laufenden Verein, jede Schwäche sofort wegzukaufen. Die neun Bremsen aus §19.2 wirken weiter, aber ohne Marktbremse müssen sie mehr tragen. **Das ist der Punkt, den der erste Playtest als Erstes messen muss** (→ §19.6). Falls er kippt, ist die kleinste wirksame Korrektur eine dreitägige Eingewöhnungszeit für Neuzugänge — nicht eine Schließung des Marktes.

### 5.2 Der Marktpool — wie Knappheit entsteht

Der Gesamtbestand sind **150 reale Profis**, gestaffelt:

| Stufe | Anzahl | OVR | Marktwertspanne |
|---|---|---|---|
| **Weltklasse** | 30 | 85–94 | 70–150 Mio |
| **Sehr gut** | 50 | 78–84 | 25–65 Mio |
| **Solide** | 70 | 68–77 | 5–22 Mio |

Davon ist nicht alles gleichzeitig verfügbar. **Der aktive Marktpool wird pro Lobby gezogen und skaliert mit der Spielerzahl (A5):**

```
aktiver Pool = Anzahl Vereine × 16 Spieler
davon:  1,5 × Vereine   Weltklasse
        4,0 × Vereine   Sehr gut
       10,5 × Vereine   Solide
```

Bei 4 Vereinen sind das **64 Spieler, davon nur 6 aus der Weltklasse-Stufe.** Vier Vereine, die alle mindestens zwei Superstars wollen, konkurrieren um sechs. Genau daraus entstehen Bieterkriege.

Ohne diese Skalierung wäre der Kern des Spiels tot: 150 Spieler bei 3 Vereinen hieße, jeder bekommt alles, was er will, ohne je zu bieten. **Knappheit ist kein Nebeneffekt, sie ist das Produkt.**

Der Rest der 150 ist Reserve und rückt zwischen den Saisons nach (→ §18) oder taucht durch Ereignisse auf.

### 5.3 Die drei Kanäle

| Kanal | Was |
|---|---|
| **A — Auktionshaus** | Freie Spieler aus dem Pool, von Freunden zum Verkauf gestellte Profis. Öffentliche Auktionen (→ §6). |
| **B — Direkttransfer** | 1:1-Verhandlung zwischen zwei Freunden, mit Tausch, Raten und Klauseln (→ §16.2). |
| **C — Leihe** | Ein Spieler wechselt für X Spieltage, der abgebende Verein zahlt anteilig Gehalt weiter. |

### 5.4 Die Außenwelt

Auf etwa 30 % der Auktionen bietet ein anonymer Auswärtsverein mit — begrenzt, berechenbar, mit einem harten Ceiling bei **90 % des Marktwerts**. Zweck: Der Markt fühlt sich bei nur drei Freunden nicht leer an, und niemand bekommt einen 100-Mio-Star für 2 Mio, nur weil die anderen gerade arbeiten. Die Außenwelt gewinnt nie einen Bieterkrieg gegen einen entschlossenen Menschen.

Die Außenwelt macht außerdem **Kaufangebote** für Spieler in euren Kadern (ereignisgesteuert) — die einzige Möglichkeit, Spieler zu Geld zu machen, ohne sie einem Freund zu überlassen.

Der **Bot-Verein** (§9.5) ist davon strikt getrennt: Er bietet auf keiner Auktion mit und nimmt euch nie einen Spieler weg.

### 5.5 Der tägliche Marktabschluss

Alle Auktionen laufen **24 Stunden** und enden gestaffelt im Fenster **16:00–17:00** (F5), sortiert nach Einstellzeitpunkt, ca. alle 2–4 Minuten eine.

Das erzeugt einen täglichen Spannungsbogen mit sauberer Trennung:

- **17:00 bis 16:00 am Folgetag:** Markt läuft, Gebote sammeln sich
- **16:00–17:00:** eine Stunde geballter Nervenkitzel, Auktion nach Auktion
- **17:00–22:00:** Fußball, Markt ist still

Niemand muss während der Spiele aufs Handy schauen, und niemand muss nachts wach bleiben, um nicht überboten zu werden. Dieses Detail entscheidet darüber, ob die Gruppe das Spiel nach einer Woche noch mag.

---

## 6. Transferregeln und Bieterkriege

### 6.1 Auktionsmechanik

- **Englische Auktion** mit sichtbarem Höchstgebot und **namentlich sichtbaren Bietern** (F14). Schadenfreude braucht einen Adressaten.
- **Mindestschritt:** max(250.000, 3 % des aktuellen Gebots)
- **Soft-Close:** Jedes Gebot in den letzten 3 Minuten verlängert die Auktion um 3 Minuten. Kein Sniping, dafür echte Nervenkriege im Abschlussfenster.
- **Escrow:** Ein Gebot **bindet das Geld sofort**. Man kann nicht auf fünf Spieler gleichzeitig bieten, wenn man nur Geld für zwei hat. Das erzeugt die zentrale strategische Frage: *Wo binde ich meine Liquidität, während der Markt läuft?*
- **Proxy-Gebot:** Optional hinterlegt man ein geheimes Maximum; das System bietet automatisch in Mindestschritten. Unverzichtbar für Async-Fairness — ohne das gewinnt, wer zufällig um 16:47 wach ist.
- **Push-Nachricht** bei Überbieten, innerhalb von Sekunden.

### 6.2 Der Fluch des Gewinners

Die Gehaltsforderung eines Spielers skaliert mit der gezahlten Ablöse:

```
gefordertes Gehalt = Basisgehalt(OVR, Alter) × (1 + 0,35 × max(0, Ablöse/Marktwert − 1))
```

Wer 80 % über Marktwert bietet, zahlt dauerhaft rund 28 % Gehaltsaufschlag. Ein gewonnener Bieterkrieg ist damit **nicht automatisch ein Gewinn** — und die anderen wissen das und können hochtreiben.

Das ist die schärfste Waffe im Spiel: *Man kann einen Freund ruinieren, indem man ihn gewinnen lässt.* Wer hochtreibt und dann selbst gewinnt, zahlt eben. Wer dreimal in Folge Höchstbieter war und ausstieg, bekommt ein sichtbares Boulevard-Etikett ("Preistreiber"). Reputation reguliert das besser als jede Regel.

### 6.3 Verdeckte Auktionen

Für einzelne Highlight-Spieler (1–2 pro Saison, ereignisgesteuert): **ein einziges verdecktes Gebot**, alle gleichzeitig, Höchstgebot gewinnt und zahlt sein Gebot. Maximale Bauchschmerzen, maximale Auflösung im Gruppenchat. Muss selten bleiben, sonst nutzt es sich ab.

### 6.4 Regeln gegen Absprachen

Absprachen unter Freunden sind Teil des Spiels und sollen nicht verboten werden — aber Verschiebebahnhöfe müssen Kosten haben:

- **Transfersteuer:** pauschal 5 % jeder Ablöse, fließt in den Solidartopf (→ §19.5). Konstant, nicht steigend (F6).
- **Marktwert-Korridor:** Direkttransfers unter 40 % oder über 250 % des Marktwerts erzeugen einen Boulevard-Artikel ("Skandalpreis!") und eine Verbandsprüfung: Fanstimmung −8 für beide Vereine.
- **Kein Rückkauf** an denselben Verein innerhalb von 6 Spieltagen.

Das verhindert Kollusion nicht — es macht sie sichtbar und teuer, was in einer Freundesgruppe wirksamer ist als jedes Verbot.

### 6.5 Wer über einen Transfer entscheidet (F17)

**Spieler haben kein Vetorecht.** Niemand lehnt einen Wechsel ab, niemand verhandelt sich aus einem Transfer heraus. Über einen Wechsel entscheidet allein der Verein, dem der Spieler gehört.

| Fall | Regel |
|---|---|
| **Freier Agent** (gehört keinem Verein) | Der Höchstbieter bekommt ihn. **Bindend, ohne Ausnahme.** Kein Rückzug, keine Ablehnung. |
| **Spieler eines Freundes** | Der **abgebende Verein entscheidet**. Er stellt den Spieler mit einem Mindestpreis in die Auktion; wird der nicht erreicht, platzt sie automatisch. Nach Auktionsende hat er bis zum nächsten Marktabschluss Zeit, anzunehmen oder abzulehnen. |
| **Bot-Verein** | Verkauft immer zum Höchstgebot, wenn der Mindestpreis erreicht ist. Er lehnt nie ab. |

Lehnt ein Verkäufer ab, werden alle gebundenen Gebote sofort freigegeben und der Spieler bleibt in seinem Kader. Wer das dreimal in Folge tut, bekommt ein sichtbares Boulevard-Etikett ("Scheinverkäufer") — Reputation reguliert das besser als eine Regel.

**Warum das so gut funktioniert:** Es macht den Markt vollständig berechenbar. Ein gewonnenes Gebot auf einen freien Agenten ist ein sicherer Zuschlag, und ein Bieterkrieg endet nie mit "der Spieler wollte nicht". Damit verschiebt sich die gesamte Unsicherheit dorthin, wo sie hingehört: **auf die anderen Menschen am Tisch.** Der einzige, der dir einen Spieler verweigern kann, ist ein Freund — und genau darüber soll geredet, gestritten und verhandelt werden.

---

## 7. Kader und Aufstellung

### 7.1 Eine Aufstellung, jederzeit änderbar (F9)

Es gibt **eine** gespeicherte Aufstellung pro Verein. Sie gilt für jeden kommenden Spieltag, bis sie geändert wird. Man kann sie um 9 Uhr morgens einstellen und eine Woche lang nicht mehr anfassen — oder zwischen zwei Anstößen um 21:40 noch umbauen.

Enthalten sind:

- **Formation** aus 6–8 Presets (4-4-2, 4-3-3, 3-5-2, 5-3-2, 4-2-3-1 …)
- **Startelf + 5 Bank**, Drag & Drop
- **Drei Taktikregler:** Tempo (kontrolliert ↔ direkt), Pressing (tief ↔ hoch), Risiko (defensiv ↔ offensiv)
- **Angriffsfokus:** links / zentral / rechts
- **Rollen:** Kapitän, Elfmeter, Standards

### 7.2 Automatische Korrektur

Bevor eine Partie startet, prüft das System die gespeicherte Aufstellung und **ersetzt automatisch**:

- verletzte Spieler
- gesperrte Spieler
- Spieler mit Fitness unter 40 (wenn eine bessere Alternative auf der Bank sitzt)

Der Spieler bekommt eine Meldung: *"Vor Spieltag 14 wurde Rodrigo (Fitness 31) automatisch durch Vasquez ersetzt."* Damit kann man den Abend verpassen, ohne mit sechs erschöpften Spielern anzutreten — aber wer selbst rotiert, macht es besser.

### 7.3 Fitness und Rotation — die Kernmechanik des 3-Spiele-Tags

Bei 21 Spieltagen in 7 Tagen ist Fitness die zentrale Ressource, wichtiger als in jedem klassischen Fußballmanager.

| Vorgang | Fitness |
|---|---|
| Volle 90 Minuten | −22 |
| Eingewechselt (ca. 30 Min) | −9 |
| Auf der Bank | +6 |
| Nicht im Kader | +14 |
| Über Nacht (zwischen 22:00 und 17:00) | +18 |
| Trait "Eisenmann" | −40 % auf alle Verluste |

Rechnerisch: Ein Spieler, der alle drei Partien eines Abends durchspielt, verliert 66 Punkte und regeneriert über Nacht 18. **Niemand kann eine Saison lang jeden Spieltag spielen.** Ein Kader von 14 Spielern reicht knapp, 17–18 sind komfortabel, und wer nur 14 hat, muss ab Tag 3 mit müden Stars antreten.

Damit ist Kaderbreite plötzlich genauso wichtig wie Kaderqualität — und das ist eine der besten Antworten auf "einer kauft sich elf Superstars". Elf Superstars, die alle 21 Spieltage brauchen, sind ab Tag 4 elf erschöpfte Superstars.

### 7.4 Kabinenklima

Kabinenklima (0–100) sinkt durch zu viele Ego-Spieler, durch Gehaltsungerechtigkeit (ein Spieler verdient mehr als das 2,5-fache des Kaderdurchschnitts) und durch unzufriedene Bankdrücker. Bei niedrigem Klima: −Form für alle, höhere Ereignisrate. Elf gekaufte Superstars sind messbar schlechter als acht Stars und drei zufriedene Rollenspieler.

### 7.5 Aufwand für den Spieler

Wer nichts tut, spielt mit der letzten Aufstellung plus Auto-Korrektur. Ein aufmerksamer Spieler, der rotiert und auf den Gegner reagiert, gewinnt etwa **8–12 % Teamstärke** gegenüber dem Autopiloten — etwas mehr als in einem klassischen Manager, weil Rotation hier echtes Handwerk ist. Genug Belohnung für Aufmerksamkeit, wenig genug, dass ein verpasster Abend nicht die Saison kostet.

**Längere Abwesenheit (F19):** Es gibt keinen Urlaubs- oder Pausenmodus. Wer zwei Tage nicht kann, verliert zwei Tage — bei 21 Spieltagen in einer Woche also rund ein Drittel der Saison. Abgefedert wird das ausschließlich durch die Auto-Korrektur aus §7.2, die wenigstens verhindert, dass man mit verletzten oder völlig erschöpften Spielern anläuft.

Das ist die härteste Regel im gesamten Dokument, und sie ist eine bewusste Entscheidung: Anwesenheit ist Teil des Spiels. Für eine Gruppe, die eine Woche lang gemeinsam etwas durchzieht, ist das tragbar — aber es ist der Punkt, an dem ein Freund am ehesten aussteigt. **Falls sich das im ersten Playtest als Problem zeigt, ist ein Autopilot-Modus die naheliegende Nachbesserung** (automatische Rotation nach Fitness plus neutrale Antwort auf Ereignisse), nicht eine Verlängerung der Saison.

---

## 8. Spielsimulation

### 8.1 Modell

Ereignisbasierte **Ballbesitz-Ketten-Simulation**, ca. 90 Ticks à 1 Spielminute, serverseitig, deterministisch aus einem gespeicherten Seed.

Pro Tick:
1. Ballbesitz wird entschieden (Übersicht + Zweikampf + Pressing + Heimvorteil).
2. Die ballbesitzende Mannschaft versucht Raumgewinn (Tempo, Technik gegen Zweikampf).
3. Bei Vordringen: Chance mit einem xG-Wert aus Torabschluss gegen Torwart plus Positionsqualität.
4. Nebenereignisse: Fouls, Karten, Verletzungen, Standards.

### 8.2 Varianz — der wichtigste Balancing-Parameter

Zielkurve für die Siegwahrscheinlichkeit:

| Stärkedifferenz | Sieg Favorit | Unentschieden | Sieg Außenseiter |
|---|---|---|---|
| 0 | 38 % | 24 % | 38 % |
| +5 OVR | 50 % | 23 % | 27 % |
| +10 OVR | 62 % | 20 % | 18 % |
| +20 OVR | 76 % | 15 % | 9 % |

Selbst ein um 20 OVR überlegenes Team verliert jedes elfte Spiel. **Das ist Absicht.** Ein Spiel, in dem der stärkste Kader 95 % gewinnt, ist nach Tag 2 entschieden und die Gruppe hört auf. Fußball ist emotional attraktiv, *weil* er ungerecht ist.

### 8.3 Modifikatoren

| Faktor | Effekt |
|---|---|
| Heimvorteil | +3 bis +7 Teamstärke, skaliert mit Auslastung × Fanstimmung |
| Form | ±6 pro Spieler |
| Fitness unter 70 | linear abnehmende Leistung, Verletzungsrisiko steigt |
| Kabinenklima | ±5 Teamstärke |
| Derby | +Varianz, +Kartenrisiko, Big-Game-Player-Bonus |
| Taktik-Konter | Schere-Stein-Papier-Schicht, maximal ±4 |

### 8.4 Präsentation: der 90-Sekunden-Ticker (F10)

Zum Anstoß bekommen alle eine Push-Nachricht. Der Ticker läuft in **90 Sekunden** ab, mit 15–25 Schlüsselmomenten in natürlicher Sprache, danach Statistik und Spielernoten.

- Wer live dabei ist, sieht ihn gleichzeitig mit den anderen — mit Emoji-Reaktionen in Echtzeit.
- Wer später kommt, sieht denselben Ticker als Zusammenfassung, jederzeit abrufbar.
- Überspringbar zum Endstand.

Drei Anstöße pro Abend × 90 Sekunden = viereinhalb Minuten Pflichtprogramm. Das ist der richtige Preis für den emotionalen Höhepunkt des Tages.

---

## 9. Liga-System

### 9.1 Format: immer 21 Spieltage (F3)

Der Spielplan wird als Round-Robin erzeugt und **zyklisch fortgesetzt, bis 21 Spieltage voll sind** — unabhängig davon, wie viele Vereine mitspielen.

Bei ungerader Spielerzahl füllt ein **Bot-Verein** auf (F16), damit die Teilnehmerzahl immer gerade ist und jeder an jedem Spieltag antritt. Es gibt keine Freilose.

| Freunde | Vereine gesamt | Partien pro Spieltag | Runden in 21 Spieltagen | Spiele pro Verein |
|---|---|---|---|---|
| **3** | 3 + Bot = **4** | 2 | 7 volle Runden | **21** ✓ |
| **4** | 4 | 2 | 7 volle Runden | **21** ✓ |
| **5** | 5 + Bot = **6** | 3 | 4,2 Runden | 20–21 |
| **6** | 6 | 3 | 4,2 Runden | 20–21 |
| **7** | 7 + Bot = **8** | 4 | 3 volle Runden | **21** ✓ |
| **8** | 8 | 4 | 3 volle Runden | **21** ✓ |

Bei 3, 4, 7 und 8 Freunden geht die Rechnung damit **exakt** auf: volle Runden, gleich viele Spiele für alle, keine Sonderregel. Genau der realistische Fall dieser Gruppe.

**Ungleiche Spielanzahl:** Nur bei 5 und 6 Vereinen bleibt die letzte Runde unvollständig. Sie wird dann so gelost, dass die Differenz maximal 1 Spiel beträgt, und die Tabelle sortiert primär nach **Punkten pro Spiel**, mit absoluten Punkten als Anzeige. Damit ist jedes Format fair, ohne dass die 21 angetastet wird.

### 9.2 Wertung

3 / 1 / 0 Punkte. Tiebreaker: Punkte pro Spiel → Direktvergleich → Tordifferenz → Tore.

### 9.3 Preisgelder (bewusst flach)

| Platzierung | Prämie |
|---|---|
| 1. | 40 Mio |
| 2. | 34 Mio |
| 3. | 30 Mio |
| 4. | 27 Mio |
| ab 5. | 25 Mio |

Der Abstand zwischen Erstem und Letztem liegt bei 15 Mio, gemessen an Saisoneinnahmen von rund 70 Mio und einem Startbudget von 400 Mio. Dazu Spielprämien: 1,2 Mio pro Sieg, 400k pro Unentschieden.

**Sportlicher Erfolg soll Ruhm bringen, nicht ökonomische Unschlagbarkeit.** Wer die Liga über Geld dominieren will, muss das über Fans, Stadion und clevere Transfers tun — also über Entscheidungen.

### 9.4 Kein Auf- und Abstieg

Stattdessen bestimmt die Tabelle die **inverse Reihenfolge** bei der Sponsorenwahl und beim Zugriff auf den Marktnachschub zwischen den Saisons (→ §18).

### 9.5 Der Bot-Verein

Bei ungerader Spielerzahl tritt ein computergesteuerter Verein an. Er ist kein Gegner-Boss und kein Kanonenfutter, sondern erfüllt drei klar getrennte Aufgaben.

#### Drei Prinzipien

**1. Er füllt auf, er konkurriert nicht.** Der Bot-Kader wird aus dem **Reservebestand** der 150 Spieler bestückt, nicht aus dem aktiven Marktpool (A1). Er nimmt euch keinen einzigen Spieler weg, bietet auf keiner Auktion mit und treibt keinen Preis hoch. Alles andere würde den Kern des Spiels beschädigen: Ein Bieterkrieg, den man gegen einen Algorithmus verliert, ist kein Drama, sondern Ärger.

**2. Er ist der Maßstab.** Sein Kaderwert wird zu jedem Saisonbeginn auf den **Median der menschlichen Vereine** kalibriert. Damit ist er eine ehrliche Messlatte: Wer unter dem Bot steht, hat wirklich schlecht gespielt — und wer ihn schlägt, hat es verdient. Das ist nebenbei die klarste Rückmeldung, die ein Spieler in einer 3er-Gruppe überhaupt bekommen kann, weil zwei menschliche Gegner allein kaum Aussagekraft haben.

**3. Er ist sichtbar ein Bot.** Eigener Vereinsname, eigenes Wappen, klar als Bot gekennzeichnet. Der Feed behandelt ihn im Boulevard-Ton wie einen ungeliebten Traditionsverein, der grundsolide Mittelmaß liefert. Niemand soll ihn je mit einem Freund verwechseln.

#### Verhalten

| Bereich | Verhalten |
|---|---|
| **Aufstellung** | Auto-Optimierung inklusive **korrekter Rotation** — der Bot nutzt die Fitness-Mechanik richtig. Ohne das wäre er ab Tag 3 chancenlos und würde die Tabelle verzerren. |
| **Taktik** | Konservativ und stabil, leichte Anpassung an die Stärke des Gegners. Keine Extremtaktiken. |
| **Verletzungen & Sperren** | Gelten für ihn genauso wie für alle. |
| **Transfermarkt (Kauf)** | Nie. Er bietet auf nichts. |
| **Transfermarkt (Verkauf)** | 1–2 Mal pro Saison stellt er einen Spieler in die Auktion — eine willkommene Gelegenheit für die Freunde und der einzige Weg, an seine Spieler zu kommen. |
| **Wirtschaft** | Wird nicht simuliert. Kein Budget, kein Stadion, keine Fans, keine Bilanz. Er taucht in keinem Wirtschaftsranking auf. |
| **Ereignisse** | Bekommt keine. |

#### Wertung und Trophäen

Der Bot **zählt in der Tabelle voll mit** — alles andere wäre unehrlich, weil seine Ergebnisse ja echte Punkte kosten. Aber:

- Er gewinnt **keine Trophäen** und sammelt **kein Prestige**.
- Er erscheint in keiner Wirtschafts- oder Fan-Rangliste.
- Wird er Tabellenerster, geht der **Meistertitel an den besten Menschen** — mit Sternchen in der ewigen Tabelle und einer Dauerschmach im Feed: *"Der Bot war besser als ihr alle. Herzlichen Glückwunsch, Marco, zum Titel des besten Menschen."*

Diese Regel ist bewusst so gebaut: maximale Demütigung, ohne dass jemand real etwas verliert. Genau die Sorte Schadenfreude, die das Spiel tragen soll.

#### Kalibrierung

| Kennwert | Zielwert |
|---|---|
| Kaderwert | Median der menschlichen Vereine, ±5 % |
| Kaderbreite | 17 Spieler — er hat nie ein Fitnessproblem |
| Erwartete Platzierung | statistisch Mittelfeld, in ca. 15 % der Saisons Platz 1 oder 2 |
| Trophäenfähigkeit | keine |

Die Rekalibrierung passiert **jede Saison neu** (→ §18). Zieht die Gruppe insgesamt davon, zieht der Bot mit; fällt sie zurück, fällt er mit. Er kann dadurch nie zum unschlagbaren Hindernis werden und nie zum Freilos verkommen.

#### Kommt ein Freund dazu

Sobald die Spielerzahl gerade wird, verschwindet der Bot zum nächsten Saisonstart. Sein Kader geht zurück in den Reservebestand und steht damit ab dem nächsten Marktnachschub allen zur Verfügung — ein netter Nebeneffekt, weil ein Bot-Abgang den Markt spürbar auffüllt.

---

## 10. Ereignissystem

### 10.1 Grundprinzip: Ereignisse sind Entscheidungen

Ein Ereignis ohne Entscheidung ist eine Push-Nachricht. Ein Ereignis mit zwei schlechten Optionen ist Gameplay. **Mindestens 70 % aller Ereignisse bieten 2–3 Optionen mit echten Trade-offs.** Kein Ereignis darf eine offensichtlich beste Antwort haben.

### 10.2 Rhythmus (F11)

**1–2 Ereignisse pro Tag, morgens gebündelt** im Posteingang — nicht pro Spieltag. Über eine Saison sind das 7–14 Entscheidungen. Jede davon soll spürbar sein.

Die Bündelung passt zum Tagesablauf aus §1.1: morgens entscheiden, tagsüber Markt, abends Fußball. Entscheidungen laufen bis 16:00 des Folgetages ab; wer nicht reagiert, bekommt die neutrale Standardoption.

### 10.3 Kategorien

| Kategorie | Anteil | Beispiele |
|---|---|---|
| **Kader** | 30 % | Verletzung, Vertragsforderung, Kabinenstreit, Formhoch, Sperre |
| **Wirtschaft** | 20 % | Sponsorangebot, Steuernachzahlung, Merch-Boom, Kreditangebot |
| **Fans** | 15 % | Protest, Choreo, Ultras fordern niedrigere Preise |
| **Stadion** | 10 % | Rasenschaden, Sturmschaden, Behördenauflage, Bauverzug |
| **Markt** | 15 % | Abwerbeangebot, Außenwelt-Kaufangebot, Berater meldet sich |
| **Boulevard** | 10 % | Gerüchte, Skandale, Interview-Entgleisung |

### 10.4 Beispiel

> **"Kapitän Duarte fordert einen neuen Vertrag."**
> Vier starke Spiele in Folge, und sein Berater weiß es. Gefordert: +60 % Gehalt.
>
> - **Zustimmen** → Moral +20, Kabinenklima −8 (die anderen wollen jetzt auch), Gehaltslast +60 %
> - **Verhandeln** (60 % Erfolg) → +30 % Gehalt, Moral +5. Bei Scheitern: Moral −25, er bekommt dauerhaft den Trait "Söldner"
> - **Ablehnen** → Geld gespart, Moral −30, Fanstimmung −5, 25 % Chance auf Wechselforderung

### 10.5 Gewichtung nach Situation (getarntes Rubberbanding)

| Situation | Häufigere Ereignisse | Narrative Begründung |
|---|---|---|
| Tabellenführer | Abwerbeangebote, Gehaltsforderungen, Erwartungsdruck, Belastungsverletzungen | "Erfolg zieht Aufmerksamkeit an" |
| Tabellenletzter | Günstiges Sponsorangebot, Fan-Solidarität, motivierter Außenseiter, Schnäppchen am Markt | "Wer nichts zu verlieren hat" |
| Hohe Gehaltsquote | Liquiditätswarnung, Beraterdruck | "Die Bank ruft an" |
| 3+ Siege in Folge | Überheblichkeit, Boulevard-Hype, +Merch | "Höhenflug" |
| 3+ Niederlagen | Fanproteste, Trainerdiskussion, aber auch Kabinen-Zusammenrücken (+Moral) | "Krisenmodus" |

Das Rubberbanding trifft **nie das Spielergebnis direkt**, nur das Umfeld. Der Führende wird nicht schwächer gemacht — es wird nur teurer und komplizierter, vorne zu bleiben.

### 10.6 Ereignisse, die zwei Spieler verbinden

Die wertvollste Ereignisklasse: Ereignisse, die bei zwei Vereinen gleichzeitig landen.

- *"Dein Stürmer will unbedingt zu Marcos Verein."* → Marco bekommt zeitgleich: *"Ein unzufriedener Star ist zu haben — 30 % Rabatt, 24 Stunden."*
- *"Ein Sponsor will exklusiv nur einen Verein der Liga."* → Alle bekommen die Ausschreibung, nur einer gewinnt.
- *"Die Fans deines Rivalen verspotten euch."* → Derby-Modifikator für beide.

### 10.7 Dosierung

Cooldown pro Ereignistyp: nicht zweimal dasselbe innerhalb von 6 Spieltagen. Kein Ereignis darf mehr als 8 % des Vereinsvermögens auf einen Schlag vernichten — Katastrophen sind unterhaltsam, Willkür ist es nicht.

---

## 11. Fans

### 11.1 Zwei getrennte Werte

- **Fanbasis** (träge, Tage): bestimmt Ticketnachfrage-Obergrenze, Merch-Basis, TV-Attraktivität.
- **Fanstimmung** 0–100 (volatil, Stunden): bestimmt Auslastung, Heimvorteil, Merch-Multiplikator, Ereignisrisiko.

### 11.2 Erwartungsdifferenz statt Absolutergebnis

Der Kern der Fanmechanik:

```
Stimmungsänderung ≈ (tatsächliche Leistung − erwartete Leistung) × Sensitivität
erwartete Leistung = f(Kaderwert relativ zum Ligadurchschnitt, letzte Saison, Prestige)
```

Ein 1:1 gegen den Tabellenletzten ist für den Meister eine Katastrophe (−6 Stimmung) und für den Aufsteiger ein Fest (+5). **Wer sich den teuersten Kader kauft, kauft sich gleichzeitig die härtesten Fans.**

Bei 21 Spieltagen in 7 Tagen ist die Sensitivität bewusst niedriger angesetzt als in einem langsamen Manager — sonst schwankt die Stimmung dreimal täglich zwischen Euphorie und Aufstand.

### 11.3 Weitere Einflüsse

| Faktor | Wirkung |
|---|---|
| Ticketpreis über/unter Referenzpreis | ±0,25 Stimmung pro % Abweichung pro Spieltag |
| Verkauf eines Publikumslieblings | −15 sofort |
| Kauf eines Weltklassespielers | +8 sofort, verpufft in 5 Spieltagen ohne Erfolg |
| Stadionausbau abgeschlossen | +10 |
| Baustelle aktiv | −1,5 pro Spieltag |
| Derby gewonnen / verloren | +12 / −12 |

### 11.4 Stimmungszonen

| Zone | Stimmung | Effekte |
|---|---|---|
| Euphorie | 85–100 | Auslastung 100 %, Heimvorteil maximal, Merch ×1,4, Fanbasis wächst |
| Zufrieden | 60–84 | Normalbetrieb |
| Unruhig | 35–59 | Auslastung −20 %, Protestereignisse möglich |
| Feindselig | 0–34 | Auslastung −45 %, kein Heimvorteil, Spielermoral −10, Abwanderung |

Die Feindselig-Zone ist eine echte Abwärtsspirale — und muss deshalb **immer mit Aufwand verlassen werden können**: Ticketpreis senken, Fanaktion finanzieren, Derby gewinnen. Eine Spirale ohne Ausgang ist Frust; eine mit teurem Ausgang ist Drama.

---

## 12. Stadion

### 12.1 Ausbaustufen

| Stufe | Kapazität | Kosten | Bauzeit |
|---|---|---|---|
| 1 (Start) | 25.000 | — | — |
| 2 | 38.000 | 80 Mio | 6 Spieltage |
| 3 | 55.000 | 150 Mio | 9 Spieltage |
| 4 | 75.000 | 260 Mio | 12 Spieltage |

Progressiv steigende Kosten bei linear steigendem Ertrag — eine eingebaute Bremse gegen unendliches Wachstum. Stufe 2 amortisiert sich über etwa 2,5 Saisons.

### 12.2 Baustellenrisiko

Während des Baus:
- Kapazität **−35 %**, genau dann, wenn Kapital gebunden ist
- Fanstimmung −1,5 pro Spieltag
- 6 % Chance pro Spieltag auf Verzögerung (+2 Spieltage, +8 % Kosten)

Damit ist "Wann baue ich?" eine echte Timing-Entscheidung: in der Zwischensaison anfangen (sicher, aber man verliert Marktzeit) oder mitten in der Aufholjagd (mutig, kann den Titel kosten). Genau die Art von Entscheidung, über die eine Gruppe streitet.

### 12.3 Module

| Modul | Effekt |
|---|---|
| VIP-Logen | +Ticketertrag pro Zuschauer, +Sponsoreninteresse |
| Fanshop | +Merch-Einnahmen |
| Trainingszentrum | +Entwicklungsrate junger Spieler, −Fitnessverlust |
| Medizinische Abteilung | −Verletzungsdauer, −Verletzungsrisiko |
| Rasenheizung | −Ausfallrisiko-Ereignisse |

Das **Trainingszentrum** ist nach dem Wegfall der Akademie (F8) die wichtigste Infrastruktur-Investition: Es ist die einzige Möglichkeit, Spielerwert selbst zu erzeugen statt zu kaufen — und bei drei Spieltagen täglich ist der Fitnessbonus für sich genommen schon spielentscheidend.

### 12.4 Verfall

Der Stadionzustand sinkt um 0,6 % pro Spieltag (rund 12 % pro Saison). Unter 70 %: Kapazitätsabzüge und Auflagen-Ereignisse. Instandhaltung ist eine unvermeidliche Geldsenke — genau deshalb notwendig, damit Kapital nicht endlos akkumuliert.

---

## 13. Finanzen

### 13.1 Größenordnung einer Saison

Kalibriert auf einen Zielkader von 16 Spielern mit rund 390 Mio Marktwert:

| Posten | pro Saison (21 Spieltage) |
|---|---|
| TV-Gelder | 30 Mio (18 Mio Sockel für alle + 12 Mio leistungsabhängig) |
| Sponsoren | 15 Mio |
| Tickets | 12 Mio |
| Merchandise | 8 Mio |
| Prämien | 6 Mio |
| **Einnahmen gesamt** | **≈ 71 Mio** |
| Spielergehälter | ≈ 33 Mio (46 %) |
| Instandhaltung, Betrieb, Personal | ≈ 12 Mio |
| **Betriebsergebnis** | **≈ +26 Mio** |

Das Startbudget von 400 Mio ist also einmalig und wird nie wieder in einer Saison verdient. Nach Saison 1 finanziert man Käufe überwiegend aus **Verkäufen**, nicht aus laufenden Einnahmen. Das hält den Transfermarkt lebendig und verhindert, dass der Kaderwert von Saison zu Saison explodiert.

### 13.2 Gehaltsformel

```
Gehalt pro Spieltag ≈ Marktwert × 0,004     (angepasst um Alter, Trait, Vertragslänge)
```

Ein Spieler mit 100 Mio Marktwert kostet also 400.000 pro Spieltag, 8,4 Mio pro Saison. Gehälter werden pro Spieltag abgebucht — bei drei Spieltagen täglich merkt man die Belastung sofort.

### 13.3 Abrechnung

Bilanz **pro Spieltag**, aber im Interface als **Tagesbilanz** zusammengefasst: eine Seite, sechs Zeilen, ein Trendpfeil. Kein Excel.

### 13.4 Kredite und Insolvenz

- Kreditrahmen: 60 % der erwarteten Saisoneinnahmen, also rund 42 Mio. Zins 6–12 % je nach Bonität.
- **Bei Kontostand unter 0** kein Game Over, sondern eine Eskalationsleiter:
  1. Transfersperre
  2. Zwangsverkauf des wertvollsten Spielers unter Marktwert — öffentlich, mit Boulevard-Schlagzeile
  3. −3 Punkte
  4. Notverwaltung: Gehaltsdeckel, Ego- und Söldner-Spieler verlieren massiv Moral

Bankrott soll **peinlich** sein, nicht endgültig. Ein ausgeschiedener Spieler ist ein Freund, der nicht mehr mitspielt — der teuerste Fehler, den dieses Design machen könnte.

### 13.5 Ticketpreis

Ein Regler, änderbar zwischen den Spieltagen, mit sofortiger Prognose ("bei 52 € erwarten wir 74 % Auslastung"). Kurzfristige Gier kostet langfristig Fanstimmung. Einfachste denkbare Mechanik, erzeugt trotzdem jede Saison eine Diskussion.

---

## 14. Sponsoren

### 14.1 Struktur

Drei Slots: **Trikot**, **Stadionname**, **Ausrüster**. Laufzeit 1–2 Saisons. Die Reihenfolge der Auswahl folgt der **inversen Tabelle der Vorsaison** — der Letzte wählt zuerst.

### 14.2 Angebote als Risikoprofil

Bei jeder Neuvergabe stehen drei Angebote zur Wahl, die sich nicht in der Höhe, sondern im **Risikoprofil** unterscheiden:

| Typ | Beispiel |
|---|---|
| **Sicher** | 15 Mio Fixum pro Saison, keine Bedingungen |
| **Leistung** | 5 Mio Fixum + 700k pro Sieg + 12 Mio bei Meisterschaft |
| **Kontrovers** | 28 Mio Fixum, aber −12 Fanstimmung sofort und −0,4 pro Spieltag |

Das dritte Angebot ist das interessanteste: Es verwandelt Fanstimmung in eine handelbare Währung. Verzweifelte Vereine nehmen es, und die Freunde werden sie dafür verspotten.

### 14.3 Klauseln

Sponsoren stellen Bedingungen: "Kein Transfer über 80 Mio", "Top-2-Platzierung, sonst Vertragsstrafe", "Spieler X muss im Kader bleiben". Diese Klauseln sind für die Gruppe **öffentlich sichtbar** — womit ein Freund gezielt Druck aufbauen kann, indem er genau den Spieler abwirbt, den man laut Vertrag halten muss.

---

## 15. Scouting und Spielerentwicklung

*Ersetzt die ursprünglich geplante Jugendakademie (F8). Spieler kommen ausschließlich über den Transfermarkt — Wert entsteht dadurch nicht durch Ausbildung, sondern durch besseres Einschätzen und Entwickeln.*

### 15.1 Verdecktes Potenzial

Jeder Spieler hat ein verdecktes Potenzial. Sichtbar ist nur eine **Scouting-Range** mit Vertrauensangabe:

> **Lucas Ferreira, 19, LA** — OVR 71 · Potenzial **74–89** *(Vertrauen: gering)*

Je jünger der Spieler, desto breiter die Range und desto größer die Wette. Ein 19-Jähriger mit Range 74–89 kann in zwei Saisons ein Weltklassespieler oder ein 18-Mio-Denkmal der eigenen Fehleinschätzung sein.

### 15.2 Scouting-Investition

Ein Scoutingbericht kostet Geld und verengt die Range:

| Stufe | Kosten | Effekt |
|---|---|---|
| Basisbericht | kostenlos | Range ±8, Vertrauen gering |
| Detailanalyse | 2 Mio | Range ±4, Vertrauen mittel |
| Vollscouting | 6 Mio | Range ±2, Vertrauen hoch, Traits werden sichtbar |

**Das ist die Informationsökonomie des Spiels.** Wer scoutet, bietet informierter. Wer spart, bietet blind. Und niemand weiß, wie viel die anderen wissen — was jedes Gebot zu einem Signal macht.

### 15.3 Entwicklung im eigenen Kader

Spieler entwickeln sich zwischen den Saisons (→ §18), gesteuert durch:

| Faktor | Einfluss |
|---|---|
| Alter | 17–23 stark positiv, 24–28 stabil, 29+ negativ |
| Einsatzminuten | Der größte Hebel — wer spielt, wächst |
| Trainingszentrum | +35 % Entwicklungsrate |
| Moral und Kabinenklima | ±20 % |
| Potenzial | die Obergrenze |

Damit ist der junge Ergänzungsspieler, den man für 12 Mio kauft und 21 Spieltage spielen lässt, die **wichtigste Aufholstrategie für schwache Vereine** — die Rolle, die sonst die Akademie hätte. Er kostet wenig Gehalt, wird besser, und man kann ihn nach zwei Saisons teuer an den Freund verkaufen, der ihn dann verheizt.

---

## 16. Freundesinteraktionen

Dieser Abschnitt entscheidet, ob das Spiel gespielt oder nach vier Tagen deinstalliert wird. Alles hier ist Kernfeature.

### 16.1 Der Liga-Feed

Ein gemeinsamer chronologischer Kanal, in dem automatisch alles Peinliche und alles Beeindruckende auftaucht — im Boulevard-Ton (F12):

> ⚡ *"Marco zahlt 148 Mio für Okonkwo — 190 % über Marktwert. Experten sprechen von Panik."*
> 💸 *"Lisas Verein rutscht ins Minus. Die Bank hat angerufen."*
> 🔥 *"Toms Fans fordern seinen Rücktritt nach dem 0:4."*
> 😴 *"Sarah stellt zum dritten Mal in Folge dieselbe Elf auf. Vier Spieler unter Fitness 40."*
> 🤖 *"Der Bot steht auf Platz zwei. Zwei von drei Menschen liegen dahinter."*
> 🏆 *"Marco gewinnt zum fünften Mal in Folge. Die Liga schaut zu."*

Emoji-Reaktionen und Kommentare direkt am Eintrag. **Der Feed ist der Motor der Schadenfreude** und der günstigste Retention-Mechanismus, den es gibt: Man öffnet die App, um zu sehen, was den anderen passiert ist.

**Woher die Texte kommen (F20):** 100–150 **handgeschriebene Templates** mit Platzhaltern, kein Sprachmodell zur Laufzeit.

```
"{verein} zahlt {summe} für {spieler} — {prozent} über Marktwert.
 Experten sprechen von {panik|Größenwahn|einem Hilferuf}."
```

Pro Meldungstyp 4–8 Varianten mit Zufallsauswahl, plus Wortlisten für Zuspitzungen. Volle Kontrolle über Ton und Schärfe, keine laufenden Kosten, keine Latenz, keine Ausrutscher — und die Texte funktionieren offline und deterministisch, was für einen reproduzierbaren Spielverlauf ohnehin wichtig ist.

Aufwand: ein bis zwei Tage konzentrierte Schreibarbeit. Das ist die wirtschaftlichste Investition im ganzen Projekt, weil der Feed laut §20.3 zu den drei Dingen gehört, die überdurchschnittlich gut sein müssen. **Die Templates sind kein Nebenprodukt, sie sind Feature-Arbeit** und gehören entsprechend geplant.

### 16.2 Verhandlungen

Ein strukturierter Deal-Builder statt Freitext, zusammensetzbar aus:

- Ablösesumme, auch in Raten über X Spieltage
- Spieler im Tausch
- Weiterverkaufsbeteiligung in %
- Rückkaufoption mit Preis und Frist
- Bonuszahlungen ("+8 Mio, wenn er 10 Tore schießt")
- Leihe mit Kaufpflicht oder Kaufoption

**Ratenzahlung und Weiterverkaufsbeteiligung sind der Schlüssel:** Sie verketten die Vereine über Saisons hinweg finanziell. Nach drei Saisons schuldet jeder jedem etwas — und das ist das Fußball-Universum aus dem Zielbild.

### 16.3 Rivalitäten und Derbys

Rivalitäten entstehen **dynamisch**, nicht per Zuweisung. Ein Rivalitäts-Score zwischen je zwei Vereinen steigt durch knappe Ergebnisse, gewonnene Bieterkriege gegeneinander, abgeworbene Spieler, Tabellennähe und Kommentare im Feed.

Ab einer Schwelle wird die Paarung zum **Derby**: höhere Varianz, mehr Karten, doppelte Fanstimmungsänderung (±12), Sonderprämie für den Sieger und ein eigener Feed-Bereich mit Bilanz ("Marco gegen Tom: 4–1–3").

Bei 3–4 Vereinen und 21 Spieltagen trifft man denselben Gegner bis zu sieben Mal pro Saison — Rivalitäten entstehen hier schneller und heißer als in jeder großen Liga. Das ist ein Vorteil des kleinen Formats, kein Nachteil.

### 16.4 Nebenwetten

Zwei Spieler können vor einem Spieltag eine Wette abschließen: Geld, ein Spieler oder eine Demütigung (der Verlierer trägt eine Saison lang ein vom Gewinner gewähltes Trikot; sein Vereinsname bekommt einen Zusatz). Freiwillig, beidseitig bestätigt, gedeckelt bei 10 % des Vermögens.

### 16.5 Die Liga-Verfassung

Zwischen zwei Saisons stimmt die Gruppe über Regeländerungen ab (einfache Mehrheit, drei Vorschläge pro Saison, jeder darf einen einbringen):

- Gehaltsobergrenze einführen?
- Transfersteuer erhöhen?
- Eingewöhnungszeit für Neuzugänge einführen?
- Marktpool vergrößern oder verkleinern?
- Anstoßzeiten ändern?

Damit gehört die Liga der Gruppe und nicht dem Entwickler — der stärkste denkbare Langzeit-Bindungsmechanismus, und einer der billigsten in der Umsetzung.

---

## 17. Saison-System

### 17.1 Acht Trophäen statt eines Siegers

| Trophäe | Kriterium | Prestige |
|---|---|---|
| 🏆 **Meister** | Tabellenerster | 10 |
| 💰 **Reichster Verein** | Höchstes Kapital | 6 |
| 📣 **Größte Fanbase** | Meiste Anhänger | 6 |
| 💎 **Wertvollster Kader** | Höchster Kaderwert | 5 |
| 📈 **Bester Transfer** | Größte Wertsteigerung eines gekauften Spielers | 6 |
| 🚀 **Größter Aufsteiger** | Beste Platzierung gegenüber Erwartung | 6 |
| ⚽ **Torschützenkönig** | Meiste Tore | 4 |
| 🎓 **Beste Entwicklung** | Größter OVR-Zuwachs eines Spielers unter 24 | 5 |

Der Bot-Verein (§9.5) ist von allen Trophäen und vom Prestige ausgeschlossen. Wird er Tabellenerster, geht der Meistertitel an den besten Menschen — mit Sternchen und einer Dauerschmach im Feed.

Dazu zwei Anti-Trophäen, weil Schadenfreude ein erklärtes Designziel ist:

| Anti-Trophäe | Kriterium |
|---|---|
| 🤡 **Fehleinkauf der Saison** | Größter Wertverlust nach Kauf |
| 🔥 **Absturz der Saison** | Größte Abweichung nach unten von der Erwartung |

### 17.2 Warum das mechanisch wichtig ist

Wenn nach Tag 4 die Meisterschaft entschieden ist, kämpfen die anderen weiter um sieben Trophäen — mit teils gegenläufigen Strategien. Wer auf "Reichster Verein" spielt, verkauft am vorletzten Tag seine Stars an den Titelanwärter und beeinflusst damit die Meisterschaft. **Multi-Ziel-Design ist die eleganteste Lösung gegen tote Saisonphasen.**

Bei 3–4 Spielern ist das besonders wichtig: Wenn es nur einen Titel gäbe, hätten zwei von drei Spielern schon am Mittwoch nichts mehr zu gewinnen.

### 17.3 Saisonabschluss

Eine geführte Abschluss-Sequenz nach dem letzten Spieltag: Trophäenvergabe, Bilanz, Highlights, Rekorde, ewige Tabelle, ein automatisch generierter Saisonrückblick pro Verein — teilbar als Bild in den echten Gruppenchat.

---

## 18. Fortschritt zwischen Saisons

Nach dem Saisonabschluss läuft die Zwischensaison. Sie endet, sobald **alle "Bereit" gedrückt haben — spätestens nach 48 Stunden** (F15).

Ablauf:

1. **Ehrungen und Prestige-Verbuchung**
2. **Alterung:**
   - 17–23: +2 bis +8 OVR, abhängig von Einsatzminuten, Trainingszentrum und Potenzial
   - 24–28: stabil, ±2
   - 29–32: −1 bis −3
   - 33+: −3 bis −7, Rücktrittswahrscheinlichkeit steigt
3. **Potenzial-Enthüllung:** Bei Spielern über 24 wird das echte Potenzial sichtbar. Der Moment, in dem sich zeigt, wer beim Bieten richtig lag.
4. **Rücktritte** — abgetretene Spieler verlassen den Pool dauerhaft
5. **Vertragsablauf:** Verlängerung verhandeln oder ablösefreier Abgang in den Pool
6. **Marktnachschub:** Neue Spieler aus dem 150er-Bestand rücken in den aktiven Pool nach, so dass die Größe aus §5.2 wieder erreicht wird. **Der Tabellenletzte sieht die Neuzugänge zuerst** und hat 6 Stunden Vorlauf, bevor die Auktionen für alle öffnen.
7. **Bauprojekte** werden fertiggestellt
8. **Sponsoren-Neuvergabe** in inverser Tabellenreihenfolge
9. **TV-Vertrag** neu berechnet auf Basis der Ligagesamtattraktivität — steigt, wenn die Liga insgesamt wächst, was ein gemeinsames Interesse an einem gesunden Universum schafft
10. **Liga-Abstimmung** über Regeländerungen (§16.5)
11. **Bot-Rekalibrierung** (§9.5): Der Bot-Kader wird auf den neuen Median der menschlichen Vereine angepasst. Bei gerader Spielerzahl entfällt er und sein Kader geht zurück in die Reserve
12. **Neue Saisonziele** vom Vorstand, basierend auf relativem Kaderwert
13. **Bereit-Button** — Saisonstart, spätestens nach 48 Stunden

**Was persistiert:** Kapital, Kader, Stadion, Fanbasis, Prestige, Rivalitäten, Schulden, offene Klauseln und Raten, Rekorde, Feed-Historie.
**Was zurückgesetzt wird:** Tabelle, Form, Fitness, Saisonziele, Sponsorenboni, Verletzungen.

**Neue Spieler mittendrin:** Wer später zur Gruppe stößt, startet mit dem **Median-Vermögen der Liga**, einem Basisstadion und erstem Zugriff auf den Marktnachschub — nicht mit dem Startbudget von Saison 1. Sonst ist er chancenlos und hört nach zwei Tagen auf.

---

## 19. Balancing

### 19.1 Die Kernverhältnisse

| Verhältnis | Zielwert | Warum |
|---|---|---|
| Startbudget / Marktwert eines Weltstars | 400 / 100 = 4,0 | Man kann sich **zwei** Weltstars leisten und hat dann fast nichts für die restlichen 12 Kaderplätze. Erzwingt Prioritäten. |
| Weltstars im Pool / Vereine | 1,5 | Weniger Stars als Vereine sie wollen. Der Motor aller Bieterkriege. |
| Saisoneinnahmen / Startbudget | 71 / 400 ≈ 0,18 | Eine Saison verdient das Startbudget nicht ansatzweise. Nach Saison 1 finanzieren Verkäufe die Käufe. |
| Gehaltsquote (gesund) | 45–60 % der Einnahmen | Darüber wird es eng, darunter verschenkt man Potenzial. |
| Prämienspanne 1. gegen letzter | ≈ 21 % der Saisoneinnahmen | Erfolg zahlt sich aus, entscheidet aber nicht die nächste Saison. |
| Kaderbreite für 21 Spieltage | 17–18 Spieler | 14 sind das Minimum und ab Tag 3 spürbar zu wenig. |
| Stadion-Amortisation Stufe 2 | ≈ 2,5 Saisons | Echte Langfristwette. |

### 19.2 Anti-Snowball: die neun Bremsen

Das wichtigste Designproblem. Eine einzelne Bremse reicht nicht — es braucht ein Netz, in dem jede an einem anderen Punkt greift und **keine sich wie eine Bestrafung anfühlt.**

| # | Mechanik | Greift bei | Wirkung | Fühlt sich an wie |
|---|---|---|---|---|
| **1** | **Erwartungsdruck** (§11.2) | Hoher Kaderwert | Fans messen relativ; Siege werden erwartet, Remis bestraft | Ruhm verpflichtet |
| **2** | **Gehaltsspirale** (§6.2, §13.2) | Erfolg, hohe Ablösen | Gehaltsforderungen skalieren superlinear | Stars sind teuer |
| **3** | **Fitness und Kaderbreite** (§7.3) | Schmaler Starkader | Bei 3 Spieltagen täglich kann niemand durchspielen | Belastungssteuerung |
| **4** | **Kabinenklima** (§7.4) | Zu viele Stars | Gehaltsungerechtigkeit und Ego senken die Teamleistung | Eine Mannschaft, keine Sammlung |
| **5** | **Abnehmender Grenznutzen** | Kaderqualität | Teamstärke wächst logarithmisch | Der elfte Star bringt kaum was |
| **6** | **Hohe Simulationsvarianz** (§8.2) | Immer | Selbst +20 OVR gewinnt nur 76 % | Fußball halt |
| **7** | **Ereignisgewichtung** (§10.5) | Tabellenführung | Mehr Abwerbeversuche, Forderungen, Belastungsverletzungen | Erfolg zieht Aufmerksamkeit an |
| **8** | **Flache Prämien und TV-Sockel** (§9.3, §13.1) | Immer | Erfolg zahlt Ruhm, nicht Dominanz | Solidarische Liga |
| **9** | **Inverse Prioritäten** (§14.1, §18) | Schlechte Platzierung | Erster Zugriff auf Sponsoren und Marktnachschub | Wer unten steht, bekommt Perspektive |

**Bremse 3 ist durch das Format neu und stärker geworden.** In einem Manager mit einem Spieltag pro Woche ist Fitness Beiwerk. Bei drei Spieltagen täglich ist sie die härteste Grenze im Spiel — und sie trifft ausgerechnet den Verein mit elf teuren Stars und einer dünnen Bank am härtesten. Sie ist damit ein natürlicher Ausgleich für den Wegfall der Marktbremse.

**Zusätzlich, sozial statt mechanisch:** Die anderen können sich absprechen. Gemeinsam überbieten, dem Führenden nichts verkaufen, ihn im Derby markieren, per Verfassung eine Gehaltsobergrenze beschließen. Der beste Anti-Snowball-Mechanismus überhaupt, weil er von den Spielern kommt und nicht vom System.

### 19.3 Was ausdrücklich nicht gemacht wird

- **Kein direktes Gummiband auf Spielergebnisse.** Wenn Spieler merken, dass die Simulation sie beim Führen benachteiligt, ist das Vertrauen sofort weg. Alle Bremsen greifen im Umfeld, nie im Spiel selbst.
- **Kein Reset.** Fortschritt persistiert, sonst gibt es kein Universum.
- **Keine Belohnung für Passivität.** Alle Aufholmechaniken erfordern eine Entscheidung. Wer schlecht spielt und nichts tut, bleibt schlecht.

### 19.4 Zielwerte (Abnahmekriterien)

- Die Meisterschaft ist rechnerisch frühestens an **Spieltag 17 von 21** entschieden.
- Der Vermögens-Gini-Koeffizient der Liga liegt am Saisonende **unter 0,35**.
- Kein Verein hat nach Saison 3 mehr als **2,2× den Kaderwert** des schwächsten.
- Über drei Saisons haben **mindestens 3 verschiedene Spieler** eine Trophäe gewonnen.
- **Mindestens 50 % aller Auktionen** haben zwei oder mehr Bieter.

Werden diese Werte nicht erreicht, sind die Bremsen aus §19.2 zu schwach eingestellt.

### 19.5 Solidartopf

Gespeist aus 5 % Transfersteuer und Strafzahlungen, ausgeschüttet am Saisonende in inverser Tabellenreihenfolge. Öffentlich sichtbar, weil "Marco hat 14 Mio in den Topf gezahlt, Tom hat 14 Mio bekommen" ein Gesprächsanlass ist.

### 19.6 Telemetrie — was der erste Playtest messen muss

Priorität 1, direkt aus F6 (keine Marktbremse):

- **Käufe pro Verein und Tag** — schießt ein Verein nach oben, sobald er Geld hat?
- **Korrelation zwischen Transferausgaben in Woche 1 und Tabellenplatz** — wenn nahe 1, ist Geld zu mächtig
- **Anzahl Spieler, die am selben Tag gekauft und eingesetzt werden**

Priorität 2:

- Spieltag der Meisterschaftsentscheidung, Vermögens-Gini
- Auktionsbeteiligung pro Spieler, Anteil Auktionen mit ≥2 Bietern
- Durchschnittliche Ablöse/Marktwert-Ratio
- Anteil Spieltage mit unveränderter Aufstellung (misst, ob Rotation verstanden wird)
- Durchschnittliche Fitness der Startelf über den Wochenverlauf
- Sitzungen pro Spieler pro Tag, Abbruchtag bei Aussteigern

---

## 20. MVP — die erste spielbare Version

Ziel: **eine vollständige Saison mit 3–4 Freunden durchspielen** und beantworten, ob die Gruppe danach Saison 2 starten will. Das ist die einzige Metrik, die zählt.

### 20.1 Im MVP enthalten

| Bereich | Umfang |
|---|---|
| **Lobby** | Liga erstellen, Beitritt per Code, 3–4 Spieler, Vereinsname und Farben |
| **Start** | Gleiche Startwerte, Markt sofort offen, Bereit-Button mit 24h-Deadline |
| **Spielerdaten** | 150 reale Profis, gestaffelt, handkalibrierte Attribute, austauschbare Datenschicht |
| **Marktpool** | Skalierung nach Vereinszahl (§5.2) |
| **Auktion** | Soft-Close, Escrow, Proxy-Gebot, sichtbare Bieter, täglicher Abschluss 16–17 Uhr, Push bei Überbieten |
| **Direkttransfer** | Einfache Variante: Geld gegen Spieler, mit Annahme/Ablehnung durch den Verkäufer |
| **Vertragsauflösung** | Entlassung gegen 50 % Restgehalt, mit Fanstimmungsmalus |
| **Kader** | 4 Formationen, Startelf + Bank, 3 Taktikregler, eine gespeicherte Aufstellung, Auto-Korrektur |
| **Fitness** | Volles Verbrauchs- und Regenerationsmodell (§7.3) |
| **Simulation** | Ballbesitz-Ketten-Sim, 90-Sek-Ticker, Statistik, deterministischer Seed |
| **Liga** | 21 Spieltage, 3 pro Tag um 17/20/22, Tabelle nach Punkten pro Spiel |
| **Bot-Verein** | Bei ungerader Spielerzahl: Kaderzuteilung aus der Reserve, Auto-Aufstellung mit Rotation, Median-Kalibrierung |
| **Ereignisse** | 20 handgeschriebene Ereignisse, davon 14 mit Entscheidungen, 1–2 pro Tag morgens |
| **Fans** | Fanbasis + Stimmung, Erwartungsdifferenz-Modell |
| **Stadion** | 2 Ausbaustufen, Bauzeit, Baustellenmalus, Zustand und Instandhaltung |
| **Finanzen** | Tagesbilanz, Tickets, Merch, TV, 1 Sponsorenslot, Gehälter, Kredit, Insolvenzleiter |
| **Scouting** | Verdecktes Potenzial mit Range, 2 Scouting-Stufen |
| **Social** | Liga-Feed mit 100–150 Text-Templates, Emoji-Reaktionen, Gruppenchat |
| **Saisonende** | 5 Trophäen + 1 Anti-Trophäe, Saisonrückblick als teilbares Bild |
| **Technik** | Server-autoritativ, Web-App + mobile App, Push-Nachrichten |

### 20.2 Explizit nicht im MVP

Leihgeschäfte · Weiterverkaufsbeteiligung und Rückkaufoptionen · Ratenzahlung · Personal · Stadionmodule · Nebenwetten · Liga-Verfassung · Dynamische Derbys · Verdeckte Auktionen · Mehrere Sponsorenslots · Vollscouting-Stufe · Pokal · Mehrere parallele Ligen

Keine Absage, sondern die Reihenfolge des Ausbaus.

### 20.3 Was überdurchschnittlich gut sein muss

Drei Dinge tragen das gesamte MVP:

1. **Der Marktabschluss um 16 Uhr.** Muss sich schnell, spannend und absolut fair anfühlen. Push innerhalb von Sekunden. Kein Zweifel darf je aufkommen, dass eine Auktion sauber gelaufen ist.
2. **Der Liga-Feed.** Der Grund, warum jemand morgens die App öffnet. Die Texte müssen gut geschrieben, bissig und spezifisch sein — kein Generator-Kauderwelsch.
3. **Der 90-Sekunden-Ticker.** Dreimal am Abend, für alle gleichzeitig. Das ist der Herzschlag des Produkts.

### 20.4 Aufwandsrahmen

| Phase | Inhalt | Wochen (1–2 Entwickler) |
|---|---|---|
| 0 | Datenmodell, Server, Auth, Lobby | 2–3 |
| 1 | Spielerdaten (150 kalibriert), Kader, Simulation, Ticker | 3–4 |
| 2 | Auktionssystem mit Escrow, Soft-Close, Marktabschluss, Push | 2–3 |
| 3 | Wirtschaft, Fans, Stadion, Tagesbilanz | 2–3 |
| 4 | Ereignissystem + 20 Ereignisse + 100–150 Feed-Templates | 2–3 |
| 5 | Feed, Saisonende, Trophäen, App-Wrapper | 2 |
| 6 | Balancing-Playtest mit echter Gruppe | 2–3 |

Realistisch **14–20 Wochen** bis zur ersten vollständigen Testsaison.

### 20.5 Playtest-Plan

1. **Headless:** 1.000 Saisons durchrechnen, gegen die Zielwerte aus §19.4 prüfen.
2. **Trockentest:** Nur der Marktabschluss, 4 Testkonten, keine Liga.
3. **Kurzsaison:** 6 Spieltage an zwei Tagen mit echter Gruppe.
4. **Vollsaison:** 21 Spieltage über 7 Tage im echten Rhythmus. Erfolgskriterium: **alle wollen Saison 2.**

---

## 21. Die Mechaniken, die das Spiel einzigartig machen

### 1. Der geteilte Transfermarkt als soziale Arena
Ein Markt, ein knapper Pool, alle Freunde. Jeder Kauf ist zugleich ein Entzug bei jemand anderem. Klassische Manager simulieren einen anonymen Markt; hier hat jedes Gebot ein Gesicht. **Das ist der Kern — alles andere ist darum herum gebaut.**

### 2. Der Fluch des Gewinners als Waffe
Weil die Gehaltsforderung mit der Ablöse skaliert, kann man einen Freund gezielt in einen ruinösen Sieg treiben, ohne selbst zu kaufen. *Man kann jemanden schädigen, indem man ihn gewinnen lässt.* Diese eine Formel erzeugt mehr Bluff, Paranoia und Verhandlung als jedes andere System im Dokument.

### 3. Der tägliche Marktabschluss um 16 Uhr
Eine Stunde geballter Nervenkitzel, danach fünf Stunden Fußball, dann Ruhe. Ein Auktionsmarkt mit einem festen täglichen Höhepunkt statt eines Dauerrauschens — das gibt dem Tag eine Dramaturgie und schützt gleichzeitig davor, dass man 24 Stunden am Handy hängen muss.

### 4. Fitness als härteste Grenze
Drei Spieltage pro Tag machen aus einem Nebenwert die zentrale Ressource. Niemand kann durchspielen, Kaderbreite wird genauso wichtig wie Kaderqualität, und der Verein mit elf teuren Stars und dünner Bank scheitert an Tag 4 an seiner eigenen Erschöpfung. Ein Anti-Snowball-Mechanismus, der sich vollkommen natürlich anfühlt.

### 5. Erwartungsdruck statt Absolutleistung
Fans bewerten relativ zum Kaderwert. Der teuerste Kader hat automatisch die unzufriedensten Fans. Damit ist die Bremse keine aufgesetzte Regel, sondern narrativ plausibel — und genau deshalb funktioniert sie, ohne dass sich der Führende betrogen fühlt.

### 6. Verdecktes Potenzial und gekaufte Information
Man bietet auf eine Range, nicht auf eine Zahl — und kann sich für Geld eine engere Range kaufen. Niemand weiß, wie gut die anderen informiert sind, was jedes Gebot zu einem Signal macht. Zwei Saisons später zeigt sich, wer recht hatte.

### 7. Der Liga-Feed als öffentliche Demütigungsmaschine
Ein automatisch geschriebener Boulevard-Kanal, der Fehler sichtbar macht: Panikkäufe, Kontostände im Minus, Fanproteste, erschöpfte Startelfs. Schadenfreude ist ein erklärtes Designziel — dieser Feed ist das Werkzeug dafür und der stärkste Retention-Treiber im Produkt.

### 8. Verkettete Deals über Saisongrenzen hinweg
Ratenzahlung, Weiterverkaufsbeteiligung, Rückkaufoption, Bonusklauseln. Nach drei Saisons schuldet jeder jedem etwas, und ein Transfer von vor zwei Wochen spült plötzlich Geld an einen Rivalen. **Das macht aus einer Liga ein Universum.**

### 9. Acht Trophäen statt eines Siegers
Bei 3–4 Spielern entscheidend: Wenn es nur einen Titel gäbe, hätten zwei von drei am Mittwoch nichts mehr zu gewinnen. Acht Ziele mit teils gegenläufigen Strategien halten alle bis zum letzten Spieltag im Rennen — plus ein Kingmaker-Effekt, wenn der Kandidat für "Reichster Verein" entscheidet, wem er seine Stars verkauft.

### 10. Die Liga-Verfassung
Die Gruppe stimmt zwischen den Saisons über Regeln ab. Kein Fußballspiel gibt seinen Spielern die Regelhoheit — und für eine Freundesgruppe ist genau das der Unterschied zwischen "ein Spiel spielen" und "unsere Liga führen".

---

## 22. Verbleibende offene Punkte

Nichts davon blockiert den Baubeginn. Die ersten drei sollten vor dem ersten Playtest entschieden sein, die letzten beiden können bis zur ersten Saisonauswertung warten.

1. **Welche 150 Spieler, mit welchen Werten?** Die Struktur steht (30 / 50 / 70), die Namensliste und die Attributkalibrierung nicht. Reine Fleißarbeit, aber die gesamte Balance hängt daran — realistisch ein Arbeitstag.
2. **Push-Strategie.** Pro Tag fallen an: 1–2 Ereignisse, mehrere Überboten-Alarme, der Marktabschluss und drei Anstöße. Meine Setzung wäre: Überboten immer sofort (die Auktion braucht es), Ereignisse einmal morgens gebündelt, Anstöße als eine Sammelnachricht pro Abendblock, alles einzeln abschaltbar. Ungebündelt wäre das ein Deinstallationsgrund.
3. **Zeitzonen.** 17/20/22 Uhr in welcher Zeitzone, wenn jemand im Ausland ist? Naheliegend: eine feste Lobby-Zeitzone, die der Host beim Erstellen wählt.
4. **Aussteiger mitten in der Saison.** Empfehlung: Verein läuft im Autopilot weiter, Übergabe an einen neuen Freund jederzeit möglich.
5. **Gleichstand bei Trophäen.** Was passiert, wenn zwei Vereine exakt denselben Kaderwert haben? Vorschlag: geteilte Trophäe, beide bekommen das volle Prestige.

**Nicht mehr offen, aber im Auge zu behalten:** Der Verzicht auf eine Marktbremse (F6) und der Verzicht auf einen Abwesenheitsmodus (F19). Beide sind bewusst getroffen, beide sind die wahrscheinlichsten Kandidaten für eine Nachbesserung nach dem ersten Playtest — die Messgrößen dafür stehen in §19.6.

---

## 23. Entscheidungsprotokoll

Chronologisch, damit später nachvollziehbar bleibt, warum das Spiel so aussieht.

| Thema | Entscheidung | Konsequenz im Dokument |
|---|---|---|
| Spielstart | Markt sofort offen, keine Draft-Zeremonie; Liga startet per Bereit-Button, spätestens nach 24h | §2.4 |
| Saisonlänge | 7 Tage, 21 Spieltage, 3 pro Tag, fix unabhängig von der Spielerzahl | §1.1, §9.1 |
| Anstoßzeiten | 17:00 / 20:00 / 22:00, kompakter Abend | §1.1 |
| Transfermarkt | Ganzjährig offen, keine Fenster | §5.1 |
| Marktabschluss | Ein Abschluss täglich, 16:00–17:00 | §5.5 |
| Marktbremse | **Keine.** Neuzugänge sofort einsatzfähig | §5.1, §19.6 (Playtest-Priorität 1) |
| Balancing-Härte | Ausgeglichen, Zielwerte in §19.4 | §19 |
| Ton | Boulevard, bissig | §16.1 |
| Spieler | Echte Profis, privates Projekt, austauschbare Datenschicht | §0.2 A3, §4.1 |
| Poolgröße | 150 zum Start, erweiterbar | §5.2 |
| Poolstruktur | Gestaffelt: 30 Weltklasse / 50 sehr gut / 70 solide | §5.2 |
| Ungerade Spielerzahl | **Bot-Verein füllt auf** (ersetzt die zuvor geplanten Freilose) | §9.1, §9.5 |
| Jugendakademie | **Gestrichen.** Ersetzt durch Scouting und Spielerentwicklung | §15 |
| Aufstellung | Eine gespeicherte Aufstellung, jederzeit änderbar, Auto-Korrektur | §7.1, §7.2 |
| Ereignisdichte | 1–2 pro Tag, morgens gebündelt | §10.2 |
| Spieltag-Erlebnis | 90-Sekunden-Ticker, live oder später abrufbar | §8.4 |
| Plattform | Web-App und mobile App aus einer Codebasis | §0.2 A6 |
| Bietertransparenz | Namen sichtbar | §6.1 |
| Spielerzustimmung | **Gestrichen.** Kein Vetorecht; freie Agenten gehen bindend an den Höchstbieter, über eigene Spieler entscheidet allein der Verkäufer | §6.5 |
| Vertragsauflösung | Entlassung möglich gegen 50 % Restgehalt | §4.4 |
| Abwesenheit | Kein Urlaubsmodus — nur Auto-Korrektur der Aufstellung | §7.5 |
| Feed- und Ereignistexte | Handgeschriebene Templates mit Platzhaltern, kein LLM zur Laufzeit | §16.1 |
