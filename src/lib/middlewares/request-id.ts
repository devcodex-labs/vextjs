import { randomUUID } from "node:crypto";
import { requestContext } from "../request-context.js";
import type { VextMiddleware } from "../../types/middleware.js";
import type { VextRequestIdConfig } from "../../types/app.js";

/**
 * createRequestIdMiddleware — 请求 ID 中间件工厂
 *
 * 内置中间件 #1（执行顺序最靠前），职责：
 *   1. 从请求头透传 requestId（网关注入场景），不存在则生成 UUID v4
 *   2. 挂载到 req.requestId
 *   3. 写入 AsyncLocalStorage（requestContext）— logger / app.throw / app.fetch 等依赖此数据
 *   4. 写入响应头（默认 x-request-id）
 *
 * 配置项（config.requestId）：
 *   - enabled:        是否启用（默认 true）；false 时 req.requestId = ''，不写入 store
 *   - header:         从哪个请求头读取（默认 'x-request-id'）
 *   - responseHeader: 将 requestId 写入响应头（默认 'x-request-id'）
 *   - generate:       自定义生成函数（默认 crypto.randomUUID）；
 *                     插件可通过 app.setRequestIdGenerator() 覆盖
 *
 * 与 requestContext 的关系：
 *   adapter 在 registerRoute 中已调用 requestContext.run({ requestId: '', locale: undefined }, ...)
 *   创建了请求作用域。本中间件在链最前端执行，将真实 requestId 写入已有的 store 中。
 *   后续代码通过 requestContext.getStore()?.requestId 读取（logger mixin / defaultThrow / app.fetch）。
 *
 * @param config       requestId 配置（从 VextConfig.requestId 提取）
 * @param getGenerator 获取当前 ID 生成函数的 getter（支持 app.setRequestIdGenerator() 运行时替换）
 * @returns VextMiddleware
 */
export function createRequestIdMiddleware(
  config: VextRequestIdConfig,
  getGenerator: () => (() => string) | null,
): VextMiddleware {
  const enabled = config.enabled ?? true;
  const headerName = (config.header ?? "x-request-id").toLowerCase();
  const responseHeader = config.responseHeader ?? "x-request-id";

  return async (req, res, next) => {
    if (!enabled) {
      // 禁用模式：req.requestId 保持空字符串（adapter 初始化时已设为 ''）
      req.requestId = "";
      await next();
      return;
    }

    // ── 步骤 1：获取或生成 requestId ──────────────────────
    // 优先从请求头透传（网关注入），不存在则调用 generate()
    const fromHeader = req.headers[headerName];
    const generate = getGenerator() ?? config.generate ?? randomUUID;
    const requestId = fromHeader || generate();

    // ── 步骤 2：挂载到 req.requestId ─────────────────────
    req.requestId = requestId;

    // ── 步骤 3：写入 AsyncLocalStorage store ─────────────
    // adapter 已 run() 了 requestContext，这里更新已有 store
    const store = requestContext.getStore();
    if (store) {
      store.requestId = requestId;
    }

    // ── 步骤 4：写入响应头 ───────────────────────────────
    res.setHeader(responseHeader, requestId);

    await next();
  };
}
