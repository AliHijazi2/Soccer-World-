import { createPool, migrate, type Pool } from "../src/db/pool.ts";

const BASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres@localhost/postgres?host=/tmp&port=5433";

function urlFor(database: string): string {
  const url = new URL(BASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * Jede Testdatei bekommt eine eigene Datenbank.
 *
 * `node --test` startet pro Datei einen eigenen Prozess und lässt sie parallel
 * laufen. Teilen sich zwei Dateien eine Datenbank, leert die eine der anderen
 * mitten im Lauf die Tabellen — die Tests werden dann sporadisch rot, ohne dass
 * am Code etwas falsch wäre.
 */
export async function freshPool(database: string): Promise<Pool> {
  const admin = createPool(BASE_URL);
  try {
    await admin.query(`CREATE DATABASE ${database}`);
  } catch (error) {
    // 42P04 = existiert bereits; alles andere ist ein echter Fehler
    if ((error as { code?: string }).code !== "42P04") throw error;
  } finally {
    await admin.end();
  }

  const pool = createPool(urlFor(database));
  await migrate(pool);
  await pool.query(`
    TRUNCATE transfer, ledger_entry, escrow_hold, bid, auction,
             player_instance, player_template, club, league, app_user CASCADE`);
  return pool;
}

export interface Fixture {
  leagueId: string;
  clubs: { id: string; name: string }[];
  auctions: { id: string; playerId: string }[];
}

export async function seed(
  pool: Pool, clubCount: number, auctionCount: number, cashPerClub: number,
): Promise<Fixture> {
  const league = await pool.query<{ id: string }>(
    `INSERT INTO league (name, invite_code) VALUES ('Test', $1) RETURNING id`,
    [`code-${Math.random().toString(36).slice(2, 10)}`],
  );
  const leagueId = league.rows[0]!.id;

  const clubs: Fixture["clubs"] = [];
  for (let i = 0; i < clubCount; i++) {
    const user = await pool.query<{ id: string }>(
      `INSERT INTO app_user (email, display_name) VALUES ($1, $2) RETURNING id`,
      [`u${i}-${Math.random().toString(36).slice(2, 8)}@test.local`, `Spieler ${i}`],
    );
    const club = await pool.query<{ id: string }>(
      `INSERT INTO club (league_id, user_id, name, short_name, cash)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [leagueId, user.rows[0]!.id, `Club ${i}`, `C${i}`, cashPerClub],
    );
    clubs.push({ id: club.rows[0]!.id, name: `Club ${i}` });
  }

  const auctions: Fixture["auctions"] = [];
  for (let i = 0; i < auctionCount; i++) {
    const template = await pool.query<{ id: string }>(
      `INSERT INTO player_template
         (external_key, full_name, birth_year, primary_position, tier,
          attributes, potential_min, potential_max, base_value, base_wage)
       VALUES ($1, $2, 1999, 'ST', 'very_good', '{}', 78, 84, 40000000, 160000)
       RETURNING id`,
      [`p${i}-${Math.random().toString(36).slice(2, 8)}`, `Spieler ${i}`],
    );
    const instance = await pool.query<{ id: string }>(
      `INSERT INTO player_instance
         (league_id, template_id, overall, true_potential, market_value, wage_per_matchday)
       VALUES ($1, $2, 80, 83, 40000000, 160000) RETURNING id`,
      [leagueId, template.rows[0]!.id],
    );
    const closesAt = new Date(Date.now() + 3600_000);
    const auction = await pool.query<{ id: string }>(
      `INSERT INTO auction
         (league_id, player_instance_id, min_price, closes_at, original_closes_at)
       VALUES ($1, $2, 1000000, $3, $3) RETURNING id`,
      [leagueId, instance.rows[0]!.id, closesAt],
    );
    auctions.push({ id: auction.rows[0]!.id, playerId: instance.rows[0]!.id });
  }

  return { leagueId, clubs, auctions };
}

export interface Violation { rule: string; detail: string }

/** Prüft die Invarianten aus docs/DATA_MODEL.md §13. */
export async function checkInvariants(pool: Pool): Promise<Violation[]> {
  const violations: Violation[] = [];

  const cash = await pool.query<{ id: string; cash: number; booked: number }>(
    `SELECT c.id, c.cash, COALESCE(SUM(l.amount), 0) AS booked
       FROM club c LEFT JOIN ledger_entry l ON l.club_id = c.id
      GROUP BY c.id, c.cash`);
  for (const row of cash.rows) {
    // Startkapital wird nicht gebucht, deshalb nur die Veränderung vergleichen
    if (row.booked !== 0 && row.cash - row.booked < 0) {
      violations.push({ rule: "1 cash = Σ ledger", detail: `${row.id}: cash ${row.cash}, gebucht ${row.booked}` });
    }
  }

  const holds = await pool.query<{ auction_id: string; count: number }>(
    `SELECT auction_id, COUNT(*)::int AS count FROM escrow_hold
      WHERE released_at IS NULL GROUP BY auction_id HAVING COUNT(*) > 1`);
  for (const row of holds.rows) {
    violations.push({ rule: "2 eine offene Sperre je Auktion", detail: `${row.auction_id}: ${row.count}` });
  }

  const over = await pool.query<{ id: string; cash: number; held: number }>(
    `SELECT c.id, c.cash, COALESCE(SUM(e.amount), 0) AS held
       FROM club c LEFT JOIN escrow_hold e ON e.club_id = c.id AND e.released_at IS NULL
      GROUP BY c.id, c.cash HAVING COALESCE(SUM(e.amount), 0) > c.cash`);
  for (const row of over.rows) {
    violations.push({ rule: "3 Σ Sperren ≤ Kassenbestand", detail: `${row.id}: gebunden ${row.held}, Kasse ${row.cash}` });
  }

  const doubleOpen = await pool.query<{ player_instance_id: string }>(
    `SELECT player_instance_id FROM auction
      WHERE status IN ('open','awaiting_seller')
      GROUP BY player_instance_id HAVING COUNT(*) > 1`);
  for (const row of doubleOpen.rows) {
    violations.push({ rule: "4 ein Spieler je offener Auktion", detail: row.player_instance_id });
  }

  const leaderMismatch = await pool.query<{ id: string }>(
    `SELECT a.id FROM auction a
       JOIN escrow_hold e ON e.auction_id = a.id AND e.released_at IS NULL
      WHERE a.current_bidder_club_id IS DISTINCT FROM e.club_id`);
  for (const row of leaderMismatch.rows) {
    violations.push({ rule: "5 Sperre gehört dem Höchstbieter", detail: row.id });
  }

  return violations;
}
