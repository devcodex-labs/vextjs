import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestApp } from "../../src/testing/index.js";

describe("createTestApp cookie response helpers", () => {
  it("preserves multiple Set-Cookie headers", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "vext-testing-cookies-"));
    const routesDir = join(rootDir, "src", "routes");
    await mkdir(routesDir, { recursive: true });
    await writeFile(
      join(routesDir, "cookies.ts"),
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
  collector.get("/", {}, async (_req, res) => {
    res.cookie("a", "1", { path: "/" });
    res.cookie("b", "2", { path: "/" });
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
      ]);
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
    });

    try {
      const res = await t.request.get("/cookies");

      expect(res.status).toBe(200);
      expect(res.cookies).toHaveLength(2);
      expect(res.headerValues("set-cookie")).toEqual(res.cookies);
      expect(res.cookies[0]).toContain("a=1");
      expect(res.cookies[1]).toContain("b=2");
    } finally {
      await t.close();
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
