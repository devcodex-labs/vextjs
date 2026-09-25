# SSR

服务端渲染是 Vext 默认页面路径。Route handler 拥有 URL 与数据准备，前端页面拥有 React view。

本页在[全栈快速开始](/zh/frontend/getting-started)的项目中添加报表页，验证 HTTP 响应已经包含页面正文。需要 `frontend.enabled: true` 且 SSR 未被全局配置、路由 `clientOnly` 或单次渲染选项关闭。

## 服务端链路

```text
src/routes/** -> services -> res.render() -> renderer -> _document.html
```

Renderer 使用：

- `src/frontend/pages/**` 中的页面组件
- 匹配到的 `layout.tsx` chain
- `renderError()` 或框架 HTML 错误页路径使用的 `src/frontend/pages/error/**`
- 启用前端 i18n 时，`src/frontend/locales/**` 中的 locale messages
- 当前前端构建 manifest 中的 assets

## 示例

创建下面两个文件。示例使用固定报表数据以便直接运行，实际数据库查询放在路由调用的 service 中。

```ts
// src/routes/reports.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/:id", { validate: { param: { id: "string" } } }, (req, res) => {
    const report = { id: "1", title: "Monthly report", total: 42 };
    if (req.valid("param").id !== report.id) app.throw(404, "Report not found");

    res.render(
      "reports/detail",
      { report },
      {
        head: { title: report.title },
      },
    );
  });
});
```

```tsx
// src/frontend/pages/reports/detail.tsx
export default function ReportPage(props: {
  report: { id: string; title: string; total: number };
}) {
  return (
    <main>
      <h1>{props.report.title}</h1>
      <p>Total: {props.report.total}</p>
    </main>
  );
}
```

最终 URL 是 `/reports/1`，`reports.ts` 已提供文件前缀；页面 ID 为 `reports/detail`。若需要为外壳传数据，使用按布局 ID 分组的 `layoutData`，详见 [Layout 与组件](/zh/frontend/layouts-and-components)。

## 服务端可以做什么

Route handler 可以使用：

- `app.services`
- service 持有的数据库客户端
- request context 与鉴权状态
- response cache 配置
- 服务端环境变量

页面组件不能 import 这些服务端模块，只接收 JSON-safe 数据；需要给浏览器的字段应在处理器中显式挑选。关闭 SSR 也不会让页面获得调用服务端模块的权限。

## HTML Document

`src/frontend/pages/_document.html` 是最外层 document 模板，负责 `{vext.head}`、`{vext.styles}`、`{vext.root}`、`{vext.data}` 和 `{vext.entry}`。React layout 负责 root 内部的 app shell。

## Status 与 Headers

HTML status、响应头和文档 head 是不同选项。下面的处理器片段替换示例的渲染调用，表示暂不可用但仍展示已准备的报表；`report` 沿用前面的变量：

```ts
res.render(
  "reports/detail",
  { report },
  {
    status: 503,
    headers: { "Retry-After": "60" },
    head: { title: "Service unavailable" },
  },
);
```

JSON/API 错误继续走已有 API 错误响应路径，HTML 渲染不应截获 API 语义。

## Buffered 与 Streaming

配置解析器默认使用 `render.streaming: "buffered"`；全栈模板显式设为 `"auto"`。Buffered 使用同步渲染，`timeoutMs` 在返回后检查，无法打断占用 CPU 的同步代码；失败按 `render.fallback` 返回客户端 shell 或交给错误处理。Streaming 可先发送 shell，但已发送响应不能改写状态和 headers；初始 payload/head 应在发送前确定。完整时序与无 hydration 的限制见[渲染模式](/zh/frontend/rendering-modes)。

## 验证 SSR

执行 `npm run build`，通过后启动 `npm start -- --port 3000`。检查 `/reports/1` 的 HTTP 响应正文：应已有 `Monthly report` 与 `Total: 42`，标题也来自 `head.title`，而不只是空 root。`/reports/2` 应为 404。测试状态选项时，重新构建启动，检查 503 与 `Retry-After: 60`，不能只看页面是否显示。结束后停止服务。

若只得到客户端 shell，检查 `frontend.render.ssr`、路由 `clientOnly`、单次 `ssr`，以及 SSR 是否因错误或超时回退；HTTP 200 本身不能证明 SSR 成功。交互接管另见 [Hydration](/zh/frontend/hydration)，不要把正文渲染通过当作浏览器交互已通过。
