# 介绍

## VextJS 是什么？

VextJS 是一个现代化的 Node.js Web 框架，专为构建高性能 RESTful API 而设计。它提供 **Adapter 架构**（底层 HTTP 框架可替换）、**插件系统**、**约定式路由**、**服务自动注入**、**声明式参数校验**、**OpenAPI 文档自动生成** 等企业级特性，让你专注于业务逻辑。

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/hello",
    {
      docs: { summary: "问候接口" },
    },
    async (_req, res) => {
      res.json({ message: "Hello VextJS!" });
    },
  );
});
```

## 核心特性

### 🔌 Adapter 架构

VextJS 的底层 HTTP 处理层是可替换的。内置 5 种 Adapter：

| Adapter            | 底层框架                           | 特点                           | 适用场景          |
| ------------------ | ---------------------------------- | ------------------------------ | ----------------- |
| **Native**（默认） | `http.createServer` + `route-core` | 零外部 HTTP 框架依赖，性能最高 | 追求极致性能      |
| **Hono**           | Hono                               | Web Standards API              | 全栈 / 边缘运行时 |
| **Fastify**        | Fastify                            | 生态丰富，序列化优化           | 大型项目          |
| **Express**        | Express                            | 最大中间件生态                 | 迁移项目          |
| **Koa**            | Koa                                | 轻量优雅                       | 中小型项目        |

切换 Adapter 仅需修改一行配置，**业务代码零改动**：

```typescript
// src/config/default.ts
import { nativeAdapter } from "vextjs/adapters/native";
// import { honoAdapter } from 'vextjs/adapters/hono';
// import { fastifyAdapter } from 'vextjs/adapters/fastify';

export default {
  adapter: nativeAdapter(),
  port: 3000,
};
```

### ⚡ 极致性能

历史基准快照（JSON 响应场景，5 轮中位数）：

| 框架    | Raw RPS | Vext RPS | 框架开销 |
| ------- | ------: | -------: | -------: |
| Native  |  44,932 |   36,819 |    18.1% |
| Fastify |  45,619 |   29,203 |    36.0% |
| Hono    |  20,703 |   15,684 |    24.2% |
| Express |  29,868 |   30,974 |    -3.7% |

> Vext 的开销包含：body parser、response wrapper、请求/响应抽象、AsyncLocalStorage 上下文、中间件链执行器等**完整功能**。

> ⚠️ **测试环境说明**：上表为 2026-03-23 历史快照，基于 Node.js v24.14.0 / Windows x64 / Intel i7-9700 / autocannon（50 connections, 10 pipelining, 10s × 5 轮中位数）测得。当前版本复现实测以仓库内 `test/benchmark/run-benchmark.mjs` 为准，并区分 `chain` 与 `middleware-chain`。完整口径请参见 [性能基准测试](/benchmark)。

### 🛡️ 声明式参数校验

集成 [schema-dsl](https://github.com/vextjs/schema-dsl)，在路由 `options` 中声明校验规则，自动验证 + 自动生成 OpenAPI 文档：

```typescript
app.post(
  "/users",
  {
    validate: {
      body: {
        name: "string!", // 必填字符串
        email: "email!", // 必填邮箱格式
        age: "number?", // 可选数字
        role: "admin|user", // 枚举
      },
    },
    docs: { summary: "创建用户" },
  },
  async (req, res) => {
    // req.body 已通过校验，类型安全
    const user = await app.services.user.create(req.body);
    res.json(user);
  },
);
```

### 🧩 插件系统

通过 `definePlugin()` 扩展框架能力，支持完整生命周期钩子：

```typescript
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "user-cache-plugin",

  async setup(app) {
    // 在 app 上注册能力
    const cache = new Map();
    app.extend("userCache", {
      get: (key: string) => cache.get(key),
      set: (key: string, value: unknown, ttl?: number) => {
        cache.set(key, value);
        if (ttl) setTimeout(() => cache.delete(key), ttl);
      },
    });
  },

  async onReady(app) {
    app.logger.info("Cache plugin ready");
  },

  async onClose(app) {
    // 清理资源
  },
});
```

### 🧱 模块系统与装饰器策略

VextJS 使用 ESM + 约定式目录作为模块系统：`src/config/`、`src/plugins/`、`src/middlewares/`、`src/services/`、`src/routes/` 会在启动时自动扫描，并按照配置 → 插件 → 中间件定义 → 服务 → 路由的顺序加载。

VextJS 当前不提供 `@Controller` / `@Get` / `@Inject` / `@Service` 等装饰器 API，也不依赖 `reflect-metadata`。路由使用 `defineRoutes()`，插件使用 `definePlugin()`，服务通过 `new ServiceClass(app)` 构造函数注入 `app`。如果你从 NestJS 等装饰器框架迁移，请把控制器装饰器迁移为 `src/routes/*.ts` 文件路由，把构造器依赖注入迁移为 `app.services` 延迟访问。

### 🔥 开发体验

- **`vext dev`** — 文件监听 + 智能热重载（Soft Reload Tier 1/2 + Cold Restart Tier 3）
- **`vext build`** — esbuild 极速构建，TypeScript 零配置
- **`vext create`** — 交互式脚手架，支持 5 种 Adapter 选择
- **OpenAPI / Scalar** — 基于路由 `docs` + `validate` 自动生成，访问 `/docs` 查看（内置 Try it out 交互式测试）

### 🏢 企业级特性

- **Cluster 多进程** — `ClusterMaster` + Worker 心跳 + Rolling Restart + 优雅关闭
- **国际化 (i18n)** — 语言包自动加载，错误消息多语言
- **内置限流** — 基于 `flex-rate-limit`，支持 IP / 用户维度
- **请求追踪** — AsyncLocalStorage 贯穿 route → service，自动注入 requestId
- **MonSQLize 插件** — 内置数据库插件，条件加载零开销

## 设计理念

### 1. 约定优于配置

遵循固定的项目结构约定（`src/routes/`、`src/services/`、`src/config/`），框架自动扫描加载，无需手动注册。

### 2. 分层架构

```
路由层 (routes)    ← 参数提取 + 响应返回
   ↓
服务层 (services)  ← 业务逻辑（纯数据，不感知 HTTP）
   ↓
数据层 (models)    ← 数据访问（通过插件提供）
```

- 路由 handler 只负责参数提取和响应返回
- 业务逻辑集中在 service 层，通过 `app.services.xxx` 访问
- service 不感知 HTTP 协议，便于复用和测试

### 3. 底层可替换

通过 Adapter 架构，框架核心与底层 HTTP 处理完全解耦。所有业务代码（路由、中间件、服务、插件）操作的是 VextJS 封装的 `req` / `res` 对象，而非底层框架的原生对象。

## 与其他框架对比

| 特性         | VextJS               | Fastify        | Express     | NestJS             |
| ------------ | -------------------- | -------------- | ----------- | ------------------ |
| 底层可替换   | ✅ 5 种 Adapter      | ❌             | ❌          | ✅ Express/Fastify |
| 约定式路由   | ✅ 文件级自动扫描    | ❌ 手动注册    | ❌ 手动注册 | ✅ 装饰器          |
| 参数校验     | ✅ 声明式 schema-dsl | ✅ JSON Schema | 需中间件    | ✅ class-validator |
| OpenAPI 生成 | ✅ 自动              | 需插件         | 需中间件    | ✅ 装饰器          |
| 热重载       | ✅ Soft + Cold       | ❌             | ❌          | ❌                 |
| Cluster 管理 | ✅ 内置              | ❌             | ❌          | ❌                 |
| 体量         | 轻量                 | 轻量           | 轻量        | 重量               |

## 环境要求

- **Node.js** >= 18.0.0
- **TypeScript** 5.x（推荐，也支持纯 JavaScript）

## 下一步

准备好了吗？前往 [快速开始](/guide/quick-start) 创建你的第一个 VextJS 项目。
