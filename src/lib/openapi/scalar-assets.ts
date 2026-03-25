/**
 * scalar-assets.ts — 本地 Scalar 资产自动检测、安装与路由注册
 *
 * 封装 @scalar/api-reference 包的完整生命周期：
 *   - 本地包检测（基于用户项目根目录的模块解析）
 *   - 自动包管理器识别（npm / pnpm / yarn / bun）
 *   - 首次启动自动安装（execSync，输出对用户可见）
 *   - 文件内容读取与内存缓存
 *   - 本地静态路由注册（GET /_vext/scalar.js）
 *
 * 设计原则：
 *   - 本地优先，零 CDN 依赖（openapi.enabled: true 时强制本地服务）
 *   - 用户配置 scalar.cdnUrl 时完全跳过（尊重显式配置）
 *   - 安装失败时抛出明确错误（不静默降级回 CDN）
 *
 * @module lib/openapi/scalar-assets
 * @changelog
 *   - v0.2.2: 初始版本（本地资产自动安装 + 本地路由注册）
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { VextApp } from "../../types/app.js";

const LOCAL_SCALAR_ROUTE = "/_vext/scalar.js";
const SCALAR_PKG = "@scalar/api-reference";

/**
 * Standalone JS 在 @scalar/api-reference 包内的候选路径（按优先级降序）
 *
 * dist/browser/standalone.js — 1.x 版本显式浏览器独立构建（首选）
 * dist/index.js              — 旧版本或非标准目录结构的 fallback
 */
const SCALAR_STANDALONE_CANDIDATES = [
  join("dist", "browser", "standalone.js"),
  join("dist", "index.js"),
];

/**
 * 注册本地 Scalar 资产路由（自动安装 + 本地服务，无 CDN 回退）
 *
 * 执行流程：
 *   1. 用户配置了 cdnUrl → 立即返回 null（不干预用户配置）
 *   2. 本地包已安装 → 读取文件 → 注册路由 → 返回本地路由路径
 *   3. 本地包未安装 → 自动安装 → 读取文件 → 注册路由 → 返回本地路由路径
 *   4. 任意步骤失败 → throw Error（含具体原因 + 手动修复命令）
 *
 * @param app                  VextApp 实例
 * @param userConfiguredCdnUrl 用户在 scalar.cdnUrl 中配置的地址（若存在则跳过）
 * @returns 本地路由路径（'/_vext/scalar.js'）或 null（用户已配置 cdnUrl）
 * @throws  包安装失败 / 文件读取失败时
 */
export function registerScalarAssets(
  app: VextApp,
  userConfiguredCdnUrl?: string,
): string | null {
  // 用户显式配置优先，完全跳过检测和安装
  if (userConfiguredCdnUrl) {
    return null;
  }

  // 第一次尝试解析：包已安装则直接使用
  let filePath = resolveScalarStandalonePath();

  // 包未安装：自动安装后重试
  if (!filePath) {
    autoInstallScalar(app);
    filePath = resolveScalarStandalonePath();

    if (!filePath) {
      throw new Error(
        "[openapi] 自动安装 @scalar/api-reference 后仍无法解析包路径。\n" +
          "请手动安装后重启服务：\n" +
          "  npm install @scalar/api-reference\n" +
          "  pnpm add @scalar/api-reference\n" +
          "  yarn add @scalar/api-reference\n" +
          "  bun add @scalar/api-reference",
      );
    }

    app.logger.info("[openapi] @scalar/api-reference 安装成功");
  }

  // 读取文件内容（启动时缓存，应用生命周期内不变）
  let fileContent: string;
  try {
    fileContent = readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new Error(
      `[openapi] 读取 @scalar/api-reference 文件失败：${(err as Error).message}\n` +
        `文件路径：${filePath}\n` +
        "请检查文件权限或重新安装：npm install @scalar/api-reference",
    );
  }

  // 注册本地静态资产路由
  // 文件内容在启动时已缓存到 fileContent 闭包变量，请求时直接返回，无 I/O 开销
  app.adapter.registerRoute("GET", LOCAL_SCALAR_ROUTE, [
    async (_req, res) => {
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.text(fileContent);
    },
  ]);

  app.logger.info(`[openapi] Scalar 资产: ${LOCAL_SCALAR_ROUTE} (本地模式)`);
  return LOCAL_SCALAR_ROUTE;
}

/**
 * 自动安装 @scalar/api-reference
 *
 * 使用检测到的项目包管理器执行安装命令。
 * stdio: 'inherit' 使安装进度输出对用户可见。
 * 安装失败时记录错误日志；调用方通过重新 resolve 判断是否需要 throw。
 */
function autoInstallScalar(app: VextApp): void {
  const pm = detectPackageManager();
  const installCmds: Record<"npm" | "pnpm" | "yarn" | "bun", string> = {
    npm: `npm install ${SCALAR_PKG} --no-save`,
    pnpm: `pnpm add ${SCALAR_PKG}`,
    yarn: `yarn add ${SCALAR_PKG}`,
    bun: `bun add ${SCALAR_PKG}`,
  };
  const cmd = installCmds[pm];

  app.logger.info(
    `[openapi] @scalar/api-reference 未安装，正在自动安装...\n` +
      `[openapi] 执行: ${cmd}`,
  );

  try {
    execSync(cmd, {
      stdio: "inherit",
      cwd: process.cwd(),
    });
  } catch (err) {
    // execSync 在非零退出码时抛出；记录错误后由调用方通过 resolve 重试判断
    app.logger.error(`[openapi] 自动安装失败：${(err as Error).message}`);
  }
}

/**
 * 检测用户项目使用的包管理器
 *
 * 通过检查项目根目录（process.cwd()）中的 lockfile 判断。
 * 优先级：pnpm > yarn > bun > npm（默认）。
 */
function detectPackageManager(): "npm" | "pnpm" | "yarn" | "bun" {
  const cwd = process.cwd();
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(join(cwd, "bun.lockb"))) return "bun";
  return "npm";
}

/**
 * 解析 @scalar/api-reference 包的 standalone JS 文件绝对路径
 *
 * ⚠️ 使用 process.cwd() 作为模块解析基础，而非 import.meta.url。
 *
 * 原因：vext 可能作为 "file:../vext" 本地依赖被引用（如 vext-test）。
 * Node.js 默认跟随符号链接，import.meta.url 会指向 vext 的真实磁盘路径
 * （如 E:/MySelf/vext/src/...），而非用户项目目录。
 * 以 import.meta.url 创建的 require 无法向上遍历到用户项目的 node_modules/，
 * 导致即使用户已安装 @scalar/api-reference 也始终返回 null。
 *
 * process.cwd() 始终是用户执行 `vext dev/start` 时的项目根目录，
 * 以此创建的 require 能直接解析到用户项目的 node_modules/。
 *
 * 两级解析策略（应对 exports 字段屏蔽 ./package.json 的情况）：
 *   策略 1：resolve('@scalar/api-reference/package.json')
 *           — 适用于旧版或未设置严格 exports 的包（直接拿到 pkgDir）
 *   策略 2：resolve('@scalar/api-reference') 取主入口，再向上遍历目录树查找
 *           含 package.json 的目录（应对 @scalar ≥ 1.x 的严格 exports 限制）
 *
 * @returns 文件绝对路径，或 null（包未安装 / standalone 文件不存在）
 */
function resolveScalarStandalonePath(): string | null {
  try {
    // 从用户项目根目录解析，支持 file: 依赖、monorepo hoisting 等场景
    const require = createRequire(join(process.cwd(), "package.json"));

    // ── 策略 1：直接解析 ./package.json（旧版包 / 无严格 exports 限制）────
    let pkgDir: string | null = null;
    try {
      const pkgJsonPath = require.resolve(`${SCALAR_PKG}/package.json`);
      pkgDir = dirname(pkgJsonPath);
    } catch {
      // exports 字段屏蔽了 ./package.json（@scalar ≥ 1.x 常见）→ 进入策略 2
    }

    // ── 策略 2：解析主入口，向上遍历目录树查找包根 ───────────────────────
    if (!pkgDir) {
      const mainEntry = require.resolve(SCALAR_PKG);
      pkgDir = findPackageRoot(mainEntry);
    }

    if (!pkgDir) return null;

    for (const candidate of SCALAR_STANDALONE_CANDIDATES) {
      const filePath = join(pkgDir, candidate);
      if (existsSync(filePath)) {
        return filePath;
      }
    }

    // 包已安装但 standalone 文件路径不在候选列表中
    return null;
  } catch {
    // 包未安装时 createRequire().resolve() 抛出 MODULE_NOT_FOUND
    return null;
  }
}

/**
 * 从给定文件路径向上遍历目录树，查找最近的包根目录（含 package.json 的目录）
 *
 * 用于策略 2：在无法直接 resolve './package.json' 时，
 * 通过主入口文件路径反向推导包根目录。
 *
 * 最多向上遍历 5 层，避免无限循环或跨越 node_modules 边界。
 *
 * 示例：
 *   输入 .../node_modules/@scalar/api-reference/dist/index.js
 *   遍历路径：dist/ → @scalar/api-reference/（含 package.json → 命中）
 *
 * @param filePath  require.resolve() 返回的绝对文件路径
 * @returns         包根目录绝对路径，或 null（未找到）
 */
function findPackageRoot(filePath: string): string | null {
  let dir = dirname(filePath);
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // 到达文件系统根目录
    dir = parent;
  }
  return null;
}
