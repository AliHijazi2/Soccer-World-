/**
 * Posteingang mit den Ereignissen (GDD §10).
 *
 * Jede Option nennt ihre Konsequenz, nicht nur die Handlung. "Zustimmen" ist
 * keine Entscheidung — "Zustimmen: die anderen wollen jetzt auch" schon.
 */

import { useEffect, useState } from "react";
import { api, type ClubEvent } from "../api.ts";

interface Props { clubId: string; onChanged: () => void }

/** Die Kategorien kommen als Schlüssel aus der Schnittstelle. */
const CATEGORIES: Record<string, string> = {
  squad: "Kader", economy: "Wirtschaft", fans: "Fans",
  stadium: "Stadion", market: "Markt", tabloid: "Boulevard",
};

export function Inbox({ clubId, onChanged }: Props) {
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      setEvents((await api.events(clubId)).events);
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [clubId]);

  const choose = async (event: ClubEvent, option: number) => {
    setBusy(event.id);
    try {
      await api.resolveEvent(event.id, option);
      await load();
      onChanged();
    } finally { setBusy(null); }
  };

  if (loading) return <div className="notice">Wird geladen …</div>;

  const open = events.filter((event) => !event.resolved);
  const done = events.filter((event) => event.resolved);

  return (
    <>
      {open.length > 0 && <h2 className="section">Offen · {open.length}</h2>}
      {open.length === 0 && done.length === 0 && (
        <div className="notice">Nichts Neues. Genieß die Ruhe.</div>
      )}

      {[...open, ...done].map((event) => (
        <div key={event.id} className="card event">
          <div className="row">
            <span className="pill">{CATEGORIES[event.category] ?? event.category}</span>
            <span className="tiny muted">Spieltag {event.matchday}</span>
            {event.resolved && <span className="pill">erledigt</span>}
          </div>
          <div className="title" style={{ marginTop: 6 }}>{event.title}</div>
          <div className="body">{event.body}</div>

          {event.options.length === 0
            ? <div className="tiny muted">Keine Entscheidung nötig.</div>
            : event.options.map((option) => (
              <button
                key={option.index}
                className={`option${event.chosenOption === option.index ? " chosen" : ""}`}
                disabled={event.resolved || busy === event.id}
                onClick={() => void choose(event, option.index)}
              >
                {event.chosenOption === option.index && "▸ "}{option.text}
              </button>
            ))}
        </div>
      ))}
    </>
  );
}
