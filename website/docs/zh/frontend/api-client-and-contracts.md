# API Client 与契约

Vext 页面首屏数据不需要生成 API client。首屏数据应优先使用 route handler 和 `res.render()`。

## 主数据路径

```text
route handler -> app.services -> res.render(page, props)
```

该路径让 service 调用留在服务端，并输出带 hydration 数据的 SSR HTML。

## 生成产物

在[全栈项目](./getting-started)启用 `frontend.enabled` 后，`frontend.apiClient` 默认启用；显式设置 `false` 可关闭客户端契约文件输出。执行 `npm run build`，下列文件写到 `frontend.outDir`（生产默认 `dist/client`，开发默认 `.vext/client`）：

```text
client-contract.json
route-contract.json
api.generated.ts
```

这些产物适合：

- 外部前端适配器
- 类型探针
- hydration 后的客户端 API 调用
- 文档或工具链

它们是构建契约文件，不会自动作为公共静态文件提供，也不建立新的服务端路由。`api.generated.ts` 导出 `contract`、`VextGeneratedRouteTypes` 和 `api`。先生成再交给消费者编译；路由或 schema 改动后重新生成，避免消费旧契约。

### 从路由到调用

先在已有项目增加以下完整路由（`responses` 描述 `res.json()` 的业务 data，统一响应外壳由框架处理）：

```ts
// src/routes/api/greeting.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/",
    {
      validate: { query: { name: "string:1-40?" } },
      responses: {
        200: {
          schema: {
            type: "object",
            properties: { message: { type: "string" } },
            required: ["message"],
            additionalProperties: false,
          },
        },
      },
    },
    (req, res) => {
      const { name } = req.valid("query");
      res.json({ message: `Hello, ${name ?? "Vext"}!` });
    },
  );
});
```

执行 `npm run build` 后，在项目根创建独立消费者 `client-probe.ts`。这是 Node 端契约调用示例，不应导入到当前应用的 `src/frontend` 中形成“构建输出反向依赖源码”的循环；外部前端项目应把生成文件纳入自己的生成/同步步骤。

```ts
// client-probe.ts（项目根，先构建）
import { createVextApiClient, isVextApiError } from "vextjs/frontend";
import {
  contract,
  type VextGeneratedRouteTypes,
} from "./dist/client/api.generated.js";

const api = createVextApiClient<typeof contract, VextGeneratedRouteTypes>(
  contract,
  {
    baseUrl: "http://127.0.0.1:3000",
    headers: { Accept: "application/json" },
  },
);

try {
  const result = await api.GET("/api/greeting", { query: { name: "Vext" } });
  console.log(result.message);
} catch (error) {
  if (isVextApiError(error)) console.error(error.status, error.message);
  else throw error;
}
```

运行 `npm start -- --port 3000`，在另一终端使用模板已有的 TypeScript 编译并运行消费者：

```bash
npx tsc client-probe.ts --module NodeNext --moduleResolution NodeNext --target ES2022 --skipLibCheck
node client-probe.js
```

应输出 `Hello, Vext!`。将 `name` 改成 41 个字符并重新编译，应进入 HTTP 422 校验错误分支；结束后停止服务。这里 Node 必须提供绝对 `baseUrl`；浏览器可使用同源相对 URL。生产默认 outDir 被覆盖时同步调整导入路径。独立编译会在原目录产生 probe 与导入的生成模块的 JS 文件；这些文件不是新的公共资源入口。

## 契约稳定性与 Schema

`client-contract.json` 和 `api.generated.ts` 对相同 route manifest 会稳定生成。`generatedAt` 字段是稳定标记，便于在 CI 中比较生成产物。

运行时 route manifest 会把既有 `RouteOptions.validate` 的 `param`、`query`、`header`、`cookie`、`body` 字段，以及规范的 `RouteOptions.responses.<selector>.schema` 投影为 `VextSchemaIRV1`。同一份闭合响应 schema 同时驱动编译线上序列化、OpenAPI 与静态 build 索引。`api.generated.ts` 会将支持的 JSON Schema 基础类型、对象、数组、枚举、optional 与 nullable 字段生成 request 和成功 response 的 TypeScript 类型。仅文档的 `docs.responses.<selector>.schema` 仍作为兼容回退，但不会启用运行时字段投影。

缺少运行时或文档响应 schema 时，契约保持 `unknown`，并携带 HTTP 方法、路由路径、可用时的源文件和稳定 route ID 的 diagnostic；Vext 不会猜测 response 类型。精确状态 selector 优先于状态族（`2xx`），最后才使用 `default`；生成的成功类型会把所有带 schema 的 2xx 契约合成为 union。`204` 这类无 body 成功响应不会把另一个带 schema 的成功响应降级成 `unknown`。使用 `res.render()` 渲染的 HTML 页面会被归类为前端文档，不会产生 API response schema warning。`$ref` 会保留在契约中，但在具备 component-reference resolver 前，生成 TypeScript 仍为 `unknown`。cookie schema 只描述契约：浏览器 fetch 控制 cookie transport，生成 client 不提供可写 `Cookie` header。

## 公开入口

前端公开入口暴露契约 helper：

```ts
import { createVextApiClient } from "vextjs/frontend";
```

只有需要 typed client 边界时才使用。简单页面不要为了读取首屏数据而引入它们。

方法名为 `GET`、`POST`、`PUT`、`PATCH`、`DELETE`、`HEAD`、`OPTIONS`，或 `request(method, path, options)`。请求选项支持 `params`、`query`、`body`、`headers`、`signal`；数组 query 会重复同名参数，null/undefined 跳过。路径参数会编码，调用方必须提供所需 params，helper 不做 schema 校验；生成类型也不是运行时校验器。

### 返回值与错误

普通成功 JSON 若含 `code: 0` 和 `data`，helper 返回 `data`；其他 JSON/文本按实际响应返回。非 2xx 抛 `VextApiError`，包含 `status`、`code`、`details`、`rawBody` 和原始 `response`，用 `isVextApiError()` 判断；网络错误和 JSON 解析错误保留原错误。

生成客户端的 `HEAD()` 和 `request("HEAD", ...)` 返回 `null`，类型也为 `Promise<null>`。204/205 响应运行时返回 `null`；304 保留为 HTTP 错误，不因缺少 JSON 消息体变成解析错误。标为 application/json 的普通空 body 或非法 JSON 仍会抛出解析错误。除 HEAD 外，生成的成功类型不一定表达无 body 状态，调用多个成功状态的 API 时应同时处理实际的 null。

## 高级前端集成

`vextjs/frontend` 还公开了一小组高级集成 API，适用于 adapter、定制工具链或自定义浏览器启动，而不是普通应用页面的默认路径。

- `defineFrontendAdapter()` 是实现 `VextFrontendAdapter` 时使用的 identity helper；它不安装或启动适配器。当前配置解析仍使用内置 React，不能仅声明 adapter 就推定外部框架已接入，见[当前边界](./boundaries-and-roadmap#外部前端适配)。
- `VextBrowserRuntime` 与 `configureVextBrowserRuntime()` 驱动 Vext 生成的浏览器入口。普通应用应使用生成入口以及 `Link`、`Form` 和导航 hooks，不应手动创建 runtime。自定义启动必须为其环境拥有唯一的浏览器 runtime。

程序化上传 assets 见[构建与部署](./build-and-deploy#程序化上传集成)。

## 普通 Fetch 也可以

本页路由也可以用普通 fetch。以下为 hydration 后事件处理器内的片段，无需生成 API client：

```ts
const response = await fetch("/api/greeting?name=Vext", {
  headers: { Accept: "application/json" },
});
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const envelope = await response.json();
console.log(envelope.data.message);
```

普通 fetch 不自动解包响应。helper 本身也不默认设置 Accept，应像上面显式发送 `application/json`，避免未命中 API 的请求在 SPA fallback scope 内被当作 HTML 导航。认证、跨域凭据和重试策略需按应用需要配置；不要把生成的类型当作这些行为已经存在。

## 边界规则

生成 client artifacts 描述的是 HTTP 契约，不会让 `src/services/**` 变成浏览器安全模块。Service 仍然是服务端代码。
