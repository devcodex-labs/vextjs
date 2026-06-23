# 数据流

Vext 前端数据从服务端开始。Route handler 调用 services，准备 JSON-safe 数据，再传给 `res.render()`。

## 首屏数据

```ts
export default (app) => {
  app.get("/dashboard", { cache: { ttl: 30_000 } }, async (req, res) => {
    const summary = await app.services.dashboard.summary(req.user.id);
    res.render("dashboard", {
      summary,
    });
  });
};
```

页面在 SSR 和 hydration 中接收同一份对象：

```tsx
export default function DashboardPage(props: { summary: DashboardSummary }) {
  return <Dashboard summary={props.summary} />;
}
```

## Layout Data

导航、用户菜单、工作区信息、后台权限等 shell 级数据放在 `options.layoutData`：

```ts
res.render("admin/dashboard", { metrics }, {
  layoutData: {
    user: req.user,
    nav: await app.services.nav.admin(req.user.id),
  },
});
```

Layout 不直接 import services，而是消费 route handler 传入的数据。

## 多语言 Messages

页面文案来自 `src/frontend/locales/**` 和可选 render messages：

```ts
res.render("settings", props, {
  locale: req.locale,
  messages: {
    settings: { title: "Settings" },
  },
});
```

客户端读取 typed object：

```tsx
const i18n = useVextI18n(locale);
return <h1>{i18n.settings.title}</h1>;
```

## 客户端 API 调用

Hydration 后的普通交互可以使用 `fetch`。生成 API client 主要用于工具、类型探针或外部前端适配；首屏数据通常应该通过 `res.render()` 传入。

## 缓存边界

当服务端数据可复用时，用 route response cache 缓存 render payload。除非页面真的需要客户端 refetch，否则不要先引入独立浏览器数据缓存。
