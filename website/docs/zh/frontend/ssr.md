# SSR

服务端渲染是 Vext 默认页面路径。Route handler 拥有 URL 与数据准备，前端页面拥有 React view。

## 服务端链路

```text
src/routes/** -> services -> res.render() -> renderer -> _document.html
```

Renderer 使用：

- `src/frontend/pages/**` 中的页面组件
- 匹配到的 `layout.tsx` chain
- 错误响应时的 `src/frontend/pages/error/**`
- `src/frontend/locales/**` 中的 locale messages
- 当前前端构建 manifest 中的 assets

## 示例

```ts
export default (app) => {
  app.get("/reports/:id", {}, async (req, res) => {
    const report = await app.services.reports.get(req.params.id);

    res.render(
      "reports/detail",
      { report },
      {
        head: { title: report.title },
        layoutData: {
          section: "reports",
        },
      },
    );
  });
};
```

## 服务端可以做什么

Route handler 可以使用：

- `app.services`
- service 持有的数据库客户端
- request context 与鉴权状态
- response cache 配置
- 服务端环境变量

页面组件不能 import 这些服务端模块，只接收 JSON-safe 数据。

## HTML Document

`src/frontend/pages/_document.html` 是最外层 document 模板，负责 `{vext.head}`、`{vext.styles}`、`{vext.root}`、`{vext.data}` 和 `{vext.entry}`。React layout 负责 root 内部的 app shell。

## Status 与 Headers

HTML status 和 head 信息通过 render options 设置：

```ts
res.render("not-ready", props, {
  status: 503,
  head: { title: "Service unavailable" },
});
```

JSON/API 错误继续走已有 API 错误响应路径，HTML 渲染不应截获 API 语义。
