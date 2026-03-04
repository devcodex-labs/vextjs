/**
 * egg.js 基准测试中间件 — 请求 ID 生成
 *
 * 模拟 vext / Koa / Hono 裸跑服务器中的 requestId 中间件：
 *   - before: 生成 UUID v4 并存入 ctx.state.requestId
 *   - after:  设置 X-Request-Id 响应头
 *
 * 仅对 /chain 路径生效（通过 config.middleware + match 配置限定）。
 *
 * 与其他裸跑服务器的对齐说明：
 *   - raw-koa.mjs:    crypto.randomUUID() + ctx.state.requestId + ctx.set('X-Request-Id', ...)
 *   - raw-hono.mjs:   crypto.randomUUID() + c.set('requestId', ...) + c.header('X-Request-Id', ...)
 *   - raw-express.mjs: crypto.randomUUID() + req._requestId + res.setHeader('X-Request-Id', ...)
 *   - raw-fastify.mjs: crypto.randomUUID() + request.benchRequestId + reply.header('X-Request-Id', ...)
 *
 * egg 中间件遵循 Koa 洋葱模型：await next() 前为 before，之后为 after。
 */

'use strict';

const crypto = require('node:crypto');

module.exports = () => {
  return async function requestId(ctx, next) {
    const id = crypto.randomUUID();
    ctx.state.requestId = id;
    await next();
    ctx.set('X-Request-Id', id);
  };
};
