import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { build } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";
import { importUserModule } from "../../src/lib/user-module-loader.js";
import {
  acquireProjectOwner,
  withProjectOwner,
} from "../../src/lib/project/owner.js";

const roots: string[] = [];
const state = globalThis as typeof globalThis & {
  __vextOwnedModuleCount?: number;
};
function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vext-user-module-"));
  roots.push(root);
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
  return root;
}
function temporaryFiles(directory: string): string[] {
  return fs
    .readdirSync(directory)
    .filter(
      (name) =>
        name.startsWith(".vext-exec-") || name.includes(".__vext_compiled__"),
    );
}
function receipts(root: string): string[] {
  return fs.readdirSync(path.join(root, ".vext/freshness/v1/temporary"));
}
async function nativeModule(root: string, filename: string) {
  const runner = path.join(root, "runner.cjs");
  const require = createRequire(import.meta.url);
  await build({
    entryPoints: [path.resolve("test/fixtures/user-module-runner.ts")],
    outfile: runner,
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["esbuild"],
    logLevel: "silent",
  });
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.symlinkSync(
    path.dirname(require.resolve("esbuild/package.json")),
    path.join(root, "node_modules/esbuild"),
    process.platform === "win32" ? "junction" : "dir",
  );
  return promisify(execFile)(process.execPath, [runner, root, filename], {
    cwd: root,
    timeout: 10_000,
    maxBuffer: 128 * 1024,
  });
}
afterEach(() => {
  delete state.__vextOwnedModuleCount;
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("user module ownership and execution", () => {
  it("preserves parent state, native await, source meta aliases and functions after temporary cleanup", async () => {
    const root = project();
    const directory = path.join(root, "custom/config");
    fs.mkdirSync(directory, { recursive: true });
    const filename = path.join(directory, "bootstrap.ts");
    fs.writeFileSync(
      path.join(directory, "value.mjs"),
      'export default "dynamic";',
    );
    fs.writeFileSync(
      filename,
      `
      await Promise.resolve();
      globalThis.__vextOwnedModuleCount = (globalThis.__vextOwnedModuleCount ?? 0) + 1;
      const meta = import.meta;
      const { url, filename, dirname } = meta;
      export const location = { url, filename, dirname };
      export async function later(): Promise<string> {
        const target = "./value.mjs";
        return (await import(target)).default;
      }
    `,
    );
    const [first, second] = await Promise.all([
      importUserModule(filename, root),
      importUserModule(filename, root),
    ]);
    expect(first).toBe(second);
    expect(state.__vextOwnedModuleCount).toBe(1);
    expect(first.location).toEqual({
      url: pathToFileURL(filename).href,
      filename,
      dirname: directory,
    });
    expect(temporaryFiles(directory)).toEqual([]);
    expect(receipts(root)).toEqual([]);
    // Vite 的运行器重写动态 import；这项生命周期行为必须交给原生 Node 实测。
    const result = await nativeModule(root, filename);
    expect(result.stderr).toBe("");
    const native = JSON.parse(result.stdout);
    expect(native).toMatchObject({
      same: true,
      count: 1,
      location: first.location,
      value: "dynamic",
      temporary: [],
      receipts: [],
    });
    console.info(`[user module] cwd=${root}, PID=${native.pid}, exited=true`);
  });

  it("recovers an interrupted native TS evaluation before loading its replacement", async () => {
    const root = project();
    const filename = path.join(root, "module.ts");
    fs.writeFileSync(
      filename,
      `
      import fs from "node:fs";
      import path from "node:path";
      const file = path.join(import.meta.dirname, fs.readdirSync(import.meta.dirname).find((name) => name.startsWith(".vext-exec-"))!);
      process.stdout.write(JSON.stringify({ pid: process.pid, file }), () => process.kill(process.pid, "SIGKILL"));
      await new Promise(() => {}); // interrupted evaluation
    `,
    );
    const stopped = await nativeModule(root, filename).then(
      () => {
        throw new Error("The interruption fixture unexpectedly completed.");
      },
      (error: { stdout: string; stderr: string }) => {
        expect(error.stderr).toBe("");
        return JSON.parse(error.stdout) as { pid: number; file: string };
      },
    );
    expect(fs.readFileSync(stopped.file, "utf8")).toContain(
      'process.kill(process.pid, "SIGKILL")',
    );
    expect(receipts(root)).toHaveLength(1);
    fs.writeFileSync(filename, "export default 'recovered';");
    expect((await importUserModule(filename, root)).default).toBe("recovered");
    expect(temporaryFiles(root)).toEqual([]);
    expect(receipts(root)).toEqual([]);
    console.info(
      `[user module recovery] cwd=${root}, PID=${stopped.pid}, exited=true`,
    );
  });

  it("blocks compilation before user code under another writer and permits retry after that writer exits", async () => {
    const root = project();
    const filename = path.join(root, "module.ts");
    fs.writeFileSync(
      filename,
      "globalThis.__vextOwnedModuleCount = 1; export default true;",
    );
    const owner = await acquireProjectOwner(root, "dev");
    try {
      await expect(importUserModule(filename, root)).rejects.toMatchObject({
        code: "VEXT_OWNER_BUSY",
      });
      expect(state.__vextOwnedModuleCount).toBeUndefined();
      expect(temporaryFiles(root)).toEqual([]);
      expect(fs.existsSync(path.join(root, ".vext"))).toBe(false);
    } finally {
      await owner.release();
    }
    expect((await importUserModule(filename, root)).default).toBe(true);
    expect(receipts(root)).toEqual([]);
  });

  it("cleans a failed native import and allows the repaired source to load", async () => {
    const root = project();
    const filename = path.join(root, "module.ts");
    fs.writeFileSync(
      filename,
      'throw new Error("module failed"); export default false;',
    );
    await expect(importUserModule(filename, root)).rejects.toThrow(
      "module failed",
    );
    expect(temporaryFiles(root)).toEqual([]);
    expect(receipts(root)).toEqual([]);
    fs.writeFileSync(filename, "export default true;");
    expect((await importUserModule(filename, root)).default).toBe(true);
  });

  it("can explicitly refresh TS service evaluation within the inherited project owner", async () => {
    const root = project();
    const filename = path.join(root, "service.ts");
    fs.writeFileSync(
      filename,
      "export default class Service { value() { return 1; } }",
    );
    await withProjectOwner(root, "dev", [], async () => {
      const first = await importUserModule(filename, root, { cache: false });
      fs.writeFileSync(
        filename,
        "export default class Service { value() { return 2; } }",
      );
      const second = await importUserModule(filename, root, { cache: false });
      expect(
        new (first.default as new () => { value(): number })().value(),
      ).toBe(1);
      expect(
        new (second.default as new () => { value(): number })().value(),
      ).toBe(2);
      expect(temporaryFiles(root)).toEqual([]);
      expect(receipts(root)).toEqual([]);
    });
  });

  it("keeps JS imports read-only and rejects a TS file outside the explicit root", async () => {
    const root = project();
    const external = project();
    const js = path.join(root, "value.mjs");
    fs.writeFileSync(js, "export default 7;");
    expect((await importUserModule(js, root)).default).toBe(7);
    expect(fs.existsSync(path.join(root, ".vext"))).toBe(false);
    const ts = path.join(external, "value.ts");
    fs.writeFileSync(ts, "export default 8;");
    await expect(importUserModule(ts, root)).rejects.toThrow("inside");
    expect(temporaryFiles(external)).toEqual([]);
    expect(fs.existsSync(path.join(external, ".vext"))).toBe(false);
  });
});
