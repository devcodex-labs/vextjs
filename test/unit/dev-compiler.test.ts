import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DevCompiler } from "../../src/lib/dev/compiler.js";
import {
  createBaseEsbuildConfig,
  getLoaderForExtension,
  LOADER_MAP,
  SOURCE_GLOB,
  SOURCE_IGNORE,
} from "../../src/lib/build/shared-esbuild-config.js";

// ── 测试辅助 ────────────────────────────────────────────────

/**
 * 创建临时项目目录结构
 *
 * 返回 projectRoot 路径，结构如下：
 *   <tmpDir>/
 *   ├── src/
 *   │   ├── routes/
 *   │   │   └── user.ts
 *   │   ├── services/
 *   │   │   └── auth.ts
 *   │   ├── config/
 *   │   │   └── default.ts
 *   │   └── index.ts
 *   ├── .vext/dev/          (outDir，由 DevCompiler 创建)
 *   └── tsconfig.json
 */
function createTempProject(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vext-test-compiler-"));

  const srcDir = path.join(tmpDir, "src");

  // 创建目录结构
  fs.mkdirSync(path.join(srcDir, "routes"), { recursive: true });
  fs.mkdirSync(path.join(srcDir, "services"), { recursive: true });
  fs.mkdirSync(path.join(srcDir, "config"), { recursive: true });

  // src/index.ts
  fs.writeFileSync(
    path.join(srcDir, "index.ts"),
    `export const version = "1.0.0";\n`,
  );

  // src/routes/user.ts（TypeScript + ESM export default）
  fs.writeFileSync(
    path.join(srcDir, "routes", "user.ts"),
    [
      'import { greeting } from "../services/auth.js";',
      "",
      "interface User {",
      "  id: number;",
      "  name: string;",
      "}",
      "",
      "export function getUser(id: number): User {",
      "  return { id, name: greeting() };",
      "}",
      "",
      "export default { getUser };",
      "",
    ].join("\n"),
  );

  // src/services/auth.ts
  fs.writeFileSync(
    path.join(srcDir, "services", "auth.ts"),
    [
      "export function greeting(): string {",
      '  return "hello";',
      "}",
      "",
      "export class AuthService {",
      "  validate(token: string): boolean {",
      "    return token.length > 0;",
      "  }",
      "}",
      "",
    ].join("\n"),
  );

  // src/config/default.ts
  fs.writeFileSync(
    path.join(srcDir, "config", "default.ts"),
    [
      "export default {",
      "  port: 3000,",
      '  host: "0.0.0.0",',
      "};",
      "",
    ].join("\n"),
  );

  // tsconfig.json
  fs.writeFileSync(
    path.join(tmpDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          outDir: "./dist",
          rootDir: "./src",
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
  );

  return tmpDir;
}

/**
 * 递归删除临时目录
 */
function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // 静默忽略清理错误（Windows 上偶尔文件被占用）
  }
}

// ── 测试套件 ────────────────────────────────────────────────

describe("shared-esbuild-config", () => {
  // ── LOADER_MAP ──────────────────────────────────────────

  describe("LOADER_MAP", () => {
    it("应包含所有 TypeScript 扩展名映射", () => {
      expect(LOADER_MAP[".ts"]).toBe("ts");
      expect(LOADER_MAP[".mts"]).toBe("ts");
      expect(LOADER_MAP[".cts"]).toBe("ts");
    });

    it("应包含所有 JavaScript 扩展名映射", () => {
      expect(LOADER_MAP[".js"]).toBe("js");
      expect(LOADER_MAP[".mjs"]).toBe("js");
      expect(LOADER_MAP[".cjs"]).toBe("js");
    });

    it("应包含 JSON 扩展名映射", () => {
      expect(LOADER_MAP[".json"]).toBe("json");
    });
  });

  // ── getLoaderForExtension ──────────────────────────────

  describe("getLoaderForExtension", () => {
    it("应返回 .ts 的 loader 为 ts", () => {
      expect(getLoaderForExtension(".ts")).toBe("ts");
    });

    it("应返回 .mjs 的 loader 为 js", () => {
      expect(getLoaderForExtension(".mjs")).toBe("js");
    });

    it("应返回 .cjs 的 loader 为 js", () => {
      expect(getLoaderForExtension(".cjs")).toBe("js");
    });

    it("应返回 .json 的 loader 为 json", () => {
      expect(getLoaderForExtension(".json")).toBe("json");
    });

    it("未知扩展名应返回 default", () => {
      expect(getLoaderForExtension(".xyz")).toBe("default");
      expect(getLoaderForExtension(".css")).toBe("default");
    });
  });

  // ── SOURCE_GLOB / SOURCE_IGNORE ────────────────────────

  describe("SOURCE_GLOB / SOURCE_IGNORE", () => {
    it("SOURCE_GLOB 应匹配 ts/js/mjs/cjs 文件", () => {
      expect(SOURCE_GLOB).toContain("ts");
      expect(SOURCE_GLOB).toContain("js");
      expect(SOURCE_GLOB).toContain("mjs");
      expect(SOURCE_GLOB).toContain("cjs");
    });

    it("SOURCE_IGNORE 应排除 .d.ts 文件", () => {
      expect(SOURCE_IGNORE).toContainEqual(expect.stringContaining("d.ts"));
    });

    it("SOURCE_IGNORE 应排除测试文件", () => {
      const hasTest = SOURCE_IGNORE.some(
        (p) => p.includes("test") || p.includes("spec"),
      );
      expect(hasTest).toBe(true);
    });
  });

  // ── createBaseEsbuildConfig ────────────────────────────

  describe("createBaseEsbuildConfig", () => {
    it("应返回 CJS 格式配置", () => {
      const config = createBaseEsbuildConfig();
      expect(config.format).toBe("cjs");
    });

    it("应设置 platform 为 node", () => {
      const config = createBaseEsbuildConfig();
      expect(config.platform).toBe("node");
    });

    it("应设置 target 为 node18", () => {
      const config = createBaseEsbuildConfig();
      expect(config.target).toBe("node18");
    });

    it("应禁用 bundle（逐文件编译）", () => {
      const config = createBaseEsbuildConfig();
      expect(config.bundle).toBe(false);
    });

    it("应启用 keepNames（保留函数名）", () => {
      const config = createBaseEsbuildConfig();
      expect(config.keepNames).toBe(true);
    });

    it("应启用 treeShaking", () => {
      const config = createBaseEsbuildConfig();
      expect(config.treeShaking).toBe(true);
    });

    it("应设置 charset 为 utf8", () => {
      const config = createBaseEsbuildConfig();
      expect(config.charset).toBe("utf8");
    });

    it("应包含 loader 映射", () => {
      const config = createBaseEsbuildConfig();
      expect(config.loader).toBeDefined();
      expect(config.loader![".ts"]).toBe("ts");
      expect(config.loader![".js"]).toBe("js");
    });

    it("应设置 logLevel 为 warning", () => {
      const config = createBaseEsbuildConfig();
      expect(config.logLevel).toBe("warning");
    });

    it("不传 tsconfig 时不应包含 tsconfig 字段", () => {
      const config = createBaseEsbuildConfig();
      expect(config).not.toHaveProperty("tsconfig");
    });

    it("传入 tsconfig 路径时应包含 tsconfig 字段", () => {
      const config = createBaseEsbuildConfig("/project/tsconfig.json");
      expect(config.tsconfig).toBe("/project/tsconfig.json");
    });
  });
});

// ── DevCompiler 测试 ────────────────────────────────────────

describe("DevCompiler", () => {
  let projectRoot: string;
  let srcDir: string;
  let outDir: string;
  let compiler: DevCompiler;

  beforeEach(() => {
    projectRoot = createTempProject();
    srcDir = path.join(projectRoot, "src");
    outDir = path.join(projectRoot, ".vext", "dev");
  });

  afterEach(async () => {
    if (compiler) {
      await compiler.dispose();
    }
    cleanupTempDir(projectRoot);
  });

  // ── 构造函数 ──────────────────────────────────────────

  describe("constructor", () => {
    it("应正确存储 srcDir 和 outDir", () => {
      compiler = new DevCompiler({ srcDir, outDir });
      expect(compiler.getSrcDir()).toBe(srcDir);
      expect(compiler.getOutDir()).toBe(outDir);
    });

    it("应正确计算 projectRoot（srcDir 的父目录）", () => {
      compiler = new DevCompiler({ srcDir, outDir });
      expect(compiler.getProjectRoot()).toBe(projectRoot);
    });
  });

  // ── start() — 首次全量编译 ────────────────────────────

  describe("start()", () => {
    it("应成功执行首次全量编译", async () => {
      compiler = new DevCompiler({
        srcDir,
        outDir,
        tsconfig: path.join(projectRoot, "tsconfig.json"),
      });

      const stats = await compiler.start();

      expect(stats.fileCount).toBeGreaterThan(0);
      expect(stats.elapsed).toBeGreaterThanOrEqual(0);
    });

    it("应编译所有源文件到 outDir", async () => {
      compiler = new DevCompiler({
        srcDir,
        outDir,
        tsconfig: path.join(projectRoot, "tsconfig.json"),
      });

      await compiler.start();

      // 检查编译产物是否存在
      expect(fs.existsSync(path.join(outDir, "index.js"))).toBe(true);
      expect(fs.existsSync(path.join(outDir, "routes", "user.js"))).toBe(true);
      expect(fs.existsSync(path.join(outDir, "services", "auth.js"))).toBe(
        true,
      );
      expect(fs.existsSync(path.join(outDir, "config", "default.js"))).toBe(
        true,
      );
    });

    it("应生成 source map 文件", async () => {
      compiler = new DevCompiler({
        srcDir,
        outDir,
        tsconfig: path.join(projectRoot, "tsconfig.json"),
      });

      await compiler.start();

      expect(fs.existsSync(path.join(outDir, "index.js.map"))).toBe(true);
      expect(fs.existsSync(path.join(outDir, "routes", "user.js.map"))).toBe(
        true,
      );
    });

    it("编译产物应为 CJS 格式（包含 module.exports 或 exports）", async () => {
      compiler = new DevCompiler({
        srcDir,
        outDir,
        tsconfig: path.join(projectRoot, "tsconfig.json"),
      });

      await compiler.start();

      const content = fs.readFileSync(
        path.join(outDir, "services", "auth.js"),
        "utf-8",
      );
      // CJS 输出应包含 exports 相关代码
      expect(
        content.includes("exports.") ||
          content.includes("module.exports") ||
          content.includes("Object.defineProperty(exports"),
      ).toBe(true);
    });

    it("编译产物中 TypeScript 类型注解应被移除", async () => {
      compiler = new DevCompiler({
        srcDir,
        outDir,
        tsconfig: path.join(projectRoot, "tsconfig.json"),
      });

      await compiler.start();

      const content = fs.readFileSync(
        path.join(outDir, "routes", "user.js"),
        "utf-8",
      );
      // TS interface 应被移除
      expect(content).not.toContain("interface User");
      // 类型注解应被移除
      expect(content).not.toContain(": number");
      expect(content).not.toContain(": User");
    });

    it("应排除 .d.ts 声明文件", async () => {
      // 创建一个 .d.ts 文件
      fs.writeFileSync(
        path.join(srcDir, "types.d.ts"),
        "export interface Foo { bar: string; }\n",
      );

      compiler = new DevCompiler({
        srcDir,
        outDir,
        tsconfig: path.join(projectRoot, "tsconfig.json"),
      });

      await compiler.start();

      // .d.ts 不应被编译
      expect(fs.existsSync(path.join(outDir, "types.js"))).toBe(false);
    });

    it("应排除测试文件", async () => {
      // 创建测试文件
      fs.writeFileSync(
        path.join(srcDir, "routes", "user.test.ts"),
        'import { getUser } from "./user.js";\n',
      );
      fs.writeFileSync(
        path.join(srcDir, "services", "auth.spec.ts"),
        'import { AuthService } from "./auth.js";\n',
      );

      compiler = new DevCompiler({
        srcDir,
        outDir,
        tsconfig: path.join(projectRoot, "tsconfig.json"),
      });

      await compiler.start();

      // 测试文件不应被编译
      expect(fs.existsSync(path.join(outDir, "routes", "user.test.js"))).toBe(
        false,
      );
      expect(
        fs.existsSync(path.join(outDir, "services", "auth.spec.js")),
      ).toBe(false);
    });

    it("应返回正确的文件数量", async () => {
      compiler = new DevCompiler({
        srcDir,
        outDir,
        tsconfig: path.join(projectRoot, "tsconfig.json"),
      });

      const stats = await compiler.start();

      // 4 个源文件：index.ts, routes/user.ts, services/auth.ts, config/default.ts
      expect(stats.fileCount).toBe(4);
    });

    it("应清空已有的 outDir（确保干净状态）", async () => {
      // 预先在 outDir 创建一个残留文件
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, "stale.js"), "// stale file\n");

      compiler = new DevCompiler({
        srcDir,
        outDir,
        tsconfig: path.join(projectRoot, "tsconfig.json"),
      });

      await compiler.start();

      // 残留文件应被清除
      expect(fs.existsSync(path.join(outDir, "stale.js"))).toBe(false);
      // 正常编译产物应存在
      expect(fs.existsSync(path.join(outDir, "index.js"))).toBe(true);
    });

    it("不传 tsconfig 时也应能正常编译", async () => {
      compiler = new DevCompiler({ srcDir, outDir });

      const stats = await compiler.start();

      expect(stats.fileCount).toBe(4);
      expect(fs.existsSync(path.join(outDir, "index.js"))).toBe(true);
    });
  });

  // ── compileSingle() — 单文件编译（Tier 1）─────────────

  describe("compileSingle()", () => {
    beforeEach(async () => {
      compiler = new DevCompiler({
        srcDir,
        outDir,
        tsconfig: path.join(projectRoot, "tsconfig.json"),
      });
      await compiler.start();
    });

    it("应编译单个变更文件并返回输出路径", async () => {
      // 修改源文件
      fs.writeFileSync(
        path.join(srcDir, "services", "auth.ts"),
        [
          "export function greeting(): string {",
          '  return "hello world";', // 修改返回值
          "}",
          "",
          "export class AuthService {",
          "  validate(token: string): boolean {",
          "    return token.length > 0;",
          "  }",
          "}",
          "",
        ].join("\n"),
      );

      const outFile = await compiler.compileSingle(
        path.join(srcDir, "services", "auth.ts"),
      );

      expect(outFile).toBe(path.join(outDir, "services", "auth.js"));
      expect(fs.existsSync(outFile)).toBe(true);

      const content = fs.readFileSync(outFile, "utf-8");
      expect(content).toContain("hello world");
    });

    it("应生成对应的 source map 文件", async () => {
      const outFile = await compiler.compileSingle(
        path.join(srcDir, "index.ts"),
      );

      expect(fs.existsSync(outFile + ".map")).toBe(true);
    });

    it("应正确处理 .ts 文件的类型移除", async () => {
      const outFile = await compiler.compileSingle(
        path.join(srcDir, "routes", "user.ts"),
      );

      const content = fs.readFileSync(outFile, "utf-8");
      expect(content).not.toContain("interface");
      expect(content).not.toContain(": number");
    });

    it("应为新增的子目录自动创建目录结构", async () => {
      // 创建一个深层嵌套的新文件
      const deepDir = path.join(srcDir, "services", "payment");
      fs.mkdirSync(deepDir, { recursive: true });
      fs.writeFileSync(
        path.join(deepDir, "stripe.ts"),
        'export const provider = "stripe";\n',
      );

      const outFile = await compiler.compileSingle(
        path.join(deepDir, "stripe.ts"),
      );

      expect(outFile).toBe(
        path.join(outDir, "services", "payment", "stripe.js"),
      );
      expect(fs.existsSync(outFile)).toBe(true);
    });
  });

  // ── compileFiles() — 批量编译 ──────────────────────────

  describe("compileFiles()", () => {
    beforeEach(async () => {
      compiler = new DevCompiler({
        srcDir,
        outDir,
        tsconfig: path.join(projectRoot, "tsconfig.json"),
      });
      await compiler.start();
    });

    it("应并行编译多个文件", async () => {
      // 修改两个文件
      fs.writeFileSync(
        path.join(srcDir, "index.ts"),
        'export const version = "2.0.0";\n',
      );
      fs.writeFileSync(
        path.join(srcDir, "services", "auth.ts"),
        'export function greeting(): string { return "updated"; }\n',
      );

      const outFiles = await compiler.compileFiles([
        path.join(srcDir, "index.ts"),
        path.join(srcDir, "services", "auth.ts"),
      ]);

      expect(outFiles).toHaveLength(2);
      expect(outFiles[0]).toBe(path.join(outDir, "index.js"));
      expect(outFiles[1]).toBe(path.join(outDir, "services", "auth.js"));

      // 验证内容已更新
      const indexContent = fs.readFileSync(outFiles[0]!, "utf-8");
      expect(indexContent).toContain("2.0.0");
    });

    it("空数组应返回空结果", async () => {
      const outFiles = await compiler.compileFiles([]);
      expect(outFiles).toHaveLength(0);
    });
  });

  // ── rebuildWithNewEntryPoints() — 结构变更重编译（Tier 2）

  describe("rebuildWithNewEntryPoints()", () => {
    beforeEach(async () => {
      compiler = new DevCompiler({
        srcDir,
        outDir,
        tsconfig: path.join(projectRoot, "tsconfig.json"),
      });
      await compiler.start();
    });

    it("应在文件新增后重新扫描并编译", async () => {
      // 新增一个文件
      fs.writeFileSync(
        path.join(srcDir, "routes", "post.ts"),
        'export function listPosts() { return []; }\n',
      );

      const stats = await compiler.rebuildWithNewEntryPoints();

      // 应包含新增的文件
      expect(stats.fileCount).toBe(5); // 4 + 1
      expect(fs.existsSync(path.join(outDir, "routes", "post.js"))).toBe(true);
    });

    it("应在文件删除后重新扫描（不再编译已删除文件）", async () => {
      // 先确认文件存在
      expect(fs.existsSync(path.join(outDir, "config", "default.js"))).toBe(
        true,
      );

      // 删除源文件
      fs.unlinkSync(path.join(srcDir, "config", "default.ts"));

      const stats = await compiler.rebuildWithNewEntryPoints();

      // 文件数应减少
      expect(stats.fileCount).toBe(3); // 4 - 1
    });

    it("应返回编译统计信息", async () => {
      const stats = await compiler.rebuildWithNewEntryPoints();

      expect(stats.fileCount).toBeGreaterThan(0);
      expect(stats.elapsed).toBeGreaterThanOrEqual(0);
    });
  });

  // ── rebuild() — 增量重编译 ────────────────────────────

  describe("rebuild()", () => {
    it("未调用 start() 时应抛出错误", async () => {
      compiler = new DevCompiler({ srcDir, outDir });

      await expect(compiler.rebuild()).rejects.toThrow(
        "[DevCompiler] not started",
      );
    });

    it("start() 后应能正常 rebuild", async () => {
      compiler = new DevCompiler({
        srcDir,
        outDir,
        tsconfig: path.join(projectRoot, "tsconfig.json"),
      });
      await compiler.start();

      // 修改源文件
      fs.writeFileSync(
        path.join(srcDir, "index.ts"),
        'export const version = "3.0.0";\n',
      );

      // rebuild 应不抛出错误
      await expect(compiler.rebuild()).resolves.not.toThrow();

      // 编译产物应更新
      const content = fs.readFileSync(path.join(outDir, "index.js"), "utf-8");
      expect(content).toContain("3.0.0");
    });
  });

  // ── resolveCompiled() — 路径映射 ──────────────────────

  describe("resolveCompiled()", () => {
    beforeEach(() => {
      compiler = new DevCompiler({ srcDir, outDir });
    });

    it("应将 .ts 绝对路径映射为 .js 编译产物路径", () => {
      const result = compiler.resolveCompiled(
        path.join(srcDir, "routes", "user.ts"),
      );
      expect(result).toBe(path.join(outDir, "routes", "user.js"));
    });

    it("应将 .mjs 绝对路径映射为 .js", () => {
      const result = compiler.resolveCompiled(
        path.join(srcDir, "utils", "helper.mjs"),
      );
      expect(result).toBe(path.join(outDir, "utils", "helper.js"));
    });

    it("应将 .cjs 绝对路径映射为 .js", () => {
      const result = compiler.resolveCompiled(
        path.join(srcDir, "utils", "legacy.cjs"),
      );
      expect(result).toBe(path.join(outDir, "utils", "legacy.js"));
    });

    it("应将 .mts 绝对路径映射为 .js", () => {
      const result = compiler.resolveCompiled(
        path.join(srcDir, "utils", "esm.mts"),
      );
      expect(result).toBe(path.join(outDir, "utils", "esm.js"));
    });

    it("应将 .cts 绝对路径映射为 .js", () => {
      const result = compiler.resolveCompiled(
        path.join(srcDir, "utils", "cts-file.cts"),
      );
      expect(result).toBe(path.join(outDir, "utils", "cts-file.js"));
    });

    it(".js 文件应保持 .js 扩展名", () => {
      const result = compiler.resolveCompiled(
        path.join(srcDir, "utils", "plain.js"),
      );
      expect(result).toBe(path.join(outDir, "utils", "plain.js"));
    });

    it("应支持相对于项目根目录的路径", () => {
      const result = compiler.resolveCompiled("src/routes/user.ts");
      expect(result).toBe(path.join(outDir, "routes", "user.js"));
    });

    it("应保持目录层级结构", () => {
      const result = compiler.resolveCompiled(
        path.join(srcDir, "services", "payment", "stripe.ts"),
      );
      expect(result).toBe(
        path.join(outDir, "services", "payment", "stripe.js"),
      );
    });
  });

  // ── resolveSource() — 反向路径映射 ────────────────────

  describe("resolveSource()", () => {
    beforeEach(() => {
      compiler = new DevCompiler({ srcDir, outDir });
    });

    it("应将编译产物路径映射回源文件路径", () => {
      const result = compiler.resolveSource(
        path.join(outDir, "routes", "user.js"),
      );
      expect(result).toBe(path.join(srcDir, "routes", "user.js"));
    });

    it("应保持目录层级结构", () => {
      const result = compiler.resolveSource(
        path.join(outDir, "services", "payment", "stripe.js"),
      );
      expect(result).toBe(
        path.join(srcDir, "services", "payment", "stripe.js"),
      );
    });
  });

  // ── getter 方法 ───────────────────────────────────────

  describe("getter 方法", () => {
    beforeEach(() => {
      compiler = new DevCompiler({ srcDir, outDir });
    });

    it("getSrcDir() 应返回源码目录", () => {
      expect(compiler.getSrcDir()).toBe(srcDir);
    });

    it("getOutDir() 应返回编译输出目录", () => {
      expect(compiler.getOutDir()).toBe(outDir);
    });

    it("getProjectRoot() 应返回 srcDir 的父目录", () => {
      expect(compiler.getProjectRoot()).toBe(projectRoot);
    });
  });

  // ── dispose() — 资源释放 ──────────────────────────────

  describe("dispose()", () => {
    it("start() 后 dispose() 应正常释放资源", async () => {
      compiler = new DevCompiler({
        srcDir,
        outDir,
        tsconfig: path.join(projectRoot, "tsconfig.json"),
      });
      await compiler.start();

      // dispose 不应抛出
      await expect(compiler.dispose()).resolves.not.toThrow();
    });

    it("未 start() 时 dispose() 应静默成功（不抛出）", async () => {
      compiler = new DevCompiler({ srcDir, outDir });

      await expect(compiler.dispose()).resolves.not.toThrow();
    });

    it("多次 dispose() 应是幂等的", async () => {
      compiler = new DevCompiler({
        srcDir,
        outDir,
        tsconfig: path.join(projectRoot, "tsconfig.json"),
      });
      await compiler.start();

      await compiler.dispose();
      await expect(compiler.dispose()).resolves.not.toThrow();
    });
  });

  // ── tsconfig extends 展平 ─────────────────────────────

  describe("tsconfig extends 展平", () => {
    it("应正确处理 tsconfig 的 extends 链", async () => {
      // 创建 base tsconfig
      fs.writeFileSync(
        path.join(projectRoot, "tsconfig.base.json"),
        JSON.stringify({
          compilerOptions: {
            target: "ES2020",
            strict: true,
            esModuleInterop: true,
          },
        }),
      );

      // 创建主 tsconfig（extends base）
      fs.writeFileSync(
        path.join(projectRoot, "tsconfig.json"),
        JSON.stringify({
          extends: "./tsconfig.base.json",
          compilerOptions: {
            target: "ES2022", // 覆盖 base 的 target
            outDir: "./dist",
            rootDir: "./src",
          },
          include: ["src/**/*.ts"],
        }),
      );

      compiler = new DevCompiler({
        srcDir,
        outDir,
        tsconfig: path.join(projectRoot, "tsconfig.json"),
      });

      // start 内部会调用 resolveTsconfig 展平 extends 链
      const stats = await compiler.start();

      expect(stats.fileCount).toBeGreaterThan(0);
      // 编译应成功（如果 extends 解析失败，esbuild.transform 可能行为不一致）
      expect(fs.existsSync(path.join(outDir, "index.js"))).toBe(true);
    });

    it("不存在的 tsconfig 应静默降级（不抛出）", async () => {
      compiler = new DevCompiler({
        srcDir,
        outDir,
        tsconfig: path.join(projectRoot, "nonexistent.json"),
      });

      // 应正常编译（使用 esbuild 默认设置）
      const stats = await compiler.start();

      expect(stats.fileCount).toBe(4);
      expect(fs.existsSync(path.join(outDir, "index.js"))).toBe(true);
    });
  });

  // ── .mjs / .cjs 源文件编译 ────────────────────────────

  describe(".mjs / .cjs 源文件编译", () => {
    it("应正确编译 .mjs 文件", async () => {
      fs.writeFileSync(
        path.join(srcDir, "utils.mjs"),
        'export const name = "mjs-module";\n',
      );

      compiler = new DevCompiler({
        srcDir,
        outDir,
        tsconfig: path.join(projectRoot, "tsconfig.json"),
      });
      await compiler.start();

      // .mjs → .js
      expect(fs.existsSync(path.join(outDir, "utils.js"))).toBe(true);
      const content = fs.readFileSync(path.join(outDir, "utils.js"), "utf-8");
      expect(content).toContain("mjs-module");
    });

    it("应正确编译 .cjs 文件", async () => {
      fs.writeFileSync(
        path.join(srcDir, "legacy.cjs"),
        'const x = "cjs-module"; module.exports = { x };\n',
      );

      compiler = new DevCompiler({
        srcDir,
        outDir,
        tsconfig: path.join(projectRoot, "tsconfig.json"),
      });
      await compiler.start();

      // .cjs → .js
      expect(fs.existsSync(path.join(outDir, "legacy.js"))).toBe(true);
      const content = fs.readFileSync(path.join(outDir, "legacy.js"), "utf-8");
      expect(content).toContain("cjs-module");
    });
  });

  // ── 编译错误处理 ──────────────────────────────────────

  describe("编译错误处理", () => {
    it("compileSingle() 文件不存在时应抛出错误", async () => {
      compiler = new DevCompiler({
        srcDir,
        outDir,
        tsconfig: path.join(projectRoot, "tsconfig.json"),
      });
      await compiler.start();

      await expect(
        compiler.compileSingle(path.join(srcDir, "nonexistent.ts")),
      ).rejects.toThrow();
    });
  });

  // ── 端到端场景：模拟开发工作流 ────────────────────────

  describe("端到端：模拟开发工作流", () => {
    it("应支持 start → modify → compileSingle → add → rebuildWithNewEntryPoints 完整流程", async () => {
      compiler = new DevCompiler({
        srcDir,
        outDir,
        tsconfig: path.join(projectRoot, "tsconfig.json"),
      });

      // 1. 首次全量编译
      const startStats = await compiler.start();
      expect(startStats.fileCount).toBe(4);
      expect(fs.existsSync(path.join(outDir, "routes", "user.js"))).toBe(true);

      // 2. 模拟代码修改 → Tier 1 单文件编译
      fs.writeFileSync(
        path.join(srcDir, "services", "auth.ts"),
        [
          "export function greeting(): string {",
          '  return "hello modified";',
          "}",
          "",
        ].join("\n"),
      );

      const compiledFile = await compiler.compileSingle(
        path.join(srcDir, "services", "auth.ts"),
      );
      const modifiedContent = fs.readFileSync(compiledFile, "utf-8");
      expect(modifiedContent).toContain("hello modified");

      // 3. 模拟新增文件 → Tier 2 重编译
      fs.writeFileSync(
        path.join(srcDir, "routes", "post.ts"),
        'export function getPosts() { return ["a", "b"]; }\n',
      );

      const rebuildStats = await compiler.rebuildWithNewEntryPoints();
      expect(rebuildStats.fileCount).toBe(5); // +1
      expect(fs.existsSync(path.join(outDir, "routes", "post.js"))).toBe(true);

      // 4. 之前的编译产物应仍然存在
      expect(fs.existsSync(path.join(outDir, "index.js"))).toBe(true);
      expect(fs.existsSync(path.join(outDir, "routes", "user.js"))).toBe(true);

      // 5. 清理
      await compiler.dispose();
    });
  });
});
