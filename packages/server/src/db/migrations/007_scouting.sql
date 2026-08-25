-- Scouting (GDD §15.2).
--
-- Bewusst je Verein: Ohne eigene Tabelle käme ein bezahlter Scoutingbericht
-- allen zugute, und die Informationsökonomie des Spiels wäre wirkungslos.
-- Wer zahlt, behält seinen Vorsprung.

CREATE TABLE scout_report (
  club_id            uuid NOT NULL REFERENCES club(id) ON DELETE CASCADE,
  player_instance_id uuid NOT NULL REFERENCES player_instance(id) ON DELETE CASCADE,
  level              smallint NOT NULL CHECK (level BETWEEN 1 AND 3),
  revealed_min       smallint NOT NULL,
  revealed_max       smallint NOT NULL,
  traits_revealed    boolean NOT NULL DEFAULT false,
  cost               bigint NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, player_instance_id),
  CHECK (revealed_max >= revealed_min)
);
