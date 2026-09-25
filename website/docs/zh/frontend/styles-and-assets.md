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

全局 CSS 适合 reset、基础排版和设计 token。当前 SSR 页面需要局部样式时优先使用 JSCSS，CSS Modules 的生产限制见下节。

文件存在不代表已进入浏览器。沿用[布局与组件](./layouts-and-components)中的根布局，在 `src/frontend/layouts/layout.tsx` 顶部加入 `import "../styles/app.css";`，保留原布局导出与 children；也可把现有 `frontend.styles.entry` 指向该文件。不要同时维护两份不同的全局基础样式。

Vext 不会编译 Sass 或 SCSS 源文件。如需 Sass，请在交给 Vext 前由外部工具预编译为 CSS；一等支持的样式源是 CSS、CSS Modules 和 Vext JSCSS。

## CSS Modules

`.module.css` 默认按 CSS Modules 处理，但当前默认生产配置存在 SSR 与浏览器 class 名不一致的限制：浏览器构建开启压缩，服务端 renderer 默认不压缩，同一示例可能分别生成 `.a` 和 `card_card`。实际页面即使没有 console 错误，SSR DOM 仍可能无法匹配浏览器 CSS，导致样式不生效。

在这一命名一致性问题修复前，SSR 页面优先使用普通 CSS 或下节 JSCSS。下面保留 CSS Module 语法和类型声明示例，不作为默认生产 SSR 已通过的使用路径；不能只凭 build 成功或仅修改一个 minify 开关就推定所有页面一致。

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

组件需要由真实页面 import 并渲染才参与页面；`@styles` 使用解析后的样式目录别名。保留 `frontend.build.css.modules: true` 才符合这里的 class map 用法，并按上面的限制逐项核对服务端 class 与浏览器规则。

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

浏览器构建中的 import 型资源由 esbuild 处理；当前 SSR 构建没有对应的图片 loader，不能把下面的图片 import 直接放进 SSR 注册页面或其组件。否则即使类型检查通过，构建仍会失败；仅关闭运行时 SSR 也不会取消这一步构建。默认页面应先使用下节的 Public URL。

下面仅展示资源 import 的代码形态，前提是已有支持该资源 loader、且不被 SSR 入口引用的浏览器入口与真实图片文件：

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

在应用根目录执行 `npm run build`，启动 `npm start -- --port 3000`，访问实际使用样式的页面。检查 CSS 请求成功、class 与生成规则匹配、边框和间距可见；动态变量要观察目标元素的 computed style。CSS Module 若重现上述命名问题，应判为受当前限制影响并切换普通 CSS/JSCSS，不能以 Console 无错误代替样式检查。图片 import 若触发 SSR loader 错误，按上面的 Public URL 或媒体 Image 路径处理。结束后停止服务。
