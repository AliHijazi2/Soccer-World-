/**
 * Die App.
 *
 * Fünf Bereiche in der Reihenfolge, in der sie im Tagesablauf gebraucht werden
 * (GDD §1.1): morgens der Posteingang, tagsüber der Markt, abends Tabelle und
 * Feed. Der Kader liegt dazwischen, weil man ihn vor jedem Anstoß anfasst.
 */

import { useCallback, useEffect, useState } from "react";
import { api, getClubId, setClubId, type TableRow } from "./api.ts";
import { Feed } from "./screens/Feed.tsx";
import { Inbox } from "./screens/Inbox.tsx";
import { Market } from "./screens/Market.tsx";
import { Squad } from "./screens/Squad.tsx";
import { Standings } from "./screens/Standings.tsx";

type Tab = "inbox" | "market" | "squad" | "table" | "feed";

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: "inbox", icon: "✉️", label: "Post" },
  { id: "market", icon: "⚖️", label: "Markt" },
  { id: "squad", icon: "👥", label: "Kader" },
  { id: "table", icon: "🏆", label: "Tabelle" },
  { id: "feed", icon: "📰", label: "Feed" },
];

export function App() {
  const [leagueId, setLeagueId] = useState(
    () => new URLSearchParams(location.search).get("league")
      ?? localStorage.getItem("leagueId") ?? "");
  const [clubId, setClub] = useState(getClubId);
  const [tab, setTab] = useState<Tab>("market");
  const [table, setTable] = useState<TableRow[]>([]);
  const [league, setLeague] = useState<{ name: string; matchday: number; season: number } | null>(null);
  const [openEvents, setOpenEvents] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!leagueId) return;
    try {
      const state = await api.state(leagueId);
      setTable(state.table);
      setLeague({
        name: state.league.name,
        matchday: state.league.current_matchday,
        season: state.league.current_season,
      });
      setError(null);
      if (clubId) {
        const events = await api.events(clubId);
        setOpenEvents(events.events.filter((event) => !event.resolved).length);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Verbindung fehlgeschlagen");
    }
  }, [leagueId, clubId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!leagueId || !clubId) {
    return <Setup onReady={(league, club) => {
      localStorage.setItem("leagueId", league);
      setLeagueId(league);
      setClubId(club);
      setClub(club);
    }} />;
  }

  const own = table.find((row) => row.id === clubId);

  return (
    <div className="app">
      <header className="top">
        <h1>{own?.name ?? league?.name ?? "Soccer World"}</h1>
        <span className="meta">
          {league && `S${league.season} · ST ${league.matchday}/21`}
          {own?.availableFunds !== undefined &&
            ` · ${(own.availableFunds / 1_000_000).toFixed(0)} Mio`}
        </span>
      </header>

      <main>
        {error && <div className="card tight error">{error}</div>}
        {tab === "inbox" && <Inbox clubId={clubId} onChanged={refresh} />}
        {tab === "market" && (
          <Market leagueId={leagueId} clubId={clubId}
            availableFunds={own?.availableFunds} onChanged={refresh} />
        )}
        {tab === "squad" && (
          <Squad clubId={clubId} matchday={league?.matchday ?? 0} onChanged={refresh} />
        )}
        {tab === "table" && <Standings table={table} clubId={clubId} />}
        {tab === "feed" && <Feed leagueId={leagueId} />}
      </main>

      <nav className="tabs">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            className={tab === entry.id ? "active" : ""}
            onClick={() => setTab(entry.id)}
          >
            <span className="icon">{entry.icon}</span>
            {entry.id === "inbox" && openEvents > 0 && (
              <span className="badge">{openEvents}</span>
            )}
            {entry.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

/**
 * Einstieg ohne Anmeldung.
 *
 * Für den MVP identifiziert ein Vereins-Kennzeichen den Spieler. Eine echte
 * Anmeldung per Magic-Link kommt beim Ausbau — Passwörter sind reine Haftung.
 */
function Setup({ onReady }: { onReady: (leagueId: string, clubId: string) => void }) {
  const [league, setLeague] = useState("");
  const [club, setClub] = useState("");

  return (
    <div className="app">
      <header className="top"><h1>Soccer World</h1></header>
      <main>
        <div className="card">
          <p className="small muted" style={{ marginBottom: 12 }}>
            Liga und Verein eintragen. Beides findest du in der Einladung.
          </p>
          <div className="auction">
            <input placeholder="Liga-Kennung" value={league}
              onChange={(event) => setLeague(event.target.value.trim())} />
            <input placeholder="Vereins-Kennung" value={club}
              onChange={(event) => setClub(event.target.value.trim())} />
            <button className="bid-btn" disabled={!league || !club}
              onClick={() => onReady(league, club)}>
              Loslegen
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
