# 测试工具

本页详细介绍 VextJS 的测试工具 API，包括 `createTestApp`、`TestApp`、`TestRequest`、`TestRequestBuilder`、`TestResponse` 和 `createTestJobRunner`。完整业务夹具与执行步骤见[测试指南](/zh/guide/testing)，本页用于查询签名、默认值和执行边界。

## 概述

通过测试子路径导入运行时值和类型：

```typescript
import {
  createTestApp,
  createTestJobRunner,
  type CreateTestAppOptions,
  type TestApp,
  type TestRequest,
  type TestRequestBuilder,
  type TestResponse,
  type TestResponseHeaderValue,
  type CreateTestJobRunnerOptions,
  type TestJobRunner,
} from "vextjs/testing";
```

ESM `import` 与 CommonJS `require()` 均支持，根入口与子路径共享运行时身份；例如错误可用 `require("vextjs").HttpError` 检查。根入口只额外导出其中五个 HTTP 测试类型，详见[类型导入](#类型导入)。

- **内存请求**：构造 adapter handler 并模拟 Node 请求/响应，不监听 TCP。插件、语言脚本、Service 和出站 fetch 仍可发生真实 I/O。
- **测试默认值**：静默日志、关闭限流与访问日志、1 秒关闭预算；具体值可覆盖。
- **执行时机**：builder 是 PromiseLike，`await` / `.then()` 才发请求。
- **清理责任**：`_testMode` 强制为 true，关闭不调用 process.exit；创建成功后仍需显式 close。
- **适用边界**：不等同于 CLI bootstrap、真实 HTTP、前端 renderer/hydration 或数据库集成。

---

## createTestApp

`createTestApp` 是测试用 App 工厂函数，创建测试 app 与请求处理器。没有自动附送的 /health、业务路由或数据库。

在插件、服务、路由之前加载应用字典，默认目录为 `rootDir/src/locales`，支持通过 `config.locale.directory` 覆盖、模块子目录、JSON 和脚本字典。缺目录使用空字典，格式错误使初始化失败，脚本按模块执行。它不读取项目配置文件或执行配置 provider，也不自动连接数据库。需要显式重载时，调用根入口 `loadI18n(testApp.app, directory)`；详见 [国际化](/zh/guide/i18n)。

### 函数签名

```typescript
async function createTestApp(options?: CreateTestAppOptions): Promise<TestApp>;
```

### 基本用法

以下完整例子不依赖业务路由，可保存为 `test/testing-api.mjs`，在已安装 vextjs 的项目根执行 `node test/testing-api.mjs`：

```javascript
// test/testing-api.mjs
import assert from "node:assert/strict";
import { createTestApp } from "vextjs/testing";

const testApp = await createTestApp({
  routes: false,
  services: false,
  middlewares: false,
  config: { adapter: "native" },
});
try {
  const res = await testApp.request.get("/missing");
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 404);
  assert.equal(typeof res.body.requestId, "string");
} finally {
  await testApp.close();
}
```

预期无断言失败并正常退出。以下选项及请求片段各自独立，假定已导入所需类型、断言工具并准备对应路由；示意的 `/users` 不是框架内置路径。创建的每个 testApp 都须关闭，不要连续覆盖变量而遗失前一个实例。

### 返回值

返回 `Promise<TestApp>`，包含 `app`、`request` 和 `close` 三个成员。

---

## CreateTestAppOptions

`createTestApp` 的配置选项。所有字段均为可选。

```typescript
interface CreateTestAppOptions {
  config?: VextConfigOverride;
  plugins?: boolean;
  setupPlugins?: (app: VextApp) => Promise<void> | void;
  services?: boolean;
  mockServices?: Partial<VextServices>;
  routes?: boolean;
  middlewares?: boolean;
  rootDir?: string;
  devOverlay?: (error: unknown) => string;
}
```

### 字段说明

| 字段           | 类型                         | 默认值          | 说明                                          |
| -------------- | ---------------------------- | --------------- | --------------------------------------------- |
| `config`       | `VextConfigOverride`         | `{}`            | 合并到框架默认值与测试默认值之上的后层 patch  |
| `plugins`      | `boolean`                    | `false`         | 是否加载 `src/plugins/`（测试环境默认不加载） |
| `setupPlugins` | `Function`                   | `undefined`     | 手动注册插件（替代自动扫描）                  |
| `services`     | `boolean`                    | `true`          | 是否加载 `src/services/`                      |
| `mockServices` | `Partial<VextServices>`      | `undefined`     | 手动注入 mock services                        |
| `routes`       | `boolean`                    | `true`          | 是否加载 `src/routes/`                        |
| `middlewares`  | `boolean`                    | `true`          | 是否加载 `src/middlewares/`                   |
| `rootDir`      | `string`                     | `process.cwd()` | 项目根目录（用于定位 `src/` 子目录）          |
| `devOverlay`   | `(error: unknown) => string` | `undefined`     | 请求接受 `text/html` 时的可选 HTML 错误渲染器 |

---

### `config`

按 profile/local 配置相同的路径感知深度合并语义 patch 框架默认值与测试默认值。
这些默认值中已经存在的嵌套 plain object 可以局部提供；adapter、store、callback
与数组等原子值仍保持完整。`createTestApp()` 不加载项目的
`src/config/default.ts`，其内置默认值也不包含 `database`；若新增该可选 section，
必须提供完整 database 配置，不能只写半截 patch。这个 helper 不会因此运行内置 MonSQLize 插件，`plugins: true` 只加载用户 plugins 目录；真实数据库验证见[数据库指南](/zh/guide/database)。

```typescript
testApp = await createTestApp({
  config: {
    adapter: "fastify", // 已安装该适配器要求的 fastify peer
    response: { wrap: false }, // 禁用出口包装
    cors: { enabled: false }, // 禁用 CORS
  },
});
```

**有效测试默认值摘要**（未列出字段继续继承框架默认值；session.enabled=false 来自框架层）：

```typescript
{
  port: 0,                // 隔离测试配置；TestRequest 不监听端口
  host: '127.0.0.1',
  logger: { level: 'silent' },  // 日志静默
  rateLimit: {
    enabled: false,        // 禁用限流
    max: 100,
    window: 60,
    message: 'Too Many Requests',
    keyBy: 'ip',
  },
  accessLog: { enabled: false }, // 关闭请求日志噪声
  session: { enabled: false },   // 与应用运行时保持相同的显式启用默认值
  shutdown: { timeout: 1 },  // 快速关闭（1 秒）
  _testMode: true,            // 阻止 process.exit()
}
```

`_testMode` 在合并后强制设为 true，不能用参数关闭。其余配置合并优先级从低到高为：`DEFAULT_CONFIG` → `测试默认值` → `config 参数`。显式设置 `rateLimit.enabled`、`accessLog.enabled` 或 `session.enabled` 为 `true` 时，会注册与生产、开发环境相同的内置运行时。

`TestRequest` 直接调用已构建的 handler，因此其请求不会绑定或连接到这个端口。

---

### `plugins`

控制是否自动扫描 `src/plugins/` 目录加载插件。

```typescript
// 默认不加载插件（单元测试通常不需要真实插件）
testApp = await createTestApp(); // plugins: false

// 集成测试可能需要加载插件
testApp = await createTestApp({ plugins: true });
```

---

### `setupPlugins`

手动执行插件 setup，替代自动扫描。回调期间可 extend/use/注册生命周期 hook；不会自动为注入资源生成 close。

```typescript
testApp = await createTestApp({
  setupPlugins: async (app) => {
    // 只注册测试需要的插件
    const cache = new Map<string, unknown>();
    app.extend("testCache", cache);
    app.onClose(() => {
      cache.clear();
    });
  },
});
```

:::tip
`setupPlugins` 用于替代自动扫描：当传入 `setupPlugins` 时，测试工具只执行该函数，不再读取 `plugins: true` 触发的文件系统扫描。若需要真实插件，请使用 `plugins: true`；若需要精确控制测试依赖，请只使用 `setupPlugins`。
:::

---

### `services`

控制是否自动加载 `src/services/` 目录的服务。

```typescript
// 加载真实服务（默认，集成测试推荐）
testApp = await createTestApp(); // services: true

// 不加载服务（单元测试推荐：使用 mockServices 替代）
testApp = await createTestApp({
  services: false,
  mockServices: {
    user: {
      findAll: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      findById: vi.fn().mockResolvedValue({ id: "1", name: "Test User" }),
    },
  },
});
```

#### TypeScript 服务文件加载机制

Service 与用户中间件的 TS 模块由共享模块加载器编译后导入，支持本地依赖及 `.js` import 对应 `.ts` 源文件；npm 依赖仍按项目解析。临时产物受项目 owner 管理，完成后清理。工作目录须允许工具写入，缺失模块、导出不合法等会使初始化失败。

路由文件则直接由 Node `import(fileURL)` 加载，不能把 Service 编译能力推断为路由也自动编译。Node20 下普通已安装包 + Vitest 环境可能报 `Unknown file extension ".ts"`；可使用纯 JS 路由、兼容的测试 loader，或按[测试指南](/zh/guide/testing#快速开始)使用满足原生 TS 类型擦除限制的 Node 环境。真实 CLI dev/build 有自己的编译链路。

同一或重叠 rootDir 的多个测试进程可能争用 owner 并报 `VEXT_OWNER_BUSY`。共享夹具应串行执行，或使用不重叠的独立项目。没有 TCP 端口冲突不代表可以无条件并行。

---

### `mockServices`

手动注入 mock 服务，覆盖 `service-loader` 扫描结果。

```typescript
const mockUserService = {
  findAll: vi.fn().mockResolvedValue([
    { id: "1", name: "Alice" },
    { id: "2", name: "Bob" },
  ]),
  findById: vi.fn().mockResolvedValue({ id: "1", name: "Alice" }),
  create: vi.fn().mockImplementation(async (data: { name: string }) => ({
    id: "3",
    ...data,
  })),
  update: vi.fn().mockResolvedValue({ id: "1", name: "Updated" }),
  delete: vi.fn().mockResolvedValue(undefined),
};

testApp = await createTestApp({
  mockServices: {
    user: mockUserService,
  },
});
```

该例仍保持 services 默认 true；只想运行 mock 时加 `services: false`，避免真实 Service 先执行构造。mock 不自动补齐业务方法，应满足实际 Service 契约。

**合并逻辑**：

| `services` | `mockServices` | 行为                                             |
| :--------: | :------------: | ------------------------------------------------ |
|   `true`   |      有值      | 先加载真实服务，再用 `mockServices` 覆盖同名服务 |
|   `true`   |      无值      | 仅使用真实服务                                   |
|  `false`   |      有值      | 仅使用 `mockServices`                            |
|  `false`   |      无值      | 无自动加载/注入；插件仍可能显式提供服务          |

---

### `routes`

控制是否自动加载 `rootDir/src/routes/`。加载前会使用最终配置和中间件白名单构造请求链；路径仍有文件名前缀。`routes: false` 不自动注册测试路由。

```typescript
// 加载真实路由（默认，集成测试）
testApp = await createTestApp(); // routes: true

// 不加载路由（单元测试服务层时不需要路由）
testApp = await createTestApp({ routes: false });
```

---

### `middlewares`

控制是否按 `config.middlewares` 白名单加载 `rootDir/src/middlewares/` 的用户中间件。默认 true 不等于全目录启用；白名单为空时不加载，路由引用未注册名称会报错。

```typescript
// 加载用户中间件（默认）
testApp = await createTestApp(); // middlewares: true

// 跳过用户中间件加载（测试不涉及路由级中间件时）
testApp = await createTestApp({ middlewares: false });
```

:::tip
`middlewares` 只控制用户中间件目录扫描。requestId、CORS、bodyParser、responseWrapper、Session、CSRF、限流等内置能力仍按各自配置决定是否启用；不能写成它们无条件全部注册。
:::

---

### `rootDir`

项目根目录，用于定位 `src/routes`、`src/services`、`src/plugins` 等目录。

```typescript
import { fileURLToPath } from "node:url";

// 例如本文件位于 test/http.test.ts
const rootDir = fileURLToPath(new URL("./fixtures/http/", import.meta.url));
testApp = await createTestApp({ rootDir });
```

---

### `devOverlay`

可传入 `(error: unknown) => string`。当错误请求 Accept 包含 `text/html` 时，用返回 HTML 展示错误；回调抛错会回退普通错误处理。它不启动前端构建、Fast Refresh 或浏览器，也不影响普通 JSON 请求。测试错误隐藏时应明确 Accept 和 `response.hideInternalErrors`。

### 初始化与资源边界

顺序为配置合并 → app / i18n / Session / rateLimit runtime / adapter / fetch → 插件 → 用户中间件 → Service → mock 覆盖 → 路由 → 内置请求链与错误处理 → onReady → handler / TestRequest。

onReady 会被等待；单个 hook 抛错由应用记录后继续，不代表初始化一定 reject。需要验证就绪副作用时应直接断言结果。helper 没有完整生产 bootstrap 的配置文件、provider、preload、内置 DB、前端产物检查和进程信号流程。

初始化失败时尚未返回 close；自定义 setup 在部分分配资源后失败，需要在失败分支清理自己已取得的资源，不能假设所有失败路径已整体回滚。

## TestApp

`createTestApp` 返回的测试应用实例。

```typescript
interface TestApp {
  app: VextApp;
  request: TestRequest;
  close(): Promise<void>;
}
```

### `app`

底层 `VextApp` 实例，可用于直接访问应用能力：

```typescript
// 假定已创建 testApp，并在 finally/teardown 关闭
// 访问配置
console.log(testApp.app.config.port);

// 访问服务
const user = await testApp.app.services.user.findById("1");

// 访问日志
testApp.app.logger.info("测试中");
```

### `request`

HTTP 请求模拟器，类似 `supertest` 风格的 API。详见 [TestRequest](#testrequest)。

### `close()`

关闭测试应用，触发 `onClose` 钩子、清理资源。

```typescript
close(): Promise<void>;
```

:::warning
**务必在 `afterEach` 或 `afterAll` 中调用 `close()`**，否则会导致资源泄漏（数据库连接、定时器等）和测试进程无法退出。
:::

```typescript
import { afterEach } from "vitest";

import type { TestApp } from "vextjs/testing";

let testApp: TestApp | undefined;

afterEach(async () => {
  await testApp?.close();
  testApp = undefined;
});
```

close 会等待应用 shutdown；默认总预算 1 秒，而不是每个 hook 各 1 秒。重复关闭成功完成的实例不会重复执行资源清理。close 不重置所有进程级模块缓存，也不自动删除外部测试数据。

---

## TestRequest

HTTP 请求模拟器，提供类似 `supertest` 风格的链式 API。

```typescript
interface TestRequest {
  get(path: string): TestRequestBuilder;
  post(path: string): TestRequestBuilder;
  put(path: string): TestRequestBuilder;
  patch(path: string): TestRequestBuilder;
  delete(path: string): TestRequestBuilder;
  options(path: string): TestRequestBuilder;
  head(path: string): TestRequestBuilder;
}
```

### 支持的 HTTP 方法

| 方法                    | 说明              |
| ----------------------- | ----------------- |
| `request.get(path)`     | 发送 GET 请求     |
| `request.post(path)`    | 发送 POST 请求    |
| `request.put(path)`     | 发送 PUT 请求     |
| `request.patch(path)`   | 发送 PATCH 请求   |
| `request.delete(path)`  | 发送 DELETE 请求  |
| `request.options(path)` | 发送 OPTIONS 请求 |
| `request.head(path)`    | 发送 HEAD 请求    |

每个方法返回 `TestRequestBuilder`，支持链式配置后通过 `await` 执行请求。

:::note HEAD 响应
`request.head(path)` 遵守 HTTP HEAD 语义。响应状态码和响应头会保留，但即使路由处理器写入响应体，`TestResponse.text` 和 `TestResponse.body` 也为空。需要断言响应体时，请使用对应的 `GET` 路由。
:::

### 基本用法

```typescript
// GET 请求
const res1 = await testApp.request.get("/users/list");

// POST 请求
const res2 = await testApp.request.post("/users").send({
  name: "Alice",
  email: "alice@example.com",
});

// PUT 请求
const res3 = await testApp.request.put("/users/1").send({
  name: "Alice Updated",
});

// DELETE 请求
const res4 = await testApp.request.delete("/users/1");

// OPTIONS 请求；真正预检还要提供 Origin 与 Access-Control-Request-Method
const res5 = await testApp.request.options("/users");
```

---

## TestRequestBuilder

链式请求构造器，支持设置请求头、查询参数、请求体等，最终通过 `await` 或 `.then()` 执行请求。

```typescript
interface TestRequestBuilder extends PromiseLike<TestResponse> {
  set(key: string, value: string): this;
  headers(headers: Record<string, string>): this;
  query(params: Record<string, string | number | boolean>): this;
  send(body: unknown): this;
  type(contentType: string): this;
}
```

:::tip
`TestRequestBuilder` 实现了 `PromiseLike` 接口，因此可以直接使用 `await` 执行请求，无需调用额外的 `.execute()` 方法。每次 await/then 都执行一次新请求，同一 builder 没有 Promise 结果缓存；也不提供 Promise 的完整 catch/finally 方法集合。
:::

---

### `set(key, value)`

设置单个请求头，名称转小写；同名再次设置覆盖旧值。

```typescript
set(key: string, value: string): this;
```

```typescript
const res = await testApp.request
  .get("/profile")
  .set("Authorization", "Bearer eyJ...")
  .set("Accept-Language", "zh-CN");

expect(res.status).toBe(200);
```

---

### `headers(headers)`

设置多个请求头（对象形式）。

```typescript
headers(headers: Record<string, string>): this;
```

```typescript
const res = await testApp.request.get("/profile").headers({
  Authorization: "Bearer eyJ...",
  "Accept-Language": "zh-CN",
  "X-Custom-Header": "custom-value",
});
```

:::tip
`set()` 和 `headers()` 可以混合使用，后设置的值会覆盖先设置的同名请求头。
:::

---

### `query(params)`

设置 URL 查询参数。

```typescript
query(params: Record<string, string | number | boolean>): this;
```

参数值会自动转换为字符串并 URL 编码。

```typescript
const res = await testApp.request
  .get("/users/list")
  .query({ page: 1, limit: 10, active: true });
// 等价于 GET /users/list?page=1&limit=10&active=true

expect(res.status).toBe(200);
expect(res.body.data).toHaveLength(10);
```

多次调用 `query()` **替换**前一次对象：

```typescript
const res = await testApp.request
  .get("/search")
  .query({ keyword: "hello" })
  .query({ page: 1 });
// 等价于 GET /search?page=1；keyword 已被替换
```

---

已有 path 查询串保留，新 query 对象以 `&` 追加；已有同名 key 可能重复，最终解析按应用规则。类型不支持数组，需自己编码进 path；不能假设重复调用 query 会生成多值。

### `send(body)`

设置或替换请求体。字符串原样发送，其余非 undefined 值执行 JSON.stringify；未手动给 Content-Type 时默认 application/json。Buffer、Stream、FormData 不会自动编码为文件上传，应用需使用真实 HTTP 客户端测试这些传输。

```typescript
send(body: unknown): this;
```

```typescript
// JSON 对象
const res = await testApp.request
  .post("/users")
  .send({ name: "Alice", email: "alice@example.com" });

expect(res.status).toBe(201);
expect(res.body.data.name).toBe("Alice");
```

```typescript
// 嵌套对象
const res = await testApp.request.post("/orders").send({
  items: [
    { productId: "p1", quantity: 2 },
    { productId: "p2", quantity: 1 },
  ],
  shippingAddress: {
    city: "北京",
    street: "朝阳区xxx路",
  },
});
```

```typescript
// 字符串（直接发送，不做 JSON 序列化）
const res = await testApp.request
  .post("/webhook")
  .type("text/plain")
  .send("raw text body");
```

---

### `type(contentType)`

设置 `Content-Type` 请求头。

```typescript
type(contentType: string): this;
```

```typescript
// 发送 form-urlencoded
const formRes = await testApp.request
  .post("/login")
  .type("application/x-www-form-urlencoded")
  .send("username=alice&password=secret");

// 发送 XML
const xmlRes = await testApp.request
  .post("/xml-endpoint")
  .type("application/xml")
  .send("<user><name>Alice</name></user>");
```

:::tip
`send()` 会自动设置 `Content-Type: application/json`（如果尚未设置）。`type()` 在 send 前后都可调用，执行请求时其值优先于 set/headers 设置的 Content-Type。若 send 已产生默认 application/json，再用 set 修改 Content-Type 也不会覆盖这个独立的 type 值；此时应使用 type。Content-Type 只声明格式，不会把对象编码成 form-urlencoded/XML。
:::

---

### 链式组合

所有方法支持链式调用，最终通过 `await` 执行请求：

```typescript
const res = await testApp.request
  .post("/users")
  .set("Authorization", "Bearer eyJ...")
  .set("X-Request-Id", "test-req-001")
  .query({ notify: "true" })
  .type("application/json")
  .send({
    name: "Alice",
    email: "alice@example.com",
    role: "admin",
  });

expect(res.status).toBe(201);
expect(res.body.code).toBe(0);
expect(res.body.data.name).toBe("Alice");
expect(res.headers["x-request-id"]).toBe("test-req-001");
```

---

## TestResponse

模拟 HTTP 响应对象，包含状态码、响应头和解析后的响应体。

```typescript
interface TestResponse {
  status: number;
  headers: Record<string, string | string[]>;
  cookies: string[];
  header(name: string): string | undefined;
  headerValues(name: string): string[];
  body: any;
  text: string;
}
```

### `status`

HTTP 状态码。

```typescript
status: number;
```

```typescript
const res = await testApp.request.get("/users/list");
expect(res.status).toBe(200);

const res2 = await testApp.request.get("/users/nonexistent");
expect(res2.status).toBe(404);

const res3 = await testApp.request
  .post("/users")
  .send({ name: "Alice", email: "alice@example.com" });
expect(res3.status).toBe(201);
```

---

### `headers`

响应头对象，所有 key 为小写。

```typescript
headers: Record<string, string | string[]>;
```

```typescript
const res = await testApp.request.get("/users/list");

// 检查 Content-Type
expect(res.header("content-type")).toContain("application/json");

// 检查自定义响应头
expect(res.headers["x-request-id"]).toBeDefined();

// 若要检查 CORS，请启用它并发送实际允许的 Origin，核对期望头值。
```

`Set-Cookie` 多值会保留，helper 不把它们按逗号拆分。以下“2个cookie”断言要求路由实际设置两个 Cookie；优先使用 `res.cookies` 或 `res.headerValues("set-cookie")`：

```typescript
expect(res.cookies).toHaveLength(2);
expect(res.headerValues("set-cookie")).toEqual(res.cookies);
expect(res.header("content-type")).toContain("application/json");
```

---

### `cookies` / `header(name)` / `headerValues(name)`

| 成员                                | 返回值                               | 缺失时      |
| ----------------------------------- | ------------------------------------ | ----------- |
| `cookies: string[]`                 | Set-Cookie 的全部值                  | `[]`        |
| `header(name): string \| undefined` | 指定响应头第一个值；名称不区分大小写 | `undefined` |
| `headerValues(name): string[]`      | 指定响应头的全部值，单值也转为数组   | `[]`        |

读取 helpers 不自动替你保存会话。需要延续 Cookie 时，将相关 Set-Cookie 的 name=value 部分作为后续 Cookie 请求头发送，保留各测试会话隔离。

### `body`

自动解析的 JSON 响应体。当响应 Content-Type 包含 `application/json` 或 `+json` 时尝试 JSON.parse（结果也可能是原始类型或 null）；其他类型及解析失败时，`body` 保留与 `text` 相同的字符串，不是 undefined。HEAD / 204 空正文通常为 `""`。

```typescript
body: any;
```

```typescript
const res = await testApp.request.get("/users/list");

// 出口包装格式
expect(res.body).toEqual({
  code: 0,
  data: expect.any(Array),
  requestId: expect.any(String),
});

// 直接访问业务数据
expect(res.body.data).toHaveLength(2);
expect(res.body.data[0].name).toBe("Alice");
```

**错误响应**（假定对应 handler 调用 `app.throw(404, "用户不存在")`）：

```typescript
const res = await testApp.request.get("/users/nonexistent-id");

expect(res.body).toEqual({
  code: 404,
  message: "用户不存在",
  requestId: expect.any(String),
});
```

**带业务错误码**（假定业务显式抛出 code=10001、message="邮箱已注册"；不是测试工具自动添加）：

```typescript
const res = await testApp.request.post("/users").send({
  email: "existing@example.com",
});

expect(res.body.code).toBe(10001);
expect(res.body.message).toBe("邮箱已注册");
```

---

### `text`

原始响应文本。对于 JSON 响应，`text` 是 JSON 字符串；对于文本响应，`text` 是原始文本内容。

```typescript
text: string;
```

```typescript
// JSON 响应的原始文本
const res = await testApp.request.get("/users/list");
console.log(res.text);
// '{"code":0,"data":[...],"requestId":"..."}'

// 文本响应：前置为 /plain 的 handler 调用 res.text("OK")
const res2 = await testApp.request.get("/plain");
expect(res2.text).toBe("OK");
```

---

## createTestJobRunner

```typescript
function createTestJobRunner(
  options: CreateTestJobRunnerOptions,
): Promise<TestJobRunner>;

interface CreateTestJobRunnerOptions extends Omit<
  CreateTestAppOptions,
  "routes"
> {
  jobs: Record<string, VextJobDefinition> | VextJobDefinition[];
}

interface TestJobRunner {
  app: VextApp;
  registry: VextJobRegistry;
  run(jobName: string, options?: VextJobRunOptions): Promise<VextJobRunResult>;
  close(): Promise<void>;
}
```

| 成员/规则          | 行为                                                                       |
| ------------------ | -------------------------------------------------------------------------- |
| `jobs`             | 必填，使用传入定义；不扫描 src/jobs                                        |
| 名称               | 对象优先 definition.name，再用对象 key；数组无 name 时用 job1/job2…        |
| 重名               | 创建 registry 时抛出重复名称错误                                           |
| 其他选项           | 沿用 CreateTestAppOptions，但强制 routes=false；Service/插件仍有相同副作用 |
| `app` / `registry` | 测试 app 和所注册任务；registry 提供 list/get/has/toJSON                   |
| `run()`            | 执行任务、校验 payload、应用重试和超时；不是启动 scheduler/worker          |
| `close()`          | 关闭测试 app；调用者应先等待在途 run 结束并处理取消                        |

`run` options 包含 payload、signal、runId、trigger、scheduledAt、idempotencyKey；结果包含 jobName、runId、status、attempts、durationMs 及可选 result/error。status 为 success/failed/cancelled/timeout。应检查结果状态；未知任务等错误仍可能直接 reject。取消/超时通过 AbortSignal 协作，不强行中断忽略 signal 的 handler；close 也不是取消所有在途任务的快捷方式。具体签名与边界见 [Jobs API](/zh/api/jobs#runjobapp-registry-name-options)。

下面可另存为 `test/job-api.mjs` 后用 Node 执行：

```javascript
// test/job-api.mjs
import assert from "node:assert/strict";
import { defineJob } from "vextjs";
import { createTestJobRunner } from "vextjs/testing";

const runner = await createTestJobRunner({
  services: false,
  middlewares: false,
  config: { adapter: "native" },
  jobs: { ping: defineJob({ handler: () => ({ ok: true }) }) },
});
try {
  const result = await runner.run("ping");
  assert.equal(result.status, "success");
  assert.deepEqual(result.result, { ok: true });
} finally {
  await runner.close();
}
```

此 helper 不创建真实调度进程、不写持久运行记录、不验证 Store 租约。调度、分布式领取和故障恢复按 [Jobs 指南](/zh/guide/jobs)运行独立验证。

## 使用模式

| 目的                               | 配置与断言要点                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| 真实路由/Service 组合              | 保留相应扫描，提供真实依赖；不是完整生产 bootstrap                                       |
| Mock Service                       | services=false，再提供满足业务接口的 mock；断言调用参数与结果                            |
| 认证/中间件                        | 加入 config.middlewares 白名单与路由引用；分别验证合法、缺失、错误凭据                   |
| 不同 adapter                       | config.adapter 选择已安装的适配器；Koa 还需 router peer，见[适配器](/zh/guide/adapters)  |
| 自定义插件                         | setupPlugins 注入真实满足契约的对象，用 onClose 关闭资源；Map mock 不代表 Redis 集成通过 |
| 业务/校验/内部错误                 | 明确触发路径、HTTP 状态、code、message、errors；hideInternalErrors 与 Accept 明确设置    |
| response.wrap                      | 同一路由分别以 wrap=true/false 创建独立应用；错误响应不因此变为成功包装                  |
| Session/Cookie                     | 从 cookies 提取所需 name=value，下一请求显式设置 Cookie；没有自动 Cookie jar             |
| 日志、限流、CSRF、Security Headers | 测试默认关闭的能力须显式启用，再验证正负请求与响应头                                     |

可运行的 CRUD、中间件、Mock、Service 单元测试见[测试指南实战](/zh/guide/testing#实战示例)。适配器传输、SSE、WebSocket、上传、socket 断开和真实 TLS 需要独立网络验证。

## 最佳实践

- 创建成功的 app 放在 finally 或 afterEach/afterAll 中关闭；类型声明使用 `TestApp | undefined` 以处理创建失败。
- 有状态测试每次建立独立数据；只读用例可以复用实例，但共享 rootDir 的模块加载应串行。
- mock 用真实公开接口约束，普通 Error 的合法 status/statusCode 也可被归一化读取；业务 code/类型身份应使用 HttpError 或 app.throw。
- 明确断言目标分支；只写“状态不是401”可能把 500 错认作通过。测试描述写清输入条件和预期结果。
- 对生产配置、preload、DB、前端及 build/start 使用[真实 CLI 验证](/zh/guide/testing#4-用真实-cli-补齐生产路径)。

## 常见问题

| 现象                       | 核对方向                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| 路由返回404                | rootDir/src/routes是否存在、是否关闭扫描、文件前缀是否重复；helper不自动提供health        |
| Unknown file extension .ts | 路由原生import的TS加载前置；Service可编译不意味着路由也可                                 |
| VEXT_OWNER_BUSY            | 同一/父子rootDir并发加载；串行或独立夹具                                                  |
| mock前真实依赖先连接       | services仍为默认true；先加载后覆盖                                                        |
| 数据库/项目配置没生效      | helper不加载项目配置/provider/内置DB；显式提供依赖或使用真实CLI                           |
| query参数“丢失”            | 多次query替换；一次提供完整参数对象                                                       |
| 文本body不是undefined      | 非JSON与解析失败保留字符串；HEAD/204为空字符串                                            |
| 用例挂起                   | 是否忘记await/close、handler是否发送响应、外部资源是否关闭；builder没有自己的网络请求超时 |
| 内存请求成功，线上失败     | 真实端口/代理/上传/长连接/配置/前端不在该结果覆盖范围                                     |

---

## 类型导入

```typescript
// 运行时值
import { createTestApp } from "vextjs/testing";

// 类型（从主入口导入）
import type {
  CreateTestAppOptions,
  TestApp,
  TestRequest,
  TestRequestBuilder,
  TestResponse,
} from "vextjs";
```

:::tip
测试工具通过 `vextjs/testing` 子路径导入（运行时值），类型可从 `vextjs` 主入口导入。`TestResponseHeaderValue`、`CreateTestJobRunnerOptions`、`TestJobRunner` 则从 `vextjs/testing` 导入。不要从根入口导入 createTestApp/createTestJobRunner 运行时值。
:::
