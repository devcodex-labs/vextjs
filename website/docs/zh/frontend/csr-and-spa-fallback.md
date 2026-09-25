# CSR 与 SPA Fallback

Vext 默认页面模型是 SSR + hydration。CSR fallback 必须显式、范围化配置。

本页在已有[全栈项目](/zh/frontend/getting-started)中，为 `/app` 增加客户端 shell，并验证它不会接管不符合条件的请求。Vext 负责交付 shell，客户端内部的路由规则仍由应用实现；配置 scope 不会自动安装或生成客户端 router。

## 什么时候使用 CSR

当某个路径范围在首个 shell 后由浏览器应用接管时，可以使用 client-router 子应用：

- 后台工作台
- 编辑器或仪表盘工具
- 内嵌产品控制台
- 某个 path prefix 下的复杂客户端导航

普通内容页仍然建议 SSR。

## 配置 Scope

先创建 shell 页面。示例只显示客户端路径，用来验证 shell 已在浏览器运行：

```tsx
// src/frontend/pages/app/shell.tsx
import { useEffect, useState } from "react";

export default function AppShellPage() {
  const [pathname, setPathname] = useState("");
  useEffect(() => setPathname(window.location.pathname), []);
  return (
    <main>
      <h1>Client workspace</h1>
      <p>{pathname || "Loading path..."}</p>
    </main>
  );
}
```

把下面的 `frontend` 配置合并进 `src/config/default.ts`，保留项目的其他配置：

```ts
export default {
  frontend: {
    enabled: true,
    spaFallback: {
      scopes: [
        {
          basePath: "/app",
          page: "app/shell",
          ssr: true,
          exclude: ["/app/api/**"],
        },
      ],
    },
  },
};
```

对象配置中的 `scopes[]` 默认是空数组，省略配置不会接管未知路径。`spaFallback: true` 则是特殊简写，会建立 `/` 范围、`index` 页面作为 shell；它不是“仅开启但无 scope”。要关闭 fallback，可使用 `spaFallback: false` 或对象中的 `enabled: false`。

主示例保留 shell 的 SSR，随后由浏览器接管交互和内部路由；这不要求每个客户端路径都有独立的服务端页面。

### 空 shell 的当前限制

`ssr: false` 会保留 document、资源和 hydration payload，但不输出服务端页面 body。当前生成的浏览器入口仍调用 `hydrateRoot`，没有为空 root 切换到 `createRoot`。因此本例改为 `ssr: false` 后会出现 hydration mismatch（生产 React #418），React 恢复渲染后页面仍可能显示。这不满足“无浏览器错误”的验证条件。

在该入口行为修复前，优先保留本例的 `ssr: true`，并让首次 SSR 与客户端输出一致；浏览器专属逻辑放在 effect 中。不要通过忽略 console 错误将空 shell 判为通过。路由 `clientOnly: true`、全局或单次渲染关闭 SSR 也会走空 body 与同一浏览器入口，需按此限制评估。

## 请求匹配

只有同时满足以下条件才 fallback：

- 请求路径位于某个 scope 内
  （按路径段匹配，`/app` 不匹配 `/apple`；重叠时优先最长 basePath）
- 没有显式 API 或 route 处理该请求
- 没有匹配静态资源
- 请求方法为 GET 或 HEAD，解码后的路径没有扩展名
- 请求接受 HTML；`text/html`、`*/*` 或未提供 Accept 都会被视为接受 HTML
- 全局 `spaFallback.exclude` 和当前 scope 的 `exclude` 均未命中

明确请求 JSON 的未知路径不会返回 shell。默认全局排除 `/api/**`、`/openapi.json`、`/docs/**`、`/_vext/docs/**`；自定义全局数组会替换默认值，应保留项目需要的排除项。scope 的 `exclude` 只排除该 shell，并不定义 API：例如本例的 `/app/api/missing` 仍可能进入普通 HTML 404 错误页分支。要提供 API，应注册真实路由并使用匹配的请求语义。

若 shell 页面不存在或渲染失败，框架继续尝试其他 404 处理，不应把返回的任意 HTML 误认为成功命中 scope。选择与错误页规则见[错误页与 Document](/zh/frontend/errors-and-document)。

## 混合 SSR 与 CSR

一个项目可以同时使用：

```text
/             -> SSR page
/pricing      -> SSR page
/admin        -> SSR entry
/admin/app/*  -> scoped CSR shell
/api/**       -> API routes
```

关键规则是每个 client-router 区域都有明确 base path 和 shell page。

## 验证范围

执行 `npm run build`，通过后启动 `npm start -- --port 3000`：

- 以 HTML 导航打开 `/app/projects`：状态 200，原始 HTML 已有 `Client workspace` 与 `Loading path...`；浏览器加载脚本后显示当前路径，控制台无 hydration mismatch。
- 对 `/app/projects` 发送 `Accept: application/json`：应走 404，不返回 shell。
- 请求 `/app/missing.js`、`/app/api/missing`、`/api/missing`：均不应命中该 shell。
- 请求 `/apple/projects`：不在 `/app` 范围，应走 404。

如需复现上述限制，可将 scope 的 `ssr` 改为 `false` 后重新构建启动：原始 root 为空，浏览器虽然可能恢复显示，但应记录 mismatch，不能判为无错误通过。验证后恢复 `ssr: true` 并停止服务。若已有显式路由匹配测试路径，以显式路由结果为准；fallback 仅处理未匹配请求。
