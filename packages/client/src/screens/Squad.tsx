/**
 * Der eigene Kader.
 *
 * Fitness steht bewusst ganz vorn: Bei 21 Spieltagen in sieben Tagen ist sie
 * die härteste Grenze im Spiel (GDD §7.3), und wer sie nicht sieht, rotiert
 * nicht.
 */

import { useEffect, useState } from "react";
import { api, healthTone, money, type PublicPlayer } from "../api.ts";

interface Props { clubId: string; matchday: number; onChanged: () => void }

export function Squad({ clubId, matchday, onChanged }: Props) {
  const [players, setPlayers] = useState<PublicPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setPlayers((await api.squad(clubId)).players);
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [clubId]);

  const sell = async (player: PublicPlayer) => {
    setBusy(player.id);
    try {
      await api.list(player.id, Math.round(player.marketValue * 0.6));
      setError(null);
      onChanged();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "Fehler";
      setError(code === "squad_too_small"
        ? "Zu wenig Spieler — unter 14 kannst du keinen Spieltag bestreiten."
        : code === "already_listed" ? "Steht schon in einer Auktion." : code);
    } finally { setBusy(null); }
  };

  if (loading) return <div className="notice">Kader wird geladen …</div>;

  const tired = players.filter((player) => player.fitness < 70).length;
  const out = players.filter(
    (player) => player.injuredUntil !== null && player.injuredUntil >= matchday).length;

  return (
    <>
      <div className="row between">
        <h2 className="section">Kader · {players.length} Spieler</h2>
        <span className="small muted">
          {tired > 0 && <span className={tired > players.length * 0.5 ? "bad" : "warn"}>
            {tired} müde</span>}
          {tired > 0 && out > 0 && " · "}
          {out > 0 && <span className="bad">{out} raus</span>}
        </span>
      </div>

      {error && <div className="card tight error">{error}</div>}

      {players.map((player) => {
        const injured = player.injuredUntil !== null && player.injuredUntil >= matchday;
        return (
          <div key={player.id} className="card tight">
            <div className="row">
              <span className="pill">{player.position}</span>
              <span className="strong">{player.name}</span>
              <span className="small muted">{player.overall}</span>
              <span className="spacer" />
              <span className="small muted mono">{money(player.marketValue)}</span>
              {/* Der Verkaufsknopf gehört zum Marktwert, nicht zu den Zustandswerten */}
              <button
                className="pill"
                disabled={busy === player.id}
                onClick={() => void sell(player)}
              >
                {busy === player.id ? "…" : "verkaufen"}
              </button>
            </div>

            <div className="row tiny muted" style={{ marginTop: 6 }}>
              <span>{player.age} J.</span>
              <span className={healthTone(player.fitness)}>
                Fitness {Math.round(player.fitness)}
              </span>
              {player.morale !== undefined && (
                <span className={healthTone(player.morale)}>
                  Moral {Math.round(player.morale)}
                </span>
              )}
              {player.wage !== undefined && <span>{money(player.wage)}/Spieltag</span>}
              {injured && <span className="bad">verletzt bis ST {player.injuredUntil}</span>}
              {player.suspended > 0 && <span className="bad">{player.suspended} gesperrt</span>}
            </div>

            <div className="bar" style={{ marginTop: 6 }}>
              <i
                className={healthTone(player.fitness) === "good" ? "" : healthTone(player.fitness)}
                style={{ width: `${player.fitness}%` }}
              />
            </div>
          </div>
        );
      })}
    </>
  );
}
