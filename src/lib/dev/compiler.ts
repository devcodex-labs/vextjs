import * as esbuild from "esbuild";
import fg from "fast-glob";
import path from "node:path";
import fs from "node:fs";
import {
  withArtifactTransaction,
  type ArtifactTransaction,
} from "../project/artifact-transaction.js";
import { createCompileFingerprint } from "../build/compile-fingerprint.js";
import {
  BACKEND_JSON_IGNORE,
  backendArtifactCandidates,
} from "../build/backend-artifacts.js";
import {
  acquireProjectOwner,
  currentProjectOwner,
  type ProjectOwner,
} from "../project/owner.js";

import {
  createBackendEsbuildConfig,
  SOURCE_GLOB,
  backendSourceIgnore,
} from "../build/shared-esbuild-config.js";
import {
  frontendSourceDirectories,
  frontendSourceFiles,
  resolveFrontendLayout,
  type FrontendLayoutInput,
} from "../project/layout.js";
import {
  assertPathInside,
  assertRealPathInside,
  isPathInside,
} from "../path-boundary.js";
import {
  isDeclarationFileName,
  isTestSourceFileName,
} from "../project/source-roles.js";

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
 * | Tier 1 单文件编译 | `compileSingle()` / `compileFiles()` | 只生成变更文件的产物               |
 * | Tier 2 全量重编译 | `rebuildWithNewEntryPoints()`| 文件增删时重建 context                    |
 * | 路径映射          | `resolveCompiled()` / `resolveSource()` | 源文件 ↔ 编译产物              |
 *
 * 编译产物结构：
 *   src/routes/user.ts      →  .vext/dev/routes/user.js
 *   src/services/auth.ts    →  .vext/dev/services/auth.js
 *   src/config/default.ts   →  .vext/dev/config/default.js
 *
 * 分级编译策略：
 *   - Tier 1：文件内容修改 → `compileSingle()`，保留其他模块的独立产物
 *   - Tier 2：文件新增/删除 → `rebuildWithNewEntryPoints()`，重新扫描入口
 *
 * 全量和单文件均由 esbuild build API 处理 JSONC、extends 和路径别名，
 * 本地模块引用使用同一输出映射，避免增量产物与首次构建行为不同。
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
  /** 已求值的目录配置；不在 compiler 内再次加载用户配置。 */
  frontend?: FrontendLayoutInput;
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
  private owner: ProjectOwner | undefined;
  private ownsOwner = false;

  private readonly srcDir: string;
  private readonly outDir: string;
  private readonly tsconfig: string | undefined;
  private readonly frontend: FrontendLayoutInput | undefined;

  /** 当前扫描的入口，用于将静态引用映射到独立产物并检查同名输出冲突。 */
  private entryPoints: string[] = [];

  /**
   * 经过验证的 tsconfig 路径（文件确实存在时才有值）。
   *
   * 用户传入的 tsconfig 路径可能不存在（如项目初始化阶段），
   * esbuild.context() 会直接报错 "Cannot find tsconfig file"。
   * 因此在 resolveTsconfig() 中验证文件存在性，不存在时置为 undefined，
   * 后续全量和单文件编译均沿用 esbuild 自动查找配置的行为。
   */
  private validatedTsconfig: string | undefined;

  constructor(options: DevCompilerOptions) {
    this.srcDir = options.srcDir;
    this.outDir = options.outDir;
    this.tsconfig = options.tsconfig;
    this.frontend = options.frontend;
  }
  async start(): Promise<CompileStats> {
    if (this.owner || this.ctx)
      throw new Error("[DevCompiler] already started.");
    const inherited = currentProjectOwner(this.getProjectRoot());
    this.owner =
      inherited ?? (await acquireProjectOwner(this.getProjectRoot(), "dev"));
    this.ownsOwner = !inherited;
    try {
      return await this.owner.run(() =>
        this.withTransaction((transaction) => this.startOwned(transaction)),
      );
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }
  private async startOwned(
    transaction: ArtifactTransaction,
  ): Promise<CompileStats> {
    return this.buildAll(transaction, true);
  }
  async rebuild(): Promise<void> {
    if (!this.ctx)
      throw new Error("[DevCompiler] not started. Call start() first.");
    await this.withTransaction(async (transaction) => {
      await this.buildAll(transaction, false);
    });
  }
  async rebuildWithNewEntryPoints(): Promise<CompileStats> {
    return this.withTransaction((transaction) =>
      this.buildAll(transaction, false),
    );
  }
  async compileSingle(srcFile: string): Promise<string> {
    return (await this.compileFiles([srcFile]))[0]!;
  }
  async compileFiles(srcFiles: string[]): Promise<string[]> {
    return this.withTransaction(async (transaction) => {
      const absoluteFiles = srcFiles.map((file) =>
        path.isAbsolute(file)
          ? file
          : path.resolve(this.getProjectRoot(), file),
      );
      for (const file of absoluteFiles) this.assertBackendSource(file);
      const compiled = absoluteFiles.map((file) => this.resolveCompiled(file));
      if (absoluteFiles.length === 0) return [];
      await this.resolveTsconfig();
      const entries = await this.scanEntryPoints();
      const before = this.fingerprint(entries);
      const codeFiles = absoluteFiles.filter((file) => !file.endsWith(".json"));
      const result =
        codeFiles.length === 0
          ? { outputFiles: [] }
          : await esbuild.build({
              ...createBackendEsbuildConfig(
                this.srcDir,
                entries,
                this.validatedTsconfig,
              ),
              entryPoints: codeFiles,
              outbase: this.srcDir,
              outdir: this.outDir,
              sourcemap: "external",
              write: false,
            });
      this.assertUnchanged(
        before.digest,
        this.fingerprint(await this.scanEntryPoints()).digest,
      );
      const jsonFiles = absoluteFiles
        .filter((file) => file.endsWith(".json"))
        .map((file) => path.relative(this.srcDir, file));
      const artifacts = backendArtifactCandidates(
        this.srcDir,
        this.outDir,
        entries,
        result.outputFiles ?? [],
        jsonFiles,
      );
      this.assertUnchanged(
        before.digest,
        this.fingerprint(await this.scanEntryPoints()).digest,
      );
      await transaction.commit(artifacts, { mode: "merge" });
      return compiled;
    });
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

    assertPathInside(this.srcDir, absolute, "backend source");
    assertRealPathInside(this.srcDir, absolute, "backend source");
    const relative = path.relative(this.srcDir, absolute);
    const jsFile = relative.replace(/\.(ts|mts|cts|mjs|cjs)$/, ".js");
    const compiled = assertPathInside(
      this.outDir,
      path.join(this.outDir, jsFile),
      "backend output",
    );
    assertRealPathInside(this.outDir, compiled, "backend output");
    return compiled;
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
    if (this.ownsOwner) await this.owner?.release();
    this.owner = undefined;
    this.ownsOwner = false;
  }

  private async assertWriter(): Promise<void> {
    if (!this.owner)
      throw new Error("[DevCompiler] not started or already disposed.");
    await this.owner.assertActive();
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
    return (
      await fg.glob([SOURCE_GLOB, "**/*.json"], {
        cwd: this.srcDir,
        ignore: [
          ...BACKEND_JSON_IGNORE,
          ...backendSourceIgnore(
            this.getProjectRoot(),
            this.srcDir,
            this.frontend,
          ),
        ],
      })
    ).sort();
  }

  private assertBackendSource(file: string): void {
    const layout =
      this.frontend?.enabled === true
        ? resolveFrontendLayout(
            this.getProjectRoot(),
            this.frontend,
            "development",
          )
        : undefined;
    const isFrontend =
      layout !== undefined &&
      (frontendSourceDirectories(layout).some(
        (directory) =>
          isPathInside(this.srcDir, directory) &&
          isPathInside(directory, file, true),
      ) ||
        frontendSourceFiles(layout).includes(path.resolve(file)));
    const name = path.basename(file);
    if (
      isFrontend ||
      isDeclarationFileName(name) ||
      isTestSourceFileName(name) ||
      !/\.(?:ts|mts|cts|js|mjs|cjs|json)$/u.test(name) ||
      name === "package.json" ||
      /^tsconfig(?:\..+)?\.json$/u.test(name)
    ) {
      throw new Error(
        `[vextjs] File is not a backend compilation source: ${file}`,
      );
    }
  }
  private async withTransaction<T>(
    operation: (transaction: ArtifactTransaction) => Promise<T>,
  ): Promise<T> {
    await this.assertWriter();
    return withArtifactTransaction(
      {
        rootDir: this.getProjectRoot(),
        outDir: this.outDir,
        producer: "backend",
        owner: this.owner,
      },
      operation,
    );
  }

  private fingerprint(entryPoints: string[]) {
    return createCompileFingerprint({
      rootDir: this.getProjectRoot(),
      srcDir: this.srcDir,
      entryPoints,
      tsconfig: this.validatedTsconfig,
      parameters: { mode: "development", sourcemap: true, outDir: this.outDir },
    });
  }

  private assertUnchanged(before: string, after: string): void {
    if (before !== after)
      throw new Error(
        "[DevCompiler] Inputs changed during compilation; retry the pending generation.",
      );
  }

  private async buildAll(
    transaction: ArtifactTransaction,
    allowCache: boolean,
  ): Promise<CompileStats> {
    const started = Date.now();
    const previousTsconfig = this.validatedTsconfig;
    await this.resolveTsconfig();
    const entries = await this.scanEntryPoints();
    const before = this.fingerprint(entries);
    const cacheHit =
      allowCache && before.complete && transaction.isFresh(before.digest);
    const replaceContext =
      !this.ctx ||
      entries.join("\n") !== this.entryPoints.join("\n") ||
      previousTsconfig !== this.validatedTsconfig;
    const candidate = replaceContext
      ? await esbuild.context({
          ...createBackendEsbuildConfig(
            this.srcDir,
            entries,
            this.validatedTsconfig,
          ),
          entryPoints: entries
            .filter((file) => !file.endsWith(".json"))
            .map((file) => path.join(this.srcDir, file)),
          outdir: this.outDir,
          outbase: this.srcDir,
          sourcemap: true,
          write: false,
        })
      : this.ctx!;
    try {
      if (!cacheHit) {
        const result = await candidate.rebuild();
        const artifacts = backendArtifactCandidates(
          this.srcDir,
          this.outDir,
          entries,
          result.outputFiles ?? [],
          entries.filter((file) => file.endsWith(".json")),
        );
        this.assertUnchanged(
          before.digest,
          this.fingerprint(await this.scanEntryPoints()).digest,
        );
        await transaction.commit(
          [
            ...artifacts,
            {
              path: path.join(this.outDir, "package.json"),
              contents: '{"type":"commonjs"}\n',
            },
          ],
          { inputDigest: before.complete ? before.digest : undefined },
        );
      }
      if (candidate !== this.ctx) await this.ctx?.dispose();
      this.ctx = candidate;
      this.entryPoints = entries;
      return {
        fileCount: entries.length,
        elapsed: Date.now() - started,
        ...(allowCache ? { cacheHit } : {}),
      };
    } catch (error) {
      if (candidate !== this.ctx) await candidate.dispose();
      this.validatedTsconfig = previousTsconfig;
      throw error;
    }
  }
  /** esbuild 原生处理 JSONC、extends 和 paths；缺省文件沿用自动查找。 */
  private async resolveTsconfig(): Promise<void> {
    this.validatedTsconfig =
      this.tsconfig && fs.existsSync(this.tsconfig) ? this.tsconfig : undefined;
  }
}
