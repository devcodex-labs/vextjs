# 数据流

Vext 前端数据从服务端开始。Route handler 调用 services，准备 JSON-safe 数据，再传给 `res.render()`。

## 首屏数据

```ts
export default (app) => {
  app.get(
    "/dashboard",
    { auth: true, cache: { ttl: 30_000 } },
    async (req, res) => {
      const { userId } = req.auth;
      if (!userId) {
        req.app.throw(401, "控制台需要已认证的用户 ID");
      }

      const summary = await app.services.dashboard.summary(userId);
      res.render("dashboard", {
        summary,
      });
    },
  );
};
```

应用注册 `auth()` 后，`auth: true` 负责保护路由，`req.auth` 承载框架提供的身份与 claims。用户资料属于业务数据：应由自己的 service 加载，不能假设 Vext 会注入 `req.user`。

页面在 SSR 和 hydration 中接收同一份对象：

```tsx
export default function DashboardPage(props: { summary: DashboardSummary }) {
  return <Dashboard summary={props.summary} />;
}
```

## Layout Data

导航、用户菜单、工作区信息、后台权限等 shell 级数据放在 `options.layoutData`。下面的 handler 片段假定所在路由已经声明 `auth: true`：

```ts
const { userId } = req.auth;
if (!userId) {
  req.app.throw(401, "控制台需要已认证的用户 ID");
}

const user = await app.services.user.findById(userId);

res.render(
  "admin/dashboard",
  { metrics },
  {
    layoutData: {
      user,
      nav: await app.services.nav.admin(userId),
    },
  },
);
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

## 同路由导航

Hydration 后，Vext 可以把同一个 document route 协商为版本化 page result。这里没有第二套 loader/action 注册 API：原 route handler 及其中间件、auth/session、CSRF、validation、cache、timeout、redirect 和 error 行为仍是唯一事实源。

稳定公开面是 `Link`、`Form`、`navigate`、`prefetch`、`revalidate`、`useNavigation`、`useFetcher` 与 `useRouteData`。

```tsx
import {
  Form,
  Link,
  revalidate,
  useFetcher,
  useNavigation,
  useRouteData,
} from "vextjs/frontend";

export default function DashboardPage() {
  const data = useRouteData<{ summary: DashboardSummary }>();
  const navigation = useNavigation();
  const details = useFetcher<{ summary: DashboardSummary }>();

  return (
    <main>
      <h1>控制台</h1>
      <p data-state={navigation.phase}>{data?.summary.label}</p>
      <Link href="/reports" prefetch="click">
        报表
      </Link>
      <Form action="/reports" method="post">
        <button type="submit">创建报表</button>
      </Form>
      <button onClick={() => details.load("/reports?view=compact")}>
        加载摘要
      </button>
      <button onClick={() => revalidate()}>刷新</button>
    </main>
  );
}
```

`Link` 支持 `prefetch="none" | "click" | "visible"`，默认是 `"click"`。`Form` 保留普通字符串 `action` 与 HTTP method，因此禁用 JavaScript 后仍会正常提交 document 请求。`useFetcher()` 复用相同 route，但不改变浏览器 history。

## 导航生命周期

`useNavigation()` 返回 `idle`、`loading`、`submitting`、`revalidating`、`error` 或 `aborted`。Revalidation 在新结果提交前保留 last-known-good 页面；新导航会取消旧请求，等价 GET 会去重，`revalidate({ routeId, path, tags, keys })` 可在当前 locale 与 auth/session 分区内失效匹配条目。

浏览器只在增强导航时请求 `application/vnd.vext.page+json;v=1`。协议、build id、权限、解码或 route asset 不兼容时会执行且仅执行一次 document navigation。Page envelope 是内部 runtime 协议，不是用户需要实现的 RPC 格式。

## 客户端 API 调用与缓存边界

不是页面导航的 JSON API 调用继续使用生成的 typed API client 或普通 `fetch`。首屏与页面导航数据通常应由 `res.render()` 提供。Vext 浏览器缓存按 route、规范化 URL、locale、auth/session identity、protocol 与 contract digest 分区；认证结果或 `no-store` page result 不会写入共享 public cache。
