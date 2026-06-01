import { createHonoAdapter } from "./adapter.js";
import type { VextAdapter } from "../../types/adapter.js";
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
export function honoAdapter(): (app: VextApp) => VextAdapter {
  return (app: VextApp): VextAdapter => createHonoAdapter(app);
}

export { createHonoAdapter } from "./adapter.js";
