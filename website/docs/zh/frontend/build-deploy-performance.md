# 构建、发布与性能

## 目录导航

- [样式](#样式)
- [资源](#资源)
- [开发期刷新](#开发期刷新)
- [生产构建](#生产构建)
- [CDN 与增量上传](#cdn-与增量上传)
- [SPA Fallback](#spa-fallback)
- [性能预算](#性能预算)
- [Hydration 验证](#hydration-验证)
- [边界](#边界)

## 样式

Vext 支持普通 CSS、CSS Modules 和 Vext JSCSS。

```tsx
import styles from "@styles/dashboard.module.css";

export default function Dashboard() {
  return <main className={styles.page}>Dashboard</main>;
}
```

JSCSS 是默认动态样式 facade：

```ts
// src/frontend/styles/card.style.ts
import { style, vars } from "vextjs/style";

export const card = style({
  padding: 16,
  borderRadius: 8,
  color: vars.color.text,
});
```

JSCSS 文件会在构建期抽取并合并到最终 CSS 资源中，不默认引入 Emotion 或 styled-components 这类 runtime 依赖。

## 资源

资源有两个位置：

| 位置 | 用途 |
|------|------|
| `src/frontend/assets/**` | 通过 import 引入的图片、字体和文件，进入 esbuild asset graph。 |
| `public/**` | 通过 URL 访问的公共文件，例如 `/favicon.svg` 或 `/robots.txt`。 |

import 型资源在生产构建中带 content hash。`public/**` 会复制到前端输出目录，并写入 deploy manifest。

## 开发期刷新

`vext dev` 会监听 `src/frontend/**` 和 `public/**`。

| 变更 | 结果 |
|------|------|
| React 页面/组件 | 前端重建，能 Fast Refresh 时优先 Fast Refresh |
| 仅 CSS/JSCSS | CSS 更新路径 |
| public 静态资源 | 前端复制/重建 |
| SSR 依赖的 route 或 service 数据 | 后端 soft reload 加可选 render refresh 提示 |

用 `frontend.dev.renderRefresh` 控制 route/service 变更后浏览器是提示刷新、自动刷新还是只记录日志。

## 生产构建

`vext build` 会同时编译服务端和前端。启用前端时会写入：

```text
dist/client/
  index.html
  manifest.json
  render-manifest.json
  deploy-manifest.json
  size-report.json
  assets/
```

浏览器端会按页面、layout、错误页和 locale 做动态 import。Vext-managed vendor chunks 会把共享 runtime 依赖从每个页面 chunk 中拆出来。

`vext start` 要求存在有效的 `dist/client/index.html` 和带 route assets 的 render manifest。如果生产产物缺少 B3 route asset schema，启动会 fail-fast 并提示重新构建。

## CDN 与增量上传

在 `frontend.deploy.upload` 中启用上传：

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
        publicBaseUrl: "https://cdn.example.com/my-app/",
        prefix: "my-app",
        stateFile: ".vext/deploy/frontend-assets-state.json",
        exclude: ["**/*.map"],
      },
    },
  },
};
```

然后执行：

```bash
vext build --upload-assets
vext deploy assets --dry-run
vext deploy assets
```

上传以 `deploy-manifest.json`、sha256 state、content type 和 SRI 为依据。未变化的 JS、CSS、图片、字体和复制后的 `public/**` 资源会跳过。服务端渲染的 `index.html` 默认不上传。

## SPA Fallback

Vext 默认页面模型是 SSR。`spaFallback.scopes[]` 只给明确的 client-router 子应用使用。

```ts
frontend: {
  spaFallback: {
    scopes: [
      {
        basePath: "/app",
        page: "app/shell",
        ssr: false,
      },
    ],
  },
}
```

只有命中 scope 的 HTML 导航会返回 shell 页面。API 请求、JSON 请求、显式 route 和静态资源保持原本行为。

## 性能预算

面向用户体验的预算优先用压缩后体积：

```ts
frontend: {
  build: {
    budgets: {
      maxInitialJsBrotliBytes: 60_000,
      maxRouteInitialJsBrotliBytes: 80_000,
      maxAppOwnedInitialJsBrotliBytes: 40_000,
    },
    diagnostics: {
      performanceReport: true,
      leakScan: true,
    },
  },
}
```

`size-report.json` 包含 raw、gzip、brotli、initial JS、route initial assets、app-owned assets 和 external runtime 分组。预算失败会指出哪个 route 或资源超过阈值。

## Hydration 验证

Vext 使用 DOM marker 和 Performance API 标记 hydration：

- `data-vext-hydration="hydrating"`
- `data-vext-hydration="done"`
- `performance.measure("vext:hydration")`

`vext-test` 消费者项目会用 Playwright 打开真实浏览器页面并检查：

- 没有前端资源加载失败
- 没有异常 HTTP 响应
- 没有 console error
- 当前 route 注入了 `modulepreload`
- hydration marker 到达 `done`
- 存在 `vext:hydration` measure
- `size-report.json` 包含 route 指标

## 边界

当前默认路线是 React 19 SSR + hydration。

本阶段不作为默认能力：

- Vite 作为前端构建器
- React Server Components
- Server Actions
- Qwik 或 Astro 架构切换
- streaming SSR
- 持久客户端 layout 导航
- 内置图片/字体优化组件

这些可以作为后续专项评估。当前优先级是把 esbuild + React hydration 路线做到更快、更小、可观测、可预测。

