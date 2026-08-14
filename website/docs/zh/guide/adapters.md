# Adapter 架构

VextJS 使用 **Adapter 架构**替换底层 HTTP 处理层。基于 VextJS `req` / `res` 编写的路由与服务通常可以保持原有接口；底层框架专属的中间件、插件和能力仍需核对适配边界。选择 Adapter 本身只需修改配置字段。

## 工作原理

```
用户代码（路由 / 中间件 / 服务）
        ↕  VextRequest / VextResponse（框架统一接口）
    Adapter 层（适配器）
        ↕  底层框架原生对象
  HTTP Server（Node.js）
```

Adapter 负责：

1. **启动 HTTP 服务** — 使用底层框架创建服务器并监听端口
2. **请求转换** — 将底层框架的原生请求对象转换为 `VextRequest`
3. **响应转换** — 将 `VextResponse` 的操作映射到底层框架的响应对象
4. **路由注册** — 将框架收集到的路由注册到底层路由系统
5. **中间件注册** — 将全局中间件注册到底层框架

## 内置 Adapter

VextJS 内置 5 种 Adapter，覆盖主流 Node.js HTTP 框架：

| Adapter            | 底层框架                           | 特点                             | 适用场景               | 额外依赖  |
| ------------------ | ---------------------------------- | -------------------------------- | ---------------------- | --------- |
| **Native**（默认） | `http.createServer` + `route-core` | 零第三方 HTTP 框架依赖，默认路径 | 新项目、希望减少依赖   | 无        |
| **Hono**           | Hono                               | Web Standards API，轻量          | Node.js 全栈 HTTP 服务 | `hono`    |
| **Fastify**        | Fastify                            | 插件生态、JSON 序列化能力        | 需要 Fastify 能力      | `fastify` |
| **Express**        | Express v5                         | 成熟的中间件生态                 | 从 Express 迁移        | `express` |
| **Koa**            | Koa v3                             | 轻量中间件模型                   | 团队已有 Koa 经验      | `koa`     |

### 性能对比

本页不保存独立数字快照，避免旧环境与当前结果形成两套口径。Raw Native 与 Raw Fastify 的领先项会随场景和 handler 形态变化；五个 adapter 的百分比也只表示 Vext 相对各自 Raw 基线的组合开销，不是框架总排名。

请在[性能基准](/benchmark)查看唯一的当前结果、测试方法、限制和复现命令。选择 adapter 后，仍应使用实际中间件、认证、日志和 I/O 负载验证你的目标。

## 使用方法

### Native Adapter（默认）

不需要安装额外依赖，也不需要显式配置——默认即为 Native Adapter：

```typescript
// src/config/default.ts
export default {
  port: 3000,
  // adapter 默认为 'native'，无需指定
};
```

如需显式声明：

```typescript
import { nativeAdapter } from "vextjs/adapters/native";

export default {
  adapter: nativeAdapter(),
  port: 3000,
};
```

Native Adapter 使用 Node.js 原生 `http.createServer` 处理 HTTP，配合 `route-core` 做路由匹配；它是默认路径，且不依赖第三方 HTTP 框架。实际性能取决于场景，请以当前基准和你的业务压测为准。

### Hono Adapter

```bash
npm install hono
```

**推荐方式（字符串标识）：**

```typescript
// src/config/default.ts
export default {
  adapter: "hono",
  port: 3000,
};
```

**高级用法（工厂函数）：**

```typescript
// src/config/default.ts
import { honoAdapter } from "vextjs/adapters/hono";

export default {
  adapter: honoAdapter(),
  port: 3000,
};
```

Hono 是一个超轻量级的 Web 框架，基于 Web Standards API（`Request` / `Response`）。当前内置 Hono Adapter 是 Node.js HTTP server adapter，运行时只依赖 `hono`；用于接入 Hono 路由的 `node:http` 请求/响应桥接由 Vext 自己实现。`@hono/node-server` 不是该 Adapter 的运行时依赖。

这不等同于官方 Edge / Serverless Adapter 支持。Cloudflare Workers、Deno Deploy、Bun edge 或其他非 Node.js 运行时需要单独的 Edge / Serverless 适配器或生态插件支持，不能直接把当前 `vextjs/adapters/hono` 当作 Edge 运行时保证。

### Fastify Adapter

```bash
npm install fastify
```

**推荐方式（字符串标识）：**

```typescript
// src/config/default.ts
export default {
  adapter: "fastify",
  port: 3000,
};
```

**高级用法（工厂函数，可传入选项）：**

```typescript
// src/config/default.ts
import { fastifyAdapter } from "vextjs/adapters/fastify";

export default {
  adapter: fastifyAdapter(),
  port: 3000,
};
```

Fastify 是高性能的 Node.js Web 框架，拥有丰富的插件生态和内置的 JSON Schema 校验 + 序列化优化。

### Express Adapter

```bash
npm install express
```

**推荐方式（字符串标识）：**

```typescript
// src/config/default.ts
export default {
  adapter: "express",
  port: 3000,
};
```

**高级用法（工厂函数，可传入选项）：**

```typescript
// src/config/default.ts
import { expressAdapter } from "vextjs/adapters/express";

export default {
  adapter: expressAdapter(),
  port: 3000,
};
```

Express 是 Node.js 生态中最成熟的 Web 框架，拥有最大的中间件生态。VextJS 支持 Express v5。适合从现有 Express 项目迁移。

:::tip Express v5
VextJS 的 Express Adapter 基于 Express v5。如果你使用的是 Express v4，需要先升级。v5 相比 v4 主要变化包括：路由处理支持 `async`/`await`、改进的 `req.query` 解析等。
:::

### Koa Adapter

```bash
npm install koa
```

**推荐方式（字符串标识）：**

```typescript
// src/config/default.ts
export default {
  adapter: "koa",
  port: 3000,
};
```

**高级用法（工厂函数，可传入选项）：**

```typescript
// src/config/default.ts
import { koaAdapter } from "vextjs/adapters/koa";

export default {
  adapter: koaAdapter(),
  port: 3000,
};
```

Koa 是 Express 团队打造的下一代 Web 框架，以轻量和优雅著称。VextJS 支持 Koa v3。

## 切换 Adapter

切换 Adapter 只需要修改 `src/config/default.ts` 中的 `adapter` 字段：

```typescript
// 从 Native 切换到 Hono
- // adapter 默认 native
+ import { honoAdapter } from 'vextjs/adapters/hono';

  export default {
+   adapter: honoAdapter(),
    port: 3000,
  };
```

基于 `VextRequest` / `VextResponse` 的路由 handler 和服务代码通常可以直接复用。底层原生中间件、插件或框架专属行为并非完全解耦，切换前应按目标 Adapter 的集成说明复核。

## 如何选择 Adapter

### 选择 Native（默认推荐）

- 希望从框架默认路径开始
- 不需要其他 HTTP 框架的特定能力
- 新项目，没有 adapter 迁移约束
- 希望减少额外依赖

### 选择 Hono

- 需要使用 Hono 生态的中间件或工具
- 希望在 Node.js 服务中复用 Hono 路由能力；未来 Edge / Serverless 部署需等待专门适配器
- 偏好 Web Standards API 风格

### 选择 Fastify

- 需要使用 Fastify 丰富的插件生态
- 大型项目，看重 Fastify 的成熟度和社区支持
- 需要 `fast-json-stringify` 序列化优化

### 选择 Express

- 从现有 Express 项目迁移到 VextJS
- 需要复用大量 Express 中间件
- 团队对 Express 最熟悉

### 选择 Koa

- 偏好 Koa 的轻量设计
- 中小型项目
- 需要使用 Koa 特定的中间件

## VextAdapter 接口

所有 Adapter 实现统一的 `VextAdapter` 接口：

```typescript
import type { IncomingMessage, ServerResponse } from "node:http";

interface VextAdapter {
  /** adapter 名称标识 */
  readonly name: string;

  /** 注册全局中间件 */
  registerMiddleware(middleware: VextMiddleware): void;

  /** 注册路由 */
  registerRoute(
    method: string,
    path: string,
    chain: VextMiddleware[],
    options?: RouteOptions,
  ): void;

  /** 注册错误处理器 */
  registerErrorHandler(handler: VextErrorMiddleware): void;

  /** 注册 404 处理器 */
  registerNotFound(handler: VextMiddleware): void;

  /** 启动监听 */
  listen(
    port: number,
    host?: string,
    options?: VextAdapterListenOptions,
  ): Promise<VextServerHandle>;

  /** 构建 Node.js 请求处理函数，不启动 server */
  buildHandler(): (req: IncomingMessage, res: ServerResponse) => void;
}
```

OpenAPI / Docs 路由由框架通过 `registerRoute()` 注册，Adapter 不再提供单独的 `registerOpenAPIRoutes()`。

### 自定义 Adapter

如果内置的 5 种 Adapter 不能满足需求，你可以实现自定义 Adapter：

```typescript
// src/config/default.ts
import { createServer } from "node:http";
import type { VextAdapter, VextApp } from "vextjs";

function myCustomAdapter(): (app: VextApp) => VextAdapter {
  return (app) => {
    const adapter: VextAdapter = {
      name: "my-custom",

      registerMiddleware(middleware) {
        // 注册全局中间件
      },

      registerRoute(method, path, chain, options) {
        // 注册路由
      },

      registerErrorHandler(handler) {
        // 注册错误处理
      },

      registerNotFound(handler) {
        // 注册 404 处理
      },

      buildHandler() {
        return (req, res) => {
          // 将 Node.js req/res 转换为底层框架请求，并执行中间件链
          res.statusCode = 501;
          res.end("custom adapter bridge not implemented");
        };
      },

      async listen(port, host = "0.0.0.0") {
        const server = createServer(adapter.buildHandler());

        await new Promise<void>((resolve) => {
          server.listen(port, host, resolve);
        });

        const address = server.address();
        const actualPort =
          typeof address === "object" && address ? address.port : port;

        return {
          port: actualPort,
          host,
          close: () =>
            new Promise<void>((resolve, reject) => {
              server.close((error) => {
                if (error) reject(error);
                else resolve();
              });
            }),
        };
      },
    };

    return adapter;
  };
}

export default {
  adapter: myCustomAdapter(),
  port: 3000,
};
```

实现自定义 Adapter 时，核心工作是将 `VextRequest` / `VextResponse` 与底层框架的原生对象进行双向转换，并正确执行中间件链。

## 请求/响应转换

无论使用哪种 Adapter，用户代码始终操作统一的 `VextRequest` 和 `VextResponse` 接口。

### VextRequest（统一请求对象）

```typescript
import type {
  VextApp,
  VextAuthContext,
  VextCookieJar,
  VextSession,
  ParsedFile,
} from "vextjs";

interface VextRequest {
  method: string; // HTTP 方法
  url: string; // 完整 URL
  path: string; // 路径部分
  route: string; // 当前匹配的路由模板，404 时为空字符串
  query: Record<string, string>; // 查询参数
  body: unknown; // 请求体
  params: Record<string, string>; // 路径参数
  headers: Record<string, string | undefined>; // 请求头（小写 key）
  cookies: VextCookieJar; // 已解析 Cookie
  cookie(name: string): string | undefined; // 读取单个 Cookie
  csrfToken(): string; // 当前请求的 CSRF token
  auth: VextAuthContext; // 认证上下文
  requestId: string; // 请求唯一标识
  ip: string; // 客户端 IP
  protocol: "http" | "https"; // 协议
  app: VextApp; // 应用实例
  valid<T>(location: "query" | "body" | "param" | "header" | "cookie"): T;
  onClose(handler: () => void): void; // 连接关闭钩子
  files?: ParsedFile[]; // 已解析上传文件（由 multipart 插件填充）
  session?: VextSession; // Session 启用后可用
  _getRawBody(maxBytes?: number): Promise<string>; // 原始请求体文本
  _getRawBodyBuffer(maxBytes?: number): Promise<Buffer>; // 原始请求体字节
}
```

`_getRawBody()` / `_getRawBodyBuffer()` 由 Adapter 注入，主要供框架中间件和 multipart 等插件使用；普通业务代码优先使用 `req.body`、`req.files` 和 `req.valid()`。

### VextResponse（统一响应对象）

```typescript
import type {
  CookieSerializeOptions,
  VextHeaderValue,
  VextRenderErrorOptions,
  VextRenderOptions,
} from "vextjs";

interface VextResponse {
  json(data: unknown, status?: number): void; // JSON 响应
  text(content: string, status?: number): void; // 文本响应
  render(
    page: string,
    props?: Record<string, unknown>,
    options?: VextRenderOptions,
  ): void; // 渲染前端页面
  renderError(
    errorOrStatus?: Error | number | string,
    pageOrOptions?: string | VextRenderErrorOptions,
    options?: VextRenderErrorOptions,
  ): void; // 渲染错误页
  stream(readable: NodeJS.ReadableStream, type?: string): void; // Node.js 流式响应
  download(
    readable: NodeJS.ReadableStream,
    filename: string,
    type?: string,
  ): void; // 文件下载
  redirect(url: string, status?: 301 | 302 | 307 | 308): void; // 重定向
  status(code: number): this; // 设置状态码
  setHeader(name: string, value: VextHeaderValue): this; // 设置响应头
  cookie(name: string, value: string, options?: CookieSerializeOptions): this; // 追加 Set-Cookie
  clearCookie(name: string, options?: CookieSerializeOptions): this; // 清除 Cookie
  readonly statusCode: number; // 当前状态码
}
```

`stream()` / `download()` 接收 Node.js `Readable` / `NodeJS.ReadableStream`，不是 Web `ReadableStream`。`rawJson()` 以及下划线开头的响应方法是框架内部接口，业务代码应使用 `VextPublicResponse` 可见的公共方法。

这种设计意味着：

- **切换 Adapter 不影响任何业务代码**
- **中间件在所有 Adapter 下行为一致**
- **测试代码与 Adapter 无关**

## 按环境切换 Adapter

你可以在不同环境使用不同的 Adapter：

```typescript
// src/config/default.ts — 默认使用 Native
export default {
  port: 3000,
  // adapter 默认 native
};
```

```typescript
// src/config/development.ts — 开发环境使用 Hono（利用其 DevTools）
import { honoAdapter } from "vextjs/adapters/hono";

export default {
  adapter: honoAdapter(),
};
```

```typescript
// src/config/production.ts — 生产环境沿用默认 Native
export default {
  // 不设置 adapter，继承 default.ts 的默认 native
};
```

## 常见问题

### 切换 Adapter 后需要修改代码吗？

不需要。所有业务代码（路由、中间件、服务、插件）操作的都是 `VextRequest` / `VextResponse` 接口，与底层 Adapter 完全解耦。

### 可以在运行时动态切换 Adapter 吗？

不可以。Adapter 在启动时由配置决定，运行时不可切换。如需根据环境使用不同 Adapter，请使用配置文件覆盖机制（如 `development.ts` / `production.ts`）。

### 性能差异主要来自哪里？

性能差异同时来自底层框架的 HTTP 解析、路由匹配、序列化，以及 Vext 与各 adapter 的集成路径。当前实测中，各 adapter 相对 Raw 基线的差距并不相同，也没有一个实现对所有场景恒定领先。请结合[性能基准](/benchmark)的口径，并用你的实际中间件和 I/O 负载复测。

### 底层框架的原生中间件能用吗？

不建议直接使用。VextJS 有自己的中间件系统（`defineMiddleware` / `defineMiddlewareFactory`），底层框架的原生中间件签名不同，无法直接兼容。如果需要使用某个底层框架的中间件功能，建议封装为 VextJS 中间件或插件。

### peer dependencies 报警告怎么办？

VextJS 将所有底层框架声明为可选的 `peerDependencies`。你只需安装实际使用的 Adapter 对应的框架包。例如 Hono Adapter 只需要 `hono`，其他未使用框架的 peer dependency 警告可以安全忽略。

当前 Hono Adapter 是 Node.js 运行时能力：它通过 Node.js HTTP server 接收请求，并把请求桥接给 Hono 的 Web `Request` / `Response` 处理流程。Edge / Serverless 运行时不应使用这组 Node adapter 安装说明作为支持声明。

## 下一步

- 了解 [配置](/guide/configuration) 中 Adapter 相关的配置项
- 查看 [OpenAPI 文档](/guide/openapi) 在不同 Adapter 下的表现
- 探索 [Cluster 多进程](/guide/cluster) 与 Adapter 的配合
- 阅读 [性能基准](/benchmark) 相关的基准测试数据
