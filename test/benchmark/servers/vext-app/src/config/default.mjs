/**
 * vext 基准测试项目配置
 *
 * adapter 通过 BENCH_ADAPTER 环境变量动态切换，
 * 支持 native / hono / fastify / express / koa 五种 adapter。
 *
 * 端口通过 PORT 环境变量指定。
 *
 * 说明：
 *   - 通过 enabled: false 禁用所有非必要中间件，聚焦测量 adapter 层和路由层核心开销
 *   - 不配置 database（避免 monSQLize 插件加载）
 *   - 日志设为 silent 避免 I/O 干扰性能测量
 */

import { createBenchmarkNormalAdapter } from "../../../vext-normal-adapter.mjs";

const requestedAdapter = process.env.BENCH_ADAPTER || "native";
const benchmarkMode = process.env.VEXT_BENCH_MODE || "normal";
const adapter =
  requestedAdapter === "native" && benchmarkMode === "normal"
    ? createBenchmarkNormalAdapter
    : requestedAdapter;
const port = parseInt(process.env.PORT || "3000", 10);

export default {
  // ── adapter 配置 ───────────────────────────────────────────
  adapter,

  // ── 服务器配置 ─────────────────────────────────────────────
  port,
  host: "127.0.0.1",

  // ── 日志配置 ───────────────────────────────────────────────
  // 设为 silent 避免日志 I/O 影响性能
  logger: {
    level: "silent",
  },

  // ── 中间件开关 ─────────────────────────────────────────────
  // Normal benchmark 显式禁用可选请求能力；requestContext=false 时不会
  // 注册 authContext，唯一保留的全局生命周期节点是 requestHook。
  // telemetry 会明确记录该节点，避免把 Normal 冒充为 Core。

  // 禁用速率限制（默认 max=100/60s，高并发下会限流导致大量 429）
  rateLimit: {
    enabled: false,
  },

  // 禁用访问日志（避免 I/O 开销）
  accessLog: {
    enabled: false,
  },

  // 禁用 CORS 中间件
  cors: {
    enabled: false,
  },

  // 禁用 requestId 生成（crypto.randomUUID 有一定开销）
  requestId: {
    enabled: false,
  },

  // middleware-chain 场景显式加载三层 route-level middleware。
  // 这三项只被该路由引用，不会进入其余 benchmark 场景。
  middlewares: ["bench-timing", "bench-request-id", "bench-auth"],

  // 禁用响应包装（避免额外的 JSON 包装层 { code, data, requestId }）
  response: {
    wrap: false,
  },

  // 禁用 body 解析（基准测试均为 GET 请求，无需解析请求体）
  bodyParser: {
    enabled: false,
  },

  // 禁用 AsyncLocalStorage 请求上下文（F1 优化）
  // ALS 每请求创建新的 store 对象并进入上下文，有 ~1-3μs/req 开销。
  // benchmark 不使用 requestContext，禁用后零副作用。
  // 预估 Vext RPS +5-10%。
  requestContext: {
    enabled: false,
  },

  // frontend disabled 时 bootstrap 不应注册 renderer noop middleware。
  frontend: {
    enabled: false,
  },

  // 显式列出默认关闭的能力，防止 benchmark 口径依赖默认值。
  session: {
    enabled: false,
  },
  csrf: {
    enabled: false,
  },
  securityHeaders: {
    enabled: false,
  },
};
