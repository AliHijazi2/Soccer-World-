-- Ereignisse mit Entscheidungen (GDD §10).

CREATE TABLE club_event (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id      uuid NOT NULL REFERENCES league(id) ON DELETE CASCADE,
  club_id        uuid NOT NULL REFERENCES club(id) ON DELETE CASCADE,
  season         smallint NOT NULL,
  matchday       smallint NOT NULL,
  template_key   text NOT NULL,
  category       text NOT NULL
                 CHECK (category IN ('squad','economy','fans','stadium','market','tabloid')),
  -- Aufgelöste Variablen: Spielername, Beträge, Ausfalldauer
  payload        jsonb NOT NULL DEFAULT '{}',
  subject_player_id uuid REFERENCES player_instance(id) ON DELETE SET NULL,
  -- Die angebotenen Optionen; leer bedeutet reine Meldung
  options        jsonb NOT NULL DEFAULT '[]',
  default_option smallint NOT NULL DEFAULT 0,
  chosen_option  smallint,
  expires_at     timestamptz NOT NULL,
  resolved_at    timestamptz,
  -- Ereignisse, die bei zwei Vereinen gleichzeitig landen (GDD §10.6)
  linked_event_id uuid REFERENCES club_event(id) ON DELETE SET NULL
);
CREATE INDEX club_event_open ON club_event (club_id) WHERE resolved_at IS NULL;
CREATE INDEX club_event_history ON club_event (club_id, template_key, matchday DESC);
