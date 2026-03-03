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
  port: 19953,
  host: "127.0.0.1",
  // ── Adapter 配置 ──────────────────────────────────────
  // 内置 adapter: "hono"（默认） | "fastify" | "express" | "koa"
  // 也可传入工厂函数（第三方 adapter）:
  //   import { fastifyAdapter } from 'vextjs/adapters/fastify'
  //   adapter: fastifyAdapter({ logger: true })
  adapter: "koa",
  logger: {
    level: "warn"
  },
  response: {
    hideInternalErrors: false
  },
  openapi: {
    enabled: true
  }
};
//# sourceMappingURL=default.js.map
