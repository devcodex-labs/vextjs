# 快速开始

## 方式一：使用脚手架（推荐）

VextJS 提供了 `vext create` 命令，可以快速创建项目骨架：

```bash
# 创建 TypeScript 项目（默认 Native Adapter）
npx vextjs create my-app

# 创建并指定 Adapter
npx vextjs create my-app --adapter hono

# 创建 JavaScript 项目
npx vextjs create my-app --js

# 跳过 npm install
npx vextjs create my-app --skip-install
```

创建完成后：

```bash
cd my-app
npm run dev
```

访问 `http://localhost:3000`，你应该能看到 `{ "code": 0, "data": { "message": "hello world" }, "requestId": "..." }` 的 JSON 响应。

## 方式二：手动创建

### 1. 初始化项目

```bash
mkdir my-app && cd my-app
npm init -y
npm install vextjs
```

### 2. 配置 `package.json`

```json
{
  "name": "my-app",
  "type": "module",
  "scripts": {
    "start": "vext start",
    "dev": "vext dev",
    "build": "vext build"
  },
  "dependencies": {
    "vextjs": "^0.3.3"
  }
}
```

:::tip
VextJS 要求 `"type": "module"`，项目使用 ESM 模块格式。
:::

### 3. 创建目录结构

```bash
mkdir -p src/config src/routes src/services
```

### 4. 编写配置

```typescript
// src/config/default.ts
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

如需使用其他 Adapter（如 Hono），先安装对应包再配置：

```bash
npm install hono @hono/node-server
```

```typescript
// src/config/default.ts
import { honoAdapter } from "vextjs/adapters/hono";

export default {
  adapter: honoAdapter(),
  port: 3000,
};
```

### 4.1 可选：添加 `src/config/bootstrap.ts`

如果某些配置必须在启动期从远端读取，并且要在 `config` 冻结前参与合并，可以新增 `src/config/bootstrap.ts`：

```typescript
import { defineBootstrapConfig } from "vextjs";

export default defineBootstrapConfig({
  providers: [
    {
      name: "remote-config",
      async load({ env, signal }) {
        const response = await fetch(`https://config.example.com/${env}.json`, {
          signal,
        });
        return await response.json();
      },
    },
  ],
});
```

适合：数据库、Nacos 启动期配置、密钥 patch。  
不适合：APM / OpenTelemetry 这类需要更早执行的 `preload` 场景。

### 5. 编写路由

```typescript
// src/routes/index.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  // GET /
  app.get(
    "/",
    {
      docs: { summary: "首页" },
    },
    async (_req, res) => {
      res.json({ message: "Hello VextJS!" });
    },
  );

  // GET /health
  app.get(
    "/health",
    {
      docs: { summary: "健康检查" },
    },
    async (_req, res) => {
      res.json({
        status: "ok",
        uptime: process.uptime(),
      });
    },
  );
});
```

### 6. 编写服务（可选）

```typescript
// src/services/example.ts
export default class ExampleService {
  async getGreeting(name: string) {
    return { message: `Hello, ${name}!` };
  }
}
```

在路由中使用服务：

```typescript
// src/routes/greet.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/greet/:name",
    {
      validate: {
        param: { name: "string!" },
      },
      docs: { summary: "问候接口" },
    },
    async (req, res) => {
      const { name } = req.valid("param");
      const result = await app.services.example.getGreeting(name);
      res.json(result);
    },
  );
});
```

### 7. 启动

```bash
# 开发模式（热重载）
npm run dev

# 生产模式
npm run build
npm start
```

## 项目结构

脚手架或手动创建后，你的项目结构应该如下：

```
my-app/
├── src/
│   ├── config/
│   │   ├── default.ts        # 默认配置
│   │   ├── bootstrap.ts      # 启动期远程配置 provider（可选）
│   │   ├── development.ts    # 开发环境覆盖（可选）
│   │   └── production.ts     # 生产环境覆盖（可选）
│   ├── routes/
│   │   └── index.ts          # 路由定义
│   └── services/
│       └── example.ts        # 服务层
├── package.json
└── tsconfig.json              # TypeScript 配置（TS 项目）
```

:::info 约定
VextJS 会自动扫描 `src/routes/`、`src/services/`、`src/config/` 目录，无需手动注册。路由文件名会映射为 URL 前缀：

| 文件路径                       | URL 前缀          |
| ------------------------------ | ----------------- |
| `src/routes/index.ts`          | `/`               |
| `src/routes/users.ts`          | `/users`          |
| `src/routes/admin/index.ts`    | `/admin`          |
| `src/routes/admin/settings.ts` | `/admin/settings` |

:::

`src/config/bootstrap.ts` 同样是约定路径：存在时会在 `default/env/local` 合并后、CLI override 前执行，并将 provider 返回的 patch 纳入最终配置链路。

## 访问 OpenAPI 文档

配置中开启 `openapi.enabled: true` 后，启动项目即可访问：

- **Scalar 文档**: `http://localhost:3000/docs`
- **OpenAPI JSON**: `http://localhost:3000/openapi.json`

## CLI 命令速览

| 命令                 | 说明                                |
| -------------------- | ----------------------------------- |
| `vext dev`           | 开发模式，文件监听 + 热重载         |
| `vext start`         | 生产模式启动                        |
| `vext build`         | 构建项目（TypeScript → JavaScript） |
| `vext create <name>` | 创建新项目                          |
| `vext stop`          | 停止 Cluster 进程                   |
| `vext reload`        | 滚动重启 Worker                     |
| `vext status`        | 查看 Cluster 运行状态               |

## 开发模式热重载

`vext dev` 提供三层热重载策略，自动选择最优方式：

| 层级                    | 触发条件             | 行为                       | 速度      |
| ----------------------- | -------------------- | -------------------------- | --------- |
| **Tier 1** — 路由热替换 | 路由文件变更         | 原子替换请求处理器，零中断 | ⚡ 毫秒级 |
| **Tier 2** — 服务重载   | 服务 / i18n 文件变更 | 重建受影响的服务实例       | ⚡ 毫秒级 |
| **Tier 3** — 冷重启     | 配置 / 插件变更      | 完整重启进程               | 🔄 秒级   |

## 下一步

- 了解 [项目结构](/guide/project-structure) 约定
- 学习 [路由](/guide/routing) 的三段式定义
- 探索 [中间件](/guide/middleware) 和 [插件](/guide/plugins)
- 查看 [配置](/guide/configuration) 选项
