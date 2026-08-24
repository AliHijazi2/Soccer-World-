-- Wirtschaft: Erwartungswerte, Sponsoren.

ALTER TABLE club
  -- Zu Saisonbeginn einmal festgelegt und danach fest: Die Erwartung darf sich
  -- innerhalb der Saison nicht mitbewegen, sonst kann man ihr davonlaufen.
  ADD COLUMN expected_ppg numeric(4,2) NOT NULL DEFAULT 1.38,
  ADD COLUMN season_goal text NOT NULL DEFAULT 'mid_table',
  ADD COLUMN season_start_squad_value bigint NOT NULL DEFAULT 0;

CREATE TABLE sponsor_contract (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id           uuid NOT NULL REFERENCES club(id) ON DELETE CASCADE,
  slot              text NOT NULL CHECK (slot IN ('shirt','stadium','kit')),
  sponsor_name      text NOT NULL,
  profile           text NOT NULL CHECK (profile IN ('safe','performance','controversial')),
  base_per_matchday bigint NOT NULL DEFAULT 0,
  bonus_per_win     bigint NOT NULL DEFAULT 0,
  title_bonus       bigint NOT NULL DEFAULT 0,
  mood_per_matchday numeric(5,2) NOT NULL DEFAULT 0,
  until_season      smallint NOT NULL,
  UNIQUE (club_id, slot)
);
