import type { VextAdapter } from "../types/adapter.js";
import type { VextApp, VextConfig } from "../types/app.js";

/**
 * 内置 adapter 名称列表（用于错误提示）
 */
export const BUILT_IN_ADAPTER_NAMES = [
  "native",
  "hono",
  "fastify",
  "express",
  "koa",
] as const;

type BuiltInAdapterName = (typeof BUILT_IN_ADAPTER_NAMES)[number];

export interface AdapterPeerDiagnostic {
  peerPackages: readonly string[];
  requiresText: string;
  installText: string;
}

export function createUnknownAdapterError(name: string): Error {
  return new Error(
    `[vextjs] config.adapter "${name}" is not a built-in adapter.\n` +
      `         Available: ${BUILT_IN_ADAPTER_NAMES.join(", ")}\n` +
      `         For third-party adapters, pass an adapter object or factory function instead of a string.`,
  );
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function messageMentionsPackage(message: string, packageName: string): boolean {
  return (
    message.includes(`'${packageName}'`) ||
    message.includes(`"${packageName}"`) ||
    message.includes(` ${packageName} `) ||
    message.includes(`${packageName}/`)
  );
}

function messageMentionsMissingPackage(
  message: string,
  packageName: string,
): boolean {
  return (
    message.includes(`Cannot find package '${packageName}'`) ||
    message.includes(`Cannot find package "${packageName}"`) ||
    message.includes(`Cannot find module '${packageName}'`) ||
    message.includes(`Cannot find module "${packageName}"`)
  );
}

export function isMissingAdapterPeerDependencyError(
  error: unknown,
  peerPackages: readonly string[],
): boolean {
  const code = getErrorCode(error);
  if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") {
    return false;
  }

  const message = getErrorMessage(error);
  return peerPackages.some((packageName) =>
    messageMentionsMissingPackage(message, packageName),
  );
}

export function isIncompatibleAdapterPeerDependencyError(
  error: unknown,
  peerPackages: readonly string[],
): boolean {
  const code = getErrorCode(error);
  if (
    code !== "ERR_PACKAGE_PATH_NOT_EXPORTED" &&
    code !== "ERR_PACKAGE_IMPORT_NOT_DEFINED" &&
    code !== "ERR_INVALID_PACKAGE_CONFIG"
  ) {
    return false;
  }

  const message = getErrorMessage(error);
  return peerPackages.some((packageName) =>
    messageMentionsPackage(message, packageName),
  );
}

export function createMissingAdapterPeerDependencyError(
  name: string,
  diagnostic: AdapterPeerDiagnostic,
  cause: unknown,
): Error {
  return new Error(
    `[vextjs] Adapter "${name}" requires ${diagnostic.requiresText}.\n` +
      `         ${diagnostic.installText}`,
    { cause },
  );
}

export function createIncompatibleAdapterPeerDependencyError(
  name: string,
  cause: unknown,
): Error {
  return new Error(
    `[vextjs] Adapter "${name}" found optional peer packages, but they could not be loaded through the expected package entry.\n` +
      `         Check that the installed peer versions are compatible with vextjs.\n` +
      `         Cause: ${getErrorMessage(cause)}`,
    { cause },
  );
}

export function createAdapterInternalFailureError(
  name: string,
  cause: unknown,
): Error {
  return new Error(
    `[vextjs] Adapter "${name}" failed while loading or initializing.\n` +
      `         This is not a missing optional peer dependency diagnostic.\n` +
      `         Cause: ${getErrorMessage(cause)}`,
    { cause },
  );
}

async function loadBuiltInAdapterWithDiagnostics(
  name: Exclude<BuiltInAdapterName, "native">,
  diagnostic: AdapterPeerDiagnostic,
  create: () => Promise<VextAdapter> | VextAdapter,
): Promise<VextAdapter> {
  try {
    return await create();
  } catch (error) {
    if (isMissingAdapterPeerDependencyError(error, diagnostic.peerPackages)) {
      throw createMissingAdapterPeerDependencyError(name, diagnostic, error);
    }
    if (
      isIncompatibleAdapterPeerDependencyError(error, diagnostic.peerPackages)
    ) {
      throw createIncompatibleAdapterPeerDependencyError(name, error);
    }
    throw createAdapterInternalFailureError(name, error);
  }
}

/**
 * 动态加载内置 adapter 工厂函数
 *
 * 使用动态 import() 按需加载对应框架的 adapter，
 * 避免在用户只使用一个 adapter 时强制安装所有框架依赖。
 *
 * native adapter 是默认 adapter，零外部 HTTP 框架依赖（仅需 route-core + Node.js 内置 http）。
 * 其他 adapter（hono / fastify / express / koa）需要用户额外安装对应框架包。
 * koa adapter 内部使用 @koa/router 作为 Koa 生态路由器。
 *
 * @param name 内置 adapter 名称
 * @param app  应用实例（传给 adapter 工厂函数）
 * @returns VextAdapter 实例
 * @throws 找不到对应框架包时抛出包含安装指引的错误
 */
async function loadBuiltInAdapter(
  name: string,
  app: VextApp,
): Promise<VextAdapter> {
  switch (name) {
    case "native": {
      const { createNativeAdapter } =
        await import("../adapters/native/adapter.js");
      return createNativeAdapter({}, app);
    }

    case "hono": {
      return loadBuiltInAdapterWithDiagnostics(
        "hono",
        {
          peerPackages: ["hono", "@hono/node-server"],
          requiresText: `"hono" and "@hono/node-server" packages`,
          installText: `Install them with: npm install hono @hono/node-server`,
        },
        async () => {
          const { createHonoAdapter } =
            await import("../adapters/hono/index.js");
          return createHonoAdapter(app);
        },
      );
    }

    case "fastify": {
      return loadBuiltInAdapterWithDiagnostics(
        "fastify",
        {
          peerPackages: ["fastify"],
          requiresText: `the "fastify" package`,
          installText: `Install it with: npm install fastify`,
        },
        async () => {
          const { createFastifyAdapter } =
            await import("../adapters/fastify/adapter.js");
          return createFastifyAdapter({}, app);
        },
      );
    }

    case "express": {
      return loadBuiltInAdapterWithDiagnostics(
        "express",
        {
          peerPackages: ["express"],
          requiresText: `the "express" package`,
          installText: `Install it with: npm install express`,
        },
        async () => {
          const { createExpressAdapter } =
            await import("../adapters/express/adapter.js");
          return createExpressAdapter({}, app);
        },
      );
    }

    case "koa": {
      return loadBuiltInAdapterWithDiagnostics(
        "koa",
        {
          peerPackages: ["koa", "@koa/router"],
          requiresText: `"koa" and "@koa/router" packages`,
          installText: `Install them with: npm install koa @koa/router`,
        },
        async () => {
          const { createKoaAdapter } =
            await import("../adapters/koa/adapter.js");
          return createKoaAdapter({}, app);
        },
      );
    }

    default:
      throw createUnknownAdapterError(name);
  }
}

/**
 * 解析 config.adapter 配置为 VextAdapter 实例（异步）
 *
 * 支持三种配置方式：
 *   1. 字符串标识 → 内置 adapter（如 'native'、'hono'）— 动态 import 按需加载
 *   2. 工厂函数 → 第三方 adapter（接收 app 返回 VextAdapter）
 *   3. 对象实例 → 第三方 adapter（必须实现 VextAdapter 接口）
 *
 * 默认值：当 config.adapter 未配置时，使用 'native'（零外部依赖 + 性能最优）。
 *
 * v2.4 变更：
 *   - 默认 adapter 从 'hono' 改为 'native'（native 零外部框架依赖 + JSON RPS +26.8% vs Fastify）
 *   - 静态 import 改为动态 import()，仅加载用户选择的 adapter 对应的框架包
 *   - 函数签名从同步改为异步（返回 Promise<VextAdapter>）
 *
 * @param config 框架运行时配置
 * @param app    应用实例（传给 adapter 工厂函数）
 * @returns Promise<VextAdapter> 实例
 * @throws 配置值不合法或第三方 adapter 缺少必要方法时抛出错误
 *
 * @example
 * // 内置 adapter（字符串标识，零 import）— 默认 native
 * // config: { adapter: 'native' }
 * const adapter = await resolveAdapter(config, app)
 *
 * @example
 * // 使用 Fastify adapter（需先 npm install fastify）
 * // config: { adapter: 'fastify' }
 * const adapter = await resolveAdapter(config, app)
 *
 * @example
 * // 第三方 adapter（需 import）
 * // config: { adapter: myCustomAdapter({ ... }) }
 * const adapter = await resolveAdapter(config, app)
 */
export async function resolveAdapter(
  config: VextConfig,
  app: VextApp,
): Promise<VextAdapter> {
  const adapterConfig = config.adapter ?? "native";

  // 字符串 → 内置 adapter（动态 import 按需加载）
  if (typeof adapterConfig === "string") {
    return loadBuiltInAdapter(adapterConfig, app);
  }

  // 函数 → adapter 工厂函数（如 fastifyAdapter({ bodyLimit: 5MB }) 返回的 (app) => VextAdapter）
  // 用户通过 import { fastifyAdapter } from 'vextjs/adapters/fastify' 使用
  if (typeof adapterConfig === "function") {
    const adapter = (adapterConfig as (app: VextApp) => VextAdapter)(app);
    validateAdapterInterface(adapter);
    return adapter;
  }

  // 对象 → 第三方 adapter（必须满足 VextAdapter 接口）
  if (typeof adapterConfig === "object" && adapterConfig !== null) {
    validateAdapterInterface(adapterConfig as VextAdapter);
    return adapterConfig as VextAdapter;
  }

  throw new Error(
    `[vextjs] config.adapter must be a string (built-in), a factory function, or an adapter object (third-party). ` +
      `Received: ${typeof adapterConfig}`,
  );
}

/**
 * 验证第三方 adapter 是否实现了 VextAdapter 接口的所有必要成员
 *
 * Fail Fast：启动时立即检查，避免运行时调用缺失方法导致难以排查的错误。
 *
 * @param adapter 待验证的 adapter 对象
 * @throws 缺少必要方法或属性时抛出描述性错误
 */
function validateAdapterInterface(
  adapter: unknown,
): asserts adapter is VextAdapter {
  const requiredMethods = [
    "registerRoute",
    "registerMiddleware",
    "registerErrorHandler",
    "registerNotFound",
    "listen",
    "buildHandler",
  ] as const;

  const obj = adapter as Record<string, unknown>;

  // 验证 name 属性（string 类型）
  if (typeof obj.name !== "string" || obj.name.length === 0) {
    throw new Error(
      `[vextjs] Custom adapter is missing required property: "name" (must be a non-empty string).\n` +
        `         Adapter must implement the VextAdapter interface (see the adapters guide).`,
    );
  }

  // 验证所有必要方法
  for (const method of requiredMethods) {
    if (typeof obj[method] !== "function") {
      throw new Error(
        `[vextjs] Custom adapter "${obj.name ?? "unknown"}" is missing required method: "${method}".\n` +
          `         Expected: function, received: ${typeof obj[method]}.\n` +
          `         Adapter must implement the VextAdapter interface (see the adapters guide).`,
      );
    }
  }
}
