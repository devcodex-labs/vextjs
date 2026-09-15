import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runDoctor,
  analyzeDoctorSourceView,
  type DoctorResult,
} from "../../../src/tooling/doctor/index.js";
import {
  createRouteSourceSnapshot,
  buildRouteIndexFromSourceView,
  projectRouteSourceSnapshot,
} from "../../../src/tooling/project-index/scan-routes.js";
import { collectProjectSources } from "../../../src/tooling/project-index/source-input.js";
import { overlaySourceView } from "../../../src/tooling/source-view/view.js";

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vext-doctor-source-"));
  roots.push(fs.realpathSync.native(root));
  fs.mkdirSync(path.join(root, "src/routes"), { recursive: true });
  return root;
}
function source(route: string): string {
  return (
    'import { defineRoutes } from "vextjs";\nexport default defineRoutes(app => {\n' +
    '  app.get("' +
    route +
    '", { docs: { summary: "Source probe" } }, (_req, res) => res.json({ ok: true }));\n});\n'
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const root of roots.splice(0)) {
    expect(fs.realpathSync.native(root)).toBe(root);
    expect(path.dirname(root)).toBe(fs.realpathSync.native(os.tmpdir()));
    expect(path.basename(root)).toMatch(/^vext-doctor-source-/u);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Doctor source identity", () => {
  it("does not claim full validation when a route handler is unknown", async () => {
    const root = fixture();
    fs.writeFileSync(
      path.join(root, "src/routes/index.ts"),
      "import { defineRoutes } from 'vextjs'; import handler from '../utils/handler.js'; export default defineRoutes(app => { app.get('/', {}, handler); });",
    );
    const result = await runDoctor({ rootDir: root, target: "all" });
    expect(result.ok).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.domains).toContainEqual(
      expect.objectContaining({ domain: "routes", status: "incomplete" }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "VEXT_MCP_ROUTE_ANALYSIS_UNKNOWN" }),
    );
  });

  it("uses the shared config checker for invalid middleware declarations", async () => {
    const root = fixture();
    fs.mkdirSync(path.join(root, "src/config"));
    fs.writeFileSync(
      path.join(root, "src/config/default.ts"),
      "export default { middlewares: ['auth', 'auth'] };",
    );
    const result = await runDoctor({ rootDir: root, target: "all" });
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.filter(
        (item) => item.code === "VEXT_MCP_CONFIG_INVALID",
      ),
    ).toHaveLength(1);
  });

  it("analyzes every supported static domain from one sealed input without disk access", async () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, "src/routes/index.ts"), source("/probe"));
    fs.mkdirSync(path.join(root, "src/services"));
    fs.writeFileSync(
      path.join(root, "src/services/a.ts"),
      "export default app => ({ run: () => app.services.b.run() });",
    );
    fs.writeFileSync(
      path.join(root, "src/services/b.ts"),
      "export default app => ({ run: () => app.services.a.run() });",
    );
    const view = await collectProjectSources(root, [
      "route",
      "service",
      "plugin",
    ]);
    const open = vi.spyOn(fs, "openSync").mockImplementation(() => {
      throw new Error("unexpected disk read");
    });
    const result = analyzeDoctorSourceView(root, view, { target: "all" });
    expect(result.profile).toBe("static-project");
    expect(result.ok).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ group: "services", level: "error" }),
    );
    expect(result.domains).toContainEqual(
      expect.objectContaining({ domain: "plugins", status: "not-present" }),
    );
    expect(result.domains).toContainEqual(
      expect.objectContaining({
        domain: "configuration",
        status: "unsupported",
        required: false,
      }),
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("keeps dynamic services incomplete without claiming a successful project validation", async () => {
    const root = fixture();
    fs.mkdirSync(path.join(root, "src/services"));
    fs.writeFileSync(
      path.join(root, "src/services/dynamic.ts"),
      "export default app => ({ run: key => app.services[key].run() });",
    );
    const result = await runDoctor({ rootDir: root, target: "all" });
    expect(result.ok).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.domains).toContainEqual(
      expect.objectContaining({ domain: "services", status: "incomplete" }),
    );
    expect(fs.existsSync(path.join(root, ".vext"))).toBe(false);
  });

  it("never publishes routes with a fingerprint from different source bytes", async () => {
    const root = fixture();
    const file = path.join(root, "src/routes/index.ts");
    fs.writeFileSync(file, source("/before"));
    const before = await createRouteSourceSnapshot(root);
    fs.writeFileSync(file, source("/after"));
    const after = await createRouteSourceSnapshot(root);
    fs.writeFileSync(file, source("/before"));
    const readFile = fs.readFileSync;
    const open = fs.openSync;
    const read = fs.readSync;
    const descriptors = new Set<number>();
    const isSourceFile = (target: unknown) =>
      typeof target === "string" && path.resolve(target) === file;
    let changed = false;
    const mutate = () => {
      if (!changed) {
        changed = true;
        fs.writeFileSync(file, source("/after"));
      }
    };
    vi.spyOn(fs, "openSync").mockImplementation(((target, flags, mode) => {
      const fd = open(target, flags, mode);
      if (isSourceFile(target)) descriptors.add(fd);
      return fd;
    }) as typeof fs.openSync);
    vi.spyOn(fs, "readSync").mockImplementation(((
      ...args: Parameters<typeof fs.readSync>
    ) => {
      const bytes = Reflect.apply(read, fs, args);
      if (descriptors.has(args[0]) && bytes > 0) mutate();
      return bytes;
    }) as typeof fs.readSync);
    vi.spyOn(fs, "readFileSync").mockImplementation(((
      ...args: Parameters<typeof fs.readFileSync>
    ) => {
      const bytes = Reflect.apply(readFile, fs, args);
      if (isSourceFile(args[0])) mutate();
      return bytes;
    }) as typeof fs.readFileSync);
    syncBuiltinESMExports();
    let result: DoctorResult | undefined;
    let failure: unknown;
    try {
      result = await runDoctor({
        rootDir: root,
        refresh: true,
        writeManifest: true,
      });
    } catch (error) {
      failure = error;
    }
    expect(changed).toBe(true);
    if (failure) {
      expect(failure).toMatchObject({ code: "VEXT_SOURCE_CHANGED" });
      expect(fs.existsSync(path.join(root, ".vext/manifest/routes.json"))).toBe(
        false,
      );
    } else {
      const expected =
        result!.routes[0]?.path === "/before"
          ? before.fingerprint
          : after.fingerprint;
      expect(result!.sourceFingerprint).toBe(expected);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(root, ".vext/manifest/routes.json"), "utf8"),
      );
      expect(manifest.sourceFingerprint).toBe(expected);
    }
  });

  it("keeps a historical snapshot's original source identity", async () => {
    const root = fixture();
    const file = path.join(root, "src/routes/index.ts");
    fs.writeFileSync(file, source("/before"));
    const first = await runDoctor({ rootDir: root, writeManifest: true });
    fs.writeFileSync(file, source("/after"));
    const snapshot = await runDoctor({ rootDir: root, manifestOnly: true });
    expect(snapshot.routes[0]?.path).toBe("/before");
    expect(snapshot.sourceFingerprint).toBe(first.sourceFingerprint);
    expect(snapshot.sourceFreshness).toBe("stale");
  });

  it("does not trust a disk cache solely because its declared source fingerprint matches", async () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, "src/routes/index.ts"), source("/actual"));
    await runDoctor({ rootDir: root, writeManifest: true });
    const file = path.join(root, ".vext/manifest/routes.json");
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    manifest.routes[0].path = "/forged";
    fs.writeFileSync(file, JSON.stringify(manifest));
    const result = await runDoctor({ rootDir: root });
    expect(result.routes[0]?.path).toBe("/actual");
    expect(result.sourceFreshness).toBe("current");
  });

  it("projects overlays without touching live source files", async () => {
    const root = fixture();
    const file = path.join(root, "src/routes/index.ts");
    fs.writeFileSync(file, source("/before"));
    const base = await collectProjectSources(root, ["route"]);
    const next = overlaySourceView(base, [
      {
        kind: "replace",
        rootId: "project",
        path: "src/routes/index.ts",
        expectedSha256: base.record("project", "src/routes/index.ts")!.sha256,
        bytes: Buffer.from(source("/candidate")),
      },
    ]);
    fs.writeFileSync(file, "invalid live source");
    const open = vi.spyOn(fs, "openSync").mockImplementation(() => {
      throw new Error("unexpected disk access");
    });
    expect(buildRouteIndexFromSourceView(root, base)[0]?.path).toBe("/before");
    expect(buildRouteIndexFromSourceView(root, next)[0]?.path).toBe(
      "/candidate",
    );
    expect(projectRouteSourceSnapshot(next).fingerprint).not.toBe(
      projectRouteSourceSnapshot(base).fingerprint,
    );
    const deleted = overlaySourceView(base, [
      {
        kind: "delete",
        rootId: "project",
        path: "src/routes/index.ts",
        expectedSha256: base.record("project", "src/routes/index.ts")!.sha256,
      },
    ]);
    expect(buildRouteIndexFromSourceView(root, deleted)).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });

  it("keeps absent legacy metadata unknown and does not invent a current source identity", async () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, "src/routes/index.ts"), source("/actual"));
    const file = path.join(root, ".vext/manifest/routes.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        routes: [{ source: "src/routes/old.ts", method: "GET", path: "/old" }],
      }),
    );
    const result = await runDoctor({ rootDir: root, manifestOnly: true });
    expect(result.sourceFingerprint).toBeNull();
    expect(result.sourceFiles).toEqual([]);
    expect(result.sourceFreshness).toBe("unverified");
    expect(result.routes[0]?.schema).toBeUndefined();
    expect(result.routes[0]?.freshness).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "snapshot-incomplete" }),
    );
  });

  it.each([
    { routes: "invalid" },
    { routes: [{ source: "../outside.ts", method: "GET", path: "/old" }] },
    {
      routes: [
        {
          source: "src/routes/old.ts",
          method: "GET",
          path: "/old",
          schema: {},
        },
      ],
    },
  ])(
    "rejects malformed snapshots without rewriting them: %j",
    async (payload) => {
      const root = fixture();
      const file = path.join(root, ".vext/manifest/routes.json");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const bytes = JSON.stringify(payload);
      fs.writeFileSync(file, bytes);
      await expect(
        runDoctor({ rootDir: root, manifestOnly: true }),
      ).rejects.toMatchObject({ code: "VEXT_SOURCE_UNVERIFIED" });
      expect(fs.readFileSync(file, "utf8")).toBe(bytes);
    },
  );

  it("disables snapshot re-attestation even when called directly", async () => {
    const root = fixture();
    await expect(
      runDoctor({ rootDir: root, manifestOnly: true, writeManifest: true }),
    ).rejects.toThrow("cannot be combined");
    expect(fs.existsSync(path.join(root, ".vext/manifest/routes.json"))).toBe(
      false,
    );
  });
});
