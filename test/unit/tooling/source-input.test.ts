import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectProjectSources } from "../../../src/tooling/project-index/source-input.js";
import { buildRouteIndexFromSourceView } from "../../../src/tooling/project-index/scan-routes.js";

const roots: string[] = [];
function fixture() {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "vext-source-input-")),
  );
  roots.push(root);
  return root;
}
function write(
  root: string,
  file: string,
  content = "export const value = 1;",
) {
  const absolute = path.join(root, file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    expect(fs.realpathSync.native(root)).toBe(root);
    expect(path.dirname(root)).toBe(fs.realpathSync.native(os.tmpdir()));
    expect(path.basename(root)).toMatch(/^vext-source-input-/u);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("project source discovery", () => {
  it("shares bounded role discovery and excludes declarations, tests and private convention files", async () => {
    const root = fixture();
    for (const file of [
      "src/routes/index.ts",
      "src/routes/nested/item.mjs",
      "src/routes/bad.cjs",
      "src/routes/_private/a.ts",
      "src/routes/.hidden/a.ts",
      "src/routes/a.test.ts",
      "src/routes/a.d.ts",
      "src/routes/node_modules/pkg/a.ts",
      "src/services/users.mts",
      "src/services/users.d.mts",
      "src/services/user.d.cts",
      "src/plugins/access.js",
    ])
      write(root, file);
    const view = await collectProjectSources(root, [
      "route",
      "service",
      "plugin",
    ]);
    expect(view.list().map((record) => [record.path, record.role])).toEqual([
      ["src/plugins/access.js", "plugin"],
      ["src/routes/bad.cjs", "route"],
      ["src/routes/index.ts", "route"],
      ["src/routes/nested/item.mjs", "route"],
      ["src/services/users.mts", "service"],
    ]);
  });

  it("keeps declared empty scopes distinct and rejects a directory occupied by a file", async () => {
    const root = fixture();
    const route = await collectProjectSources(root, ["route"]);
    const service = await collectProjectSources(root, ["service"]);
    expect(route.list()).toEqual([]);
    expect(route.revision).not.toBe(service.revision);
    write(root, "src/routes");
    await expect(collectProjectSources(root, ["route"])).rejects.toThrow(
      "not a directory",
    );
  });

  it("accepts an explicit custom source root and directory without changing route projection rules", async () => {
    const root = fixture();
    write(
      root,
      "server/中文 路由/index.ts",
      'import { defineRoutes } from "vextjs"; export default defineRoutes(app => { app.get("/custom", (_req, res) => res.json({})); });',
    );
    const options = {
      rootId: "billing",
      directories: { route: "server/中文 路由" },
    };
    const view = await collectProjectSources(root, ["route"], options);
    expect(buildRouteIndexFromSourceView(root, view, options)[0]?.path).toBe(
      "/custom",
    );
  });

  it("rejects undeclared escaping junctions instead of reporting incomplete routes as empty", async () => {
    const root = fixture();
    const outside = fixture();
    write(root, "src/routes/index.ts");
    write(outside, "outside.ts");
    fs.symlinkSync(
      outside,
      path.join(root, "src/routes/linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(collectProjectSources(root, ["route"])).rejects.toThrow(
      "inside",
    );
    fs.symlinkSync(
      outside,
      path.join(root, "escaped"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      collectProjectSources(root, ["route"], {
        directories: { route: "escaped" },
      }),
    ).rejects.toThrow("inside");
  });

  it("preserves logical route prefixes for internal directory links and diagnoses cycles", async () => {
    const root = fixture();
    write(
      root,
      "shared/routes/index.ts",
      'import { defineRoutes } from "vextjs"; export default defineRoutes(app => { app.get("/list", (_req, res) => res.json({})); });',
    );
    fs.mkdirSync(path.join(root, "src/routes"), { recursive: true });
    fs.symlinkSync(
      path.join(root, "shared/routes"),
      path.join(root, "src/routes/billing"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const view = await collectProjectSources(root, ["route"]);
    expect(view.list().map((record) => record.path)).toEqual([
      "src/routes/billing/index.ts",
    ]);
    expect(buildRouteIndexFromSourceView(root, view)[0]?.path).toBe(
      "/billing/list",
    );
    fs.symlinkSync(
      path.join(root, "src/routes"),
      path.join(root, "shared/routes/loop"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(collectProjectSources(root, ["route"])).rejects.toThrow(
      /cycle.*incomplete/,
    );
  });

  it("closes its actual directory handle when the file budget is exceeded", async () => {
    const root = fixture();
    write(root, "src/routes/a.ts");
    write(root, "src/routes/b.ts");
    const original = fs.promises.opendir;
    const handles: fs.Dir[] = [];
    vi.spyOn(fs.promises, "opendir").mockImplementation(async (...args) => {
      const handle = await original(...args);
      handles.push(handle);
      return handle;
    });
    await expect(
      collectProjectSources(root, ["route"], { limits: { maxFiles: 1 } }),
    ).rejects.toMatchObject({ code: "VEXT_SOURCE_LIMIT" });
    expect(handles).toHaveLength(1);
    expect(() => handles[0]!.read()).toThrow(/Directory handle was closed/);
  });

  it("cancels discovery and does not reread mutable role options after collection starts", async () => {
    const root = fixture();
    write(root, "src/routes/index.ts");
    const baseline = await collectProjectSources(root, ["route"]);
    const options = { directories: { route: "src/routes" } };
    const pending = collectProjectSources(root, ["route"], options);
    options.directories.route = "wrong";
    expect((await pending).revision).toBe(baseline.revision);
    const controller = new AbortController();
    const aborted = collectProjectSources(root, ["route"], {
      signal: controller.signal,
    });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({
      code: "VEXT_SOURCE_CANCELLED",
    });
  });

  it("uses explicit host budgets across consumers and allows per-operation overrides", async () => {
    const root = fixture();
    write(root, "src/routes/a.ts");
    write(root, "src/routes/b.ts");
    vi.stubEnv("VEXT_SOURCE_MAX_FILES", "1");
    await expect(collectProjectSources(root, ["route"])).rejects.toThrow(
      /incomplete.*VEXT_SOURCE_MAX_FILES/,
    );
    expect(
      (
        await collectProjectSources(root, ["route"], {
          limits: { maxFiles: 2 },
        })
      ).list(),
    ).toHaveLength(2);
    vi.stubEnv("VEXT_SOURCE_MAX_FILES", "invalid");
    await expect(collectProjectSources(root, ["route"])).rejects.toThrow(
      /Invalid source budget/,
    );
    vi.stubEnv("VEXT_SOURCE_MAX_FILES", "2");
    vi.stubEnv("VEXT_SOURCE_MAX_SCAN_ENTRIES", "1");
    await expect(collectProjectSources(root, ["route"])).rejects.toThrow(
      /VEXT_SOURCE_MAX_SCAN_ENTRIES/,
    );
  });
});
