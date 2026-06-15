# 前端集成

Vext 内置前端能力用于把 API、浏览器应用、开发期重建、生产构建和静态资源服务放在同一个 Vext 项目里。默认脚手架使用 React 19，浏览器侧 API helper 从 `vextjs/frontend` 导入，后端运行时仍保持框架无关。

当前版本是 P0 前端基础层：它支持单入口浏览器应用、普通 CSS、静态资源、HTML 模板注入、SPA fallback 和 Vext API client helper。它还不是完整应用级前端框架层，因此不会自动扫描 `src/client/pages/**` 生成页面路由，也不内置 nested layout、loader/action、SSR、RSC 或 Server Actions。

## 目录导航

- [1. 什么时候使用 Vext Frontend](#1-什么时候使用-vext-frontend)
- [2. 创建并运行全栈项目](#2-创建并运行全栈项目)
- [3. 看懂生成目录](#3-看懂生成目录)
- [4. 修改首页](#4-修改首页)
- [5. 添加页面文件](#5-添加页面文件)
- [6. 添加组件](#6-添加组件)
- [7. 添加样式](#7-添加样式)
- [8. 添加图片和静态资源](#8-添加图片和静态资源)
- [9. 调用 Vext API](#9-调用-vext-api)
- [10. 配置 frontend](#10-配置-frontend)
- [11. HTML 模板](#11-html-模板)
- [12. 开发、构建和生产启动](#12-开发构建和生产启动)
- [13. API-only 项目如何关闭前端](#13-api-only-项目如何关闭前端)
- [14. 当前边界与下一阶段](#14-当前边界与下一阶段)
- [15. 常见问题](#15-常见问题)
- [16. 维护者参考](#16-维护者参考)

## 1. 什么时候使用 Vext Frontend

适合使用默认前端集成的场景：

- 你希望一个 Vext 项目同时提供 API 和浏览器页面。
- 你希望 `vext dev` 同时运行后端和前端。
- 你只需要一个 React 浏览器入口，并在 `App.tsx` 中组织页面。
- 你希望 `vext build` 同时输出服务端代码和 `dist/client/` 前端资源。
- 你希望生产环境由 `vext start` 服务静态资源和 SPA fallback。

不适合作为当前版本内置能力直接使用的场景：

- 你需要文件路由、嵌套路由、layout、loader/action 或 route-level split。
- 你需要 SSR、React Server Components 或 Server Actions。
- 你要求 Sass、CSS Modules、Tailwind 等能力由 Vext 默认内置。

这些能力会进入后续 P1 应用层设计；当前版本可以由用户自行接入路由库或样式工具，但 Vext 官方默认路径只承诺本文档列出的能力。

## 2. 创建并运行全栈项目

创建默认全栈 React 项目：

```bash
npx vextjs create my-app
cd my-app
npm run dev
```

默认配置端口是 `3000`。开发服务器 ready 后，打开：

```text
http://localhost:3000
```

默认页面会从浏览器调用 `/api/hello`，这个 API 来自 `src/routes/index.ts`。页面本身来自 `src/client/App.tsx`。

如果安装依赖时使用了 `--skip-install`，先执行：

```bash
npm install
npm run dev
```

## 3. 看懂生成目录

默认 TypeScript full-stack 项目会生成这些和前端最相关的文件：

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

| 文件或目录 | 用户应该怎么用 |
| --- | --- |
| `src/client/main.tsx` | 浏览器入口。通常只负责挂载 React 和导入全局样式。 |
| `src/client/App.tsx` | 当前默认页面入口。先从这里改首页、组织页面、调用 API。 |
| `src/client/styles.css` | 默认全局样式。可以继续拆出页面或组件 CSS。 |
| `src/client/index.html` | HTML 模板。用于放 `<title>`、`meta`、`#root` 和 Vext 注入占位符。 |
| `public/` | 公开静态资源目录。适合 favicon、robots、无需 hash 的图片。 |
| `src/routes/index.ts` | 后端 API route 示例。默认提供 `/api/hello` 和 `/api/health`。 |
| `src/config/default.ts` | Vext 配置。默认包含 `frontend` 配置块。 |

不要手写 `.vext/client/` 或 `dist/client/` 里的文件。它们是 Vext 在 dev/build 时生成的前端产物。

## 4. 修改首页

最直接的首页修改入口是 `src/client/App.tsx`。例如把默认页面改成一个简单 dashboard：

```tsx
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
        <p className="eyebrow">Vext dashboard</p>
        <h1>{message}</h1>
        {error ? <p className="error">{error}</p> : <p>React client served by Vext.</p>}
      </section>
    </main>
  );
}
```

修改保存后，`vext dev` 会对默认 `src/client/**` 变更触发前端重建。当前不承诺组件级 HMR；如果浏览器没有自动刷新，手动刷新页面即可。

## 5. 添加页面文件

当前 P0 不会自动扫描 `src/client/pages/**` 生成页面路由。你可以把 `pages` 当作 React 页面组件目录，然后在 `App.tsx` 中手动导入和渲染。

创建页面文件：

```text
src/client/pages/Home.tsx
src/client/pages/About.tsx
```

```tsx
// src/client/pages/Home.tsx
export function Home() {
  return (
    <section>
      <h1>Home</h1>
      <p>Welcome to the Vext frontend.</p>
    </section>
  );
}
```

```tsx
// src/client/pages/About.tsx
export function About() {
  return (
    <section>
      <h1>About</h1>
      <p>This page is rendered by the React client.</p>
    </section>
  );
}
```

在 `App.tsx` 中接入：

```tsx
import { About } from "./pages/About";
import { Home } from "./pages/Home";

export function App() {
  const page = window.location.pathname === "/about" ? "about" : "home";
  return page === "about" ? <About /> : <Home />;
}
```

访问 `/about` 时，Vext 的 SPA fallback 会返回同一个 `index.html`。最终显示哪个页面，由浏览器里的 `App.tsx` 决定。也就是说，`/about` 能被服务端交给浏览器应用，但当前版本不会因为你创建了 `src/client/pages/About.tsx` 就自动生成页面路由。

需要更完整的客户端路由时，可以自行接入 React Router 等用户侧路由库；Vext 当前不会把它作为默认依赖写入脚手架。

## 6. 添加组件

推荐把可复用 UI 放进 `src/client/components/`：

```text
src/client/components/Header.tsx
src/client/components/Button.tsx
```

```tsx
// src/client/components/Header.tsx
export function Header() {
  return (
    <header className="header">
      <strong>Vext App</strong>
      <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
      </nav>
    </header>
  );
}
```

在页面里使用：

```tsx
import { Header } from "../components/Header";

export function Home() {
  return (
    <>
      <Header />
      <main>Home content</main>
    </>
  );
}
```

`components` 是推荐目录约定，不是框架强制扫描目录。你也可以按业务模块拆成 `src/client/features/users/`、`src/client/features/orders/` 等目录。

## 7. 添加样式

默认脚手架使用普通 CSS。全局样式从 `main.tsx` 导入：

```tsx
// src/client/main.tsx
import "./styles.css";
```

页面或组件样式可以跟随文件放置：

```text
src/client/pages/Home.tsx
src/client/pages/Home.css
```

```tsx
// src/client/pages/Home.tsx
import "./Home.css";

export function Home() {
  return <main className="home">Home</main>;
}
```

CSS 会由 esbuild 打包并输出为生产 CSS asset，Vext 会把生成后的 CSS link 注入到 HTML。

当前默认能力只承诺普通 CSS。Sass、CSS Modules、Tailwind、CSS-in-JS 等不是 Vext P0 默认内置能力；你可以在应用侧自行接入，但官方用户指南不把它们写成默认支持。

## 8. 添加图片和静态资源

Vext 当前推荐两类资源放置方式：

| 放置位置 | 适合内容 | 使用方式 |
| --- | --- | --- |
| `public/` | favicon、robots、无需 hash 的公开图片或文件 | 直接用 `/favicon.svg`、`/logo.png` 这类 URL 访问 |
| `src/client/assets/` | 页面 import 的图片、SVG、字体等 | 在 TSX 或 CSS 中 import，由 esbuild 输出 hash asset |

`public/` 示例：

```text
public/logo.png
```

```tsx
export function Header() {
  return <img src="/logo.png" alt="Logo" />;
}
```

`src/client/assets/` 示例：

```text
src/client/assets/hero.png
```

```tsx
import heroUrl from "../assets/hero.png";

export function HomeHero() {
  return <img src={heroUrl} alt="Home hero" />;
}
```

如果 TypeScript 提示图片模块类型缺失，可以在你的应用里补一个声明文件，例如：

```ts
// src/client/assets.d.ts
declare module "*.png" {
  const src: string;
  export default src;
}
```

生成目录仍然不要手写：开发期输出在 `.vext/client/`，生产输出在 `dist/client/`。

## 9. 调用 Vext API

默认模板后端提供：

```text
GET /api/hello
GET /api/health
```

在浏览器侧使用 `vextjs/frontend`：

```tsx
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

try {
  const hello = (await api.GET("/api/hello")) as HelloResponse;
  console.log(hello.message);
} catch (err) {
  if (isVextApiError(err)) {
    console.error(err.status, err.message, err.details);
  } else {
    console.error(err);
  }
}
```

`createVextApiClient()` 支持：

- `GET`、`POST`、`PUT`、`PATCH`、`DELETE` 快捷方法。
- `request(method, path, options)` 调用其他 HTTP 方法。
- `params` 替换 `/api/users/:id` 这类路径参数。
- `query`、JSON `body`、请求 `headers`、`signal`、自定义 `fetch` 和 `baseUrl`。
- 非 2xx 响应抛出 `VextApiError`，可用 `isVextApiError()` 判断。
- 自动展开 Vext `{ code: 0, data }` 响应结构。

当前模板为了自包含，会在 `App.tsx` 中手写一个最小 contract。构建也会输出 `client-contract.json` 和 `api.generated.ts`，但当前生成契约会把请求和响应 schema reference 保持为 `unknown`，还不会从运行时 schema 自动推断完整 TypeScript 类型。

## 10. 配置 frontend

### 最简配置

默认 full-stack React 模板会生成对象形式配置。你也可以用最简写法启用默认值：

```ts
import type { VextUserConfig } from "vextjs";

const config: VextUserConfig = {
  frontend: true,
};

export default config;
```

### 常用配置

```ts
import type { VextUserConfig } from "vextjs";

const config: VextUserConfig = {
  port: 3000,
  adapter: "native",
  frontend: {
    enabled: true,
    framework: "react",
    entry: "src/client/main.tsx",
    indexHtml: "src/client/index.html",
    publicDir: "public",
    publicPath: "/",
    spaFallback: {
      enabled: true,
      exclude: ["/api/**", "/openapi.json", "/docs/**"],
    },
  },
};

export default config;
```

### 配置项参考

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `frontend` | `false` | `true` 启用默认前端；`false` 关闭前端；对象形式可配置字段。 |
| `frontend.enabled` | `false` | 启用内置前端构建与静态服务。 |
| `frontend.framework` | `"react"` | 前端框架标签；当前默认模板是 React。 |
| `frontend.root` | `"src/client"` | 前端源码目录记录值；当前编译主要使用 `entry` 和 `indexHtml`。 |
| `frontend.entry` | `"src/client/main.tsx"` | 浏览器入口文件。缺失时会 fail fast。 |
| `frontend.indexHtml` | `"src/client/index.html"` | HTML 模板文件；缺失时使用最小 fallback shell。 |
| `frontend.outDir` | dev: `.vext/client`；prod: `dist/client` | 前端输出目录。 |
| `frontend.publicDir` | `"public"` | 构建前复制到输出目录的公开静态资源。 |
| `frontend.publicPath` | `"/"` | 生成资源链接的 URL 前缀，必须是路径，不能是完整 URL。 |
| `frontend.spaFallback` | `true` | 为接受 HTML 的浏览器导航路径返回 `index.html`。 |
| `frontend.spaFallback.exclude` | `["/api/**", "/openapi.json", "/docs/**"]` | 保留后端行为的路径。 |
| `frontend.apiClient` | `true` | 生成 `client-contract.json` 和 `api.generated.ts`。 |
| `frontend.build.target` | `"es2022"` | 浏览器构建目标。 |
| `frontend.build.minify` | production 为 `true` | 是否压缩前端产物。 |
| `frontend.build.sourcemap` | development 为 `true` | 是否输出 sourcemap。 |
| `frontend.adapter` | 无 | 预留适配器 metadata 扩展点；当前编译器不会调用 adapter build hook。 |

如果要部署到子路径，例如 `/app/`：

```ts
export default {
  frontend: {
    enabled: true,
    publicPath: "/app/",
  },
};
```

`publicPath` 会影响生成出来的 script、style 和 asset URL。

## 11. HTML 模板

默认模板文件是 `src/client/index.html`：

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

当前可用占位符：

| 占位符或位置 | 渲染结果 |
| --- | --- |
| `%VEXT_STYLES%` | 替换为生成 CSS 对应的 `<link rel="stylesheet" ... data-vext-style>`。 |
| `%VEXT_ENTRY%` | 替换为浏览器入口 `<script type="module" ... data-vext-entry></script>`。 |
| 没有 `%VEXT_STYLES%`，但存在 `</head>` | 样式链接插入到 `</head>` 前。 |
| 没有 `%VEXT_ENTRY%`，但存在 `</body>` | 入口脚本插入到 `</body>` 前。 |
| 没有 `</body>` | 生成标签追加到文件末尾。 |
| `indexHtml` 文件不存在 | Vext 写入包含 `<div id="root"></div>` 的最小 shell。 |

`vext build` 后可能得到：

```html
<link rel="stylesheet" href="/assets/main-ABCD1234.css" data-vext-style>
<script type="module" src="/assets/main-EFGH5678.js" data-vext-entry></script>
```

:::tip
后续 P1 已计划把正式 token 迁移到 `%vext.*%` 风格；当前版本请继续使用 `%VEXT_STYLES%` 和 `%VEXT_ENTRY%`。
:::

## 12. 开发、构建和生产启动

开发：

```bash
npm run dev
```

开发期前端输出在 `.vext/client/`。默认 `src/client/**` 和 `public/**` 变更会触发前端重建，不会触发后端 cold restart。后端 API、配置、路由、service、middleware、plugin、locale、preload 仍按原有后端重载策略处理。

构建：

```bash
npm run build
```

生产前端输出在 `dist/client/`：

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

生产启动：

```bash
npm start
```

`vext start` 只服务已经存在的生产前端产物。启用 `frontend` 但缺少 `dist/client/index.html` 时会 fail fast，并提示先执行 `vext build`。

SPA fallback 只接管接受 HTML 的 `GET` / `HEAD` 浏览器导航请求。默认排除 `/api/**`、`/openapi.json` 和 `/docs/**`，因此 API 或文档路径继续进入后端运行时。

## 13. API-only 项目如何关闭前端

新项目只需要 API 时：

```bash
npx vextjs create my-api --template api --frontend none
```

已有项目要关闭内置前端：

```ts
import type { VextUserConfig } from "vextjs";

const config: VextUserConfig = {
  frontend: false,
};

export default config;
```

或：

```ts
export default {
  frontend: {
    enabled: false,
  },
};
```

关闭后，Vext 不会构建、监听或服务 `src/client/**` / `public/**` 前端资源。

## 14. 当前边界与下一阶段

当前已支持：

- 单个浏览器入口：`src/client/main.tsx`。
- React 19 默认脚手架。
- 普通 CSS import 与 CSS bundle。
- 常见图片、字体、SVG 等 asset import。
- `public/` 静态资源复制。
- HTML 模板注入 `%VEXT_STYLES%` / `%VEXT_ENTRY%`。
- `.vext/client/` 开发输出与 `dist/client/` 生产输出。
- 静态资源服务、缓存头和 SPA fallback。
- `vextjs/frontend` API client helper。

当前尚未支持：

- 自动页面文件路由。
- nested layout、route group、dynamic route、not-found route。
- route loader/action、route-level split、prefetch。
- route 级 head/meta/script/style 管理。
- SSR、streaming、React Server Components、Server Actions。
- 内置 Sass、CSS Modules、Tailwind。

当前替代做法是：在 `App.tsx` 中手动组织页面，或由用户自行接入客户端路由库和样式工具。后续 P1 会单独设计应用级前端路由、layout、loader/action、类型生成、拆包和诊断能力。

## 15. 常见问题

| 现象 | 处理方式 |
| --- | --- |
| 修改页面后没变化 | 确认正在运行 `npm run dev`，文件位于默认 `src/client/**` 下；必要时手动刷新浏览器。 |
| 访问 `/about` 返回同一个 HTML | 这是 SPA fallback。当前需要在 `App.tsx` 或用户自选 router 中根据路径渲染页面。 |
| 创建了 `src/client/pages/About.tsx` 但没有自动路由 | 当前 P0 不扫描 `pages` 目录。请在 `App.tsx` 中导入并渲染。 |
| 图片 404 | `public/logo.png` 用 `/logo.png`；`src/client/assets/logo.png` 需要在 TSX/CSS 中 import。 |
| 生产启动提示缺少前端输出 | 先执行 `npm run build`，再执行 `npm start`。 |
| API 请求拿到 HTML | API 客户端发送 `Accept: application/json`，并把 API 前缀加入 `frontend.spaFallback.exclude`。 |
| 资源 URL 缺少子路径 | 配置 `frontend.publicPath`，例如 `/app/`。 |
| `publicPath` 配置报错 | 使用 `/app/` 这类路径，不要使用 `https://cdn.example.com/app/` 这样的完整 URL。 |
| 想用 Sass、Tailwind 或 CSS Modules | 当前不是默认内置能力，可以在应用侧自行接入。 |
| 想关闭前端 | 使用 `--template api --frontend none` 创建项目，或设置 `frontend: false`。 |

## 16. 维护者参考

普通用户不需要理解这些实现细节即可使用前端集成。维护者排查行为时可以按下面的真相源定位：

| 行为 | 真相源 |
| --- | --- |
| 公开浏览器 helper | `src/frontend/index.ts` |
| 前端配置解析 | `src/frontend/tooling/config-resolver.ts` |
| client contract 写入 | `src/frontend/tooling/client-contract-writer.ts` |
| esbuild 构建与 HTML 渲染 | `src/frontend/tooling/client-build-compiler.ts` |
| 静态资源与 SPA fallback | `src/frontend/runtime/static-mount.ts` |
| dev 前端构建接入 | `src/lib/dev/dev-bootstrap.ts` |
| dev 文件变更分类 | `src/lib/dev/change-classifier.ts`、`src/lib/dev/file-watcher.ts` |
| 生产构建接入 | `src/cli/build.ts` |
| 生产启动静态挂载 | `src/lib/bootstrap.ts` |
| 脚手架生成 | `src/cli/create.ts` |

下一步可继续阅读 [配置](/zh/guide/configuration)、[构建](/zh/guide/build) 和 [CLI 命令](/zh/guide/cli)。
