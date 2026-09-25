# 路由与页面

Vext 的 URL 入口仍然属于 `src/routes/**`。页面文件是渲染目标，不是自动 URL 定义。

本页在[全栈快速开始](/zh/frontend/getting-started)生成的 TypeScript 项目上添加用户详情页，已有首页可以保留。你将连接 URL、路由处理器、Page ID 与页面 props。

## 心智模型

```text
request URL
  -> src/routes/** handler
  -> app.services / 业务数据
  -> res.render(page, props, options)
  -> src/frontend/pages/** 页面组件
  -> HTML（由 SSR/CSR 配置决定）及可选的浏览器 hydration
```

业务服务、数据库与权限检查留在路由处理器中；传给页面的数据需要单独筛选，不能把服务端对象或敏感字段直接放进 props。

## Page ID

普通页面的 Page ID 相对于 `frontend.pages.dir`，去掉扩展名。默认目录下的例子：

| 文件                                     | Page id           |
| ---------------------------------------- | ----------------- |
| `src/frontend/pages/index.tsx`           | `index`           |
| `src/frontend/pages/about.tsx`           | `about`           |
| `src/frontend/pages/admin/dashboard.tsx` | `admin/dashboard` |
| `src/frontend/pages/error/default.tsx`   | `error/default`   |

布局与 `_document` 不作为普通页面注册。错误页单独扫描，并使用 `error/` 前缀；自定义错误页目录时也保留该前缀。错误响应的选择规则见[错误页与 Document](/zh/frontend/errors-and-document)。

## 在 Route 中渲染

先创建页面文件：

```tsx
// src/frontend/pages/users/detail.tsx
export default function UserDetail(props: {
  user: { id: string; name: string };
}) {
  return (
    <main>
      User {props.user.id}: {props.user.name}
    </main>
  );
}
```

再创建路由文件。`users.ts` 提供 `/users` 文件前缀，处理器只声明 `/:id`，最终 URL 是 `/users/1`。不要在处理器中再次写 `/users/:id`。

```ts
// src/routes/users.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/:id", { validate: { param: { id: "string" } } }, (req, res) => {
    const user = { id: "1", name: "Ada" };
    if (req.valid("param").id !== user.id) app.throw(404, "User not found");
    res.render(
      "users/detail",
      { user },
      {
        head: {
          title: `${user.name} - Users`,
        },
      },
    );
  });
});
```

示例使用内存数据，不需要额外的 service。实际项目可在处理器中查询服务并检查访问权限，再显式传入页面需要的 props。路由参数不会自动成为页面 props。

`res.render(page, props?, options?)` 三个参数含义：

| 参数      | 含义                                                          |
| --------- | ------------------------------------------------------------- |
| `page`    | 注册页面的 Page ID，不含扩展名。                              |
| `props`   | 服务端准备的 JSON-safe 数据，会在 hydration 中复用。          |
| `options` | status、head、layoutData、locale/messages、nonce 与渲染行为。 |

props 应使用 JSON 可序列化的数据；函数、循环引用与服务实例不适合传给浏览器。完整选项与逐次渲染边界见[Context 与 Response API](/zh/api/context)。

## Route 文件保持服务端属性

下面是处理器内的职责示意，假设项目已经注册 `metrics` service 和 `dashboard` 页面，不是可独立运行的路由文件：

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

## 验证页面

在项目根目录执行 `npm run build`，通过后执行 `npm start -- --port 3000`。如开发服务正在运行，先停止它以免端口冲突。

- 访问 `/users/1`：返回成功页面，显示 `User 1: Ada`，页面标题为 `Ada - Users`。
- 访问 `/users/2`：返回 404；具体错误正文取决于项目的错误处理与错误页配置。
- `/users/users/1` 不应匹配这条路由。

找不到页面时，检查 `res.render` 的 Page ID 与页面文件相对路径；构建无法投影路由时，检查是否使用静态可分析的 `defineRoutes` 声明；检测到服务端依赖泄漏时，把数据访问移回路由处理器。验证结束后停止服务。这里验证页面路由与输出，交互恢复另按 [Hydration 验证](/zh/frontend/hydration-validation)执行。

## 相关阅读

- [SSR](/zh/frontend/ssr)
- [Hydration](/zh/frontend/hydration)
- [Render Data 与缓存](/zh/frontend/render-data-and-cache)
- [CSR 与 SPA Fallback](/zh/frontend/csr-and-spa-fallback)
