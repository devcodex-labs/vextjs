# 样式与资源

本页用于已启用前端的[全栈项目](./getting-started)选择并验证样式。以下路径按默认 frontend root 编写；先使用已有页面与布局接入样式，再按需要选择 CSS Modules、JSCSS 和资源交付方式。

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

全局 CSS 适合 reset、基础排版和设计 token。组件局部样式可使用下节的 CSS Modules 或 JSCSS。

文件存在不代表已进入浏览器。沿用[布局与组件](./layouts-and-components)中的根布局，在 `src/frontend/pages/layout.tsx` 顶部加入 `import "../styles/app.css";`，保留原布局导出与 children；也可把现有 `frontend.styles.entry` 指向该文件。不要同时维护两份不同的全局基础样式。

Vext 不会编译 Sass 或 SCSS 源文件。如需 Sass，请在交给 Vext 前由外部工具预编译为 CSS；一等支持的样式源是 CSS、CSS Modules 和 Vext JSCSS。

## CSS Modules

`.module.css` 默认按 CSS Modules 处理。构建器为同一源文件生成一次稳定的 class 映射，浏览器与 SSR 共用；两端的 minify 设置可以独立调整。同名文件位于不同目录时保持独立作用域，支持 `composes`、`:local`、`:global` 与 CSS `@import`。

下面的组件可用于生产 SSR 页面。验证时同时检查服务端 DOM class、实际公开 CSS 选择器和浏览器 computed style；Console 无错误并不能单独证明样式正确。

```css
/* src/frontend/styles/card.module.css */
.card {
  border: 1px solid var(--border, #d1d5db);
  border-radius: 8px;
  padding: 16px;
}
```

```tsx
// src/frontend/components/Card.tsx
import type { ReactNode } from "react";
import styles from "@styles/card.module.css";

export function Card(props: { children: ReactNode }) {
  return <section className={styles.card}>{props.children}</section>;
}
```

组件需要由真实页面 import 并渲染才参与页面；`@styles` 使用解析后的样式目录别名。保留 `frontend.build.css.modules: true` 才符合这里的 class map 用法。

TypeScript 项目还需要模块声明（已有等价声明时复用）：

```ts
// src/frontend/styles.d.ts
declare module "*.module.css" {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
```

## Vext JSCSS

JSCSS 是 Vext 内置的组件级 variants、语义化 CSS variables 与构建期 CSS 抽取路径。先阅读 [Vext JSCSS 教程](/zh/frontend/jscss)：其中说明支持的 `recipe()` rule 写法、React `className` 用法、构建产物，以及 `setVar()` 声明和浏览器改变量之间的区别。extractor 会把 CSS 写入构建产物，因此不需要默认引入 Emotion 或 styled-components runtime。

## CSS Variables

主题、租户或运行时状态需要动态改变值时，使用 CSS variables。

```ts
// src/frontend/styles/panel.style.ts
import { createVar, setVar, style, vars } from "vextjs/style";

export const accent = createVar("accent");

export const panel = style({
  ...vars(setVar(accent, "#4f46e5")),
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: accent,
});
```

将 `panel` 用作元素的 `className`。`setVar()` 只创建抽取 CSS 所需的声明，不会更新 DOM。本例变量声明位于 panel 元素自身，要在浏览器事件或 effect 中对该元素调用 `element.style.setProperty(accent.name, value)`。仅设置 document root 不会覆盖元素自身已有的同名声明；只有把变量定义在根、组件通过继承读取时，才用 `document.documentElement.style.setProperty` 切换全局主题。SSR 和样式模块顶层不能访问 DOM。

## Import 型资源

图片与字体 import 共用浏览器资源登记表：浏览器构建生成公开文件 URL 或 data URL，SSR 导出同一值，不在 server 目录再生成一份资源。支持 PNG、JPEG、GIF、WebP、AVIF、SVG、ICO 及 WOFF/WOFF2/TTF/EOT；URL 遵循 `publicPath` 和 `deploy.assetBaseUrl`，小资源按 `build.assets.inlineLimit` 内联。

准备真实图片文件后，可在已注册的 SSR 页面或公共组件中使用：

```tsx
import logoUrl from "@assets/logo.png";

export function Logo() {
  return <img src={logoUrl} alt="Company" />;
}
```

成功进入浏览器构建的资源可能按配置内联，也可能输出带 content hash 的文件；具体交付以本次 manifest 和部署清单为准，不应把内联资源视为独立上传文件。

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

`public/**` 会复制并登记为公开资源；是否进入上传计划还受 include/exclude 影响。上面的 URL 假设默认 `publicPath: "/"`；手写 img URL 不会因为设置 CDN 自动变成 CDN 地址。

## CDN URL

生产资源由 CDN 服务时设置 `frontend.deploy.assetBaseUrl`。

```ts
export default {
  frontend: {
    enabled: true,
    deploy: {
      assetBaseUrl: "https://cdn.example.com/my-app/",
      crossOrigin: "anonymous",
      integrity: true,
    },
  },
};
```

`assetBaseUrl` 影响生成的资源 URL。上传由 `frontend.deploy.upload`、`vext build --upload-assets` 或 `vext deploy assets` 单独控制。

示例域名需替换为实际 CDN；先用默认同源运行通过再配置，上传和媒体限制详见[静态资源与 CDN](./static-assets-and-cdn)。

## 验证样式

在应用根目录执行 `npm run build`，启动 `npm start -- --port 3000`，访问实际使用样式的页面。检查 CSS 请求成功、class 与生成规则匹配、边框和间距可见；动态变量要观察目标元素的 computed style。分别关闭 JavaScript、完成 hydration 并点击更新，确认样式一致。图片 import 的 SSR URL 应与浏览器 URL 相同，公开文件可请求、内联资源不需要独立上传。结束后停止服务。
