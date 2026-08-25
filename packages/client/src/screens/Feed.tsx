/**
 * Der Boulevard-Feed (GDD §16.1).
 *
 * Der Grund, warum jemand morgens die App öffnet: Man will sehen, was den
 * anderen passiert ist.
 */

import { useEffect, useState } from "react";
import { api, type FeedItem } from "../api.ts";

export function Feed({ leagueId }: { leagueId: string }) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api.feed(leagueId, 60)
      .then((data) => setItems(data.items))
      .finally(() => setLoading(false));
  }, [leagueId]);

  if (loading) return <div className="notice">Wird geladen …</div>;
  if (items.length === 0) {
    return <div className="notice">Noch nichts passiert. Wartet den ersten Spieltag ab.</div>;
  }

  return (
    <div className="card">
      {items.map((item) => (
        <div key={item.id} className="feed-item">
          <span className="mark">
            {item.importance >= 3 ? "🔥" : item.importance === 2 ? "⚡" : "·"}
          </span>
          <span className="when">ST {item.matchday}</span>
          <span className={item.importance >= 3 ? "strong" : ""}>{item.text}</span>
        </div>
      ))}
    </div>
  );
}
