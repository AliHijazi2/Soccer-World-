/**
 * Der Markt — der Kern des Spiels (GDD §5, §6).
 *
 * Drei Dinge müssen hier stimmen, sonst funktioniert nichts anderes:
 * die Restzeit ist jederzeit sichtbar, man sieht **wer** führt (Schadenfreude
 * braucht einen Adressaten, GDD F14), und ein Überbieten ist ein Handgriff.
 */

import { useEffect, useState } from "react";
import {
  api, money, timeLeft, type PublicAuction, type PublicPlayer,
} from "../api.ts";

interface Props {
  leagueId: string;
  clubId: string;
  availableFunds?: number;
  onChanged: () => void;
}

export function Market({ leagueId, clubId, availableFunds, onChanged }: Props) {
  const [auctions, setAuctions] = useState<PublicAuction[]>([]);
  const [players, setPlayers] = useState<Map<string, PublicPlayer>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());

  const load = async () => {
    try {
      const data = await api.market(leagueId);
      setAuctions(data.auctions);
      setPlayers(new Map(data.players.map((player) => [player.id, player])));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Fehler");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [leagueId]);

  // Die Restzeit muss laufen, ohne dass ständig neu geladen wird
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(tick);
  }, []);

  const bid = async (auction: PublicAuction) => {
    const raw = drafts[auction.id];
    const amount = Math.round(Number(raw) * 1_000_000);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Bitte einen Betrag in Millionen eingeben");
      return;
    }
    try {
      await api.bid(auction.id, amount);
      setDrafts((current) => ({ ...current, [auction.id]: "" }));
      setError(null);
      await load();
      onChanged();
    } catch (cause) {
      setError(explain(cause instanceof Error ? cause.message : "Fehler"));
    }
  };

  if (loading) return <div className="notice">Markt wird geladen …</div>;

  return (
    <>
      <div className="row between">
        <h2 className="section">Auktionen</h2>
        {availableFunds !== undefined && (
          <span className="small muted mono">
            verfügbar {money(availableFunds)}
          </span>
        )}
      </div>

      {error && <div className="card tight error">{error}</div>}

      {auctions.length === 0 && (
        <div className="notice">
          Gerade läuft keine Auktion.<br />
          <span className="tiny">Neue Spieler kommen morgens auf den Markt.</span>
        </div>
      )}

      {auctions.map((auction) => {
        const player = players.get(auction.playerId);
        const outbid = auction.yourMaximum != null && !auction.leaderIsYou;
        const minimum = auction.currentBid ?? auction.minPrice;

        return (
          <div key={auction.id} className={`card auction${outbid ? " outbid" : ""}`}>
            <div className="head">
              <span className="name">{player?.name ?? "Unbekannt"}</span>
              <span className="pill">{player?.position}</span>
              <span className="small muted">{player?.overall} OVR · {player?.age} J.</span>
              <span className="spacer" />
              <span className="tiny muted mono">{timeLeft(auction.closesAt, now)}</span>
            </div>

            {player && (
              <div className="attrs">
                <span>Wert <b>{money(player.marketValue)}</b></span>
                <span>Potenzial <b>{player.potential.min}–{player.potential.max}</b>
                  {" "}({confidenceLabel(player.potential.confidence)})</span>
                {player.traits.length > 0 && <span><b>{player.traits.join(", ")}</b></span>}
              </div>
            )}

            <div className="row small">
              {auction.currentBid == null ? (
                <span className="muted">Noch kein Gebot · Mindestpreis {money(auction.minPrice)}</span>
              ) : (
                <>
                  <span className="mono strong">{money(auction.currentBid)}</span>
                  {auction.leaderIsYou
                    ? <span className="pill you">du führst</span>
                    : <span className="pill">{auction.leaderName}</span>}
                  {outbid && <span className="pill hot">überboten</span>}
                </>
              )}
            </div>

            {auction.yourMaximum != null && (
              <div className="tiny muted">
                Dein Maximum: {money(auction.yourMaximum)} — so viel ist gebunden
              </div>
            )}

            <div className="bid-row">
              <input
                inputMode="decimal"
                placeholder={`mind. ${(minimum / 1_000_000).toFixed(1)} Mio`}
                value={drafts[auction.id] ?? ""}
                onChange={(event) => setDrafts((current) =>
                  ({ ...current, [auction.id]: event.target.value }))}
              />
              <button
                className="bid-btn"
                disabled={auction.leaderIsYou}
                onClick={() => void bid(auction)}
              >
                {auction.leaderIsYou ? "führt" : "Bieten"}
              </button>
            </div>
          </div>
        );
      })}

      <p className="tiny muted">
        Ein Gebot bindet dein Geld sofort, und zwar in Höhe deines Maximums.
        Wirst du überboten, wird es freigegeben.
      </p>
    </>
  );
}

function confidenceLabel(confidence: "low" | "medium" | "high"): string {
  return { low: "unsicher", medium: "mittel", high: "sicher" }[confidence];
}

/** Fehlercodes der Schnittstelle in Sätze übersetzen, die weiterhelfen. */
function explain(code: string): string {
  const messages: Record<string, string> = {
    below_minimum: "Zu wenig — der Mindestschritt ist nicht erreicht.",
    below_min_price: "Unter dem Mindestpreis des Verkäufers.",
    insufficient_funds: "Nicht gedeckt. Andere Gebote binden dein Geld.",
    auction_closed: "Diese Auktion ist beendet.",
    already_leading: "Du führst bereits.",
    own_player: "Das ist dein eigener Spieler.",
  };
  return messages[code] ?? code;
}
