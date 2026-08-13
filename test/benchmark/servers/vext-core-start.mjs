/**
 * Benchmark-only Vext Native Core launcher.
 *
 * This intentionally bypasses bootstrap and route loading. It measures the
 * shortest supported adapter path (Vext request/response + Native adapter + a
 * directly registered handler) while keeping the test-only mode out of public
 * Vext configuration.
 */

import crypto from "node:crypto";

import { DEFAULT_CONFIG, createApp } from "../../../dist/lib/app.js";
import { resolveAdapter } from "../../../dist/lib/adapter-resolver.js";

const port = Number.parseInt(process.env.PORT || "3000", 10);
const host = "127.0.0.1";

const config = {
  ...DEFAULT_CONFIG,
  adapter: "native",
  port,
  host,
  logger: { ...DEFAULT_CONFIG.logger, level: "silent" },
  middlewares: [],
  cors: { ...DEFAULT_CONFIG.cors, enabled: false },
  rateLimit: { ...DEFAULT_CONFIG.rateLimit, enabled: false },
  requestId: { ...DEFAULT_CONFIG.requestId, enabled: false },
  response: { ...DEFAULT_CONFIG.response, wrap: false },
  bodyParser: { ...DEFAULT_CONFIG.bodyParser, enabled: false },
  accessLog: { ...DEFAULT_CONFIG.accessLog, enabled: false },
  requestContext: { ...DEFAULT_CONFIG.requestContext, enabled: false },
  frontend: { ...DEFAULT_CONFIG.frontend, enabled: false },
  session: { ...DEFAULT_CONFIG.session, enabled: false },
  csrf: { ...DEFAULT_CONFIG.csrf, enabled: false },
  securityHeaders: { ...DEFAULT_CONFIG.securityHeaders, enabled: false },
};

const { app, internals } = createApp(config);
app.adapter = await resolveAdapter(config, app);

const routeChainLengths = {};

function registerCoreRoute(path, handler) {
  const chain = [handler];
  if (chain.length !== 1) {
    throw new Error(`Vext Native Core route ${path} did not have one handler`);
  }
  routeChainLengths[`GET ${path}`] = chain.length;
  app.adapter.registerRoute("GET", path, chain);
}

registerCoreRoute("/json", async (_req, res) => {
  res.json({ message: "Hello World" });
});

registerCoreRoute("/users/:id", async (req, res) => {
  const id = req.params.id;
  res.json({ id, name: `User ${id}` });
});

registerCoreRoute("/chain", async (req, res) => {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  req.headers.authorization;
  res.setHeader("X-Response-Time", `${Date.now() - startedAt}ms`);
  res.setHeader("X-Bench-Request-Id", requestId);
  res.json({ message: "Chain complete", requestId, authenticated: true });
});

registerCoreRoute("/health", async (_req, res) => {
  res.json({ status: "ok" });
});

const serverHandle = await app.adapter.listen(port, host);

if (process.send) {
  process.send({
    type: "ready",
    port: serverHandle.port,
    telemetry: {
      mode: "core",
      globalMiddlewareCount: 0,
      routeChainLengths,
    },
  });
}

async function shutdown() {
  try {
    await serverHandle.close();
    await internals.shutdown(undefined, { skipExit: true });
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("disconnect", shutdown);
