# 错误页与 Document

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

缺少状态码专属页面时，使用 `error/default.tsx`。

## `renderError()`

handler 需要主动返回 HTML 错误页面时使用 `res.renderError()`。

```ts
res.renderError(404);
res.renderError(404, { id: req.params.id });
res.renderError(404, "error/order-not-found");
res.renderError(error, "error/default", {
  props: { requestId: req.id },
  status: 500,
});
```

页面 id 放第二个参数或 `options.page`。不要把 `renderError("error/404")` 当作合法第一参数。

## 404 仲裁

Vext 不会把所有 404 都变成同一个 HTML 页面。输出取决于请求类型和 route 归属。

| 场景                                 | 结果               |
| ------------------------------------ | ------------------ |
| API route 缺失或 API 请求要求 JSON   | JSON 404           |
| 静态资源缺失                         | 静态 404           |
| handler 调用 `res.renderError(404)`  | HTML 错误页        |
| HTML page id 缺失                    | page registry 诊断 |
| HTML 导航命中 `spaFallback.scopes[]` | 配置的 shell 页面  |
| 未配置 fallback 的未知 HTML 导航     | 普通 route 404     |

这样 API 客户端和静态资源请求不会误收到应用 HTML。

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
    {vext.head} {vext.styles}
  </head>
  <body>
    <div id="root">{vext.app}</div>
    {vext.data} {vext.scripts}
  </body>
</html>
```

模板不会执行任意表达式。数据通过 `props`、`layoutData`、`messages` 或 `head` 传入。

启用 `frontend.i18n.htmlLang` 时，`{vext.lang}` 是请求级的。`res.render(page, props, { locale })` 会在 SSR 阶段更新最终 `<html lang>`；`htmlLang: false` 会移除 Vext 生成的 lang marker。

## Head 与 CSP Nonce

用 `options.head` 设置 title、meta 和 link。

```ts
res.render("dashboard", props, {
  nonce: req.cspNonce,
  head: {
    title: "Dashboard",
    meta: [{ name: "description", content: "Team dashboard" }],
    links: [{ rel: "canonical", href: "https://example.com/dashboard" }],
  },
});
```

传入 `nonce` 后，Vext 会把它应用到生成的 script/data 标签上。

## 数据序列化

`props`、`layoutData`、`messages` 和 render metadata 必须是 JSON-safe 数据。不要传函数、class instance、stream、数据库连接或原始 request 对象。

Vext 会在注入 `{vext.data}` 前转义序列化数据。用户输入应该放进 data 字段或 head 对象，不要直接写进 `_document.html`。
