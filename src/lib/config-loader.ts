/**
 * config-loader.ts — 配置加载器
 *
 * 负责加载并合并三层配置文件（default → env → local），
 * 执行 Fail Fast 校验，然后 deepFreeze 返回只读配置对象。
 *
 * 合并规则（含 CJS interop 支持）：
 *   - 普通标量（port、host）：覆盖（后者优先）
 *   - 普通对象（logger、cors）：深度合并（只覆盖写了的子字段）
 *   - middlewares[] 数组：按 name patch 合并（匹配则浅合并，未匹配则追加）
 *
 * 配置文件结构：
 *   src/config/
 *   ├── default.ts       — 基准配置（必须存在）
 *   ├── development.ts   — 开发环境覆盖（可选）
 *   ├── production.ts    — 生产环境覆盖（可选）
 *   └── local.ts         — 本地覆盖（最高优先级，可选，不提交 git）
 *
 * @module lib/config-loader
 * @see 05-config.md §5（配置合并规则）
 * @see IMPLEMENTATION-PLAN.md 任务 1.1
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { VextConfig, VextMiddlewareConfig } from "../types/app.js";
import { DEFAULT_CONFIG } from "./app.js";
import {
  loadBootstrapConfigPatch,
  type BootstrapCommand,
} from "./bootstrap-config.js";

// ── 常量 ────────────────────────────────────────────────────

const FETCH_PROXY_RESERVED_TARGET_NAMES = new Set(["then"]);

/**
 * 支持的配置文件扩展名（按优先级排序）
 *
 * 优先 .ts（TypeScript 项目推荐），其次 .js / .mjs / .cjs（兼容纯 JS 项目）。
 */
const EXTENSIONS = [".ts", ".js", ".mjs", ".cjs"] as const;

// ── 中间件声明类型 ──────────────────────────────────────────

/**
 * 中间件声明的两种形式：
 *   - 字符串：中间件名称（如 'auth'）
 *   - 对象：带配置的中间件声明（如 { name: 'auth', options: { ... } }）
 */
type MiddlewareDecl = string | (VextMiddlewareConfig & { enabled?: boolean });

export interface LoadConfigMetadata {
  providerPatch?: Record<string, unknown>;
}

export interface LoadConfigOptions {
  rootDir?: string;
  command?: BootstrapCommand;
  isBuilt?: boolean;
  env?: NodeJS.ProcessEnv;
  meta?: LoadConfigMetadata;
}

// ── 文件解析 ────────────────────────────────────────────────

/**
 * 在 configDir 下查找指定名称的配置文件
 *
 * 按 EXTENSIONS 顺序尝试，返回第一个存在的文件路径。
 *
 * @param configDir 配置目录绝对路径
 * @param name      文件名（不含扩展名），如 'default'、'production'、'local'
 * @returns 完整文件路径，或 null（不存在）
 */
function resolveConfigFile(configDir: string, name: string): string | null {
  for (const ext of EXTENSIONS) {
    const full = path.join(configDir, `${name}${ext}`);
    if (existsSync(full)) return full;
  }
  return null;
}

// ── 深度合并 ────────────────────────────────────────────────

/**
 * 深度合并两个对象（target 上叠加 source）
 *
 * 合并策略：
 *   - 普通对象：递归合并（只覆盖 source 中有的字段，其余继承 target）
 *   - 数组：整体覆盖（非 middlewares，middlewares 走专用 patch）
 *   - 标量 / null / undefined：source 覆盖 target
 *
 * 注意：middlewares 字段不在此函数中处理，由 patchMiddlewares 单独处理。
 *
 * @param target 基准对象
 * @param source 覆盖对象
 * @returns 合并后的新对象（不修改 target 和 source）
 */
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>,
): T {
  const result = { ...target };

  for (const key of Object.keys(source) as (keyof T)[]) {
    const sv = source[key];
    const tv = target[key];

    // 跳过 middlewares — 由 patchMiddlewares 专门处理
    if (key === "middlewares") continue;

    if (
      sv !== null &&
      sv !== undefined &&
      typeof sv === "object" &&
      !Array.isArray(sv) &&
      tv !== null &&
      tv !== undefined &&
      typeof tv === "object" &&
      !Array.isArray(tv)
    ) {
      // 两边都是普通对象 → 递归深度合并
      result[key] = deepMerge(
        tv as Record<string, unknown>,
        sv as Record<string, unknown>,
      ) as T[keyof T];
    } else {
      // 标量、数组、null → 直接覆盖
      result[key] = sv as T[keyof T];
    }
  }

  return result;
}

// ── middlewares patch 合并 ───────────────────────────────────

/**
 * 提取中间件声明的 name
 */
function getMiddlewareName(decl: MiddlewareDecl): string {
  return typeof decl === "string" ? decl : decl.name;
}

/**
 * middlewares 专用 patch 合并
 *
 * 按 name 匹配：
 *   1. 以 base 数组为基准（保持原始顺序）
 *   2. override 中每一项按 name 在 base 中查找
 *   3. 匹配到 → 浅合并该项（options / enabled 等字段覆盖）
 *   4. 未匹配到 → 追加到数组末尾
 *
 * @param base     基准数组（来自 default.ts 或上一层合并结果）
 * @param override 覆盖数组（来自 env.ts 或 local.ts）
 * @returns 合并后的新数组
 */
function patchMiddlewares(
  base: MiddlewareDecl[],
  override: MiddlewareDecl[],
): MiddlewareDecl[] {
  // 拷贝 base，统一为独立引用
  const result: MiddlewareDecl[] = base.map((d) =>
    typeof d === "string" ? d : { ...d },
  );

  for (const item of override) {
    const name = getMiddlewareName(item);
    const idx = result.findIndex((d) => getMiddlewareName(d) === name);

    if (idx !== -1) {
      // 匹配到 → 浅合并
      const existing = result[idx]!;
      const baseObj =
        typeof existing === "string" ? { name: existing } : { ...existing };
      const overrideObj =
        typeof item === "string" ? { name: item } : { ...item };
      result[idx] = { ...baseObj, ...overrideObj };
    } else {
      // 未匹配到 → 追加
      result.push(item);
    }
  }

  return result;
}

function applyConfigLayer(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const beforeOverride = { ...base };
  const merged = deepMerge(base, override);

  if (override.middlewares && Array.isArray(override.middlewares)) {
    merged.middlewares = patchMiddlewares(
      (beforeOverride.middlewares as MiddlewareDecl[] | undefined) ?? [],
      override.middlewares as MiddlewareDecl[],
    );
  }

  return merged;
}

function applyCliOverrides(
  merged: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  if (env.VEXT_PORT) {
    const cliPort = parseInt(env.VEXT_PORT, 10);
    if (!Number.isNaN(cliPort) && cliPort >= 1 && cliPort <= 65535) {
      merged.port = cliPort;
    }
  }

  if (env.VEXT_HOST) {
    merged.host = env.VEXT_HOST;
  }

  if (env.VEXT_LIFECYCLE_LEVEL) {
    const lifecycleLevel = env.VEXT_LIFECYCLE_LEVEL;
    if (lifecycleLevel === "concise" || lifecycleLevel === "verbose") {
      const logger = {
        ...((merged.logger as Record<string, unknown> | undefined) ?? {}),
        lifecycleLevel,
      };
      merged.logger = logger;
    }
  }

  return merged;
}

// ── deepFreeze ──────────────────────────────────────────────

/**
 * 递归深冻结对象
 *
 * Object.freeze 只冻结顶层属性（浅冻结），嵌套对象仍可被修改。
 * deepFreeze 递归冻结所有层级，确保 config 完全只读。
 *
 * 跳过规则：
 *   - null / 非对象 / 已冻结对象 → 避免无意义递归
 *   - Date / RegExp / Buffer / Map / Set 等非纯对象 →
 *     冻结这些对象会破坏其内部状态（如 Date.setTime() 失效）
 *   - 跳过非纯对象的检查（Q23：不要冻结非纯对象）
 *
 * @param obj 待冻结对象
 * @returns 冻结后的对象（同一引用）
 */
function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object" || Object.isFrozen(obj)) {
    return obj;
  }

  // 跳过非纯对象（Date / RegExp / Buffer / TypedArray / Map / Set 等）
  // 这些对象有内部 slot，冻结后其变异方法会静默失败或抛错
  if (
    obj instanceof Date ||
    obj instanceof RegExp ||
    obj instanceof Map ||
    obj instanceof Set ||
    ArrayBuffer.isView(obj) // Buffer / TypedArray
  ) {
    return obj;
  }

  // Redis clients and other class instances may keep mutable internal slots.
  // Freeze only arrays and plain objects so config files can carry advanced
  // object references without breaking their runtime behavior.
  const proto = Object.getPrototypeOf(obj);
  if (!Array.isArray(obj) && proto !== Object.prototype && proto !== null) {
    return obj;
  }

  Object.freeze(obj);

  for (const value of Object.values(obj as Record<string, unknown>)) {
    deepFreeze(value);
  }

  return obj;
}

// ── 配置校验（Fail Fast）───────────────────────────────────

/**
 * 配置校验（启动时 Fail Fast）
 *
 * 在应用启动时立即校验配置合法性，发现问题立即抛出错误终止启动，
 * 避免运行时出现难以追踪的配置问题。
 *
 * @param config 合并后的配置对象
 * @throws Error 配置不合法时抛出描述性错误
 */
function validateConfig(config: Record<string, unknown>): void {
  // ── port ──────────────────────────────────────────────
  const port = config.port as number | undefined;
  if (
    port !== undefined &&
    (typeof port !== "number" || port < 1 || port > 65535)
  ) {
    throw new Error(
      `[vextjs] config.port must be a number between 1 and 65535, got: ${port}`,
    );
  }

  // ── adapter（字符串标识 | 工厂函数）──────────────────
  const adapter = config.adapter;
  if (adapter !== undefined) {
    const knownAdapters = ["hono", "fastify", "express", "koa", "native"];
    if (typeof adapter === "string") {
      if (!knownAdapters.includes(adapter)) {
        throw new Error(
          `[vextjs] config.adapter "${adapter}" is not a built-in adapter.\n` +
            `         Available: ${knownAdapters.join(", ")}`,
        );
      }
    } else if (typeof adapter !== "function") {
      throw new Error(
        `[vextjs] config.adapter must be a string (built-in name) or a factory function,` +
          ` got: ${typeof adapter}`,
      );
    }
  }

  // ── middlewares ────────────────────────────────────────
  const middlewares = config.middlewares as unknown[] | undefined;
  if (middlewares !== undefined) {
    if (!Array.isArray(middlewares)) {
      throw new Error("[vextjs] config.middlewares must be an array.");
    }
    for (let i = 0; i < middlewares.length; i++) {
      const m = middlewares[i];
      if (
        typeof m !== "string" &&
        (typeof m !== "object" || m === null || !("name" in m))
      ) {
        throw new Error(
          `[vextjs] config.middlewares[${i}] must be a string or { name, options?, enabled? } object.`,
        );
      }
    }
  }

  // ── rateLimit ─────────────────────────────────────────
  const rateLimit = config.rateLimit as Record<string, unknown> | undefined;
  if (rateLimit !== undefined) {
    if (typeof rateLimit !== "object" || rateLimit === null) {
      throw new Error("[vextjs] config.rateLimit must be an object.");
    }
    const max = rateLimit.max;
    if (max !== undefined && (typeof max !== "number" || max < 1)) {
      throw new Error(
        `[vextjs] config.rateLimit.max must be a positive number, got: ${max}`,
      );
    }
    const window = rateLimit.window;
    if (window !== undefined && (typeof window !== "number" || window < 1)) {
      throw new Error(
        `[vextjs] config.rateLimit.window must be a positive number (seconds), got: ${window}`,
      );
    }
  }

  // ── cluster ───────────────────────────────────────────
  const cluster = config.cluster as Record<string, unknown> | undefined;
  if (cluster !== undefined) {
    if (
      typeof cluster !== "object" ||
      cluster === null ||
      Array.isArray(cluster)
    ) {
      throw new Error("[vextjs] config.cluster must be an object.");
    }

    const workers = cluster.workers;
    if (workers !== undefined) {
      const validWorkerStrings = ["auto", "auto-1"];
      if (
        typeof workers === "string" &&
        !validWorkerStrings.includes(workers)
      ) {
        throw new Error(
          `[vextjs] config.cluster.workers must be a positive integer, "auto", or "auto-1", got: "${workers}"`,
        );
      } else if (
        typeof workers === "number" &&
        (!Number.isInteger(workers) || workers < 1)
      ) {
        throw new Error(
          `[vextjs] config.cluster.workers must be a positive integer, got: ${workers}`,
        );
      } else if (typeof workers !== "string" && typeof workers !== "number") {
        throw new Error(
          `[vextjs] config.cluster.workers must be a positive integer, "auto", or "auto-1", got: ${typeof workers}`,
        );
      }
    }

    if (cluster.enabled !== undefined && typeof cluster.enabled !== "boolean") {
      throw new Error("[vextjs] config.cluster.enabled must be a boolean.");
    }

    for (const field of ["maxRestarts"] as const) {
      const value = cluster[field];
      if (
        value !== undefined &&
        (!Number.isInteger(value) || (value as number) < 1)
      ) {
        throw new Error(
          `[vextjs] config.cluster.${field} must be a positive integer.`,
        );
      }
    }

    for (const field of [
      "restartWindow",
      "restartBaseDelay",
      "restartMaxDelay",
      "memoryThreshold",
    ] as const) {
      const value = cluster[field];
      if (
        value !== undefined &&
        (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
      ) {
        throw new Error(
          `[vextjs] config.cluster.${field} must be a positive number.`,
        );
      }
    }

    for (const field of ["pidFile", "titlePrefix"] as const) {
      const value = cluster[field];
      if (value !== undefined && typeof value !== "string") {
        throw new Error(`[vextjs] config.cluster.${field} must be a string.`);
      }
    }

    if (
      cluster.sticky !== undefined &&
      !["none", "ip"].includes(String(cluster.sticky))
    ) {
      throw new Error('[vextjs] config.cluster.sticky must be "none" or "ip".');
    }

    for (const sectionName of ["healthCheck", "reload"] as const) {
      const section = cluster[sectionName];
      if (section === undefined) continue;
      if (
        typeof section !== "object" ||
        section === null ||
        Array.isArray(section)
      ) {
        throw new Error(
          `[vextjs] config.cluster.${sectionName} must be an object.`,
        );
      }
      const typed = section as Record<string, unknown>;
      if (typed.enabled !== undefined && typeof typed.enabled !== "boolean") {
        throw new Error(
          `[vextjs] config.cluster.${sectionName}.enabled must be a boolean.`,
        );
      }
      for (const [key, value] of Object.entries(typed)) {
        if (key === "enabled") continue;
        if (
          value !== undefined &&
          (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
        ) {
          throw new Error(
            `[vextjs] config.cluster.${sectionName}.${key} must be a positive number.`,
          );
        }
      }
    }
  }

  // ── locale ────────────────────────────────────────────
  const locale = config.locale as Record<string, unknown> | undefined;
  if (locale !== undefined) {
    if (typeof locale !== "object" || locale === null) {
      throw new Error("[vextjs] config.locale must be an object.");
    }
    if (locale.default !== undefined && typeof locale.default !== "string") {
      throw new Error(
        `[vextjs] config.locale.default must be a string (e.g. "zh-CN"), got: ${typeof locale.default}`,
      );
    }
    if (locale.supported !== undefined) {
      if (!Array.isArray(locale.supported)) {
        throw new Error(
          "[vextjs] config.locale.supported must be an array of locale strings.",
        );
      }
      for (const s of locale.supported) {
        if (typeof s !== "string") {
          throw new Error(
            `[vextjs] config.locale.supported[] items must be strings, got: ${typeof s}`,
          );
        }
      }
    }
  }

  // ── logger ────────────────────────────────────────────
  const logger = config.logger as Record<string, unknown> | undefined;
  if (logger !== undefined) {
    if (typeof logger !== "object" || logger === null) {
      throw new Error("[vextjs] config.logger must be an object.");
    }
    const level = logger.level;
    if (level !== undefined) {
      const validLevels = [
        "fatal",
        "error",
        "warn",
        "info",
        "debug",
        "trace",
        "silent",
      ];
      if (typeof level !== "string" || !validLevels.includes(level)) {
        throw new Error(
          `[vextjs] config.logger.level must be one of: ${validLevels.join(", ")}, got: "${level}"`,
        );
      }
    }
    if (logger.pretty !== undefined && typeof logger.pretty !== "boolean") {
      throw new Error("[vextjs] config.logger.pretty must be a boolean.");
    }
    if (logger.lifecycleLevel !== undefined) {
      const validLifecycleLevels = ["concise", "verbose"];
      if (
        typeof logger.lifecycleLevel !== "string" ||
        !validLifecycleLevels.includes(logger.lifecycleLevel)
      ) {
        throw new Error(
          `[vextjs] config.logger.lifecycleLevel must be one of: ${validLifecycleLevels.join(", ")}, got: "${logger.lifecycleLevel}"`,
        );
      }
    }
  }

  // ── shutdown ──────────────────────────────────────────
  const shutdown = config.shutdown as Record<string, unknown> | undefined;
  if (shutdown !== undefined) {
    if (typeof shutdown !== "object" || shutdown === null) {
      throw new Error("[vextjs] config.shutdown must be an object.");
    }
    const timeout = shutdown.timeout;
    if (timeout !== undefined && (typeof timeout !== "number" || timeout < 0)) {
      throw new Error(
        `[vextjs] config.shutdown.timeout must be a non-negative number (seconds), got: ${timeout}`,
      );
    }
  }

  // ── accessLog ─────────────────────────────────────────
  const accessLog = config.accessLog as Record<string, unknown> | undefined;
  if (accessLog !== undefined) {
    if (typeof accessLog !== "object" || accessLog === null) {
      throw new Error("[vextjs] config.accessLog must be an object.");
    }
    if (
      accessLog.enabled !== undefined &&
      typeof accessLog.enabled !== "boolean"
    ) {
      throw new Error("[vextjs] config.accessLog.enabled must be a boolean.");
    }
    const alLevel = accessLog.level;
    if (alLevel !== undefined) {
      const validAlLevels = ["info", "debug"];
      if (typeof alLevel !== "string" || !validAlLevels.includes(alLevel)) {
        throw new Error(
          `[vextjs] config.accessLog.level must be one of: ${validAlLevels.join(", ")}, got: "${alLevel}"`,
        );
      }
    }
    if (accessLog.skipPaths !== undefined) {
      if (!Array.isArray(accessLog.skipPaths)) {
        throw new Error(
          "[vextjs] config.accessLog.skipPaths must be an array of strings.",
        );
      }
      for (const sp of accessLog.skipPaths) {
        if (typeof sp !== "string") {
          throw new Error(
            `[vextjs] config.accessLog.skipPaths[] items must be strings, got: ${typeof sp}`,
          );
        }
      }
    }
  }

  // ── openapi ───────────────────────────────────────────
  const openapi = config.openapi as Record<string, unknown> | undefined;
  if (openapi !== undefined) {
    if (typeof openapi !== "object" || openapi === null) {
      throw new Error("[vextjs] config.openapi must be an object.");
    }
    if (openapi.enabled !== undefined && typeof openapi.enabled !== "boolean") {
      throw new Error("[vextjs] config.openapi.enabled must be a boolean.");
    }
  }

  // ── requestContext ────────────────────────────────────
  const requestContext = config.requestContext as
    | Record<string, unknown>
    | undefined;
  if (requestContext !== undefined) {
    if (typeof requestContext !== "object" || requestContext === null) {
      throw new Error("[vextjs] config.requestContext must be an object.");
    }
    if (
      requestContext.enabled !== undefined &&
      typeof requestContext.enabled !== "boolean"
    ) {
      throw new Error(
        "[vextjs] config.requestContext.enabled must be a boolean.",
      );
    }
  }

  // ── fetch ──────────────────────────────────────────────
  validateFetchConfig(config.fetch, "config.fetch");

  // ── cache ──────────────────────────────────────────────
  const cache = config.cache as Record<string, unknown> | undefined;
  if (cache !== undefined) {
    if (typeof cache !== "object" || cache === null) {
      throw new Error("[vextjs] config.cache must be an object.");
    }
    if (cache.enabled !== undefined && typeof cache.enabled !== "boolean") {
      throw new Error("[vextjs] config.cache.enabled must be a boolean.");
    }
    const defaultTtl = cache.defaultTtl;
    if (
      defaultTtl !== undefined &&
      (typeof defaultTtl !== "number" || defaultTtl <= 0)
    ) {
      throw new Error(
        `[vextjs] config.cache.defaultTtl must be a positive number (milliseconds), got: ${defaultTtl}`,
      );
    }
    const maxEntries = cache.maxEntries;
    if (
      maxEntries !== undefined &&
      (typeof maxEntries !== "number" ||
        !Number.isInteger(maxEntries) ||
        maxEntries < 1)
    ) {
      throw new Error(
        `[vextjs] config.cache.maxEntries must be a positive integer, got: ${maxEntries}`,
      );
    }
    const maxMemory = cache.maxMemory;
    if (
      maxMemory !== undefined &&
      (typeof maxMemory !== "number" || maxMemory <= 0)
    ) {
      throw new Error(
        `[vextjs] config.cache.maxMemory must be a positive number (bytes), got: ${maxMemory}`,
      );
    }
    const cleanupInterval = cache.cleanupInterval;
    if (
      cleanupInterval !== undefined &&
      (typeof cleanupInterval !== "number" || cleanupInterval < 0)
    ) {
      throw new Error(
        `[vextjs] config.cache.cleanupInterval must be a non-negative number (milliseconds), got: ${cleanupInterval}`,
      );
    }
    validateCacheHubConfig(cache.cacheHub, "config.cache.cacheHub");
  }
}

function validateFetchConfig(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`[vextjs] ${path} must be an object.`);
  }

  const fetchConfig = value as Record<string, unknown>;
  if (fetchConfig.timeout !== undefined) {
    validatePositiveNumber(fetchConfig.timeout, `${path}.timeout`);
  }
  if (fetchConfig.retry !== undefined) {
    validateNonNegativeInteger(fetchConfig.retry, `${path}.retry`);
  }
  validateRetryDelay(fetchConfig.retryDelay, `${path}.retryDelay`);
  validateOptionalStringArray(
    fetchConfig.propagateHeaders,
    `${path}.propagateHeaders`,
  );

  const proxy = fetchConfig.proxy;
  if (proxy === undefined) {
    return;
  }
  if (!Array.isArray(proxy)) {
    throw new Error(`[vextjs] ${path}.proxy must be an array.`);
  }

  const names = new Set<string>();
  proxy.forEach((item, index) => {
    const itemPath = `${path}.proxy[${index}]`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(`[vextjs] ${itemPath} must be an object.`);
    }

    const target = item as Record<string, unknown>;
    validateRequiredString(target.name, `${itemPath}.name`);
    const name = target.name as string;
    if (FETCH_PROXY_RESERVED_TARGET_NAMES.has(name)) {
      throw new Error(
        `[vextjs] ${itemPath}.name "${name}" is reserved and cannot be used.`,
      );
    }
    if (names.has(name)) {
      throw new Error(`[vextjs] ${itemPath}.name "${name}" is duplicated.`);
    }
    names.add(name);

    validateRequiredString(target.baseURL, `${itemPath}.baseURL`);
    try {
      new URL(target.baseURL as string);
    } catch {
      throw new Error(`[vextjs] ${itemPath}.baseURL must be a valid URL.`);
    }

    validateStringRecord(target.headers, `${itemPath}.headers`);
    validateOptionalStringArray(
      target.forwardHeaders,
      `${itemPath}.forwardHeaders`,
    );
    validateProxyHeaderSource(
      target.defaultInjectHeaders,
      `${itemPath}.defaultInjectHeaders`,
    );
    if (
      target.allowAuthorizationForward !== undefined &&
      typeof target.allowAuthorizationForward !== "boolean"
    ) {
      throw new Error(
        `[vextjs] ${itemPath}.allowAuthorizationForward must be a boolean.`,
      );
    }
    if (target.timeout !== undefined) {
      validatePositiveNumber(target.timeout, `${itemPath}.timeout`);
    }
    if (target.retry !== undefined) {
      validateNonNegativeInteger(target.retry, `${itemPath}.retry`);
    }
    validateRetryDelay(target.retryDelay, `${itemPath}.retryDelay`);
  });
}

function validateRetryDelay(value: unknown, path: string): void {
  if (value === undefined || typeof value === "function") {
    return;
  }
  validateNonNegativeNumber(value, path);
}

function validateProxyHeaderSource(value: unknown, path: string): void {
  if (value === undefined || typeof value === "function") {
    return;
  }
  validateStringRecord(value, path);
}

function validateStringRecord(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`[vextjs] ${path} must be an object.`);
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item !== "string") {
      throw new Error(`[vextjs] ${path}.${key} must be a string.`);
    }
  }
}

function validateRequiredString(value: unknown, path: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`[vextjs] ${path} must be a non-empty string.`);
  }
}

function validateOptionalStringArray(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error(`[vextjs] ${path} must be an array of strings.`);
  }
  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error(`[vextjs] ${path}[] items must be strings.`);
    }
  }
}

function validateCacheHubConfig(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "object" || value === null) {
    throw new Error(`[vextjs] ${path} must be an object.`);
  }

  const cacheHub = value as Record<string, unknown>;
  const mode = cacheHub.mode ?? "memory";
  if (!["memory", "redis", "multi-level"].includes(mode as string)) {
    throw new Error(
      `[vextjs] ${path}.mode must be "memory", "redis", or "multi-level", got: ${String(mode)}`,
    );
  }

  if (mode === "memory") {
    validateMemoryCacheHubConfig(cacheHub, path);
    return;
  }

  if (mode === "redis") {
    validateRedisTargetConfig(cacheHub, path);
    validateLeaseConfig(cacheHub.lease, `${path}.lease`);
    validateDistributedConfig(cacheHub.distributed, `${path}.distributed`);
    return;
  }

  validateMultiLevelCacheHubConfig(cacheHub, path);
}

function validateMemoryCacheHubConfig(
  value: Record<string, unknown>,
  path: string,
): void {
  if (value.maxEntries !== undefined) {
    validatePositiveInteger(value.maxEntries, `${path}.maxEntries`);
  }
  if (value.maxMemory !== undefined) {
    validatePositiveNumber(value.maxMemory, `${path}.maxMemory`);
  }
  if (value.cleanupInterval !== undefined) {
    validateNonNegativeNumber(value.cleanupInterval, `${path}.cleanupInterval`);
  }
  if (
    value.enableStats !== undefined &&
    typeof value.enableStats !== "boolean"
  ) {
    throw new Error(`[vextjs] ${path}.enableStats must be a boolean.`);
  }
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    throw new Error(`[vextjs] ${path}.enabled must be a boolean.`);
  }
}

function validateMultiLevelCacheHubConfig(
  value: Record<string, unknown>,
  path: string,
): void {
  if (value.memory !== undefined) {
    if (typeof value.memory !== "object" || value.memory === null) {
      throw new Error(`[vextjs] ${path}.memory must be an object.`);
    }
    validateMemoryCacheHubConfig(
      value.memory as Record<string, unknown>,
      `${path}.memory`,
    );
  }
  if (value.redis !== undefined) {
    if (typeof value.redis !== "object" || value.redis === null) {
      throw new Error(`[vextjs] ${path}.redis must be an object.`);
    }
    validateRedisTargetConfig(
      value.redis as Record<string, unknown>,
      `${path}.redis`,
    );
  }
  if (
    value.writePolicy !== undefined &&
    !["both", "local-first-async-remote"].includes(value.writePolicy as string)
  ) {
    throw new Error(
      `[vextjs] ${path}.writePolicy must be "both" or "local-first-async-remote".`,
    );
  }
  if (
    value.backfillOnRemoteHit !== undefined &&
    typeof value.backfillOnRemoteHit !== "boolean"
  ) {
    throw new Error(`[vextjs] ${path}.backfillOnRemoteHit must be a boolean.`);
  }
  if (value.remoteTimeout !== undefined) {
    validatePositiveNumber(value.remoteTimeout, `${path}.remoteTimeout`);
  }
  if (
    value.remoteInvalidationErrors !== undefined &&
    !["ignore", "throw"].includes(value.remoteInvalidationErrors as string)
  ) {
    throw new Error(
      `[vextjs] ${path}.remoteInvalidationErrors must be "ignore" or "throw".`,
    );
  }
  validateLeaseConfig(value.lease, `${path}.lease`);
  validateDistributedConfig(value.distributed, `${path}.distributed`);
}

function validateRedisTargetConfig(
  value: Record<string, unknown>,
  path: string,
): void {
  validateOptionalString(value.url, `${path}.url`);
  validateOptionalString(value.metaKeyPrefix, `${path}.metaKeyPrefix`);
  if (
    value.client !== undefined &&
    (typeof value.client !== "object" || value.client === null)
  ) {
    throw new Error(`[vextjs] ${path}.client must be an object.`);
  }
  if (value.scanCount !== undefined) {
    validatePositiveInteger(value.scanCount, `${path}.scanCount`);
  }
  if (
    value.deleteCommand !== undefined &&
    !["del", "unlink"].includes(value.deleteCommand as string)
  ) {
    throw new Error(
      `[vextjs] ${path}.deleteCommand must be "del" or "unlink".`,
    );
  }
}

function validateLeaseConfig(value: unknown, path: string): void {
  if (value === undefined || typeof value === "boolean") {
    return;
  }
  if (typeof value !== "object" || value === null) {
    throw new Error(`[vextjs] ${path} must be a boolean or an object.`);
  }
  const lease = value as Record<string, unknown>;
  if (lease.enabled !== undefined && typeof lease.enabled !== "boolean") {
    throw new Error(`[vextjs] ${path}.enabled must be a boolean.`);
  }
  if (lease.ttl !== undefined) {
    validatePositiveNumber(lease.ttl, `${path}.ttl`);
  }
  if (lease.waitForOwner !== undefined) {
    validatePositiveNumber(lease.waitForOwner, `${path}.waitForOwner`);
  }
  if (lease.pollInterval !== undefined) {
    validatePositiveNumber(lease.pollInterval, `${path}.pollInterval`);
  }
  if (
    lease.onTimeout !== undefined &&
    !["fetch", "throw"].includes(lease.onTimeout as string)
  ) {
    throw new Error(`[vextjs] ${path}.onTimeout must be "fetch" or "throw".`);
  }
  validateOptionalString(lease.keyPrefix, `${path}.keyPrefix`);
  validateOptionalString(lease.ownerId, `${path}.ownerId`);
}

function validateDistributedConfig(value: unknown, path: string): void {
  if (value === undefined || typeof value === "boolean") {
    return;
  }
  if (typeof value !== "object" || value === null) {
    throw new Error(`[vextjs] ${path} must be a boolean or an object.`);
  }
  const distributed = value as Record<string, unknown>;
  if (
    distributed.enabled !== undefined &&
    typeof distributed.enabled !== "boolean"
  ) {
    throw new Error(`[vextjs] ${path}.enabled must be a boolean.`);
  }
  validateOptionalString(distributed.redisUrl, `${path}.redisUrl`);
  validateOptionalString(distributed.channel, `${path}.channel`);
  validateOptionalString(distributed.instanceId, `${path}.instanceId`);
  if (
    distributed.redis !== undefined &&
    (typeof distributed.redis !== "object" || distributed.redis === null)
  ) {
    throw new Error(`[vextjs] ${path}.redis must be an object.`);
  }
}

function validateOptionalString(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`[vextjs] ${path} must be a string.`);
  }
}

function validatePositiveInteger(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(
      `[vextjs] ${path} must be a positive integer, got: ${value}`,
    );
  }
}

function validateNonNegativeInteger(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(
      `[vextjs] ${path} must be a non-negative integer, got: ${value}`,
    );
  }
}

function validatePositiveNumber(value: unknown, path: string): void {
  if (typeof value !== "number" || value <= 0) {
    throw new Error(
      `[vextjs] ${path} must be a positive number, got: ${value}`,
    );
  }
}

function validateNonNegativeNumber(value: unknown, path: string): void {
  if (typeof value !== "number" || value < 0) {
    throw new Error(
      `[vextjs] ${path} must be a non-negative number, got: ${value}`,
    );
  }
}

// ── 动态导入辅助 ────────────────────────────────────────────

/**
 * 动态导入配置文件并提取 default export
 *
 * 使用 file:// URL 确保 Windows 路径兼容性。
 * 配置文件必须使用 `export default { ... }` 导出。
 *
 * @param filePath 配置文件绝对路径
 * @returns 配置对象
 */
async function importConfigFile(
  filePath: string,
): Promise<Record<string, unknown>> {
  // 延迟导入 interop 工具（避免循环依赖风险）
  const { resolveModuleDefault } = await import("./interop.js");

  const fileUrl = pathToFileURL(filePath).href;
  const mod = (await import(fileUrl)) as Record<string, unknown>;

  const defaultExport = resolveModuleDefault<Record<string, unknown>>(mod);

  if (!defaultExport || typeof defaultExport !== "object") {
    throw new Error(
      `[vextjs] Config file "${filePath}" must use \`export default { ... }\`.\n` +
        `         Got: ${typeof defaultExport}`,
    );
  }

  return defaultExport;
}

// ── 主入口 ──────────────────────────────────────────────────

/**
 * 加载并合并配置文件
 *
 * 合并顺序：default → {NODE_ENV} → local
 * 合并完成后执行 Fail Fast 校验，通过后 deepFreeze 返回只读对象。
 *
 * @param configDir 配置目录绝对路径（通常为 path.join(projectRoot, 'src/config')）
 * @returns 合并、校验、冻结后的 VextConfig
 * @throws Error 配置文件缺失或配置不合法时抛出
 *
 * @example
 * ```typescript
 * import { loadConfig } from './config-loader.js'
 * import path from 'node:path'
 *
 * const config = await loadConfig(path.join(process.cwd(), 'src/config'))
 * // config 已 deepFreeze，运行时不可修改
 * ```
 */
export async function loadRawConfig(
  configDir: string,
  options: LoadConfigOptions = {},
): Promise<Record<string, unknown>> {
  const processEnv = options.env ?? process.env;

  // ── 1. 加载 default（必须存在）────────────────────────
  const defaultFile = resolveConfigFile(configDir, "default");
  if (!defaultFile) {
    throw new Error(
      `[vextjs] src/config/default.ts not found in "${configDir}".\n` +
        `         This file is required. It defines all configuration defaults.`,
    );
  }
  const userDefaultConfig = await importConfigFile(defaultFile);

  // ── 1b. 以 DEFAULT_CONFIG 为基底，深度合并用户 default ──
  //
  // 用户的 config/default.ts 可能只覆盖部分字段（如 port / logger.level），
  // 缺省字段从框架内置的 DEFAULT_CONFIG 补全。
  // 这确保 requestId / rateLimit / cors 等必要配置始终有值，
  // 即使用户未显式声明也不会导致 bootstrap 崩溃。
  //
  const defaultConfig = deepMerge(
    DEFAULT_CONFIG as unknown as Record<string, unknown>,
    userDefaultConfig,
  );

  // ── 1c. 手动合并用户 default.ts 中的 middlewares ────────
  //
  // deepMerge 会跳过 middlewares 键（由 patchMiddlewares 专门处理 env/local 覆盖），
  // 但用户的 config/default.ts 中声明的 middlewares 是基础白名单，应直接替换
  // DEFAULT_CONFIG.middlewares（空数组）。否则用户声明的路由级中间件永远不会被加载。
  //
  // 🐛 修复：BUG-004 — middlewares 在 deepMerge(DEFAULT_CONFIG, userDefaultConfig) 中被跳过，
  //    导致 loadMiddlewares 收到空数组，路由引用中间件时报 "not registered"。
  //
  if (
    userDefaultConfig.middlewares &&
    Array.isArray(userDefaultConfig.middlewares)
  ) {
    (defaultConfig as Record<string, unknown>).middlewares =
      userDefaultConfig.middlewares;
  }

  // ── 2. 加载环境文件（可选）──────────────────────────────
  const env = processEnv.NODE_ENV || "development";
  const envFile = resolveConfigFile(configDir, env);
  const envConfig = envFile ? await importConfigFile(envFile) : {};

  // ── 3. 加载 local（可选，不存在则静默跳过）──────────────
  const localFile = resolveConfigFile(configDir, "local");
  const localConfig = localFile ? await importConfigFile(localFile) : {};

  // ── 4. 合并 ────────────────────────────────────────────
  let merged = applyConfigLayer(defaultConfig, envConfig);
  merged = applyConfigLayer(merged, localConfig);

  const rootDir = options.rootDir ?? path.dirname(path.dirname(configDir));
  const providerPatch = await loadBootstrapConfigPatch({
    rootDir,
    configDir,
    env,
    command: options.command ?? "start",
    isBuilt: options.isBuilt ?? false,
    baseConfig: merged,
    processEnv,
  });
  if (options.meta) {
    options.meta.providerPatch = providerPatch;
  }
  merged = applyConfigLayer(merged, providerPatch);

  // ── 4c. CLI 环境变量覆盖（最高优先级）─────────────────
  //
  // vext start --port N / --host H 通过环境变量传递给 fork 子进程：
  //   VEXT_PORT → 覆盖 merged.port
  //   VEXT_HOST → 覆盖 merged.host
  //
  // 优先级链：DEFAULT_CONFIG < user default < env < local < CLI 环境变量
  //
  // 🐛 修复：BUG-013 — CLI --port/--host 参数设置了 VEXT_PORT/VEXT_HOST 环境变量，
  //    但 loadConfig 从未读取这些环境变量，导致端口覆盖静默失效。
  //
  return applyCliOverrides(merged, processEnv);
}

export function finalizeConfig(rawConfig: Record<string, unknown>): VextConfig {
  validateConfig(rawConfig);
  return deepFreeze(rawConfig) as VextConfig;
}

export async function loadConfig(
  configDir: string,
  options: LoadConfigOptions = {},
): Promise<VextConfig> {
  return finalizeConfig(await loadRawConfig(configDir, options));
}

// ── 导出辅助函数（供测试使用）───────────────────────────────

export {
  deepMerge as _deepMerge,
  deepFreeze as _deepFreeze,
  patchMiddlewares as _patchMiddlewares,
  applyCliOverrides as _applyCliOverrides,
  applyConfigLayer as _applyConfigLayer,
  validateConfig as _validateConfig,
  resolveConfigFile as _resolveConfigFile,
};
