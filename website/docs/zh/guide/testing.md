# 测试

通过 `vextjs/testing` 的 `createTestApp()`，可以在内存中执行路由、中间件和 Service 的请求链。它不监听 TCP，也不经过 CLI 的完整启动流程；数据库连接、配置 provider、生产构建和前端 hydration 需要各自的真实集成验证。

ESM `import` 与 CommonJS `require()` 均可使用。根入口和公开子路径保持共享运行时身份，例如测试应用抛出的 HttpError 可用 `require("vextjs").HttpError` 做 instanceof 判断；完整返回类型见[测试 API](/zh/api/testing-api)。

## 快速开始

前置：使用[快速开始](/zh/guide/quick-start)的 TypeScript API-only 项目，保留脚手架 `src/routes/index.ts` 的 `/health` 和其 Service。安装或使用项目已有的 Vitest：

```bash
npm install -D vitest
```

本页 TS 路由示例使用 Node.js 22.18+ 或具有同等默认类型擦除能力的更新版本，并保留 package.json 的 `"type": "module"`。路由加载直接使用 Node import；仅安装 Vitest 并不能让 Node 20 自动加载 `.ts` 路由。原生类型擦除不做 `.js` → `.ts` 运行时重映射、不读取 paths alias，也不支持所有 TS 语法；详见 [Node TypeScript 文档](https://nodejs.org/api/typescript.html)。更复杂的路由依赖应配置兼容的测试加载器，或针对真实 CLI 编译产物测试。

创建下面的测试文件，在**项目根目录**运行。当前版本 Vitest 的 Node 要求以[官方安装说明](https://vitest.dev/guide/)为准；使用同时满足 VextJS 和测试工具要求的 Node。

```typescript
// test/health.test.ts
import { it, expect } from "vitest";
import { createTestApp } from "vextjs/testing";

it("GET /health 返回健康状态", async () => {
  const t = await createTestApp({ config: { adapter: "native" } });
  try {
    const res = await t.request.get("/health");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "ok" });
  } finally {
    await t.close();
  }
});
```

```bash
npx vitest run test/health.test.ts
```

预期该测试通过；删除或改名路由后应失败，修复后重跑。fullstack 脚手架使用 `/api/health`，不能照抄 API-only 路径。这里使用 Native adapter，若业务用其他适配器，还需用已安装的实际适配器验证。

测试工具不绑定 Vitest；也可搭配 Node.js test runner 或 Jest。下面独立用例包含资源清理；API 局部片段则假定已有 `t: TestApp`，在用例结束统一 `await t.close()`。

## `createTestApp()`

`createTestApp()` 是测试的核心 API。它创建测试应用、加载显式选择的模块并构造内存请求处理器。返回 `{ app, request, close }`：`t.app` 是 VextApp，`t.request` 发请求，`t.close()` 清理资源；没有 `app.inject()`。

### 基本用法

```typescript
const t = await createTestApp({
  rootDir: process.cwd(), // 用于定位 src/，不是自动读取项目配置
  config: { adapter: "native" },
});

try {
  const res = await t.request.get("/health");
  expect(res.status).toBe(200);
} finally {
  await t.close();
}
```

默认扫描该 rootDir 下的 routes / services；中间件还需配置白名单。初始化前加载语言包，初始化结束等待 onReady，再返回 TestApp。插件、Service、语言脚本以及 `app.fetch` 仍可能连接外部系统；“不监听 HTTP”不等于没有 I/O 或副作用。

### 配置选项

```typescript
interface CreateTestAppOptions {
  /** 深度合并到框架默认值与测试默认值之上的后层 patch */
  config?: VextConfigOverride;

  /** 是否加载 src/plugins/ 目录中的插件（默认 false） */
  plugins?: boolean;

  /** 自定义插件 setup 函数（替代文件系统扫描） */
  setupPlugins?: (app: VextApp) => Promise<void> | void;

  /** 显式提供开发 HTML 错误展示；不是自动启动前端 */
  devOverlay?: (error: unknown) => string;

  /** 是否加载 src/services/ 目录中的服务（默认 true） */
  services?: boolean;

  /** 模拟服务对象（在自动加载之后覆盖同名服务） */
  mockServices?: Partial<VextServices>;

  /** 是否加载 src/routes/ 目录中的路由（默认 true） */
  routes?: boolean;

  /** 是否加载 src/middlewares/ 目录中的中间件（默认 true） */
  middlewares?: boolean;

  /** 项目根目录（默认 process.cwd()） */
  rootDir?: string;
}
```

`CreateTestAppOptions.config` 是覆盖层，不是独立的基础配置。`VextConfigOverride`
允许测试局部 patch 框架/测试默认值中已经存在的嵌套字段；adapter、store、callback
与数组等原子值仍必须完整提供。

`createTestApp()` 不会加载项目的 `src/config/default.ts`，内置测试默认值也没有
`database`。因此测试若新增这个可选 section，必须提供包含必填连接 `config` 的
完整 database 配置；不能指望不存在的前层补齐半截 database。即使传入了完整 database，这个 helper 也**不自动运行内置数据库插件**；真实数据库流程见下文 CLI 验证。

语言包在插件、服务和路由初始化前加载：默认读取 `rootDir/src/locales`，自定义目录通过 `config.locale.directory` 指定，解析规则与正常启动一致。模块子目录、JSON 和脚本字典均支持；脚本会执行。缺目录使用空字典，损坏字典使测试应用初始化失败。此步骤不会额外加载项目配置文件、执行配置 provider 或自动连接数据库。

`setupPlugins` 存在时优先使用回调，`plugins: true` 的目录扫描被替代；不是两个都执行。`services: true` 与 `mockServices` 同时提供时，先构造真实 Service，再覆盖 mock，因此真实构造副作用已经发生。要绕过真实加载，显式写 `services: false`。

### 常见配置场景

#### 测试默认值与日志级别

```typescript
const t = await createTestApp({
  config: {
    port: 0, // helper 不监听端口，0 不表示实际开启一个随机端口
    logger: { level: "silent" }, // 测试时静默日志
  },
});
```

#### 跳过插件加载

```typescript
const t = await createTestApp({
  plugins: false, // 默认值：不加载 src/plugins/ 下的插件
});
```

#### 模拟服务

```typescript
const t = await createTestApp({
  services: false, // 不加载真实的 service，避免构造副作用
  mockServices: {
    user: {
      findAll: async () => [{ id: "1", name: "Alice" }],
      findById: async (id: string) => ({ id, name: "Alice" }),
      create: async (data: any) => ({ id: "99", ...data }),
    },
  },
});
```

#### 自定义插件

```typescript
const t = await createTestApp({
  setupPlugins: async (app) => {
    // 注入测试用的模拟对象
    app.extend("testCache", new Map());
    app.extend("mailer", {
      send: async () => ({ messageId: "test-123" }),
    });
  },
});
```

前面都是选项片段，创建的 TestApp 仍需关闭。`mockServices` 仅覆盖服务对象，不生成路由、认证逻辑或数据库；路由依赖哪些方法就必须提供哪些方法。已生成 Service 类型的项目应按公开接口提供 mock，避免用 `as any` 隐藏缺失方法。

## 发送测试请求

`createTestApp()` 返回的对象包含 `request` 属性，支持所有 HTTP 方法：

```typescript
// 以下 t 已由 createTestApp() 创建；方法可用不代表项目已注册对应路由。
// GET
const res1 = await t.request.get("/users");

// POST
const res2 = await t.request.post("/users");

// PUT
const res3 = await t.request.put("/users/1");

// PATCH
const res4 = await t.request.patch("/users/1");

// DELETE
const res5 = await t.request.delete("/users/1");

// OPTIONS
const res6 = await t.request.options("/users");

// HEAD
const res7 = await t.request.head("/users");
```

### 链式构建请求

每个 HTTP 方法返回一个 `TestRequestBuilder`，支持链式调用来配置请求。必须 `await` 或调用 `.then()` 才执行；重复等待同一个 builder 会重复发送请求，不会复用响应：

```typescript
const res = await t.request
  .post("/users")
  .set("Authorization", "Bearer test-token") // 设置单个 header
  .headers({
    // 批量设置 headers
    "X-Custom": "value",
    "Accept-Language": "zh-CN",
  })
  .query({ page: "1", limit: "10" }) // 设置 query 参数
  .type("application/json") // 设置 Content-Type
  .send({ name: "Alice", email: "alice@example.com" }); // 设置请求体
```

#### `.set(name, value)` — 设置单个请求头

```typescript
await t.request
  .get("/profile")
  .set("Authorization", "Bearer my-token")
  .set("Accept-Language", "en-US");
```

#### `.headers(obj)` — 批量设置请求头

```typescript
await t.request.get("/data").headers({
  Authorization: "Bearer token",
  "X-Request-Id": "test-req-001",
});
```

#### `.query(obj)` — 设置 URL 查询参数

```typescript
await t.request
  .get("/search")
  .query({ keyword: "vext", page: "1", limit: "20" });
// 实际请求 URL: /search?keyword=vext&page=1&limit=20
// 再调用 query() 会替换前次 query 对象；不是逐次合并。
```

#### `.send(body)` — 设置请求体

```typescript
// 发送 JSON（默认 Content-Type: application/json）
await t.request
  .post("/users")
  .send({ name: "Alice", email: "alice@example.com" });

// 发送字符串
await t.request.post("/raw").type("text/plain").send("Hello World");
```

#### `.type(contentType)` — 设置 Content-Type

```typescript
await t.request
  .post("/upload")
  .type("application/x-www-form-urlencoded")
  .send("name=Alice&email=alice@example.com");
```

`.send()` 对字符串原样发送，其他值做 JSON.stringify；设置 Content-Type 不会自动做表单或 multipart 编码。不提供文件 attach、Cookie jar 或自动跟随重定向；二进制、流式、连接断开和完整上传行为请通过真实 HTTP 验证。

### `TestResponse` 响应对象

请求完成后返回 `TestResponse` 对象：

```typescript
interface TestResponse {
  /** HTTP 状态码 */
  status: number;

  /** 响应头（小写 key，Set-Cookie 可能是 string[]） */
  headers: Record<string, string | string[]>;

  /** Set-Cookie 响应头 */
  cookies: string[];

  /** 读取响应头的第一个值 */
  header(name: string): string | undefined;

  /** 读取响应头的所有值 */
  headerValues(name: string): string[];

  /** 解析后的响应体（JSON 自动解析为对象） */
  body: any; // 仅在响应 Content-Type 含 application/json 或 +json 时解析

  /** 原始响应体文本 */
  text: string;
}
```

```typescript
// 使用下方 /items 夹具时，可断言真实的返回结构。
const res = await t.request.get("/items");

// 断言状态码
expect(res.status).toBe(200);

// 断言响应体（JSON 自动解析）
expect(res.body).toEqual({
  code: 0,
  data: { items: [{ id: "1", name: "initial" }] },
  requestId: expect.any(String),
});

// 断言响应头
expect(res.header("content-type")).toContain("application/json");
expect(res.headers["x-request-id"]).toBeDefined();
expect(res.headerValues("set-cookie")).toEqual(res.cookies);

// 断言原始文本
expect(res.text).toContain('"code":0');
```

多值 Set-Cookie 用 `cookies` 或 `headerValues()` 读取，不要按逗号拆分。下一次请求需要手动 `.set("Cookie", ...)`；HEAD 的 `text` 为空，不能断言它与 GET 有相同正文。

## 测试模式特性

`createTestApp()` 创建的应用处于测试模式（`_testMode: true`），与生产模式有以下区别：

| 特性             | 测试模式      | 生产模式      |
| ---------------- | ------------- | ------------- |
| HTTP 监听        | ❌ 不启动     | ✅ 监听端口   |
| `process.exit()` | ❌ 不调用     | ✅ 关闭时调用 |
| 日志级别         | 默认 `silent` | 由配置决定    |
| 限流             | 默认禁用      | 由配置决定    |
| 关闭超时         | 默认 1 秒     | 由配置决定    |

helper 强制保留 `_testMode: true`，不会为应用注册生产进程信号/致命错误处理器。测试默认 accessLog 关闭；rateLimit 需显式启用才能覆盖 429。配置合并与 CLI 的文件加载、provider、校验和 preload 链不同，因此不能据本地 helper 通过就认定生产配置可用。

## 实战示例

### 准备可隔离的路由与服务

以下是独立测试夹具，放在 `test/fixtures/http/src/` 下，不混入业务路由。Service 的内存数据属于每个实例；token 只是测试输入，不是业务认证方案。

```typescript
// test/fixtures/http/src/services/item.ts
export interface Item {
  id: string;
  name: string;
}

export default class ItemService {
  private items = new Map<string, Item>([["1", { id: "1", name: "initial" }]]);
  private nextId = 2;

  list() {
    return [...this.items.values()];
  }

  find(id: string) {
    return this.items.get(id) ?? null;
  }

  create(name: string) {
    const item = { id: String(this.nextId++), name };
    this.items.set(item.id, item);
    return item;
  }

  remove(id: string) {
    return this.items.delete(id);
  }
}
```

```typescript
// test/fixtures/http/src/middlewares/token.ts
import { defineMiddleware } from "vextjs";

export default defineMiddleware(async (req, _res, next) => {
  if (req.headers.authorization !== "Bearer test-token") {
    req.app.throw(401, "token_required");
  }
  await next();
});
```

```typescript
// test/fixtures/http/src/routes/items.ts
import { defineRoutes } from "vextjs";
import type ItemService from "../services/item.js";

export default defineRoutes((app) => {
  const service: Pick<ItemService, "list" | "find" | "create" | "remove"> =
    app.services.item;

  app.get("/", async (_req, res) => {
    res.json({ items: service.list() });
  });

  app.get("/:id", async (req, res) => {
    const item = service.find(req.params.id!);
    if (!item) app.throw(404, "item_not_found");
    res.json(item);
  });

  app.post(
    "/",
    { middlewares: ["token"], validate: { body: { name: "string!" } } },
    async (req, res) => {
      res.json(service.create(req.valid("body").name), 201);
    },
  );

  app.delete("/:id", { middlewares: ["token"] }, async (req, res) => {
    if (!service.remove(req.params.id!)) app.throw(404, "item_not_found");
    res.status(204).json(null);
  });
});
```

文件前缀使路径为 `/items`、`/items/:id`。下面提供中间件白名单；只创建 token.ts 不会使它可用。真实项目的 Service 类型建议由 typegen 生成；此夹具显式约束路由使用的四个方法。

### 测试 CRUD 路由、中间件与错误响应

```typescript
// test/http.test.ts
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestApp, type TestApp } from "vextjs/testing";

const rootDir = fileURLToPath(new URL("./fixtures/http/", import.meta.url));
let t: TestApp | undefined;

beforeEach(async () => {
  t = await createTestApp({
    rootDir,
    config: { adapter: "native", middlewares: ["token"] },
  });
});
afterEach(async () => {
  await t?.close();
  t = undefined;
});

it("创建、读取、删除，再读返回404", async () => {
  const created = await t!.request
    .post("/items")
    .set("Authorization", "Bearer test-token")
    .send({ name: "book" });
  expect(created.status).toBe(201);
  expect(created.body.data).toMatchObject({
    id: expect.any(String),
    name: "book",
  });
  const id = created.body.data.id;

  const found = await t!.request.get("/items/" + id);
  expect(found.status).toBe(200);
  expect(found.body.data.name).toBe("book");

  const removed = await t!.request
    .delete("/items/" + id)
    .set("Authorization", "Bearer test-token");
  expect(removed.status).toBe(204);
  expect(removed.text).toBe("");
  expect((await t!.request.get("/items/" + id)).status).toBe(404);
});

it("认证缺失或错误返回401", async () => {
  const absent = await t!.request.post("/items").send({ name: "book" });
  expect(absent.status).toBe(401);
  const wrong = await t!.request
    .post("/items")
    .set("Authorization", "Bearer wrong")
    .send({ name: "book" });
  expect(wrong.status).toBe(401);
});

it("已认证但缺少必填字段返回422", async () => {
  const res = await t!.request
    .post("/items")
    .set("Authorization", "Bearer test-token")
    .send({});
  expect(res.status).toBe(422);
  expect(res.body.code).toBe(422);
  expect(res.body.errors).toBeInstanceOf(Array);
});

it("传播请求ID、返回结构和JSON响应头", async () => {
  const res = await t!.request.get("/items").set("X-Request-Id", "test-list-1");
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    code: 0,
    data: { items: [{ id: "1", name: "initial" }] },
    requestId: "test-list-1",
  });
  expect(res.header("content-type")).toContain("application/json");
});

it("未知路由返回带requestId的404", async () => {
  const res = await t!.request.get("/missing");
  expect(res.status).toBe(404);
  expect(res.body).toMatchObject({
    code: 404,
    message: expect.any(String),
    requestId: expect.any(String),
  });
});
```

```bash
npx vitest run test/http.test.ts
```

预期 5 项通过。每项创建新的 Service 实例，删除用例不会污染后续列表；每次成功创建的 TestApp 都由 afterEach 关闭。断言 401 使用合法 body，断言 422 使用合法 token，避免把上游拒绝误当成目标逻辑已验证。

### 使用模拟服务测试

复用上面夹具，仅替换 Service；在新的文件中运行：

```typescript
// test/http-mock.test.ts
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { createTestApp } from "vextjs/testing";
import ItemService from "./fixtures/http/src/services/item.js";

it("路由使用传入的mock，并保留404语义", async () => {
  const mock = {
    list: vi.fn(() => [{ id: "mock-1", name: "mock" }]),
    find: vi.fn(() => null),
    create: vi.fn((name: string) => ({ id: "mock-2", name })),
    remove: vi.fn(() => false),
  } satisfies Pick<ItemService, "list" | "find" | "create" | "remove">;
  const t = await createTestApp({
    rootDir: fileURLToPath(new URL("./fixtures/http/", import.meta.url)),
    services: false,
    mockServices: { item: mock },
    config: { adapter: "native", middlewares: ["token"] },
  });
  try {
    const list = await t.request.get("/items");
    expect(list.body.data.items[0].id).toBe("mock-1");
    expect(mock.list).toHaveBeenCalledOnce();

    const missing = await t.request.get("/items/999");
    expect(missing.status).toBe(404);
    expect(mock.find).toHaveBeenCalledWith("999");
  } finally {
    await t.close();
  }
});
```

使用真实 `app.throw(...)` 或公开 `HttpError` 模拟业务错误。普通 `Error` 的合法 `status` / `statusCode` 也会被错误归一化读取，但不具备 HttpError 的类型、name 和业务 code 契约；未提供合法 HTTP 错误状态时默认 500。mockService 的通过结果覆盖路由到 mock 的契约，不验证真实数据库或 Service 实现。

### 测试服务层（单元测试）

这个夹具的 Service 不依赖 app，可直接实例化：

```typescript
// test/item.test.ts
import { expect, it } from "vitest";
import ItemService from "./fixtures/http/src/services/item.js";

it("每个Service实例拥有独立数据", () => {
  const first = new ItemService();
  const second = new ItemService();
  const item = first.create("book");
  expect(first.find(item.id)).toEqual(item);
  expect(second.find(item.id)).toBeNull();
  expect(first.remove(item.id)).toBe(true);
  expect(first.find(item.id)).toBeNull();
});
```

依赖 `VextApp` 的业务 Service 可从一个关闭扫描的 TestApp 获取真实基础 app，或按实际依赖提供 typed mock；不要用 `as any` 掩盖未实现的 app 能力。

## 项目配置

### TypeScript 服务文件与 ESM 加载

`services: true` 时扫描 `rootDir/src/services/`。共享模块加载器将 TypeScript 编译后导入，处理类型擦除、本地 `.js` import 对应 `.ts` 源码等情况；npm 依赖仍由项目解析。项目须允许工具创建/清理临时编译产物，依赖缺失或导出不是 class 会使初始化失败。

这不等于任意 Node/Vite 版本都不能加载 TS，也不保证动态拼接的路径和所有第三方加载器都兼容。若只验证路由契约，`services: false + mockServices` 可绕过 Service 加载；若要验证构造、跨 Service 依赖或生产产物，则必须保留相应真实链路。

### Vitest 配置

多个测试文件共享 rootDir（含父子目录重叠）时，模块加载会争用项目 owner。运行全套示例前创建以下 `vitest.config.ts`，禁止这些文件并发；独立、不重叠的夹具才可按实际情况恢复并行：

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/types/**"],
    },
  },
});
```

覆盖率需安装与 Vitest 兼容的 `@vitest/coverage-v8`，参阅[官方覆盖率说明](https://vitest.dev/guide/coverage.html)。Vitest 默认执行转换而非项目完整类型检查；类型检查应单独执行，并把 test/ 也纳入专用 tsconfig。通过文件系统额外编译加载的模块，其覆盖率路径需核对是否映射回源文件，不能只看汇总比例。

### 测试目录结构

推荐的测试目录组织方式：

```
test/
├── unit/                    # 单元测试
│   ├── services/
│   │   ├── user.test.ts
│   │   └── order.test.ts
│   ├── middlewares/
│   │   └── auth.test.ts
│   └── lib/
│       └── config-loader.test.ts
│
├── integration/             # 集成测试
│   ├── routes/
│   │   ├── users.test.ts
│   │   └── orders.test.ts
│   └── plugins/
│       └── redis.test.ts
│
└── e2e/                     # 端到端测试
    └── api.test.ts
```

### package.json 脚本

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run test/unit",
    "test:int": "vitest run test/integration",
    "test:e2e": "vitest run test/e2e",
    "test:cov": "vitest run --coverage"
  }
}
```

## 最佳实践

### 1. 按测试对象选择层级

| 目标                                        | 使用方式                        | 不能据此证明                                 |
| ------------------------------------------- | ------------------------------- | -------------------------------------------- |
| 纯 Service 算法和状态                       | 直接实例化，隔离数据            | HTTP 与加载配置正确                          |
| 路由、校验、错误、中间件                    | createTestApp + 明确夹具/mock   | 生产启动、外部依赖和网络链路正确             |
| 实际 Service 与插件组合                     | helper 显式加载并提供真实依赖   | CLI config provider、preload、内置 DB 已执行 |
| dev / build / start、数据库、上传/流式、SSR | 真实 CLI + TCP/浏览器或部署环境 | 所有业务场景已覆盖                           |

### 2. 关闭资源并隔离状态

默认日志已静默，无需每个用例重复配置。只读用例可 beforeAll 创建、afterAll 关闭；写入状态的用例优先 beforeEach / afterEach 或每次创建新 mock，避免依赖测试执行次序。每个 TestApp 注册的 onClose 负责释放其资源，超时默认 1 秒，长清理需显式调整。

不要把同一个有可变数据的 app、Store 或数据库集合交给并发测试。同一/重叠 rootDir 的加载还受项目 owner 约束，可能报 VEXT_OWNER_BUSY；用上面的串行配置或真正分离的项目根目录解决。Cookie 需要按测试会话手动传递；外部数据库、Redis、连接池和后台任务不会因 `_testMode` 自动隔离。

### 3. 验证正确的分支与副作用

除了状态码，核对响应结构、header、mock 调用参数和关键副作用。负向输入要使前置认证/校验通过后再命中目标分支；例如未带 token 的非法 body 不能证明 Schema 校验生效。不要只断言“发生了错误”，还应确认目标错误而非加载失败或 500。

### 4. 用真实 CLI 补齐生产路径

在业务项目根目录启动实际服务：

```bash
npx vextjs dev --port 3000
```

另开终端请求实际业务 URL，完成正向、非法输入、未认证、依赖失败和恢复验证。停止 dev 后：

```bash
npx vextjs build --typecheck
npx vextjs start --port 3000
```

再重复业务请求，并检查配置 profile、依赖连接和输出日志。JavaScript API-only 项目不需要后端 build；按[构建指南](/zh/guide/build)选择流程。上面的 `test/fixtures` 只给 helper 使用，不会自动变成 CLI 项目的 src。

外部 MongoDB 集成按[数据库指南](/zh/guide/database)准备隔离库/验证 profile；前端 SSR、hydration 和刷新按[前端概览](/zh/frontend/overview)验证。测试结束停止自己启动的服务，清理自己创建的数据；保留用户原有服务和未知归属的数据。

## 测试 Jobs

`vextjs/testing` 还导出 `createTestJobRunner()`，传入 Job 定义，通过 `run()` 执行，并在 finally / teardown 中 `close()`。它不自动证明独立 scheduler / worker 的持久化、领取、心跳和跨进程调度正确；完整示例及边界见 [Jobs API](/zh/api/jobs)。

## 下一步

- 了解 [路由](/zh/guide/routing) 如何定义可测试的 API
- 学习 [服务层](/zh/guide/services) 的单元测试模式
- 查看 [CLI 命令](/zh/guide/cli) 了解 `dev` / `build` / `start` 等运行命令
- 探索 [中间件](/zh/guide/middleware) 的测试技巧
