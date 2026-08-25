/**
 * Tabelle und Erwartungsbilanz.
 *
 * Die Erwartung steht bewusst neben den Punkten: Sie ist der Maßstab, an dem
 * die Fans messen (GDD §11.2), und ohne sie liest man die Tabelle falsch.
 */

import { money, number, type TableRow } from "../api.ts";

const GOALS: Record<string, string> = {
  title: "Meister werden",
  top_half: "obere Hälfte",
  mid_table: "Mittelfeld",
  avoid_last: "nicht Letzter",
};

export function Standings({ table, clubId }: { table: TableRow[]; clubId: string }) {
  return (
    <>
      <h2 className="section">Tabelle</h2>
      <div className="card">
        <table className="standings">
          <thead>
            <tr>
              <th>#</th><th>Verein</th><th>Sp</th><th>S</th><th>U</th><th>N</th>
              <th>Tore</th><th>Pkt</th>
            </tr>
          </thead>
          <tbody>
            {table.map((row, index) => (
              <tr key={row.id} className={row.id === clubId ? "you" : ""}>
                <td className="mono">{index + 1}</td>
                <td>{row.name}{row.isBot && <span className="pill" style={{ marginLeft: 6 }}>Bot</span>}</td>
                <td className="mono">{row.played}</td>
                <td className="mono">{row.won}</td>
                <td className="mono">{row.drawn}</td>
                <td className="mono">{row.lost}</td>
                <td className="mono">{row.goalsFor}:{row.goalsAgainst}</td>
                <td className="mono strong">{row.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section">Erwartung und Stimmung</h2>
      {table.map((row) => {
        const actual = row.played > 0 ? row.points / row.played : 0;
        const delta = actual - row.expectedPointsPerGame;
        return (
          <div key={row.id} className="card tight">
            <div className="row">
              <span className="strong">{row.name}</span>
              <span className="pill">{GOALS[row.seasonGoal] ?? row.seasonGoal}</span>
              <span className="spacer" />
              <span className={`small mono ${delta >= 0 ? "good" : "bad"}`}>
                {delta >= 0 ? "+" : ""}{delta.toFixed(2)}
              </span>
            </div>
            <div className="row tiny muted" style={{ marginTop: 4 }}>
              <span>erwartet {row.expectedPointsPerGame.toFixed(2)}</span>
              <span>geholt {actual.toFixed(2)}</span>
              <span>Stimmung {Math.round(row.fanMood)}</span>
              <span>{number(row.fanCount)} Fans</span>
              {row.cash !== undefined && <span className="good">Kasse {money(row.cash)}</span>}
            </div>
          </div>
        );
      })}
    </>
  );
}
