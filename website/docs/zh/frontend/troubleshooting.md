# 排错

## 目录导航

- [Page Not Found](#page-not-found)
- [服务端代码进入浏览器 bundle](#服务端代码进入浏览器-bundle)
- [API 请求收到 HTML](#api-请求收到-html)
- [Layout Data 缺失](#layout-data-缺失)
- [Hydration Mismatch](#hydration-mismatch)
- [静态资源 404](#静态资源-404)
- [首屏 JS 过大](#首屏-js-过大)
- [Fast Refresh 退回整页刷新](#fast-refresh-退回整页刷新)
- [当前边界](#当前边界)

## Page Not Found

如果 `res.render("dashboard")` 找不到页面，检查：

- `src/frontend/pages/dashboard.tsx` 是否存在。
- 嵌套页面是否使用完整 id，例如 `admin/dashboard`。
- 创建文件后 dev/build registry 是否已经重新生成。

## 服务端代码进入浏览器 bundle

如果构建提示页面跨越了 server/client 边界，把服务端工作移回 route handler。

错误：

```tsx
import { db } from "../../services/db";
```

正确：

```ts
app.get("/dashboard", {}, async (req, res) => {
  const data = await app.services.dashboard.load();
  res.render("dashboard", { data });
});
```

## API 请求收到 HTML

API 请求设置 `Accept: application/json`：

```ts
fetch("/api/profile", {
  headers: { accept: "application/json" },
});
```

如果使用了 `spaFallback.scopes[]`，把 API 前缀加入 `exclude`，避免 shell 页面接管 API URL。

## Layout Data 缺失

通过第三个 render 参数传递 layout data：

```ts
res.render("admin/dashboard", props, {
  layoutData: { admin: { menu } },
});
```

不要在 layout 组件里直接 import services。

## Hydration Mismatch

浏览器第一次 render 要使用和 SSR 一样的输入：

- `props`
- `layoutData`
- `locale`
- 初始 `messages`

避免在服务端和浏览器产生不同输出的时间戳、随机值、浏览器状态或语言判断。

## 静态资源 404

确认引用来源：

| 文件 | 引用方式 |
|------|----------|
| `public/logo.png` | `/logo.png` |
| `src/frontend/assets/logo.png` | `import logoUrl from "@assets/logo.png"` |

如果生产 CDN URL 错误，检查 `frontend.deploy.assetBaseUrl`、`publicPath` 和 `deploy-manifest.json`。

## 首屏 JS 过大

检查 `dist/client/size-report.json`。

常见修复：

- 保持 `frontend.i18n.clientLoad="current"`
- 拆分大型共享组件
- 不要把 admin-only UI import 到根 layout
- React external/CDN 保持 opt-in，并准备 version-lock 与 SRI 策略
- 先检查 route initial assets，再提高预算

## Fast Refresh 退回整页刷新

模块不是 refresh-safe 时，Fast Refresh 会退回整页刷新。

检查：

- `frontend.dev.fastRefresh` 是否开启。
- 组件文件是否 import 了服务端模块。
- 文件是否只清晰导出 React 组件。
- 是否修改了 `_document.html` 或 runtime 关键文件。

## 当前边界

当前默认路径：

- React 19 SSR + hydration
- esbuild 前端构建
- route handler `res.render()`
- Vext JSCSS / CSS Modules / 静态资源
- route-specific modulepreload
- 压缩体积预算

本阶段不作为默认能力：

- Vite
- React Server Components
- Server Actions
- Qwik/Astro 架构切换
- streaming SSR
- 持久客户端 layout 导航
- 内置图片/字体优化组件

