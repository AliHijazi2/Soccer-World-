/**
 * Job-Runner (Architektur §5).
 *
 * Kein Cron. Eine Job-Tabelle in Postgres, weil drei Dinge nötig sind, die
 * Cron nicht kann: Idempotenz beim Neustart, Nachholen verpasster Läufe und
 * Nachvollziehbarkeit, wenn jemand fragt "warum ist mein Spieltag ausgefallen".
 */

import { inTransaction, type Pool, type PoolClient } from "../db/pool.ts";

export interface Job {
  id: string;
  leagueId: string | null;
  type: string;
  payload: Record<string, unknown>;
  runAt: Date;
  idempotencyKey: string;
  attempts: number;
}

export type JobHandler = (job: Job, pool: Pool) => Promise<void>;

export const MAX_ATTEMPTS = 3;

/**
 * Legt einen Job an. Existiert der Idempotenzschlüssel bereits, passiert nichts.
 *
 * Der Schutz liegt bewusst in der Datenbank (Unique-Constraint) und nicht in
 * einer Prüfung im Code: Nur so hält er auch dann, wenn zwei Prozesse
 * gleichzeitig denselben Job einplanen wollen.
 */
export async function enqueue(
  pool: Pool | PoolClient,
  input: { leagueId?: string | null; type: string; payload?: Record<string, unknown>;
           runAt: Date; idempotencyKey: string },
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO job (league_id, type, payload, run_at, idempotency_key)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [input.leagueId ?? null, input.type, input.payload ?? {}, input.runAt, input.idempotencyKey],
  );
  return (rowCount ?? 0) > 0;
}

interface JobRow {
  id: string; league_id: string | null; type: string;
  payload: Record<string, unknown>; run_at: Date;
  idempotency_key: string; attempts: number;
}

/**
 * Holt fällige Jobs und markiert sie als laufend.
 *
 * `FOR UPDATE SKIP LOCKED` ist der Grund, warum diese schlichte Lösung trägt:
 * Sie bleibt korrekt, wenn später ein zweiter Prozess dazukommt — jeder Job
 * wird garantiert nur von einem Worker gegriffen.
 */
async function claim(pool: Pool, limit: number, now: Date): Promise<Job[]> {
  return inTransaction(pool, async (client) => {
    const { rows } = await client.query<JobRow>(
      `SELECT id, league_id, type, payload, run_at, idempotency_key, attempts
         FROM job
        WHERE status = 'pending' AND run_at <= $1
        ORDER BY run_at, created_at
        LIMIT $2
        FOR UPDATE SKIP LOCKED`,
      [now, limit],
    );
    if (rows.length === 0) return [];
    await client.query(
      `UPDATE job SET status = 'running', locked_at = $2, attempts = attempts + 1
        WHERE id = ANY($1)`,
      [rows.map((row) => row.id), now],
    );
    return rows.map((row) => ({
      id: row.id, leagueId: row.league_id, type: row.type,
      payload: row.payload, runAt: row.run_at,
      idempotencyKey: row.idempotency_key, attempts: row.attempts + 1,
    }));
  });
}

export interface TickResult {
  processed: number;
  failed: number;
  errors: { type: string; message: string }[];
}

/** Arbeitet alle aktuell fälligen Jobs einmal ab. */
export async function tick(
  pool: Pool,
  handlers: Record<string, JobHandler>,
  now = new Date(),
  limit = 25,
): Promise<TickResult> {
  const jobs = await claim(pool, limit, now);
  const result: TickResult = { processed: 0, failed: 0, errors: [] };

  for (const job of jobs) {
    const handler = handlers[job.type];
    if (!handler) {
      await fail(pool, job, `Kein Handler für Jobtyp "${job.type}"`);
      result.failed++;
      result.errors.push({ type: job.type, message: "kein Handler" });
      continue;
    }
    try {
      await handler(job, pool);
      await pool.query(
        "UPDATE job SET status = 'done', finished_at = now() WHERE id = $1", [job.id]);
      result.processed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await fail(pool, job, message);
      result.failed++;
      result.errors.push({ type: job.type, message });
    }
  }
  return result;
}

/**
 * Ein fehlgeschlagener Job wird dreimal versucht, danach dauerhaft als
 * gescheitert markiert. Ein Spieltag darf niemals still ausfallen.
 */
async function fail(pool: Pool, job: Job, message: string): Promise<void> {
  const giveUp = job.attempts >= MAX_ATTEMPTS;
  await pool.query(
    `UPDATE job
        SET status = $2, last_error = $3, locked_at = NULL,
            run_at = CASE WHEN $2 = 'pending' THEN now() + interval '30 seconds' ELSE run_at END,
            finished_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END
      WHERE id = $1`,
    [job.id, giveUp ? "failed" : "pending", message.slice(0, 2000)],
  );
}

/** Arbeitet so lange, bis keine fälligen Jobs mehr da sind. Für Tests und Nachholläufe. */
export async function drain(
  pool: Pool, handlers: Record<string, JobHandler>, now = new Date(), maxRounds = 500,
): Promise<TickResult> {
  const total: TickResult = { processed: 0, failed: 0, errors: [] };
  for (let round = 0; round < maxRounds; round++) {
    const result = await tick(pool, handlers, now);
    total.processed += result.processed;
    total.failed += result.failed;
    total.errors.push(...result.errors);
    if (result.processed === 0 && result.failed === 0) break;
  }
  return total;
}
