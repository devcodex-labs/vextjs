import * as esbuild from "esbuild";
import fg from "fast-glob";
import path from "node:path";
import fs from "node:fs";

import {
  createBaseEsbuildConfig,
  getLoaderForExtension,
  SOURCE_GLOB,
  SOURCE_IGNORE,
} from "../build/shared-esbuild-config.js";

/**
 * DevCompiler — esbuild 预编译器（Phase 2A 核心组件）
 *
 * 所有用户源码（TS、ESM、CJS）通过 esbuild 统一编译为 CJS `.js` 文件，
 * 解决了 ESM `import` 无法清除缓存的根本问题。
 *
 * 核心职责：
 *
 * | 职责              | 方法                         | 说明                                     |
 * |-------------------|------------------------------|------------------------------------------|
 * | 首次全量编译      | `start()`                    | 扫描 `src/` 下所有源文件，编译到 `.vext/dev/`  |
 * | Tier 1 单文件编译 | `compileSingle()` / `compileFiles()` | 代码修改时 O(1) 编译               |
 * | Tier 2 全量重编译 | `rebuildWithNewEntryPoints()`| 文件增删时重建 context                    |
 * | 路径映射          | `resolveCompiled()` / `resolveSource()` | 源文件 ↔ 编译产物              |
 *
 * 编译产物结构：
 *   src/routes/user.ts      →  .vext/dev/routes/user.js
 *   src/services/auth.ts    →  .vext/dev/services/auth.js
 *   src/config/default.ts   →  .vext/dev/config/default.js
 *
 * 分级编译策略：
 *   - Tier 1（~95% 场景）：文件内容修改 → `compileSingle()` ~1-5ms/文件（O(changed)）
 *   - Tier 2（~5% 场景）：文件新增/删除 → `rebuildWithNewEntryPoints()` ~50-600ms（O(all)）
 *
 * tsconfig 处理（v2.2）：
 *   - `esbuild.context()` 的 `tsconfig` 参数接受文件路径，能自动解析 `extends` 链
 *   - `esbuild.transform()` 的 `tsconfigRaw` 只接受 JSON 字符串，不解析 `extends`
 *   - 为保证 Tier 1 和 Tier 2 行为一致，`start()` 时预解析 tsconfig（展平 extends 链），
 *     缓存结果供 `compileSingle()` 使用
 *
 * @module lib/dev/compiler
 * @see 11a-dev-compiler.md（完整设计文档）
 * @see 09a-build.md §2.1（与 BuildCompiler 共享配置）
 * @see IMPLEMENTATION-PLAN.md 任务 2.1
 */

// ── 类型定义 ────────────────────────────────────────────────

/**
 * DevCompiler 构造选项
 */
export interface DevCompilerOptions {
  /** 源码目录（绝对路径），通常是 `<projectRoot>/src` */
  srcDir: string;

  /** 编译输出目录（绝对路径），通常是 `<projectRoot>/.vext/dev` */
  outDir: string;

  /** tsconfig.json 路径（可选，绝对路径）。未提供时 esbuild 使用默认设置 */
  tsconfig?: string;
}

/**
 * DevCompiler 编译统计信息
 *
 * 由 `start()` 和 `rebuildWithNewEntryPoints()` 返回，
 * 用于 CLI 打印编译耗时和文件数等信息。
 */
export interface CompileStats {
  /** 编译的入口文件数量 */
  fileCount: number;

  /** 编译耗时（毫秒） */
  elapsed: number;

  /** 是否复用了已有 .vext/dev 输出目录 */
  cacheHit?: boolean;
}

interface DevCompileCache {
  version: 1;
  entryPoints: string[];
  files: Record<string, { size: number; mtimeMs: number }>;
  tsconfig?: { size: number; mtimeMs: number };
}

// ── DevCompiler 类 ──────────────────────────────────────────

export class DevCompiler {
  /**
   * esbuild 增量编译上下文
   *
   * 通过 `esbuild.context()` 创建，支持 `rebuild()` 增量编译。
   * 当文件新增/删除时需要重建（`rebuildWithNewEntryPoints()`），
   * 因为 entryPoints 发生了变化。
   */
  private ctx: esbuild.BuildContext | null = null;

  private readonly srcDir: string;
  private readonly outDir: string;
  private readonly tsconfig: string | undefined;

  /**
   * v2.2：预解析并展平的 tsconfig 内容（字符串形式）。
   *
   * esbuild.context() 的 `tsconfig` 参数接受文件路径，能自动解析 `extends` 链。
   * 但 esbuild.transform() 的 `tsconfigRaw` 只接受 JSON 字符串，不解析 `extends`。
   *
   * 为保证 Tier 1 (transform) 和 Tier 2 (context.rebuild) 行为一致，
   * 在 start() 时预解析 tsconfig（展平 extends 链），缓存结果供 compileSingle() 使用。
   */
  private resolvedTsconfigRaw: string | undefined;

  /**
   * 经过验证的 tsconfig 路径（文件确实存在时才有值）。
   *
   * 用户传入的 tsconfig 路径可能不存在（如项目初始化阶段），
   * esbuild.context() 会直接报错 "Cannot find tsconfig file"。
   * 因此在 resolveTsconfig() 中验证文件存在性，不存在时置为 undefined，
   * 后续 esbuild.context() 和 esbuild.transform() 均使用默认设置。
   */
  private validatedTsconfig: string | undefined;

  constructor(options: DevCompilerOptions) {
    this.srcDir = options.srcDir;
    this.outDir = options.outDir;
    this.tsconfig = options.tsconfig;
  }

  // ── 首次全量编译 ────────────────────────────────────────

  /**
   * start — 初始化 esbuild context 并执行首次全量编译
   *
   * 只应调用一次（在 dev bootstrap 启动时）。
   *
   * 流程：
   *   1. 清空输出目录（.vext/dev/）确保干净状态
   *   2. 预解析 tsconfig（展平 extends 链）
   *   3. 扫描 src/ 下所有源文件作为 entryPoints
   *   4. 创建 esbuild.context（增量编译上下文）
   *   5. 执行首次 rebuild（全量编译）
   *
   * @returns 编译统计信息
   * @throws esbuild 编译错误（语法错误等）会透传
   */
  async start(): Promise<CompileStats> {
    const startTime = Date.now();

    // v2.2: 预解析 tsconfig（展平 extends 链）
    await this.resolveTsconfig();

    // 扫描源文件
    const entryPoints = await this.scanEntryPoints();
    const cacheHit = this.isCompileCacheValid(entryPoints);

    // cache valid 时保留已有输出目录；失效时清理，避免旧产物污染运行时。
    if (!cacheHit && fs.existsSync(this.outDir)) {
      fs.rmSync(this.outDir, { recursive: true, force: true });
    }
    fs.mkdirSync(this.outDir, { recursive: true });

    // 写入 package.json 强制 CJS 模式
    // esbuild 编译输出为 CJS（module.exports），但用户项目的 package.json
    // 可能声明 "type": "module"，导致 Node.js 将 .js 文件当作 ESM 解析，
    // 出现 "module is not defined in ES module scope" 错误。
    // 在 .vext/dev/ 下放置 {"type":"commonjs"} 覆盖上层设置。
    fs.writeFileSync(
      path.join(this.outDir, "package.json"),
      '{"type":"commonjs"}\n',
    );

    // 创建 esbuild context
    // 使用 validatedTsconfig（resolveTsconfig 已验证文件存在性）
    const baseConfig = createBaseEsbuildConfig(this.validatedTsconfig);

    this.ctx = await esbuild.context({
      ...baseConfig,
      entryPoints: entryPoints.map((f) => path.join(this.srcDir, f)),
      outdir: this.outDir,
      outbase: this.srcDir, // 保持目录结构: src/routes/user.ts → .vext/dev/routes/user.js
      sourcemap: true, // 错误堆栈指向原始 TS 源码
      packages: "external", // 不打包 node_modules（保持 require 外部包）
    });

    // 首次全量编译。缓存命中时复用已有 .vext/dev 产物，仅保留
    // esbuild context 供后续结构变更重建使用。
    if (!cacheHit) {
      await this.ctx.rebuild();
    }
    this.writeCompileCache(entryPoints);

    const elapsed = Date.now() - startTime;
    return { fileCount: entryPoints.length, elapsed, cacheHit };
  }

  // ── Tier 2：全量增量重编译 ──────────────────────────────

  /**
   * rebuild — 使用现有 context 执行全量增量重编译
   *
   * 当新增/删除文件时需要使用 `rebuildWithNewEntryPoints()` 而非此方法，
   * 因为 entry points 可能变化。
   *
   * 此方法用于 entry points 不变但需要重编译的场景（通常较少使用）。
   *
   * 典型耗时：
   *   - 50 文件项目:  ~10-30ms
   *   - 500 文件项目: ~50-200ms
   *   - 2000 文件项目: ~200-500ms
   *
   * @throws DevCompiler 未启动时抛出错误
   */
  async rebuild(): Promise<void> {
    if (!this.ctx) {
      throw new Error("[DevCompiler] not started. Call start() first.");
    }
    await this.ctx.rebuild();
  }

  /**
   * rebuildWithNewEntryPoints — 文件增删时重建 esbuild context
   *
   * 当检测到文件新增或删除时调用（因为 entryPoints 发生了变化）。
   *
   * 流程：
   *   1. 释放旧的 esbuild context
   *   2. 重新扫描 src/ 下的源文件
   *   3. 创建新的 esbuild context（新 entryPoints）
   *   4. 执行全量编译
   *
   * 典型耗时：
   *   - 50 文件项目:  ~20-50ms
   *   - 500 文件项目: ~80-250ms
   *   - 2000 文件项目: ~250-600ms
   *
   * 仅在文件增删时触发（约 5% 场景），95% 的代码变更走 compileSingle() 路径。
   *
   * @returns 编译统计信息
   */
  async rebuildWithNewEntryPoints(): Promise<CompileStats> {
    const startTime = Date.now();

    // 释放旧 context
    await this.ctx?.dispose();

    // 重新扫描源文件
    const entryPoints = await this.scanEntryPoints();

    // 创建新 context
    // 使用 validatedTsconfig（resolveTsconfig 已验证文件存在性）
    const baseConfig = createBaseEsbuildConfig(this.validatedTsconfig);

    this.ctx = await esbuild.context({
      ...baseConfig,
      entryPoints: entryPoints.map((f) => path.join(this.srcDir, f)),
      outdir: this.outDir,
      outbase: this.srcDir,
      sourcemap: true,
      packages: "external",
    });

    // 全量编译
    await this.ctx.rebuild();
    this.writeCompileCache(entryPoints);

    const elapsed = Date.now() - startTime;
    return { fileCount: entryPoints.length, elapsed };
  }

  // ── Tier 1：单文件编译 ──────────────────────────────────

  /**
   * compileSingle — 单文件编译（Tier 1：代码变更时使用）
   *
   * 使用 esbuild.transform() 只编译单个变更文件，不涉及其他文件。
   * 由于 Vext 不使用 bundle 模式（每个文件独立编译），transform() 的
   * 输出与 context.rebuild() 对同一文件的输出完全等价。
   *
   * 典型耗时：~1-5ms/文件，与项目总文件数无关（O(1) 编译）
   *
   * v2.2 修复：使用预解析的 resolvedTsconfigRaw 替代直接读取 tsconfig 文件，
   * 确保 extends 链被正确展平，与 context.rebuild() 行为一致。
   *
   * @param srcFile 变更的源文件绝对路径
   * @returns 编译产物的绝对路径
   * @throws 文件读取失败、esbuild 编译错误时抛出
   */
  async compileSingle(srcFile: string): Promise<string> {
    const source = await fs.promises.readFile(srcFile, "utf-8");
    const ext = path.extname(srcFile); // .ts, .js, .mjs, .cjs

    const result = await esbuild.transform(source, {
      loader: getLoaderForExtension(ext),
      format: "cjs",
      platform: "node",
      target: "node20",
      sourcemap: true,
      sourcefile: srcFile, // sourcemap 指回原始源文件
      // v2.2: 使用预解析的 tsconfig（已展平 extends），而非原始文件内容
      tsconfigRaw: this.resolvedTsconfigRaw,
    });

    const outFile = this.resolveCompiled(srcFile);
    await fs.promises.mkdir(path.dirname(outFile), { recursive: true });
    await fs.promises.writeFile(outFile, result.code);
    if (result.map) {
      await fs.promises.writeFile(`${outFile}.map`, result.map);
    }

    return outFile;
  }

  /**
   * compileFiles — 批量单文件编译（多文件同时变更时并行编译）
   *
   * 当防抖窗口内多个文件同时变更时，并行调用 compileSingle。
   * 每个文件的编译是独立的，适合 Promise.all 并行。
   *
   * @param srcFiles 变更的源文件绝对路径列表
   * @returns 编译产物的绝对路径列表
   */
  async compileFiles(srcFiles: string[]): Promise<string[]> {
    return Promise.all(srcFiles.map((f) => this.compileSingle(f)));
  }

  // ── 路径映射 ──────────────────────────────────────────────

  /**
   * resolveCompiled — 将源文件路径映射为编译后的产物路径
   *
   * 支持两种输入：
   *   - 绝对路径: /project/src/routes/user.ts → /project/.vext/dev/routes/user.js
   *   - 相对于项目根目录的路径: src/routes/user.ts → /project/.vext/dev/routes/user.js
   *
   * 映射规则：
   *   1. 去掉 srcDir 前缀，得到相对路径
   *   2. 将 .ts / .mts / .cts / .mjs / .cjs 扩展名替换为 .js
   *   3. 拼接到 outDir
   *
   * @param srcFile 源文件路径（绝对路径或相对于项目根目录）
   * @returns 编译产物的绝对路径
   */
  resolveCompiled(srcFile: string): string {
    let absolute: string;

    if (path.isAbsolute(srcFile)) {
      absolute = srcFile;
    } else {
      // 相对于项目根目录（如 "src/routes/user.ts"）
      // projectRoot = srcDir 的父目录
      const projectRoot = path.resolve(this.srcDir, "..");
      absolute = path.resolve(projectRoot, srcFile);
    }

    const relative = path.relative(this.srcDir, absolute);
    const jsFile = relative.replace(/\.(ts|mts|cts|mjs|cjs)$/, ".js");
    return path.join(this.outDir, jsFile);
  }

  /**
   * resolveSource — 将编译产物路径映射回源文件路径（反向映射）
   *
   * 用于错误堆栈显示、日志中将编译产物路径转换回用户可理解的源文件路径。
   *
   * 注意：反向映射不恢复原始扩展名（.ts / .mjs 等），
   * 因为编译产物只有 .js 扩展名，无法确定原始扩展名。
   * 返回的路径使用 .js 扩展名，调用方如需精确匹配可自行检查。
   *
   * @param compiledFile 编译产物的绝对路径
   * @returns 对应的源文件路径（使用 .js 扩展名）
   */
  resolveSource(compiledFile: string): string {
    const relative = path.relative(this.outDir, compiledFile);
    return path.join(this.srcDir, relative);
  }

  // ── Getter ────────────────────────────────────────────────

  /** 获取源码目录（绝对路径） */
  getSrcDir(): string {
    return this.srcDir;
  }

  /** 获取编译输出目录（绝对路径） */
  getOutDir(): string {
    return this.outDir;
  }

  /** 获取项目根目录（srcDir 的父目录） */
  getProjectRoot(): string {
    return path.resolve(this.srcDir, "..");
  }

  // ── 资源释放 ──────────────────────────────────────────────

  /**
   * dispose — 释放 esbuild 资源
   *
   * 关闭 esbuild context（释放子进程/内存）。
   * 在 dev 服务器关闭时调用（graceful shutdown）。
   * 调用后不可再使用 rebuild / compileSingle 等方法。
   */
  async dispose(): Promise<void> {
    await this.ctx?.dispose();
    this.ctx = null;
  }

  // ── 内部方法 ──────────────────────────────────────────────

  /**
   * scanEntryPoints — 扫描 src/ 目录下的所有可编译源文件
   *
   * 使用 fast-glob 扫描，返回相对于 srcDir 的路径列表。
   * 排除 .d.ts 声明文件和测试文件。
   *
   * @returns 相对于 srcDir 的源文件路径列表
   */
  private async scanEntryPoints(): Promise<string[]> {
    return fg.glob(SOURCE_GLOB, {
      cwd: this.srcDir,
      ignore: [...SOURCE_IGNORE],
    });
  }

  private isCompileCacheValid(entryPoints: string[]): boolean {
    const cache = this.readCompileCache();
    if (!cache || cache.version !== 1) return false;
    if (!fs.existsSync(path.join(this.outDir, "package.json"))) return false;

    const sortedEntryPoints = [...entryPoints].sort((a, b) =>
      a.localeCompare(b),
    );
    if (cache.entryPoints.join("\n") !== sortedEntryPoints.join("\n")) {
      return false;
    }

    for (const entryPoint of sortedEntryPoints) {
      const filePath = path.join(this.srcDir, entryPoint);
      const cached = cache.files[entryPoint];
      if (!cached || !fs.existsSync(filePath)) return false;
      const stat = fs.statSync(filePath);
      if (stat.size !== cached.size || stat.mtimeMs !== cached.mtimeMs) {
        return false;
      }
      const compiledPath = this.resolveCompiled(filePath);
      if (
        !fs.existsSync(compiledPath) ||
        !fs.existsSync(`${compiledPath}.map`)
      ) {
        return false;
      }
    }

    if (this.tsconfig && fs.existsSync(this.tsconfig)) {
      const stat = fs.statSync(this.tsconfig);
      if (
        !cache.tsconfig ||
        cache.tsconfig.size !== stat.size ||
        cache.tsconfig.mtimeMs !== stat.mtimeMs
      ) {
        return false;
      }
    }

    return true;
  }

  private readCompileCache(): DevCompileCache | null {
    const cachePath = this.getCompileCachePath();
    if (!fs.existsSync(cachePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(cachePath, "utf-8")) as DevCompileCache;
    } catch {
      return null;
    }
  }

  private writeCompileCache(entryPoints: string[]): void {
    const sortedEntryPoints = [...entryPoints].sort((a, b) =>
      a.localeCompare(b),
    );
    const files: DevCompileCache["files"] = {};
    for (const entryPoint of sortedEntryPoints) {
      const stat = fs.statSync(path.join(this.srcDir, entryPoint));
      files[entryPoint] = { size: stat.size, mtimeMs: stat.mtimeMs };
    }

    const cache: DevCompileCache = {
      version: 1,
      entryPoints: sortedEntryPoints,
      files,
    };

    if (this.tsconfig && fs.existsSync(this.tsconfig)) {
      const stat = fs.statSync(this.tsconfig);
      cache.tsconfig = { size: stat.size, mtimeMs: stat.mtimeMs };
    }

    const cachePath = this.getCompileCachePath();
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf-8");
  }

  private getCompileCachePath(): string {
    return path.join(
      this.getProjectRoot(),
      ".vext",
      "cache",
      "dev-compile.json",
    );
  }

  /**
   * resolveTsconfig — 预解析 tsconfig.json，展平 extends 链（v2.2）
   *
   * 读取 tsconfig.json，如果包含 extends，递归合并父配置，
   * 最终输出一个不含 extends 的纯 JSON 字符串。
   * 这样 esbuild.transform() 的 tsconfigRaw 能获得与 esbuild.context()
   * 的 tsconfig（路径参数）完全一致的编译行为。
   *
   * 注意：只提取 esbuild 实际使用的字段（compilerOptions 中的
   * target、jsx、jsxFactory、jsxFragment、useDefineForClassFields、
   * importsNotUsedAsValues、preserveValueImports、experimentalDecorators、
   * verbatimModuleSyntax 等），其他字段不影响 transform 行为。
   *
   * 错误处理：tsconfig 不存在或解析失败时静默降级，
   * transform 将使用 esbuild 默认设置。
   */
  private async resolveTsconfig(): Promise<void> {
    if (!this.tsconfig) {
      this.resolvedTsconfigRaw = undefined;
      this.validatedTsconfig = undefined;
      return;
    }

    // 验证 tsconfig 文件是否存在
    // esbuild.context() 的 tsconfig 参数要求文件必须存在，否则直接抛错
    // "Cannot find tsconfig file"。不存在时降级为 esbuild 默认设置。
    if (!fs.existsSync(this.tsconfig)) {
      this.resolvedTsconfigRaw = undefined;
      this.validatedTsconfig = undefined;
      return;
    }

    this.validatedTsconfig = this.tsconfig;

    try {
      const resolved = await this.flattenTsconfig(this.tsconfig);
      this.resolvedTsconfigRaw = JSON.stringify(resolved);
    } catch {
      // tsconfig 存在但解析失败（如 JSON 语法错误），transform 将使用默认设置
      // 但 context() 仍可使用 validatedTsconfig（esbuild 有自己的解析容错）
      this.resolvedTsconfigRaw = undefined;
    }
  }

  /**
   * flattenTsconfig — 递归展平 tsconfig，合并 extends 链
   *
   * 递归处理 tsconfig 的 extends 字段：
   *   1. 读取当前 tsconfig 文件
   *   2. 移除 JSON 中的注释（tsconfig 允许单行和多行注释）
   *   3. 解析 JSON
   *   4. 如果有 extends → 递归加载父配置
   *   5. 子配置的 compilerOptions 覆盖父配置（浅合并）
   *
   * @param tsconfigPath tsconfig 文件的绝对路径
   * @returns 展平后的配置对象（仅包含 compilerOptions）
   */
  private async flattenTsconfig(
    tsconfigPath: string,
  ): Promise<Record<string, unknown>> {
    const content = await fs.promises.readFile(tsconfigPath, "utf-8");

    // 移除 JSON 中的注释（tsconfig 允许注释）
    const cleaned = content
      .replace(/\/\/.*$/gm, "") // 单行注释
      .replace(/\/\*[\s\S]*?\*\//g, ""); // 多行注释

    const config = JSON.parse(cleaned) as Record<string, unknown>;

    if (!config.extends) {
      return {
        compilerOptions:
          (config.compilerOptions as Record<string, unknown>) || {},
      };
    }

    // 解析 extends 路径
    //
    // extends 可以是：
    //   - 相对路径：'./base.json'、'../shared/tsconfig.json'
    //   - npm 包路径：'@tsconfig/node20/tsconfig.json'
    //
    // 使用 require.resolve 统一处理两种情况：
    //   - 相对路径通过 paths 选项指定基础目录
    //   - npm 包路径由 Node.js 模块解析算法处理
    //
    const extendsValue = config.extends as string;
    let extendsPath: string;

    try {
      // 先尝试 require.resolve（处理 npm 包和相对路径）
      const { createRequire } = await import("node:module");
      const localRequire = createRequire(tsconfigPath);
      extendsPath = localRequire.resolve(extendsValue);
    } catch {
      // require.resolve 失败时，尝试作为相对路径直接解析
      extendsPath = path.resolve(path.dirname(tsconfigPath), extendsValue);

      // 如果没有扩展名，尝试加上 .json
      if (!path.extname(extendsPath)) {
        extendsPath += ".json";
      }
    }

    const parent = await this.flattenTsconfig(extendsPath);

    // 子配置覆盖父配置（浅合并 compilerOptions）
    return {
      compilerOptions: {
        ...(parent.compilerOptions as Record<string, unknown>),
        ...((config.compilerOptions as Record<string, unknown>) || {}),
      },
    };
  }
}
