import fs from "node:fs";
import path from "node:path";

/**
 * detect-project.ts — 项目自动检测工具
 *
 * 从给定的工作目录（或向上查找）自动发现 vext 项目结构：
 *   - 项目根目录（package.json 所在位置）
 *   - 源码目录（rootDir/src）
 *   - 项目语言（TypeScript / JavaScript，由 tsconfig.json 存在性判断）
 *   - 框架启动入口文件（vextjs 内部 bootstrap 文件路径）
 *
 * Fail Fast 检测：
 *   - 找不到 package.json → 抛出错误
 *   - src/ 目录不存在 → 抛出错误
 *   - src/config/ 目录不存在 → 抛出错误
 *   - src/config/default.{ts|js} 不存在 → 抛出错误
 *
 * @module cli/utils/detect-project
 * @see 09-cli.md §4（项目检测工具）
 * @see IMPLEMENTATION-PLAN.md 任务 1.18
 */

// ── 类型定义 ────────────────────────────────────────────────

/**
 * 项目检测结果
 */
export interface ProjectInfo {
  /** 项目根目录（package.json 所在位置的绝对路径） */
  rootDir: string;

  /** 源码目录（rootDir/src 的绝对路径） */
  srcDir: string;

  /** 项目语言（由 tsconfig.json 存在性推断） */
  language: "ts" | "js";

  /**
   * 框架启动入口文件路径
   *
   * 指向 vextjs 框架内部的 bootstrap 文件：
   *   - 未编译时：node_modules/vextjs/dist/lib/bootstrap.js
   *   - 已编译时（dist/ 存在）：dist/lib/bootstrap.js（由 CLI 决定）
   *
   * CLI 的 vext start 会 fork 此文件作为子进程入口。
   */
  entryFile: string;
}

// ── 主函数 ──────────────────────────────────────────────────

/**
 * detectProject — 自动发现项目结构
 *
 * 从指定目录开始，向上查找 package.json 确定项目根目录，
 * 然后检测 src/ 目录、tsconfig.json、src/config/default 文件。
 *
 * @param cwd 起始目录（通常是 process.cwd()）
 * @returns 项目信息
 * @throws 找不到 package.json / src / config / default 配置文件时抛出描述性错误
 */
export function detectProject(cwd: string): ProjectInfo {
  const rootDir = findProjectRoot(cwd);

  // ── 检测 src/ 目录 ──────────────────────────────────────
  const srcDir = path.join(rootDir, "src");
  if (!fs.existsSync(srcDir)) {
    throw new Error(
      `[vextjs] src/ directory not found in ${rootDir}\n` +
        `         vextjs requires a src/ directory with routes/, services/, etc.`,
    );
  }

  // ── 检测语言 ────────────────────────────────────────────
  const hasTsconfig = fs.existsSync(path.join(rootDir, "tsconfig.json"));
  const language: "ts" | "js" = hasTsconfig ? "ts" : "js";

  // ── 检测 config/ 目录 ───────────────────────────────────
  const configDir = path.join(srcDir, "config");
  if (!fs.existsSync(configDir)) {
    throw new Error(
      `[vextjs] src/config/ directory not found.\n` +
        `         Create src/config/default.${language === "ts" ? "ts" : "js"} with your configuration.`,
    );
  }

  // ── 检测 config/default 文件 ────────────────────────────
  const configExts =
    language === "ts"
      ? ["default.ts"]
      : ["default.js", "default.mjs", "default.cjs"];
  const hasDefaultConfig = configExts.some((ext) =>
    fs.existsSync(path.join(configDir, ext)),
  );
  if (!hasDefaultConfig) {
    throw new Error(
      `[vextjs] src/config/default.${language === "ts" ? "ts" : "js"} not found.\n` +
        `         This file is required and must contain your base configuration.`,
    );
  }

  // ── 启动入口 ────────────────────────────────────────────
  //
  // 入口文件是 vextjs 框架内部的 bootstrap.js（编译后），
  // CLI 的 vext start 会 fork 此文件。
  //
  // bootstrap.ts 内部通过 VEXT_MODE 环境变量检测到被 CLI fork，
  // 自动执行 bootstrap(rootDir) 启动流程。
  //
  const entryFile = path.join(
    rootDir,
    "node_modules",
    "vextjs",
    "dist",
    "lib",
    "bootstrap.js",
  );

  return { rootDir, srcDir, language, entryFile };
}

// ── 辅助函数 ────────────────────────────────────────────────

/**
 * findProjectRoot — 从 cwd 向上查找 package.json 所在目录
 *
 * 沿目录树向上逐层查找，直到找到包含 package.json 的目录。
 * 到达文件系统根目录仍未找到时抛出错误。
 *
 * @param cwd 起始目录
 * @returns 项目根目录的绝对路径
 * @throws 找不到 package.json 时抛出描述性错误
 */
export function findProjectRoot(cwd: string): string {
  let dir = path.resolve(cwd);

  while (true) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      // 到达文件系统根目录
      throw new Error(
        `[vextjs] Cannot find package.json.\n` +
          `         Run "vext" from your project root directory.`,
      );
    }
    dir = parent;
  }
}

/**
 * hasDistBuild — 检测是否存在 dist/ 编译产物
 *
 * 当 dist/ 目录存在时，vext start 应使用编译后的 JS 运行，
 * 无需 tsx 等 TypeScript 运行时支持。
 *
 * @param rootDir 项目根目录
 * @returns 是否存在 dist/ 目录
 */
export function hasDistBuild(rootDir: string): boolean {
  return fs.existsSync(path.join(rootDir, "dist"));
}

/**
 * resolveEntryFile — 解析实际的入口文件路径
 *
 * 入口文件始终指向框架内部的 bootstrap.js（node_modules/vextjs/dist/lib/bootstrap.js）。
 * 用户项目的 dist/ 目录只包含用户业务代码的编译产物，不包含框架 bootstrap。
 *
 * dist/ 的存在与否通过 VEXT_BUILT 环境变量告知 bootstrap，
 * bootstrap 据此决定从 dist/ 还是 src/ 加载用户代码。
 *
 * @param project 项目检测结果
 * @returns 实际的入口文件绝对路径（始终为框架内部 bootstrap）
 */
export function resolveEntryFile(project: ProjectInfo): string {
  // 始终使用框架内部的 bootstrap 文件
  // CLI 通过 VEXT_BUILT=1 环境变量告知 bootstrap 从 dist/ 加载用户代码
  return project.entryFile;
}
