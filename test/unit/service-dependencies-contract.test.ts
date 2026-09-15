import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { transform } from "esbuild";
import { collectServiceDependencies } from "../../src/lib/service-dependencies.js";
import { analyzeServiceDependencies } from "../../src/tooling/diagnostics/service-deps.js";
import { createApp, DEFAULT_CONFIG } from "../../src/lib/app.js";
import { loadServices } from "../../src/lib/service-loader.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const collect = (source: string) =>
  collectServiceDependencies(
    source,
    "service.ts",
    "a",
    new Set(["a", "b", "payment.stripe"]),
  );

describe("service injection binding contract", () => {
  it.each([false, true])(
    "checks loaded service facades without hiding cycles (cycle=%s)",
    async (cycle) => {
      const root = await mkdtemp(join(tmpdir(), "vext-service-facade-"));
      roots.push(root);
      await mkdir(join(root, "services"), { recursive: true });
      await mkdir(join(root, "features"), { recursive: true });
      await writeFile(join(root, "package.json"), '{"type":"module"}');
      await writeFile(
        join(root, "services", "a.js"),
        'export { default } from "../features/a.js";',
      );
      await writeFile(
        join(root, "features", "a.js"),
        "export default class A { constructor(app) { this.app = app; } run() { return this.app.services.b.run(); } }",
      );
      await writeFile(
        join(root, "services", "b.js"),
        cycle
          ? "export default class B { constructor(app) { this.app = app; } run() { return this.app.services.a.run(); } }"
          : "export default class B { run() { return 42; } }",
      );
      const { app } = createApp(DEFAULT_CONFIG);
      const warn = vi.spyOn(app.logger, "warn");
      if (cycle)
        await expect(
          loadServices(app, join(root, "services"), { rootDir: root }),
        ).rejects.toThrow(/Circular dependency/);
      else {
        await loadServices(app, join(root, "services"), { rootDir: root });
        expect((app.services.a as { run(): number }).run()).toBe(42);
      }
      expect(warn.mock.calls.flat().join(" ")).not.toContain("incomplete");
    },
  );

  it.each([
    "export default class A { constructor(private application: any) {} run() { return this.application.services.b.run(); } }",
    "export default class A { constructor(application) { this.backend = application; } run() { const alias = this.backend; return alias.services.b.run(); } }",
    "export default function A(application) { this.run = () => application.services.b.run(); }",
    "export default class A { constructor(private api: any) {} run = () => this.api.services.b.run(); }",
  ])("tracks injected app aliases: %s", async (source) => {
    expect([...collect(source).dependencies]).toEqual(["b"]);
    expect(collect(source).incomplete).toBe(false);
    const compiled = await transform(source, {
      loader: "ts",
      format: "cjs",
      target: "node20",
    });
    expect([...collect(compiled.code).dependencies]).toEqual(["b"]);
    expect(collect(compiled.code).incomplete).toBe(false);
  });

  it.each([
    "export default class A { run() { const app = { services: { b: 1 } }; return app.services.b; } }",
    "export default class A { constructor(app) { this.app = app; } run() { const app = { services: { b: 1 } }; return app.services.b; } }",
    "/* app.services.b.run() */ export default class A { run() { return 'this.app.services.b.run()'; } }",
  ])(
    "does not invent a dependency from unrelated names or text: %s",
    (source) => {
      expect([...collect(source).dependencies]).toEqual([]);
      expect(collect(source).incomplete).toBe(false);
    },
  );

  it.each([
    "export default class A { constructor(app) { this.app = app; } run(name) { return this.app.services[name]; } }",
    "export default class A { run(app) { return app.services.b; } }",
    "export default class A { constructor(app) { this.app = app; } run() { function nested() { return this.app.services.b; } return nested(); } }",
    "export default class A { constructor(app) { app = other; this.app = app; } run() { return this.app.services.b; } }",
    "export default class A { constructor(app) { wireServices(app); } }",
    "import ExternalService from './external.js'; export default ExternalService;",
  ])("keeps unsupported or dynamic provenance incomplete: %s", (source) => {
    expect(collect(source).incomplete).toBe(true);
    expect([...collect(source).dependencies]).toEqual([]);
  });

  it("resolves a namespace prefix with a statically known bracket key", () => {
    const result = collect(
      'export default class A { constructor(app) { this.api = app; } run() { return this.api.services["payment"].stripe.charge(); } }',
    );
    expect([...result.dependencies]).toEqual(["payment.stripe"]);
    expect(result.incomplete).toBe(false);
  });

  it.each(["local-object", "comment", "renamed-cycle", "ordinary"])(
    "runtime Loader and Doctor agree for %s",
    async (kind) => {
      const root = await mkdtemp(join(tmpdir(), "vext-service-binding-"));
      roots.push(root);
      const directory = join(root, "src/services");
      await mkdir(directory, { recursive: true });
      await writeFile(join(root, "package.json"), '{"type":"module"}');
      for (const [key, dependency] of [
        ["a", "b"],
        ["b", "a"],
      ]) {
        const source =
          kind === "local-object"
            ? `export default class Service { run() { const app = { services: { ${dependency}: { value: 42 } } }; return app.services.${dependency}.value; } }`
            : kind === "comment"
              ? `/* app.services.${dependency}.run() */ export default class Service { run() { return 42; } }`
              : `export default class Service { constructor(application) { this.application = application; } run() { return ${kind === "ordinary" && key === "b" ? "42" : `this.application.services.${dependency}.run()`}; } }`;
        await writeFile(join(directory, `${key}.mjs`), source);
      }
      const report = await analyzeServiceDependencies(root);
      const { app } = createApp(DEFAULT_CONFIG);
      const warn = vi.spyOn(app.logger, "warn");
      if (kind === "renamed-cycle") {
        expect(report.diagnostics.some((item) => item.level === "error")).toBe(
          true,
        );
        await expect(
          loadServices(app, directory, { rootDir: root }),
        ).rejects.toThrow(/Circular dependency/);
      } else {
        expect(report.diagnostics.some((item) => item.level === "error")).toBe(
          false,
        );
        await loadServices(app, directory, { rootDir: root });
        expect((app.services.a as { run(): number }).run()).toBe(42);
      }
      expect(report.incompleteFiles).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
    },
  );
});
