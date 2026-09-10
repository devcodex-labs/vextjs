import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import fg from "fast-glob";
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

  it("does not traverse internal junctions and rejects a role root that escapes the project", async () => {
    const root = fixture();
    const outside = fixture();
    write(root, "src/routes/index.ts");
    write(outside, "outside.ts");
    fs.symlinkSync(
      outside,
      path.join(root, "src/routes/linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(
      (await collectProjectSources(root, ["route"]))
        .list()
        .map((record) => record.path),
    ).toEqual(["src/routes/index.ts"]);
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

  it("closes its actual discovery stream when the file budget is exceeded", async () => {
    const root = fixture();
    write(root, "src/routes/a.ts");
    write(root, "src/routes/b.ts");
    const original = fg.stream;
    const streams: Readable[] = [];
    vi.spyOn(fg, "stream").mockImplementation((...args) => {
      const stream = original(...args);
      if (!(stream instanceof Readable)) throw new Error("Unexpected stream");
      streams.push(stream);
      return stream;
    });
    await expect(
      collectProjectSources(root, ["route"], { limits: { maxFiles: 1 } }),
    ).rejects.toMatchObject({ code: "VEXT_SOURCE_LIMIT" });
    expect(streams).toHaveLength(1);
    await vi.waitFor(() => expect(streams[0]!.closed).toBe(true));
  });

  it("cancels an active stream and does not reread mutable role options after collection starts", async () => {
    const root = fixture();
    write(root, "src/routes/index.ts");
    const baseline = await collectProjectSources(root, ["route"]);
    const options = { directories: { route: "src/routes" } };
    const original = fg.stream;
    const streams: Readable[] = [];
    const spy = vi.spyOn(fg, "stream").mockImplementation((...args) => {
      const stream = original(...args);
      if (!(stream instanceof Readable)) throw new Error("Unexpected stream");
      streams.push(stream);
      queueMicrotask(() => {
        options.directories.route = "wrong";
      });
      return stream;
    });
    expect(
      (await collectProjectSources(root, ["route"], options)).revision,
    ).toBe(baseline.revision);
    const controller = new AbortController();
    spy.mockImplementation((...args) => {
      const stream = original(...args);
      if (!(stream instanceof Readable)) throw new Error("Unexpected stream");
      streams.push(stream);
      queueMicrotask(() => controller.abort());
      return stream;
    });
    await expect(
      collectProjectSources(root, ["route"], { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "VEXT_SOURCE_CANCELLED" });
    await vi.waitFor(() =>
      expect(streams.every((stream) => stream.closed)).toBe(true),
    );
  });
});
