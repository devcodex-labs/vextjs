import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { execFileSync, fork } from "node:child_process";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { build } from "esbuild";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuildCompiler } from "../../src/lib/build/build-compiler.js";
import {
  beginBuild,
  completeBuild,
  resolveBuildLocation,
  selectBuildOutput,
} from "../../src/lib/build/build-location.js";
import {
  acquireProjectOwner,
  withProjectOwner,
  type ProjectOwner,
} from "../../src/lib/project/owner.js";
import { withArtifactGroupTransaction } from "../../src/lib/project/artifact-transaction.js";
import {
  ARTIFACT_JOURNAL_FILE,
  ARTIFACT_MANIFEST_FILE,
  artifactPath,
} from "../../src/lib/project/artifact-manifest.js";
import {
  canonicalPath,
  physicalPath,
  assertExplicitOutputDirectory,
} from "../../src/lib/path-boundary.js";
import { resolveFrontendConfig } from "../../src/frontend/tooling/config-resolver.js";

let workspace: string;
let service: string;
let output: string;
const owners: ProjectOwner[] = [];
beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(tmpdir(), "vext-external-output-"));
  service = path.join(workspace, "apps", "api");
  output = path.join(workspace, "artifacts", "api");
  write(
    path.join(workspace, "package.json"),
    '{"private":true,"workspaces":["apps/*"]}',
  );
  write(path.join(service, "package.json"), '{"name":"api","type":"module"}');
  write(
    path.join(service, "src", "index.ts"),
    'import data from "./data.json"; export const value = data.value;',
  );
  write(path.join(service, "src", "data.json"), '{"value":"initial"}');
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const owner of owners.splice(0).reverse()) await owner.release();
  fs.rmSync(workspace, { recursive: true, force: true });
});
function write(file: string, value: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}
async function owner(root: string) {
  const result = await acquireProjectOwner(root, "build");
  owners.push(result);
  return result;
}

describe("explicit external output consumers", () => {
  it.each([
    { relocated: false, preload: false },
    { relocated: false, preload: true },
    { relocated: true, preload: true },
  ])(
    "keeps two services' dependency conditions, dynamic imports and preloads after source removal (%j)",
    async ({ relocated, preload }) => {
      for (const name of ["api", "admin"]) {
        const root = path.join(workspace, "apps", name);
        write(
          path.join(root, "package.json"),
          JSON.stringify({ name, type: "module" }),
        );
        const dependency = path.join(root, "node_modules", "dual-dependency");
        write(
          path.join(dependency, "package.json"),
          JSON.stringify({
            name: "dual-dependency",
            type: "module",
            exports: { import: "./import.js", require: "./require.cjs" },
          }),
        );
        write(
          path.join(dependency, "import.js"),
          `export default ${JSON.stringify(`${name}:import`)};`,
        );
        write(
          path.join(dependency, "require.cjs"),
          `module.exports = ${JSON.stringify(`${name}:require`)};`,
        );
        write(
          path.join(root, "src", "neighbor.ts"),
          'export const value = "relative";',
        );
        write(
          path.join(root, "src", "common.cjs"),
          'module.exports = { value: require("dual-dependency"), sloppy: (function () { return this; })() === globalThis };',
        );
        write(
          path.join(root, "src", "index.ts"),
          `${relocated ? "#!/usr/bin/env node\n" : ""}
        import value from "dual-dependency";
        import common from "./common.cjs";
        export { value, common };
        export async function inspect(specifier = "dual-dependency") {
          return [(await import(specifier)).default, (await import("./neighbor.js")).value];
        }
      `,
        );
        if (preload)
          write(
            path.join(root, "src", "preload", "setup.ts"),
            `
        import value from "dual-dependency";
        process.env.VEXT_EXTERNAL_PRELOAD_${name.toUpperCase()} = value;
      `,
          );
        expect(
          (
            await new BuildCompiler({
              rootDir: root,
              srcDir: path.join(root, "src"),
              outDir: path.join(workspace, "artifacts", name),
            }).build()
          ).success,
        ).toBe(true);
        fs.rmSync(path.join(root, "src"), { recursive: true, force: true });
      }
      if (relocated) {
        const moved = `${workspace}-moved`;
        fs.renameSync(workspace, moved);
        workspace = moved;
      }
      // 子进程隔离 Node hook；使用真实 Node 解析而不是 Vitest 的模块加载器。
      const runner = path.join(workspace, "probe.cjs");
      write(
        runner,
        `
      const assert = require("node:assert/strict");
      const a = require("./artifacts/api/index.js");
      const b = require("./artifacts/admin/index.js");
      (async () => {
        for (const [name, item] of [["api", a], ["admin", b], ["api", a]]) {
          assert.equal(item.value, name + ":require");
          assert.equal(item.common.value, name + ":require");
          assert.equal(item.common.sloppy, true);
          assert.deepEqual(await item.inspect(), [name + ":import", "relative"]);
          if (${preload}) assert.equal(process.env["VEXT_EXTERNAL_PRELOAD_" + name.toUpperCase()], name + ":import");
        }
        console.log("scope-pass");
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `,
      );
      const imports = preload
        ? ["api", "admin"].flatMap((name) => [
            "--import",
            pathToFileURL(
              path.join(workspace, "artifacts", name, "preload", "setup.mjs"),
            ).href,
          ])
        : [];
      expect(
        execFileSync(process.execPath, [...imports, runner], {
          encoding: "utf8",
          timeout: 20_000,
        }),
      ).toContain("scope-pass");
      expect(
        fs.existsSync(path.join(workspace, "artifacts", "api", "node_modules")),
      ).toBe(false);
    },
  );

  it("builds and executes outside the service, then reclaims only recorded deleted outputs", async () => {
    const compiler = new BuildCompiler({
      rootDir: service,
      srcDir: path.join(service, "src"),
      outDir: output,
    });
    const selected = selectBuildOutput(service, path.relative(service, output));
    const identity = await beginBuild(service, selected, "staging", "compiled");
    expect((await compiler.build()).success).toBe(true);
    await completeBuild(service, identity);
    const require = createRequire(path.join(service, "consumer.cjs"));
    expect(require(path.join(output, "index.js")).value).toBe("initial");
    expect(resolveBuildLocation(service)).toMatchObject({
      outDir: physicalPath(output),
      identity: { profile: "staging" },
    });
    expect(resolveBuildLocation(service).failure).toBeUndefined();
    const manifest = JSON.parse(
      fs.readFileSync(path.join(service, ARTIFACT_MANIFEST_FILE), "utf8"),
    );
    expect(
      manifest.scopes.find(
        (scope: { producer: string }) => scope.producer === "backend",
      ).outputDir,
    ).toBe(physicalPath(output).replaceAll("\\", "/"));
    write(path.join(output, "user-owned.txt"), "preserve");
    fs.rmSync(path.join(service, "src", "data.json"));
    write(
      path.join(service, "src", "index.ts"),
      'export const value = "changed";',
    );
    expect((await compiler.build()).success).toBe(true);
    expect(fs.existsSync(path.join(output, "data.json"))).toBe(false);
    expect(fs.readFileSync(path.join(output, "user-owned.txt"), "utf8")).toBe(
      "preserve",
    );
    expect(
      fs.readFileSync(path.join(service, "src", "index.ts"), "utf8"),
    ).toContain("changed");
  });

  it("resolves an external frontend output without changing source roles or file traversal rules", () => {
    const config = resolveFrontendConfig(
      { enabled: true, outDir: output },
      { rootDir: service, mode: "production" },
    );
    expect(config.outDir).toBe(output);
    expect(config.root).toBe(path.join(service, "src", "frontend"));
    expect(() => artifactPath(service, "../../unregistered/file.js")).toThrow(
      /path segments/,
    );
    expect(() => artifactPath(service, output)).toThrow(/relative path/);
  });

  it("rejects shared, nested and alias output conflicts across two service owners", async () => {
    const other = path.join(workspace, "apps", "admin");
    write(path.join(other, "package.json"), '{"name":"admin"}');
    const a = await owner(service);
    const b = await owner(other);
    await a.reserveOutputs([output]);
    await expect(b.reserveOutputs([output])).rejects.toMatchObject({
      code: "VEXT_OWNER_BUSY",
    });
    await expect(
      b.reserveOutputs([path.join(output, "client")]),
    ).rejects.toMatchObject({ code: "VEXT_OWNER_BUSY" });
    await expect(
      b.reserveOutputs([path.dirname(output)]),
    ).rejects.toMatchObject({ code: "VEXT_OWNER_BUSY" });
    fs.mkdirSync(output, { recursive: true });
    const alias = path.join(workspace, "alias");
    fs.symlinkSync(
      path.dirname(output),
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      b.reserveOutputs([path.join(alias, "api")]),
    ).rejects.toMatchObject({ code: "VEXT_OWNER_BUSY" });
    await b.reserveOutputs([path.join(workspace, "artifacts", "admin")]);
    await a.release();
    await b.reserveOutputs([output]);
  });

  it("protects another package and service/workspace ancestors before output writes", () => {
    const other = path.join(workspace, "apps", "admin");
    write(path.join(other, "package.json"), '{"name":"admin"}');
    for (const target of [
      other,
      path.join(other, "dist"),
      service,
      workspace,
      path.join(workspace, "storage", "build"),
    ]) {
      expect(() =>
        assertExplicitOutputDirectory(service, target, "output"),
      ).toThrow();
    }
    expect(fs.existsSync(output)).toBe(false);
  });

  it.each(["preparation", "output", "manifest"])(
    "recovers external and internal outputs after a real process crash at %s",
    async (phase) => {
      const inside = path.join(service, ".vext/generated/frontend");
      const targets = [
        { producer: "backend", outDir: output },
        { producer: "frontend-generated", outDir: inside },
      ];
      const transaction = <T>(
        action: Parameters<typeof withArtifactGroupTransaction<T>>[1],
      ) =>
        withProjectOwner(service, "build", [output, inside], () =>
          withArtifactGroupTransaction(
            { rootDir: service, outputs: targets },
            action,
          ),
        );
      await transaction((value) =>
        value.commit(
          targets.map((target, index) => ({
            ...target,
            files: [
              {
                path: path.join(target.outDir, index ? "b.js" : "a.js"),
                contents: index ? "old b" : "old a",
              },
            ],
          })),
        ),
      );
      const entry = path.join(workspace, "crash.cjs");
      await build({
        entryPoints: [path.resolve("test/fixtures/artifact-crash-child.ts")],
        outfile: entry,
        bundle: true,
        platform: "node",
        format: "cjs",
        logLevel: "silent",
      });
      const child = fork(entry, [service, phase, "group", output], {
        stdio: "ignore",
      });
      console.log(
        `[external artifact probe] command=node ${entry} cwd=${process.cwd()} pid=${child.pid} output=${output}`,
      );
      const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
      try {
        await once(child, "exit");
        expect(child.exitCode).not.toBe(0);
      } finally {
        clearTimeout(timeout);
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await once(child, "exit");
        }
      }
      expect(fs.readFileSync(path.join(output, "a.js"), "utf8")).toBe(
        phase === "preparation" ? "old a" : "new a",
      );
      expect(fs.existsSync(path.join(service, ARTIFACT_JOURNAL_FILE))).toBe(
        phase !== "preparation",
      );
      await transaction(async () => {
        expect(fs.readFileSync(path.join(output, "a.js"), "utf8")).toBe(
          phase === "manifest" ? "new a" : "old a",
        );
        expect(fs.readFileSync(path.join(inside, "b.js"), "utf8")).toBe(
          phase === "manifest" ? "new b" : "old b",
        );
      });
      expect(fs.existsSync(path.join(service, ARTIFACT_JOURNAL_FILE))).toBe(
        false,
      );
      console.log(
        `[external artifact probe] closed pid=${child.pid}; recovery complete`,
      );
    },
  );

  it("rolls back both internal and external scopes after a later replacement fails", async () => {
    const inside = path.join(service, ".vext", "generated");
    const targets = [
      { producer: "generated", outDir: inside },
      { producer: "backend", outDir: output },
    ];
    const run = (contents: string) =>
      withProjectOwner(service, "build", [inside, output], () =>
        withArtifactGroupTransaction(
          { rootDir: service, outputs: targets },
          (transaction) =>
            transaction.commit(
              targets.map((target) => ({
                ...target,
                files: [
                  { path: path.join(target.outDir, "file.js"), contents },
                ],
              })),
            ),
        ),
      );
    await run("old");
    const manifest = fs.readFileSync(
      path.join(service, ARTIFACT_MANIFEST_FILE),
    );
    const rename = fs.renameSync;
    let failed = false;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (
        !failed &&
        canonicalPath(String(to)) ===
          canonicalPath(path.join(output, "file.js"))
      ) {
        failed = true;
        throw new Error("injected external replacement failure");
      }
      return rename(from, to);
    });
    await expect(run("new")).rejects.toThrow(/injected external/);
    expect(fs.readFileSync(path.join(inside, "file.js"), "utf8")).toBe("old");
    expect(fs.readFileSync(path.join(output, "file.js"), "utf8")).toBe("old");
    expect(fs.readFileSync(path.join(service, ARTIFACT_MANIFEST_FILE))).toEqual(
      manifest,
    );
  });
});
