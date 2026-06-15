# 前端集成

VextJS 内置一条一等前端流水线，用于让同一个包同时管理 API 路由、开发期重载、生产构建、路由契约生成、HTML 模板渲染与静态资源服务。默认脚手架使用 React，浏览器侧 helper 放在 `vextjs/frontend` 下，保证后端运行时契约不绑定某个 UI 框架。当前实现是前端基础层：它能托管一个浏览器入口和 Vext API client，但还不是完整的应用级前端框架层。

## 目录导航

- [创建全栈项目](#创建全栈项目)
- [实现映射](#实现映射)
- [当前范围与应用层路线](#当前范围与应用层路线)
- [配置](#配置)
- [配置项参考](#配置项参考)
- [运行流程](#运行流程)
- [HTML 模板渲染](#html-模板渲染)
- [客户端代码示例](#客户端代码示例)
- [API client helper](#api-client-helper)
- [开发、构建与启动](#开发构建与启动)
- [外部前端适配器](#外部前端适配器)
- [常见问题](#常见问题)
- [下一步](#下一步)

## 创建全栈项目

```bash
npx vextjs create my-app
cd my-app
npm run dev
```

默认 full-stack 模板会同时创建后端路由和浏览器应用：

```text
my-app/
├── public/
│   └── favicon.svg
└── src/
    ├── client/
    │   ├── App.tsx
    │   ├── index.html
    │   ├── main.tsx
    │   └── styles.css
    ├── config/
    │   └── default.ts
    └── routes/
        └── index.ts
```

路由模板提供 `/api/hello` 与 `/api/health`。浏览器应用从 `/` 服务，前端文件由 Vext dev 进程重建。

如果只需要 API 项目，显式关闭前端：

```bash
npx vextjs create my-api --template api --frontend none
```

## 实现映射

前端集成是在 Vext 内部实现的。下表把文档行为映射到对应源码真相源：

| 行为 | 真相源 | 职责 |
| --- | --- | --- |
| 浏览器侧公开 helper | `src/frontend/index.ts` | 通过 `vextjs/frontend` 暴露 `createVextApiClient()`、`isVextApiError()`、`defineFrontendAdapter()`、前端配置类型、路由契约类型和 manifest 类型。 |
| 前端配置解析 | `src/frontend/tooling/config-resolver.ts` | 规范化 `frontend: true/false/object`，把路径解析到项目根内，应用 dev/prod 默认值，校验 `publicPath`，规范化 SPA fallback 和 API client 选项。 |
| 客户端契约生成 | `src/frontend/tooling/client-contract-writer.ts` | 读取 `.vext/manifest/routes.json`，跳过隐藏或元数据不完整的路由，写入 `client-contract.json`，并渲染 `api.generated.ts`。 |
| 浏览器构建与模板渲染 | `src/frontend/tooling/client-build-compiler.ts` | 清理 `outDir`、复制 `publicDir`、运行 esbuild、写入 `manifest.json`、`size-report.json`、路由契约产物和渲染后的 `index.html`。 |
| 静态资源与 SPA fallback | `src/frontend/runtime/static-mount.ts` | 从 `outDir` 服务资源，处理 `ETag` / `Last-Modified` / `Cache-Control`，按 method 与 `Accept` 门禁 SPA fallback，并防止路径穿越。 |
| 开发期构建接入 | `src/lib/dev/dev-bootstrap.ts` | 写入开发期 route manifest，按 development 模式构建前端，并处理 watcher 发来的 `frontend-rebuild` IPC 消息。 |
| 开发期文件分类 | `src/lib/dev/change-classifier.ts` 与 `src/lib/dev/file-watcher.ts` | 将默认 `src/client/**` 与 `public/**` 变更分类为 client rebuild，而不是后端 cold restart。 |
| 生产构建接入 | `src/cli/build.ts` | 刷新 route manifest，构建服务端产物，重新加载 built config，并按 production 模式运行前端编译器。 |
| 生产启动接入 | `src/lib/bootstrap.ts` | 前端输出缺失时 fail fast，并在 listen 前注册前端感知的 not-found handler。 |
| 脚手架生成 | `src/cli/create.ts` | 生成默认 React client 文件、frontend config block、`public/favicon.svg` 和 API-only opt-out 路径。 |
| 包边界 | `package.json`、`scripts/build-cjs.mjs`、`test/verify-package-exports.mjs` | 发布 `./frontend` 的 ESM、CJS 与 `.d.ts`，并校验导出面。 |

因此这条前端能力不需要 Vite，也不是独立前端框架包。浏览器 bundle 由 Vext 自己的 esbuild 流水线编译，React 只进入生成的 full-stack 项目依赖。

## 当前范围与应用层路线

当前版本的 `Vext Frontend` 是 P0 基础层。它解决的是“Vext 能否自己构建、服务并连接一个浏览器应用”的问题，而不是“Vext 是否已经提供完整复杂应用框架层”的问题。

| 当前已支持 | 当前尚未支持 |
| --- | --- |
| 单个 `frontend.entry` 浏览器入口。 | Vext 控制的页面路由树、文件路由或显式 page manifest。 |
| esbuild client build、hashed JS/CSS、manifest 与 size report。 | route-level code splitting、route 预取和 route asset graph。 |
| HTML shell 渲染和 `%VEXT_ENTRY%` / `%VEXT_STYLES%` 注入。 | route 级 head/meta、preload、script/style 管理。 |
| 静态资源服务、`ETag` / `Last-Modified` / SPA fallback。 | loading/error/not-found 边界和页面生命周期。 |
| `vextjs/frontend` API client helper。 | 页面 params/search、loader data、action result 的类型生成。 |
| React 19 最小脚手架。 | 嵌套路由、布局、表单 action、mutation、auth/session/CSRF 前端桥。 |
| `defineFrontendAdapter()` metadata 扩展点。 | adapter 专属 build/render/route hook。 |

也就是说，复杂后台、账户系统、多页面内容站、仪表盘、表单工作流或需要页面级拆包的应用，不应把当前 P0 当成完成态。下一阶段应用层需要补齐：

- `src/client/pages/**` 或显式 page manifest 到 route tree 的生成。
- root layout、nested layout、route group、dynamic params、not-found route。
- route loader/action，与 typed Vext API、validation error、HttpError、abort 和 prefetch 集成。
- params/search/loader/action/API contract 的类型生成。
- loading、error、not-found 边界和默认恢复路径。
- head/meta/link/script/preload 管理。
- public runtime config、base path、build id、feature flags 注入。
- auth/session/CSRF 浏览器桥和 401/403 默认处理。
- route-level splitting、prefetch、route asset manifest 和复杂应用 benchmark。
- dev overlay 或 inspector，用于观察 route tree、loader/action、fallback 命中和 bundle size。

SSR、streaming、React Server Components、Server Actions 和 server functions 不属于当前 P0，也不应在文档或代码里被描述成已支持能力。它们需要在应用层边界稳定后单独做技术方案和基准验证。

## 配置

前端能力由 `config.frontend` 控制。

使用默认 React 布局：

```ts
import type { VextUserConfig } from "vextjs";

const config: VextUserConfig = {
  frontend: true,
};

export default config;
```

需要完整掌控字段时可以显式配置：

```ts
import type { VextUserConfig } from "vextjs";

const config: VextUserConfig = {
  frontend: {
    enabled: true,
    framework: "react",
    root: "src/client",
    entry: "src/client/main.tsx",
    indexHtml: "src/client/index.html",
    outDir: "dist/client",
    publicDir: "public",
    publicPath: "/",
    spaFallback: {
      enabled: true,
      exclude: ["/api/**", "/openapi.json", "/docs/**"],
    },
    apiClient: {
      enabled: true,
    },
    build: {
      target: ["es2022", "chrome115"],
      minify: true,
      sourcemap: false,
    },
  },
};

export default config;
```

省略 `frontend`、设置 `frontend: false` 或设置 `frontend.enabled: false` 都会关闭前端构建与静态服务。

:::tip
如果希望 `vext dev` 自动触发 client rebuild，建议保持默认的 `src/client/**` 与 `public/**` 路径。构建编译器支持自定义 `entry`、`indexHtml`、`outDir`、`publicDir` 与 `publicPath`；当前开发期变更分类器主要针对默认 client 和 public 目录优化。
:::

## 配置项参考

| 字段 | 类型 | 默认值 | 行为 |
| --- | --- | --- | --- |
| `frontend` | `boolean \| object` | 禁用 | `true` 启用默认值；`false` 关闭浏览器构建与静态服务。 |
| `frontend.enabled` | `boolean` | `false` | 启用内置前端流水线。 |
| `frontend.framework` | `string` | `"react"` | 前端框架标签。React 是当前内置脚手架目标。 |
| `frontend.root` | `string` | `"src/client"` | 记录在 resolved config 中的前端源码目录。当前编译器直接使用 `entry` 与 `indexHtml`；开发期 rebuild 分类主要针对默认 `src/client/**` 路径优化。 |
| `frontend.entry` | `string` | `"src/client/main.tsx"` | 传给 esbuild 的浏览器入口文件。文件不存在时会 fail fast。 |
| `frontend.indexHtml` | `string` | `"src/client/index.html"` | 模板渲染器使用的 HTML shell。文件不存在时，Vext 写入最小 fallback shell。 |
| `frontend.outDir` | `string` | 开发期 `.vext/client`，生产期 `dist/client` | 浏览器资源、渲染后 HTML、路由契约、manifest 与 size report 的输出目录。 |
| `frontend.publicDir` | `string` | `"public"` | 构建前复制到 `outDir` 的静态资源目录。 |
| `frontend.publicPath` | `string` | `"/"` | 生成资源链接的 URL 前缀。必须是路径，不能是完整 URL。`app` 会规范化为 `/app/`。 |
| `frontend.spaFallback` | `boolean \| object` | 启用 | 为接受 HTML 的浏览器导航路径服务 `index.html`。 |
| `frontend.spaFallback.exclude` | `string[]` | `["/api/**", "/openapi.json", "/docs/**"]` | 保留后端行为的精确路径或 `/**` 前缀模式。 |
| `frontend.apiClient` | `boolean \| object` | 启用 | 根据路由 manifest 写入 `client-contract.json` 与 `api.generated.ts`。 |
| `frontend.build.target` | `string \| string[]` | `"es2022"` | esbuild 浏览器构建目标。 |
| `frontend.build.minify` | `boolean` | 生产期 `true`，开发期 `false` | 是否压缩前端产物。 |
| `frontend.build.sourcemap` | `boolean` | 开发期 `true`，生产期 `false` | 是否输出 source map。 |
| `frontend.adapter` | `VextFrontendAdapter` | 无 | 由 `defineFrontendAdapter()` 返回的扩展点。当前版本仍由 Vext 负责内置构建、manifest、契约与静态服务流程。 |

## 运行流程

### 开发期流程

`vext dev` 使用同一套 Vext 进程树承接后端运行时和浏览器 bundle：

1. dev worker 加载 Vext 配置并注册后端路由。
2. route collector 写入 `.vext/manifest/routes.json`。
3. `buildFrontendClient({ mode: "development" })` 解析 `config.frontend`。
4. 如果前端禁用，跳过前端构建。
5. 如果前端启用，默认写入 `.vext/client/`。
6. 前端编译器复制 `public/`，写入 client contract 产物，用 esbuild 打包浏览器入口，写入 `manifest.json`、`size-report.json`，最后渲染 `index.html`。
7. not-found handler 通过同一个 Vext server 服务静态前端资源和浏览器导航 fallback。
8. watcher 将默认 `src/client/**` 与 `public/**` 变更分类为 `client`。
9. worker 收到 `frontend-rebuild` 后重新执行 `buildFrontendClient()`，不触发后端 route reload 或 cold restart。

### 生产构建流程

`vext build` 让服务端输出和浏览器输出归入同一个构建命令：

1. Vext 刷新 generated types 和 route manifest。
2. TypeScript 项目把服务端代码编译到 CLI `--outdir`，默认是 `dist`。
3. Vext 从 `<outdir>/config` 以 `command: "build"` 重新加载 built config。
4. 服务端构建后执行 `buildFrontendClient({ mode: "production" })`。
5. 如果 CLI `--outdir` 不是 `dist`，且没有显式设置 `frontend.outDir`，浏览器输出会变成 `<outdir>/client`。
6. 如果显式设置了 `frontend.outDir`，显式值优先。
7. JavaScript 项目会跳过服务端编译，但只要启用了 `frontend`，仍会构建前端资源。

浏览器 esbuild 构建使用 `platform: "browser"`、`format: "esm"`、`jsx: "automatic"`、`splitting: false`、带 hash 的 `assets/[name]-[hash]` 文件名、常见图片/字体 file loader、CSS bundle，并按 development / production 写入 `process.env.NODE_ENV` define。

### 生产服务流程

`vext start` 只服务已经存在的前端产物：

1. bootstrap 以 production 模式解析前端配置。
2. `frontend.enabled` 为 true 时，`assertFrontendOutputReady()` 检查 `outDir/index.html`。
3. 前端输出缺失会 fail fast，并提示先执行 `vext build`。
4. Vext 将 `createFrontendNotFoundHandler()` 注册为 not-found 路径。
5. `GET` 与 `HEAD` 请求会先尝试按 `frontend.publicPath` 解析静态资源。
6. 静态文件带 content type、`ETag`、`Last-Modified` 与 cache header。`index.html` 为 `no-cache`，hash 资源为 immutable。
7. SPA fallback 只处理接受 HTML、无扩展名、且不匹配 `spaFallback.exclude` 的路径。
8. JSON / API 客户端继续收到后端 404 或后端错误，不会收到 `index.html`。

### 生成文件来源

| 输出文件 | 来源 |
| --- | --- |
| `assets/main-<hash>.js` | 从 `frontend.entry` 进入 esbuild bundle。 |
| `assets/main-<hash>.css` | 浏览器入口 import 的 CSS，由 esbuild 输出。 |
| copied public assets | `frontend.publicDir` 下的文件，在 bundle 前复制。 |
| `client-contract.json` | `.vext/manifest/routes.json` 中的可见路由。 |
| `api.generated.ts` | 同一个 client contract 渲染成的 TypeScript 小模块，导出 `contract` 和 `api`。 |
| `manifest.json` | esbuild metafile 输出规范化为公开资源 URL。 |
| `size-report.json` | 基于 `manifest.json` 统计资源字节数。 |
| `index.html` | `frontend.indexHtml` 注入生成的样式和脚本标签后得到；模板不存在时使用最小 fallback shell。 |

## HTML 模板渲染

`frontend.indexHtml` 不是简单复制。Vext 会在 esbuild 完成后把它渲染到 `outDir/index.html`，并根据 `manifest.json` 注入生成后的脚本和样式资源。

想精确控制插入位置时，使用显式占位符：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vext App</title>
    %VEXT_STYLES%
  </head>
  <body>
    <div id="root"></div>
    %VEXT_ENTRY%
  </body>
</html>
```

渲染规则如下：

| 占位符或位置 | 渲染结果 |
| --- | --- |
| `%VEXT_STYLES%` | 替换为每个 CSS 产物对应的 `<link rel="stylesheet" ... data-vext-style>`。 |
| `%VEXT_ENTRY%` | 替换为浏览器入口 `<script type="module" ... data-vext-entry></script>`。 |
| 没有 `%VEXT_STYLES%`，但存在 `</head>` | 样式链接插入到 `</head>` 前。 |
| 没有 `%VEXT_ENTRY%`，但存在 `</body>` | 入口脚本插入到 `</body>` 前。 |
| 没有 `</body>` | 生成标签追加到文件末尾。 |
| `indexHtml` 文件不存在 | Vext 写入包含 `<div id="root"></div>` 的最小 shell。 |

`vext build` 后的渲染结果示例：

```html
<link rel="stylesheet" href="/assets/main-ABCD1234.css" data-vext-style>
<script type="module" src="/assets/main-EFGH5678.js" data-vext-entry></script>
```

如果 `publicPath` 配置为 `/app/`，生成链接会变成 `/app/assets/...`。

## 客户端代码示例

生成的 React 入口会挂载到模板里的 `#root`：

```tsx
// src/client/main.tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

默认脚手架为了保持示例自包含，会在浏览器应用里声明一个小型路由契约：

```tsx
// src/client/App.tsx
import { useEffect, useState } from "react";
import { createVextApiClient, isVextApiError } from "vextjs/frontend";

type HelloResponse = { message: string };

const api = createVextApiClient({
  schemaVersion: 1,
  kind: "client-contract",
  source: "routes-manifest",
  generatedAt: "template",
  routes: [
    {
      method: "GET",
      path: "/api/hello",
      operationId: "getApiHello",
      response: { type: "unknown" },
    },
  ],
  warnings: [],
} as const);

export function App() {
  const [message, setMessage] = useState("Loading...");
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .GET("/api/hello")
      .then((data) => {
        setMessage((data as HelloResponse).message);
        setError("");
      })
      .catch((err) => {
        setMessage("Request failed");
        setError(isVextApiError(err) ? err.message : String(err));
      });
  }, []);

  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">vext full-stack</p>
        <h1>{message}</h1>
        {error ? <p className="error">{error}</p> : <p>React client served by vext.</p>}
      </section>
    </main>
  );
}
```

构建还会在开发期写入 `.vext/client/client-contract.json` 与 `.vext/client/api.generated.ts`，生产构建写入 `dist/client/`。这些文件描述当前可见路由 manifest，主要用于工具和产物检查，不应把 `.vext/client/` 或 `dist/client/` 当作源码目录导入。

当前生成契约会刻意把请求与响应 schema reference 保持为 `unknown`。它会从 route manifest 保留 method、path、`operationId`、summary 和 tags，但还不会从运行时 schema 定义里推断完整 body/query/response TypeScript 类型。

## API client helper

`vextjs/frontend` 提供轻量 fetch wrapper，能够理解 Vext 路由契约：

```ts
import { createVextApiClient } from "vextjs/frontend";
import { contract } from "./api-contract";

const api = createVextApiClient(contract, {
  baseUrl: "/",
  headers: {
    "x-client": "web",
  },
});

const hello = await api.GET("/api/hello", {
  query: { locale: "zh-CN" },
});
```

helper 支持：

- `GET`、`POST`、`PUT`、`PATCH` 与 `DELETE` 快捷方法。
- `request(method, path, options)`，可覆盖契约中的任意方法，包括 `HEAD` 与 `OPTIONS`。
- `params` 替换 `/api/users/:id` 这类路径参数。
- `query`、JSON `body`、请求 `headers`、`signal`、自定义 `fetch` 与 `baseUrl`。
- 通过 `VextApiError` 和 `isVextApiError()` 处理非 2xx 响应。
- 自动展开 Vext 的 `{ code: 0, data }` 响应结构。

## 开发、构建与启动

`vext dev` 会把前端构建到 `.vext/client/`，并通过同一个 Vext 服务提供访问。默认 `src/client/**` 或 `public/**` 变更会触发前端重建消息，不会导致后端 cold restart。API、配置、插件、路由、服务、语言包和 preload 仍按既有重载策略处理。

开发产物固定在隐藏的 `.vext/` 下，避免生成的浏览器资源变成源码真相源。

`vext build` 会先编译服务端代码，再用 esbuild 打包浏览器客户端。启用前端时，生产产物包括：

```text
dist/client/
├── assets/
│   ├── main-<hash>.css
│   └── main-<hash>.js
├── api.generated.ts
├── client-contract.json
├── index.html
├── manifest.json
└── size-report.json
```

`vext start` 会服务 `dist/client/index.html`、静态资源与 SPA fallback。fallback 默认排除 API / 文档路径，因此 `/api/**`、`/openapi.json` 和 `/docs/**` 仍进入后端运行时。

SPA fallback 只接管接受 HTML 的 `GET` 与 `HEAD` 请求。JSON 客户端会继续走后端 404 / 错误路径，不会收到 `index.html`；fallback 响应会带上 `Vary: Accept`。

如果 `frontend.enabled` 为 true，但生产环境缺少 `dist/client/index.html`，启动会 fail fast，并提示先执行 `vext build`。

## 外部前端适配器

首个内置目标是 React。未来或用户侧集成可以通过 `defineFrontendAdapter()` 暴露前端适配器：

```ts
import { defineFrontendAdapter } from "vextjs/frontend";

export const customFrontend = defineFrontendAdapter({
  name: "custom",
  framework: "custom",
});
```

当前版本的 adapter 契约刻意保持较小。`defineFrontendAdapter()` 返回 typed metadata，config resolver 会携带 `frontend.adapter`，但当前编译器还不会调用 adapter 专属 build hook。它是预留扩展点：当前实现仍由 Vext 负责路由、manifest 生成、esbuild 打包、静态服务与 API client contract。

## 常见问题

| 现象 | 检查项 |
| --- | --- |
| `frontend entry not found` | 确认 `frontend.entry` 指向项目根目录内的真实文件。 |
| 生产启动提示 frontend output 缺失 | 先执行 `vext build` 再执行 `vext start`，或在 API-only 部署中关闭 `frontend.enabled`。 |
| API 风格路径返回了浏览器应用 | API 客户端发送 `Accept: application/json`，并把该路由前缀加入 `frontend.spaFallback.exclude`。 |
| 资源 URL 缺少子路径 | 将 `frontend.publicPath` 设置为挂载路径，例如 `/app/`。 |
| `publicPath` 配置报错 | 使用 `/app/` 这类路径，不要使用 `https://cdn.example.com/app/` 这类完整 URL。 |
| 源码路径配置报错 | `root`、`entry`、`indexHtml`、`outDir` 和 `publicDir` 必须解析在项目根目录内。 |

## 下一步

- 查看 [构建](/zh/guide/build) 了解生产产物行为。
- 查看 [CLI 命令](/zh/guide/cli) 了解 `vext create` 与 `vext build` 参数。
- 查看 [配置](/zh/guide/configuration) 了解完整 `frontend` 字段。
