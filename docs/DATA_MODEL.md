# Soccer World — Datenmodell

**Version:** 0.1
**Bezug:** [Game Design Document](GAME_DESIGN.md) v0.3, [Architektur](ARCHITECTURE.md)
**Datenbank:** PostgreSQL 16
**Status:** Entwurf, noch keine Implementierung

---

## 1. Die wichtigste Trennung: Stammdaten gegen Ligadaten

Fast jeder Modellierungsfehler in einem Spiel dieser Art entsteht aus einer einzigen Verwechslung: **Ein realer Fußballer ist nicht dasselbe wie ein Spieler in einer Liga.**

| | `player_template` | `player_instance` |
|---|---|---|
| Was | Der reale Profi als Stammdatum | Sein Dasein in *einer* Liga |
| Anzahl | 150, wächst | 64–150 **pro Liga** |
| Enthält | Name, Alter, Position, Basiswerte, Traits, Potenzial**range** | Besitzer, Vertrag, Form, Fitness, Moral, entwickelte Werte, **wahres Potenzial** |
| Ändert sich | Nur wenn du die Datei pflegst | Ständig |

Der Nutzen wird an drei Stellen sofort konkret:

1. **Mehrere Ligen gleichzeitig** funktionieren ohne Sonderfall. Derselbe Profi kann bei Marco unter Vertrag stehen und in der zweiten Lobby freier Agent sein.
2. **Das wahre Potenzial wird pro Liga neu gewürfelt** aus der Template-Range. Niemand kann aus Saison 1 lernen, dass ein bestimmter Spieler ein Flop ist — die Wette ist in jeder Liga neu.
3. **Der Namenstausch** (GDD A3: reale Namen später ersetzbar) betrifft genau eine Tabelle und eine JSON-Datei.

```
data/players.json  ──►  player_template  ──►  player_instance  ──►  club
   (austauschbar)          (global)            (pro Liga)
```

---

## 2. Überblick

```
                    ┌──────────────┐
                    │  app_user    │
                    └──────┬───────┘
                           │
              ┌────────────▼─────────────┐         ┌──────────────────┐
              │         league           │◄────────│      season      │
              └────────────┬─────────────┘         └──────────────────┘
                           │
       ┌───────────────────┼────────────────────┐
       ▼                   ▼                    ▼
┌────────────┐     ┌──────────────┐      ┌─────────────┐
│    club    │     │player_instance│      │   match     │
└──────┬─────┘     └───────┬──────┘      └──────┬──────┘
       │                   │                     │
   ┌───┴────┬─────────┐    │              ┌──────▼──────┐
   ▼        ▼         ▼    ▼              │ match_event │
┌──────┐┌────────┐┌────────────┐          └─────────────┘
│lineup││ledger_ ││  auction   │
│      ││ entry  │└──────┬─────┘
└──────┘└────────┘       │
                    ┌────▼────┬──────────────┐
                    ▼         ▼              ▼
                 ┌─────┐ ┌──────────┐  ┌──────────┐
                 │ bid │ │escrow_   │  │ transfer │
                 └─────┘ │  hold    │  └──────────┘
                         └──────────┘
```

Nebenstränge: `club_event`, `feed_item`, `scout_report`, `sponsor_contract`, `stadium_project`, `trophy`, `job`.

---

## 3. Konventionen

| Regel | Begründung |
|---|---|
| Primärschlüssel: `uuid` mit `gen_random_uuid()` | Ligen sind unabhängig, IDs sollen nicht raten lassen, wie viele Nutzer es gibt |
| Geldbeträge: `bigint`, Einheit **ganze Euro** | Bei Beträgen bis 400 Mio ist `numeric` unnötig langsam und `int` zu klein. Keine Cent-Beträge im Spiel |
| Zeitpunkte: `timestamptz`, immer UTC | Siehe Architektur §10 |
| Prozent- und Stimmungswerte: `numeric(5,2)` | Nachvollziehbare Rundung in der Bilanz |
| Attribute: `smallint` (1–99) | |
| Spieltag: `smallint` (1–21) | Zusammen mit `season` eindeutig |
| Enums: `text` mit `CHECK`-Constraint | Postgres-Enums zu ändern ist mühsam; ein CHECK ist eine Migrationszeile |
| Flexible Nutzlasten: `jsonb` | Ereignisoptionen, Ticker-Details, Ligaeinstellungen |

---

## 4. Identität und Liga

```sql
CREATE TABLE app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE league (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  invite_code     text UNIQUE NOT NULL,
  host_user_id    uuid NOT NULL REFERENCES app_user(id),
  timezone        text NOT NULL DEFAULT 'Europe/Berlin',   -- IANA

  status          text NOT NULL DEFAULT 'building'
                  CHECK (status IN ('building','running','between_seasons','archived')),
  current_season  smallint NOT NULL DEFAULT 1,
  current_matchday smallint NOT NULL DEFAULT 0,

  -- Zeitplan als lokale Uhrzeiten, Umrechnung in UTC bei der Jobplanung
  kickoff_times     time[] NOT NULL DEFAULT '{17:00,20:00,22:00}',
  market_close_from time NOT NULL DEFAULT '16:00',
  market_close_to   time NOT NULL DEFAULT '17:00',
  event_delivery_at time NOT NULL DEFAULT '08:00',

  rng_salt        bigint NOT NULL,          -- fließt in jeden Match-Seed ein
  settings        jsonb NOT NULL DEFAULT '{}',  -- Liga-Verfassung (GDD §16.5)
  building_deadline timestamptz,            -- 24h-Frist der Aufbauphase
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE season (
  league_id       uuid NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  number          smallint NOT NULL,
  status          text NOT NULL CHECK (status IN ('upcoming','running','finished')),
  started_at      timestamptz,
  ended_at        timestamptz,
  tv_pool         bigint NOT NULL DEFAULT 0,
  solidarity_pool bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (league_id, number)
);

CREATE TABLE club (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id      uuid NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  user_id        uuid REFERENCES app_user(id),      -- NULL ⇒ Bot-Verein (GDD §9.5)
  is_bot         boolean NOT NULL DEFAULT false,

  name           text NOT NULL,
  short_name     text NOT NULL,
  city           text,
  color_primary  text NOT NULL,
  color_secondary text NOT NULL,
  crest          jsonb NOT NULL DEFAULT '{}',
  motto          text,

  cash           bigint NOT NULL,             -- Cache, siehe §10
  fan_count      integer NOT NULL DEFAULT 350000,
  fan_mood       numeric(5,2) NOT NULL DEFAULT 60.00,
  stadium_capacity integer NOT NULL DEFAULT 25000,
  stadium_condition numeric(5,2) NOT NULL DEFAULT 100.00,
  ticket_price   integer NOT NULL DEFAULT 40,
  prestige       integer NOT NULL DEFAULT 0,

  is_ready       boolean NOT NULL DEFAULT false,   -- Bereit-Button (GDD F15)
  created_at     timestamptz NOT NULL DEFAULT now(),

  UNIQUE (league_id, user_id),
  CHECK (is_bot = (user_id IS NULL))
);
```

Der letzte `CHECK` ist klein und verhindert dauerhaft eine ganze Fehlerklasse: einen Bot mit Benutzer oder einen menschlichen Verein ohne.

---

## 5. Spieler

```sql
-- Stammdaten, ligaübergreifend, aus data/players.json geladen
CREATE TABLE player_template (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_key   text UNIQUE NOT NULL,        -- stabiler Schlüssel für Re-Importe
  full_name      text NOT NULL,
  birth_year     smallint NOT NULL,
  primary_position text NOT NULL
                 CHECK (primary_position IN ('GK','CB','LB','RB','DM','CM','AM','LW','RW','ST')),
  secondary_positions text[] NOT NULL DEFAULT '{}',

  finishing      smallint NOT NULL,
  technique      smallint NOT NULL,
  vision         smallint NOT NULL,
  tackling       smallint NOT NULL,
  pace           smallint NOT NULL,
  goalkeeping    smallint NOT NULL,

  potential_min  smallint NOT NULL,           -- Range, aus der pro Liga gewürfelt wird
  potential_max  smallint NOT NULL,
  tier           text NOT NULL CHECK (tier IN ('world_class','very_good','solid')),
  traits         text[] NOT NULL DEFAULT '{}',
  base_value     bigint NOT NULL,             -- Referenzmarktwert für die Kalibrierung
  CHECK (potential_max >= potential_min)
);

-- Der Spieler in genau einer Liga
CREATE TABLE player_instance (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id      uuid NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  template_id    uuid NOT NULL REFERENCES player_template(id),
  club_id        uuid REFERENCES club(id) ON DELETE SET NULL,   -- NULL ⇒ freier Agent

  pool_state     text NOT NULL DEFAULT 'active'
                 CHECK (pool_state IN ('active','reserve','retired')),

  age            smallint NOT NULL,
  finishing      smallint NOT NULL,
  technique      smallint NOT NULL,
  vision         smallint NOT NULL,
  tackling       smallint NOT NULL,
  pace           smallint NOT NULL,
  goalkeeping    smallint NOT NULL,
  overall        smallint NOT NULL,           -- abgeleitet, gecacht (§10)

  true_potential smallint NOT NULL,           -- ⚠ NIEMALS an den Client (Architektur §9)

  form           numeric(5,2) NOT NULL DEFAULT 50,
  fitness        numeric(5,2) NOT NULL DEFAULT 100,
  morale         numeric(5,2) NOT NULL DEFAULT 60,
  injured_until_matchday smallint,
  suspension_matches smallint NOT NULL DEFAULT 0,

  wage_per_matchday bigint NOT NULL,
  contract_until_matchday smallint NOT NULL,  -- absolut: (season-1)*21 + matchday
  market_value   bigint NOT NULL,

  acquired_fee   bigint,                      -- für Trophäe „Bester Transfer"
  acquired_at_abs_matchday integer,
  acquired_ovr   smallint,

  UNIQUE (league_id, template_id)
);

CREATE INDEX ON player_instance (league_id, club_id);
CREATE INDEX ON player_instance (league_id, pool_state) WHERE club_id IS NULL;
```

`UNIQUE (league_id, template_id)` garantiert, dass derselbe reale Profi nie zweimal in derselben Liga existiert — ohne diese Zeile ist ein doppelter Mbappé nur eine Frage der Zeit.

`contract_until_matchday` und `acquired_at_abs_matchday` sind **absolut** über alle Saisons gezählt (`(season−1)×21 + matchday`). Das erspart bei jedem Vergleich eine Fallunterscheidung und macht Verträge über Saisongrenzen hinweg trivial.

```sql
-- Scouting ist pro Verein: wer bezahlt, behält seinen Vorsprung
CREATE TABLE scout_report (
  club_id            uuid NOT NULL REFERENCES club(id) ON DELETE CASCADE,
  player_instance_id uuid NOT NULL REFERENCES player_instance(id) ON DELETE CASCADE,
  level              smallint NOT NULL CHECK (level BETWEEN 1 AND 3),
  revealed_min       smallint NOT NULL,
  revealed_max       smallint NOT NULL,
  traits_revealed    boolean NOT NULL DEFAULT false,
  cost               bigint NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, player_instance_id)
);
```

Ohne eigene Tabelle würde ein Scoutingbericht allen zugutekommen — und die Informationsökonomie aus GDD §15 wäre wirkungslos.

---

## 6. Aufstellung

```sql
-- Genau eine Aufstellung pro Verein (GDD F9)
CREATE TABLE lineup (
  club_id        uuid PRIMARY KEY REFERENCES club(id) ON DELETE CASCADE,
  formation      text NOT NULL DEFAULT '4-4-2',
  starters       jsonb NOT NULL DEFAULT '[]',   -- [{slot:'ST_L', playerId:'…'}, …]
  bench          jsonb NOT NULL DEFAULT '[]',

  tempo          smallint NOT NULL DEFAULT 50,  -- 0 kontrolliert … 100 direkt
  pressing       smallint NOT NULL DEFAULT 50,  -- 0 tief … 100 hoch
  risk           smallint NOT NULL DEFAULT 50,  -- 0 defensiv … 100 offensiv
  attack_focus   text NOT NULL DEFAULT 'central'
                 CHECK (attack_focus IN ('left','central','right')),

  captain_id       uuid REFERENCES player_instance(id) ON DELETE SET NULL,
  penalty_taker_id uuid REFERENCES player_instance(id) ON DELETE SET NULL,
  set_piece_taker_id uuid REFERENCES player_instance(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
```

Die Aufstellung ist als `jsonb` modelliert statt als Zeilen pro Position, weil sie immer vollständig gelesen und vollständig geschrieben wird. Eine `lineup_slot`-Tabelle mit elf Zeilen wäre hier reine Zeremonie.

Die tatsächlich angetretene Elf wird pro Partie in `match.home_lineup_snapshot` eingefroren (§8) — sonst wäre der Ticker eines alten Spiels nicht mehr nachvollziehbar, sobald jemand umstellt.

---

## 7. Markt

Der heikelste Teil des Schemas. Siehe Architektur §6 für die Nebenläufigkeitsregeln.

```sql
CREATE TABLE auction (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id      uuid NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  player_instance_id uuid NOT NULL REFERENCES player_instance(id) ON DELETE CASCADE,
  seller_club_id uuid REFERENCES club(id),     -- NULL ⇒ freier Agent

  min_price      bigint NOT NULL DEFAULT 0,
  current_bid    bigint,
  current_bidder_club_id uuid REFERENCES club(id),

  opens_at       timestamptz NOT NULL,
  closes_at      timestamptz NOT NULL,         -- wird durch Soft-Close verschoben
  original_closes_at timestamptz NOT NULL,

  status         text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','awaiting_seller','completed','cancelled','expired')),
  seller_deadline timestamptz,                 -- nur bei awaiting_seller
  settled_at     timestamptz
);

CREATE INDEX ON auction (league_id, status, closes_at);
CREATE UNIQUE INDEX ON auction (player_instance_id) WHERE status IN ('open','awaiting_seller');
```

Der partielle Unique-Index ist die wichtigste Zeile im ganzen Marktschema: **Ein Spieler kann niemals in zwei offenen Auktionen gleichzeitig stehen.** Datenbankseitig garantiert, nicht durch Anwendungslogik gehofft.

```sql
CREATE TABLE bid (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id     uuid NOT NULL REFERENCES auction(id) ON DELETE CASCADE,
  club_id        uuid NOT NULL REFERENCES club(id) ON DELETE CASCADE,
  amount         bigint NOT NULL,
  max_amount     bigint,                       -- ⚠ Proxy-Maximum, nie an fremde Clients
  is_auto        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON bid (auction_id, created_at DESC);

CREATE TABLE escrow_hold (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id        uuid NOT NULL REFERENCES club(id) ON DELETE CASCADE,
  auction_id     uuid NOT NULL REFERENCES auction(id) ON DELETE CASCADE,
  amount         bigint NOT NULL CHECK (amount > 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  released_at    timestamptz
);

CREATE UNIQUE INDEX ON escrow_hold (auction_id) WHERE released_at IS NULL;
CREATE INDEX ON escrow_hold (club_id) WHERE released_at IS NULL;
```

Auch hier trägt ein partieller Unique-Index die zentrale Invariante: **höchstens eine offene Sperre pro Auktion** — also genau ein Höchstbieter, dessen Geld gebunden ist.

Verfügbares Budget eines Vereins:

```sql
SELECT c.cash - COALESCE(SUM(e.amount), 0) AS available
  FROM club c
  LEFT JOIN escrow_hold e ON e.club_id = c.id AND e.released_at IS NULL
 WHERE c.id = $1
 GROUP BY c.cash;
```

```sql
CREATE TABLE transfer (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id      uuid NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  player_instance_id uuid NOT NULL REFERENCES player_instance(id),
  from_club_id   uuid REFERENCES club(id),     -- NULL ⇒ war freier Agent
  to_club_id     uuid REFERENCES club(id),     -- NULL ⇒ entlassen/Vertragsauflösung
  fee            bigint NOT NULL DEFAULT 0,
  tax            bigint NOT NULL DEFAULT 0,
  channel        text NOT NULL CHECK (channel IN ('auction','direct','loan','release','assignment')),
  clauses        jsonb NOT NULL DEFAULT '{}',  -- Weiterverkauf, Rückkauf, Raten, Boni
  season         smallint NOT NULL,
  matchday       smallint NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
```

`transfer` ist die vollständige Historie und speist die Trophäen „Bester Transfer" und „Fehleinkauf der Saison" sowie den Feed. `channel = 'release'` deckt die Vertragsauflösung nach GDD F18 ab.

---

## 8. Spielbetrieb

```sql
CREATE TABLE match (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id      uuid NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  season         smallint NOT NULL,
  matchday       smallint NOT NULL CHECK (matchday BETWEEN 1 AND 21),
  home_club_id   uuid NOT NULL REFERENCES club(id),
  away_club_id   uuid NOT NULL REFERENCES club(id),

  kickoff_at     timestamptz NOT NULL,
  seed           bigint NOT NULL,              -- deterministische Simulation

  status         text NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('scheduled','simulated')),
  home_goals     smallint,
  away_goals     smallint,
  attendance     integer,

  home_lineup_snapshot jsonb,                  -- eingefroren zum Anstoß
  away_lineup_snapshot jsonb,
  stats          jsonb,                        -- Ballbesitz, Schüsse, xG, Noten
  simulated_at   timestamptz,

  UNIQUE (league_id, season, matchday, home_club_id)
);

CREATE INDEX ON match (league_id, season, matchday);

CREATE TABLE match_event (
  id             bigserial PRIMARY KEY,
  match_id       uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  minute         smallint NOT NULL,
  sequence       smallint NOT NULL,
  type           text NOT NULL,                -- goal, chance, card, injury, sub, …
  club_id        uuid REFERENCES club(id),
  player_instance_id uuid REFERENCES player_instance(id),
  secondary_player_id uuid REFERENCES player_instance(id),
  text_key       text NOT NULL,                -- Template-Schlüssel, kein fertiger Satz
  payload        jsonb NOT NULL DEFAULT '{}',
  UNIQUE (match_id, minute, sequence)
);

CREATE TABLE standing (
  league_id      uuid NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  season         smallint NOT NULL,
  club_id        uuid NOT NULL REFERENCES club(id) ON DELETE CASCADE,
  played         smallint NOT NULL DEFAULT 0,
  won            smallint NOT NULL DEFAULT 0,
  drawn          smallint NOT NULL DEFAULT 0,
  lost           smallint NOT NULL DEFAULT 0,
  goals_for      smallint NOT NULL DEFAULT 0,
  goals_against  smallint NOT NULL DEFAULT 0,
  points         smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (league_id, season, club_id)
);
```

`standing` ist bewusst redundant — es ließe sich aus `match` berechnen. Bei 21 Partien wäre das billig, aber die Tabelle wird auf jedem Bildschirm angezeigt und nach **Punkten pro Spiel** sortiert (GDD §9.1, wegen möglicher ungleicher Spielzahl). Eine gepflegte Tabelle ist hier die klarere Lösung; sie wird nach jedem Spieltag in derselben Transaktion fortgeschrieben.

---

## 9. Wirtschaft

```sql
CREATE TABLE ledger_entry (
  id             bigserial PRIMARY KEY,
  league_id      uuid NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  club_id        uuid NOT NULL REFERENCES club(id) ON DELETE CASCADE,
  season         smallint NOT NULL,
  matchday       smallint NOT NULL,
  category       text NOT NULL CHECK (category IN (
                   'ticket','tv','sponsor','merch','prize','bye_bonus',
                   'wages','maintenance','staff','interest','tax','solidarity',
                   'transfer_in','transfer_out','severance','stadium','scouting','other')),
  amount         bigint NOT NULL,              -- vorzeichenbehaftet: + Einnahme, − Ausgabe
  reference_type text,
  reference_id   uuid,
  description    text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON ledger_entry (club_id, season, matchday);
```

**Geld wird nie direkt gesetzt, sondern immer gebucht.** `club.cash` ist ein Cache, der in derselben Transaktion mitgeführt wird wie die Buchung. Die Invariante:

```sql
club.cash = (SELECT COALESCE(SUM(amount),0) FROM ledger_entry WHERE club_id = club.id)
```

Ein Konsistenztest prüft das nach jedem Spieltag. Der Preis sind ein paar zusätzliche Zeilen; der Gegenwert ist eine vollständige, prüfbare Bilanz — und die Fähigkeit, bei „wo ist mein Geld hin?" eine echte Antwort zu geben statt einer Vermutung.

```sql
CREATE TABLE sponsor_contract (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id        uuid NOT NULL REFERENCES club(id) ON DELETE CASCADE,
  slot           text NOT NULL CHECK (slot IN ('shirt','stadium','kit')),
  sponsor_name   text NOT NULL,
  profile        text NOT NULL CHECK (profile IN ('safe','performance','controversial')),
  base_per_matchday bigint NOT NULL DEFAULT 0,
  bonus_rules    jsonb NOT NULL DEFAULT '{}',  -- {perWin:…, title:…}
  mood_immediate numeric(5,2) NOT NULL DEFAULT 0,
  mood_per_matchday numeric(5,2) NOT NULL DEFAULT 0,
  conditions     jsonb NOT NULL DEFAULT '{}',  -- öffentlich sichtbar (GDD §14.3)
  until_season   smallint NOT NULL,
  UNIQUE (club_id, slot)
);

CREATE TABLE stadium_project (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id        uuid NOT NULL REFERENCES club(id) ON DELETE CASCADE,
  target_capacity integer NOT NULL,
  cost           bigint NOT NULL,
  started_abs_matchday integer NOT NULL,
  completes_abs_matchday integer NOT NULL,
  delays          smallint NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'running'
                 CHECK (status IN ('running','completed','cancelled'))
);

CREATE UNIQUE INDEX ON stadium_project (club_id) WHERE status = 'running';
```

---

## 10. Ereignisse, Feed, Trophäen

```sql
CREATE TABLE club_event (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id      uuid NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  club_id        uuid NOT NULL REFERENCES club(id) ON DELETE CASCADE,
  season         smallint NOT NULL,
  matchday       smallint NOT NULL,
  template_key   text NOT NULL,
  category       text NOT NULL CHECK (category IN ('squad','economy','fans','stadium','market','tabloid')),
  payload        jsonb NOT NULL DEFAULT '{}',  -- aufgelöste Variablen (Spieler, Beträge)
  options        jsonb NOT NULL,               -- [{key, effects}, …]
  default_option smallint NOT NULL DEFAULT 0,  -- greift bei Fristablauf
  chosen_option  smallint,
  expires_at     timestamptz NOT NULL,
  resolved_at    timestamptz,
  linked_event_id uuid REFERENCES club_event(id)   -- Zwei-Vereine-Ereignisse (GDD §10.6)
);

CREATE INDEX ON club_event (club_id, resolved_at) WHERE resolved_at IS NULL;

CREATE TABLE feed_item (
  id             bigserial PRIMARY KEY,
  league_id      uuid NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  season         smallint NOT NULL,
  matchday       smallint NOT NULL,
  template_key   text NOT NULL,
  payload        jsonb NOT NULL DEFAULT '{}',
  subject_club_id uuid REFERENCES club(id) ON DELETE SET NULL,
  importance     smallint NOT NULL DEFAULT 1,  -- 1 normal … 3 Schlagzeile
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON feed_item (league_id, created_at DESC);

CREATE TABLE feed_reaction (
  feed_item_id   bigint NOT NULL REFERENCES feed_item(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  emoji          text NOT NULL,
  PRIMARY KEY (feed_item_id, user_id, emoji)
);

CREATE TABLE trophy (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id      uuid NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  season         smallint NOT NULL,
  club_id        uuid NOT NULL REFERENCES club(id) ON DELETE CASCADE,
  kind           text NOT NULL,                -- champion, richest, fanbase, best_transfer, flop, …
  metric_value   bigint,
  prestige_awarded smallint NOT NULL DEFAULT 0,
  is_negative    boolean NOT NULL DEFAULT false
);
```

`club_event.linked_event_id` bildet die Ereignisse ab, die bei zwei Vereinen gleichzeitig landen — mechanisch die wertvollste Ereignisklasse des Designs und ohne diese Spalte nur mit Hilfskonstruktionen möglich.

Bot-Vereine bekommen keine `club_event`-Zeilen und keine `trophy`-Zeilen (GDD §9.5). Das ist eine Regel im Domänencode, keine Datenbankeinschränkung — der Bot soll in `standing` und `match` ganz normal vorkommen.

---

## 11. System

```sql
CREATE TABLE job (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id       uuid REFERENCES league(id) ON DELETE CASCADE,
  type            text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}',
  run_at          timestamptz NOT NULL,
  idempotency_key text UNIQUE NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','running','done','failed')),
  attempts        smallint NOT NULL DEFAULT 0,
  last_error      text,
  locked_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON job (status, run_at) WHERE status = 'pending';

CREATE TABLE push_subscription (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  platform       text NOT NULL CHECK (platform IN ('web','ios','android')),
  endpoint       text NOT NULL,
  keys           jsonb NOT NULL,
  preferences    jsonb NOT NULL DEFAULT '{"outbid":true,"market":true,"events":true,"kickoff":true}',
  created_at     timestamptz NOT NULL DEFAULT now()
);
```

`idempotency_key` als Unique-Constraint ist der gesamte Wiederanlaufschutz des Systems. Beispiele: `matchday:<league>:s3:md14`, `market_close:<auction>`, `events:<league>:s3:d5`.

---

## 12. Berechnet gegen gespeichert

| Wert | Umgang | Warum |
|---|---|---|
| **OVR** | gespeichert, bei Attributänderung neu berechnet | Wird in jeder Marktliste sortiert |
| **Marktwert** | gespeichert, nach jedem Spieltag neu berechnet | Hängt von Ligaknappheit ab (GDD §4.5), also nicht rein lokal |
| **Verfügbares Budget** | **immer berechnet** | Darf nie veralten — daran hängt die Escrow-Korrektheit |
| **Kassenbestand** | gespeichert als Cache, Wahrheit ist das Ledger | §9 |
| **Tabelle** | gespeichert, pro Spieltag fortgeschrieben | Wird ständig gelesen |
| **Teamstärke** | **immer berechnet** | Hängt von Form, Fitness, Klima und Gegner ab |
| **Erwartungswert der Fans** | pro Saison gespeichert | Soll sich innerhalb der Saison nicht mitbewegen |
| **Ticker-Text** | **immer gerendert** | Templates bleiben nachträglich verbesserbar |

---

## 13. Invarianten

Diese Aussagen müssen nach jeder abgeschlossenen Transaktion gelten. Sie gehören als Prüfroutine in den Integrationstest und in einen nächtlichen Konsistenzlauf.

| # | Invariante | Absicherung |
|---|---|---|
| 1 | `club.cash = Σ ledger_entry.amount` | Test + nächtliche Prüfung |
| 2 | Höchstens eine offene `escrow_hold` pro Auktion | Partieller Unique-Index |
| 3 | `Σ offene Sperren eines Vereins ≤ club.cash` | Transaktionsprüfung beim Gebot |
| 4 | Ein Spieler steht in höchstens einer offenen Auktion | Partieller Unique-Index |
| 5 | Ein Spieler gehört höchstens einem Verein | Fremdschlüssel |
| 6 | Ein realer Profi existiert höchstens einmal pro Liga | `UNIQUE (league_id, template_id)` |
| 7 | Kein Verein spielt an einem Spieltag zweimal | Spielplanerzeugung + Unique-Index |
| 8 | `true_potential` erscheint in keiner API-Antwort | Projektionstest |
| 9 | Bot-Vereine haben keine Ereignisse und keine Trophäen | Domänenregel |
| 10 | Jeder `match` hat einen festen `seed` vor der Simulation | `NOT NULL` |

Invariante 3 ist die einzige, die sich nicht per Constraint erzwingen lässt (sie ist eine Aggregatbedingung über zwei Tabellen). Genau deshalb braucht der Gebotspfad die Zeilensperre aus Architektur §6.

---

## 14. Datenmengen

Nach einer Saison mit 4 Vereinen:

| Tabelle | Zeilen |
|---|---|
| `player_instance` | 64 |
| `match` | 42 |
| `match_event` | ca. 900 |
| `bid` | 200–600 |
| `ledger_entry` | ca. 1.500 |
| `feed_item` | ca. 250 |
| `club_event` | ca. 50 |
| **Summe** | **unter 4.000 Zeilen pro Saison** |

Nach 50 Saisons: rund 200.000 Zeilen. **Das passt vollständig in den Arbeitsspeicher.** Es gibt in diesem Projekt keine Abfrage, die eine Optimierung jenseits der oben genannten Indizes rechtfertigt — und jede Stunde, die in Performance statt in Feed-Texte fließt, ist falsch investiert.

---

## 15. Migrationen

```
packages/server/db/migrations/
  001_initial.sql
  002_scout_reports.sql
  …
```

Fortlaufend nummerierte SQL-Dateien, beim Start in einer Transaktion angewendet, angewendete Versionen in `schema_migration`. Kein Rollback-Mechanismus — bei einem privaten Projekt mit täglichem Backup ist „Backup einspielen" der ehrlichere Weg als eine halb funktionierende `down`-Migration.

Die 150 Spieler kommen **nicht** über eine Migration in die Datenbank, sondern über ein Seed-Skript aus `data/players.json`, das gegen `external_key` aktualisiert. So bleibt die Datenschicht austauschbar (GDD A3) und die Spielerpflege unabhängig vom Schema.
