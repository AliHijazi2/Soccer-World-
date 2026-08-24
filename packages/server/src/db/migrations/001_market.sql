-- Marktrelevanter Ausschnitt des Schemas aus docs/DATA_MODEL.md.
-- Bewusst nur die Tabellen, die der Auktionspfad braucht.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE app_user (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text UNIQUE NOT NULL,
  display_name text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE league (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  invite_code  text UNIQUE NOT NULL,
  timezone     text NOT NULL DEFAULT 'Europe/Berlin',
  status       text NOT NULL DEFAULT 'building'
               CHECK (status IN ('building','running','between_seasons','archived')),
  current_season   smallint NOT NULL DEFAULT 1,
  current_matchday smallint NOT NULL DEFAULT 0,
  rng_salt     bigint NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE club (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   uuid NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES app_user(id),
  is_bot      boolean NOT NULL DEFAULT false,
  name        text NOT NULL,
  short_name  text NOT NULL,
  cash        bigint NOT NULL,
  fan_count   integer NOT NULL DEFAULT 350000,
  fan_mood    numeric(5,2) NOT NULL DEFAULT 60.00,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (league_id, user_id),
  CHECK (is_bot = (user_id IS NULL))
);

CREATE TABLE player_template (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_key text UNIQUE NOT NULL,
  full_name    text NOT NULL,
  birth_year   smallint NOT NULL,
  primary_position text NOT NULL,
  tier         text NOT NULL CHECK (tier IN ('world_class','very_good','solid')),
  attributes   jsonb NOT NULL,
  potential_min smallint NOT NULL,
  potential_max smallint NOT NULL,
  traits       text[] NOT NULL DEFAULT '{}',
  base_value   bigint NOT NULL,
  base_wage    bigint NOT NULL
);

CREATE TABLE player_instance (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   uuid NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES player_template(id),
  club_id     uuid REFERENCES club(id) ON DELETE SET NULL,
  pool_state  text NOT NULL DEFAULT 'active'
              CHECK (pool_state IN ('active','reserve','retired')),
  overall     smallint NOT NULL,
  true_potential smallint NOT NULL,   -- niemals an den Client
  market_value bigint NOT NULL,
  wage_per_matchday bigint NOT NULL,
  UNIQUE (league_id, template_id)     -- ein realer Profi je Liga nur einmal
);
CREATE INDEX ON player_instance (league_id, club_id);

CREATE TABLE auction (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id     uuid NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  player_instance_id uuid NOT NULL REFERENCES player_instance(id) ON DELETE CASCADE,
  seller_club_id uuid REFERENCES club(id),      -- NULL = freier Agent
  min_price     bigint NOT NULL DEFAULT 0,
  current_bid   bigint,
  current_bidder_club_id uuid REFERENCES club(id),
  opens_at      timestamptz NOT NULL DEFAULT now(),
  closes_at     timestamptz NOT NULL,
  original_closes_at timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','awaiting_seller','completed','cancelled','expired')),
  seller_deadline timestamptz,
  settled_at    timestamptz
);
CREATE INDEX ON auction (league_id, status, closes_at);
-- Ein Spieler kann niemals in zwei offenen Auktionen stehen
CREATE UNIQUE INDEX auction_one_open_per_player
  ON auction (player_instance_id) WHERE status IN ('open','awaiting_seller');

CREATE TABLE bid (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id uuid NOT NULL REFERENCES auction(id) ON DELETE CASCADE,
  club_id    uuid NOT NULL REFERENCES club(id) ON DELETE CASCADE,
  amount     bigint NOT NULL,
  max_amount bigint NOT NULL,        -- niemals an fremde Clients
  is_auto    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  sequence   bigserial NOT NULL      -- eindeutige Eingangsreihenfolge
);
CREATE INDEX ON bid (auction_id, sequence);

CREATE TABLE escrow_hold (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id    uuid NOT NULL REFERENCES club(id) ON DELETE CASCADE,
  auction_id uuid NOT NULL REFERENCES auction(id) ON DELETE CASCADE,
  amount     bigint NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);
-- Höchstens eine offene Sperre je Auktion: genau ein Höchstbieter bindet Geld
CREATE UNIQUE INDEX escrow_one_open_per_auction
  ON escrow_hold (auction_id) WHERE released_at IS NULL;
CREATE INDEX escrow_open_by_club
  ON escrow_hold (club_id) WHERE released_at IS NULL;

CREATE TABLE ledger_entry (
  id         bigserial PRIMARY KEY,
  league_id  uuid NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  club_id    uuid NOT NULL REFERENCES club(id) ON DELETE CASCADE,
  season     smallint NOT NULL,
  matchday   smallint NOT NULL,
  category   text NOT NULL,
  amount     bigint NOT NULL,       -- vorzeichenbehaftet
  reference_type text,
  reference_id   uuid,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ledger_entry (club_id, season, matchday);

CREATE TABLE transfer (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  uuid NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  player_instance_id uuid NOT NULL REFERENCES player_instance(id),
  from_club_id uuid REFERENCES club(id),
  to_club_id   uuid REFERENCES club(id),
  fee        bigint NOT NULL DEFAULT 0,
  tax        bigint NOT NULL DEFAULT 0,
  channel    text NOT NULL CHECK (channel IN ('auction','direct','loan','release','assignment')),
  clauses    jsonb NOT NULL DEFAULT '{}',
  season     smallint NOT NULL,
  matchday   smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
