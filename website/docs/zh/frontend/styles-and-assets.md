# 样式与资源

## 目录导航

- [CSS 文件](#css-文件)
- [CSS Modules](#css-modules)
- [Vext JSCSS](#vext-jscss)
- [CSS Variables](#css-variables)
- [Import 型资源](#import-型资源)
- [Public 资源](#public-资源)
- [CDN URL](#cdn-url)

## CSS 文件

全局 CSS 可以放在 `src/frontend/styles/**`，并由页面、layout 或生成入口引用。

```css
/* src/frontend/styles/app.css */
:root {
  color-scheme: light dark;
}

body {
  margin: 0;
}
```

全局 CSS 适合 reset、基础排版和设计 token。组件局部样式优先用组件或 CSS Modules。

## CSS Modules

`.module.css` 默认按 CSS Modules 处理。

```css
/* src/frontend/styles/card.module.css */
.card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
}
```

```tsx
import styles from "@styles/card.module.css";

export function Card(props: { children: React.ReactNode }) {
  return <section className={styles.card}>{props.children}</section>;
}
```

## Vext JSCSS

JSCSS 是 Vext 默认动态样式 facade，面向组件级动态样式和构建期抽取。

```ts
// src/frontend/styles/button.style.ts
import { recipe, style, vars } from "vextjs/style";

export const button = recipe({
  base: style({
    borderRadius: 8,
    padding: "8px 12px",
    color: vars.color.text,
  }),
  variants: {
    intent: {
      primary: style({ background: vars.color.primary }),
      danger: style({ background: vars.color.danger }),
    },
  },
});
```

extractor 会把样式写入构建产物。不需要默认引入 Emotion 或 styled-components 作为 runtime 依赖。

## CSS Variables

主题、租户或运行时状态需要动态改变值时，使用 CSS variables。

```ts
import { createVar, setVar, style } from "vextjs/style";

export const accent = createVar("accent");

export const panel = style({
  [setVar(accent)]: "#4f46e5",
  borderColor: accent,
});
```

变量命名尽量语义化，例如 `color.surface`、`color.text`、`space.md`、`radius.sm`。

## Import 型资源

import 型资源会进入 esbuild 和 Vext manifest。

```tsx
import logoUrl from "@assets/logo.png";

export function Logo() {
  return <img src={logoUrl} alt="Company" />;
}
```

生产构建会给 import 型资源加 content hash，并写入 `manifest.json` 和 `deploy-manifest.json`。

## Public 资源

`public/**` 下的文件保持 URL 访问方式。

```text
public/
  favicon.svg
  robots.txt
  images/social-card.png
```

使用方式：

```tsx
<img src="/images/social-card.png" alt="" />
```

`public/**` 会复制到前端输出目录，并进入上传计划。

## CDN URL

生产资源由 CDN 服务时设置 `frontend.deploy.assetBaseUrl`。

```ts
export default {
  frontend: {
    deploy: {
      assetBaseUrl: "https://cdn.example.com/my-app/",
      crossOrigin: "anonymous",
      integrity: true,
    },
  },
};
```

`assetBaseUrl` 影响生成的资源 URL。上传由 `frontend.deploy.upload`、`vext build --upload-assets` 或 `vext deploy assets` 单独控制。

