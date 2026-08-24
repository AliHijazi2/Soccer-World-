# Soccer World — Systemarchitektur

**Version:** 0.1
**Bezug:** [Game Design Document](GAME_DESIGN.md) v0.3, [Datenmodell](DATA_MODEL.md)
**Status:** Technischer Entwurf, noch keine Implementierung

---

## 1. Leitprinzip: Dieses System ist winzig

Bevor irgendeine Technologieentscheidung fällt, die Dimensionierung — sie ist der wichtigste Kontext für alles Folgende.

| Größe | Wert |
|---|---|
| Spieler pro Liga | 3–8, real 3–4 |
| Vereine pro Liga | bis 8 |
| Spielerinstanzen pro Liga | ca. 64–150 |
| Partien pro Saison | 21 Spieltage × 1–4 Partien = **21–84** |
| Ticker-Ereignisse pro Saison | ca. 2.000 Zeilen |
| Gleichzeitige Nutzer im Spitzenmoment | **8** (Marktabschluss 16–17 Uhr) |
| Schreibvorgänge pro Sekunde im Spitzenmoment | < 5 |
| Datenbankgröße nach 50 Saisons | wenige hundert MB |

**Das gesamte Spiel passt in einen einzelnen Node-Prozess und eine PostgreSQL-Datenbank auf dem kleinsten verfügbaren Server.** Jede Architekturentscheidung, die diese Zahlen ignoriert, macht das Projekt langsamer fertig, nicht schneller.

Die eigentliche Schwierigkeit liegt nicht in Last, sondern in **Korrektheit unter Nebenläufigkeit**: Zwei Freunde, die in derselben Sekunde auf denselben Spieler bieten, während ihr Budget bereits anderweitig gebunden ist. Genau dort — und nur dort — lohnt sich technischer Aufwand.

---

## 2. Technologieentscheidungen

| Ebene | Wahl | Begründung |
|---|---|---|
| **Sprache** | TypeScript, überall | Simulationslogik und Typen werden zwischen Server und Client geteilt. Zwei Sprachen hieße, die Regelwerke zweimal zu pflegen. |
| **Backend** | Node.js + Fastify | Klein, schnell, gute WebSocket-Integration. Kein Framework-Überbau nötig. |
| **Datenbank** | PostgreSQL | **Transaktionen sind nicht verhandelbar** (§6). Dazu `jsonb` für flexible Nutzlasten und Zeilensperren für den Auktionspfad. |
| **Frontend** | React + Vite, als PWA | Eine Codebasis für Web und App (GDD A6). |
| **Mobile App** | Capacitor | Wrapt exakt dieselbe Web-App und liefert native Push-Nachrichten. React Native hieße zwei Rendering-Pfade für dieselben Bildschirme — bei acht Nutzern nicht zu rechtfertigen. |
| **Echtzeit** | WebSocket (`ws`) | Der Marktabschluss braucht Gebotsaktualisierungen unter einer Sekunde. |
| **Scheduler** | Eigene Job-Tabelle in Postgres, 5-Sekunden-Polling | Siehe §5 — Cron wäre hier ein Fehler. |
| **Push** | Web Push (VAPID) + APNs/FCM via Capacitor | |
| **Hosting** | Ein kleiner VPS oder Fly.io, managed Postgres | |
| **Datenmigrationen** | Plain-SQL-Dateien, fortlaufend nummeriert | Kein ORM-Migrationsmagier. Das Schema ist überschaubar. |
| **Datenbankzugriff** | Kysely (typsicherer Query-Builder) | Volle SQL-Kontrolle, die man für `FOR UPDATE` und Ledger-Abfragen braucht, mit Typsicherheit. Ein volles ORM würde bei den kritischen Abfragen im Weg stehen. |

---

## 3. Systemüberblick

```
┌────────────────────────────────────────────────────────────┐
│  CLIENT  (React PWA · dieselbe Codebasis in Capacitor)     │
│  Markt · Kader · Ticker · Feed · Wirtschaft                │
└───────────────┬────────────────────────┬───────────────────┘
                │ REST (Absichten)       │ WebSocket (Live)
                ▼                        ▼
┌────────────────────────────────────────────────────────────┐
│  API-SCHICHT (Fastify)                                     │
│  Auth · Validierung · Sichtbarkeitsfilter (§9)             │
└───────────────┬────────────────────────────────────────────┘
                ▼
┌────────────────────────────────────────────────────────────┐
│  DOMÄNENSCHICHT — reine Funktionen, keine I/O               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐ │
│  │ Auktion  │ │Simulation│ │Wirtschaft│ │ Ereignisse    │ │
│  │ + Escrow │ │ + Ticker │ │ + Ledger │ │ + Feed-Texte  │ │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────┘ │
└───────────────┬────────────────────────────────────────────┘
                ▼
┌────────────────────────────────────────────────────────────┐
│  SCHEDULER (im selben Prozess, eigener Tick)               │
│  Marktabschluss · Spieltage · Ereignisse · Saisonwechsel   │
└───────────────┬────────────────────────────────────────────┘
                ▼
┌────────────────────────────────────────────────────────────┐
│  PostgreSQL   ·   Web Push / APNs / FCM                    │
└────────────────────────────────────────────────────────────┘
```

**Die Domänenschicht enthält keine Datenbankzugriffe.** Sie bekommt Zustand hereingereicht und gibt beabsichtigte Änderungen zurück. Das ist der Grund, warum sich die Simulation und die Auktionsregeln ohne laufende Datenbank testen lassen — und der Grund, warum 1.000 Saisons Headless-Balancing (GDD §20.5) in Sekunden durchlaufen statt in Stunden.

---

## 4. Monorepo-Struktur

```
soccer-world/
├─ packages/
│  ├─ shared/              ← wird von Server UND Client importiert
│  │  ├─ rules/            Simulation, Auktionsregeln, Wirtschaftsformeln
│  │  │  ├─ match/         Ballbesitz-Ketten-Sim, xG, Ticker-Erzeugung
│  │  │  ├─ economy/       Einnahmen, Gehälter, Marktwert, Erwartung
│  │  │  ├─ auction/       Mindestschritt, Soft-Close, Proxy-Auflösung
│  │  │  └─ rng.ts         Deterministischer PRNG (§7)
│  │  ├─ types/            Alle Domänentypen
│  │  └─ text/             Feed- und Ereignis-Templates (§11)
│  ├─ server/
│  │  ├─ api/              Routen, Validierung, Sichtbarkeitsfilter
│  │  ├─ domain/           Anwendungsfälle (orchestriert shared/rules + DB)
│  │  ├─ scheduler/        Job-Runner und Job-Handler
│  │  ├─ db/               Schema, Migrationen, Abfragen
│  │  └─ realtime/         WebSocket-Hub, Push-Versand
│  └─ client/
│     ├─ screens/
│     ├─ components/
│     └─ state/
├─ data/
│  └─ players.json         Die 150 realen Profis (austauschbare Datenschicht, GDD A3)
└─ tools/
   └─ balance-sim/         Headless-Saisonsimulator für §19.4-Zielwerte
```

Die Trennung `shared/rules` gegen `server/domain` ist die wichtigste Strukturentscheidung: **Regeln sind reine Funktionen, Anwendungsfälle machen I/O.** Wer das vermischt, kann später weder balancen noch testen.

---

## 5. Der Scheduler — das Herzstück

Dieses Spiel ist im Kern ein Terminplaner. Pro Tag laufen automatisch:

| Uhrzeit | Job |
|---|---|
| 08:00 | `deliver_events` — 1–2 Ereignisse pro Verein zustellen, Push |
| 16:00–17:00 | `close_auction` — pro Auktion ein eigener Job, gestaffelt alle 2–4 Minuten |
| 17:00 / 20:00 / 22:00 | `run_matchday` — alle Partien des Spieltags simulieren |
| nach jedem Spieltag | `settle_matchday` — Zuschauer, Einnahmen, Gehälter, Fanstimmung, Feed |
| Saisonende | `season_rollover` — Ehrungen, Alterung, Marktnachschub, Bot-Rekalibrierung |

### Warum kein Cron

System-Cron oder `setInterval` scheitern an drei Anforderungen:

1. **Idempotenz.** Startet der Prozess während eines Spieltags neu, darf der Spieltag nicht zweimal simuliert werden. Jeder Job hat deshalb einen `idempotency_key` mit Unique-Constraint, etwa `matchday:7f3a:s3:md14`. Ein zweiter Einfügeversuch schlägt in der Datenbank fehl — nicht in der Anwendungslogik.
2. **Nachholbarkeit.** War der Server um 20:00 offline, muss der Spieltag beim Hochfahren nachgeholt werden, nicht ausfallen. Ein Job mit `run_at` in der Vergangenheit wird beim nächsten Tick eingesammelt.
3. **Nachvollziehbarkeit.** Wenn ein Freund fragt "warum ist mein Spieltag nicht gelaufen", will man in einer Tabelle nachsehen können.

### Umsetzung

```
alle 5 Sekunden:
  BEGIN
    SELECT * FROM job
     WHERE status = 'pending' AND run_at <= now()
     ORDER BY run_at
     LIMIT 10
     FOR UPDATE SKIP LOCKED         ← mehrere Worker sind damit gefahrlos
    → status = 'running', locked_at = now()
  COMMIT
  für jeden Job: Handler ausführen, Folgejobs einplanen, status = 'done'
```

`FOR UPDATE SKIP LOCKED` ist der Grund, warum diese schlichte Lösung trägt: Sie ist auch dann korrekt, wenn später ein zweiter Prozess dazukommt.

**Jobs planen sich gegenseitig.** `run_matchday` für Spieltag 14 legt am Ende `run_matchday` für Spieltag 15 an. Damit gibt es keinen globalen Zeitplan, der aus dem Tritt geraten kann — nur eine Kette, die sich selbst fortschreibt.

### Latenzanspruch

Ein 5-Sekunden-Tick ist für Spieltage völlig ausreichend. **Für Auktionsenden nicht.** Der Marktabschluss braucht Sekundengenauigkeit, sonst fühlt sich der Soft-Close falsch an. Deshalb schaltet der Scheduler zwischen 15:55 und 17:30 auf einen **1-Sekunden-Tick** um. Ein Sonderfall, aber der einzige, der ihn braucht.

---

## 6. Auktionen und Escrow — der kritische Pfad

Der mit Abstand schwierigste Teil des Systems. Alles andere darf naiv gebaut werden; das hier nicht.

### Das Problem

Ein Gebot bindet Geld (GDD §6.1). Verfügbares Budget ist also nicht der Kontostand:

```
verfügbar = kassenbestand − Σ(offene Escrow-Sperren)
```

Bietet Marco gleichzeitig auf drei Spieler, während Tom ihn auf einem davon überbietet, müssen **alle** folgenden Invarianten jederzeit gelten:

1. Kein Verein bindet mehr Geld, als er hat.
2. Genau ein Höchstbieter pro Auktion.
3. Wird jemand überboten, wird seine Sperre freigegeben — vollständig und genau einmal.
4. Proxy-Gebote lösen sich deterministisch auf, unabhängig von der Eintreffreihenfolge.

### Die Lösung: eine Transaktion, feste Sperrreihenfolge

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;

  SELECT * FROM auction WHERE id = $auction FOR UPDATE;      -- 1. immer zuerst
  SELECT * FROM club    WHERE id = $club    FOR UPDATE;      -- 2. immer danach

  -- Prüfen: Auktion offen? Betrag >= aktuelles Gebot + Mindestschritt?
  -- Prüfen: verfügbar >= Betrag?

  UPDATE escrow_hold SET released_at = now()
   WHERE auction_id = $auction AND released_at IS NULL;      -- alten Bieter lösen
  INSERT INTO escrow_hold (club_id, auction_id, amount) ...; -- neuen sperren
  INSERT INTO bid ...;
  UPDATE auction SET current_bid, current_bidder_club_id,
         closes_at = GREATEST(closes_at, now() + interval '3 minutes');  -- Soft-Close

COMMIT;
```

**Die feste Sperrreihenfolge Auktion-vor-Verein ist nicht kosmetisch.** Ohne sie entstehen Deadlocks, sobald zwei Vereine sich wechselseitig auf zwei Auktionen überbieten — ein Fall, der beim Marktabschluss garantiert eintritt.

### Proxy-Gebote

Nach jedem Gebot wird der Auktionszustand **innerhalb derselben Transaktion** komplett neu aus allen hinterlegten Maxima abgeleitet: Es führt, wer das höchste Maximum hat, und er zahlt einen Mindestschritt über dem zweithöchsten — nie sein eigenes Maximum. Bei exakt gleichem Maximum gewinnt das frühere Gebot.

Damit hängt das Ergebnis **nur von den Maxima ab, nicht von der Klickreihenfolge**. Das ist Voraussetzung dafür, dass asynchrones Bieten überhaupt fair sein kann — sonst gewinnt, wer zufällig um 16:47 wach ist. Ein Test permutiert alle Reihenfolgen von vier Geboten und prüft, dass Führender und Preis identisch bleiben.

### Was Escrow bindet: das Maximum, nicht den Preis

Beim Umsetzen wurde eine Lücke sichtbar, die im Design nicht benannt war. Bindet eine Sperre nur den **angezeigten Preis**, kann ein Verein ein Proxy-Maximum von 100 Mio hinterlegen, während nur 20 Mio gebunden sind — und die restlichen 80 Mio zwischenzeitlich anderswo ausgeben. Feuert sein Proxy später, ist es ungedeckt.

Deshalb gilt:

- **Geprüft wird gegen das Maximum.** Wer 100 Mio hinterlegt, muss 100 Mio frei haben. Sonst ließen sich Preise mit ungedeckten Maxima hochtreiben.
- **Gebunden wird das Maximum des Führenden.** Nur der Führende bindet; wer überboten wird, bekommt sein Geld sofort frei.

Das macht ein hohes Proxy-Gebot bewusst teuer: Es blockiert Liquidität für den ganzen restlichen Markttag. Genau die strategische Frage, die §6.1 des Designs stellt — *wo binde ich mein Geld, während der Markt läuft?* — wird dadurch erst scharf.

### Abschluss

`close_auction` läuft ebenfalls unter `FOR UPDATE` auf der Auktion. Ist `closes_at` durch einen Soft-Close inzwischen in der Zukunft, plant der Job sich einfach neu ein, statt abzuschließen. Danach:

| Fall | Ablauf |
|---|---|
| **Freier Agent** | Sofortige Abwicklung (GDD F17): Sperre wird in eine Zahlung umgewandelt, Spieler wechselt den Verein, Ledger-Buchungen, Transfersteuer, Feed-Eintrag. |
| **Spieler eines Freundes** | Status `awaiting_seller`. Der Verkäufer hat bis zum nächsten Marktabschluss Zeit. Die Sperre des Höchstbieters **bleibt bestehen** — sonst könnte er das Geld zwischenzeitlich ausgeben. |
| **Mindestpreis verfehlt** | Auktion platzt, alle Sperren frei. |

---

## 7. Deterministische Simulation

Jede Partie ist eine **reine Funktion**:

```ts
simulateMatch(home: SquadState, away: SquadState, ctx: MatchContext, seed: bigint)
  → { homeGoals, awayGoals, events: TickerEvent[], stats, playerRatings }
```

Kein `Math.random`, kein `Date.now()`, kein Datenbankzugriff. Der Seed wird beim Anlegen der Partie berechnet und gespeichert:

```
seed = hash(league_id, season, matchday, home_club_id, away_club_id, league_salt)
```

Das bringt vier Dinge, die man später nicht mehr nachrüsten kann:

1. **Reproduzierbarkeit.** Ein gemeldeter Fehler ("dieses Tor war unmöglich") lässt sich exakt nachstellen.
2. **Ehrlichkeit.** Der Ticker kann jederzeit neu erzeugt werden — es gibt keine Version des Spiels, in der nachträglich am Ergebnis gedreht wurde.
3. **Balancing.** Der Headless-Simulator in `tools/balance-sim` rechnet 1.000 Saisons gegen die Zielwerte aus GDD §19.4, ohne Server und ohne Datenbank.
4. **Testbarkeit.** Feste Seeds ergeben feste Erwartungswerte in Unit-Tests.

Als PRNG genügt **mulberry32** oder **xoshiro128\*\***: klein, schnell, gut genug für Spielzwecke, und vor allem plattformunabhängig identisch — was `Math.random` ausdrücklich nicht ist.

Der Ticker speichert **keine fertigen Sätze**, sondern Schlüssel und Nutzlast (`{ key: 'goal_header', minute: 67, player: 412, assist: 388 }`). Der Text entsteht erst beim Rendern (§11). Das hält die Datenbank klein und erlaubt es, Formulierungen später zu verbessern, ohne die Historie zu verfälschen.

---

## 8. Echtzeit und Benachrichtigungen

### WebSocket

Ein Kanal pro Liga. Der Client abonniert nach dem Verbinden seine Liga und bekommt:

| Nachricht | Wann |
|---|---|
| `auction.bid` | Neues Höchstgebot (Betrag, Bieter, neues `closes_at`) |
| `auction.closed` | Zuschlag oder geplatzt |
| `match.finished` | Partie simuliert, Ticker abrufbar |
| `feed.item` | Neue Boulevard-Meldung |
| `club.event` | Neues Ereignis im Posteingang |

Der Server hält keinen Zustand im Speicher, den er nicht auch in der Datenbank hat. Verbindungsverlust heißt: neu laden, weiter. Für acht Nutzer braucht es keinen Reconnect-Zauber, nur einen sauberen Vollabgleich beim Verbinden.

### Push

Die Push-Strategie ist ein Produktproblem, kein technisches. Drei Spieltage plus Marktabschluss plus Ereignisse ergeben ungebündelt über zehn Benachrichtigungen am Tag — ein Deinstallationsgrund.

| Anlass | Verhalten |
|---|---|
| **Überboten** | Sofort, einzeln. Unverzichtbar — ohne das funktioniert die Auktion nicht. |
| **Marktabschluss beginnt** | Eine Nachricht um 15:55. |
| **Ereignisse** | Eine gebündelte Nachricht um 08:00. |
| **Anstoß** | **Eine** Sammelnachricht pro Abendblock, nicht drei. |
| **Saisonende** | Eine. |

Jede Kategorie ist einzeln abschaltbar. Der Versand läuft über dieselbe Job-Tabelle wie alles andere — damit ist er nachvollziehbar und wiederholbar.

---

## 9. Autorität und Sichtbarkeit

Der Server ist autoritativ (GDD A2). Der Client sendet ausschließlich **Absichten**: „biete 42 Mio", „stelle diese Elf auf", „wähle Option 2". Jede wird serverseitig vollständig neu validiert.

Wichtiger und leichter zu übersehen ist die **Gegenrichtung**. Es gibt Daten, die der Server niemals ausliefern darf — auch nicht versehentlich in einem verschachtelten Objekt:

| Niemals an den Client | Warum |
|---|---|
| `player_instance.true_potential` | Das verdeckte Potenzial ist die zentrale Informationsökonomie (GDD §15). Einmal im Netzwerk-Tab sichtbar, ist die Mechanik für immer tot. |
| Fremde Proxy-Maxima (`bid.max_amount`) | Das Maximum eines Gegners zu kennen, entscheidet jeden Bieterkrieg. |
| Fremde Aufstellungen vor Anstoß | Sonst ist die Taktikschicht wertlos. |
| Fremde Scoutingberichte | Wer bezahlt hat, soll seinen Vorsprung behalten. |
| Ungelöste Ereignisoptionen anderer Vereine | |

Umgesetzt wird das nicht durch Disziplin beim Schreiben von Endpunkten, sondern durch **eine einzige Projektionsschicht**: Domänenobjekte verlassen den Server ausschließlich durch `toPublicPlayer(player, viewerClubId)` und Geschwisterfunktionen. Direkte Serialisierung von Datenbankzeilen ist per Lint-Regel verboten. Das ist der einzige Weg, der auch in sechs Monaten noch hält.

---

## 10. Zeit und Zeitzonen

- **Alles wird in UTC gespeichert**, ausnahmslos.
- Jede Liga hat eine IANA-Zeitzone (`Europe/Berlin`), die der Host beim Erstellen wählt.
- Anstoß- und Marktzeiten sind als lokale Uhrzeiten konfiguriert (`17:00`, `20:00`, `22:00`) und werden bei der Jobplanung in UTC umgerechnet.
- Die Umrechnung passiert **pro Tag neu**, nicht einmalig — sonst verschiebt sich die Saison bei einer Sommerzeitumstellung mitten in der Woche um eine Stunde.

Ein realistischer Fehlerfall, den man einmal bewusst behandeln sollte: Fällt eine Umstellung in die Saison, ist ein Tag 23 oder 25 Stunden lang. Die Jobkette bleibt korrekt, weil jeder Job seinen Nachfolger aus der Kalenderzeit ableitet, nicht durch Addition von 24 Stunden.

---

## 11. Textsystem

Feed- und Ereignistexte kommen aus handgeschriebenen Templates (GDD F20). Technisch ist das ein kleines, aber eigenständiges Teilsystem:

```ts
// packages/shared/text/feed.de.ts
'transfer.overpaid': [
  '{club} zahlt {fee} für {player} — {pct} über Marktwert. Experten sprechen von {panic}.',
  '{fee} für {player}? {club} hat offenbar aufgehört zu rechnen.',
  'Der Markt staunt: {club} überweist {fee} für einen Spieler, der {value} wert ist.',
],
```

- **4–8 Varianten pro Schlüssel**, Auswahl über denselben deterministischen PRNG wie die Simulation — damit ist auch der Feed reproduzierbar.
- **Wortlisten** für Zuspitzungen (`{panic}` → „Panik", „Größenwahn", „einem Hilferuf").
- Zahlen werden über einen zentralen Formatierer gerendert (`42_000_000` → „42 Mio").
- Gespeichert wird nur Schlüssel plus Nutzlast. Der Text entsteht beim Anzeigen.

Der letzte Punkt ist wichtiger, als er klingt: Er erlaubt es, die Texte nach dem ersten Playtest zu schärfen, ohne die Feed-Historie neu zu schreiben — und macht eine zweite Sprache zu einer Datei statt zu einem Projekt.

---

## 12. Betrieb

| Aspekt | Lösung |
|---|---|
| **Deployment** | Ein Container, ein Prozess. Frontend als statische Dateien vom selben Server. |
| **Migrationen** | Nummerierte SQL-Dateien, beim Start automatisch angewendet. |
| **Backups** | Täglicher `pg_dump`. Bei dieser Datenmenge ist ein vollständiges Backup Sekunden groß. |
| **Logging** | Strukturiert (`pino`), mit `league_id` und `job_id` in jeder Zeile. |
| **Fehlerbehandlung** | Ein fehlgeschlagener Job wird dreimal wiederholt, danach als `failed` markiert und im Admin-Blick sichtbar. Ein Spieltag darf niemals still ausfallen. |
| **Admin-Ansicht** | Eine einzige geschützte Seite: laufende Jobs, fehlgeschlagene Jobs, Liga-Zustand, Knopf zum Nachholen. Zwei Stunden Arbeit, spart im Betrieb Tage. |

---

## 13. Testbarkeit

Weil die Regeln reine Funktionen sind, verteilt sich der Testaufwand sinnvoll:

| Ebene | Umfang |
|---|---|
| **Regeln** (`shared/rules`) | Der Großteil. Simulation gegen feste Seeds, Wirtschaftsformeln, Auktionsschritte, Proxy-Auflösung. Schnell, ohne Datenbank. |
| **Nebenläufigkeit** | Wenige, aber unverzichtbare Integrationstests: 20 gleichzeitige Gebote gegen dieselbe Auktion, danach Invarianten aus §6 prüfen. **Ohne diesen Test geht das System nicht in Betrieb.** |
| **Scheduler** | Idempotenz: denselben Job zweimal ausführen, Zustand muss identisch sein. |
| **Sichtbarkeit** | Ein Test pro Projektionsfunktion, der prüft, dass `true_potential` und fremde Maxima nicht im Ergebnis auftauchen. |
| **Balancing** | Kein Test, sondern ein Werkzeug: `tools/balance-sim` prüft die Zielwerte aus GDD §19.4 und läuft im CI als Warnung, nicht als Fehler. |

---

## 14. Was bewusst nicht gebaut wird

| Nicht | Warum |
|---|---|
| Microservices | Acht Nutzer. Ein Prozess. |
| Redis | Postgres hat Sperren, Transaktionen und `LISTEN/NOTIFY`. Ein zweiter Datenspeicher wäre eine zweite Fehlerquelle. |
| Kubernetes | Siehe oben. |
| GraphQL | Die Sichtbarkeitsregeln aus §9 sind mit festen Projektionen leichter zu garantieren als mit frei kombinierbaren Feldern. |
| Event Sourcing | Außer im Ledger, wo es ohnehin die natürliche Form ist. |
| Eigenes Auth-System | E-Mail-Magic-Link oder ein Anbieter. Passwörter sind reine Haftung. |
| Offline-Modus | Ein Multiplayer-Wirtschaftsspiel ohne Server ist keins. |

---

## 15. Baureihenfolge

Die Reihenfolge folgt dem Risiko, nicht der Sichtbarkeit. Was schiefgehen kann, wird zuerst gebaut.

| Schritt | Inhalt | Zuerst fertig, weil |
|---|---|---|
| **1** | Schema, Migrationen, Auth, Lobby | Fundament |
| **2** | `shared/rules/match` + Headless-Balancer | **Die Simulation muss stimmen, bevor eine Oberfläche darauf gebaut wird.** Hier wird auch die Attributkalibrierung der 150 Spieler geprüft. |
| **3** | Auktion, Escrow, Nebenläufigkeitstests | Der gefährlichste Teil. Je früher, desto billiger. |
| **4** | Scheduler und Jobkette | Danach läuft eine Saison von selbst durch, auch ohne Oberfläche. |
| **5** | Wirtschaft, Ledger, Fanmodell | |
| **6** | Ereignisse, Feed, Templates | |
| **7** | Client: Markt → Kader → Ticker → Feed → Wirtschaft | In dieser Reihenfolge, weil der Markt der Kern ist |
| **8** | Push, Capacitor-Verpackung | |
| **9** | Playtest, Balancing, Nachbesserung | |

Nach Schritt 4 existiert ein Spiel, das eine vollständige Saison ohne Benutzeroberfläche durchspielt und deren Ergebnis man in der Datenbank nachlesen kann. **Das ist der wichtigste Meilenstein des Projekts** — ab dort ist alles Weitere Darstellung statt Risiko.
