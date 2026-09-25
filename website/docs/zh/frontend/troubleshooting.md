---
role: troubleshooting
---

# 排错

先记录发生在dev还是生产、当前URL/状态码/Content-Type、浏览器控制台与服务端错误，以及所用构建版本。逐项修正后在同一环境复验；只刷新浏览器不能证明生产资源与服务端manifest已经一致。下方代码是对应位置的诊断片段，假定相关页面、服务和数据已经存在。

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

同时确认 `frontend.enabled`、实际配置的页面根与扩展名；默认目录之外不能仅按文件名猜page id。页面存在也不会自动创建URL，需要后端路由调用 `res.render()`。

**复验：** 重新dev/build，在实际路由URL请求HTML，确认返回预期页面且日志不再报页面查找失败；分别检查“HTTP路由404”和“已进入handler但render找不到page”，二者修复位置不同。详见[页面与渲染](/zh/frontend/pages-and-rendering)。

## 服务端代码进入浏览器 bundle

如果构建提示页面跨越了 server/client 边界，把服务端工作移回 route handler。

根据错误输出的import链追到源头，检查 `src/routes/**`、`src/services/**`、`src/config/**`、`node:*` 和 `*.server.*`。把文件改名为shared不会消除服务端依赖。

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

**复验：** 重新构建确认边界检查通过；检查浏览器实际加载的资源，并验证页面仍能通过route传入数据。不要只删除报错import而遗漏原页面数据需求。

## API 请求收到 HTML

API 请求设置 `Accept: application/json`：

```ts
fetch("/api/profile", {
  headers: { accept: "application/json" },
});
```

如果使用了 `spaFallback.scopes[]`，把 API 前缀加入 `exclude`，避免 shell 页面接管 API URL。

这里的Accept用于避免未匹配路径被HTML fallback接管，不能把一个显式返回HTML的handler自动变成JSON。检查真实API路由是否注册、代理是否改写路径，以及全局和scope的exclude；泛化的 `*/*` 仍可能接受HTML。

**复验：** 用 `Accept: application/json` 请求实际API和一个不存在的API路径，确认Content-Type及状态码符合接口合同；再用 `Accept: text/html` 访问SPA scope内有效路径，确认修复没有破坏页面回退。配置说明见[CSR与SPA回退](/zh/frontend/csr-and-spa-fallback)。

## Layout Data 缺失

通过第三个 render 参数传递 layout data：

```ts
res.render("admin/dashboard", props, {
  layoutData: { admin: { menu } },
});
```

不要在 layout 组件里直接 import services。

检查layout是否在当前页面的layout chain中，render选项是否设置 `layout: false` 或选择了其他layout。`layoutData` 的键按实际layout id或目录解析，不是任意组件名。

**复验：** 直接打开页面和通过客户端导航进入页面各验证一次，确认对应layout收到数据且公共layout状态符合预期。详见[Layout与组件](/zh/frontend/layouts-and-components)。

## Hydration Mismatch

浏览器第一次 render 要使用和 SSR 一样的输入：

- `props`
- `layoutData`
- `locale`
- 初始 `messages`

避免在服务端和浏览器产生不同输出的时间戳、随机值、浏览器状态或语言判断。

同时核对服务端与浏览器资源是否来自同一次构建；路由 `frontend.hydration: "none"` 不执行Vext hydration，不能用它“修复”需要浏览器交互的页面。

**复验：** 清理该页面的过期缓存后直接访问，再执行导航和交互，确认控制台无新的hydration错误、服务端数据与初次客户端渲染一致。诊断流程见[Hydration验证](/zh/frontend/hydration-validation)。

## 静态资源 404

确认引用来源：

| 文件                           | 引用方式                                                     |
| ------------------------------ | ------------------------------------------------------------ |
| `public/logo.png`              | 默认publicPath下为 `/logo.png`；自定义基路径时按实际挂载地址 |
| `src/frontend/assets/logo.png` | `import logoUrl from "@assets/logo.png"`                     |

如果生产 CDN URL 错误，检查 `frontend.deploy.assetBaseUrl`、`publicPath` 和 `deploy-manifest.json`。

**复验：** 从生成HTML中复制真实资源URL，分别请求JS/CSS/图片并检查200、正确Content-Type和文件内容；如果配置SRI，同时确认完整性信息对应同一份资源。自定义outDir时检查实际输出目录，避免读取旧dist。详见[静态资源与CDN](/zh/frontend/static-assets-and-cdn)。

## 首屏 JS 过大

检查实际前端输出中的 `size-report.json`，默认是 `dist/client/size-report.json`，并区分入口初始资源与后续按需资源。

常见修复：

- 保持 `frontend.i18n.clientLoad="current"`
- 拆分大型共享组件
- 不要把 admin-only UI import 到根 layout
- React external/CDN 保持 opt-in，并准备 version-lock 与 SRI 策略
- 先检查 route initial assets，再提高预算

**复验：** 用相同构建参数比较该路由的初始资源与压缩体积，再在浏览器Network检查首次导航是否确实减少资源；预算不超限不等于真实网络或交互性能已经达标。见[性能预算](/zh/frontend/performance-budgets)。

## Fast Refresh 退回整页刷新

模块不是 refresh-safe 时，Fast Refresh 会退回整页刷新。

检查：

- `frontend.dev.fastRefresh` 是否开启。
- 组件文件是否 import 了服务端模块。
- 文件是否只清晰导出 React 组件。
- 是否修改了 `_document.html` 或 runtime 关键文件。

整页刷新可能是为保持正确性采取的回退，不能只为保留组件状态而绕过它。

**复验：** 先只改一个普通组件的文本或样式，再单独修改document，观察刷新类型及控制台诊断是否与改动匹配。详见[Fast Refresh](/zh/frontend/fast-refresh)。

## 当前边界

当前默认路径：

- React 19 SSR + hydration
- esbuild 前端构建
- route handler `res.render()`
- Vext JSCSS / CSS Modules / 静态资源
- route-specific modulepreload
- 压缩体积预算
- 兼容页面协议下的客户端导航与公共layout持久化，不兼容时退回document导航
- 本地Image/defineFont媒体处理；远程图片仍需显式loader，框架不自动下载远程字体

已提供但需要显式开启：

- 使用 `frontend.render.streaming: "auto"` 启用 Streaming SSR；默认仍为 `"buffered"`。

当前尚未作为已实现端到端能力提供：

- React Server Components
- Server Functions 与 Server Actions
- partial prerendering（PPR）
- Selective/Partial Hydration、Islands

不要把已支持但需要配置的功能误判为路线图，也不要把Streaming SSR当成RSC。完整边界与规则见[边界与路线图](/zh/frontend/boundaries-and-roadmap)。
