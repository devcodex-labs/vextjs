import type { BuildOptions, Loader } from "esbuild";

/**
 * shared-esbuild-config.ts — DevCompiler 与 BuildCompiler 共享的 esbuild 基础配置
 *
 * DevCompiler（vext dev）和 BuildCompiler（vext build）使用相同的底层 esbuild 配置，
 * 确保开发环境与生产环境的编译行为一致（CJS 输出、相同 target、相同 loader 映射）。
 *
 * 各编译器在此基础上叠加自己的选项：
 *   - DevCompiler：sourcemap: true（inline）、outdir → .vext/dev/、packages: 'external'
 *   - BuildCompiler：sourcemap: 'external'、outdir → dist/、minify（可选）
 *
 * @module lib/build/shared-esbuild-config
 * @see 09a-build.md §2.1（与 DevCompiler 的关系）
 * @see 11a-dev-compiler.md §3（DevCompiler 实现）
 * @see IMPLEMENTATION-PLAN.md 任务 2.1
 */

// ── 支持的文件扩展名 → esbuild Loader 映射 ─────────────────

/**
 * 文件扩展名到 esbuild Loader 的映射表
 *
 * 覆盖所有 Node.js/TypeScript 项目中可能出现的源文件类型：
 *   - .ts / .mts / .cts → 'ts'（TypeScript）
 *   - .js / .mjs / .cjs → 'js'（JavaScript）
 *   - .json → 'json'（JSON 配置文件）
 */
export const LOADER_MAP: Record<string, Loader> = {
  ".ts": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".js": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".json": "json",
};

// ── 入口扫描 glob 模式 ─────────────────────────────────────

/**
 * 源文件扫描 glob 模式
 *
 * 用于 fast-glob 扫描 src/ 目录下的所有可编译文件。
 * DevCompiler.start() 和 BuildCompiler.build() 均使用此模式。
 */
export const SOURCE_GLOB = "**/*.{ts,js,mjs,cjs}";

/**
 * 入口扫描排除模式
 *
 * 排除声明文件、测试文件等不应进入编译管线的文件：
 *   - *.d.ts — TypeScript 类型声明（仅类型，无运行时代码）
 *   - *.test.* / *.spec.* — 测试文件
 *   - __tests__/ — 测试目录
 */
export const SOURCE_IGNORE = [
  "**/*.d.ts",
  "**/*.test.*",
  "**/*.spec.*",
  "**/__tests__/**",
];

// ── 共享基础配置 ────────────────────────────────────────────

/**
 * createBaseEsbuildConfig — 创建 DevCompiler 与 BuildCompiler 共享的 esbuild 基础配置
 *
 * 返回一个 Partial<BuildOptions>，调用方需叠加以下必要字段：
 *   - entryPoints — 入口文件列表
 *   - outdir / outbase — 输出目录
 *   - sourcemap — 'inline' / true / 'external'（Dev 与 Build 不同）
 *   - packages — 'external'（Dev 使用，Build 可选）
 *
 * 设计选择说明：
 *   - format: 'cjs' — 统一输出 CommonJS，解决 ESM import 无法清除 require.cache 的问题
 *   - bundle: false — 逐文件编译，保持模块粒度（不合并文件）
 *   - treeShaking: true — 移除未使用的导出（即使不 bundle 也有效，可去除死代码分支）
 *   - keepNames: true — 保留函数/类名称（错误堆栈可读性、日志中可识别具名函数）
 *   - charset: 'utf8' — 强制 UTF-8 编码（避免 ASCII escape 导致中文乱码）
 *   - target: 'node18' — 与 package.json engines.node >= 18 对齐
 *
 * @param tsconfigPath tsconfig.json 路径（可选，默认 undefined 由 esbuild 自动查找）
 * @returns esbuild 基础配置对象
 *
 * @example
 * ```ts
 * const base = createBaseEsbuildConfig('/project/tsconfig.json');
 * const ctx = await esbuild.context({
 *   ...base,
 *   entryPoints: ['src/index.ts'],
 *   outdir: '.vext/dev/',
 *   outbase: 'src/',
 *   sourcemap: true,
 *   packages: 'external',
 * });
 * ```
 */
export function createBaseEsbuildConfig(
  tsconfigPath?: string,
): Partial<BuildOptions> {
  return {
    // ── 运行时目标 ──────────────────────────────────────
    platform: "node",
    target: "node18",

    // ── 输出格式 ────────────────────────────────────────
    //
    // CJS 保证 require.cache 可控：
    //   - ESM 的 import 语义不允许清除模块缓存（V8 内部缓存）
    //   - CJS 的 require 缓存挂在 require.cache 对象上，可以 delete
    //   - 这是热重载方案（Soft Reload Tier 1/2）的前提
    //
    format: "cjs",

    // ── 编译模式 ────────────────────────────────────────
    //
    // bundle: false → 逐文件编译（file-by-file transform）
    //   - 保持每个源文件 → 一个输出文件的映射关系
    //   - 不解析 import/require 依赖图（Node.js 运行时自己解析）
    //   - 与 esbuild.transform() 的单文件编译行为一致
    //
    bundle: false,

    // ── 优化选项 ────────────────────────────────────────
    treeShaking: true,
    keepNames: true,
    charset: "utf8",

    // ── TypeScript 配置 ─────────────────────────────────
    //
    // tsconfig 路径传入 esbuild.context() 时，esbuild 会自动解析 extends 链。
    // 传入 esbuild.transform() 时使用 tsconfigRaw（需手动展平），
    // 由 DevCompiler 负责预解析（见 11a-dev-compiler.md §3 resolveTsconfig）。
    //
    ...(tsconfigPath !== undefined ? { tsconfig: tsconfigPath } : {}),

    // ── Loader 映射 ────────────────────────────────────
    loader: { ...LOADER_MAP },

    // ── 日志级别 ────────────────────────────────────────
    //
    // warning 级别：
    //   - 隐藏 info 级别的日志（如 "N files transformed"）
    //   - 保留 warning 和 error（如类型推断问题、不支持的语法）
    //
    logLevel: "warning",
  };
}

// ── 辅助：从文件扩展名推断 esbuild Loader ──────────────────

/**
 * getLoaderForExtension — 从文件扩展名获取对应的 esbuild Loader
 *
 * 用于 esbuild.transform() 单文件编译场景（DevCompiler.compileSingle）。
 * .mjs / .cjs 映射为 'js' loader（esbuild 不区分 ESM/CJS 的 loader，
 * 输出格式由 format 选项决定）。
 *
 * @param ext 文件扩展名（含点号，如 '.ts'、'.mjs'）
 * @returns 对应的 esbuild Loader，未知扩展名返回 'default'
 */
export function getLoaderForExtension(ext: string): Loader {
  return LOADER_MAP[ext] ?? ("default" as Loader);
}
