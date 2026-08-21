# 前端配置

本页是决策指南，不重复罗列每一个类型成员。先使用默认值，只为产品确实要改变的行为配置字段；需要精确字段、默认值或嵌套选项时，以[VextFrontendConfig API 参考](../api/config#vextfrontendconfig)为准。

## 目录导航

- [最小配置](#最小配置)
- [决定要配置什么](#决定要配置什么)
- [完整示例](#完整示例)
- [生产交付配置形态](#生产交付配置形态)
- [核心字段](#核心字段)
- [Build 字段](#build-字段)
- [Deploy 字段](#deploy-字段)
- [SEO 字段](#seo-字段)
- [I18n 字段](#i18n-字段)
- [Dev 字段](#dev-字段)
- [SPA Fallback 字段](#spa-fallback-字段)
- [验证配置变更](#验证配置变更)

## 决定要配置什么

| 需要什么                   | 先从哪里开始     | 配置项                                                          | 会发生什么                                                                  | 如何验证                                     |
| -------------------------- | ---------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------- |
| SSR React 页面             | `frontend: true` | 不需要其它字段                                                  | Vext 发现 `src/frontend`，构建 browser + SSR 输出，并从应用 origin 提供它们 | `vext build` 后执行 `vext start`             |
| 不同的源码布局             | 内置目录约定     | `root`、`pages`、`componentsDir`、`styles.entry` 或 `assetsDir` | 只改变发现路径，生成 entry 仍由 Vext 管理                                   | build 后加载一个页面和全局样式               |
| 浏览器兼容或体积目标       | 生产默认值       | `build`、`vendorChunks` 或 `budgets`                            | 改变 esbuild 输出、报告阈值或浏览器支持范围                                 | 检查 `size-report.json` 和生产页面           |
| CDN 承担 immutable assets  | 同源交付         | `deploy.assetBaseUrl`，可选 `deploy.upload`                     | 生成的 JS/CSS URL 指向 CDN；HTML/SSR 仍由 Node 负责                         | dry-run upload，再请求 SSR 页面和 hash asset |
| 可被搜索引擎发现的公开页面 | SEO 默认关闭     | `seo`，以及路由/render 元数据                                   | canonical/meta 与可选 sitemap/robots 由框架统一生成                         | 检查两个页面 canonical 与选定 SEO 产物       |
| client-router 子应用       | 不捕获 fallback  | `spaFallback.scopes`                                            | 只有已声明路径会交给 browser shell                                          | 检查 scope 内 URL 与被排除的 `/api/**` URL   |
| 多语言页面文案             | 默认关闭         | `i18n`                                                          | 生成 locale artifacts 与请求感知的 document language                        | build 后请求两个 locale                      |

不要因为字段存在就添加它。默认值刻意保持 runtime 简洁：React + esbuild、SSR 开启、buffered streaming、浏览器代码拆分开启、生产浏览器压缩开启，且没有 CDN/upload adapter。

## 最小配置

```ts
export default {
  frontend: true,
};
```

完全关闭前端：

```ts
export default {
  frontend: false,
};
```

`frontend: true` 使用 `src/frontend`、`pages`、`components`、`styles/index.css` 与 `public` 约定。生产 build 会生成 `dist/client`；浏览器压缩默认开启，浏览器 source map 默认关闭。SSR renderer 是独立 Node bundle，默认不压缩，便于诊断。

## 完整示例

```ts
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
        maxInitialJsBrotliBytes: 60_000,
        maxRouteInitialJsBrotliBytes: 80_000,
        maxAppOwnedInitialJsBrotliBytes: 40_000,
      },
      diagnostics: {
        leakScan: true,
        performanceReport: true,
      },
    },
    deploy: {
      assetBaseUrl: "https://cdn.example.com/my-app/",
      crossOrigin: "anonymous",
      integrity: true,
      upload: {
        enabled: true,
        adapter: "filesystem",
        targetDir: ".vext/frontend-cdn",
        publicBaseUrl: "https://cdn.example.com/my-app/",
        prefix: "my-app",
        stateFile: ".vext/deploy/frontend-assets-state.json",
        exclude: ["**/*.map"],
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
};
```

## 生产交付配置形态

### 同源（默认）

首次生产部署不需要配置 CDN：

```ts
export default {
  frontend: true,
};
```

`vext build` 会写出 `dist/client` 前端 closure；`vext start` 会校验 closure 并由同一个 Node 服务同时提供 assets 和 SSR。当单独静态 origin 没有实际收益时，应保留这条基线。

### CDN 与增量上传

只添加 CDN 路径真正需要的交付字段：

```ts
export default {
  frontend: {
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

`filesystem` 只生成 staging deploy tree。真实云厂商要使用 custom adapter；不会隐式安装 cloud SDK 或 bundler-plugin ecosystem。把 state file 放在 `frontend.outDir` 外，先执行 `vext deploy assets --dry-run`，再部署匹配的 Node `dist/` 输出。

## 核心字段

| 字段                     | 默认值                                              | 含义                                                                              |
| ------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------- |
| `frontend.enabled`       | `false`                                             | 启用内置前端流水线                                                                |
| `frontend.framework`     | `"react"`                                           | 内置 React 支持的框架标签                                                         |
| `frontend.root`          | `"src/frontend"`                                    | 用户前端源码根目录                                                                |
| `frontend.pages`         | 内置 page 约定                                      | page、document 与 error-page 的发现配置                                           |
| `frontend.componentsDir` | `"components"`                                      | 从 `frontend.root` 解析的共享组件目录                                             |
| `frontend.assetsDir`     | `"assets"`                                          | import 型图片、字体与媒体源目录                                                   |
| `frontend.indexHtml`     | `src/frontend/pages/_document.html`                 | Document 模板                                                                     |
| `frontend.outDir`        | dev 为 `.vext/client`，build 为 `dist/client`       | 前端输出目录                                                                      |
| `frontend.publicDir`     | `"public"`                                          | 公共静态资源目录                                                                  |
| `frontend.publicPath`    | `"/"`                                               | 公开资源 URL 前缀                                                                 |
| `frontend.alias`         | 内置 `@frontend/@pages/@components/@styles/@assets` | 前端安全 import alias；不要把整个 `src` alias 到浏览器代码                        |
| `frontend.apiClient`     | `true`                                              | 输出 route/client contract artifacts；不需要生成 client artifact 时才设为 `false` |
| `frontend.errorPages`    | 内置 error-page 约定                                | 把默认或状态码特定 SSR 错误映射到 page                                            |
| `frontend.adapter`       | 无                                                  | 高级兼容 adapter 边界；不是通用 plugin loader                                     |

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

| 字段                                                             | 默认值                | 含义                                                                      |
| ---------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------- |
| `frontend.build.target`                                          | `"es2022"`            | 传给 esbuild 的默认浏览器目标；`build.client.target` 可覆盖               |
| `frontend.build.minify`                                          | 生产期 `true`         | 压缩浏览器产物；与 server renderer 设置独立                               |
| `frontend.build.sourcemap`                                       | 开发期 `true`         | 生成浏览器 source map；生产期默认 `false`                                 |
| `frontend.build.client.assetsDir`                                | `"assets"`            | 浏览器 bundle 资源子目录                                                  |
| `frontend.build.client.entryNames` / `chunkNames` / `assetNames` | `"[name]-[hash]"`     | hash 文件名模式；应保留 hash 以使用 immutable cache                       |
| `frontend.build.client.splitting`                                | `true`                | 启用浏览器代码拆分                                                        |
| `frontend.build.client.external`                                 | `[]`                  | 浏览器 external 模块                                                      |
| `frontend.build.client.externalRuntime`                          | `{}`                  | 浏览器 external 的 import-map URL                                         |
| `frontend.build.server.outFile`                                  | `server/renderer.cjs` | `frontend.outDir` 下的 SSR renderer bundle 文件；默认 `minify` 为 `false` |
| `frontend.build.vendorChunks`                                    | enabled               | 共享 runtime chunk 策略；只在有测量依据时调整 packages                    |
| `frontend.build.budgets`                                         | 全部限制 `0`          | 约束 raw/gzip/brotli 预算；baseline 稳定前使用 `warnOnly`                 |
| `frontend.build.assets.inlineLimit`                              | `0`                   | 小于该字节数的 import 型资源内联                                          |
| `frontend.build.css.modules`                                     | `true`                | 启用 CSS Modules                                                          |
| `frontend.build.diagnostics.leakScan`                            | `true`                | 阻断服务端模块进入浏览器 graph                                            |
| `frontend.build.diagnostics.sizeReport`                          | `true`                | 写入 `size-report.json`                                                   |
| `frontend.build.diagnostics.performanceReport`                   | `true`                | 包含路由级性能指标                                                        |

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

`assetBaseUrl` 必须是绝对 URL。`deploy-manifest.json` 会上传 JS、CSS、import 型媒体和复制的 public 文件；默认不上传 SSR HTML 和 source map。每次更换 adapter、prefix 或 include/exclude 规则前，都要先执行 `vext deploy assets --dry-run`。

## SEO 字段

`frontend.seo` 是框架级 SEO 入口。不配置时关闭；配置该对象后，`enabled` 默认是 `true`。

```ts
frontend: {
  seo: {
    publicOrigin: process.env.PUBLIC_ORIGIN ?? "https://www.example.com",
    titleTemplate: "%s | Example",
    defaults: { description: "Example 应用" },
    sitemap: {},
    robots: {},
  },
}
```

`publicOrigin` 标识部署 origin，Vext 会把它与每个请求 pathname 组合，因此动态页面不会共用一个固定 URL。静态元数据放在路由级 `frontend.seo`；依赖页面数据的元数据放在 `res.render(..., { seo })`。`sitemap` 与 `robots` 均可选择 `"build"` 或 `"runtime"` 模式，有限多域名部署使用命名 `origins`。

动态 canonical、provider、Host 选择、产物与无 hydration 示例见 [SEO、Sitemap 与 Robots](/zh/frontend/seo-sitemap)，完整嵌套字段见 [API 参考](../api/config#vextfrontendconfig)。

## I18n 字段

| 字段                              | 默认值                     | 含义                                      |
| --------------------------------- | -------------------------- | ----------------------------------------- |
| `frontend.i18n.enabled`           | `false`                    | 显式开启后扫描并打包前端页面文案          |
| `frontend.i18n.source`            | `locales`                  | 从 `frontend.root` 解析的 locale 源目录   |
| `frontend.i18n.defaultLocale`     | `"inherit"`                | 前端 fallback locale；默认继承请求 locale |
| `frontend.i18n.detect` / `inject` | `accept-language` / `used` | SSR locale 探测与 message 注入策略        |
| `frontend.i18n.clientLoad`        | `"current"`                | 浏览器 locale 加载模式                    |
| `frontend.i18n.clientSwitch`      | `"reload"`                 | 浏览器 selected locale 变化后的行为       |
| `frontend.i18n.htmlLang`          | `true`                     | 写入请求级 `{vext.lang}` / `<html lang>`  |

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

## 验证配置变更

```bash
# 编译后端、浏览器和 SSR closure。
vext build

# 只在配置 upload 路径时需要；先审阅，再写入。
vext deploy assets --dry-run

# 校验生产 closure 并启动 Node runtime。
vext start
```

修改 build 或 budget 后，检查 `dist/client/size-report.json`。修改 CDN 后，请求一个 SSR 页面和一个 hash browser asset，确认它们属于同一次发布。修改 SPA fallback 后，还应请求一个被刻意排除的 API 路径。较少使用的嵌套字段以[API 参考](../api/config#vextfrontendconfig)为准。
