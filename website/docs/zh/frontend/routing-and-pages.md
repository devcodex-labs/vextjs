# 路由与页面

Vext 的 URL 入口仍然属于 `src/routes/**`。页面文件是渲染目标，不是自动 URL 定义。

## 心智模型

```text
request URL
  -> src/routes/** handler
  -> app.services / 业务数据
  -> res.render(page, props, options)
  -> src/frontend/pages/** 页面组件
  -> SSR HTML + 浏览器 hydration
```

这样可以让 service 访问留在服务端，让浏览器 graph 只包含前端文件。

## Page ID

page id 相对于 `src/frontend/pages/**`：

| 文件 | Page id |
|------|---------|
| `src/frontend/pages/index.tsx` | `index` |
| `src/frontend/pages/about.tsx` | `about` |
| `src/frontend/pages/admin/dashboard.tsx` | `admin/dashboard` |
| `src/frontend/pages/error/default.tsx` | `error/default` |

## 在 Route 中渲染

```ts
export default (app) => {
  app.get("/users/:id", {}, async (req, res) => {
    const user = await app.services.users.get(req.params.id);
    res.render("users/detail", { user }, {
      head: {
        title: `${user.name} - Users`,
      },
    });
  });
};
```

`res.render(page, props?, options?)` 三个参数含义：

| 参数 | 含义 |
|------|------|
| `page` | `src/frontend/pages/**` 下的 page id，不含扩展名。 |
| `props` | 服务端准备的 JSON-safe 数据，会在 hydration 中复用。 |
| `options` | status、head、layoutData、locale/messages、nonce 与渲染行为。 |

## Route 文件保持服务端属性

应该这样：

```ts
// src/routes/dashboard.ts
const metrics = await app.services.metrics.summary();
res.render("dashboard", { metrics });
```

不要这样：

```tsx
// src/frontend/pages/dashboard.tsx
import { db } from "../../services/db";
```

开启 `frontend.build.diagnostics.leakScan` 后，Vext 会报告 importer、import specifier、resolved path 和清晰修复建议。

## 相关阅读

- [SSR](/zh/frontend/ssr)
- [Hydration](/zh/frontend/hydration)
- [Render Data 与缓存](/zh/frontend/render-data-and-cache)
- [CSR 与 SPA Fallback](/zh/frontend/csr-and-spa-fallback)
