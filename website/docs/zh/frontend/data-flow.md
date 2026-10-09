# 数据流

Vext 前端数据从服务端开始。Route handler 调用 services，准备 JSON-safe 数据，再传给 `res.render()`。

本页接续[全栈快速开始](/zh/frontend/getting-started)，用同一条 `/dashboard` 路由完成首屏、导航和局部数据加载。布局数据需要先完成 [Layout 与组件](/zh/frontend/layouts-and-components)示例；业务鉴权按[认证与安全](/zh/guide/security)接入。

按任务阅读：[首屏数据](#首屏数据) → [GET 导航示例](#同路由导航) → [导航 API 参考](#navigation-api) → [POST 写入表单](#write-form)。浏览器生成的入口负责配置导航 runtime；应用组件只使用下面的公开接口。

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

## 导航 API 参考 {#navigation-api}

以下接口从 `vextjs/frontend` 导入。组件在 SSR 中仍输出原生 HTML；程序式导航只能在已由生成入口启动的浏览器中调用。

| 接口                      | 参数、默认值与结果                                                                                                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Link`                    | 必填 `href`；`prefetch` 为 `"click"`（默认）、`"visible"` 或 `"none"`；支持 `replace`、`preserveScroll` 及原生 anchor 属性。修饰键、非左键、其他 target 和跨源链接保留原生导航。                                                              |
| `Form`                    | `action` 可省略；`method` 默认 `"post"`，`navigate` 默认 `true`；支持 `replace`、`preserveScroll` 和原生 form 属性。`navigate={false}` 强制原生提交。普通写请求编码为 URLSearchParams，multipart 使用 FormData；不自动生成或补充 CSRF token。 |
| `navigate(url, options?)` | `url: string \| URL`，返回 `Promise<void>`；成功时提交页面和 history，失败状态由 `useNavigation()` 读取。只有 hash 变化时不重新请求页面。                                                                                                     |
| `prefetch(url, options?)` | 返回 page result 或 `undefined`；只用于同源 GET，不改变页面和 history；不适合预加载写操作。失败、取消、跨源或节省流量等条件下可跳过。返回的 page result 是内部协议，业务无需手工解析。                                                        |
| `revalidate(target?)`     | 返回 `Promise<void>`；失效匹配条目后重新 GET 当前页面，保留 history 和滚动位置；结果提交前保留旧页面。                                                                                                                                        |
| `useNavigation()`         | 返回 `{ phase, sequence, url, method, error? }`；phase 值见下节。SSR/无 runtime 时返回 idle 快照。                                                                                                                                            |
| `useRouteData<T>()`       | 返回当前页面 props，SSR/无 runtime 时可能为 `undefined`；泛型不做校验，首屏应回退到组件 props。                                                                                                                                               |
| `useFetcher<T>()`         | 返回 `{ phase, data?, error?, load, submit }`。`load(url)` 与 `submit(url, options?)` 返回 `Promise<T \| undefined>`；T 描述 page result 中的 props，不是任意 JSON API 响应。                                                                 |

可选参数按调用入口区分：

| 参数对象               | 字段与作用                                                                                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VextNavigateOptions`  | `replace?: boolean` 替换当前 history（默认添加）；`preserveScroll?: boolean` 保留位置（默认按目标 hash/页面恢复）；`state?: unknown` 存入 history 的用户 state；`input?: "keyboard" \| "pointer" \| "programmatic" \| "popstate"` 表示导航来源，普通应用可省略。 |
| `VextPrefetchOptions`  | `signal?: AbortSignal` 取消本次预加载；`intent?: "click" \| "visible" \| "explicit"` 表示意图，当前 fetch 路径不据此改变请求方法或调度。                                                                                                                         |
| `VextRevalidateTarget` | `routeId?: string`、`path?: string`、`tags?: string[]`、`keys?: string[]`；省略 target 时失效当前分区的条目，再重新加载当前页。它不直接执行服务端 `app.cache.invalidate()`。                                                                                     |
| `VextSubmitOptions`    | `method?: string`（默认 POST）、`body?: RequestInit["body"]`、`headers?: HeadersInit`。它继承导航选项类型，但 fetcher 提交只转发 method/body/headers，不能用 replace/state 控制局部结果的 history。                                                              |

`fetcher.submit` 的成功页面结果更新该 fetcher 的 data，不替换整页；非 GET 提交还会 revalidate 当前页，包括结果为 `undefined` 的失败分支。普通局部加载不改变地址；返回 redirect 时仍会发起页面导航，所以重定向后的地址可能变化。对需要留在原页面的局部提交，处理器应返回 `res.render()` 的页面结果，而不是 redirect。

页面错误可通过 `useNavigation().error` 或 `fetcher.error` 读取。页面错误对象提供 `status`、可选 `code` 和 `requestId`；网络错误仍可能是普通 Error，应通过属性守卫读取附加字段。包导出的 `VextPageResultError` 类当前没有被生成的浏览器 shim 重导出，页面不能将它作为运行时值 import 来做 instanceof，否则构建会失败；类型导入会被擦除，不受此限制。

不要只对返回的 Promise 使用 catch 判断成功：导航错误被记录到快照，fetcher 错误通常返回 `undefined`。401/403、协议或构建不兼容会要求 document navigation；这种情况下不能保证仍在当前组件内显示错误。没有 runtime 时调用程序式接口或 fetcher 方法会抛错；`Link`/`Form` 则保留原生 HTML 行为。

## POST 写入表单 {#write-form}

在全栈模板中创建下面两个新文件，并将配置合并到 `src/config/default.ts`，保留已有 frontend 配置。示例使用每个 Session 的显示名称，不接数据库、不实现身份认证；实际账户更新还需独立认证和授权。全局 Session 必须先于全局 CSRF，只有 route Session 不足以提供这个顺序。

```typescript
// src/config/default.ts（合并到现有配置）
export default {
  frontend: { enabled: true },
  session: { enabled: true },
  csrf: { enabled: true, mode: "session" },
};
```

```typescript
// src/routes/preferences.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", { cache: false }, async (req, res) => {
    if (!req.session) return app.throw(500, "Session is not configured");
    const csrfToken = req.csrfToken();
    await req.session.save();
    res.render("preferences", {
      label: typeof req.session.label === "string" ? req.session.label : "Ada",
      csrfToken,
    });
  });

  app.post(
    "/",
    { cache: false, validate: { body: { label: "string:1-40!" } } },
    (req, res) => {
      if (!req.session) return app.throw(500, "Session is not configured");
      req.session.label = req.valid("body").label;
      res.redirect("/preferences", 303);
    },
  );
});
```

```tsx
// src/frontend/pages/preferences.tsx
import { Form, useNavigation, useRouteData } from "vextjs/frontend";

type PreferencesProps = { label: string; csrfToken: string };

export default function PreferencesPage(props: PreferencesProps) {
  const data = useRouteData<PreferencesProps>() ?? props;
  const navigation = useNavigation();
  const error = navigation.error;
  return (
    <main>
      <p id="saved-label">Saved: {data.label}</p>
      <Form action="/preferences">
        <input type="hidden" name="_csrf" value={data.csrfToken} />
        <label>
          Display name{" "}
          <input key={data.label} name="label" defaultValue={data.label} />
        </label>
        <button disabled={navigation.phase === "submitting"}>Save</button>
      </Form>
      {navigation.phase === "error" && (
        <p role="alert">
          {error && "status" in error ? `${String(error.status)}: ` : ""}
          {error?.message ?? "Request failed"}
        </p>
      )}
    </main>
  );
}
```

GET 取得 token 后先保存 Session，再将 token 放进隐藏字段；全栈模板默认允许流式 SSR，生成 token 会修改 Session，不能等流开始后才保存。浏览器提交时同时携带关联 Session Cookie。Form 默认 POST，本例没有隐藏的 action 注册，也没有自动 token 注入。token 响应必须保持私有且不可共享缓存：这里显式关闭 route cache，`req.csrfToken()` 也会设置 no-store。Session 存储、生产 Cookie 与跨实例配置见 [Cookies 与 Sessions](/zh/guide/cookies-session)。

先执行 `npm run build -- --typecheck`，再运行 `npm start -- --port 3000`，访问 `/preferences`。依次验证：

| 操作                             | 预期                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 改为 Grace 并提交                | POST 成功后回到同一路由，显示 `Saved: Grace`；刷新仍保留该会话的值。                                                               |
| 清空 label 并提交                | 服务端返回 422，显示错误，已保存值不变。为了演示此分支，本例没有 HTML required；实际应用可加客户端校验，但不能替代服务端校验。     |
| 用错误或缺失 token 发送 POST     | HTTP 403，分别为 CSRF_TOKEN_INVALID/CSRF_TOKEN_MISSING，状态不变；在 Network 或 HTTP 客户端中检查，增强导航可能回到 document GET。 |
| 禁用 JavaScript 后重新打开并提交 | 原生 POST 带隐藏 token，返回 303，再 GET 页面，显示新的值。                                                                        |

使用 HTTP 客户端验证拒绝时，先 GET 页面保存同一份 Cookie，再对 `/preferences` 发送 form-urlencoded 的 label 与 `_csrf`；只发送 token 而不保留会话也会失败。不要在生产关闭 CSRF 来复现成功。验证结束后停止服务；默认内存 Session 不跨重启或多个 Worker 共享。

## 导航生命周期

`useNavigation()` 返回导航快照，其中 `phase` 为 `idle`、`loading`、`submitting`、`revalidating`、`error` 或 `aborted`。Revalidation 在新结果提交前保留 last-known-good 页面；新导航会取消旧请求，等价 GET 会去重，`revalidate({ routeId, path, tags, keys })` 可在当前 locale 与 auth/session 分区内失效匹配条目。

浏览器只在增强导航时请求 `application/vnd.vext.page+json;v=1`。协议、build id、权限、解码或 route asset 不兼容时会执行且仅执行一次 document navigation。Page envelope 是内部 runtime 协议，不是用户需要实现的 RPC 格式。

## 客户端 API 调用与缓存边界

不是页面导航的 JSON API 调用继续使用生成的 typed API client 或普通 `fetch`。首屏与页面导航数据通常应由 `res.render()` 提供。Vext 浏览器缓存按 route、规范化 URL、locale、auth/session identity、protocol 与 contract digest 分区；认证结果或 `no-store` page result 不会写入共享 public cache。

## 验证数据流

执行 `npm run build` 并启动 `npm start -- --port 3000`。直接访问 `/dashboard` 应显示 `Dashboard: 42`；访问 `?view=compact` 应显示 `Compact: 42`，查看响应源码也应有摘要。使用交互版本时，GET 表单应切到精简摘要，局部加载应更新独立结果且不改变地址，刷新操作应保留当前页面直到新结果到达。禁用 JavaScript 后再提交 GET 表单，确认完整页面仍可打开。结束后停止服务。缓存策略另见 [Render Data 与缓存](/zh/frontend/render-data-and-cache)，JSON API 另见 [API Client 与契约](/zh/frontend/api-client-and-contracts)。
