# VextJS

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

> 一个现代化的 Node.js Web 框架，开箱即用，专为构建高性能 RESTful API 而设计。

vextjs 提供 Adapter 架构（底层可替换）、插件系统、约定式路由、服务自动注入、参数校验、OpenAPI 文档自动生成等企业级特性，让你专注于业务逻辑。


---

## ✨ 特性

- **🔌 Adapter 架构** — 底层 HTTP 框架可替换（默认 Native Adapter，零外部依赖），业务代码无需改动
- **📁 约定式路由** — `src/routes/` 下的文件自动扫描加载，文件路径即路由前缀
- **🧩 插件系统** — 拓扑排序、依赖声明、生命周期钩子，轻松扩展框架能力
- **💉 服务自动注入** — `src/services/` 下的 class 自动实例化并挂载到 `app.services`
- **🛡️ 参数校验** — 集成 [schema-dsl](https://www.npmjs.com/package/schema-dsl)，声明式校验 + i18n 错误消息
- **📖 OpenAPI 文档** — 路由元信息自动收集，生成 OpenAPI 3.0.3 JSON
- **🔥 开发模式热重载** — 三层重载策略（Soft Reload + Cold Restart），毫秒级反馈
- **🏗️ 内置中间件** — requestId、CORS、bodyParser、rateLimit、accessLog、responseWrapper 开箱即用
- **⚡ 路由缓存** — 声明式 `cache: 60`，LRU 内存存储，标签失效，Vary headers，条件缓存
- **🌐 i18n 支持** — `src/locales/` 语言包自动加载，校验错误消息多语言
- **🧪 测试工具** — 内置 `createTestApp`，无需启动 HTTP 服务器即可测试路由
- **⚡ TypeScript 原生** — 完整类型定义，极致的 IDE 补全体验
- **🧰 工程辅助命令** — `vext typegen` 可生成 `app.services` / `app.extend()` 声明并执行 tooling 层依赖诊断；`vext doctor routes` 已进入 Phase 2 预览
- **🛰️ Preload 生态集成** — 同时支持依赖包 `vext.preload` 与项目根 `preload/` 目录；适合 OpenTelemetry / APM / polyfill / 启动前环境桥接这类必须早于应用代码执行的能力
- **📦 零配置启动** — 合理的默认配置，最少 5 个字段即可运行

---

## 🧭 快速导航

如果你是第一次接触 VextJS，推荐按下面顺序阅读：

1. **5 分钟跑起来** → 直接看 [🚀 快速开始](#-快速开始)
2. **先判断是启动期配置还是进程级预加载** → 看 [启动期远程配置（bootstrap）](#31-可选启动期远程配置srcconfigbootstrapjs) 与 [OpenTelemetry 零配置接入](#32-可选零配置接入-opentelemetrypreload-型生态)
3. **想接 OpenTelemetry** → 继续看下方的 [OpenTelemetry 零配置接入速查](#-vextjs--opentelemetry-零配置接入速查)
4. **想了解命令行能力** → 继续往下看 `CLI 命令` 章节
5. **想看配置与环境切换** → 继续往下看 `配置` 与 `环境变量` 章节
6. **想系统化学习** → 官网文档：<https://vextjs.github.io/vext/>

---

## 📦 安装

```bash
npm install vextjs
```

> 默认使用 **Native Adapter**（基于 Node.js `http.createServer` + [`find-my-way`](https://github.com/delvedor/find-my-way) radix trie），零外部 HTTP 框架依赖，性能最优。

如需使用其他 adapter，请额外安装对应框架包：

```bash
# Fastify adapter
npm install fastify

# Hono adapter
npm install hono @hono/node-server

# Express adapter
npm install express

# Koa adapter
npm install koa
```

然后在配置中指定 adapter：

```js
// src/config/default.js
export default {
  adapter: "fastify", // 'native' (默认) | 'fastify' | 'hono' | 'express' | 'koa'
};
```

---

## ⚡ 性能

VextJS 提供 5 种 adapter，覆盖不同使用场景。以下为基准测试数据（5 轮取中位数）：

### Native vs Fastify（核心对比）

| 场景          | Raw Native | Vext Native | Raw Fastify | Vext Fastify | Native 领先 |
| ------------- | ---------: | ----------: | ----------: | -----------: | :---------: |
| **JSON 响应** |     44,932 |  **36,819** |      45,619 |       29,203 | **+26.1%**  |
| **路由参数**  |     43,859 |  **36,755** |      43,676 |       24,386 | **+50.7%**  |
| **中间件链**  |     28,337 |  **31,698** |      41,286 |       22,719 | **+39.5%**  |

> Vext-Native 在所有场景领先 Vext-Fastify **26~51%**（中间件链场景 Vext-Native 甚至超越裸跑 Native +11.9%）。

### 全 Adapter 性能概览（JSON 场景）

| Adapter       |   Vext RPS | Overhead | 额外依赖                   | 推荐场景                |
| ------------- | ---------: | -------: | -------------------------- | ----------------------- |
| **Native** ⭐ | **36,819** |    18.1% | ✅ 零依赖                  | **默认推荐**，性能最优  |
| Express       |     30,974 |    -3.7% | `express`                  | 已有 Express 生态需复用 |
| Fastify       |     29,203 |    36.0% | `fastify`                  | 需要 Fastify 生态插件   |
| Koa           |     22,488 |    29.4% | `koa`                      | 已有 Koa 中间件需复用   |
| Hono          |     15,684 |    24.2% | `hono` `@hono/node-server` | Web Standard API 兼容   |

> **测试环境**: Node.js v24.14.0 + autocannon（50 connections, 10 pipelining, 10s × 5 轮取中位数, Windows x64, i7-9700, 32GB RAM，2026-03-23）
>
> Native adapter 使用 Node.js 内置 `http.createServer` + `find-my-way` radix trie 路由，是 VextJS 唯一不依赖第三方 HTTP 框架的 adapter。Vext-Native 比 Vext-Fastify 快 **26.1%**（JSON）/ **39.5%**（中间件链），比 Vext-Hono 快 **135%**，比 Vext-Express 快 **18.9%**（Express v5 + Node.js v24 性能大幅提升）。所有数据经 5 轮中位数验证，绝大多数 CV（变异系数）< 3.5%。

### Adapter 选择指南

| 你的场景              | 推荐 Adapter       | 理由                                        |
| --------------------- | ------------------ | ------------------------------------------- |
| 新项目，无历史包袱    | **native**（默认） | 零外部依赖 + 性能最优                       |
| 已有 Fastify 插件生态 | fastify            | 可复用 Fastify 插件（如 fastify-multipart） |
| 已有 Express 中间件   | express            | 兼容庞大的 Express 中间件生态               |
| 已有 Koa 中间件       | koa                | 兼容 Koa 中间件                             |
| 需要 Web Standard API | hono               | Hono 支持 Request/Response Web API 标准     |

---

## 🚀 快速开始

### 1. 创建项目结构

```
my-app/
├── src/
│   ├── config/
│   │   ├── default.js       # 应用配置
│   │   └── bootstrap.js     # 启动期远程配置 provider（可选）
│   └── routes/
│       └── index.js          # 路由定义
└── package.json
```

### 2. 配置 `package.json`

```json
{
  "name": "my-app",
  "type": "module",
  "scripts": {
    "start": "vext start",
    "dev": "vext dev"
  },
  "dependencies": {
    "vextjs": "^0.3.5"
  }
}
```

### 3. 编写配置

```js
// src/config/default.js
export default {
  port: 3000,
  host: "0.0.0.0",
  logger: {
    level: "info",
  },
  openapi: {
    enabled: true,
  },
};
```

> 💡 只需声明你关心的字段，其他字段（`requestId`、`cors`、`bodyParser`、`rateLimit`、`accessLog` 等）由框架自动补全默认值。

### 3.1 可选：启动期远程配置（`src/config/bootstrap.js`）

当数据库、密钥、Nacos 远程配置等内容**必须在配置冻结前生效**时，可新增 `src/config/bootstrap.js`：

```js
// src/config/bootstrap.js
import { defineBootstrapConfig } from "vextjs";

export default defineBootstrapConfig({
  providers: [
    {
      name: "remote-config",
      async load({ env, signal }) {
        const response = await fetch(`https://config.example.com/${env}.json`, {
          signal,
        });
        const remote = await response.json();
        return {
          database: remote.database,
        };
      },
    },
  ],
});
```

配置优先级：

```text
默认值 → default.js → {NODE_ENV}.js → local.js → bootstrap provider patch → CLI override
```

适合场景：

- 启动期数据库配置
- 远程配置中心 patch
- 需要在内置插件初始化前可见的基础设施配置

不适合场景：

- APM / OpenTelemetry SDK 初始化
- monkey patch / polyfill

这类“进程级提早执行”能力应继续使用 `preload`。

### 3.2 可选：零配置接入 OpenTelemetry（preload 型生态）

如果你希望在 Vext 应用里直接启用 Trace / Metrics / Logs，可安装 `vextjs-opentelemetry`：

```bash
npm install vextjs-opentelemetry
```

```json
{
  "vext": {
    "otel": {
      "serviceName": "my-app",
      "endpoint": "http://otel-collector.internal:4318",
      "sampling": { "ratio": 1 }
    }
  }
}
```

```js
// src/plugins/otel.js
import { opentelemetryPlugin } from "vextjs-opentelemetry/vextjs";

export default opentelemetryPlugin({
  serviceName: "my-app",
  tracing: {
    ignorePaths: ["/health", "/_otel/status"],
  },
  logs: {
    bridgeAppLogger: true,
  },
});
```

然后继续使用 `vext dev` / `vext start` 启动即可。CLI 会自动读取依赖包声明的 `vext.preload`，也会识别项目根 `preload/` 目录，并在应用代码前注入对应脚本，无需手动加 `node --import ...`。

如果你是应用项目而不是插件包，现在也可以直接在项目根创建：

```text
preload/
├── 01-bootstrap-port.ts
└── 02-bootstrap-verbose.mjs
```

- `.mjs` / `.js` 会直接作为 ESM preload 注入
- `.ts` / `.mts` 会在启动前编译到 `.vext/preload/*.mjs` 再注入
- `vext dev` 下修改 `preload/` 中的文件会触发 cold restart，确保结果与手动重启一致
- `vext build` 会把项目根 `preload/` 编译到 `dist/preload/*.mjs`，便于生产部署只携带 `dist/`

更多说明：

- preload 机制：<https://vextjs.github.io/vext/guide/preload>
- VextJS OpenTelemetry 完整接入：<https://vextjs.github.io/vext/examples/opentelemetry>

---

## 🛰️ VextJS + OpenTelemetry 零配置接入速查

### 双入口配置优先级（VextJS 专用）

`vextjs-opentelemetry` 在 VextJS 里有两个正式入口，但职责不同：

| 入口 | 生效阶段 | 适合放什么 | 不适合放什么 |
| ---- | -------- | ---------- | ------------ |
| `package.json` → `vext.otel` | **preload / 进程启动前** | `serviceName`、`endpoint`、`protocol`、`headers`、`sampling` 这类“SDK 一开始就要知道”的默认导出配置 | `ignorePaths`、`capture`、日志桥接、请求级逻辑 |
| `src/plugins/otel.js` → `opentelemetryPlugin()` | **plugin setup + request** | `tracing`、`metrics`、`lifecycle`、`logs.bridgeAppLogger`，以及 setup 阶段对 exporter 的补充 / 覆盖 | 指望它回写 preload 阶段已经启动好的 SDK Resource |

> ✅ 推荐做法：把“导出到哪里、用什么协议、服务名是什么”优先收敛到 `package.json vext.otel`；把“请求要采什么、日志怎么桥接、哪些路径忽略”放进 `opentelemetryPlugin()`。

### `endpoint` / `protocol` 对照

| 目标 | 推荐配置 | `protocol` | 结果 |
| ---- | -------- | ---------- | ---- |
| 完全不上报 | 不写 `endpoint`，或显式写 `"none"` | — | SDK 可保持安全 noop / 不导出任何数据 |
| 本地文件调试 | `"./otel-data"` | — | 按 `pid` 写入 `traces.*.jsonl` / `metrics.*.jsonl` / `logs.*.jsonl` |
| OTLP HTTP Collector | `"http://otel-collector.internal:4318"` | `"http"`（默认） | 通过 OTLP/HTTP 上报 |
| OTLP gRPC Collector | `"otel-collector.internal:4317"` | `"grpc"` | 通过 gRPC h2c 上报 |

> 💡 如果你同时在 `package.json vext.otel` 和 `opentelemetryPlugin()` 里都写了 `endpoint / protocol / headers`，建议保持一致，避免 `/_otel/status`、启动日志和最终实际导出目标出现认知偏差。

### 快速排查

- **`/_otel/status` 显示 `sdk: "noop"`**
  - 确认是通过 `vext dev` / `vext start` 启动，而不是直接 `node dist/server.js`
  - 确认 `vextjs-opentelemetry` 在 `dependencies` 中
  - 若必须自定义 Node 启动命令，请手动补 `--import vextjs-opentelemetry/instrumentation`
- **`exportTarget` 不是你期望的地址**
  - 先检查 `package.json vext.otel`
  - 再检查 `src/plugins/otel.js` 是否又追加了不同的 `endpoint / protocol / headers`
- **日志里没有 `trace_id`**
  - 先确认 `/_otel/status` 已是 `initialized`
  - 再确认插件已正常加载；如果希望 `app.logger` 也桥接到 OTel Logs，开启 `logs.bridgeAppLogger: true`
- **后端一直收不到数据**
  - 先用 `./otel-data` 本地文件模式确认数据是否已生成
  - 再检查 Collector 地址、端口、协议是否匹配，并预留一点批量导出延迟

### 安全与隐私提醒

- `capture.headers`、`capture.body` **只建议白名单采集**，不要把 `authorization`、`cookie`、密码、手机号、邮箱等敏感字段直接打进遥测
- `/_otel/status` 适合排障，但生产环境建议只开放给内网或经网关限制访问
- `headers` 中若需要放 API Key / Token，优先通过环境变量或部署平台 Secret 注入；不要把真实密钥硬编码进仓库里的 `package.json`
- `package.json vext.otel` 更适合放“默认导出目标与服务名”这类非敏感配置；真正的敏感凭证请交给运行时注入

### 4. 编写路由

```js
// src/routes/index.js
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, async (req, res) => {
    res.json({ message: "Hello, VextJS!" });
  });

  app.get("/health", {}, async (req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });
});
```

### 5. 启动

```bash
# 开发模式（热重载）
npm run dev

# 生产模式
npm start
```

```bash
# 验证
curl http://localhost:3000/
# → {"code":0,"data":{"message":"Hello, VextJS!"}}
```

---

## 🖥️ CLI 命令

VextJS 提供内置 CLI，通过 `npx vext` 或 `package.json` scripts 调用。

### `vext start` — 启动编译产物

```bash
vext start                          # 使用默认配置启动
vext start --port 8080              # 指定端口
vext start --host 127.0.0.1         # 指定监听地址
NODE_ENV=production vext start      # 加载 production 配置
NODE_ENV=sg-sit vext start          # 加载 sg-sit 配置（需存在 src/config/sg-sit.ts）
```

启动流程：检测项目结构 → 加载配置 → 注册插件/中间件/服务/路由 → 启动 HTTP 服务器。

如果存在 `dist/` 编译产物，自动使用编译后的 JS 运行；TypeScript 项目无 `dist/` 时自动通过 `tsx` 加载。

环境配置文件通过运行时 `NODE_ENV` 选择：`src/config/{NODE_ENV}.ts`。

> ⚠️ `vext build` 当前会将用户源码中的 `process.env.NODE_ENV` 静态注入为 `"production"`。因此不要依赖 build 后源码里的 `process.env.NODE_ENV` 条件分支做运行时环境切换；环境差异应优先写入 `src/config/<env>.ts`、bootstrap provider 或其他显式业务环境变量。

### `vext dev` — 开发模式

```bash
vext dev                      # 启动开发服务器
vext dev --poll               # Docker / NFS 环境使用轮询模式
vext dev --poll-interval 2000 # 自定义轮询间隔（毫秒）
vext dev --debounce 50        # 自定义防抖间隔（毫秒，默认 0 不开启）
vext dev --no-hot             # 禁用 Soft Reload，所有变更走 Cold Restart
vext dev --clear              # 每次重载后清空控制台
```

**三层重载策略：**

| Tier | 触发条件                  | 动作                                       | 速度      |
| ---- | ------------------------- | ------------------------------------------ | --------- |
| T1   | 代码修改（modify）        | Soft Reload — `esbuild.transform()` 热替换 | ⚡ 毫秒级 |
| T2   | 文件新增 / 删除           | Soft Reload — `esbuild ctx.rebuild()` 重建 | ⚡ 毫秒级 |
| T3   | 配置 / 插件 / `.env` 变更 | Cold Restart — kill + fork 重启子进程      | 🔄 秒级   |

**键盘快捷键：**

| 按键     | 功能                     |
| -------- | ------------------------ |
| `r`      | 手动 Cold Restart        |
| `h`      | 手动 Soft Reload（全量） |
| `c`      | 清空控制台               |
| `?`      | 显示帮助                 |
| `Ctrl+C` | 退出开发服务器           |

### `vext build` — 构建

```bash
vext build                    # TypeScript 编译为 JavaScript
```

### `vext typegen` / `vext doctor routes` — 工程辅助命令（experimental）

Phase 1 / Phase 2 新增的静态工具链能力保持在 **tooling-only** 边界：不会进入 `start / dev / build` 的默认 runtime 主路径。

```bash
# 生成 app.services / app.extend() 声明，并执行 tooling 层 service 依赖诊断
vext typegen

# 仅校验 generated 产物是否需要更新，不写文件
vext typegen --check

# 输出服务索引 / app.extend / 依赖图的稳定 manifest
vext typegen --write-manifest

# 扫描静态路由信息，并将诊断结果写入 inspect + manifest
vext doctor routes --write-inspect --write-manifest
```

当前产物约定：

- `src/types/generated/services.generated.d.ts`
- `src/types/generated/app-extensions.generated.d.ts`
- `.vext/inspect/services.manifest.json`
- `.vext/inspect/routes.json`
- `.vext/inspect/routes.manifest.json`

说明：

- `vext typegen` 面向 `services` / `plugins`，解决声明生成与依赖诊断问题；
- `vext typegen --write-manifest` 会额外生成 `services.manifest.json`，把 service 索引、`app.extend()` 聚合结果与依赖图摘要固化为稳定消费层；
- `vext doctor routes` 面向静态路由治理，当前 `doctor all` 仍等价于 `routes`；
- `routes.json` 是诊断 / inspect 产物，`routes.manifest.json` 是给编辑器、CI、可视化等下游工具消费的稳定契约层；
- `services.manifest.json` 当前聚焦 service 索引、`app.extend()` 聚合信息与服务依赖图；routes 与 services 仍保持分层产物，避免过早合并成单一总 manifest。

---

## 📁 项目结构

```
my-app/
├── src/
│   ├── config/
│   │   ├── default.js        # 默认配置
│   │   ├── production.js     # 生产环境覆盖（可选）
│   │   └── local.js          # 本地覆盖，不提交到 Git（可选）
│   ├── routes/               # 路由目录（自动扫描）
│   │   ├── index.js          # → /
│   │   ├── users.js          # → /users
│   │   └── api/
│   │       └── posts.js      # → /api/posts
│   ├── services/             # 服务层（自动注入到 app.services）
│   │   ├── user.js           # → app.services.user
│   │   └── payment/
│   │       └── stripe.js     # → app.services.payment.stripe
│   ├── middlewares/           # 自定义路由级中间件
│   ├── plugins/              # 插件（拓扑排序加载）
│   ├── locales/              # i18n 语言包（可选）
│   │   ├── zh-CN.json
│   │   └── en.json
│   └── ...
├── package.json
└── tsconfig.json             # TypeScript 项目（可选）
```

---

## 🛣️ 路由

路由使用 `defineRoutes` 定义，支持**三段式** `(path, options, handler)` 和**两段式** `(path, handler)` 语法。

### 基础路由

```js
// src/routes/users.js
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  // 三段式：path, options, handler
  app.get(
    "/list",
    {
      docs: { summary: "获取用户列表" },
      validate: {
        query: { page: "number:1-", limit: "number:1-100" },
      },
    },
    async (req, res) => {
      const { page, limit } = req.valid("query");
      const users = await app.services.user.findAll({ page, limit });
      res.json(users);
    },
  );

  // 两段式：path, handler（无 options）
  app.get("/:id", async (req, res) => {
    const user = await app.services.user.findById(req.params.id);
    res.json(user);
  });

  app.post(
    "/",
    {
      validate: {
        body: { name: "string:1-50", email: "email" },
      },
    },
    async (req, res) => {
      const user = await app.services.user.create(req.valid("body"));
      res.json(user, 201);
    },
  );

  app.delete("/:id", {}, async (req, res) => {
    await app.services.user.delete(req.params.id);
    res.json({ deleted: true });
  });
});
```

### 路由映射规则

| 文件路径                      | 路由前缀         |
| ----------------------------- | ---------------- |
| `src/routes/index.js`         | `/`              |
| `src/routes/users.js`         | `/users`         |
| `src/routes/api/posts.js`     | `/api/posts`     |
| `src/routes/api/v2/orders.js` | `/api/v2/orders` |

### 路由选项

```js
app.get(
  "/protected",
  {
    // 路由级中间件引用（需在 config.middlewares 白名单中声明）
    middlewares: ["auth", { name: "rbac", options: { roles: ["admin"] } }],

    // 参数校验（schema-dsl 语法）
    validate: {
      query: { page: "number", limit: "number" },
      param: { id: "string" },
      body: { name: "string:1-100", email: "email" },
    },

    // OpenAPI 文档元信息
    docs: {
      summary: "获取受保护资源",
      description: "需要认证和管理员角色",
      tags: ["Admin"],
    },
  },
  handler,
);
```

---

## 🔧 服务层

服务文件放在 `src/services/` 下，导出一个 class，框架自动实例化并注入到 `app.services`。

```js
// src/services/user.js
export default class UserService {
  constructor(app) {
    this.app = app;
    this.logger = app.logger;
  }

  async findAll({ page = 1, limit = 20 }) {
    this.logger.info(`Fetching users page=${page} limit=${limit}`);
    // 数据库查询...
    return { users: [], total: 0 };
  }

  async findById(id) {
    // ...
  }

  async create(data) {
    // ...
  }
}
```

```js
// 在路由中使用
app.get("/users", {}, async (req, res) => {
  const result = await app.services.user.findAll({ page: 1 });
  res.json(result);
});
```

### 嵌套服务

```
services/
├── user.js              → app.services.user
├── user-profile.js      → app.services.userProfile
└── payment/
    ├── stripe.js         → app.services.payment.stripe
    └── alipay.js         → app.services.payment.alipay
```

- 文件名 `kebab-case` 自动转换为 `camelCase`
- 以 `_` 开头的文件/目录会被跳过
- 框架自动检测服务之间的循环依赖

---

## 🧩 插件

插件用于扩展框架能力，支持依赖声明和拓扑排序加载。

```js
// src/plugins/redis.js
import { definePlugin } from "vextjs";
import Redis from "ioredis";

export default definePlugin({
  name: "redis",

  // 声明依赖（可选），框架自动按拓扑顺序加载
  // dependencies: ['database'],

  async setup(app) {
    const redis = new Redis(app.config.redis);

    // 扩展 app 对象
    app.extend("cache", redis);

    // 注册全局中间件
    app.use(async (req, res, next) => {
      req.cache = app.cache;
      await next();
    });

    // 注册关闭钩子（优雅关闭时执行）
    app.onClose(async () => {
      await redis.quit();
      app.logger.info("Redis disconnected");
    });
  },
});
```

```js
// 在路由/服务中使用插件扩展的能力
const cached = await app.cache.get("user:123");
```

---

## 🛡️ 中间件

### 内置中间件

VextJS 内置以下中间件，全部开箱即用，无需手动注册：

| 中间件          | 功能                                   | 配置字段            |
| --------------- | -------------------------------------- | ------------------- |
| requestId       | 为每个请求生成唯一 ID                  | `config.requestId`  |
| cors            | 跨域资源共享                           | `config.cors`       |
| bodyParser      | 请求体解析（JSON / URLEncoded）        | `config.bodyParser` |
| rateLimit       | 速率限制                               | `config.rateLimit`  |
| responseWrapper | 统一响应格式 `{ code, data, message }` | `config.response`   |
| accessLog       | 请求访问日志                           | `config.accessLog`  |
| errorHandler    | 全局错误处理 + 404 兜底                | —                   |

### 自定义中间件

```js
// src/middlewares/auth.js
import { defineMiddleware } from "vextjs";

export default defineMiddleware(async (req, res, next) => {
  const token = req.headers["authorization"];
  if (!token) {
    req.app.throw(401, "Unauthorized");
  }
  // 解析 token，设置用户信息...
  await next();
});
```

### 工厂中间件（带配置参数）

```js
// src/middlewares/rbac.js
import { defineMiddlewareFactory } from "vextjs";

export default defineMiddlewareFactory((options) => {
  return async (req, res, next) => {
    if (!options.roles.includes(req.user?.role)) {
      req.app.throw(403, "Forbidden");
    }
    await next();
  };
});
```

```js
// 在路由中使用（需在 config.middlewares 白名单声明）
app.get(
  "/admin",
  {
    middlewares: [{ name: "rbac", options: { roles: ["admin"] } }],
  },
  handler,
);
```

---

## ⚙️ 配置

配置文件支持分层合并：框架内置默认值 → `default` → `{NODE_ENV}` → `local` → `bootstrap provider patch` → CLI override。

```js
// src/config/default.js — 默认配置
export default {
  port: 3000,
  host: "0.0.0.0",
  logger: {
    level: "info", // 'debug' | 'info' | 'warn' | 'error' | 'silent'
  },
  cors: {
    origins: ["*"], // 允许的来源列表（数组格式）
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  },
  bodyParser: {
    maxBodySize: "1mb",
  },
  rateLimit: {
    max: 100, // 每个窗口期最大请求数
    window: 60, // 窗口期时长（秒，数字）
  },
  requestId: {
    enabled: true,
    header: "X-Request-Id",
  },
  response: {
    hideInternalErrors: true, // 生产环境隐藏内部错误详情
  },
  openapi: {
    enabled: true,
    title: "My API",
    version: "1.0.0",
  },
  shutdown: {
    timeout: 10, // 优雅关闭超时（秒）
  },
};
```

```js
// src/config/production.js — 生产环境覆盖
export default {
  logger: { level: "warn" },
  response: { hideInternalErrors: true },
};
```

```js
// src/config/local.js — 本地开发覆盖（加入 .gitignore）
export default {
  port: 4000,
  logger: { level: "debug" },
};
```

除了 `development` / `production` / `test` 之外，Vext 也支持任意环境名，例如：

```text
src/config/sg-sit.js
src/config/us-uat.js
src/config/us-prod.js
```

启动时只要设置对应的 `NODE_ENV`，Vext 就会自动加载匹配文件：

```bash
NODE_ENV=sg-sit vext start
```

如果你希望在 `package.json` scripts 中跨平台设置环境变量，推荐安装 `cross-env`：

```bash
npm i -D cross-env
```

```json
{
  "scripts": {
    "start:sg-sit": "cross-env NODE_ENV=sg-sit vext start",
    "start:us-uat": "cross-env NODE_ENV=us-uat vext start"
  }
}
```

CLI 参数 `--port` / `--host` 优先级最高，覆盖配置文件和 `bootstrap provider patch` 中的值。

---

## ✅ 参数校验

路由选项中的 `validate` 字段使用 [schema-dsl](https://www.npmjs.com/package/schema-dsl) 语法，声明式校验请求参数。

```js
app.post(
  "/users",
  {
    validate: {
      body: {
        name: "string:1-50", // 字符串，长度 1-50
        email: "email", // 邮箱格式
        age: "number:0-150?", // 可选数字，范围 0-150
        role: "enum:admin,user,guest", // 枚举值
        tags: "[string]", // 字符串数组
      },
      query: {
        format: "enum:json,xml?", // 可选枚举
      },
    },
  },
  async (req, res) => {
    const body = req.valid("body"); // 类型安全的校验后数据
    const query = req.valid("query");
    // ...
  },
);
```

校验失败时自动返回 `400` 错误，包含详细的字段错误信息。支持 i18n 多语言错误消息。

---

## ⚡ 路由缓存

路由选项中的 `cache` 字段提供声明式响应缓存，支持数字简写或完整配置对象。

```js
// 数字简写：缓存 60 秒
app.get("/products", { cache: 60 }, async (req, res) => {
  res.json(await db.getProducts());
});

// 完整配置：TTL + Vary headers + 标签失效
app.get(
  "/products",
  {
    cache: {
      ttl: 120,
      vary: ["accept-language"], // 不同语言单独缓存
      tags: ["products"], // 标签（用于批量失效）
      condition: (req) => !req.query.refresh, // 条件缓存
    },
  },
  async (req, res) => {
    res.json(await db.getProducts());
  },
);
```

缓存命中时自动设置 `X-Cache: HIT` 和 `Cache-Control: public, max-age=N` 响应头。

### 运行时 API

```js
// 按标签批量失效
await app.cache.invalidate("products");

// 清空所有缓存
await app.cache.clear();

// 查看缓存统计
const stats = app.cache.stats();
// → { entries: 42, hits: 128, misses: 31, hitRate: 0.805 }
```

### 全局配置

```js
// src/config/default.js
export default {
  cache: {
    enabled: true, // 是否启用（默认 true）
    defaultTtl: 60, // 默认 TTL 秒数
    maxEntries: 1000, // 最大缓存条目数
  },
};
```

---

## 📖 OpenAPI 文档

启用 `openapi.enabled: true` 后，框架自动从路由元信息生成 OpenAPI 3.0.3 文档，并提供交互式文档页面。

### 文档端点

| 端点                | 说明                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `GET /openapi.json` | OpenAPI JSON spec（供外部工具消费）                                                              |
| `GET /docs`         | [Scalar API Reference](https://github.com/scalar/scalar) 交互式文档页面（文档阅读 + Try it out） |

```bash
# 获取 OpenAPI JSON
curl http://localhost:3000/openapi.json

# 浏览器打开交互式文档
open http://localhost:3000/docs
```

### Scalar 配置

```js
// src/config/default.js
export default {
  openapi: {
    enabled: true,
    title: "My API",
    version: "1.0.0",
    // Scalar API Reference 配置
    scalar: {
      theme: "default", // 主题: default / alternate / moon / purple / solarized / ...
      darkMode: false, // 深色模式
      layout: "modern", // 布局: modern / classic
      showSidebar: true, // 显示侧边栏
    },
  },
};
```

### 路由文档元信息

路由的 `docs` 选项用于补充文档元信息：

```js
app.get(
  "/users/:id",
  {
    docs: {
      summary: "获取用户详情",
      description: "根据用户 ID 获取完整的用户信息",
      tags: ["Users"],
    },
    validate: {
      params: { id: "string" },
    },
  },
  handler,
);
```

---

## 🧪 测试

VextJS 提供内置测试工具，无需启动 HTTP 服务器即可测试路由。

```js
import { describe, it, expect } from "vitest";
import { createTestApp } from "vextjs/testing";

describe("User API", () => {
  it("should return user list", async () => {
    const app = await createTestApp({
      rootDir: "/path/to/project",
    });

    const res = await app.request.get("/users/list?page=1&limit=10");

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data).toBeDefined();
  });
});
```

---

## 🌐 i18n 国际化

在 `src/locales/` 下放置语言文件，框架自动加载并注册到 schema-dsl 校验器。

```jsonc
// src/locales/zh-CN.json
{
  "validation.required": "{field} 不能为空",
  "validation.string.min": "{field} 长度不能少于 {min} 个字符",
  "validation.email": "{field} 格式不正确"
}
```

```jsonc
// src/locales/en.json
{
  "validation.required": "{field} is required",
  "validation.string.min": "{field} must be at least {min} characters",
  "validation.email": "{field} is not a valid email"
}
```

---

## 🏛️ 架构概览

```
用户请求
  │
  ▼
┌──────────────────────────────────────────────┐
│               VextJS Framework               │
│                                              │
│  ┌─── 内置中间件链 ───────────────────────┐  │
│  │ requestId → cors → bodyParser →        │  │
│  │ rateLimit → responseWrapper → accessLog│  │
│  └────────────────────────────────────────┘  │
│                    │                         │
│                    ▼                         │
│  ┌─── 路由级中间件 ──┐                       │
│  │ auth → rbac → ... │                       │
│  └───────────────────┘                       │
│                    │                         │
│                    ▼                         │
│  ┌─── 参数校验 ──────┐                       │
│  │ validate(schema)  │                       │
│  └───────────────────┘                       │
│                    │                         │
│                    ▼                         │
│  ┌─── 路由 Handler ──┐  ┌── Services ──┐    │
│  │  app.get/post/... │─→│ app.services │    │
│  └───────────────────┘  └──────────────┘    │
│                    │                         │
│                    ▼                         │
│  ┌─── Adapter Layer ─────────────────────┐   │
│  │  Native (默认) / Fastify / Hono /     │   │
│  │  Express / Koa  — 可替换              │   │
│  └───────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
  │
  ▼
HTTP 响应 → { code: 0, data: {...} }
```

### 启动流程

1. **配置加载** — 内置默认值 → `default` → `{env}` → `local` → `bootstrap provider patch` → CLI override + 冻结
2. **创建 App** — 初始化 logger、validator、adapter、throw
3. **i18n 加载** — 自动扫描 `src/locales/`
4. **插件加载** — 拓扑排序 + 依次 `setup()`
5. **中间件加载** — 按 `config.middlewares` 白名单加载
6. **服务加载** — 扫描 `src/services/`，实例化注入 `app.services`
7. **路由加载** — 扫描 `src/routes/`，注册到 adapter
8. **内置中间件注册** — requestId → cors → bodyParser → rateLimit → responseWrapper → accessLog → errorHandler
9. **HTTP 监听** — `adapter.listen(port, host)`
10. **就绪钩子** — 执行 `onReady` 回调

---

## 📋 环境变量

| 变量                   | 说明                                                 | 默认值                                      |
| ---------------------- | ---------------------------------------------------- | ------------------------------------------- |
| `NODE_ENV`             | 运行时环境名；用于匹配 `src/config/{NODE_ENV}.ts`    | `production`（start 默认）/ `development`（dev 默认） |
| `VEXT_PORT`            | 覆盖监听端口                                         | —                                           |
| `VEXT_HOST`            | 覆盖监听地址                                         | —                                           |
| `VEXT_PORT_CONFLICT`   | 端口冲突策略（`error` / `prompt` / `kill` / `next`） | `error`                                     |
| `VEXT_LIFECYCLE_LEVEL` | 生命周期日志级别（`concise` / `verbose`）            | `concise`                                   |
| `VEXT_DEV_POLL`        | 强制轮询模式（`1` / `0`）                            | 自动检测                                    |
| `VEXT_DEV_NO_HOT`      | 禁用 Soft Reload                                     | —                                           |
| `VEXT_DEV_DEBOUNCE`    | 防抖间隔（毫秒）                                     | `0`（不开启）                               |

> 如果项目需要在 `package.json` scripts 中跨平台设置 `NODE_ENV`，推荐使用 `cross-env`；Vext 本身不内置该工具。

---

## 🗺️ 路线图

- [x] Adapter 架构（Native 默认 + Hono / Fastify / Express / Koa 可选）
- [x] Native Adapter（零外部依赖，`http.createServer` + `find-my-way` radix trie）
- [x] 约定式路由 + 三段式语法
- [x] 插件系统（拓扑排序 + 生命周期）
- [x] 服务自动注入
- [x] 内置中间件（requestId / CORS / bodyParser / rateLimit / accessLog）
- [x] 参数校验（schema-dsl 集成）
- [x] OpenAPI 3.0.3 文档生成
- [x] CLI（start / dev / build / stop / reload / status / typegen / doctor）
- [x] 开发模式热重载（Soft Reload + Cold Restart）
- [x] 测试工具（createTestApp）
- [x] Cluster 多进程（Master/Worker + Rolling Restart）
- [x] 性能基准测试（autocannon 自动化 + 多轮取中位数）
- [x] AsyncLocalStorage 可配置跳过
- [x] Native Adapter 性能优化（Overhead 降至 ~18%，领先 Fastify 26~51%）
- [x] `vext create` 项目脚手架
- [x] 文档站（rspress）
- [x] 路由级响应缓存（LRU 内存存储，标签失效，Vary headers）
- [ ] SSE 支持
- [ ] WebSocket 支持

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request。

```bash
# 克隆项目
git clone https://github.com/vextjs/vext.git
cd vext

# 安装依赖
npm install

# 开发（TypeScript 监听编译）
npm run dev

# 运行测试
npm test

# 类型检查
npm run typecheck

# 构建
npm run build
```

---

## 📄 许可证

[MIT](./LICENSE) © 2025 [vextjs](https://github.com/vextjs)
