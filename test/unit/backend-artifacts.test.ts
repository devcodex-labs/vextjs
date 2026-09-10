import fs from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BuildCompiler } from "../../src/lib/build/build-compiler.js";
import { DevCompiler } from "../../src/lib/dev/compiler.js";
import { ARTIFACT_MANIFEST_FILE } from "../../src/lib/project/artifact-manifest.js";

let root: string;
let srcDir: string;
let dev: DevCompiler | undefined;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(tmpdir(), "vext-backend-artifacts-"));
  srcDir = path.join(root, "src");
  write("src/index.ts", "export const value = 'old';");
  write(
    "tsconfig.json",
    '{"compilerOptions":{"target":"ES2022","resolveJsonModule":true}}',
  );
});
afterEach(async () => {
  await dev?.dispose();
  dev = undefined;
  fs.rmSync(root, { recursive: true, force: true });
});
function write(relative: string, bytes: string) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}
function compiler(mode: "dev" | "build") {
  const outDir = path.join(root, mode === "dev" ? ".vext/dev" : "dist");
  const production = new BuildCompiler({
    rootDir: root,
    srcDir,
    outDir,
    frontend: { enabled: true },
  });
  return {
    outDir,
    async compile() {
      if (mode === "build") {
        expect((await production.build()).success).toBe(true);
        return;
      }
      if (!dev) {
        dev = new DevCompiler({
          srcDir,
          outDir,
          frontend: { enabled: true },
          tsconfig: path.join(root, "tsconfig.json"),
        });
        await dev.start();
      } else await dev.rebuildWithNewEntryPoints();
    },
  };
}

describe("backend artifact consumers", () => {
  it.each(["build", "dev"] as const)(
    "copies nested JSON bytes and supports actual Node imports in %s",
    async (mode) => {
      const run = compiler(mode);
      const json = '\uFEFF{"title":"登录"}\n';
      write("src/locales/account/security/zh-CN.json", json);
      write(
        "src/index.ts",
        "import messages from './locales/account/security/zh-CN.json'; export const value = messages.title;",
      );
      write("src/frontend/private.json", '{"browser":"only"}');
      await run.compile();
      const require = createRequire(path.join(root, "consumer.cjs"));
      const output = path.join(
        run.outDir,
        "locales/account/security/zh-CN.json",
      );
      const entry = path.join(run.outDir, "index.js");
      expect(fs.readFileSync(output, "utf8")).toBe(json);
      expect(require(entry).value).toBe("登录");
      expect(
        fs.existsSync(path.join(run.outDir, "frontend/private.json")),
      ).toBe(false);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(root, ARTIFACT_MANIFEST_FILE), "utf8"),
      );
      expect(
        manifest.scopes[0].files.find((file: { path: string }) =>
          file.path.endsWith("zh-CN.json"),
        ).source,
      ).toBe("src/locales/account/security/zh-CN.json");
      write("src/locales/account/security/zh-CN.json", '{"title":"退出"}');
      if (mode === "dev")
        await dev!.compileSingle(
          path.join(srcDir, "locales/account/security/zh-CN.json"),
        );
      else await run.compile();
      delete require.cache[require.resolve(output)];
      delete require.cache[require.resolve(entry)];
      expect(require(entry).value).toBe("退出");
      fs.rmSync(path.join(srcDir, "locales/account/security/zh-CN.json"));
      write("src/index.ts", "export const value = 'deleted';");
      await run.compile();
      expect(fs.existsSync(output)).toBe(false);
    },
  );

  it.each(["build", "dev"] as const)(
    "retains old code, data, and manifest on invalid JSON in %s",
    async (mode) => {
      const run = compiler(mode);
      write("src/locales/orders/en.json", '{"ok":"saved"}');
      await run.compile();
      const code = fs.readFileSync(path.join(run.outDir, "index.js"));
      const manifest = fs.readFileSync(path.join(root, ARTIFACT_MANIFEST_FILE));
      write("src/index.ts", "export const value = 'new';");
      write("src/locales/orders/en.json", "{invalid}");
      await expect(run.compile()).rejects.toThrow("Invalid backend JSON");
      expect(fs.readFileSync(path.join(run.outDir, "index.js"))).toEqual(code);
      expect(
        fs.readFileSync(
          path.join(run.outDir, "locales/orders/en.json"),
          "utf8",
        ),
      ).toBe('{"ok":"saved"}');
      expect(fs.readFileSync(path.join(root, ARTIFACT_MANIFEST_FILE))).toEqual(
        manifest,
      );
    },
  );

  it("keeps all prior production outputs when a preload fails after backend compilation", async () => {
    const outDir = path.join(root, "dist");
    const build = new BuildCompiler({ rootDir: root, srcDir, outDir });
    write("preload/setup.ts", "export const setup = 1;");
    write("src/deleted.ts", "export const gone = 1;");
    expect((await build.build()).success).toBe(true);
    const original = fs.readFileSync(path.join(outDir, "index.js"));
    const preload = fs.readFileSync(path.join(outDir, "preload/setup.mjs"));
    write("src/index.ts", "export const value = 'new';");
    fs.rmSync(path.join(srcDir, "deleted.ts"));
    write("preload/setup.ts", "export const broken = ;");
    expect((await build.build()).success).toBe(false);
    expect(fs.readFileSync(path.join(outDir, "index.js"))).toEqual(original);
    expect(fs.readFileSync(path.join(outDir, "preload/setup.mjs"))).toEqual(
      preload,
    );
    expect(fs.existsSync(path.join(outDir, "deleted.js"))).toBe(true);
  });

  it("invalidates the dev cache when only an inherited compiler option changes", async () => {
    const outDir = path.join(root, ".vext/dev");
    write("tsconfig.json", '{"extends":"./base.json"}');
    write("base.json", '{"compilerOptions":{"useDefineForClassFields":false}}');
    write(
      "src/index.ts",
      "class Base { set value(v) { this.seen = v; } }; class Child extends Base { value = 'assigned'; } export const value = new Child().seen;",
    );
    dev = new DevCompiler({
      srcDir,
      outDir,
      tsconfig: path.join(root, "tsconfig.json"),
    });
    await dev.start();
    await dev.dispose();
    write("base.json", '{"compilerOptions":{"useDefineForClassFields":true }}');
    dev = new DevCompiler({
      srcDir,
      outDir,
      tsconfig: path.join(root, "tsconfig.json"),
    });
    expect((await dev.start()).cacheHit).toBe(false);
    const require = createRequire(path.join(root, "consumer.cjs"));
    expect(require(path.join(outDir, "index.js")).value).toBeUndefined();
  });
});
