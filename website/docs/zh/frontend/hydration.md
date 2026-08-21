# Hydration

Hydration 会把浏览器端 React tree 接到 SSR 产出的 HTML 上。

需要交互的页面默认启用 hydration；也可以只为某个 SSR 路由关闭，而不关闭整个前端应用。

## 会复用什么

Vext 会把 render payload 写入 document，让 client entry 不需要重复执行首屏 service 调用：

- page id
- props
- layoutData
- locale 和 messages
- 初始 route 使用的 head metadata
- build id 和 route assets

## 避免 Mismatch

保持 SSR 与浏览器输出确定：

| 风险                           | 更好的做法                                  |
| ------------------------------ | ------------------------------------------- |
| render 中直接使用 `Date.now()` | 在 route handler 中传入时间。               |
| 组件 render 中生成随机 id      | 在 render 前生成稳定 id，或放到 effect 中。 |
| SSR 阶段访问浏览器 API         | 放到 effect 或 client-only 分支。           |
| locale 对象结构不同            | 每个 locale 文件都与默认 locale 对齐。      |

## Hydration 标记

Vext 提供低噪音诊断标记：

```text
data-vext-hydration="hydrating"
data-vext-hydration="done"
performance.measure("vext:hydration")
```

生产环境不需要默认输出 console 性能日志。验证脚本读取 DOM 与 Performance API。

## Route Assets

Render manifest 会记录每个 route 的 initial JS/CSS。SSR 可以注入 route-specific `modulepreload`，避免 hydration 后才发现 page chunk。

如果生产 `vext start` 发现 manifest 过旧且缺少 route assets，会 fail fast 并提示重新构建。

## 只为一个 SSR 页面关闭

```ts
app.get(
  "/article/:slug",
  { frontend: { hydration: "none" } },
  async (req, res) => {
    const article = await app.services.articles.find(req.params.slug);
    res.render("article", { article }, { seo: { title: article.title } });
  },
);
```

hydration policy 会投影到构建 manifest，因此三参数路由的 route-options 参数及 `RouteOptions.frontend` 值必须保持为 `inline object literal`。动态页面元数据继续放在 `res.render(..., { seo })`。

该路由输出服务端渲染的 HTML、CSS、SEO 和用户写入 document 的 script，但不输出 `__VEXT_DATA__`、Vext browser entry、React/Vext external runtime import 或路由 JS preload。Vext 还会在 document 上写入 `data-vext-hydration="none"` 供诊断。

由于页面中没有 Vext browser runtime，框架管理的同 document 导航、Form、fetcher 和 React 事件处理不会工作；应使用普通链接/表单或用户自带的独立 script。之后以完整 document 导航进入 hydration 页面时，会恢复正常 hydration。

该策略作用于整页。Vext 当前不能只 hydrate 搜索框或评论区，也不宣称支持 Selective/Partial Hydration、Islands、React Server Components 或 Partial Prerendering（PPR）。

## 验证

使用消费者验证入口：

```bash
npm --prefix E:\Worker\vextjs-test run verify:frontend-performance
```

它检查真实浏览器导航、前端资源状态、route preload、hydration marker 和 `size-report.json`。
