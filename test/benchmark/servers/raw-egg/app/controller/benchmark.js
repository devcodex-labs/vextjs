/**
 * egg.js 基准测试控制器
 *
 * 实现 5 个路由处理器，与其他裸跑服务器（Hono/Fastify/Express/Koa）
 * 的响应格式完全一致，确保对比公平性。
 *
 * 场景说明：
 *   1. json   — 纯 JSON 序列化 + 响应，测量框架最小开销
 *   2. users  — 路由参数解析 + JSON 响应，测量路由匹配 + 参数提取开销
 *   3. chain  — handler 内联计时 / requestId / 鉴权模拟
 *   4. middleware-chain — 经过 3 层中间件（timing / requestId / auth）后 JSON 响应
 *   5. health — 健康检查端点，benchmark 脚本用于判断服务器就绪
 */

const { Controller } = require("egg");
const crypto = require("node:crypto");

class BenchmarkController extends Controller {
  /**
   * 场景 1: 纯 JSON 响应
   *
   * GET /json → { message: "Hello World" }
   *
   * 与其他裸跑服务器输出格式完全一致。
   * egg 通过 ctx.body 赋值发送 JSON（Koa 风格）。
   */
  async json() {
    this.ctx.body = { message: "Hello World" };
  }

  /**
   * 场景 2: 路由参数解析
   *
   * GET /users/:id → { id: "<id>", name: "User <id>" }
   *
   * egg 通过 ctx.params 获取路由参数（与 Koa + koa-router 一致）。
   */
  async users() {
    const id = this.ctx.params.id;
    this.ctx.body = { id, name: `User ${id}` };
  }

  /**
   * 场景 3: 3 层 handler 内联业务链 + JSON 响应
   *
   * GET /chain → { message: "Chain complete", requestId: "...", authenticated: true }
   *
   */
  async chain() {
    const startTime = Date.now();
    const requestId = crypto.randomUUID();
    this.ctx.get("Authorization");
    const elapsed = Date.now() - startTime;
    this.ctx.set("X-Response-Time", `${elapsed}ms`);
    this.ctx.set("X-Bench-Request-Id", requestId);
    this.ctx.body = {
      message: "Chain complete",
      requestId,
      authenticated: true,
    };
  }

  async middlewareChain() {
    this.ctx.body = {
      message: "Middleware chain complete",
      authenticated: true,
    };
  }

  /**
   * 健康检查
   *
   * GET /health → { status: "ok" }
   *
   * benchmark 脚本通过轮询此端点判断服务器是否就绪。
   */
  async health() {
    this.ctx.body = { status: "ok" };
  }
}

module.exports = BenchmarkController;
