# Adapter 架构

VextJS 使用 **Adapter 架构**替换底层 HTTP 处理层。基于 VextJS `req` / `res` 编写的路由与服务通常可以保持原有接口；底层框架专属的中间件、插件和能力仍需核对适配边界。本页先完成一次安装、配置、启动和切换验证，再解释实现自定义适配器需要满足的接口。

## 内置 Adapter

VextJS 内置 5 种 Adapter，覆盖主流 Node.js HTTP 框架：

| Adapter            | 底层实现                     | 当前项目声明的 peer 范围            | 需要额外安装                    |
| ------------------ | ---------------------------- | ----------------------------------- | ------------------------------- |
| **Native**（默认） | Node.js HTTP + `route-core`  | 无额外 HTTP 框架 peer               | 无；`route-core` 随 VextJS 安装 |
| **Hono**           | Hono 路由与 Node.js 请求桥接 | `hono ^4.0.0`                       | `hono`                          |
| **Fastify**        | Fastify 路由与 HTTP 服务     | `fastify ^5.0.0`                    | `fastify`                       |
| **Express**        | Express 路由与 Node.js HTTP  | `express ^5.0.0`                    | `express`                       |
| **Koa**            | Koa + `@koa/router`          | `koa ^3.0.0`、`@koa/router ^15.6.0` | `koa @koa/router`               |

以上范围来自当前 VextJS 包的依赖声明；升级时以实际安装版本的 peer 要求为准。选中其他 Adapter 不会自动开放该框架的原生插件注册接口。

### 性能对比

本页不保存独立数字快照，避免旧环境与当前结果形成两套口径。Raw Native 与 Raw Fastify 的领先项会随场景和 handler 形态变化；五个 adapter 的百分比也只表示 Vext 相对各自 Raw 基线的组合开销，不是框架总排名。

请在[性能基准](/zh/benchmark)查看唯一的当前结果、测试方法、限制和复现命令。选择 adapter 后，仍应使用实际中间件、认证、日志和 I/O 负载验证你的目标。

## 使用方法

### 先跑通一条路由

前置条件：已按[快速开始](/zh/guide/quick-start#方式二手动创建)准备 Node.js、ESM package.json、TypeScript 配置及 dev/build/start scripts。以下在 API-only 项目中验证，不需要数据库或外部服务；已有项目请合并配置，并避开同名路由。

```typescript
// src/config/default.ts
export default {
  port: 3000,
  host: "127.0.0.1",
  adapter: "native",
  frontend: { enabled: false },
};
```

```typescript
// src/routes/adapter-demo.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/:id", {}, async (req, res) => {
    res.json({ id: req.params.id, adapter: req.app.adapter.name });
  });
  app.post(
    "/",
    { validate: { body: { name: "string!" } } },
    async (req, res) => {
      const { name } = req.valid<{ name: string }>("body");
      res.json({ name, adapter: req.app.adapter.name }, 201);
    },
  );
});
```

文件名 `adapter-demo.ts` 会生成 `/adapter-demo` 前缀，文件内只写 `/:id` 和 `/`，避免重复前缀。

运行 `npm run dev`，在另一个终端执行（PowerShell 使用 `curl.exe`）：

```bash
curl -i http://127.0.0.1:3000/adapter-demo/u-1
curl -i -X POST http://127.0.0.1:3000/adapter-demo -H 'Content-Type: application/json' --data '{"name":"Alice"}'
curl -i -X POST http://127.0.0.1:3000/adapter-demo -H 'Content-Type: application/json' --data '{}'
curl -i http://127.0.0.1:3000/adapter-demo-missing
```

预期分别为：200 且 `data` 为 `{ "id": "u-1", "adapter": "native" }`；201 且 `data.name` 为 `Alice`；422 校验错误；404 未匹配路由。成功响应默认还有 `code: 0` 与 `requestId`。

先用 Ctrl+C 停止 dev，再执行 `npm run build` 和 `npm start`，重复四个请求，验证生产产物。结束后停止服务释放端口。下方各配置示例只展示 Adapter 选项，合并到当前配置，保留其他字段。

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

VextJS 使用 Fastify 承载路由与 HTTP 服务，校验和 JSON 序列化由 VextJS 自己的链路处理。`res.json()` 先经 VextJS 序列化后发送，不会因选择 Fastify 就自动改用 Fastify 的 route schema 或插件。需要设置选项时使用工厂，例如 `fastifyAdapter({ caseSensitive: true })`；传入的是 `FastifyAdapterOptions`，不是任意 Fastify 配置。

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

当前实现基于 Express v5。迁移时可复用与 HTTP 对象无关的业务逻辑；原 Express 路由与 `(req, res, next)` 中间件需要按 VextJS 接口调整。工厂的 `ExpressAdapterOptions` 提供 `bodyLimit` 字符串选项，不等于接受整个 Express 应用实例。

:::tip Express v5
现有 Express v4 依赖不满足本 Adapter 的 peer 范围。请先核对应用依赖与迁移影响，再安装符合要求的版本；不能仅更换 `adapter` 字符串就认为迁移完成。
:::

### Koa Adapter

```bash
npm install koa @koa/router
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

当前实现基于 Koa v3，由 `@koa/router` 负责路由匹配，两个包都需要安装。`KoaAdapterOptions` 提供 `bodyLimit` 字符串选项；VextJS 中间件接收统一请求/响应对象，不接收 Koa `ctx`。

## 切换 Adapter

先停止当前服务，安装目标 peer 包（Hono 为 `npm install hono`），再修改 `src/config/default.ts`：

```diff
// 从 Native 切换到 Hono
  export default {
-   adapter: "native",
+   adapter: "hono",
    port: 3000,
  };
```

重新执行 `npm run dev` 与四个请求：成功响应中的 `data.adapter` 应变为 `hono`，状态码、参数和校验结果保持一致。停止 dev 后重新 build/start 再验证，避免生产仍运行旧产物。其余 Adapter 按依赖表安装并更换字符串，用同样步骤核验。

基于 `VextRequest` / `VextResponse` 的路由 handler 和服务代码通常可以复用。迁移还应覆盖项目实际使用的大小写/尾斜杠、查询参数、上传、流式响应、取消和错误路径；四个入门请求不能证明整个业务迁移已完成。

## 如何选择 Adapter

### 选择 Native（默认推荐）

- 希望从框架默认路径开始
- 不需要其他 HTTP 框架的特定能力
- 新项目，没有 adapter 迁移约束
- 希望减少额外依赖

### 选择 Hono

- 团队了解 Hono，希望采用其路由与 Web Request/Response 桥接实现
- 部署目标是受支持的 Node.js 环境
- 已验证所需功能可通过 VextJS 公共接口使用；原生 Hono 中间件另行适配

### 选择 Fastify

- 需要使用 Fastify 的路由实现或本 Adapter 暴露的选项
- 团队已有 Fastify 运维和排障经验
- 已验证业务负载；不要把 Fastify 原生插件或自动序列化当成切换后自动获得的能力

### 选择 Express

- 从现有 Express 项目迁移到 VextJS
- 愿意将原生 HTTP 中间件转换为 VextJS 中间件
- 团队对 Express 最熟悉

### 选择 Koa

- 团队已有 Koa 与 `@koa/router` 的使用经验
- 接受安装两个 peer，并已经验证路由匹配行为
- 已为需要的原生 Koa 中间件安排适配

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
5. **中间件执行** — 收集全局中间件，在路由执行时按 VextJS 约定组合执行链

## VextAdapter 接口

所有 Adapter 实现统一的 `VextAdapter` 接口：

```typescript
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  VextAdapter as PublicAdapter,
  VextMiddleware,
  VextErrorMiddleware,
  VextServerHandle,
  RouteOptions,
} from "vextjs";

// 从公开接口提取 listen 选项类型，不依赖内部文件路径。
type VextAdapterListenOptions = Parameters<PublicAdapter["listen"]>[2];

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

配置支持内置名称、同步工厂 `(app: VextApp) => VextAdapter`，或已构造的 `VextAdapter` 对象。工厂会在应用初始化时获得当前 app；解析器只检查名称和必需方法是否存在，不会替你证明中间件、错误处理或关闭语义正确。

如果只需在现有实现外增加逻辑，可以先组合内置 Adapter。下面是可运行的委托示例，保留 Native 的全部行为，只增加名称标识；它不代表已经实现另一套 HTTP 框架：

```typescript
// src/adapters/custom.ts
import { nativeAdapter } from "vextjs/adapters/native";
import type { VextAdapter, VextApp } from "vextjs";

export function myCustomAdapter(): (app: VextApp) => VextAdapter {
  return (app) => {
    const base = nativeAdapter()(app);
    return {
      name: "my-custom",
      registerMiddleware: (middleware) => base.registerMiddleware(middleware),
      registerRoute: (method, path, chain, options) =>
        base.registerRoute(method, path, chain, options),
      registerErrorHandler: (handler) => base.registerErrorHandler(handler),
      registerNotFound: (handler) => base.registerNotFound(handler),
      buildHandler: () => base.buildHandler(),
      listen: (port, host, options) => base.listen(port, host, options),
    };
  };
}
```

将原配置的 adapter 字段改为该工厂，保留其他字段：

```typescript
// src/config/default.ts
import { myCustomAdapter } from "../adapters/custom.js";

export default {
  port: 3000,
  host: "127.0.0.1",
  adapter: myCustomAdapter(),
  frontend: { enabled: false },
};
```

重复上方 dev/build/start 与四个请求，成功响应中的 `data.adapter` 应为 `my-custom`。真正接入另一种 HTTP 实现时，需要自行实现以下契约，不能把注册方法留空或让所有请求固定返回 501：

- 将请求转换为 `VextRequest`，补齐路由模板、参数、原始正文读取与生命周期信号；将响应转换为框架需要的 `VextResponse`。
- 保留全局中间件与路由 chain 的顺序、`await next()` 回程、错误和 404 处理，以及传入的 `RouteOptions`。
- `buildHandler()` 返回 Node.js 请求处理函数且不监听端口，供 dev handler 替换使用；`listen()` 处理监听失败、server 选项并返回实际端口与可等待的 `close()`。
- 以真实 HTTP 验证正常/错误/校验、头与 Cookie、上传/流/断连以及关闭；测试开发和生产两条启动路径。前端渲染由框架安装，不能凭接口形状就宣布支持所有前端能力。

## 请求/响应转换

无论使用哪种 Adapter，业务代码优先操作统一接口。下面是主要成员摘要，省略了完整泛型及内部响应钩子；准确的公共调用签名和行为见[请求与响应](/zh/api/context)。不要把摘要复制成自定义 Adapter 的完整实现。

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
  url: string; // 原始请求 URL（通常为含查询串的相对路径）
  path: string; // 路径部分
  route: string; // 当前匹配的路由模板，404 时为空字符串
  query: Record<string, string>; // 查询参数
  body: unknown; // 请求体
  params: Record<string, string>; // 路径参数
  headers: Record<string, string | undefined>; // 请求头（小写 key）
  cookies: VextCookieJar; // 已解析 Cookie
  cookie(name: string): string | undefined; // 读取单个 Cookie
  csrfToken(): string; // CSRF 中间件生效后可用
  auth: VextAuthContext; // 认证上下文
  requestId: string; // requestId 中间件填充；禁用时不保证非空
  signal: AbortSignal; // 请求超时或提前断连时取消
  ip: string; // 客户端 IP
  protocol: "http" | "https"; // 协议
  app: VextApp; // 应用实例
  valid<T>(location: "query" | "body" | "param" | "header" | "cookie"): T;
  onClose(handler: () => void): void; // 正常响应结束或提前断连时清理
  files?: ParsedFile[]; // 内置 multipart 或自定义上传插件填充
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

- 公共接口为路由与中间件提供复用基础。
- 每个 Adapter 都要实现框架的请求、响应与中间件契约；原生框架的对象和接口不属于该契约。
- 纯业务单元测试通常可复用，HTTP 集成测试仍应在实际选用的 Adapter 上执行。

## 按环境切换 Adapter

配置加载器支持按环境覆盖 Adapter。只有明确需要并分别验证过两种实现时才这样设置；通常开发与生产保持同一 Adapter 更便于复现问题。下面仅展示覆盖机制，需提前安装 Hono：

```typescript
// src/config/default.ts — 默认使用 Native
export default {
  port: 3000,
  // adapter 默认 native
};
```

```typescript
// src/config/development.ts — 开发环境使用 Hono
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

只使用公共接口的代码通常可以复用。读取原生对象、依赖框架专属插件或路由细节的代码需要调整，并在目标 Adapter 上回归；不能承诺所有业务代码都无需修改。

### 可以在运行时动态切换 Adapter 吗？

不可以。Adapter 在启动时由配置决定，运行时不可切换。如需根据环境使用不同 Adapter，请使用配置文件覆盖机制（如 `development.ts` / `production.ts`）。

### 性能差异主要来自哪里？

性能差异同时来自底层框架的 HTTP 解析、路由匹配、序列化，以及 Vext 与各 adapter 的集成路径。当前实测中，各 adapter 相对 Raw 基线的差距并不相同，也没有一个实现对所有场景恒定领先。请结合[性能基准](/zh/benchmark)的口径，并用你的实际中间件和 I/O 负载复测。

### 底层框架的原生中间件能用吗？

不能直接作为 VextJS 中间件传入。`defineMiddleware` / `defineMiddlewareFactory` 使用统一请求、响应与 next，签名及生命周期与原生框架不同。可独立于 HTTP 对象的逻辑可以封装进 VextJS 中间件或插件；依赖原生实例的扩展需要实现桥接或自定义 Adapter，仅套一层函数不能保证兼容。

### peer dependencies 报警告怎么办？

这里的可选表示未选用该 Adapter 时无需安装；选用后相应 peer 必须存在且兼容。Hono 需要 `hono`，Koa 同时需要 `koa` 与 `@koa/router`。请区分未使用的可选包、实际选中包缺失和版本不兼容，不要统一忽略安装警告。

当前 Hono Adapter 是 Node.js 运行时能力：它通过 Node.js HTTP server 接收请求，并把请求桥接给 Hono 的 Web `Request` / `Response` 处理流程。Edge / Serverless 运行时不应使用这组 Node adapter 安装说明作为支持声明。

### 启动或切换失败如何定位？

| 现象                                     | 检查与修复                                                    | 复验                                 |
| ---------------------------------------- | ------------------------------------------------------------- | ------------------------------------ |
| 提示 unknown adapter                     | 使用依赖表中的小写名称，或同步工厂/完整对象                   | 重启后检查成功响应中的 adapter 名称  |
| 提示 requires package                    | 在应用 package.json 所在目录安装对应 peer；Koa 检查两个包     | `npm ls` 检查相应依赖，再启动        |
| 提示 incompatible / failed while loading | 查看原始 cause、peer 范围及包入口；后者也可能是适配器内部错误 | 修复具体原因，不能用重复安装代替诊断 |
| 自定义适配器提示缺少成员                 | 按 `VextAdapter` 补齐名称和六个方法                           | 类型检查、dev 和生产 HTTP 测试       |
| 修改后响应仍显示旧名称                   | 核对环境配置覆盖、运行目录和旧进程，重新 build/start          | 检查四个请求及实际端口               |
| EADDRINUSE                               | 停止自己先前启动的实例，或调整端口和请求 URL                  | 确认新实例成功监听后重试             |

## 下一步

- 了解 [配置](/zh/guide/configuration) 中 Adapter 相关的配置项
- 查看 [OpenAPI 文档](/zh/guide/openapi) 在不同 Adapter 下的表现
- 探索 [Cluster 多进程](/zh/guide/cluster) 与 Adapter 的配合
- 阅读 [性能基准](/zh/benchmark) 相关的基准测试数据
