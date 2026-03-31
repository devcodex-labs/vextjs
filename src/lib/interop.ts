/**
 * interop.ts — ESM/CJS 模块互操作工具函数
 *
 * 解决 esbuild CJS 编译产物通过 dynamic import() 加载时的 "double default" 问题。
 *
 * 背景：
 *   - DevCompiler 将用户源码（ESM）编译为 CJS 格式（format: 'cjs'），
 *     输出到 .vext/dev/ 目录，用于 Soft Reload 热替换（require.cache 清除）。
 *   - esbuild 编译 ESM → CJS 时，会生成如下结构：
 *
 *       var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
 *       var exports = {};
 *       __export(exports, { default: () => my_default });
 *       module.exports = __toCommonJS(exports);
 *       var my_default = defineRoutes((app) => { ... });
 *
 *   - 当框架 loader（router-loader、config-loader 等）通过 `await import(fileUrl)`
 *     加载这些 CJS 文件时，Node.js 的 ESM/CJS interop 会将 `module.exports` 整体
 *     作为 ESM 的 `default` 导出。
 *
 *   - 结果是 `mod.default` = `{ __esModule: true, default: defineRoutes(...) }`，
 *     而真正的 RouteDefinition 在 `mod.default.default`（"double default"）。
 *
 * 解决方案：
 *   提供 `resolveModuleDefault(mod)` 工具函数，自动检测并解包：
 *     - 如果 `mod.default` 有 `__esModule` 标记且内部有 `default` 属性 → 返回内部 `default`
 *     - 否则 → 返回 `mod.default`（标准 ESM 行为）
 *
 * 使用方式：
 *   ```typescript
 *   import { resolveModuleDefault } from './interop.js'
 *
 *   const mod = await import(fileUrl)
 *   const defaultExport = resolveModuleDefault(mod)
 *   ```
 *
 * 影响范围：
 *   所有通过 dynamic import() 加载用户文件的 loader：
 *   - router-loader.ts（路由文件）
 *   - config-loader.ts（配置文件）
 *   - plugin-loader.ts（插件文件）
 *   - service-loader.ts（服务文件）
 *   - middleware-loader.ts（中间件文件）
 *   - i18n-loader.ts（语言包文件）
 *
 * @module lib/interop
 * @see shared-esbuild-config.ts §format: 'cjs'（CJS 输出格式的设计原因）
 * @see 11-hot-reload.md §2（Soft Reload 依赖 CJS require.cache 清除）
 */

// ── 类型定义 ────────────────────────────────────────────────

/**
 * esbuild CJS 编译产物的 __esModule 标记对象
 *
 * esbuild 将 ESM `export default xxx` 编译为 CJS 时，
 * 输出对象结构为 `{ __esModule: true, default: xxx, ...namedExports }`。
 */
interface EsbuildCjsModule {
  __esModule: true;
  default?: unknown;
  [key: string]: unknown;
}

// ── 核心函数 ────────────────────────────────────────────────

/**
 * resolveModuleDefault — 解析模块的 default export（处理 CJS interop）
 *
 * 当 `await import()` 加载 esbuild CJS 编译产物时：
 *   - Node.js 将 `module.exports` 整体作为 ESM `default`
 *   - esbuild 的 `module.exports` 是 `{ __esModule: true, default: 实际值 }`
 *   - 导致 `mod.default` 不是用户的 default export，而是一个包装对象
 *
 * 此函数自动检测并解包，返回用户的真实 default export。
 *
 * @param mod dynamic import() 返回的模块对象
 * @returns 用户的真实 default export（解包后的值），如果不存在则返回 undefined
 *
 * @example
 * // ESM 源码文件（标准路径，无需解包）
 * const mod = await import('file:///path/to/esm-file.js')
 * resolveModuleDefault(mod)  // → mod.default（原样返回）
 *
 * @example
 * // esbuild CJS 编译产物（需要解包）
 * // mod.default = { __esModule: true, default: defineRoutes(...) }
 * const mod = await import('file:///path/to/.vext/dev/routes/index.js')
 * resolveModuleDefault(mod)  // → defineRoutes(...)（解包内部 default）
 *
 * @example
 * // CJS 模块无 __esModule 标记（标准 CJS）
 * // mod.default = { someKey: 'value' }
 * const mod = await import('file:///path/to/cjs-file.js')
 * resolveModuleDefault(mod)  // → { someKey: 'value' }（原样返回）
 */
export function resolveModuleDefault<T = unknown>(
  mod: Record<string, unknown>,
): T | undefined {
  const defaultExport = mod.default;

  // 无 default export
  if (defaultExport === undefined || defaultExport === null) {
    return undefined;
  }

  // 检测 esbuild CJS interop 的 __esModule 标记
  // 当 mod.default 是对象且有 __esModule: true 时，说明是 esbuild 编译产物
  // 被 Node.js ESM loader 包装了一层，真正的 default 在 mod.default.default
  if (isEsbuildCjsModule(defaultExport)) {
    // 内部可能有也可能没有 default（如 CJS 只有 named exports 无 default）
    return defaultExport.default as T | undefined;
  }

  // 标准 ESM default export，直接返回
  return defaultExport as T;
}

/**
 * resolveModuleExport — 解析模块的指定 named export（处理 CJS interop）
 *
 * 与 resolveModuleDefault 类似，但用于获取 named export。
 *
 * CJS interop 场景下：
 *   - `mod.default` = `{ __esModule: true, default: xxx, namedA: yyy }`
 *   - named export 在 `mod.default.namedA` 而非 `mod.namedA`
 *
 * 标准 ESM 场景下：
 *   - named export 直接在 `mod.namedA`
 *
 * @param mod  dynamic import() 返回的模块对象
 * @param name 导出名称
 * @returns 指定 named export 的值，如果不存在则返回 undefined
 */
export function resolveModuleExport<T = unknown>(
  mod: Record<string, unknown>,
  name: string,
): T | undefined {
  // 优先检查标准 ESM named export（直接在 mod 上）
  if (name in mod && name !== "default") {
    return mod[name] as T | undefined;
  }

  // 检查 CJS interop：named export 可能在 mod.default 内部
  const defaultExport = mod.default;
  if (isEsbuildCjsModule(defaultExport) && name in defaultExport) {
    return defaultExport[name] as T | undefined;
  }

  return undefined;
}

// ── 内部工具 ────────────────────────────────────────────────

/**
 * isEsbuildCjsModule — 检测是否为 esbuild CJS 编译产物的包装对象
 *
 * 检测条件：
 *   1. 是对象（非 null）
 *   2. 有 __esModule 属性且值为 true
 *
 * 注意：
 *   - 不检查 typeof === 'object'，因为 class 和 function 也可以有属性
 *   - 只检查 __esModule === true（严格相等），避免误判
 */
function isEsbuildCjsModule(value: unknown): value is EsbuildCjsModule {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as Record<string, unknown>).__esModule === true &&
    "default" in (value as Record<string, unknown>)
  );
}
