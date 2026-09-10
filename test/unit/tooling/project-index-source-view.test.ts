import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildProjectIndex,
  buildProjectIndexFromSourceView,
} from "../../../src/tooling/project-index/index.js";
import {
  analyzeServiceDependencies,
  analyzeIndexedServiceDependencies,
} from "../../../src/tooling/diagnostics/service-deps.js";
import { collectProjectSources } from "../../../src/tooling/project-index/source-input.js";
import {
  createSourceView,
  overlaySourceView,
} from "../../../src/tooling/source-view/view.js";
import {
  createTypegenDrafts,
  runTypegen,
} from "../../../src/tooling/typegen/index.js";

const roots: string[] = [];

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vext-index-source-"));
  roots.push(root);
  return root;
}

function write(root: string, file: string, source: string): void {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, source);
}

afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const root of roots.splice(0)) {
    const real = fs.realpathSync.native(root);
    expect(path.dirname(real)).toBe(fs.realpathSync.native(os.tmpdir()));
    expect(path.basename(real).startsWith("vext-index-source-")).toBe(true);
    fs.rmSync(real, { recursive: true, force: true });
  }
});

describe("project index source views", () => {
  it("retains the indexed service generation when disk changes before dependency analysis", async () => {
    const root = fixture();
    write(
      root,
      "src/services/a.ts",
      "export default class A { get() { return this.app.services.b; } }\n",
    );
    write(root, "src/services/b.ts", "export default class B {}\n");
    const index = await buildProjectIndex(root);
    write(
      root,
      "src/services/b.ts",
      "export default class B { get() { return this.app.services.a; } }\n",
    );
    const report = await analyzeServiceDependencies(root, { index });
    expect([...report.graph.get("a")!]).toEqual(["b"]);
    expect([...report.graph.get("b")!]).toEqual([]);
    expect(report.diagnostics.some((item) => item.level === "error")).toBe(
      false,
    );
  });

  it("does not generate service keys from NodeNext declaration files", async () => {
    const root = fixture();
    write(root, "src/services/actual.mts", "export default class Actual {}\n");
    write(
      root,
      "src/services/ambient.d.mts",
      "declare const value: unknown; export default value;\n",
    );
    write(
      root,
      "src/services/ambient.d.cts",
      "declare const value: unknown; export default value;\n",
    );
    const index = await buildProjectIndex(root);
    expect(index.serviceEntries.map((entry) => entry.serviceKey)).toEqual([
      "actual",
    ]);
    expect(index.serviceEntries[0]?.importPath).toContain("actual.mjs");
  });

  it("projects service and plugin overlays into typegen candidates with no file I/O", async () => {
    const root = fixture();
    write(
      root,
      "src/services/a.ts",
      "export default class A { get() { return this.app.services.b; } }\n",
    );
    write(root, "src/services/b.ts", "export default class B {}\n");
    write(
      root,
      "src/plugins/extra.ts",
      "import { defineAppExtensions } from 'vextjs'; export const appExtensions = defineAppExtensions<{ before: string }>();\n",
    );
    const base = await collectProjectSources(root, ["service", "plugin"]);
    const next = overlaySourceView(base, [
      {
        kind: "replace",
        rootId: "project",
        path: "src/services/a.ts",
        expectedSha256: base.record("project", "src/services/a.ts")!.sha256,
        bytes: Buffer.from(
          "export default class A { get() { return this.app.services.c; } }\n",
        ),
      },
      {
        kind: "delete",
        rootId: "project",
        path: "src/services/b.ts",
        expectedSha256: base.record("project", "src/services/b.ts")!.sha256,
      },
      {
        kind: "create",
        rootId: "project",
        path: "src/services/c.ts",
        role: "service",
        bytes: Buffer.from("export default class C {}\n"),
      },
      {
        kind: "replace",
        rootId: "project",
        path: "src/plugins/extra.ts",
        expectedSha256: base.record("project", "src/plugins/extra.ts")!.sha256,
        bytes: Buffer.from(
          "import { defineAppExtensions } from 'vextjs'; export const appExtensions = defineAppExtensions<{ after: number }>();\n",
        ),
      },
    ]);
    write(root, "src/plugins/extra.ts", "unrelated disk contents");
    const open = vi.spyOn(fs, "openSync").mockImplementation(() => {
      throw new Error("unexpected open");
    });
    const read = vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("unexpected read");
    });
    const readAsync = vi
      .spyOn(fsPromises, "readFile")
      .mockImplementation(async () => {
        throw new Error("unexpected async read");
      });
    syncBuiltinESMExports();
    const original = buildProjectIndexFromSourceView(root, base);
    const candidate = buildProjectIndexFromSourceView(root, next);
    expect(original.serviceEntries.map((entry) => entry.serviceKey)).toEqual([
      "a",
      "b",
    ]);
    expect(original.appExtensions.map((entry) => entry.propertyKey)).toEqual([
      "before",
    ]);
    expect(candidate.serviceEntries.map((entry) => entry.serviceKey)).toEqual([
      "a",
      "c",
    ]);
    expect(candidate.appExtensions.map((entry) => entry.propertyKey)).toEqual([
      "after",
    ]);
    const options = {
      generateServices: true,
      generateAppExtensions: true,
      writeManifest: true,
    };
    const draft = createTypegenDrafts(candidate, options);
    expect(draft.files).toHaveLength(3);
    expect(draft.files[0]?.content).toContain("c: import(");
    expect(draft.files[0]?.content).not.toContain("b: import(");
    expect(draft.files[1]?.content).toContain("after:");
    expect(
      JSON.parse(String(draft.manifest?.content)).dependencies.edges,
    ).toEqual([{ from: "a", to: "c" }]);
    expect(createTypegenDrafts(candidate, options)).toEqual(draft);
    expect(open).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(readAsync).not.toHaveBeenCalled();
  });

  it("isolates a registered root and custom module directories in a shared view", () => {
    const root = fixture();
    const other = fixture();
    const directory = "modules/订单 管理/services";
    const view = createSourceView({
      roots: [
        { id: "first", realPath: root, kind: "service" },
        { id: "second", realPath: other, kind: "service" },
      ],
      rolePolicyVersion: "test-project-roots-v1",
      files: [
        {
          rootId: "first",
          path: directory + "/payment/stripe.mts",
          role: "service",
          bytes: Buffer.from("export default class Stripe {}\n"),
        },
        {
          rootId: "second",
          path: "src/services/unrelated.ts",
          role: "service",
          bytes: Buffer.from("export default class Unrelated {}\n"),
        },
      ],
    });
    const index = buildProjectIndexFromSourceView(root, view, {
      rootId: "first",
      directories: { service: directory },
    });
    expect(index.source.view).toBe(view);
    expect(index.source.rootId).toBe("first");
    expect(index.serviceEntries.map((entry) => entry.serviceKey)).toEqual([
      "payment.stripe",
    ]);
    expect(index.serviceEntries[0]?.importPath).toContain(
      "modules/订单 管理/services/payment/stripe.mjs",
    );
    expect([...analyzeIndexedServiceDependencies(index).graph.keys()]).toEqual([
      "payment.stripe",
    ]);
    expect(() =>
      buildProjectIndexFromSourceView(root, view, { rootId: "first" }),
    ).toThrow();
  });

  it("reads each source once during actual typegen and never executes project modules", async () => {
    const root = fixture();
    write(
      root,
      "src/services/a.ts",
      "throw new Error('Do not execute sources'); export default class A { get() { return this.app.services.b; } }\n",
    );
    write(root, "src/services/b.ts", "export default class B {}\n");
    write(
      root,
      "src/plugins/extra.ts",
      "import { defineAppExtensions } from 'vextjs'; throw new Error('Do not execute plugins'); export const appExtensions = defineAppExtensions<{ extra: number }>();\n",
    );
    const counts = new Map(
      ["src/services/a.ts", "src/services/b.ts", "src/plugins/extra.ts"].map(
        (file) => [path.resolve(root, file), 0],
      ),
    );
    const actualOpen = fs.openSync;
    vi.spyOn(fs, "openSync").mockImplementation((file, flags, mode) => {
      if (typeof file === "string") {
        const target = path.resolve(file);
        if (counts.has(target)) counts.set(target, counts.get(target)! + 1);
      }
      return actualOpen(file, flags, mode);
    });
    syncBuiltinESMExports();
    const result = await runTypegen({
      rootDir: root,
      generateServices: true,
      generateAppExtensions: true,
      writeManifest: true,
    });
    expect(result.ok).toBe(true);
    expect([...counts.values()]).toEqual([1, 1, 1]);
    expect(
      fs.readFileSync(
        path.join(root, ".vext/types/app-extensions.generated.d.ts"),
        "utf8",
      ),
    ).toContain("extra:");
  });

  it("rejects index entries absent from their candidate view instead of falling back to disk", async () => {
    const root = fixture();
    write(root, "src/services/a.ts", "export default class A {}\n");
    const index = await buildProjectIndex(root);
    const view = overlaySourceView(index.source.view, [
      {
        kind: "delete",
        rootId: "project",
        path: "src/services/a.ts",
        expectedSha256: index.source.view.record(
          "project",
          "src/services/a.ts",
        )!.sha256,
      },
    ]);
    expect(() =>
      analyzeIndexedServiceDependencies({
        ...index,
        source: { ...index.source, view },
      }),
    ).toThrow(expect.objectContaining({ code: "VEXT_SOURCE_UNVERIFIED" }));
    expect(fs.existsSync(path.join(root, "src/services/a.ts"))).toBe(true);
  });

  it("preserves selective generation without creating files or ownership state", async () => {
    const root = fixture();
    write(root, "src/services/a.ts", "export default class A {}\n");
    const index = await buildProjectIndex(root);
    const service = createTypegenDrafts(index, {
      generateServices: true,
      generateAppExtensions: false,
      generateShim: false,
    });
    expect(service.files).toHaveLength(1);
    expect(service.manifest).toBeUndefined();
    const manifest = createTypegenDrafts(index, {
      generateServices: false,
      generateAppExtensions: false,
      writeManifest: true,
    });
    expect(manifest.files).toEqual([]);
    expect(manifest.manifest?.producer).toBe("service-manifest");
    const empty = createTypegenDrafts(index, {
      generateServices: false,
      generateAppExtensions: false,
    });
    expect(empty.files).toEqual([]);
    expect(empty.manifest).toBeUndefined();
    expect(fs.existsSync(path.join(root, ".vext"))).toBe(false);
    expect(fs.existsSync(path.join(root, "src/types"))).toBe(false);
  });
});
