import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestApp } from "../../src/testing/index.js";

describe("createTestApp Security Headers middleware registration", () => {
  it("applies security headers to routes, errors, 404, and route opt-out", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "vext-testing-security-"));
    const routesDir = join(rootDir, "src", "routes");
    await mkdir(routesDir, { recursive: true });
    await writeFile(
      join(routesDir, "security-headers.ts"),
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
};

function factory() {
  collector.get("/basic", {}, async (_req, res) => {
    res.json({ ok: true });
  });
  collector.get("/override", {}, async (_req, res) => {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-App-Security", "route");
    res.json({ ok: true });
  });
  collector.get("/skip", { securityHeaders: false }, async (_req, res) => {
    res.json({ ok: true });
  });
  collector.get("/boom", {}, async () => {
    throw new Error("boom");
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
        securityHeaders: {
          enabled: true,
          preset: "basic",
        },
      },
    });

    try {
      const basic = await t.request.get("/security-headers/basic");
      expect(basic.status).toBe(200);
      expect(basic.header("x-content-type-options")).toBe("nosniff");
      expect(basic.header("referrer-policy")).toBe(
        "strict-origin-when-cross-origin",
      );
      expect(basic.header("x-frame-options")).toBe("SAMEORIGIN");
      expect(basic.header("strict-transport-security")).toBeUndefined();
      expect(basic.header("x-xss-protection")).toBeUndefined();

      const override = await t.request.get("/security-headers/override");
      expect(override.status).toBe(200);
      expect(override.header("x-content-type-options")).toBe("nosniff");
      expect(override.header("x-frame-options")).toBe("DENY");
      expect(override.header("x-app-security")).toBe("route");

      const skipped = await t.request.get("/security-headers/skip");
      expect(skipped.status).toBe(200);
      expect(skipped.header("x-content-type-options")).toBeUndefined();
      expect(skipped.header("referrer-policy")).toBeUndefined();

      const missing = await t.request.get("/security-headers/missing");
      expect(missing.status).toBe(404);
      expect(missing.header("x-content-type-options")).toBe("nosniff");

      const failed = await t.request.get("/security-headers/boom");
      expect(failed.status).toBe(500);
      expect(failed.header("x-content-type-options")).toBe("nosniff");
    } finally {
      await t.close();
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
