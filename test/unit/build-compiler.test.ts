import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  BuildCompiler,
  type BuildCompilerOptions,
  type BuildResult,
} from "../../src/lib/build/build-compiler.js";
import { parseBuildArgs } from "../../src/cli/build.js";

// Coverage instrumentation on Windows can make real esbuild invocations exceed
// the global 10s limit even when the compiler behavior is correct.
vi.setConfig({ testTimeout: 30_000 });

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
 *   │   │   ├── default.ts
 *   │   │   ├── production.ts
 *   │   │   ├── development.ts
 *   │   │   ├── local.ts
 *   │   │   └── test.ts
 *   │   ├── middlewares/
 *   │   │   └── logger.ts
 *   │   ├── plugins/
 *   │   │   └── db.ts
 *   │   ├── utils/
 *   │   │   └── hash.ts
 *   │   ├── types/
 *   │   │   └── app.d.ts
 *   │   └── index.ts
 *   ├── dist/                (outDir，由 BuildCompiler 创建)
 *   └── tsconfig.json
 */
function createTempProject(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vext-test-build-"));

  const srcDir = path.join(tmpDir, "src");

  // 创建目录结构
  fs.mkdirSync(path.join(srcDir, "routes"), { recursive: true });
  fs.mkdirSync(path.join(srcDir, "services"), { recursive: true });
  fs.mkdirSync(path.join(srcDir, "config"), { recursive: true });
  fs.mkdirSync(path.join(srcDir, "middlewares"), { recursive: true });
  fs.mkdirSync(path.join(srcDir, "plugins"), { recursive: true });
  fs.mkdirSync(path.join(srcDir, "utils"), { recursive: true });
  fs.mkdirSync(path.join(srcDir, "types"), { recursive: true });

  // src/index.ts
  fs.writeFileSync(
    path.join(srcDir, "index.ts"),
    `export const version = "1.0.0";\n`,
  );

  // src/routes/user.ts
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
    ["export default {", "  port: 3000,", '  host: "0.0.0.0",', "};", ""].join(
      "\n",
    ),
  );

  // src/config/production.ts（应被编译）
  fs.writeFileSync(
    path.join(srcDir, "config", "production.ts"),
    ["export default {", "  port: 8080,", "};", ""].join("\n"),
  );

  // src/config/development.ts（应被排除）
  fs.writeFileSync(
    path.join(srcDir, "config", "development.ts"),
    ["export default {", "  debug: true,", "};", ""].join("\n"),
  );

  // src/config/local.ts（应被排除）
  fs.writeFileSync(
    path.join(srcDir, "config", "local.ts"),
    ["export default {", '  secret: "local-only",', "};", ""].join("\n"),
  );

  // src/config/test.ts（应被排除）
  fs.writeFileSync(
    path.join(srcDir, "config", "test.ts"),
    ["export default {", "  port: 0,", "};", ""].join("\n"),
  );

  // src/middlewares/logger.ts
  fs.writeFileSync(
    path.join(srcDir, "middlewares", "logger.ts"),
    [
      "export function loggerMiddleware() {",
      '  console.log("request");',
      "}",
      "",
    ].join("\n"),
  );

  // src/plugins/db.ts
  fs.writeFileSync(
    path.join(srcDir, "plugins", "db.ts"),
    ["export function setup() {", '  console.log("db plugin");', "}", ""].join(
      "\n",
    ),
  );

  // src/utils/hash.ts
  fs.writeFileSync(
    path.join(srcDir, "utils", "hash.ts"),
    [
      "export function hash(input: string): string {",
      '  return input.split("").reverse().join("");',
      "}",
      "",
    ].join("\n"),
  );

  // src/types/app.d.ts（纯类型声明，应被排除）
  fs.writeFileSync(
    path.join(srcDir, "types", "app.d.ts"),
    [
      "export interface AppConfig {",
      "  port: number;",
      "  host: string;",
      "}",
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
          module: "ESNext",
          moduleResolution: "bundler",
          strict: true,
          esModuleInterop: true,
          outDir: "./dist",
          rootDir: "./src",
          declaration: true,
          skipLibCheck: true,
        },
        include: ["src/**/*"],
      },
      null,
      2,
    ),
  );

  return tmpDir;
}

/**
 * 清理临时目录
 */
function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // 静默忽略清理失败（Windows 可能文件锁定）
  }
}

/**
 * 创建 BuildCompiler 实例的快捷方法
 */
function createCompiler(
  projectRoot: string,
  overrides?: Partial<BuildCompilerOptions>,
): BuildCompiler {
  return new BuildCompiler({
    rootDir: projectRoot,
    srcDir: path.join(projectRoot, "src"),
    outDir: path.join(projectRoot, "dist"),
    ...overrides,
  });
}

// ── 测试 ────────────────────────────────────────────────────

describe("BuildCompiler", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = createTempProject();
  });

  afterEach(() => {
    cleanupTempDir(projectRoot);
  });

  // ── 基础编译 ──────────────────────────────────────────────

  describe("基础编译", () => {
    it("应成功编译 TypeScript 源文件到 dist/", async () => {
      const compiler = createCompiler(projectRoot);
      const result = await compiler.build();

      expect(result.success).toBe(true);
      expect(result.fileCount).toBeGreaterThan(0);
      expect(result.elapsed).toBeGreaterThanOrEqual(0);
      expect(result.errors).toHaveLength(0);
    });

    it("应保持目录结构映射（src/routes/user.ts → dist/routes/user.js）", async () => {
      const compiler = createCompiler(projectRoot);
      await compiler.build();

      const distDir = path.join(projectRoot, "dist");

      // 验证核心文件生成
      expect(fs.existsSync(path.join(distDir, "index.js"))).toBe(true);
      expect(fs.existsSync(path.join(distDir, "routes", "user.js"))).toBe(true);
      expect(fs.existsSync(path.join(distDir, "services", "auth.js"))).toBe(
        true,
      );
      expect(fs.existsSync(path.join(distDir, "config", "default.js"))).toBe(
        true,
      );
      expect(
        fs.existsSync(path.join(distDir, "middlewares", "logger.js")),
      ).toBe(true);
      expect(fs.existsSync(path.join(distDir, "plugins", "db.js"))).toBe(true);
      expect(fs.existsSync(path.join(distDir, "utils", "hash.js"))).toBe(true);
    });

    it("编译产物应为 CJS 格式（包含 exports.xxx 或 module.exports）", async () => {
      const compiler = createCompiler(projectRoot);
      await compiler.build();

      const content = fs.readFileSync(
        path.join(projectRoot, "dist", "services", "auth.js"),
        "utf-8",
      );

      // esbuild CJS 输出特征：使用 __commonJS / module.exports / exports
      // 或使用 Object.defineProperty(exports, ...)
      expect(
        content.includes("exports") || content.includes("module.exports"),
      ).toBe(true);

      // 不应包含 ESM 关键字（import/export default 等被转为 CJS）
      expect(content).not.toMatch(/^export\s+/m);
      expect(content).not.toMatch(/^import\s+/m);
    });

    it("应输出正确的编译结果统计", async () => {
      const compiler = createCompiler(projectRoot);
      const result = await compiler.build();

      // 8 个源文件：index + routes/user + services/auth + config/default + config/production
      // + middlewares/logger + plugins/db + utils/hash
      // 排除：config/development + config/local + config/test + types/app.d.ts
      expect(result.totalFiles).toBe(8);
      expect(result.fileCount).toBe(8);
      expect(result.outDir).toBe(path.join(projectRoot, "dist"));
      expect(result.metafile).toBeDefined();
    });

    it("应生成 metafile 元信息", async () => {
      const compiler = createCompiler(projectRoot);
      const result = await compiler.build();

      expect(result.metafile).toBeDefined();
      expect(result.metafile!.outputs).toBeDefined();
      expect(Object.keys(result.metafile!.outputs).length).toBeGreaterThan(0);
    });

    it("应在 dist/ 写入 package.json 声明 commonjs 类型", async () => {
      const compiler = createCompiler(projectRoot);
      const result = await compiler.build();

      expect(result.success).toBe(true);

      const distPkgPath = path.join(compiler.getOutDir(), "package.json");
      expect(fs.existsSync(distPkgPath)).toBe(true);

      const content = fs.readFileSync(distPkgPath, "utf8");
      const parsed = JSON.parse(content);
      expect(parsed.type).toBe("commonjs");
    });

    it("dist/package.json 应只包含 type 字段（最小化）", async () => {
      const compiler = createCompiler(projectRoot);
      await compiler.build();

      const distPkgPath = path.join(compiler.getOutDir(), "package.json");
      const parsed = JSON.parse(fs.readFileSync(distPkgPath, "utf8"));
      expect(Object.keys(parsed)).toEqual(["type"]);
    });

    it("多次编译后 dist/package.json 仍为 commonjs", async () => {
      const compiler = createCompiler(projectRoot);
      await compiler.build();
      await compiler.build();

      const distPkgPath = path.join(compiler.getOutDir(), "package.json");
      const parsed = JSON.parse(fs.readFileSync(distPkgPath, "utf8"));
      expect(parsed.type).toBe("commonjs");
    });
  });

  // ── Source Map ─────────────────────────────────────────────

  describe("Source Map", () => {
    it("默认应生成外部 .js.map 文件", async () => {
      const compiler = createCompiler(projectRoot);
      await compiler.build();

      const distDir = path.join(projectRoot, "dist");

      expect(fs.existsSync(path.join(distDir, "index.js.map"))).toBe(true);
      expect(fs.existsSync(path.join(distDir, "routes", "user.js.map"))).toBe(
        true,
      );
      expect(fs.existsSync(path.join(distDir, "services", "auth.js.map"))).toBe(
        true,
      );
    });

    it("sourcemap: true 应生成 .js.map 文件", async () => {
      const compiler = createCompiler(projectRoot, { sourcemap: true });
      await compiler.build();

      expect(
        fs.existsSync(path.join(projectRoot, "dist", "index.js.map")),
      ).toBe(true);
    });

    it("应将 src/preload/ 自动编译并写入 dist/preload/", async () => {
      fs.mkdirSync(path.join(projectRoot, "src", "preload"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(projectRoot, "src", "preload", "01-env.ts"),
        "process.env.APP_PORT = '3011';\n",
      );
      fs.writeFileSync(
        path.join(projectRoot, "src", "preload", "02-hook.mjs"),
        "export const ready = true;\n",
      );

      const compiler = createCompiler(projectRoot);
      await compiler.build();

      expect(
        fs.existsSync(path.join(projectRoot, "dist", "preload", "01-env.mjs")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(projectRoot, "dist", "preload", "02-hook.mjs")),
      ).toBe(true);
      expect(
        fs.readFileSync(
          path.join(projectRoot, "dist", "preload", "01-env.mjs"),
          "utf-8",
        ),
      ).toContain("APP_PORT");
    });

    it("sourcemap: false 应不生成 .js.map 文件", async () => {
      const compiler = createCompiler(projectRoot, { sourcemap: false });
      await compiler.build();

      const distDir = path.join(projectRoot, "dist");
      const mapFiles = findFiles(distDir, ".js.map");
      expect(mapFiles).toHaveLength(0);
    });

    it("sourcemap 启用时应生成对应的 .js.map 文件且内容为合法 JSON", async () => {
      const compiler = createCompiler(projectRoot, { sourcemap: true });
      await compiler.build();

      const mapPath = path.join(projectRoot, "dist", "index.js.map");
      expect(fs.existsSync(mapPath)).toBe(true);

      // .js.map 应为合法 JSON 且包含 sources/mappings 字段
      const mapContent = JSON.parse(fs.readFileSync(mapPath, "utf-8"));
      expect(mapContent).toHaveProperty("version", 3);
      expect(mapContent).toHaveProperty("sources");
      expect(mapContent).toHaveProperty("mappings");
    });

    it("sourcemap 禁用时不应生成任何 .js.map 文件", async () => {
      const compiler = createCompiler(projectRoot, { sourcemap: false });
      await compiler.build();

      const distDir = path.join(projectRoot, "dist");
      const mapFiles = findFiles(distDir, ".js.map");
      expect(mapFiles).toHaveLength(0);

      // JS 文件也不应包含 sourceMappingURL 注释
      const content = fs.readFileSync(path.join(distDir, "index.js"), "utf-8");
      expect(content).not.toContain("sourceMappingURL");
    });
  });

  // ── Minify ────────────────────────────────────────────────

  describe("代码压缩", () => {
    it("minify: false（默认）应保留可读格式", async () => {
      const compiler = createCompiler(projectRoot, { minify: false });
      await compiler.build();

      const content = fs.readFileSync(
        path.join(projectRoot, "dist", "services", "auth.js"),
        "utf-8",
      );

      // 未压缩的代码应包含换行和缩进
      expect(content.split("\n").length).toBeGreaterThan(3);
    });

    it("minify: true 应生成更紧凑的代码", async () => {
      // 先编译未压缩版本
      const compilerNormal = createCompiler(projectRoot, {
        minify: false,
        sourcemap: false,
      });
      const resultNormal = await compilerNormal.build();
      const normalContent = fs.readFileSync(
        path.join(projectRoot, "dist", "services", "auth.js"),
        "utf-8",
      );

      // 清理 dist
      fs.rmSync(path.join(projectRoot, "dist"), {
        recursive: true,
        force: true,
      });

      // 编译压缩版本
      const compilerMinify = createCompiler(projectRoot, {
        minify: true,
        sourcemap: false,
      });
      const resultMinify = await compilerMinify.build();
      const minifiedContent = fs.readFileSync(
        path.join(projectRoot, "dist", "services", "auth.js"),
        "utf-8",
      );

      expect(resultNormal.success).toBe(true);
      expect(resultMinify.success).toBe(true);

      // 压缩后的文件应该更小
      expect(minifiedContent.length).toBeLessThan(normalContent.length);
    });
  });

  // ── 排除规则 ──────────────────────────────────────────────

  describe("排除规则", () => {
    it("应排除 .d.ts 声明文件", async () => {
      const compiler = createCompiler(projectRoot);
      await compiler.build();

      // types/app.d.ts 不应生成对应的 .js
      expect(
        fs.existsSync(path.join(projectRoot, "dist", "types", "app.js")),
      ).toBe(false);
    });

    it("应排除 config/development.ts", async () => {
      const compiler = createCompiler(projectRoot);
      await compiler.build();

      expect(
        fs.existsSync(
          path.join(projectRoot, "dist", "config", "development.js"),
        ),
      ).toBe(false);
    });

    it("应排除 config/local.ts", async () => {
      const compiler = createCompiler(projectRoot);
      await compiler.build();

      expect(
        fs.existsSync(path.join(projectRoot, "dist", "config", "local.js")),
      ).toBe(false);
    });

    it("应排除 config/test.ts", async () => {
      const compiler = createCompiler(projectRoot);
      await compiler.build();

      expect(
        fs.existsSync(path.join(projectRoot, "dist", "config", "test.js")),
      ).toBe(false);
    });

    it("应编译 config/default.ts（基准配置）", async () => {
      const compiler = createCompiler(projectRoot);
      await compiler.build();

      expect(
        fs.existsSync(path.join(projectRoot, "dist", "config", "default.js")),
      ).toBe(true);
    });

    it("应编译 config/production.ts（生产覆盖配置）", async () => {
      const compiler = createCompiler(projectRoot);
      await compiler.build();

      expect(
        fs.existsSync(
          path.join(projectRoot, "dist", "config", "production.js"),
        ),
      ).toBe(true);
    });

    it("应排除测试文件（*.test.ts）", async () => {
      // 创建测试文件
      fs.writeFileSync(
        path.join(projectRoot, "src", "utils", "hash.test.ts"),
        'import { hash } from "./hash.js";\nconsole.log(hash("test"));\n',
      );

      const compiler = createCompiler(projectRoot);
      await compiler.build();

      expect(
        fs.existsSync(path.join(projectRoot, "dist", "utils", "hash.test.js")),
      ).toBe(false);
    });

    it("应排除 spec 测试文件（*.spec.ts）", async () => {
      fs.writeFileSync(
        path.join(projectRoot, "src", "utils", "hash.spec.ts"),
        'import { hash } from "./hash.js";\nconsole.log(hash("spec"));\n',
      );

      const compiler = createCompiler(projectRoot);
      await compiler.build();

      expect(
        fs.existsSync(path.join(projectRoot, "dist", "utils", "hash.spec.js")),
      ).toBe(false);
    });

    it("应排除 __tests__ 目录", async () => {
      const testsDir = path.join(projectRoot, "src", "__tests__");
      fs.mkdirSync(testsDir, { recursive: true });
      fs.writeFileSync(
        path.join(testsDir, "integration.ts"),
        'console.log("test");\n',
      );

      const compiler = createCompiler(projectRoot);
      await compiler.build();

      expect(
        fs.existsSync(
          path.join(projectRoot, "dist", "__tests__", "integration.js"),
        ),
      ).toBe(false);
    });
  });

  // ── scanEntryPoints ───────────────────────────────────────

  describe("scanEntryPoints", () => {
    it("应返回所有可编译源文件（排除后）", async () => {
      const compiler = createCompiler(projectRoot);
      const entries = await compiler.scanEntryPoints();

      // 排序后比较，避免顺序依赖
      const sorted = entries.sort();

      // 期望 8 个文件：index + routes/user + services/auth + config/default
      //   + config/production + middlewares/logger + plugins/db + utils/hash
      expect(sorted).toHaveLength(8);

      // 验证包含预期文件
      expect(sorted).toContain("index.ts");
      expect(sorted.find((f) => f.includes("routes"))).toBeDefined();
      expect(sorted.find((f) => f.includes("services"))).toBeDefined();

      // 验证排除了 dev/local/test 配置和 .d.ts
      expect(sorted.find((f) => f.includes("development"))).toBeUndefined();
      expect(sorted.find((f) => f.includes("local"))).toBeUndefined();
      expect(sorted.find((f) => f.includes("app.d.ts"))).toBeUndefined();
    });

    it("应支持 JavaScript 源文件（.js）", async () => {
      // 添加一个 .js 文件
      fs.writeFileSync(
        path.join(projectRoot, "src", "utils", "legacy.js"),
        "module.exports.foo = 1;\n",
      );

      const compiler = createCompiler(projectRoot);
      const entries = await compiler.scanEntryPoints();

      expect(entries.find((f) => f.includes("legacy.js"))).toBeDefined();
    });

    it("应支持 .mjs 文件", async () => {
      fs.writeFileSync(
        path.join(projectRoot, "src", "utils", "esm-util.mjs"),
        "export const bar = 2;\n",
      );

      const compiler = createCompiler(projectRoot);
      const entries = await compiler.scanEntryPoints();

      expect(entries.find((f) => f.includes("esm-util.mjs"))).toBeDefined();
    });

    it("应支持 .cjs 文件", async () => {
      fs.writeFileSync(
        path.join(projectRoot, "src", "utils", "cjs-util.cjs"),
        "module.exports.baz = 3;\n",
      );

      const compiler = createCompiler(projectRoot);
      const entries = await compiler.scanEntryPoints();

      expect(entries.find((f) => f.includes("cjs-util.cjs"))).toBeDefined();
    });
  });

  // ── 错误处理 ──────────────────────────────────────────────

  describe("错误处理", () => {
    it("空 src/ 目录应抛出描述性错误", async () => {
      // 清空 src/ 下所有文件
      const srcDir = path.join(projectRoot, "src");
      fs.rmSync(srcDir, { recursive: true, force: true });
      fs.mkdirSync(srcDir, { recursive: true });

      const compiler = createCompiler(projectRoot);

      await expect(compiler.build()).rejects.toThrow(/No source files found/);
    });

    it("只有 .d.ts 文件的 src/ 应抛出错误", async () => {
      const srcDir = path.join(projectRoot, "src");
      fs.rmSync(srcDir, { recursive: true, force: true });
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, "types.d.ts"),
        "export interface Foo { bar: string; }\n",
      );

      const compiler = createCompiler(projectRoot);

      await expect(compiler.build()).rejects.toThrow(/No source files found/);
    });

    it("编译语法错误的文件应返回 success: false", async () => {
      // 写入语法错误的文件
      fs.writeFileSync(
        path.join(projectRoot, "src", "bad.ts"),
        [
          // esbuild 能检测的语法错误：import 语句使用不存在的语法
          "const x: number = ;", // 表达式缺失
        ].join("\n"),
      );

      const compiler = createCompiler(projectRoot);
      const result = await compiler.build();

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // ── 构造选项 ──────────────────────────────────────────────

  describe("构造选项", () => {
    it("应使用默认选项（sourcemap: true, minify: false）", async () => {
      const compiler = createCompiler(projectRoot);
      const result = await compiler.build();

      expect(result.success).toBe(true);
      // 默认生成 source map
      expect(
        fs.existsSync(path.join(projectRoot, "dist", "index.js.map")),
      ).toBe(true);
    });

    it("应支持自定义输出目录", async () => {
      const customOutDir = path.join(projectRoot, "build");
      const compiler = createCompiler(projectRoot, { outDir: customOutDir });
      const result = await compiler.build();

      expect(result.success).toBe(true);
      expect(result.outDir).toBe(customOutDir);
      expect(fs.existsSync(path.join(customOutDir, "index.js"))).toBe(true);
    });

    it("应在 dist/ 不存在时自动创建", async () => {
      const distDir = path.join(projectRoot, "dist");
      expect(fs.existsSync(distDir)).toBe(false);

      const compiler = createCompiler(projectRoot);
      const result = await compiler.build();

      expect(result.success).toBe(true);
      expect(fs.existsSync(distDir)).toBe(true);
    });
  });

  // ── Getter 方法 ───────────────────────────────────────────

  describe("Getter 方法", () => {
    it("getSrcDir() 应返回源码目录", () => {
      const compiler = createCompiler(projectRoot);
      expect(compiler.getSrcDir()).toBe(path.join(projectRoot, "src"));
    });

    it("getOutDir() 应返回输出目录", () => {
      const compiler = createCompiler(projectRoot);
      expect(compiler.getOutDir()).toBe(path.join(projectRoot, "dist"));
    });

    it("getRootDir() 应返回项目根目录", () => {
      const compiler = createCompiler(projectRoot);
      expect(compiler.getRootDir()).toBe(projectRoot);
    });
  });

  // ── tsconfig 集成 ─────────────────────────────────────────

  describe("tsconfig 集成", () => {
    it("有 tsconfig.json 时应正常编译", async () => {
      const compiler = createCompiler(projectRoot);
      const result = await compiler.build();

      expect(result.success).toBe(true);
    });

    it("无 tsconfig.json 时应使用 esbuild 默认设置", async () => {
      // 删除 tsconfig.json
      fs.unlinkSync(path.join(projectRoot, "tsconfig.json"));

      const compiler = createCompiler(projectRoot);
      const result = await compiler.build();

      // 无 tsconfig 也应能编译（esbuild 使用默认 TS 设置）
      expect(result.success).toBe(true);
    });
  });

  // ── process.env.NODE_ENV 注入 ─────────────────────────────

  describe("NODE_ENV 注入", () => {
    it('编译产物中 process.env.NODE_ENV 应被替换为 "production"', async () => {
      // 写入使用 process.env.NODE_ENV 的文件
      fs.writeFileSync(
        path.join(projectRoot, "src", "env-check.ts"),
        [
          "export const env = process.env.NODE_ENV;",
          "export const isProd = process.env.NODE_ENV === 'production';",
          "",
        ].join("\n"),
      );

      const compiler = createCompiler(projectRoot);
      await compiler.build();

      const content = fs.readFileSync(
        path.join(projectRoot, "dist", "env-check.js"),
        "utf-8",
      );

      // esbuild 的 define 应将 process.env.NODE_ENV 替换为 "production"
      expect(content).toContain('"production"');
      // isProd 应被简化为 true（tree shaking + constant folding）
      // 或至少包含 "production" === "production" 比较
    });
  });

  // ── 编译产物可执行性 ──────────────────────────────────────

  describe("编译产物可执行性", () => {
    it("编译产物应可被 require 加载", async () => {
      const compiler = createCompiler(projectRoot);
      await compiler.build();

      const distFile = path.join(projectRoot, "dist", "utils", "hash.js");
      expect(fs.existsSync(distFile)).toBe(true);

      // 尝试加载编译产物（CJS 格式，可直接 require）
      // 使用 createRequire 来加载绝对路径
      const { createRequire } = await import("node:module");
      const localRequire = createRequire(import.meta.url);
      const mod = localRequire(distFile) as { hash: (s: string) => string };

      expect(typeof mod.hash).toBe("function");
      expect(mod.hash("abc")).toBe("cba");
    });
  });

  // ── 多次编译 ──────────────────────────────────────────────

  describe("多次编译", () => {
    it("应支持多次调用 build()（幂等性）", async () => {
      const compiler = createCompiler(projectRoot);

      const result1 = await compiler.build();
      const result2 = await compiler.build();

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.fileCount).toBe(result2.fileCount);
    });

    it("修改源文件后重新编译应反映变更", async () => {
      const compiler = createCompiler(projectRoot);

      // 首次编译
      await compiler.build();
      const content1 = fs.readFileSync(
        path.join(projectRoot, "dist", "index.js"),
        "utf-8",
      );

      // 修改源文件
      fs.writeFileSync(
        path.join(projectRoot, "src", "index.ts"),
        'export const version = "2.0.0";\n',
      );

      // 重新编译
      await compiler.build();
      const content2 = fs.readFileSync(
        path.join(projectRoot, "dist", "index.js"),
        "utf-8",
      );

      expect(content1).toContain("1.0.0");
      expect(content2).toContain("2.0.0");
    });

    it("重新编译时应清理已删除源码留下的后端 dist 产物", async () => {
      const compiler = createCompiler(projectRoot);
      await compiler.build();

      const staleRouteJs = path.join(projectRoot, "dist", "routes", "user.js");
      const staleRouteMap = `${staleRouteJs}.map`;
      const clientAsset = path.join(projectRoot, "dist", "client", "app.js");

      fs.mkdirSync(path.dirname(clientAsset), { recursive: true });
      fs.writeFileSync(clientAsset, "console.log('client asset');\n");
      expect(fs.existsSync(staleRouteJs)).toBe(true);
      expect(fs.existsSync(staleRouteMap)).toBe(true);

      fs.rmSync(path.join(projectRoot, "src", "routes", "user.ts"));
      await compiler.build();

      expect(fs.existsSync(staleRouteJs)).toBe(false);
      expect(fs.existsSync(staleRouteMap)).toBe(false);
      expect(fs.existsSync(path.join(projectRoot, "dist", "index.js"))).toBe(
        true,
      );
      expect(
        fs.existsSync(path.join(projectRoot, "dist", "package.json")),
      ).toBe(true);
      expect(fs.existsSync(clientAsset)).toBe(true);
    });

    it("关闭 sourcemap 重新编译时应清理旧的后端 .js.map 产物", async () => {
      const compilerWithSourcemap = createCompiler(projectRoot, {
        sourcemap: true,
      });
      await compilerWithSourcemap.build();

      const indexMap = path.join(projectRoot, "dist", "index.js.map");
      expect(fs.existsSync(indexMap)).toBe(true);

      const compilerWithoutSourcemap = createCompiler(projectRoot, {
        sourcemap: false,
      });
      await compilerWithoutSourcemap.build();

      expect(fs.existsSync(path.join(projectRoot, "dist", "index.js"))).toBe(
        true,
      );
      expect(fs.existsSync(indexMap)).toBe(false);
    });

    it("重新编译时应清理 dist/preload 中已删除的项目级 preload 产物", async () => {
      fs.mkdirSync(path.join(projectRoot, "src", "preload"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(projectRoot, "src", "preload", "01-env.ts"),
        "process.env.APP_STAGE = 'dev';\n",
      );

      const compiler = createCompiler(projectRoot);
      await compiler.build();

      expect(
        fs.existsSync(path.join(projectRoot, "dist", "preload", "01-env.mjs")),
      ).toBe(true);

      fs.rmSync(path.join(projectRoot, "src", "preload"), {
        recursive: true,
        force: true,
      });
      await compiler.build();

      expect(fs.existsSync(path.join(projectRoot, "dist", "preload"))).toBe(
        false,
      );
    });
  });
});

// ── parseBuildArgs 测试 ─────────────────────────────────────

describe("parseBuildArgs", () => {
  // 保存和恢复环境变量
  const originalEnv = { ...process.env };

  function expectBuildArgsToExit(args: string[], expectedError: string): void {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);

    try {
      expect(() => parseBuildArgs(args)).toThrow("process.exit(1)");
      expect(error).toHaveBeenCalledWith(expectedError);
    } finally {
      error.mockRestore();
      exit.mockRestore();
    }
  }

  afterEach(() => {
    // 恢复环境变量
    delete process.env.VEXT_BUILD_OUTDIR;
    delete process.env.VEXT_BUILD_SOURCEMAP;
    delete process.env.VEXT_BUILD_MINIFY;
    Object.assign(process.env, originalEnv);
    vi.restoreAllMocks();
  });

  describe("默认值", () => {
    it("无参数时应使用默认值", () => {
      const options = parseBuildArgs([]);

      expect(options.outdir).toBe("dist");
      expect(options.clean).toBe(false);
      expect(options.sourcemap).toBe(true);
      expect(options.minify).toBe(true);
      expect(options.typecheck).toBe(false);
      expect(options.uploadAssets).toBe(false);
      expect(options.deployDryRun).toBe(false);
    });
  });

  describe("CLI 参数", () => {
    it("--outdir 应设置输出目录", () => {
      const options = parseBuildArgs(["--outdir", "build"]);
      expect(options.outdir).toBe("build");
    });

    it("--config 应设置配置 profile", () => {
      const options = parseBuildArgs(["--config", "sg-sit"]);
      expect(options.configProfile).toBe("sg-sit");
    });

    it("重复 --config 应失败而不是采用最后一个值", () => {
      expectBuildArgsToExit(
        ["--config", "one", "--config", "two"],
        "[vextjs] --config may only be specified once",
      );
    });

    it("--outdir 缺少值时应失败", () => {
      expectBuildArgsToExit(
        ["--outdir"],
        '[vextjs] Option "--outdir" requires a value: <path>',
      );
    });

    it("--outdir 后跟另一个 flag 时应失败", () => {
      expectBuildArgsToExit(
        ["--outdir", "--minify"],
        '[vextjs] Option "--outdir" requires a value: <path>; received option-like value "--minify"',
      );
    });

    it("--config 缺少值时应失败", () => {
      expectBuildArgsToExit(
        ["--config"],
        '[vextjs] Option "--config" requires a value: <name>',
      );
    });

    it("--config 后跟另一个 flag 时应失败", () => {
      expectBuildArgsToExit(
        ["--config", "--clean"],
        '[vextjs] Option "--config" requires a value: <name>; received option-like value "--clean"',
      );
    });

    it("未知位置参数应失败", () => {
      expectBuildArgsToExit(["extra"], '[vextjs] Unknown argument: "extra"\n');
    });

    it("--clean 应设置清理标志", () => {
      const options = parseBuildArgs(["--clean"]);
      expect(options.clean).toBe(true);
    });

    it("--sourcemap 应启用 source map", () => {
      const options = parseBuildArgs(["--sourcemap"]);
      expect(options.sourcemap).toBe(true);
    });

    it("--no-sourcemap 应禁用 source map", () => {
      const options = parseBuildArgs(["--no-sourcemap"]);
      expect(options.sourcemap).toBe(false);
    });

    it("--minify 应启用代码压缩", () => {
      const options = parseBuildArgs(["--minify"]);
      expect(options.minify).toBe(true);
    });

    it("--no-minify 应禁用代码压缩", () => {
      const options = parseBuildArgs(["--no-minify"]);
      expect(options.minify).toBe(false);
    });

    it("--typecheck 应启用类型检查", () => {
      const options = parseBuildArgs(["--typecheck"]);
      expect(options.typecheck).toBe(true);
    });

    it("--upload-assets 应启用前端静态资源上传", () => {
      const options = parseBuildArgs(["--upload-assets"]);
      expect(options.uploadAssets).toBe(true);
    });

    it("--deploy-dry-run 应启用前端上传 dry-run", () => {
      const options = parseBuildArgs(["--deploy-dry-run"]);
      expect(options.deployDryRun).toBe(true);
    });

    it("应支持多个参数组合", () => {
      const options = parseBuildArgs([
        "--clean",
        "--minify",
        "--no-sourcemap",
        "--typecheck",
        "--upload-assets",
        "--deploy-dry-run",
        "--outdir",
        "output",
      ]);

      expect(options.clean).toBe(true);
      expect(options.minify).toBe(true);
      expect(options.sourcemap).toBe(false);
      expect(options.typecheck).toBe(true);
      expect(options.uploadAssets).toBe(true);
      expect(options.deployDryRun).toBe(true);
      expect(options.outdir).toBe("output");
    });
  });

  describe("环境变量覆盖", () => {
    it("VEXT_BUILD_OUTDIR 应覆盖默认输出目录", () => {
      process.env.VEXT_BUILD_OUTDIR = "custom-dist";
      const options = parseBuildArgs([]);
      expect(options.outdir).toBe("custom-dist");
    });

    it("VEXT_BUILD_SOURCEMAP=false 应禁用 source map", () => {
      process.env.VEXT_BUILD_SOURCEMAP = "false";
      const options = parseBuildArgs([]);
      expect(options.sourcemap).toBe(false);
    });

    it("VEXT_BUILD_MINIFY=false 应禁用代码压缩", () => {
      process.env.VEXT_BUILD_MINIFY = "false";
      const options = parseBuildArgs([]);
      expect(options.minify).toBe(false);
    });

    it("CLI --minify 应覆盖 VEXT_BUILD_MINIFY=false", () => {
      process.env.VEXT_BUILD_MINIFY = "false";
      const options = parseBuildArgs(["--minify"]);
      expect(options.minify).toBe(true);
    });

    it("CLI 参数应优先于环境变量", () => {
      process.env.VEXT_BUILD_OUTDIR = "env-dist";
      const options = parseBuildArgs(["--outdir", "cli-dist"]);
      expect(options.outdir).toBe("cli-dist");
    });
  });
});

// ── BuildCompilerOptions 接口测试 ───────────────────────────

describe("BuildCompilerOptions 接口", () => {
  it("应接受最小必要参数", () => {
    const options: BuildCompilerOptions = {
      rootDir: "/project",
      srcDir: "/project/src",
      outDir: "/project/dist",
    };

    const compiler = new BuildCompiler(options);
    expect(compiler.getRootDir()).toBe("/project");
    expect(compiler.getSrcDir()).toBe("/project/src");
    expect(compiler.getOutDir()).toBe("/project/dist");
  });

  it("应接受所有可选参数", () => {
    const options: BuildCompilerOptions = {
      rootDir: "/project",
      srcDir: "/project/src",
      outDir: "/project/dist",
      sourcemap: false,
      minify: true,
    };

    // 不抛出错误
    const compiler = new BuildCompiler(options);
    expect(compiler).toBeDefined();
  });
});

// ── BuildResult 接口测试 ────────────────────────────────────

describe("BuildResult 接口", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = createTempProject();
  });

  afterEach(() => {
    cleanupTempDir(projectRoot);
  });

  it("成功编译时所有字段应正确填充", async () => {
    const compiler = createCompiler(projectRoot);
    const result: BuildResult = await compiler.build();

    expect(typeof result.success).toBe("boolean");
    expect(typeof result.fileCount).toBe("number");
    expect(typeof result.totalFiles).toBe("number");
    expect(typeof result.elapsed).toBe("number");
    expect(typeof result.outDir).toBe("string");
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });
});

// ── 辅助函数 ────────────────────────────────────────────────

/**
 * 递归查找指定扩展名的所有文件
 */
function findFiles(dir: string, ext: string): string[] {
  const results: string[] = [];

  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(fullPath);
    }
  }

  return results;
}
