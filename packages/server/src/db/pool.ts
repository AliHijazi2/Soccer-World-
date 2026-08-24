import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

// bigint kommt sonst als Zeichenkette zurück. Geldbeträge liegen weit unter
// 2^53, damit ist Number hier sicher und spart Umrechnungen im ganzen Code.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export function createPool(connectionString: string): Pool {
  return new pg.Pool({ connectionString, max: 20 });
}

const MIGRATION_DIR = "packages/server/src/db/migrations";

export async function migrate(pool: Pool): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  const applied = new Set(
    (await pool.query<{ name: string }>("SELECT name FROM schema_migration")).rows
      .map((row) => row.name),
  );
  const files = readdirSync(MIGRATION_DIR).filter((f) => f.endsWith(".sql")).sort();
  const run: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATION_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migration (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      run.push(file);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return run;
}

/** Führt eine Funktion in einer Transaktion aus und räumt zuverlässig auf. */
export async function inTransaction<T>(
  pool: Pool, fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
