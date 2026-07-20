# 前端配置

## 目录导航

- [最小配置](#最小配置)
- [完整示例](#完整示例)
- [核心字段](#核心字段)
- [Build 字段](#build-字段)
- [Deploy 字段](#deploy-字段)
- [I18n 字段](#i18n-字段)
- [Dev 字段](#dev-字段)
- [SPA Fallback 字段](#spa-fallback-字段)

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

## 核心字段

| 字段                  | 默认值                                        | 含义                      |
| --------------------- | --------------------------------------------- | ------------------------- |
| `frontend.enabled`    | `false`                                       | 启用内置前端流水线        |
| `frontend.framework`  | `"react"`                                     | 内置 React 支持的框架标签 |
| `frontend.root`       | `"src/frontend"`                              | 用户前端源码根目录        |
| `frontend.indexHtml`  | `src/frontend/pages/_document.html`           | Document 模板             |
| `frontend.outDir`     | dev 为 `.vext/client`，build 为 `dist/client` | 前端输出目录              |
| `frontend.publicDir`  | `"public"`                                    | 公共静态资源目录          |
| `frontend.publicPath` | `"/"`                                         | 公开资源 URL 前缀         |

## Build 字段

| 字段                                           | 默认值                | 含义                                            |
| ---------------------------------------------- | --------------------- | ----------------------------------------------- |
| `frontend.build.target`                        | `"es2022"`            | 传给 esbuild 的浏览器目标                       |
| `frontend.build.minify`                        | 生产期 `true`         | 压缩浏览器产物                                  |
| `frontend.build.sourcemap`                     | 开发期 `true`         | 生成 source map                                 |
| `frontend.build.client.assetsDir`              | `"assets"`            | 浏览器 bundle 资源子目录                        |
| `frontend.build.client.splitting`              | `true`                | 启用浏览器代码拆分                              |
| `frontend.build.client.external`               | `[]`                  | 浏览器 external 模块                            |
| `frontend.build.client.externalRuntime`        | `{}`                  | 浏览器 external 的 import-map URL               |
| `frontend.build.server.outFile`                | `server/renderer.cjs` | `frontend.outDir` 下的 SSR renderer bundle 文件 |
| `frontend.build.vendorChunks`                  | enabled               | 共享 runtime chunk 策略                         |
| `frontend.build.assets.inlineLimit`            | `0`                   | 小于该字节数的 import 型资源内联                |
| `frontend.build.css.modules`                   | `true`                | 启用 CSS Modules                                |
| `frontend.build.diagnostics.leakScan`          | `true`                | 阻断服务端模块进入浏览器 graph                  |
| `frontend.build.diagnostics.sizeReport`        | `true`                | 写入 `size-report.json`                         |
| `frontend.build.diagnostics.performanceReport` | `true`                | 包含路由级性能指标                              |

React 相关 browser external 必须提供 `externalRuntime` 映射，否则构建会用友好诊断失败。

浏览器输出采用目录模式，通过 `frontend.outDir` 配置；不支持 `frontend.build.client.outFile`。Vext 始终生成 SSR、preload、deploy 和验证所需的 frontend manifest family，因此 `build.client.manifest` / `build.server.manifest` 不是配置字段。

## Deploy 字段

| 字段                               | 默认值             | 含义                                                          |
| ---------------------------------- | ------------------ | ------------------------------------------------------------- |
| `frontend.deploy.assetBaseUrl`     | 无                 | CDN / public asset base URL                                   |
| `frontend.deploy.crossOrigin`      | 无                 | 生成标签的 `crossorigin` 值                                   |
| `frontend.deploy.integrity`        | `false`            | 为生成 JS/CSS 添加 SRI integrity                              |
| `frontend.deploy.upload.enabled`   | `false`            | 启用 `vext build --upload-assets` / `vext deploy assets` 上传 |
| `frontend.deploy.upload.adapter`   | 无                 | `filesystem`、`mock` 或自定义 adapter                         |
| `frontend.deploy.upload.stateFile` | `.vext/deploy/...` | 增量上传状态文件                                              |
| `frontend.deploy.upload.exclude`   | `["**/*.map"]`     | 不上传的文件                                                  |

## I18n 字段

| 字段                          | 默认值          | 含义                                     |
| ----------------------------- | --------------- | ---------------------------------------- |
| `frontend.i18n.enabled`       | `true`          | 扫描并打包前端页面文案                   |
| `frontend.i18n.defaultLocale` | 后端默认 locale | 前端 fallback locale                     |
| `frontend.i18n.clientLoad`    | `"current"`     | 浏览器 locale 加载模式                   |
| `frontend.i18n.htmlLang`      | `true`          | 写入请求级 `{vext.lang}` / `<html lang>` |

## Dev 字段

| 字段                         | 默认值     | 含义                                   |
| ---------------------------- | ---------- | -------------------------------------- |
| `frontend.dev.hot`           | `true`     | 启用前端 dev events                    |
| `frontend.dev.fastRefresh`   | `true`     | 尽可能启用 React Fast Refresh          |
| `frontend.dev.renderRefresh` | `"prompt"` | render-data 后端 reload 后的浏览器行为 |

## SPA Fallback 字段

| 字段                           | 默认值                                                       | 含义                                       |
| ------------------------------ | ------------------------------------------------------------ | ------------------------------------------ |
| `frontend.spaFallback.scopes`  | `[]`                                                         | 显式 client-router 子应用 fallback 范围    |
| `frontend.spaFallback.exclude` | `["/api/**", "/openapi.json", "/docs/**", "/_vext/docs/**"]` | fallback 永远不会接管的全局路径            |
| `scopes[].basePath`            | 必填                                                         | shell 负责的 URL 前缀                      |
| `scopes[].page`                | 必填                                                         | `src/frontend/pages/**` 下的 shell page id |
| `scopes[].ssr`                 | `false`                                                      | shell 是否 SSR 渲染                        |
| `scopes[].exclude`             | `[]`                                                         | 不进入 fallback 的路径                     |
| `scopes[].status`              | `200`                                                        | fallback 命中后的 HTTP status              |
