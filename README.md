# Soccer World

Ein asynchrones Multiplayer-Strategiespiel für Freundesgruppen: Jeder besitzt einen
Fußballverein, alle teilen sich denselben knappen Transfermarkt, eine Saison dauert
eine Woche mit 21 Spieltagen — und am Ende gibt es nicht einen Sieger, sondern acht.

**Status:** Konzeptphase abgeschlossen, noch keine Implementierung.

## Dokumente

| Dokument | Inhalt |
|---|---|
| [Game Design Document](docs/GAME_DESIGN.md) | Das vollständige Spielkonzept in 23 Abschnitten: Core Loop, Transfermarkt und Bieterkriege, Simulation, Ereignisse, Wirtschaft, Fans, Anti-Snowball-Balancing, MVP-Zuschnitt und Entscheidungsprotokoll. |
| [Systemarchitektur](docs/ARCHITECTURE.md) | Technologiewahl, Scheduler, Auktions- und Escrow-Nebenläufigkeit, deterministische Simulation, Sichtbarkeitsregeln, Baureihenfolge. |
| [Datenmodell](docs/DATA_MODEL.md) | PostgreSQL-Schema mit allen Tabellen, Invarianten und Datenmengen. |

## Die Kurzfassung

- **3–8 Freunde**, bei ungerader Zahl füllt ein Bot-Verein auf
- **Eine Saison = 7 Tage = 21 Spieltage**, drei Anstöße täglich um 17, 20 und 22 Uhr
- **Ein gemeinsamer Transfermarkt** mit echten Profis, durchgehend offen,
  täglicher Marktabschluss zwischen 16 und 17 Uhr
- **Simulierte Partien** als 90-Sekunden-Ticker, deterministisch und reproduzierbar
- **Acht Trophäen und zwei Anti-Trophäen** pro Saison, Prestige kumuliert über alle Saisons
