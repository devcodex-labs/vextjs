# Render Data 与缓存

Render data 是服务端准备、用于生成 HTML 并支持 hydration 的 payload。

先完成[路由与页面](/zh/frontend/routing-and-pages)与[数据流](/zh/frontend/data-flow)。本页先说明公开页面的响应缓存，再区分静态/再验证存储和浏览器导航缓存；个性化页面应先确定隔离与绕过规则。

## 什么是 Render Data

同一路径的 HTML 和导航 envelope 都设置 `Vary: Accept, Vext-Navigation, Vext-Build-Id`，并保留已有 Vary 值。带认证身份或 session 的页面使用 `Cache-Control: private, no-store`；缓冲 HTML、流式响应、错误页和缓存重放遵守相同规则，私有页面不会被自定义的 public 缓存头覆盖。

这些是 HTTP 响应与 renderer 的规则，不代表路由缓存读取和并发回源已自动按所有业务身份隔离。`RouteOptions.cache` 的 Cookie 命中与并发复用边界仍需遵守[响应缓存指南](/zh/guide/cache)；不能只在返回响应时补 `no-store` 来替代进入缓存前的判定。

对 `res.render()` 来说，render data 可以包含：

- `props`
- `options.layoutData`
- `options.messages`
- `options.locale`
- `options.head`
- status 和 page id

它应该是 JSON-safe，不包含数据库句柄、request 对象、密钥或函数。

## 复用 Route Cache

Vext 复用已有 route response cache 契约。JSON 响应缓存 JSON body；渲染页面缓存 render payload。

下面是可放进已有全栈项目的完整示例，仅缓存没有身份、Session、Authorization 或 Cookie 的公开请求，TTL 单位为毫秒。先确认全局 `cache.enabled` 没有被关闭。

```ts
// src/routes/cached-report.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  let generation = 0;
  app.get(
    "/",
    {
      cache: {
        ttl: 60_000,
        condition: (req) =>
          !req.auth.isAuthenticated &&
          !req.session &&
          !req.headers.authorization &&
          !req.headers.cookie,
      },
    },
    (_req, res) => {
      res.render("reports/cached", { generation: ++generation });
    },
  );
});
```

```tsx
// src/frontend/pages/reports/cached.tsx
export default function CachedReport(props: { generation: number }) {
  return <main>Generation: {props.generation}</main>;
}
```

命中缓存后，Vext 会用当前 frontend renderer 和 manifest 重新渲染 HTML。

`generation` 只是单进程验证标记，服务重启会归零；它不是业务数据版本方案。缓存命中跳过 handler，因此不要在 handler 中放必须每次执行的权限检查。

## Layout Data

如果多个 layout 需要服务端数据，应在 route handler 或 service 中集中准备，再通过 `layoutData` 传入。

下面为已准备用户数据且完成 [Layout 与组件](/zh/frontend/layouts-and-components)示例的处理器片段；`user` 是已经筛选的用户资料，`menu` 是业务菜单。个性化数据不要套用上面的公开缓存路由：

```ts
res.render(
  "admin/dashboard",
  { totalUsers: 42 },
  {
    layoutData: {
      ".": { user },
      admin: { menu },
    },
  },
);
```

这可以避免 layout 组件暗中调用 services，也让 cache key 留在 route 边界。

用户身份由 `req.auth` 提供，框架不会自动注入 `req.user`；布局通过对应 ID 的 `props.data` 消费数据。

## Cache Key

所有会改变 render payload 的值都应进入 cache key：

- path 和 query
- 当前用户或 tenant
- locale
- feature flag 或 experiment
- 数据版本

如果 HTML 随 locale 变化，response cache 与 CDN cache 都要按 locale vary。

路由响应缓存默认包含方法、规范化 URL 与所声明的 vary；不会自动加入业务用户、feature flag 或数据版本。可使用 `vary`、可信 `partitionKey` 或自定义 key，但自定义 key 会替换默认 URL 组合，须自行覆盖实际影响结果的入参。默认内部 key 格式和并发限制以[响应缓存指南](/zh/guide/cache)为准，不要从渲染 payload 猜出可删除的缓存 key。

## 区分三类缓存

| 机制                      | 开启入口                                              | 单位与范围                                                                                                   | 失效入口                                                  |
| ------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| 路由响应缓存              | `RouteOptions.cache`                                  | `ttl` 为毫秒；由 key、vary、partition 与 condition 决定复用                                                  | `app.cache` API，按标签或准确 key 操作                    |
| 服务端 frontend freshness | `RouteOptions.frontend.mode` 为 `static`/`revalidate` | `revalidate` 为秒；公开 GET/HEAD，已认证或有 session 时 bypass；键含路由、path/query、locale、buildId 与策略 | 服务端 `invalidateFrontendFreshness`                      |
| 浏览器导航缓存            | 生成的浏览器导航 runtime                              | 按当前页面合同、URL、locale/身份等隔离；私有/no-store结果不进入共享缓存                                      | 浏览器 `revalidate()`，见[数据流](/zh/frontend/data-flow) |

不要为同一页面未经评估就叠加两套服务器缓存：其中一个失效并不代表另一个失效。`mode: "static"` 的构建期产物又独立于运行时存储：构建直接给页面 `{ params }`，不执行 handler；详见[渲染模式](/zh/frontend/rendering-modes)。

服务端按 tag 失效 freshness 的片段如下，`projectRoot` 必须是实际 Vext 项目根目录，调用位置是业务写入成功后的服务端代码：

```ts
import { invalidateFrontendFreshness } from "vextjs/frontend";

await invalidateFrontendFreshness(projectRoot, { tag: "reports" });
```

这不会删除 CDN 中已发布的静态 HTML，也不会替客户端调用 `revalidate()`。

## 不应该缓存什么

不要缓存包含一次性 token、密钥或不可复用用户状态的 render payload。敏感字段本身不应传入浏览器；不可复用页面使用 `cache: false`，并保持 `frontend.mode: "dynamic"`。缩短 TTL 不能把不该复用的数据变成可复用数据。

## 验证命中与绕过

执行 `npm run build` 后启动 `npm start -- --port 3000`。对 `/cached-report` 连续发送两个无 Cookie、无 Authorization 的 GET：第一次应为 `X-Cache: MISS`，第二次应为 `HIT`，页面 generation 相同。再发送带 Cookie 的请求，condition 应绕过缓存并让 generation 增加；不要用带登录 Cookie 的浏览器会话验证公开命中。最后停止服务。

实际项目还要分别验证不同 locale、身份分区与失效后输出；命中率不能证明缓存内容正确。开发模式默认的 `no-store` 可能使生产缓存观察不适用，所以本例通过生产 build/start 验证。
