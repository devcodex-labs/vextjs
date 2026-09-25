# 前端配置

本页帮助你在已有全栈应用中修改配置。先完成[快速开始](/zh/frontend/getting-started)，再将所需字段合并到 `src/config/default.ts`，保留已有的服务端设置。先使用默认值，只为产品确实要改变的行为配置字段；完整类型成员见[VextFrontendConfig API 参考](../api/config#vextfrontendconfig)。

## 目录导航

- [最小配置](#最小配置)
- [决定要配置什么](#决定要配置什么)
- [完整示例](#完整示例)
- [生产交付配置形态](#生产交付配置形态)
- [核心字段](#核心字段)
- [Render 字段](#render-字段)
- [Style 字段](#style-字段)
- [Build 字段](#build-字段)
- [Deploy 字段](#deploy-字段)
- [SEO 字段](#seo-字段)
- [I18n 字段](#i18n-字段)
- [Dev 字段](#dev-字段)
- [SPA Fallback 字段](#spa-fallback-字段)
- [验证配置变更](#验证配置变更)

## 最小配置

在默认配置中启用前端；页面文件和路由仍需按快速开始准备：

```ts
import type { VextConfigOverride } from "vextjs";

export default {
  frontend: true,
} satisfies VextConfigOverride;
```

`frontend: true` 使用 `src/frontend`、`pages`、`components`、`styles/index.css` 与 `public` 约定。改成对象形式时，需要显式写 `enabled: true`；对象本身不表示启用。生产默认前端输出为 `dist/client`，浏览器压缩开启、source map 关闭；SSR renderer 是独立 Node bundle，默认不压缩。

完全关闭前端可将字段改为 `frontend: false`。同时删除或调整依赖 `res.render()` 的 handler；关闭配置不会自动清除旧生成目录。

## 决定要配置什么

| 需要什么                   | 先从哪里开始     | 配置项                                                          | 会发生什么                                                                   | 如何验证                                     |
| -------------------------- | ---------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------- |
| SSR React 页面             | `frontend: true` | 不需要其它字段                                                  | Vext 发现 `src/frontend`，构建 browser + SSR 输出，并从应用 origin 提供它们  | `vext build` 后执行 `vext start`             |
| 不同的源码布局             | 内置目录约定     | `root`、`pages`、`componentsDir`、`styles.entry` 或 `assetsDir` | 只改变发现路径，生成 entry 仍由 Vext 管理                                    | build 后加载一个页面和全局样式               |
| 浏览器兼容或体积目标       | 生产默认值       | `build.target`、`build.vendorChunks` 或 `build.budgets`         | 改变 esbuild 输出、报告阈值或浏览器支持范围                                  | 检查 `size-report.json` 和生产页面           |
| CDN 承担 immutable assets  | 同源交付         | `deploy.assetBaseUrl`，可选 `deploy.upload`                     | 生成的 JS/CSS URL 指向 CDN；HTML/SSR 仍由 Node 负责                          | dry-run upload，再请求 SSR 页面和 hash asset |
| 可被搜索引擎发现的公开页面 | 未配置全局 SEO   | `seo`，以及路由/render 元数据                                   | canonical/meta 与可选 sitemap/robots 由框架统一生成                          | 检查两个页面 canonical 与选定 SEO 产物       |
| client-router 子应用       | 不捕获 fallback  | `spaFallback.scopes`                                            | 只有已声明路径会交给 browser shell                                           | 检查 scope 内 URL 与被排除的 `/api/**` URL   |
| 多语言页面文案             | 默认关闭         | `i18n`                                                          | 生成 locale artifacts，document language 取显式 render locale 或具体默认语言 | build 后请求两个 locale                      |

不要因为字段存在就添加它。全局默认使用 React + esbuild、SSR 开启、buffered streaming、浏览器代码拆分开启、生产浏览器压缩开启，且没有 CDN 地址、上传默认关闭（默认上传 adapter 是 filesystem）。全栈模板另外显式配置了 streaming: auto 和前端国际化；以应用实际配置为准。

## 完整示例

以下是可用于默认全栈模板的同源配置对象，展示各字段的层级；大多数值与默认一致，不要求全部手写。预算数字仅作演示，先以 `warnOnly: true` 收集数据。模板已有 `en-US` 词典，因此示例显式开启前端国际化。

```ts
import type { VextConfigOverride } from "vextjs";

export default {
  frontend: {
    enabled: true,
    framework: "react",
    root: "src/frontend",
    publicDir: "public",
    publicPath: "/",
    styles: {
      jscss: { enabled: true },
    },
    dev: {
      hot: true,
      fastRefresh: true,
      renderRefresh: "prompt",
    },
    build: {
      target: "es2022",
      minify: true,
      sourcemap: false,
      client: {
        external: [],
        externalRuntime: {},
      },
      vendorChunks: {
        enabled: true,
        packages: ["react", "react-dom", "react-dom/client"],
      },
      assets: {
        inlineLimit: 0,
      },
      css: {
        modules: true,
      },
      budgets: {
        warnOnly: true,
        maxInitialJsBrotliBytes: 60_000,
        maxRouteInitialJsBrotliBytes: 80_000,
        maxAppOwnedInitialJsBrotliBytes: 40_000,
      },
      diagnostics: {
        leakScan: true,
        performanceReport: true,
      },
    },
    i18n: {
      enabled: true,
      defaultLocale: "en-US",
      clientLoad: "current",
    },
    spaFallback: {
      scopes: [],
    },
    apiClient: true,
  },
} satisfies VextConfigOverride;
```

## 生产交付配置形态

### 同源（默认）

首次生产部署不需要配置 CDN：

```ts
export default {
  frontend: true,
};
```

`vext build` 会写出配套的前端 manifest、浏览器资源和 SSR renderer；`vext start` 会检查这些生产产物，并由同一个 Node 服务同时提供资源与 SSR 页面。输出目录有定制时以解析后的路径为准，详见[构建指南](/zh/guide/build)。

### CDN 与增量上传

已经有可用 CDN 时，再合并下面的可选配置。先把示例域名替换为实际资源地址；直接复制示例域名会让浏览器无法加载所需资源。

```ts
export default {
  frontend: {
    enabled: true,
    deploy: {
      assetBaseUrl: "https://cdn.example.com/my-app/",
      integrity: true,
      upload: {
        enabled: true,
        adapter: "filesystem",
        targetDir: ".vext/frontend-cdn",
        stateFile: ".vext/deploy/frontend-assets-state.json",
        exclude: ["**/*.map"],
      },
    },
  },
};
```

`filesystem` 只把选定资源复制到本地 staging 目录，不会把文件自动发布到示例域名；云端交付需使用自定义 adapter 或既有发布流程。把 state file 放在 `frontend.outDir` 外，先构建，再执行 `vext deploy assets --dry-run` 检查计划；dry-run 不上传资源。实际资源就绪后再部署同次构建的 Node 输出。完整步骤见[静态资源与 CDN](/zh/frontend/static-assets-and-cdn)。

## 核心字段

| 字段                     | 默认值                                                                    | 含义                                                                              |
| ------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `frontend.enabled`       | `false`                                                                   | 启用内置前端流水线                                                                |
| `frontend.framework`     | `"react"`                                                                 | 内置 React 支持的框架标签                                                         |
| `frontend.root`          | `"src/frontend"`                                                          | 用户前端源码根目录                                                                |
| `frontend.pages`         | 内置 page 约定                                                            | page、document 与 error-page 的发现配置                                           |
| `frontend.componentsDir` | `"components"`                                                            | 从 `frontend.root` 解析的共享组件目录                                             |
| `frontend.assetsDir`     | `"assets"`                                                                | import 型图片、字体与媒体源目录                                                   |
| `frontend.indexHtml`     | 跟随解析后的 `pages.document`（默认 `src/frontend/pages/_document.html`） | Document 模板；显式配置相对项目根                                                 |
| `frontend.outDir`        | dev 为 `.vext/client`，build 为 `dist/client`                             | 前端输出目录                                                                      |
| `frontend.publicDir`     | `"public"`                                                                | 公共静态资源目录                                                                  |
| `frontend.publicPath`    | `"/"`                                                                     | 公开资源 URL 前缀                                                                 |
| `frontend.alias`         | 内置 `@frontend/@pages/@components/@styles/@assets`                       | 前端安全 import alias；不要把整个 `src` alias 到浏览器代码                        |
| `frontend.apiClient`     | `true`                                                                    | 输出 route/client contract artifacts；不需要生成 client artifact 时才设为 `false` |
| `frontend.errorPages`    | 内置 error-page 约定                                                      | 把默认或状态码特定 SSR 错误映射到 page                                            |
| `frontend.adapter`       | 无                                                                        | 公开类型保留的扩展字段；当前内置构建/渲染链未调用其方法，不应据此接入通用插件     |

目录字段的相对基准与 TypeScript paths 同步见[项目结构](/zh/frontend/project-structure)。`assetsDir` 和 alias 不会自动补齐 SSR 图片 import 的 loader，当前页面使用 Public URL 的边界也见该页。

## Render 字段

| 字段                        | 默认值       | 含义                                                                                |
| --------------------------- | ------------ | ----------------------------------------------------------------------------------- |
| `frontend.render.ssr`       | `true`       | 默认执行 SSR；本次 render 的 ssr 选项可覆盖，路由 clientOnly 也会关闭服务端页面正文 |
| `frontend.render.streaming` | `"buffered"` | `auto` 在条件允许时使用流式传输；不是所有 Adapter/响应路径都保证流式                |
| `frontend.render.fallback`  | `"client"`   | buffered SSR 失败时的回退策略；可设为 `"error"`                                     |
| `frontend.render.timeoutMs` | `3000`       | 渲染超时预算，单位毫秒                                                              |
| `frontend.render.layout`    | `true`       | 已解析但当前布局选择链未使用此全局值；控制布局请使用 res.render 第三个参数的 layout |

渲染基础见[SSR](/zh/frontend/ssr)，模式选择见[渲染模式](/zh/frontend/rendering-modes)。同步 SSR 的超时是在渲染返回后检查，不会抢占同步 JavaScript 执行；流式响应开始发送后的失败也不能按普通 buffered 响应重写。关闭 SSR 与关闭浏览器 hydration 是不同设置，后者见[Hydration](/zh/frontend/hydration)。

## Style 字段

| 字段                                   | 默认值                                          | 含义                                                                   |
| -------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| `frontend.styles.entry`                | `styles/index.css`                              | 从 `frontend.root` 解析的全局 CSS 入口                                 |
| `frontend.styles.jscss.enabled`        | `true`                                          | 启用 Vext JSCSS 抽取                                                   |
| `frontend.styles.jscss.files`          | `**/*.style.ts`, `**/*.style.js`, `**/*.css.ts` | JSCSS source globs                                                     |
| `frontend.styles.jscss.runtimeAdapter` | `css-variables`                                 | 以 CSS custom properties 输出动态变量；`none`/`false` 使用 fallback 值 |
| `frontend.styles.jscss.dynamicVars`    | `true`                                          | 输出 custom property 声明与 `var(...)` 引用                            |
| `frontend.styles.jscss.recipes`        | `true`                                          | 输出 recipe variant class 与 rules                                     |

## Build 字段

| 字段                                                             | 默认值                                | 含义                                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `frontend.build.target`                                          | `"es2022"`                            | 传给 esbuild 的默认浏览器目标；`build.client.target` 可覆盖                                           |
| `frontend.build.minify`                                          | 生产期 `true`                         | 压缩浏览器产物；与 server renderer 设置独立                                                           |
| `frontend.build.sourcemap`                                       | 开发期 `true`                         | 生成浏览器 source map；生产期默认 `false`                                                             |
| `frontend.build.client.assetsDir`                                | `"assets"`                            | 浏览器 bundle 资源子目录                                                                              |
| `frontend.build.client.entryNames` / `chunkNames` / `assetNames` | `"[name]-[hash]"`                     | hash 文件名模式；应保留 hash 以使用 immutable cache                                                   |
| `frontend.build.client.splitting`                                | `true`                                | 启用浏览器代码拆分                                                                                    |
| `frontend.build.client.external`                                 | `[]`                                  | 浏览器 external 模块                                                                                  |
| `frontend.build.client.externalRuntime`                          | `{}`                                  | 浏览器 external 的 import-map URL                                                                     |
| `frontend.build.server.outFile`                                  | `frontend.outDir/server/renderer.cjs` | SSR bundle；显式值相对项目根解析，必须仍在 frontend.outDir 内。server.minify 默认 false               |
| `frontend.build.vendorChunks`                                    | enabled                               | 共享 runtime chunk 策略；只在有测量依据时调整 packages                                                |
| `frontend.build.budgets`                                         | 全部限制 `0`                          | 约束 raw/gzip/brotli 预算；baseline 稳定前使用 `warnOnly`                                             |
| `frontend.build.assets.inlineLimit`                              | `0`                                   | 0 不启用；支持的浏览器资源大小不超过此值时可内联，不补齐 SSR 图片 loader                              |
| `frontend.build.css.modules`                                     | `true`                                | 启用 CSS Modules；默认生产 SSR 的 class 命名一致性限制见[样式与资源](./styles-and-assets#css-modules) |
| `frontend.build.diagnostics.leakScan`                            | `true`                                | 阻断服务端模块进入浏览器 graph                                                                        |
| `frontend.build.diagnostics.sizeReport`                          | `true`                                | 写入 `size-report.json`                                                                               |
| `frontend.build.diagnostics.performanceReport`                   | `true`                                | 包含路由级性能指标                                                                                    |

React 相关 browser external 必须提供 `externalRuntime` 映射，否则构建会用友好诊断失败。

浏览器输出采用目录模式，通过 `frontend.outDir` 配置；不支持 `frontend.build.client.outFile`。Vext 始终生成 SSR、preload、deploy 和验证所需的 frontend manifest family，因此 `build.client.manifest` / `build.server.manifest` 不是配置字段。

普通产品应保持浏览器代码拆分、hash 命名和 Vext-managed vendor entry 开启。先以 warning 形式配置预算，检查 `size-report.json` 中的完整 route closure，再把预算转成 release 阻断门禁。

## Deploy 字段

| 字段                                            | 默认值                                    | 含义                                                          |
| ----------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| `frontend.deploy.assetBaseUrl`                  | 无                                        | CDN / public asset base URL                                   |
| `frontend.deploy.crossOrigin`                   | 无                                        | 生成标签的 `crossorigin` 值                                   |
| `frontend.deploy.integrity`                     | `false`                                   | 为生成 JS/CSS 添加 SRI integrity                              |
| `frontend.deploy.upload.enabled`                | `false`                                   | 启用 `vext build --upload-assets` / `vext deploy assets` 上传 |
| `frontend.deploy.upload.adapter`                | `"filesystem"`                            | `filesystem`、`mock` 或自定义 adapter                         |
| `frontend.deploy.upload.targetDir`              | 开启时为 `.vext/deploy/frontend-assets`   | `filesystem` 的本地 staging 目标目录                          |
| `frontend.deploy.upload.publicBaseUrl`          | 无                                        | upload 报告的可选公开 URL；filesystem 回退到 `assetBaseUrl`   |
| `frontend.deploy.upload.prefix` / `concurrency` | `""` / `4`                                | upload key 命名空间与并行度                                   |
| `frontend.deploy.upload.stateFile`              | `.vext/deploy/frontend-assets-state.json` | 增量上传状态文件                                              |
| `frontend.deploy.upload.exclude`                | `["**/*.map"]`                            | 不上传的文件                                                  |

`assetBaseUrl` 必须是绝对 URL。`deploy-manifest.json` 描述本次可交付的 JS、CSS、已产出的媒体和选中的 public 文件；生成清单本身不会上传。默认排除 source map，SSR renderer 和入口 HTML 不作为 CDN 上传资源。每次更换 adapter、prefix 或 include/exclude 规则前，都要先执行 `npx vextjs deploy assets --dry-run`。

## SEO 字段

`frontend.seo` 是全局 SEO 配置入口；配置该对象后，`enabled` 默认是 `true`。未配置该对象时，显式 route/render SEO 仍可生效；sitemap/robots 需要各自配置。显式 `enabled: false` 关闭结构化 SEO，legacy head 仍独立生效。

```ts
import type { VextConfigOverride } from "vextjs";

export default {
  frontend: {
    enabled: true,
    seo: {
      publicOrigin: process.env.PUBLIC_ORIGIN ?? "https://www.example.com",
      titleTemplate: "%s | Example",
      defaults: { description: "Example 应用" },
      sitemap: {},
      robots: {},
    },
  },
} satisfies VextConfigOverride;
```

使用前将 `publicOrigin` 换成真实公开 origin。未显式覆盖 canonical 时，Vext 会结合请求 pathname 生成页面 URL。静态元数据放在路由级 `frontend.seo`；依赖页面数据的元数据放在 `res.render(..., { seo })`。`sitemap` 与 `robots` 均可选择 `"build"` 或 `"runtime"` 模式，空对象默认 build；有限多域名部署使用命名 `origins`。

动态 canonical、provider、Host 选择、产物与无 hydration 示例见 [SEO、Sitemap 与 Robots](/zh/frontend/seo-sitemap)，完整嵌套字段见 [API 参考](../api/config#vextfrontendconfig)。

## I18n 字段

| 字段                              | 默认值                           | 含义                                                                               |
| --------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| `frontend.i18n.enabled`           | `false`                          | 显式开启后扫描并打包前端页面文案                                                   |
| `frontend.i18n.source`            | `locales`                        | 从 `frontend.root` 解析的 locale 源目录                                            |
| `frontend.i18n.defaultLocale`     | `"inherit"`                      | fallback 配置值；当前不会自动继承 req.locale，应填写具体语言或显式传 render locale |
| `frontend.i18n.detect` / `inject` | `["accept-language"]` / `"used"` | 已解析的声明字段；当前渲染链未实现自动探测或按组件裁剪消息                         |
| `frontend.i18n.clientLoad`        | `"current"`                      | 浏览器 locale 加载模式                                                             |
| `frontend.i18n.clientSwitch`      | `"reload"`                       | 声明字段；语言选择与页面导航需由应用实现                                           |
| `frontend.i18n.htmlLang`          | `true`                           | 写入请求级 `{vext.lang}` / `<html lang>`                                           |
| `frontend.i18n.vary`              | `true`                           | 声明字段；当前不自动追加语言 Vary，需应用按实际语言来源配置缓存                    |

完整可运行示例与 SSR/浏览器加载边界见[前端多语言](./i18n)。表中的声明字段不能作为已实现能力或自动行为的证据。

## Dev 字段

| 字段                         | 默认值     | 含义                                                     |
| ---------------------------- | ---------- | -------------------------------------------------------- |
| `frontend.dev.hot`           | `true`     | 启用前端 dev events                                      |
| `frontend.dev.fastRefresh`   | `true`     | 尽可能启用 React Fast Refresh                            |
| `frontend.dev.transport`     | `"sse"`    | Vext development event bus 传输；不是可选 WebSocket 模式 |
| `frontend.dev.overlay`       | `true`     | 显示前端 rebuild 错误与 render refresh 浏览器提示 UI     |
| `frontend.dev.debounceMs`    | `50`       | 合并连续文件变更后再触发 rebuild                         |
| `frontend.dev.renderRefresh` | `"prompt"` | render-data 后端 reload 后的浏览器行为                   |

`frontend.dev.overlay` 只控制前端浏览器开发 UI。后端异常 HTML overlay 由顶层 `dev.errorOverlay` 单独配置。

## SPA Fallback 字段

| 字段                           | 默认值                                                       | 含义                                       |
| ------------------------------ | ------------------------------------------------------------ | ------------------------------------------ |
| `frontend.spaFallback.enabled` | `true`                                                       | 仅启用仲裁；没有 scope 时不会捕获任何页面  |
| `frontend.spaFallback.scopes`  | `[]`                                                         | 显式 client-router 子应用 fallback 范围    |
| `frontend.spaFallback.exclude` | `["/api/**", "/openapi.json", "/docs/**", "/_vext/docs/**"]` | fallback 永远不会接管的全局路径            |
| `scopes[].basePath`            | 必填                                                         | shell 负责的 URL 前缀                      |
| `scopes[].page`                | 必填                                                         | `src/frontend/pages/**` 下的 shell page id |
| `scopes[].ssr`                 | `false`                                                      | shell 是否 SSR 渲染                        |
| `scopes[].exclude`             | `[]`                                                         | 不进入 fallback 的路径                     |
| `scopes[].status`              | `200`                                                        | fallback 命中后的 HTTP status              |

应声明单独 scope，而不是全站 catch-all。API、OpenAPI 和文档路由默认被排除，避免 client-router shell 遮住运维 endpoint。

`spaFallback: true` 是一个特别分支：它创建根路径 `/`、page 为 `index` 的 scope；不等于省略配置。自定义全局 `exclude` 会替换默认数组，需自行保留所需排除项。Fallback 还受请求方法、Accept 和已有路由等条件约束，详见[CSR 与 SPA Fallback](/zh/frontend/csr-and-spa-fallback)。当前空 shell 仍由 `hydrateRoot` 接管，会出现 mismatch 后恢复渲染；建议显式设置 scope 的 `ssr: true`，具体边界见该页“空 shell 的当前限制”。

## 验证配置变更

```bash
# 默认 TypeScript 模板包含类型检查，并构建后端、浏览器与 SSR。
npm run build

# 若启用了 upload，只预览计划，不上传。
npx vextjs deploy assets --dry-run

# 启动配套生产产物。
npm start -- --port 3000
```

先停止占用端口的开发服务；没有配置 upload 时跳过 dry-run 命令。同源示例应保留快速开始中的页面正文与可加载资源。修改 build 或 budget 后，检查当前输出目录的 `size-report.json`；`warnOnly: true` 允许超预算告警，未设该项且超出启用的预算会使构建失败。修改 CDN 后，请求一个 SSR 页面和其实际引用的浏览器资源，确认来自同次构建；实际 CDN 可达性需在真实部署环境验证。修改 SPA fallback 后，既验证 scope 内路径，也请求明确排除的 API 路径。验证后按 Ctrl+C 停止服务。较少使用的嵌套字段以[API 参考](../api/config#vextfrontendconfig)为准。
