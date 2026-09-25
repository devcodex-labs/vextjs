# 介绍

## VextJS 是什么？

VextJS 是一个面向 API、服务端渲染 React 页面或两者并存场景的 AI-first Node.js 全栈框架。应用的 API 与 SSR 页面由 `src/routes/**` 定义路由，handler 可以调用服务、返回 JSON 或渲染页面。路由上的校验和响应声明可用于生成 OpenAPI 与类型客户端；授权、业务规则和缓存策略仍需按各自职责配置。你可以从默认全栈脚手架起步，也可以保持 API-only。

AI-first 描述的是面向 AI 辅助开发的工程界面：明确的约定、脚手架、类型契约、OpenAPI 与机器可读文档为编程助手提供有依据的输入。它不代表 VextJS 内置 LLM、Agent、RAG 系统或推理 runtime。

下面展示一个路由文件的基本形态，运行前需要按[快速开始](/zh/guide/quick-start)创建项目。已有 `src/routes/index.ts` 时，将注册语句合入原回调。

```typescript
// src/routes/index.ts
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

同一个路由文件也可以调用 `res.render()`，让 SSR 页面复用相同服务与请求生命周期。完整路径见[前端快速开始](/zh/frontend/getting-started)，有意排除的能力见[前端边界与路线图](/zh/frontend/boundaries-and-roadmap)。

## 核心特性

### 🔌 Adapter 架构

VextJS 的底层 HTTP 处理层是可替换的。内置 5 种 Adapter：

| Adapter            | 底层框架                           | 特点                             | 适用场景              |
| ------------------ | ---------------------------------- | -------------------------------- | --------------------- |
| **Native**（默认） | `http.createServer` + `route-core` | 零第三方 HTTP 框架依赖，默认路径 | 新项目、希望减少依赖  |
| **Hono**           | Hono + Vext 的 `node:http` 桥接    | Node.js 上的 Web Standards API   | Node.js 应用          |
| **Fastify**        | Fastify                            | 通过 Vext Adapter 接入 Fastify   | 已有 Fastify 使用经验 |
| **Express**        | Express                            | 通过 Vext Adapter 接入 Express 5 | 已有 Express 使用经验 |
| **Koa**            | Koa                                | 通过 Vext Adapter 接入 Koa 3     | 已有 Koa 使用经验     |

使用 VextJS `req` / `res` 编写的路由 handler 通常无需随 Adapter 改写；底层框架专属的中间件或插件仍需单独核对集成边界。选择非 Native Adapter 前，需要安装对应的框架依赖，见 [Adapter 指南](/zh/guide/adapters)。依赖就绪后，在配置中选择 Adapter：

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

### ⚡ 性能与取舍

站点基准比较同一个Vext Normal应用在五个Adapter下的表现，不是Raw Native/Raw Fastify跨框架排行。结果页列有实际源码版本、环境与测量日期；不能将历史样本直接当成本版本或任意生产应用的性能承诺。

请在[性能基准](/zh/benchmark)查看当前数据、测试口径、adapter 选择建议和复现命令。生产选型仍应加入你的认证、日志、中间件、I/O 与部署环境重新压测。

### 🛡️ 声明式参数校验

内置 schema-dsl 校验适配，在路由 `options` 中声明校验规则；请求执行时验证输入，启用 OpenAPI 后同一声明还可生成接口文档：

以下是放在 `defineRoutes` 回调中的片段，假定应用已有 user service；完整可运行流程见[参数校验](/zh/guide/validation)。

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
    // 通过 req.valid() 读取校验结果，不依赖校验器是否原地修改输入。
    const body = req.valid("body");
    const user = await app.services.user.create(body);
    res.json(user);
  },
);
```

### 🧩 插件系统

通过 `definePlugin()` 扩展框架能力，支持初始化、就绪和关闭钩子。以下文件演示注册进程内缓存，并在应用关闭时清理它：

```typescript
// src/plugins/user-cache.ts
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "user-cache-plugin",

  async setup(app) {
    // 在 app 上注册能力
    const cache = new Map<string, unknown>();
    app.extend("userCache", {
      get: (key: string) => cache.get(key),
      set: (key: string, value: unknown) => {
        cache.set(key, value);
      },
    });
    app.onClose(() => {
      cache.clear();
    });
  },

  async onReady(app) {
    app.logger.info("Cache plugin ready");
  },
});
```

这是无 TTL、无容量上限的进程内 Map 示例，不具备多 worker 共享能力。业务缓存的持久化、过期和共享策略由应用选择的存储实现；接入方式见[插件指南](/zh/guide/plugins)。框架的[路由响应缓存](/zh/guide/cache)另有配置与生命周期，不等同于这里的 `userCache`。应用若引入定时器或连接，应同时实现对应的关闭逻辑。

在其他 TypeScript 文件中使用 `app.userCache` 时，还应按插件指南补充扩展类型声明；运行时挂载对象不保证静态工具能完整推导其类型。

### 🧱 模块系统与装饰器策略

VextJS 使用 ESM + 约定式目录作为模块系统：启动时加载配置、语言包、插件、中间件定义、服务与路由。各入口规则不同，例如中间件按 `config.middlewares` 名称查找，放进目录不等于全局执行；详见[项目结构](/zh/guide/project-structure)。

VextJS 当前不提供 `@Controller` / `@Get` / `@Inject` / `@Service` 等装饰器 API，也不依赖 `reflect-metadata`。路由使用 `defineRoutes()`，插件使用 `definePlugin()`，服务通过 `new ServiceClass(app)` 构造函数注入 `app`。如果你从 NestJS 等装饰器框架迁移，请把控制器装饰器迁移为 `src/routes/*.ts` 文件路由，把构造器依赖注入迁移为 `app.services` 延迟访问。

### 🔥 开发体验

- **`vext dev`** — 文件监听 + 智能热重载（Soft Reload Tier 1/2 + Cold Restart Tier 3）
- **`vext build`** — esbuild构建；类型检查应独立执行，特殊资源与输出仍需符合项目配置
- **`vext create`** — 交互式脚手架，支持 5 种 Adapter 选择
- **OpenAPI / Vext Docs** — 基于路由 `docs`、`validate` 与 `responses` 生成接口文档；启用后默认访问 `/docs`，外部工具可消费 `/openapi.json`，也支持展示所配置源码范围内的 JSDoc 文档

### 🏢 企业级特性

- **Cluster 多进程** — `ClusterMaster` + Worker 心跳 + Rolling Restart + 优雅关闭
- **国际化 (i18n)** — 语言包自动加载，错误消息多语言
- **内置限流** — 基于 `flex-rate-limit`，默认关闭；用户维度及认证时机见[请求限流](/zh/guide/rate-limit)
- **请求追踪** — AsyncLocalStorage 贯穿 route → service，自动注入 requestId
- **MonSQLize 插件** — 内置连接与模型生命周期，由非空的 `config.database` 触发；未配置、null或空对象不初始化。当前没有database.enabled关闭开关，见[数据库](/zh/guide/database)

## 设计理念

### 1. 约定优于配置

常规应用遵循 `src/routes/`、`src/services/`、`src/config/` 等目录约定，由框架加载相应入口，无需逐个手动注册。辅助模块和可选能力的放置规则见[项目结构](/zh/guide/project-structure)。

### 2. 分层架构

推荐按以下职责组织应用：

```text
路由层 (routes)    ← 参数提取 + 响应返回
   ↓
服务层 (services)  ← 业务逻辑（纯数据，不感知 HTTP）
   ↓
数据层 (models)    ← 数据访问（通过插件提供）
```

- 路由 handler 负责请求校验后的参数提取、调用服务及响应返回
- 业务逻辑集中在 service 层，通过 `app.services.xxx` 访问
- 推荐service不直接操作req/res，便于HTTP、Job等消费者复用；框架不自动禁止跨层访问

### 3. 底层可替换

通过Adapter统一请求与响应合同，基于Vext API编写的业务代码通常可以复用。直接使用原生对象、底层插件或传输特性的代码仍须核对所选Adapter，不能据此保证任意插件都可无改动切换。

## 选型时如何比较

比较框架时，应以具体版本、插件和部署工具组合为单位，不能把某个框架本体没有提供的工具直接写成整个生态“不支持”。VextJS的可核对边界如下：

| 比较维度        | VextJS当前入口                 | 需要验证的应用条件              |
| --------------- | ------------------------------ | ------------------------------- |
| HTTP底层        | 五种Adapter                    | 原生插件和传输特性兼容性        |
| 路由与输入      | 文件路由、validate             | 既有URL/Schema能否迁入静态合同  |
| OpenAPI与客户端 | 路由投影、类型客户端工具       | 动态定义能否被完整分析          |
| 开发重载        | dev的Soft Reload与Cold Restart | 模块变更是否需要冷重启          |
| 多进程          | Cluster与优雅关闭              | 进程内状态是否需要外部共享      |
| 依赖与性能      | package声明和可复现基准        | 所选Adapter、插件与真实请求负载 |

迁移示例从[路由](/zh/guide/routing)、[插件](/zh/guide/plugins)及[部署](/zh/guide/deployment)核对，不以“轻量/重量”标签代替实际依赖与运维成本。

## 环境要求

- 要求 Node.js **`^20.19.0 || >=22.12.0`**
- **TypeScript** 5.x（推荐，也支持纯 JavaScript）

## 下一步

前往[快速开始](/zh/guide/quick-start)创建项目。在已有可运行应用中加入本页 `src/routes/index.ts` 的 hello 路由并合并配置，执行 `npm run dev` 后请求 `GET http://127.0.0.1:3000/hello`，应返回 200 及 `data.message: "Hello VextJS!"`。已有 index 路由时合并回调，避免覆盖原入口；若得到 404，核对文件前缀和实际端口。
