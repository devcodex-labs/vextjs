import { existsSync } from "node:fs";
import { join, basename, sep } from "node:path";
import { isMiddleware, isMiddlewareFactory } from "./define-middleware.js";
import { resolveModuleDefault } from "./interop.js";
import type { VextMiddleware } from "../types/middleware.js";
import type { VextLogger } from "../types/app.js";

/**
 * middleware-loader.ts — 路由级中间件白名单加载器
 *
 * 按 config/default.ts 中 middlewares 白名单声明，从 src/middlewares/ 目录
 * 加载用户定义的路由级中间件，构建 MiddlewareRegistry 供 router-loader 使用。
 *
 * 核心流程：
 *   1. 遍历 config.middlewares 白名单（字符串或 { name, options } 对象）
 *   2. 按 name 在 middlewaresDir 中查找对应文件（.ts/.js/.mjs/.cjs 优先级）
 *   3. 动态 import 获取 default export
 *   4. 通过 isMiddleware / isMiddlewareFactory 检测类型（显式标记优先）
 *   5. 兜底：未使用 defineMiddleware / defineMiddlewareFactory 的裸函数 → 运行时推断 + 警告
 *   6. 声明一致性检查（普通中间件不能带 options / 工厂中间件不带 options 时宽松处理）
 *   7. 构建 MiddlewareRegistry（name → { handler, defaultOptions, kind }）
 *
 * Fail Fast 检测项：
 *   - 白名单声明了但文件不存在
 *   - 文件无 default export
 *   - default export 不是函数
 *   - 普通中间件（defineMiddleware）却在白名单中声明了 options
 *
 * @module lib/middleware-loader
 * @see IMPLEMENTATION-PLAN.md 任务 1.10
 * @see 01b-middlewares.md §7（框架内部 middleware-loader.ts）
 */

// ── 公共类型 ──────────────────────────────────────────────────

/**
 * 中间件白名单中的声明格式
 *
 * 与 config/default.ts 中 middlewares 数组的元素类型对齐。
 *
 * 字符串：只声明名称，无默认参数
 * 对象：声明名称 + 默认参数（工厂中间件使用）
 */
export type MiddlewareDecl =
  | string
  | { name: string; options?: Record<string, unknown> };

/**
 * 中间件注册表中的单条记录
 *
 * 包含中间件处理函数、默认参数和类型标识。
 * router-loader 在路由注册时从 registry 中按 name 取出记录，
 * 根据 kind 决定是直接使用还是调用工厂函数。
 */
export interface MiddlewareRegistryEntry {
  /** 中间件处理函数（普通）或工厂函数 */
  handler:
    | VextMiddleware
    | ((options?: Record<string, unknown>) => VextMiddleware);

  /** 白名单中声明的默认参数（仅工厂中间件有值） */
  defaultOptions: Record<string, unknown> | undefined;

  /** 中间件类型标识 */
  kind: "middleware" | "factory";
}

/**
 * MiddlewareRegistry — 中间件注册表
 *
 * name → MiddlewareRegistryEntry 的映射。
 * 由 loadMiddlewares() 构建，传递给 router-loader 使用。
 */
export type MiddlewareRegistry = Record<string, MiddlewareRegistryEntry>;

// ── 支持的文件扩展名（按优先级排列）──────────────────────────

const EXTENSIONS = [".ts", ".js", ".mjs", ".cjs"] as const;

// ── 主函数 ────────────────────────────────────────────────────

/**
 * loadMiddlewares — 按白名单加载中间件，构建 MiddlewareRegistry
 *
 * @param middlewaresDir  src/middlewares/ 目录的绝对路径
 * @param declarations    config.middlewares 白名单声明数组
 * @param logger          VextLogger 实例（输出兼容性警告）
 * @returns MiddlewareRegistry（name → { handler, defaultOptions, kind }）
 *
 * @example
 * ```typescript
 * // bootstrap 内部
 * const middlewareDefs = await loadMiddlewares(
 *   path.join(rootDir, 'src/middlewares'),
 *   app.config.middlewares,
 *   app.logger,
 * )
 * ```
 */
export async function loadMiddlewares(
  middlewaresDir: string,
  declarations: MiddlewareDecl[],
  logger: VextLogger,
): Promise<MiddlewareRegistry> {
  const registry: MiddlewareRegistry = {};

  // 白名单为空 → 无中间件需要加载，直接返回
  if (!declarations || declarations.length === 0) {
    return registry;
  }

  for (const decl of declarations) {
    const name = typeof decl === "string" ? decl : decl.name;
    const defaultOptions = typeof decl === "string" ? undefined : decl.options;

    // ── 1. 查找文件（多扩展名）─────────────────────────────
    const fullPath = resolveFile(middlewaresDir, name);

    if (!fullPath) {
      throw new Error(
        `[vextjs] Middleware "${name}" declared in config/default.ts\n` +
          `         but no matching file found in src/middlewares/.\n` +
          `         Searched: ${EXTENSIONS.map((e) => `${name}${e}`).join(", ")}`,
      );
    }

    // ── 2. 动态 import ────────────────────────────────────
    const mod = await importMiddlewareFile(fullPath, name);

    const handler = resolveModuleDefault(mod);

    if (!handler) {
      throw new Error(
        `[vextjs] src/middlewares/${basename(fullPath)} has no default export.\n` +
          `         Must export default defineMiddleware(fn) or defineMiddlewareFactory(fn).`,
      );
    }

    // ── 3. 检测中间件类型（显式标记优先，运行时推断兜底）───
    let kind: "middleware" | "factory";

    if (isMiddlewareFactory(handler)) {
      kind = "factory";
    } else if (isMiddleware(handler)) {
      kind = "middleware";
    } else if (typeof handler === "function") {
      // 兜底：未使用 defineMiddleware / defineMiddlewareFactory 包装
      // 退化为运行时推断（defaultOptions 存在 → factory，否则 → middleware）
      kind = defaultOptions !== undefined ? "factory" : "middleware";
      logger.warn(
        `[vextjs] middlewares/${basename(fullPath)}: export default without ` +
          `defineMiddleware() / defineMiddlewareFactory() is deprecated. ` +
          `Please wrap your middleware for explicit type declaration.`,
      );
    } else {
      throw new Error(
        `[vextjs] src/middlewares/${basename(fullPath)} default export is not a function.\n` +
          `         Expected defineMiddleware(fn) or defineMiddlewareFactory(fn).\n` +
          `         Got: ${typeof handler}`,
      );
    }

    // ── 4. 声明一致性检查 ─────────────────────────────────
    //
    // 如果白名单声明了 options，但文件导出的是 defineMiddleware（普通中间件），
    // 说明声明与实现不匹配 → Fail Fast。
    //
    if (kind === "middleware" && defaultOptions !== undefined) {
      throw new Error(
        `[vextjs] Middleware "${name}" is declared with options in config,\n` +
          `         but src/middlewares/${basename(fullPath)} exports defineMiddleware() (not a factory).\n` +
          `         Use defineMiddlewareFactory() if this middleware accepts options.`,
      );
    }

    // ── 5. 写入 registry ──────────────────────────────────
    registry[name] = {
      handler: handler as
        | VextMiddleware
        | ((options?: Record<string, unknown>) => VextMiddleware),
      defaultOptions,
      kind,
    };
  }

  if (Object.keys(registry).length > 0) {
    logger.info(
      `[vextjs] ${Object.keys(registry).length} middleware(s) loaded: ${Object.keys(registry).join(", ")}`,
    );
  }

  return registry;
}

// ── 中间件解析（路由引用时使用）──────────────────────────────

/**
 * resolveMiddleware — 从 registry 中解析单个中间件引用
 *
 * 路由 options.middlewares 中的每个引用（字符串或 { name, options }）
 * 通过此函数从 registry 中取出并实例化：
 *   - 普通中间件 → 直接返回 handler
 *   - 工厂中间件 → 使用路由覆盖 options 或默认 options 调用工厂
 *
 * @param ref      路由中的中间件引用
 * @param registry 已构建的中间件注册表
 * @returns 实例化后的 VextMiddleware
 * @throws 引用的中间件不在 registry 中 / 类型不匹配
 */
export function resolveMiddleware(
  ref: string | { name: string; options?: Record<string, unknown> },
  registry: MiddlewareRegistry,
): VextMiddleware {
  const name = typeof ref === "string" ? ref : ref.name;
  const overrideOpts = typeof ref === "string" ? undefined : ref.options;

  const entry = registry[name];
  if (!entry) {
    throw new Error(
      `[vextjs] Middleware "${name}" is not registered.\n` +
        `         Available middlewares: ${Object.keys(registry).join(", ") || "(none)"}\n` +
        `         Make sure "${name}" is declared in config/default.ts middlewares array.`,
    );
  }

  // ── 工厂中间件 → 调用工厂 ─────────────────────────────────
  if (entry.kind === "factory") {
    // 参数优先级：路由覆盖 > 白名单默认值
    const finalOptions = overrideOpts ?? entry.defaultOptions;

    // 工厂中间件在无 options 时也允许调用（options 为 undefined）
    // 具体是否需要 options 由工厂函数自身决定
    const factory = entry.handler as (
      options?: Record<string, unknown>,
    ) => VextMiddleware;
    return factory(finalOptions);
  }

  // ── 普通中间件 → 直接使用 ─────────────────────────────────
  if (overrideOpts !== undefined) {
    throw new Error(
      `[vextjs] Middleware "${name}" is not a factory and does not accept options.\n` +
        `         Remove the options or use defineMiddlewareFactory() in the middleware file.`,
    );
  }

  return entry.handler as VextMiddleware;
}

/**
 * resolveMiddlewares — 批量解析中间件引用列表
 *
 * 将路由 options.middlewares 数组中的所有引用解析为 VextMiddleware 数组。
 *
 * @param refs     中间件引用列表
 * @param registry 已构建的中间件注册表
 * @returns VextMiddleware 数组（按声明顺序）
 */
export function resolveMiddlewares(
  refs: Array<string | { name: string; options?: Record<string, unknown> }>,
  registry: MiddlewareRegistry,
): VextMiddleware[] {
  return refs.map((ref) => resolveMiddleware(ref, registry));
}

/**
 * validateMiddlewareRefs — 启动时统一验证所有路由的中间件引用
 *
 * 在所有路由加载完成后调用，检查每条路由引用的中间件名称
 * 是否都在 registry 中存在。不存在则 Fail Fast。
 *
 * 这是 router-loader 在注册所有路由后的最后一道防线，
 * 确保不会有运行时才暴露的"中间件未注册"错误。
 *
 * @param routeDefs      所有加载的路由定义对象
 * @param registry       已构建的中间件注册表
 * @throws 引用的中间件名称不在 registry 中
 */
export function validateMiddlewareRefs(
  routeDefs: Array<{
    routes: Array<{
      method: string;
      path: string;
      options: { middlewares?: Array<string | { name: string }> };
    }>;
    sourceFile: string;
  }>,
  registry: MiddlewareRegistry,
): void {
  for (const def of routeDefs) {
    for (const route of def.routes) {
      const refs = route.options.middlewares;
      if (!refs || refs.length === 0) continue;

      for (const ref of refs) {
        const name = typeof ref === "string" ? ref : ref.name;
        if (!registry[name]) {
          throw new Error(
            `[vextjs] Route ${route.method} references middleware "${name}" which is not registered.\n` +
              `         Source: ${def.sourceFile}\n` +
              `         Available middlewares: ${Object.keys(registry).join(", ") || "(none)"}\n` +
              `         Make sure "${name}" is declared in config/default.ts middlewares array.`,
          );
        }
      }
    }
  }
}

// ── 内部辅助函数 ──────────────────────────────────────────────

/**
 * resolveFile — 在 middlewaresDir 下查找指定 name 对应的文件
 *
 * 按扩展名优先级依次查找：.ts → .js → .mjs → .cjs
 * 返回找到的第一个文件的完整路径，或 null。
 *
 * @param middlewaresDir 中间件目录的绝对路径
 * @param name          中间件名称（如 'auth'、'rate-limit'）
 * @returns 完整文件路径或 null
 */
function resolveFile(middlewaresDir: string, name: string): string | null {
  for (const ext of EXTENSIONS) {
    const full = join(middlewaresDir, `${name}${ext}`);
    if (existsSync(full)) return full;
  }
  return null;
}

/**
 * importMiddlewareFile — 动态 import 中间件文件
 *
 * 将文件路径转为 file:// URL 后进行 dynamic import。
 * 错误时包装为 vextjs 错误。
 *
 * @param fullPath 文件的绝对路径
 * @param name     中间件名称（用于错误信息）
 * @returns 模块对象
 */
async function importMiddlewareFile(
  fullPath: string,
  name: string,
): Promise<Record<string, unknown>> {
  try {
    const fileUrl = pathToFileUrl(fullPath);
    return await import(fileUrl);
  } catch (err) {
    throw new Error(
      `[vextjs] Failed to import middleware "${name}".\n` +
        `         File: ${fullPath}\n` +
        `         ${(err as Error).message}`,
    );
  }
}

/**
 * 将文件系统路径转为 file:// URL
 *
 * dynamic import 在 Windows 上需要 file:// 协议前缀才能正确加载。
 */
function pathToFileUrl(filePath: string): string {
  let normalized = filePath.split(sep).join("/");

  // Windows 路径（如 C:/Users/...）需要额外的 / 前缀
  if (/^[a-zA-Z]:/.test(normalized)) {
    normalized = "/" + normalized;
  }

  return "file://" + normalized;
}
