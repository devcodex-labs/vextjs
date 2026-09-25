# Hello World

## 可执行 2.x 权威示例

先运行下面的仓库最小示例，确认服务、HTTP 与文档入口，再按需要阅读 TypeScript 扩展示例。两部分属于不同项目，不要把两套文件混放。

本页的发布合同是仓库中的
[`examples/hello-world`](https://github.com/devcodex-labs/vextjs/tree/main/examples/hello-world)
项目。它是刻意保持最小的 JavaScript 应用：使用 `checkJs` 类型检查、Native adapter、显式 `rateLimit.enabled: false`、Vext Docs，并且只有 `GET /` 与 `GET /health` 两个路由。

先在克隆的仓库根完成 `npm ci` 和 `npm run build`，再执行（以下是仓库贡献者路径；只想新建应用可直接看后面的脚手架路径）：

```bash
cd examples/hello-world
npm install
npm run typecheck
npm run build
npm test
npm start
```

启动后验证 `/` 返回 `data.message: "hello world"`，`/health` 返回 `data.status: "ok"`，`/openapi.json` 包含这两个业务路由，`/docs` 展示 Vext Docs；未知路径返回404。结束后停止服务。示例中的 `"vextjs": "file:../.."` 只用于本仓库；脚手架项目与普通用户项目安装发布后的 `vextjs` 包。

仓库示例源码决定其文件与 endpoint；这里的验证命令由读者执行，不表示当前本地已经完成安装、测试或发布。

## 扩展 TypeScript 教学变体

下方 walkthrough 是单独的教学变体，用于展示更多校验和响应 API；它不是可执行发布 fixture，也不能据此推断 `examples/hello-world` 目录中存在这些额外路由。

## 完整项目结构

```
hello-world/
  ├── src/
  │   ├── config/
  │   │   └── default.ts
  │   └── routes/
  │       └── index.ts
  ├── package.json
  └── tsconfig.json
```

## 1. 初始化项目

使用 `vext create` 脚手架快速创建：

```bash
npx vextjs create hello-world --template api --skip-install
cd hello-world
pnpm install
```

或手动创建：

```bash
mkdir hello-world && cd hello-world
pnpm init
pnpm add vextjs
pnpm add -D typescript @types/node
```

## 2. 配置文件

### package.json

```json
{
  "name": "hello-world",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vext dev",
    "typecheck": "tsc --noEmit",
    "build": "vext build",
    "start": "vext start"
  },
  "dependencies": {
    "vextjs": "latest"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/node": "^22.0.0"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src"]
}
```

## 3. 配置

```typescript
// src/config/default.ts
export default {
  port: 3000,
  adapter: "native",
  rateLimit: { enabled: false },
  openapi: { enabled: true },
  logger: {
    level: "debug",
    pretty: true,
  },
  cors: {
    enabled: true,
    origins: ["*"],
  },
};
```

:::tip
`adapter: 'native'` 使用内置的 Native Adapter（基于 `http.createServer` + `route-core`），不依赖第三方 HTTP 框架。也可以切换为 `'hono'`、`'fastify'`、`'express'` 或 `'koa'`，需先安装对应 optional peer；使用 Vext 公共 API 的路由可保留，适配器差异见[适配器](../guide/adapters)，历史结果与测试口径见[性能基准](../benchmark)。
:::

## 4. 路由

```typescript
// src/routes/index.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  // GET / → 问候接口
  app.get(
    "/",
    {
      docs: {
        summary: "问候接口",
      },
    },
    async (_req, res) => {
      res.json({ message: "Hello VextJS! 🚀" });
    },
  );

  // GET /health → 健康检查
  app.get("/health", async (_req, res) => {
    res.json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // GET /echo → 回显查询参数
  app.get(
    "/echo",
    {
      validate: {
        query: {
          message: "string?",
        },
      },
      docs: {
        summary: "回显接口",
        description: "将查询参数中的 message 原样返回",
      },
    },
    async (req, res) => {
      const { message } = req.valid("query");
      res.json({
        echo: message ?? "no message provided",
        method: req.method,
        path: req.path,
        requestId: req.requestId,
        ip: req.ip,
      });
    },
  );

  // POST /greet → 带参数校验的问候
  app.post(
    "/greet",
    {
      validate: {
        body: {
          name: "string:1-50!",
          language: "enum:zh,en,ja?",
        },
      },
      docs: {
        summary: "个性化问候",
        description: "根据姓名和语言返回问候语",
        responses: {
          200: {
            description: "问候成功",
            example: {
              greeting: "你好, Alice!",
              language: "zh",
            },
          },
        },
      },
    },
    async (req, res) => {
      const { name, language = "zh" } = req.valid("body");

      const greetings: Record<string, string> = {
        zh: `你好, ${name}!`,
        en: `Hello, ${name}!`,
        ja: `こんにちは, ${name}!`,
      };

      res.json({
        greeting: greetings[language],
        language,
      });
    },
  );
});
```

## 5. 启动入口

本例使用 package.json 中的 `vext dev/build/start`，由 CLI 管理启动入口，不需要另建 `src/index.ts` 或再次调用 `bootstrap()`。需要程序化管理启动/关闭时，见 [App 生命周期](../api/app)，不要混用两种启动方式。

## 6. 运行

### 开发模式

```bash
pnpm dev
```

开发模式特性：

- 文件修改触发重载；路由/服务与配置变更采用不同策略，见[开发模式](../guide/hot-reload)
- 美化日志输出（内置 pretty 格式）
- 本例已显式启用 OpenAPI 文档（访问 `http://localhost:3000/docs`）

### 生产模式

```bash
pnpm typecheck
pnpm build
pnpm start
```

## 7. 验证

启动后可使用 `curl` 或浏览器验证：

```bash
# 问候接口
curl http://localhost:3000/
# → {"code":0,"data":{"message":"Hello VextJS! 🚀"},"requestId":"..."}

# 健康检查
curl http://localhost:3000/health
# → {"code":0,"data":{"status":"ok","uptime":12.34,"timestamp":"..."},"requestId":"..."}

# 回显接口
curl "http://localhost:3000/echo?message=hello"
# → {"code":0,"data":{"echo":"hello","method":"GET","path":"/echo",...},"requestId":"..."}

# 个性化问候
curl -X POST http://localhost:3000/greet \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","language":"en"}'
# → {"code":0,"data":{"greeting":"Hello, Alice!","language":"en"},"requestId":"..."}

# 参数校验测试（name 为空触发 422）
curl -X POST http://localhost:3000/greet \
  -H "Content-Type: application/json" \
  -d '{"name":""}'
# → 422 {"code":422,"message":"Validation failed","errors":[...],"requestId":"..."}
```

## 8. 响应格式说明

VextJS 默认启用**出口包装**（`config.response.wrap: true`），本例的 JSON 成功响应会包装为统一格式；特殊无 body 状态、显式不包装和错误出口的边界见[请求与响应](../api/context)：

**成功响应**：

```json
{
  "code": 0,
  "data": { "message": "Hello VextJS! 🚀" },
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**错误响应**：

```json
{
  "code": 422,
  "message": "Validation failed",
  "errors": [{ "field": "name", "message": "length must be between 1 and 50" }],
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

错误字段的具体消息可能随校验器语言而变化，应先检查 HTTP 状态、业务 code 和 errors 结构。缺少必填 name 同样应返回422，不能只测试空字符串。

如果不需要包装（如微服务间通信），可把下面字段合并到现有配置中禁用：

```typescript
// src/config/default.ts
export default {
  response: {
    wrap: false,
  },
};
```

## 关键概念回顾

| 概念           | 说明                                          |
| -------------- | --------------------------------------------- |
| `defineRoutes` | 路由定义函数，在回调中注册路由                |
| `bootstrap`    | 框架启动函数，编排完整的初始化流程            |
| `validate`     | 声明式参数校验（schema-dsl DSL 语法）         |
| `req.valid()`  | 获取校验并类型转换后的数据                    |
| `res.json()`   | 返回 JSON 响应（自动出口包装）                |
| `docs`         | OpenAPI 文档配置，自动生成 Vext Docs API 文档 |
| 出口包装       | 统一响应格式 `{ code, data, requestId }`      |

## 下一步

- 阅读 [快速开始](../guide/quick-start) 了解更完整的项目搭建流程
- 阅读 [CRUD API 示例](./crud-api) 了解数据库集成
- 阅读 [项目结构](../guide/project-structure) 了解约定式目录规范
- 阅读 [路由](../guide/routing) 深入了解三段式路由定义
