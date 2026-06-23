# 数据与 API 调用

## 目录导航

- [首屏数据](#首屏数据)
- [render 数据的 route cache](#render-数据的-route-cache)
- [Layout Data](#layout-data)
- [客户端 API 调用](#客户端-api-调用)
- [生成的契约产物](#生成的契约产物)
- [HTML 请求与 JSON 请求](#html-请求与-json-请求)

## 首屏数据

Vext 默认模型是服务端准备首屏数据。在 route handler 或 service 中取数，然后把 JSON-safe 数据传给页面。

```ts
app.get("/orders/:id", {}, async (req, res) => {
  const order = await app.services.orders.findById(req.params.id);

  if (!order) {
    return res.renderError(404, "error/order-not-found", {
      props: { id: req.params.id },
    });
  }

  res.render("orders/detail", { order }, {
    head: { title: `Order ${order.no}` },
  });
});
```

浏览器 bundle 只接收序列化 props，不接收 service 函数。

## render 数据的 route cache

`RouteOptions.cache` 同样适用于 render 响应。JSON route 缓存 JSON body；`res.render()` 缓存 render payload。

```ts
app.get(
  "/dashboard",
  { cache: { ttl: 30_000, partitionKey: (req) => req.user?.id ?? "guest" } },
  async (req, res) => {
    const stats = await app.services.dashboard.stats(req.user?.id);
    res.render("dashboard", { stats });
  },
);
```

命中缓存后，Vext 会用当前前端 renderer 根据缓存 payload 重新渲染 HTML。这样既避免重复 service 调用，又能继续使用当前 manifest。

## Layout Data

菜单、权限、面包屑、admin shell 这类 layout 数据通过 `layoutData` 传递。

```ts
res.render("admin/dashboard", { stats }, {
  layoutData: {
    root: { user },
    admin: { menu, permissions },
  },
});
```

`layoutData` 必须是 JSON-safe 数据。数据库访问和权限判断仍留在 `src/routes/**` 或 `src/services/**`。

## 客户端 API 调用

hydration 之后，组件可以用普通 `fetch` 调用 Vext API route。

```tsx
async function saveProfile(input: ProfileInput) {
  const res = await fetch("/api/profile", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    throw new Error(`Save failed: ${res.status}`);
  }

  return res.json();
}
```

API 请求请带 `Accept: application/json`。这样可以避免客户端请求被当成 HTML 导航，也能让错误响应保持 JSON 形态。

## 生成的契约产物

启用 `frontend.apiClient` 后，Vext 会在前端输出目录旁写入：

```text
dist/client/
  client-contract.json
  api.generated.ts
```

它们适合 tooling、类型探针或高级外部前端集成。普通 Vext 页面首屏数据不需要手写 route contract，因为 `res.render()` 已经从 route handler 把 props 传给页面。

前端公开入口也导出：

```ts
import {
  createVextApiClient,
  VextApiError,
  isVextApiError,
} from "vextjs/frontend";
```

只有需要 generated/typed client 边界或外部前端 adapter 时才用这个 helper。普通 Vext 页面可以直接用 `fetch` 调自己的 API route。

## HTML 请求与 JSON 请求

Vext 保持 API 语义优先于 frontend fallback 语义。

| 请求 | 预期结果 |
|------|----------|
| `Accept: text/html`，route 调用 `res.render()` | SSR HTML |
| `Accept: application/json`，API route | JSON |
| API route 抛出 `app.throw(...)` | JSON 错误 |
| HTML route 调用 `res.renderError(...)` | HTML 错误页面 |
| 静态资源缺失 | 静态 404，不进入 HTML render |
| HTML 导航命中 `spaFallback.scopes[]` | 该 client-router 子应用的 shell document |

如果 API 调用拿到了 HTML，优先检查 `Accept` header 和 `frontend.spaFallback.scopes[].exclude`。

