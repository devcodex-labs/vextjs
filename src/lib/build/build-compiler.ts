import * as esbuild from "esbuild";
import fg from "fast-glob";
import path from "node:path";
import fs from "node:fs";

import {
  createBaseEsbuildConfig,
  SOURCE_GLOB,
  SOURCE_IGNORE,
} from "./shared-esbuild-config.js";

/**
 * BuildCompiler — 生产编译器（Phase 2A）
 *
 * 将用户项目 src/ 下的 TypeScript/JavaScript 源码通过 esbuild 全量编译为
 * CJS JavaScript，输出到 dist/ 目录。编译完成后，`vext start` 检测到 dist/
 * 存在时直接用 `node` 运行，不再依赖 tsx 运行时。
 *
 * 与 DevCompiler 的关系：
 *
 * ```
 * DevCompiler（vext dev）              BuildCompiler（vext build）
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 输入:  src/                          输入:  src/
 * 输出:  .vext/dev/ (临时，gitignore)   输出:  dist/ (持久，可部署)
 * 格式:  CJS（方便 cache 清除）          格式:  CJS（Node.js 稳定运行）
 * 增量:  ctx.rebuild() + 单文件编译     增量:  无（每次全量编译）
 * 目标:  快速迭代（~23ms 热替换）       目标:  生产部署（一次性编译）
 * map:   inline source map              map:   外部 .js.map 文件
 * ```
 *
 * 两者共享 `createBaseEsbuildConfig()` 的基础配置（platform / target / format /
 * bundle / treeShaking / keepNames / charset / loader），在此基础上叠加各自选项。
 *
 * 编译产物结构（保持目录映射）：
 *   src/routes/user.ts      →  dist/routes/user.js      + dist/routes/user.js.map
 *   src/services/auth.ts    →  dist/services/auth.js     + dist/services/auth.js.map
 *   src/config/default.ts   →  dist/config/default.js    + dist/config/default.js.map
 *
 * 排除规则（在 SOURCE_IGNORE 基础上追加生产特有的排除）：
 *   - config/development.{ts,js} — 开发配置，生产无意义
 *   - config/local.{ts,js} — 本地覆盖，永远不部署
 *   - config/test.{ts,js} — 测试配置，生产不需要
 *
 * @module lib/build/build-compiler
 * @see 09a-build.md §2（编译策略）
 * @see 11a-dev-compiler.md §3（DevCompiler — 对比参照）
 * @see IMPLEMENTATION-PLAN.md 任务 2.5
 */

// ── 类型定义 ────────────────────────────────────────────────

/**
 * BuildCompiler 构造选项
 */
export interface BuildCompilerOptions {
  /** 项目根目录（绝对路径） */
  rootDir: string;

  /** 源码目录（绝对路径），通常是 `<rootDir>/src` */
  srcDir: string;

  /** 输出目录（绝对路径），默认 `<rootDir>/dist` */
  outDir: string;

  /**
   * 是否生成外部 source map（默认 true）
   *
   * 生成 `.js.map` 文件，用于：
   *   - 错误堆栈映射回原始 TypeScript 行号
   *   - APM/Sentry 等工具源码定位
   *   - 调试（`node --enable-source-maps`）
   */
  sourcemap?: boolean;

  /**
   * 是否压缩代码（默认 false）
   *
   * 生产可选开启，减小产物体积。
   * 注意：keepNames 始终为 true（保留函数名可读性）。
   */
  minify?: boolean;
}

/**
 * BuildCompiler 编译结果
 *
 * 包含编译统计信息，用于 CLI 输出编译报告。
 */
export interface BuildResult {
  /** 编译是否成功（无错误） */
  success: boolean;

  /** 输出的 JS 文件数量 */
  fileCount: number;

  /** 输入的源文件总数 */
  totalFiles: number;

  /** 编译耗时（毫秒） */
  elapsed: number;

  /** 输出目录 */
  outDir: string;

  /** esbuild 警告信息 */
  warnings: esbuild.Message[];

  /** esbuild 错误信息 */
  errors: esbuild.Message[];

  /** esbuild 编译元信息（文件大小等），仅编译成功时有值 */
  metafile?: esbuild.Metafile;
}

// ── 生产编译额外排除规则 ────────────────────────────────────

/**
 * 生产编译额外排除的 glob 模式
 *
 * 在 SOURCE_IGNORE（.d.ts / 测试文件）基础上，追加排除：
 *   - config/development.* — 开发环境配置，生产无意义
 *   - config/local.* — 本地覆盖配置，永远不部署
 *   - config/test.* — 测试环境配置，生产不需要
 */
const BUILD_EXTRA_IGNORE = [
  "**/config/development.{ts,js,mts,mjs,cts,cjs}",
  "**/config/local.{ts,js,mts,mjs,cts,cjs}",
  "**/config/test.{ts,js,mts,mjs,cts,cjs}",
];

const PROJECT_PRELOAD_DIR = "preload";
const PROJECT_PRELOAD_PATTERN = /\.(ts|mts|js|mjs)$/i;

// ── BuildCompiler 类 ────────────────────────────────────────

export class BuildCompiler {
  private readonly options: Required<BuildCompilerOptions>;

  constructor(options: BuildCompilerOptions) {
    this.options = {
      sourcemap: true,
      minify: false,
      ...options,
    };
  }

  /**
   * build — 执行全量编译
   *
   * 流程：
   *   1. 扫描 src/ 下所有源文件（排除 .d.ts / 测试 / 开发配置）
   *   2. 构建 esbuild 配置（基础配置 + 生产特有选项）
   *   3. 调用 esbuild.build() 执行一次性全量编译
   *   4. 统计编译结果（文件数、耗时、警告、错误）
   *
   * 与 DevCompiler.start() 的区别：
   *   - 不创建 esbuild.context（无增量编译需求）
   *   - sourcemap 使用 'external'（生成 .js.map 文件）
   *   - 追加 define: { 'process.env.NODE_ENV': '"production"' }
   *   - 追加生产排除规则（config/development / local / test）
   *   - 启用 metafile（输出编译元信息）
   *
   * @returns 编译结果统计
   * @throws 当 src/ 目录为空（无源文件）时抛出错误
   */
  async build(): Promise<BuildResult> {
    const { srcDir, outDir, sourcemap, minify } = this.options;
    const startTime = Date.now();

    // ── 1. 扫描源文件 ──────────────────────────────────────
    const entryPoints = await this.scanEntryPoints();

    if (entryPoints.length === 0) {
      throw new Error(
        `[vextjs] No source files found in ${srcDir}.\n` +
          `         Expected .ts or .js files in src/ directory.`,
      );
    }

    // ── 2. 构建 esbuild 配置 ────────────────────────────────
    //
    // tsconfig 路径：使用项目根目录下的 tsconfig.json（如果存在）。
    // esbuild.build() 的 tsconfig 参数接受文件路径，能自动解析 extends 链。
    //
    const tsconfigPath = path.join(this.options.rootDir, "tsconfig.json");
    const hasTsconfig = fs.existsSync(tsconfigPath);
    const baseConfig = createBaseEsbuildConfig(
      hasTsconfig ? tsconfigPath : undefined,
    );

    // ── 3. 执行编译 ────────────────────────────────────────
    let result: esbuild.BuildResult;
    const warnings: esbuild.Message[] = [];

    try {
      result = await esbuild.build({
        ...baseConfig,

        // 入口文件（绝对路径列表）
        entryPoints: entryPoints.map((f) => path.join(srcDir, f)),

        // 输出配置
        outdir: outDir,
        outbase: srcDir, // 保持目录结构: src/routes/users.ts → dist/routes/users.js

        // Source map：外部 .js.map 文件（区别于 DevCompiler 的 inline）
        sourcemap: sourcemap ? "external" : false,

        // 生产优化
        minify,

        // 编译元信息（文件大小等，用于 CLI 报告输出）
        metafile: true,

        // 生产模式特有：注入 NODE_ENV
        define: {
          "process.env.NODE_ENV": '"production"',
        },

        // 排除 node_modules（保留外部依赖，运行时由 node 解析）
        packages: "external",
      });
    } catch (err) {
      // esbuild.build() 在有编译错误时会抛出 BuildFailure，
      // 其中包含 errors 和 warnings 数组。
      if (isBuildFailure(err)) {
        const elapsed = Date.now() - startTime;
        return {
          success: false,
          fileCount: 0,
          totalFiles: entryPoints.length,
          elapsed,
          outDir,
          warnings: err.warnings ?? [],
          errors: err.errors ?? [],
          metafile: undefined,
        };
      }
      // 非 esbuild 错误（如文件系统权限问题），直接透传
      throw err;
    }

    // ── 4. 写入 dist/package.json（CJS 类型声明）──────────
    //
    // 确保 Node.js 将 dist/ 下的 .js 文件按 CommonJS 解析，
    // 即使用户根 package.json 声明了 "type": "module"。
    // 与 DevCompiler 在 .vext/dev/ 写入 package.json 的逻辑保持一致。
    //
    fs.writeFileSync(
      path.join(outDir, "package.json"),
      '{"type":"commonjs"}\n',
    );

    warnings.push(...result.warnings);

    let preloadBuildCount = 0;
    try {
      const preloadBuild = await this.buildProjectPreloads(
        hasTsconfig ? tsconfigPath : undefined,
        sourcemap,
      );
      preloadBuildCount = preloadBuild.fileCount;
      warnings.push(...preloadBuild.warnings);
    } catch (err) {
      if (isBuildFailure(err)) {
        const elapsed = Date.now() - startTime;
        return {
          success: false,
          fileCount: 0,
          totalFiles: entryPoints.length,
          elapsed,
          outDir,
          warnings,
          errors: err.errors ?? [],
          metafile: result.metafile,
        };
      }
      throw err;
    }

    // ── 5. 统计编译结果 ────────────────────────────────────
    const elapsed = Date.now() - startTime;
    const outputFiles = Object.keys(result.metafile?.outputs ?? {});
    const jsFiles = outputFiles.filter((f) => f.endsWith(".js"));

    return {
      success: result.errors.length === 0,
      fileCount: jsFiles.length + preloadBuildCount,
      totalFiles: entryPoints.length + preloadBuildCount,
      elapsed,
      outDir,
      warnings,
      errors: result.errors,
      metafile: result.metafile,
    };
  }

  private async buildProjectPreloads(
    tsconfigPath: string | undefined,
    sourcemap: boolean,
  ): Promise<{ fileCount: number; warnings: esbuild.Message[] }> {
    const sourceDir = path.join(this.options.rootDir, PROJECT_PRELOAD_DIR);
    const outPreloadDir = path.join(this.options.outDir, PROJECT_PRELOAD_DIR);

    fs.rmSync(outPreloadDir, { recursive: true, force: true });

    if (!fs.existsSync(sourceDir)) {
      return { fileCount: 0, warnings: [] };
    }

    const entries = await fs.promises.readdir(sourceDir, {
      withFileTypes: true,
    });
    const sortedEntries = [...entries].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const warnings: esbuild.Message[] = [];
    let fileCount = 0;

    for (const entry of sortedEntries) {
      if (!entry.isFile()) continue;
      if (!PROJECT_PRELOAD_PATTERN.test(entry.name)) continue;

      const sourcePath = path.join(sourceDir, entry.name);
      const outputName = entry.name.replace(/\.(ts|mts|js|mjs)$/i, ".mjs");
      const outfile = path.join(outPreloadDir, outputName);

      await fs.promises.mkdir(path.dirname(outfile), { recursive: true });
      const preloadResult = await esbuild.build({
        entryPoints: [sourcePath],
        bundle: true,
        packages: "external",
        format: "esm",
        platform: "node",
        target: "node20",
        write: true,
        outfile,
        sourcemap: sourcemap ? "external" : false,
        logLevel: "silent",
        ...(tsconfigPath ? { tsconfig: tsconfigPath } : {}),
      });

      warnings.push(...preloadResult.warnings);
      fileCount += 1;
    }

    return { fileCount, warnings };
  }

  /**
   * scanEntryPoints — 扫描 src/ 下所有可编译源文件
   *
   * 使用 fast-glob 扫描，返回相对于 srcDir 的路径列表。
   *
   * 排除规则（两层）：
   *   1. SOURCE_IGNORE — 共享排除（.d.ts / 测试文件 / __tests__/）
   *   2. BUILD_EXTRA_IGNORE — 生产特有排除（config/development / local / test）
   *
   * @returns 相对于 srcDir 的源文件路径列表
   */
  async scanEntryPoints(): Promise<string[]> {
    return fg.glob(SOURCE_GLOB, {
      cwd: this.options.srcDir,
      ignore: [...SOURCE_IGNORE, ...BUILD_EXTRA_IGNORE],
    });
  }

  // ── Getter 方法 ──────────────────────────────────────────

  /** 获取源码目录 */
  getSrcDir(): string {
    return this.options.srcDir;
  }

  /** 获取输出目录 */
  getOutDir(): string {
    return this.options.outDir;
  }

  /** 获取项目根目录 */
  getRootDir(): string {
    return this.options.rootDir;
  }
}

// ── 辅助函数 ────────────────────────────────────────────────

/**
 * 判断是否为 esbuild BuildFailure 错误
 *
 * esbuild.build() 在编译失败时抛出包含 errors/warnings 数组的对象。
 * 通过 duck typing 检测，避免依赖 esbuild 内部类型。
 */
function isBuildFailure(
  err: unknown,
): err is { errors: esbuild.Message[]; warnings: esbuild.Message[] } {
  return (
    typeof err === "object" &&
    err !== null &&
    "errors" in err &&
    Array.isArray((err as Record<string, unknown>).errors)
  );
}
