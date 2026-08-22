# Render Data 与缓存

Render data 是服务端准备、用于生成 HTML 并支持 hydration 的 payload。

## 什么是 Render Data

对 `res.render()` 来说，render data 可以包含：

- `props`
- `options.layoutData`
- `options.messages`
- `options.locale`
- `options.head`
- status 和 page id

它应该是 JSON-safe，不包含数据库句柄、request 对象、密钥或函数。

## 复用 Route Cache

Vext 复用已有 route response cache 契约。JSON 响应缓存 JSON body；渲染页面缓存 render payload。

```ts
app.get("/reports", { cache: { ttl: 60_000 } }, async (req, res) => {
  const reports = await app.services.reports.list();
  res.render("reports/index", { reports });
});
```

命中缓存后，Vext 会用当前 frontend renderer 和 manifest 重新渲染 HTML。

## Layout Data

如果多个 layout 需要服务端数据，应在 route handler 或 service 中集中准备，再通过 `layoutData` 传入。

```ts
res.render(
  "admin/users",
  { users },
  {
    layoutData: {
      shell: await app.services.admin.shell(req.user.id),
      breadcrumbs: ["Admin", "Users"],
    },
  },
);
```

这可以避免 layout 组件暗中调用 services，也让 cache key 留在 route 边界。

## Cache Key

所有会改变 render payload 的值都应进入 cache key：

- path 和 query
- 当前用户或 tenant
- locale
- feature flag 或 experiment
- 数据版本

如果 HTML 随 locale 变化，response cache 与 CDN cache 都要按 locale vary。

## 不应该缓存什么

不要缓存包含一次性 token、密钥或不可复用用户状态的 render payload。这类 route 使用 `cache: false` 或非常短 TTL。
