-- Boulevard-Feed. Gespeichert wird Schlüssel plus Nutzlast, nie fertiger Text
-- (Architektur §11) — dann lassen sich Formulierungen später verbessern, ohne
-- die Historie zu verfälschen.

CREATE TABLE feed_item (
  id           bigserial PRIMARY KEY,
  league_id    uuid NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  season       smallint NOT NULL,
  matchday     smallint NOT NULL,
  template_key text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  subject_club_id uuid REFERENCES club(id) ON DELETE SET NULL,
  importance   smallint NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON feed_item (league_id, created_at DESC);
CREATE INDEX ON feed_item (league_id, template_key, subject_club_id, matchday DESC);

CREATE TABLE feed_reaction (
  feed_item_id bigint NOT NULL REFERENCES feed_item(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  emoji        text NOT NULL,
  PRIMARY KEY (feed_item_id, user_id, emoji)
);

-- Serien werden fortgeschrieben, weil sie sich aus der Tabelle allein nicht
-- ablesen lassen
ALTER TABLE standing
  ADD COLUMN win_streak smallint NOT NULL DEFAULT 0,
  ADD COLUMN loss_streak smallint NOT NULL DEFAULT 0;
