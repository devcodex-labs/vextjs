import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestApp } from "../../src/testing/index.js";

describe("createTestApp CSRF middleware registration", () => {
  it("protects unsafe routes when config.csrf.enabled is true", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "vext-testing-csrf-"));
    const routesDir = join(rootDir, "src", "routes");
    await mkdir(routesDir, { recursive: true });
    await writeFile(
      join(routesDir, "csrf.ts"),
      `
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
  post(path, optionsOrHandler, handler) {
    routes.push({
      method: "POST",
      path,
      options: typeof optionsOrHandler === "function" ? {} : optionsOrHandler || {},
      handler: typeof optionsOrHandler === "function" ? optionsOrHandler : handler,
    });
  },
};

function factory() {
  collector.get("/token", {}, async (req, res) => {
    res.json({ token: req.csrfToken() });
  });
  collector.post("/submit", {}, async (_req, res) => {
    res.json({ ok: true });
  });
  collector.post("/public", { csrf: false }, async (_req, res) => {
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
`,
      "utf-8",
    );

    const t = await createTestApp({
      services: false,
      rootDir,
      config: {
        csrf: {
          enabled: true,
          mode: "signed-cookie",
          secret: "test-csrf-secret",
        },
      },
    });

    try {
      const missingToken = await t.request
        .post("/csrf/submit")
        .send({ ok: true });

      expect(missingToken.status).toBe(403);
      expect(missingToken.body.code).toBe("CSRF_TOKEN_MISSING");

      const tokenResponse = await t.request.get("/csrf/token");
      const token = tokenResponse.body.data.token;
      const cookie = tokenResponse.cookies[0]?.split(";")[0];

      expect(tokenResponse.status).toBe(200);
      expect(token).toEqual(expect.any(String));
      expect(cookie).toContain("vext.csrf=");
      expect(tokenResponse.header("cache-control")).toBe("no-store");

      const accepted = await t.request
        .post("/csrf/submit")
        .set("cookie", cookie)
        .set("x-csrf-token", token)
        .send({ ok: true });

      expect(accepted.status).toBe(200);
      expect(accepted.body.data).toEqual({ ok: true });

      const publicRoute = await t.request
        .post("/csrf/public")
        .send({ ok: true });

      expect(publicRoute.status).toBe(200);
      expect(publicRoute.body.data).toEqual({ ok: true });
    } finally {
      await t.close();
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
