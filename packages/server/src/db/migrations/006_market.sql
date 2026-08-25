-- Die Außenwelt (GDD §5.4) ist ein Marktakteur, keine Mannschaft.
--
-- Explizites Flag statt Namensvergleich: Sie darf in keinem Spielplan, keiner
-- Tabelle, keiner Gehaltsabrechnung und keiner Feed-Meldung auftauchen — und
-- jede dieser Abfragen muss sie zuverlässig ausschließen können.
ALTER TABLE club
  ADD COLUMN is_outside_world boolean NOT NULL DEFAULT false;

CREATE INDEX club_playing ON club (league_id) WHERE NOT is_outside_world;
