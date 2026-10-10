import { createHonoAdapter } from "./adapter.js";
import type {
  VextAdapter,
  VextAdapterFactory,
  VextAdapterRuntimeContext,
} from "../../types/adapter.js";
import type { VextApp } from "../../types/app.js";

/**
 * honoAdapter — 创建 Hono Adapter 工厂
 *
 * 与 native/fastify/express/koa 子路径保持一致，用户可在配置中使用：
 *
 * ```ts
 * import { honoAdapter } from "vextjs/adapters/hono";
 *
 * export default {
 *   adapter: honoAdapter(),
 * };
 * ```
 *
 * 内置字符串方式仍然可用：`adapter: "hono"`。
 */
export function honoAdapter(): VextAdapterFactory {
  return (app: VextApp, context?: VextAdapterRuntimeContext): VextAdapter =>
    createHonoAdapter(app, context);
}

export { createHonoAdapter } from "./adapter.js";
