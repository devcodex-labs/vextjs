import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BuildCompiler } from "../../src/lib/build/build-compiler.js";
import { DevCompiler } from "../../src/lib/dev/compiler.js";

const roots: string[] = [];
async function fixture() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "vext-backend-modules-"));
  roots.push(rootDir);
  const srcDir = path.join(rootDir, "src");
  const outDir = path.join(rootDir, "dist");
  const write = async (file: string, content: string) => {
    const target = path.join(rootDir, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
    return target;
  };
  const require = createRequire(path.join(rootDir, "package.json"));
  return { rootDir, srcDir, outDir, write, require };
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    const require = createRequire(path.join(root, "package.json"));
    for (const file of Object.keys(require.cache)) {
      if (file.startsWith(`${root}${path.sep}`)) delete require.cache[file];
    }
    await rm(root, { recursive: true, force: true });
  }
});

describe("backend module output references", () => {
  for (const mode of ["build", "dev"] as const) {
    it.each([
      ["ts", "js"],
      ["mts", "mjs"],
      ["cts", "cjs"],
      ["js", "js"],
      ["mjs", "mjs"],
      ["cjs", "cjs"],
    ])(
      `${mode} loads a .%s source through its .%s NodeNext reference`,
      async (sourceExt, importExt) => {
        const f = await fixture();
        const entry = await f.write(
          `src/index.${sourceExt}`,
          [
            `export { value } from './dep.${importExt}';`,
            `export const load = () => import('./dep.${importExt}');`,
            `export const resolved = require.resolve('./dep.${importExt}');`,
          ].join("\n"),
        );
        await f.write(`src/dep.${sourceExt}`, "export const value = 42;");
        const dev = mode === "dev" ? new DevCompiler(f) : undefined;
        try {
          if (dev) await dev.start();
          else expect((await new BuildCompiler(f).build()).success).toBe(true);
          const output = path.join(f.outDir, "index.js");
          const result = f.require(output);
          expect(result.value).toBe(42);
          expect((await result.load()).value).toBe(42);
          expect(result.resolved).toBe(path.join(f.outDir, "dep.js"));
          if (dev) {
            await f.write(
              `src/index.${sourceExt}`,
              `export { value } from './dep.${importExt}'; export const changed = true;`,
            );
            await dev.compileSingle(entry);
            delete f.require.cache[output];
            expect(f.require(output)).toMatchObject({
              value: 42,
              changed: true,
            });
          }
        } finally {
          await dev?.dispose();
        }
      },
    );
  }

  it("uses the same inherited JSONC paths and class semantics for full and incremental builds", async () => {
    const f = await fixture();
    await f.write(
      "tsconfig.base.json",
      '{ "compilerOptions": { "useDefineForClassFields": true, "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }',
    );
    const tsconfig = await f.write(
      "tsconfig.json",
      '{ // https://example.test/config\n "extends": "./tsconfig.base.json", "compilerOptions": { "target": "ES2022" }, }',
    );
    await f.write("src/dep.mts", "export const value = 42;");
    const entry = await f.write(
      "src/index.ts",
      "import { value } from '@/dep.mjs'; export const answer = value; export class Example { field: string; }",
    );
    const dev = new DevCompiler({ ...f, tsconfig });
    try {
      await dev.start();
      const output = path.join(f.outDir, "index.js");
      for (const incremental of [false, true]) {
        if (incremental) await dev.compileSingle(entry);
        delete f.require.cache[output];
        const result = f.require(output);
        expect(result.answer).toBe(42);
        expect(Object.hasOwn(new result.Example(), "field")).toBe(true);
      }
    } finally {
      await dev.dispose();
    }
  });

  it("supports native CommonJS require while preserving the neighboring module identity", async () => {
    const f = await fixture();
    await f.write(
      "src/index.cjs",
      "module.exports = require('./common/data.cjs');",
    );
    await f.write("src/common/data.cjs", "module.exports = { answer: 42 };");
    expect((await new BuildCompiler(f).build()).success).toBe(true);
    expect(f.require(path.join(f.outDir, "index.js"))).toEqual({ answer: 42 });
    expect(f.require(path.join(f.outDir, "index.js"))).toBe(
      f.require(path.join(f.outDir, "common/data.js")),
    );
  });

  it("diagnoses backend imports of excluded frontend files before producing a successful build", async () => {
    const f = await fixture();
    await f.write(
      "src/index.ts",
      "export { value } from './frontend/browser';",
    );
    await f.write(
      "src/frontend/browser.ts",
      "export const value = window.location.href;",
    );
    const result = await new BuildCompiler(f).build();
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.text).join("\n")).toMatch(
      /backend|excluded|frontend/,
    );
    expect(existsSync(path.join(f.outDir, "frontend/browser.js"))).toBe(false);
  });
});
