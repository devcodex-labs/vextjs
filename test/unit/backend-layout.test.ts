import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BuildCompiler } from "../../src/lib/build/build-compiler.js";
import { DevCompiler } from "../../src/lib/dev/compiler.js";
import { detectProjectLanguage } from "../../src/lib/build/project-language.js";

const roots: string[] = [];
async function fixture() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "vext-backend-layout-"));
  roots.push(rootDir);
  const srcDir = path.join(rootDir, "src");
  const outDir = path.join(rootDir, "dist");
  const write = async (file: string, content: string) => {
    const target = path.join(srcDir, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
    return target;
  };
  await write("config/default.js", "export default {};");
  await write("services/user.js", "export default class User {}");
  return { rootDir, srcDir, outDir, write };
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("backend compiler role boundaries", () => {
  it.each(["src/frontend", "src/web(ui)"])(
    "does not classify browser TypeScript in %s as backend TypeScript",
    async (root) => {
      const f = await fixture();
      await f.write(
        `${path.relative(f.srcDir, path.join(f.rootDir, root))}/pages/home.ts`,
        "export const browserOnly: string = 'browser';",
      );
      expect(detectProjectLanguage(f.rootDir, { root })).toBe("js");
    },
  );

  it("build and dev exclude every configured browser role, including roles outside frontend.root", async () => {
    const f = await fixture();
    const frontend = { root: "src/web(ui)", componentsDir: "../common-ui" };
    await f.write(
      "web(ui)/pages/home.ts",
      "export const browserOnly: string = 'browser';",
    );
    const component = await f.write(
      "common-ui/button.ts",
      "export const label: string = 'button';",
    );
    const options = { ...f, frontend };
    const build = new BuildCompiler(options);
    expect((await build.scanEntryPoints()).sort()).toEqual([
      "config/default.js",
      "services/user.js",
    ]);
    expect((await build.build()).success).toBe(true);
    expect(existsSync(path.join(f.outDir, "web(ui)/pages/home.js"))).toBe(
      false,
    );
    expect(existsSync(path.join(f.outDir, "common-ui/button.js"))).toBe(false);
    const dev = new DevCompiler({
      ...options,
      outDir: path.join(f.rootDir, ".vext/dev"),
    });
    try {
      expect((await dev.start()).fileCount).toBe(2);
      await expect(dev.compileSingle(component)).rejects.toThrow(
        /frontend|backend/,
      );
      await f.write("web(ui)/new.ts", "export const added = true;");
      expect((await dev.rebuildWithNewEntryPoints()).fileCount).toBe(2);
    } finally {
      await dev.dispose();
    }
  });

  it("single-file compilation rejects files outside its source root", async () => {
    const f = await fixture();
    const outside = path.join(f.rootDir, "outside.ts");
    await writeFile(outside, "export const value = 1;");
    const dev = new DevCompiler(f);
    try {
      await dev.start();
      await expect(dev.compileSingle(outside)).rejects.toThrow(/inside|source/);
      expect(existsSync(path.join(f.rootDir, "outside.js"))).toBe(false);
    } finally {
      await dev.dispose();
    }
  });
});
