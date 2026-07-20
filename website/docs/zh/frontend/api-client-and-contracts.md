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
api.generated.ts
```

这些产物适合：

- 外部前端适配器
- 类型探针
- hydration 后的客户端 API 调用
- 文档或工具链

## 契约稳定性与 Schema

`client-contract.json` 和 `api.generated.ts` 对相同 route manifest 会稳定生成。`generatedAt` 字段是稳定标记，便于在 CI 中比较生成产物。

契约 schema reference 当前会输出为 `unknown`，因为 route manifest 还没有携带路由校验或响应 schema metadata。在 manifest 增加 schema metadata 前，请把该契约用于 route method、path、operation id、summary 和 tags。

## 公开入口

前端公开入口暴露契约 helper：

```ts
import { createVextApiClient } from "vextjs/frontend";
```

只有需要 typed client 边界时才使用。简单页面不要为了读取首屏数据而引入它们。

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
