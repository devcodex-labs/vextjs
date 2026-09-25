# 数据流

Vext 前端数据从服务端开始。Route handler 调用 services，准备 JSON-safe 数据，再传给 `res.render()`。

本页接续[全栈快速开始](/zh/frontend/getting-started)，用同一条 `/dashboard` 路由完成首屏、导航和局部数据加载。布局数据需要先完成 [Layout 与组件](/zh/frontend/layouts-and-components)示例；业务鉴权按[认证与安全](/zh/guide/security)接入。

## 首屏数据

创建下面两个文件。为便于直接验证，示例使用内存摘要；实际业务在处理器中调用已注册 service，并筛选返回字段。

```ts
// src/routes/dashboard.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", { validate: { query: { view: "string?" } } }, (req, res) => {
    const summary = {
      label: req.valid("query").view === "compact" ? "Compact" : "Dashboard",
      total: 42,
    };
    res.render("dashboard", {
      summary,
    });
  });
});
```

应用注册 `auth()` 后，`auth: true` 负责保护路由，`req.auth` 承载框架提供的身份与 claims。用户资料属于业务数据：应由自己的 service 加载，不能假设 Vext 会注入 `req.user`。

页面在 SSR 和 hydration 中接收同一份可序列化数据：

```tsx
// src/frontend/pages/dashboard.tsx
type DashboardSummary = { label: string; total: number };

export default function DashboardPage(props: { summary: DashboardSummary }) {
  return (
    <main>
      {props.summary.label}: {props.summary.total}
    </main>
  );
}
```

## Layout Data

导航、用户菜单、工作区信息等 shell 数据放在 `options.layoutData`。下面替换已完成布局示例的 `admin/dashboard` 处理器中的渲染调用，布局 ID 是根点号和 `admin`：

```ts
const user = { name: "Ada" };
const metrics = { totalUsers: 42 };
const nav = [{ label: "Dashboard", href: "/admin/dashboard" }];

res.render("admin/dashboard", metrics, {
  layoutData: {
    ".": { user },
    admin: { menu: nav },
  },
});
```

Layout 通过 `props.data` 读取对应布局键的对象，不直接 import services。真实用户资料需要在已完成认证的处理器里按 `req.auth.userId` 查询；导航可见性只影响 UI，服务端仍需独立检查权限。

## 多语言 Messages

页面文案来自 `src/frontend/locales/**` 和可选 render messages。启用前端 i18n 后，处理器可显式提供当前渲染的消息对象；它替换当前消息对象，不是递归补丁。下面可替换本页 dashboard 的渲染调用：

```ts
res.render(
  "dashboard",
  { summary },
  {
    locale: "en-US",
    messages: {
      settings: { title: "Settings" },
    },
  },
);
```

页面或布局内可使用下面的组件读取本次消息。泛型只是 TypeScript 声明，消息必须由配置/渲染选项实际提供；完整类型生成与回退规则见[前端 i18n](/zh/frontend/i18n)。

```tsx
// src/frontend/components/SettingsTitle.tsx
import { useVextI18n } from "vextjs/frontend";

export function SettingsTitle() {
  const i18n = useVextI18n<{ settings: { title: string } }>();
  return <h1>{i18n.settings.title}</h1>;
}
```

## 同路由导航

Hydration 后，Vext 可以把同一个 document route 协商为版本化 page result。这里没有第二套 loader/action 注册 API：原 route handler 及其中间件、auth/session、CSRF、validation、cache、timeout、redirect 和 error 行为仍是唯一事实源。

稳定公开面是 `Link`、`Form`、`navigate`、`prefetch`、`revalidate`、`useNavigation`、`useFetcher` 与 `useRouteData`。

保持前面的路由不变，把 dashboard 页面替换为下面的交互版本。所有链接和表单仍请求 `/dashboard`；这里使用 GET 表单演示查询，不需要额外写入接口。

```tsx
// src/frontend/pages/dashboard.tsx（替换前面的页面）
import {
  Form,
  Link,
  revalidate,
  useFetcher,
  useNavigation,
  useRouteData,
} from "vextjs/frontend";

type DashboardSummary = { label: string; total: number };
type DashboardProps = { summary: DashboardSummary };

export default function DashboardPage(props: DashboardProps) {
  const data = useRouteData<DashboardProps>() ?? props;
  const navigation = useNavigation();
  const details = useFetcher<{ summary: DashboardSummary }>();

  return (
    <main>
      <h1>控制台</h1>
      <p data-state={navigation.phase}>
        {data.summary.label}: {data.summary.total}
      </p>
      <Link href="/dashboard?view=full" prefetch="click">
        完整摘要
      </Link>
      <Form action="/dashboard" method="get">
        <input type="hidden" name="view" value="compact" />
        <button type="submit">查看精简摘要</button>
      </Form>
      <button onClick={() => details.load("/dashboard?view=compact")}>
        加载摘要
      </button>
      <p>{details.data?.summary.label}</p>
      <button onClick={() => revalidate()}>刷新</button>
    </main>
  );
}
```

`useRouteData()` 在服务端没有已配置的浏览器 runtime，可能返回 `undefined`，因此示例回退到页面 props，保证首屏内容。`Link` 支持 `prefetch="none" | "click" | "visible"`，默认是 `"click"`。`Form` 保留原生 form，本例 GET 在禁用 JavaScript 时仍可提交 document 请求；写入表单需另有对应方法的 handler，并满足其认证、CSRF 与校验要求。`useFetcher()` 复用相同 route，但不改变浏览器 history。

## 导航生命周期

`useNavigation()` 返回导航快照，其中 `phase` 为 `idle`、`loading`、`submitting`、`revalidating`、`error` 或 `aborted`。Revalidation 在新结果提交前保留 last-known-good 页面；新导航会取消旧请求，等价 GET 会去重，`revalidate({ routeId, path, tags, keys })` 可在当前 locale 与 auth/session 分区内失效匹配条目。

浏览器只在增强导航时请求 `application/vnd.vext.page+json;v=1`。协议、build id、权限、解码或 route asset 不兼容时会执行且仅执行一次 document navigation。Page envelope 是内部 runtime 协议，不是用户需要实现的 RPC 格式。

## 客户端 API 调用与缓存边界

不是页面导航的 JSON API 调用继续使用生成的 typed API client 或普通 `fetch`。首屏与页面导航数据通常应由 `res.render()` 提供。Vext 浏览器缓存按 route、规范化 URL、locale、auth/session identity、protocol 与 contract digest 分区；认证结果或 `no-store` page result 不会写入共享 public cache。

## 验证数据流

执行 `npm run build` 并启动 `npm start -- --port 3000`。直接访问 `/dashboard` 应显示 `Dashboard: 42`；访问 `?view=compact` 应显示 `Compact: 42`，查看响应源码也应有摘要。使用交互版本时，GET 表单应切到精简摘要，局部加载应更新独立结果且不改变地址，刷新操作应保留当前页面直到新结果到达。禁用 JavaScript 后再提交 GET 表单，确认完整页面仍可打开。结束后停止服务。缓存策略另见 [Render Data 与缓存](/zh/frontend/render-data-and-cache)，JSON API 另见 [API Client 与契约](/zh/frontend/api-client-and-contracts)。
