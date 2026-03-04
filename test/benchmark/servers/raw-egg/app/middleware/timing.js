/**
 * egg.js 基准测试中间件 — 请求计时（洋葱模型）
 *
 * 模拟 vext / Koa / Hono 裸跑服务器中的计时中间件：
 *   - before: 记录请求开始时间到 ctx.state.startTime
 *   - after:  计算耗时并设置 X-Response-Time 响应头
 *
 * 仅对 /chain 路径生效（通过 config.middleware + match 配置限定）。
 *
 * 与其他裸跑服务器的对齐说明：
 *   - raw-koa.mjs:    app.use(async (ctx, next) => { ... await next(); ... })
 *   - raw-hono.mjs:   app.use('/chain', async (c, next) => { ... await next(); ... })
 *   - raw-express.mjs: function timingMiddleware(req, res, next) { ... res.on('finish', ...) }
 *   - raw-fastify.mjs: fastify.addHook('onRequest', ...) + fastify.addHook('onSend', ...)
 *
 * egg 中间件遵循 Koa 洋葱模型：await next() 前为 before，之后为 after。
 */

'use strict';

module.exports = () => {
  return async function timing(ctx, next) {
    ctx.state.startTime = Date.now();
    await next();
    const elapsed = Date.now() - ctx.state.startTime;
    ctx.set('X-Response-Time', `${elapsed}ms`);
  };
};
