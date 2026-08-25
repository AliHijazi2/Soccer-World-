/**
 * HTTP-Server. Ein Prozess, ein Port — mehr braucht es bei acht Nutzern nicht
 * (Architektur §1).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

import { createPool, migrate, type Pool } from "../db/pool.ts";
import { registerRoutes } from "./routes.ts";

export interface ServerOptions {
  databaseUrl: string;
  logger?: boolean;
  /** Verbindungen im Pool; in Tests klein halten (siehe db/pool.ts) */
  poolMax?: number;
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

  app.addHook("onClose", async () => { await pool.end(); });
  return { app, pool };
}

// Direkter Start: node --experimental-strip-types packages/server/src/api/server.ts
if (process.argv[1]?.endsWith("server.ts")) {
  const url = process.env.DATABASE_URL ??
    "postgresql://postgres@localhost/postgres?host=/tmp&port=5433";
  const { app } = await buildServer({ databaseUrl: url, logger: true });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
}
