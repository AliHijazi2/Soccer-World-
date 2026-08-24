-- Spielbetrieb: Jobs, Partien, Ticker, Tabelle, Aufstellungen.

ALTER TABLE league
  ADD COLUMN season_start date,
  ADD COLUMN kickoff_times text[] NOT NULL DEFAULT '{17:00,20:00,22:00}',
  ADD COLUMN market_close_from text NOT NULL DEFAULT '16:00';

ALTER TABLE club
  ADD COLUMN stadium_capacity integer NOT NULL DEFAULT 25000,
  ADD COLUMN stadium_condition numeric(5,2) NOT NULL DEFAULT 100.00,
  ADD COLUMN ticket_price integer NOT NULL DEFAULT 40,
  ADD COLUMN prestige integer NOT NULL DEFAULT 0,
  ADD COLUMN squad_index smallint;      -- Position im Spielplan

ALTER TABLE player_instance
  ADD COLUMN primary_position text NOT NULL DEFAULT 'CM',
  ADD COLUMN attributes jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN traits text[] NOT NULL DEFAULT '{}',
  ADD COLUMN age smallint NOT NULL DEFAULT 25,
  ADD COLUMN form numeric(5,2) NOT NULL DEFAULT 50,
  ADD COLUMN fitness numeric(5,2) NOT NULL DEFAULT 100,
  ADD COLUMN morale numeric(5,2) NOT NULL DEFAULT 60,
  ADD COLUMN injured_until_matchday smallint,
  ADD COLUMN suspension_matches smallint NOT NULL DEFAULT 0;

CREATE TABLE lineup (
  club_id       uuid PRIMARY KEY REFERENCES club(id) ON DELETE CASCADE,
  formation     text NOT NULL DEFAULT '4-4-2',
  starters      jsonb NOT NULL DEFAULT '[]',
  bench         jsonb NOT NULL DEFAULT '[]',
  tempo         smallint NOT NULL DEFAULT 50,
  pressing      smallint NOT NULL DEFAULT 50,
  risk          smallint NOT NULL DEFAULT 50,
  attack_focus  text NOT NULL DEFAULT 'central',
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE match (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id     uuid NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  season        smallint NOT NULL,
  matchday      smallint NOT NULL CHECK (matchday BETWEEN 1 AND 21),
  home_club_id  uuid NOT NULL REFERENCES club(id),
  away_club_id  uuid NOT NULL REFERENCES club(id),
  kickoff_at    timestamptz NOT NULL,
  seed          bigint NOT NULL,
  status        text NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('scheduled','simulated')),
  home_goals    smallint,
  away_goals    smallint,
  attendance    integer,
  home_lineup_snapshot jsonb,
  away_lineup_snapshot jsonb,
  stats         jsonb,
  simulated_at  timestamptz,
  UNIQUE (league_id, season, matchday, home_club_id),
  CHECK (home_club_id <> away_club_id)
);
CREATE INDEX ON match (league_id, season, matchday);

CREATE TABLE match_event (
  id            bigserial PRIMARY KEY,
  match_id      uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  minute        smallint NOT NULL,
  sequence      smallint NOT NULL,
  type          text NOT NULL,
  club_id       uuid REFERENCES club(id),
  player_instance_id uuid REFERENCES player_instance(id),
  secondary_player_id uuid REFERENCES player_instance(id),
  text_key      text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}',
  UNIQUE (match_id, sequence)
);

CREATE TABLE standing (
  league_id     uuid NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  season        smallint NOT NULL,
  club_id       uuid NOT NULL REFERENCES club(id) ON DELETE CASCADE,
  played        smallint NOT NULL DEFAULT 0,
  won           smallint NOT NULL DEFAULT 0,
  drawn         smallint NOT NULL DEFAULT 0,
  lost          smallint NOT NULL DEFAULT 0,
  goals_for     smallint NOT NULL DEFAULT 0,
  goals_against smallint NOT NULL DEFAULT 0,
  points        smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (league_id, season, club_id)
);

CREATE TABLE job (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id       uuid REFERENCES league(id) ON DELETE CASCADE,
  type            text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}',
  run_at          timestamptz NOT NULL,
  idempotency_key text UNIQUE NOT NULL,     -- der gesamte Wiederanlaufschutz
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','running','done','failed')),
  attempts        smallint NOT NULL DEFAULT 0,
  last_error      text,
  locked_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);
CREATE INDEX job_pending ON job (run_at) WHERE status = 'pending';
