/**
 * HTTP-Server. Ein Prozess, ein Port — mehr braucht es bei acht Nutzern nicht
 * (Architektur §1).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

import { createPool, migrate, type Pool } from "../db/pool.ts";
import { handlers } from "../domain/season.ts";
import { tick } from "../scheduler/runner.ts";
import { registerRoutes } from "./routes.ts";

export interface ServerOptions {
  databaseUrl: string;
  logger?: boolean;
  /** Verbindungen im Pool; in Tests klein halten (siehe db/pool.ts) */
  poolMax?: number;
  /**
   * Arbeitet fällige Jobs im Hintergrund ab. Ohne das stößt kein Spieltag an
   * und keine Auktion schließt — die Liga steht still. Tests schalten es ab
   * und rufen tick()/drain() selbst mit gesetzter Zeit auf.
   */
  scheduler?: boolean;
  /** Abstand zwischen zwei Durchläufen in Millisekunden. */
  schedulerIntervalMs?: number;
}

export async function buildServer(
  options: ServerOptions,
): Promise<{ app: FastifyInstance; pool: Pool }> {
  const pool = createPool(options.databaseUrl, options.poolMax);
  await migrate(pool);

  const app = Fastify({ logger: options.logger ?? false });
  registerRoutes(app, pool);

  // Der gebaute Client kommt vom selben Server (Architektur §12): ein Prozess,
  // ein Port, keine getrennte Auslieferung.
  const clientDir = resolve("dist/client");
  if (existsSync(clientDir)) {
    await app.register(fastifyStatic, { root: clientDir });
    // Alles, was keine Schnittstelle ist, liefert die App aus
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api")) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.sendFile("index.html");
    });
  }

  if (options.scheduler) {
    startScheduler(app, pool, options.schedulerIntervalMs ?? 15_000);
  }

  app.addHook("onClose", async () => { await pool.end(); });
  return { app, pool };
}

/**
 * Ein Intervall reicht: Jobs planen ihre Nachfolger selbst, wir müssen nur
 * regelmäßig nachsehen, was fällig ist. Läuft ein Durchlauf noch, wird der
 * nächste übersprungen — sonst greifen zwei Läufe nach denselben Jobs.
 * Ein Fehler darf die Schleife nie beenden: ein einzelner kaputter Job
 * würde sonst die ganze Saison anhalten.
 */
function startScheduler(app: FastifyInstance, pool: Pool, intervalMs: number): void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    tick(pool, handlers)
      .then((result) => {
        if (result.processed > 0 || result.failed > 0) {
          app.log.info({ ...result }, "Jobs abgearbeitet");
        }
      })
      .catch((error) => app.log.error({ error }, "Scheduler-Durchlauf fehlgeschlagen"))
      .finally(() => { running = false; });
  }, intervalMs);
  timer.unref();
  app.addHook("onClose", async () => { clearInterval(timer); });
}

// Direkter Start: node --experimental-strip-types packages/server/src/api/server.ts
if (process.argv[1]?.endsWith("server.ts")) {
  const url = process.env.DATABASE_URL ??
    "postgresql://postgres@localhost/postgres?host=/tmp&port=5433";
  const { app } = await buildServer({ databaseUrl: url, logger: true, scheduler: true });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
}
