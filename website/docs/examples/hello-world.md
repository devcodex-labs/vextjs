# Hello World

最简单的 VextJS 项目，帮助你理解框架的基本结构和工作方式。

## 完整项目结构

```
hello-world/
  ├── src/
  │   ├── config/
  │   │   └── default.ts
  │   ├── routes/
  │   │   └── index.ts
  │   └── index.ts
  ├── package.json
  └── tsconfig.json
```

## 1. 初始化项目

使用 `vext create` 脚手架快速创建：

```bash
npx vextjs create hello-world
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
    "module": "ESNext",
    "moduleResolution": "bundler",
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
`adapter: 'native'` 使用内置的 Native Adapter（基于 `http.createServer` + `route-core`），零外部 HTTP 框架依赖，性能最高。也可以切换为 `'hono'`、`'fastify'`、`'express'` 或 `'koa'`，**业务代码无需任何改动**。
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
        tags: ["基础"],
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
          name: "string:1-50",
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

## 5. 入口文件

```typescript
// src/index.ts
import { bootstrap } from "vextjs";

bootstrap().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
```

## 6. 运行

### 开发模式

```bash
pnpm dev
```

开发模式特性：

- 文件修改自动热重载（三层策略：路由/服务/配置智能刷新）
- 美化日志输出（彩色格式）
- 自动启用 OpenAPI 文档（访问 `http://localhost:3000/docs`）

### 生产模式

```bash
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

VextJS 默认启用**出口包装**（`config.response.wrap: true`），所有 `res.json()` 的响应会自动包装为统一格式：

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

如果不需要包装（如微服务间通信），可在配置中禁用：

```typescript
// src/config/default.ts
export default {
  response: {
    wrap: false,
  },
};
```

## 关键概念回顾

| 概念           | 说明                                       |
| -------------- | ------------------------------------------ |
| `defineRoutes` | 路由定义函数，在回调中注册路由             |
| `bootstrap`    | 框架启动函数，编排完整的初始化流程         |
| `validate`     | 声明式参数校验（schema-dsl DSL 语法）      |
| `req.valid()`  | 获取校验并类型转换后的数据                 |
| `res.json()`   | 返回 JSON 响应（自动出口包装）             |
| `docs`         | OpenAPI 文档配置，自动生成 Scalar API 文档 |
| 出口包装       | 统一响应格式 `{ code, data, requestId }`   |

## 下一步

- 📖 阅读 [快速开始](/guide/quick-start) 了解更完整的项目搭建流程
- 📖 阅读 [CRUD API 示例](/examples/crud-api) 了解数据库集成
- 📖 阅读 [项目结构](/guide/project-structure) 了解约定式目录规范
- 📖 阅读 [路由](/guide/routing) 深入了解三段式路由定义
