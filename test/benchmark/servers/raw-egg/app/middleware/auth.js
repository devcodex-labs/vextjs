/**
 * egg.js 基准测试中间件 — 简单鉴权模拟
 *
 * 模拟 vext / Koa / Hono 裸跑服务器中的 auth 中间件：
 *   - 读取 Authorization 请求头（模拟鉴权检查，不真正拒绝）
 *   - 设置 ctx.state.authenticated = true
 *
 * 仅对 /chain 路径生效（通过 config.middleware + match 配置限定）。
 *
 * 与其他裸跑服务器的对齐说明：
 *   - raw-koa.mjs:    ctx.get('Authorization') + ctx.state.authenticated = true
 *   - raw-hono.mjs:   c.req.header('Authorization') + c.set('authenticated', true)
 *   - raw-express.mjs: req.headers['authorization'] + req._authenticated = true
 *   - raw-fastify.mjs: request.headers['authorization'] + request.authenticated = true
 *
 * 设计说明：
 *   此中间件故意不使用 await next() 前后的洋葱模型，
 *   因为鉴权检查是纯 before-middleware（只在请求进入时执行，
 *   不需要在响应返回时做任何事），与其他裸跑服务器行为一致。
 */

module.exports = () => {
  return async function auth(ctx, next) {
    // 模拟鉴权检查（不真正拒绝，只是做一次 header 读取）
    ctx.get("Authorization");
    ctx.state.authenticated = true;
    await next();
  };
};
