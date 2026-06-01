import type { VextAdapter } from "../types/adapter.js";
import type { VextApp, VextConfig } from "../types/app.js";

/**
 * 内置 adapter 名称列表（用于错误提示）
 */
const BUILT_IN_ADAPTER_NAMES = ["native", "hono", "fastify", "express", "koa"];

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
      try {
        const { createHonoAdapter } = await import("../adapters/hono/index.js");
        return createHonoAdapter(app);
      } catch {
        throw new Error(
          `[vextjs] Adapter "hono" requires "hono" and "@hono/node-server" packages.\n` +
            `         Install them with: npm install hono @hono/node-server`,
        );
      }
    }

    case "fastify": {
      try {
        const { createFastifyAdapter } =
          await import("../adapters/fastify/adapter.js");
        return createFastifyAdapter({}, app);
      } catch {
        throw new Error(
          `[vextjs] Adapter "fastify" requires the "fastify" package.\n` +
            `         Install it with: npm install fastify`,
        );
      }
    }

    case "express": {
      try {
        const { createExpressAdapter } =
          await import("../adapters/express/adapter.js");
        return createExpressAdapter({}, app);
      } catch {
        throw new Error(
          `[vextjs] Adapter "express" requires the "express" package.\n` +
            `         Install it with: npm install express`,
        );
      }
    }

    case "koa": {
      try {
        const { createKoaAdapter } = await import("../adapters/koa/adapter.js");
        return createKoaAdapter({}, app);
      } catch {
        throw new Error(
          `[vextjs] Adapter "koa" requires "koa" and "@koa/router" packages.\n` +
            `         Install them with: npm install koa @koa/router`,
        );
      }
    }

    default:
      throw new Error(
        `[vextjs] config.adapter "${name}" is not a built-in adapter.\n` +
          `         Available: ${BUILT_IN_ADAPTER_NAMES.join(", ")}\n` +
          `         For third-party adapters, pass an adapter object or factory function instead of a string.`,
      );
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
        `         Adapter must implement the VextAdapter interface (see 08-adapter.md).`,
    );
  }

  // 验证所有必要方法
  for (const method of requiredMethods) {
    if (typeof obj[method] !== "function") {
      throw new Error(
        `[vextjs] Custom adapter "${obj.name ?? "unknown"}" is missing required method: "${method}".\n` +
          `         Expected: function, received: ${typeof obj[method]}.\n` +
          `         Adapter must implement the VextAdapter interface (see 08-adapter.md).`,
      );
    }
  }
}
