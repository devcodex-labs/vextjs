import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Model } from "monsqlize";
import { detectProject } from "../../../src/cli/utils/detect-project.js";
import { resolvePreloads } from "../../../src/cli/utils/preload.js";
import { runLocalTsc } from "../../../src/cli/utils/local-tsc.js";
import { loadModels } from "../../../src/lib/plugins/monsqlize/model-loader.js";
import { resolveConsumerModule } from "../../../src/lib/consumer-resolver.js";

const roots: string[] = [];
function write(root: string, file: string, contents: string): string {
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
  return target;
}
function project(): { workspace: string; service: string } {
  const workspace = mkdtempSync(join(tmpdir(), "vext-consumer-"));
  roots.push(workspace);
  const service = join(workspace, "apps", "api");
  write(
    service,
    "package.json",
    JSON.stringify({
      name: "api",
      type: "module",
      dependencies: { vextjs: "2.0.0", telemetry: "1.0.0" },
    }),
  );
  write(service, "src/config/default.js", "export default {};");
  return { workspace, service };
}
function framework(root: string): string {
  const pkg = join(root, "node_modules", "vextjs");
  write(
    pkg,
    "package.json",
    JSON.stringify({
      name: "vextjs",
      type: "module",
      exports: {
        ".": { import: "./dist/index.js", require: "./dist/index.cjs" },
      },
    }),
  );
  write(pkg, "dist/index.js", "export {};");
  write(pkg, "dist/index.cjs", "module.exports = {};");
  return write(pkg, "dist/lib/bootstrap.js", "export {};");
}

afterEach(() => {
  Model._clear();
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("consumer package resolution", () => {
  it("honors import-only exports and refuses private or missing build targets", () => {
    const { workspace, service } = project();
    const pkg = join(workspace, "node_modules/import-only");
    write(
      pkg,
      "package.json",
      JSON.stringify({
        name: "import-only",
        exports: {
          ".": { import: "./index.mjs" },
          "./missing": "./missing.mjs",
        },
      }),
    );
    const entry = write(
      pkg,
      "index.mjs",
      "throw new Error('resolver must not execute modules');",
    );
    write(pkg, "private.mjs", "export {};");
    expect(resolveConsumerModule(service, "import-only")).toBe(
      pathToFileURL(realpathSync(entry)).href,
    );
    expect(() =>
      resolveConsumerModule(service, "import-only/private.mjs"),
    ).toThrow();
    expect(() =>
      resolveConsumerModule(service, "import-only/missing"),
    ).toThrow();
    expect(() => resolveConsumerModule(service, "absent-package")).toThrow();
  });
  it("finds a hoisted framework with an unexported package.json", () => {
    const { workspace, service } = project();
    const expected = framework(workspace);
    expect(detectProject(service).entryFile).toBe(realpathSync(expected));
  });

  it("uses the nearest installed framework and resolves pnpm links", () => {
    const { workspace, service } = project();
    framework(workspace);
    const store = join(workspace, "node_modules", ".pnpm", "vextjs@2.0.0");
    const expected = framework(store);
    mkdirSync(join(service, "node_modules"), { recursive: true });
    symlinkSync(
      dirname(dirname(dirname(expected))),
      join(service, "node_modules", "vextjs"),
      "junction",
    );
    expect(detectProject(service).entryFile).toBe(realpathSync(expected));
  });

  it("reports missing framework build artifacts without selecting the hoisted copy", () => {
    const { workspace, service } = project();
    framework(workspace);
    const local = framework(service);
    rmSync(local);
    expect(() => detectProject(service).entryFile).toThrow("bootstrap.js");
  });

  it("loads hoisted package preloads even when package.json is private and no main exists", async () => {
    const { workspace, service } = project();
    const pkg = join(workspace, "node_modules", "telemetry");
    write(
      pkg,
      "package.json",
      JSON.stringify({
        name: "telemetry",
        type: "module",
        exports: { "./instrument": "./instrument.mjs" },
        vext: { preload: "./instrument.mjs" },
      }),
    );
    const instrumentation = write(pkg, "instrument.mjs", "export {};");
    expect(await resolvePreloads(service)).toEqual([
      pathToFileURL(realpathSync(instrumentation)).href,
    ]);
  });

  it("runs the consumer's hoisted TypeScript compiler with the service cwd", async () => {
    const { workspace, service } = project();
    const pkg = join(workspace, "node_modules", "typescript");
    write(
      pkg,
      "package.json",
      JSON.stringify({ name: "typescript", bin: { tsc: "bin/tsc" } }),
    );
    write(
      pkg,
      "bin/tsc",
      "console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));",
    );
    const result = await runLocalTsc(service, { pretty: false });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.output)).toEqual({
      cwd: service,
      args: ["--noEmit", "--pretty", "false"],
    });
  });

  it.each([
    ["esm", "export default { User: { collection: 'users', schema: {} } };"],
    ["cjs", "module.exports = { User: { collection: 'users', schema: {} } }"],
    [
      "compiled-cjs",
      "exports.__esModule = true; exports.default = { User: { collection: 'users', schema: {} } };",
    ],
  ])(
    "loads shared %s definitions from the service's import conditions",
    async (format, source) => {
      const { workspace, service } = project();
      const pkg = join(workspace, "node_modules", "@app", "models");
      const extension = format === "esm" ? "mjs" : "cjs";
      write(
        pkg,
        "package.json",
        JSON.stringify({
          name: "@app/models",
          exports: {
            ".": { import: `./index.${extension}`, require: "./wrong.cjs" },
          },
        }),
      );
      write(pkg, `index.${extension}`, source);
      write(pkg, "wrong.cjs", "throw new Error('require condition selected');");
      const app = {
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      } as any;
      const handle = await loadModels(
        {} as any,
        { sharedPackage: "@app/models" },
        app,
        join(service, "src"),
      );
      expect(handle.keys).toEqual(["users"]);
      expect(Model.has("users")).toBe(true);
      handle.release();
      expect(Model.has("users")).toBe(false);
    },
  );
});
