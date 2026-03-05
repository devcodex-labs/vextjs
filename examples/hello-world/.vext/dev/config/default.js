"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var default_exports = {};
__export(default_exports, {
  default: () => default_default
});
module.exports = __toCommonJS(default_exports);
var default_default = {
  // ── 服务器基础配置 ────────────────────────────────────
  port: 3e3,
  // 监听端口（1-65535）
  host: "0.0.0.0",
  // 监听地址（"0.0.0.0" 允许外部访问，"127.0.0.1" 仅本地）
  // ── Adapter 配置 ──────────────────────────────────────
  //
  // 内置 adapter（字符串标识，零 import，开箱即用）:
  //   "hono"     — 默认，基于 Hono 框架（轻量高性能，推荐）
  //   "fastify"  — 基于 Fastify 框架（企业级，丰富插件生态）
  //   "express"  — 基于 Express 框架（最广泛的社区生态）
  //   "koa"      — 基于 Koa 框架（洋葱模型中间件）
  //
  // 示例 — 字符串标识（推荐，最简方式）:
  //   adapter: "hono"
  //   adapter: "fastify"
  //   adapter: "express"
  //   adapter: "koa"
  //
  // 示例 — 工厂函数（需要自定义底层框架选项时使用）:
  //   import { fastifyAdapter } from 'vextjs/adapters/fastify'
  //   adapter: fastifyAdapter({ logger: true, bodyLimit: 1048576 })
  //
  //   import { expressAdapter } from 'vextjs/adapters/express'
  //   adapter: expressAdapter({ strict: true })
  //
  //   import { koaAdapter } from 'vextjs/adapters/koa'
  //   adapter: koaAdapter({ proxy: true })
  //
  // 注意：
  //   - 切换 adapter 不影响业务代码（路由、中间件、服务、插件）
  //   - 所有 adapter 行为一致：统一响应格式、统一错误处理、统一 body 解析
  //   - 不配置时默认使用 "hono"
  //
  // adapter: "hono",
  // ── 日志配置 ──────────────────────────────────────────
  logger: {
    level: "info"
    // 日志级别: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent"
    // pretty: true,  // 开发环境美化输出（默认 NODE_ENV !== 'production' 时自动启用）
  },
  // ── 响应配置 ──────────────────────────────────────────
  response: {
    hideInternalErrors: false
    // 生产环境建议设为 true，隐藏 500 错误的 stack 信息
  },
  // ── OpenAPI 文档 ──────────────────────────────────────
  openapi: {
    enabled: true
    // 启用后自动注册 GET /openapi.json + GET /docs（Swagger UI）
    // title: "My API",          // API 文档标题
    // description: "API docs",  // API 文档描述
    // version: "1.0.0",         // API 版本号
  }
};
//# sourceMappingURL=default.js.map
