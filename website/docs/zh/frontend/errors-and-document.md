# 错误页与 Document

本页在已启用前端的[全栈项目](/zh/frontend/getting-started)中添加 HTML 错误页，并修改页面外层模板。路由异常、主动渲染错误页和未匹配请求是不同入口，需要分别验证。

## 目录导航

- [默认错误页](#默认错误页)
- [`renderError()`](#rendererror)
- [404 仲裁](#404-仲裁)
- [HTML Document](#html-document)
- [Head 与 CSP Nonce](#head-与-csp-nonce)
- [数据序列化](#数据序列化)

## 默认错误页

默认错误页放在：

```text
src/frontend/pages/error/
  default.tsx
  404.tsx
  500.tsx
```

错误页按“显式页面 → `frontend.errorPages.status[状态码]` → `error/状态码` → `frontend.errorPages.default` → `error/default`”选择第一个已注册页面；都不存在时使用框架内置错误文档。自定义错误页目录仍以 `error/` 作为 Page ID 前缀。

默认页面可以这样写：

```tsx
// src/frontend/pages/error/default.tsx
export default function ErrorPage(props: {
  error: { status: number; message: string; requestId?: string };
}) {
  return (
    <main>
      <h1>{props.error.status}</h1>
      <p>{props.error.message}</p>
      <small>{props.error.requestId}</small>
    </main>
  );
}
```

## `renderError()`

handler 需要主动返回 HTML 错误页面时使用 `res.renderError()`。

```ts
// src/routes/errors.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/missing", {}, (_req, res) => {
    res.renderError(404, { details: { resource: "user" }, layout: false });
  });
});
```

下面是处理器内的其他调用形式，`error` 是业务捕获的异常，各调用应按需选择，不能在一次响应中全部执行：

```ts
res.renderError(404);
res.renderError(404, { details: { id: "1" } });
res.renderError(404, "error/order-not-found");
res.renderError(error, "error/default", {
  props: { supportPath: "/help" },
});
```

页面 id 放第二个参数或 `options.page`。不要把 `renderError("error/404")` 当作合法第一参数。

第一参数中的字符串表示错误码。第二参数也兼容直接传 details，但包含 `page`、`message`、`props` 等选项键时会被解释为 options，因此推荐明确使用 `{ details: ... }`。状态从第一参数或当前响应状态推导，当前实现不会用 `options.status` 覆盖这个推导结果；指定 404 时直接传 `404`。页面接收归一化的 `props.error`，自定义 `options.props` 与它合并，不能覆盖框架生成的 error。

## 404 仲裁

Vext 不会把所有 404 都变成同一个 HTML 页面。输出取决于请求类型和 route 归属。

| 场景                                             | 结果                                            |
| ------------------------------------------------ | ----------------------------------------------- |
| 默认排除的 `/api` 路径，或不接受 HTML 的未知请求 | 进入普通 404 处理                               |
| 静态资源缺失                                     | 静态 404                                        |
| handler 调用 `res.renderError(404)`              | HTML 错误页                                     |
| HTML page id 缺失                                | page registry 诊断                              |
| HTML 导航命中 `spaFallback.scopes[]`             | 配置的 shell 页面                               |
| GET/HEAD 未知 HTML 导航，路径无扩展名且未被排除  | 尝试 HTML 404 错误页；渲染失败再交普通 404 处理 |

表格针对未匹配请求与默认排除规则。已匹配 handler 的异常不会仅因存在错误页文件就自动调用 `renderError`。SPA fallback 的排除配置会影响仲裁，覆盖默认 `exclude` 时应保留 API 和资源路径；详见 [CSR 与 SPA Fallback](/zh/frontend/csr-and-spa-fallback)。

## HTML Document

默认 document 文件是：

```text
src/frontend/pages/_document.html
```

使用 Vext 保留 token：

```html
<!doctype html>
<html lang="{vext.lang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    {vext.head} {vext.styles}
  </head>
  <body>
    {vext.root} {vext.data} {vext.entry}
  </body>
</html>
```

`{vext.root}` 生成 SSR/hydration 所需根节点；`{vext.data}` 生成数据节点；`{vext.entry}` 生成入口脚本；`{vext.styles}` 放构建样式，`{vext.head}` 放外部运行时标签。请求级 head 由渲染器写入 `</head>` 前。`{vext.app}`、`{vext.scripts}` 不属于支持的 token。保留每个必要节点一次，避免重复的 root/data/entry。

模板不会执行任意表达式。数据通过 `props`、`layoutData`、`messages` 或 `head` 传入。

启用 `frontend.i18n.htmlLang` 时，`{vext.lang}` 是请求级的。`res.render(page, props, { locale })` 会在 SSR 阶段更新最终 `<html lang>`；`htmlLang: false` 会移除 Vext 生成的 lang marker。

## Head 与 CSP Nonce

用 `options.head` 设置 title、meta 和 link。`meta` 是名称到内容的对象，不是数组。以下为路由文件中的片段，`props` 是已准备的页面数据：

```ts
import { randomBytes } from "node:crypto";

// 在处理器内生成本次响应的 nonce。
const nonce = randomBytes(16).toString("base64");
res.render("dashboard", props, {
  nonce,
  head: {
    title: "Dashboard",
    meta: { description: "Team dashboard" },
    links: [{ rel: "canonical", href: "https://example.com/dashboard" }],
  },
});
```

传入 `nonce` 后，Vext 会把它应用到带 `data-vext-entry`、`data-vext-data`、`data-vext-media` 标记且尚无 nonce 的脚本标签上。它不会自动设置 CSP 响应头，也不会为模板中任意手写脚本或 JSON-LD 补 nonce；若启用 CSP，由应用使用同一 nonce 配置相应响应策略。

## 数据序列化

`props`、`layoutData`、`messages` 和 render metadata 必须是 JSON-safe 数据。不要传函数、class instance、stream、数据库连接或原始 request 对象。

Vext 会在注入 `{vext.data}` 前转义序列化数据。用户输入应该放进 data 字段或 head 对象，不要直接写进 `_document.html`。

## 验证结果

执行 `npm run build` 后通过 `npm start -- --port 3000` 启动。访问 `/errors/missing`，确认状态为 404，正文来自错误页；访问正常页面，确认没有残留的 `{vext.*}` 字符串，并且 root、数据节点和入口脚本各只有一份。再以 HTML 导航访问未知路径、以 JSON Accept 请求 `/api/missing`，检查两种 404 出口；`/assets/missing.js` 不应返回应用 shell。验证结束后停止服务。异常处理规则另见[错误处理](/zh/guide/error-handling)。
