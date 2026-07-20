import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestApp } from "../../src/testing/index.js";
import { createMemorySessionStore } from "../../src/lib/session.js";

const ROUTE_MODULE = `
const routes = [];
const collector = {
  get(path, optionsOrHandler, handler) {
    routes.push({
      method: "GET",
      path,
      options: typeof optionsOrHandler === "function" ? {} : optionsOrHandler || {},
      handler: typeof optionsOrHandler === "function" ? optionsOrHandler : handler,
    });
  },
};

function factory() {
  collector.get("/login", {}, async (req, res) => {
    req.session.userId = "u1";
    res.text("logged-in");
  });
  collector.get("/redirect-login", {}, async (req, res) => {
    req.session.userId = "u2";
    res.redirect("/runtime/me", 307);
  });
  collector.get("/me", {}, async (req, res) => {
    res.json({ userId: req.session?.userId ?? null });
  });
  collector.get("/public", { session: false }, async (req, res) => {
    res.json({ hasSession: Boolean(req.session) });
  });
  collector.get("/route-session", { session: true }, async (req, res) => {
    req.session.userId = "route-user";
    res.json({ id: req.session.id });
  });
  collector.get("/route-cors", {
    override: { cors: { enabled: true, origins: ["https://route.example"] } },
  }, async (_req, res) => {
    res.json({ ok: true });
  });
  collector.get("/slow", { override: { timeout: 5, rateLimit: false } }, async (_req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    res.json({ late: true });
  });
  collector.get("/limited", {}, async (_req, res) => {
    res.json({ ok: true });
  });
}

function normalizePath(prefix, subPath) {
  const cleanPrefix = prefix.endsWith("/") && prefix.length > 1 ? prefix.slice(0, -1) : prefix;
  const cleanSubPath = subPath.startsWith("/") ? subPath.slice(1) : subPath;
  if (!cleanSubPath) return cleanPrefix || "/";
  if (cleanPrefix === "/") return "/" + cleanSubPath;
  return cleanPrefix + "/" + cleanSubPath;
}

export default {
  routes,
  sourceFile: "",
  register(adapter, prefix) {
    for (const route of routes) {
      adapter.registerRoute(route.method, normalizePath(prefix, route.path), [
        async (req, res, _next) => route.handler(req, res),
      ], route.options);
    }
  },
  _factory: factory,
  _collector: collector,
};
`;

async function createFixture() {
  const rootDir = await mkdtemp(join(tmpdir(), "vext-testing-runtime-"));
  const routesDir = join(rootDir, "src", "routes");
  await mkdir(routesDir, { recursive: true });
  await writeFile(join(routesDir, "runtime.ts"), ROUTE_MODULE, "utf-8");
  return rootDir;
}

describe("createTestApp runtime contract parity", () => {
  it("auto-registers one shared Session runtime with route opt-out", async () => {
    const rootDir = await createFixture();
    const store = createMemorySessionStore();
    const close = vi.fn();
    store.close = close;
    const t = await createTestApp({
      services: false,
      rootDir,
      config: { session: { enabled: true, store } },
    });

    try {
      const login = await t.request.get("/runtime/login");
      const cookie = login.cookies[0]?.split(";")[0];
      expect(login.status).toBe(200);
      expect(login.text).toBe("logged-in");
      expect(cookie).toMatch(/^vext\.sid=/);

      const redirect = await t.request.get("/runtime/redirect-login");
      expect(redirect.status).toBe(307);
      expect(redirect.header("location")).toBe("/runtime/me");
      expect(redirect.cookies[0]).toContain("vext.sid=");

      const me = await t.request.get("/runtime/me").set("cookie", cookie!);
      expect(me.body.data).toEqual({ userId: "u1" });

      const publicRoute = await t.request.get("/runtime/public");
      expect(publicRoute.body.data).toEqual({ hasSession: false });
    } finally {
      await t.close();
      await t.close();
      expect(close).toHaveBeenCalledOnce();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("supports route-only Session and CORS while globals are disabled", async () => {
    const rootDir = await createFixture();
    const t = await createTestApp({
      services: false,
      rootDir,
      config: {
        session: { enabled: false },
        cors: { enabled: false },
      },
    });

    try {
      const session = await t.request.get("/runtime/route-session");
      expect(session.status).toBe(200);
      expect(session.cookies[0]).toContain("vext.sid=");

      const cors = await t.request
        .get("/runtime/route-cors")
        .set("origin", "https://route.example");
      expect(cors.header("access-control-allow-origin")).toBe(
        "https://route.example",
      );
    } finally {
      await t.close();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("enforces route timeout and explicitly enabled test rate limiting", async () => {
    const rootDir = await createFixture();
    const t = await createTestApp({
      services: false,
      rootDir,
      config: {
        rateLimit: {
          enabled: true,
          max: 1,
          window: 60,
          message: "limited",
          keyBy: "ip",
        },
      },
    });

    try {
      const slow = await t.request.get("/runtime/slow");
      expect(slow.status).toBe(504);
      expect(slow.body.code).toBe(504);
      await new Promise((resolve) => setTimeout(resolve, 40));

      const first = await t.request.get("/runtime/limited");
      const second = await t.request.get("/runtime/limited");
      expect(first.status).toBe(200);
      expect(second.status).toBe(429);
      expect(second.body.message).toBe("limited");
    } finally {
      await t.close();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("waits for after-middleware completion before resolving test responses", async () => {
    const rootDir = await createFixture();
    const events: string[] = [];
    const t = await createTestApp({
      services: false,
      rootDir,
      setupPlugins(app) {
        app.use(async (_req, _res, next) => {
          events.push("before");
          await next();
          await new Promise((resolve) => setTimeout(resolve, 5));
          events.push("after");
        });
      },
    });

    try {
      const response = await t.request.get("/runtime/me");

      expect(response.status).toBe(200);
      expect(events).toEqual(["before", "after"]);
    } finally {
      await t.close();
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
