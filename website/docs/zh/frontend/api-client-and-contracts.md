# API Client 与契约

Vext 页面首屏数据不需要生成 API client。首屏数据应优先使用 route handler 和 `res.render()`。

## 主数据路径

```text
route handler -> app.services -> res.render(page, props)
```

该路径让 service 调用留在服务端，并输出带 hydration 数据的 SSR HTML。

## 生成产物

开启 `frontend.apiClient` 后，Vext 可以生成：

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

## 契约稳定性与 Schema

`client-contract.json` 和 `api.generated.ts` 对相同 route manifest 会稳定生成。`generatedAt` 字段是稳定标记，便于在 CI 中比较生成产物。

运行时 route manifest 会把既有 `RouteOptions.validate` 的 `param`、`query`、`header`、`cookie`、`body` 字段，以及规范的 `RouteOptions.responses.<selector>.schema` 投影为 `VextSchemaIRV1`。同一份闭合响应 schema 同时驱动编译线上序列化、OpenAPI 与静态 build 索引。`api.generated.ts` 会将支持的 JSON Schema 基础类型、对象、数组、枚举、optional 与 nullable 字段生成 request 和成功 response 的 TypeScript 类型。仅文档的 `docs.responses.<selector>.schema` 仍作为兼容回退，但不会启用运行时字段投影。

缺少运行时或文档响应 schema 时，契约保持 `unknown`，并携带 HTTP 方法、路由路径、可用时的源文件和稳定 route ID 的 diagnostic；Vext 不会猜测 response 类型。精确状态 selector 优先于状态族（`2xx`），最后才使用 `default`；生成的成功类型会包含精确和状态族 2xx 契约。使用 `res.render()` 渲染的 HTML 页面会被归类为前端文档，不会产生 API response schema warning。`$ref` 会保留在契约中，但在具备 component-reference resolver 前，生成 TypeScript 仍为 `unknown`。cookie schema 只描述契约：浏览器 fetch 控制 cookie transport，生成 client 不提供可写 `Cookie` header。

## 公开入口

前端公开入口暴露契约 helper：

```ts
import { createVextApiClient } from "vextjs/frontend";
```

只有需要 typed client 边界时才使用。简单页面不要为了读取首屏数据而引入它们。

## 高级前端集成

`vextjs/frontend` 还公开了一小组高级集成 API，适用于 adapter、定制工具链或自定义浏览器启动，而不是普通应用页面的默认路径。

- `defineFrontendAdapter()` 是实现 `VextFrontendAdapter` 时使用的 identity helper。
- `VextBrowserRuntime` 与 `configureVextBrowserRuntime()` 驱动 Vext 生成的浏览器入口。普通应用应使用生成入口以及 `Link`、`Form` 和导航 hooks，不应手动创建 runtime。自定义启动必须为其环境拥有唯一的浏览器 runtime。

程序化上传 assets 见[构建与部署](./build-and-deploy#程序化上传集成)。

## 普通 Fetch 也可以

Hydration 后的小型交互可以直接使用：

```ts
await fetch("/api/preferences", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});
```

确保客户端请求发送正确 `Accept` header，避免在 SPA fallback scope 内被当作 HTML 导航。

## 边界规则

生成 client artifacts 描述的是 HTTP 契约，不会让 `src/services/**` 变成浏览器安全模块。Service 仍然是服务端代码。
