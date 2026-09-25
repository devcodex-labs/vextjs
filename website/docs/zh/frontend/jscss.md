# Vext JSCSS

## 目录导航

- [何时使用 JSCSS](#何时使用-jscss)
- [跑通第一个组件样式](#跑通第一个组件样式)
- [构建后如何进入浏览器](#构建后如何进入浏览器)
- [常见样式任务](#常见样式任务)
- [CSS Variables：构建期声明与浏览器改值](#css-variables构建期声明与浏览器改值)
- [配置怎么选](#配置怎么选)
- [排错](#排错)

## 何时使用 JSCSS

Vext JSCSS 会在构建期把 TypeScript 对象转换为 CSS class。组件需要有名字的 variants、语义化 CSS variables 或嵌套规则，同时希望规则在构建期抽取为 CSS 时，可以使用它。客户端仍可能执行 class-name/variant 辅助函数，但不依赖第三方样式 runtime 注入 CSS。

按需求选择最小的工具：

| 需求                                            | 优先使用         | 原因                                                                                           |
| ----------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| reset、排版、页面级 token                       | CSS 文件         | 有意维护的一份全局样式最容易检查。                                                             |
| 规则固定的局部组件                              | JSCSS 或普通 CSS | 当前默认生产 SSR 的 CSS Module 命名存在限制，见[样式与资源](./styles-and-assets#css-modules)。 |
| 有 variants、CSS variables 或生成嵌套规则的组件 | Vext JSCSS       | 类型化 rule object 会生成 CSS 和 class-name 函数。                                             |

Vext 不会编译 Sass 或 SCSS 源文件。如果团队继续使用 Sass，请先在交给 Vext 前编译为 CSS。JSCSS 不是 Sass 的替代品；它是 Vext 内置的、面向组件的类型化生成 CSS 路径。

## 跑通第一个组件样式

在已完成[全栈快速开始](./getting-started)的应用中，在 `*.style.ts` 定义有名字的 recipe，再在 React 的 `className` 中调用。下面补齐样式、组件、页面与路由；保留默认开启的 JSCSS 即可。

### 1. 定义按钮 recipe

创建 `src/frontend/styles/button.style.ts`。

<!-- jscss-user-guide:button-style:start -->

```ts
import { createVar, recipe } from "vextjs/style";

const colorText = createVar("color-text", "#111827");
const colorPrimary = createVar("color-primary", "#2563eb");
const colorDanger = createVar("color-danger", "#dc2626");

export const button = recipe({
  name: "button",
  base: {
    borderRadius: 8,
    padding: "8px 12px",
    border: 0,
    color: colorText,
  },
  variants: {
    intent: {
      primary: { backgroundColor: colorPrimary },
      danger: { backgroundColor: colorDanger },
    },
  },
  defaultVariants: { intent: "primary" },
});
```

<!-- jscss-user-guide:button-style:end -->

`recipe()` 的 `base` 和 `variants` 接收的是 rule object。`style()` 已经返回 class-name 字符串，因此不要在 recipe 内写成 `base: style({ ... })` 或 `primary: style({ ... })`。给 recipe 设置 `name`，在检查 HTML 或 CSS 时就能识别生成的 class。

### 2. 在 React 组件中使用 recipe

创建 `src/frontend/components/Button.tsx`。

<!-- jscss-user-guide:button-component:start -->

```tsx
import type { ReactNode } from "react";
import { button } from "../styles/button.style.js";

export function Button(props: {
  intent?: "primary" | "danger";
  children: ReactNode;
}) {
  return (
    <button className={button({ intent: props.intent ?? "primary" })}>
      {props.children}
    </button>
  );
}
```

<!-- jscss-user-guide:button-component:end -->

`button({ intent: "primary" })` 会返回 base class 和匹配的 variant class。因为示例设置了默认 variant，所以没有选择时调用 `button()` 也会得到 primary 按钮。

### 3. 从页面渲染它

创建页面和明确的 HTTP 路由。默认 NodeNext 模板的相对 TypeScript 导入使用 `.js` 扩展名，框架 alias 则沿用模板已有映射。

```tsx
// src/frontend/pages/settings.tsx
import { Button } from "@components/Button";

export default function SettingsPage() {
  return <Button intent="danger">删除项目</Button>;
}
```

```ts
// src/routes/settings.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, (_req, res) => res.render("settings"));
});
```

`/settings` 应显示 danger 样式按钮；这里只演示外观，按钮没有绑定删除行为。

## 构建后如何进入浏览器

执行正常的生产构建：

```bash
npm run build
```

Vext 默认在 `frontend.root`（默认 `src/frontend`）下扫描 `**/*.style.ts`、`**/*.style.js` 和 `**/*.css.ts`，在 Node 构建步骤执行匹配模块及其依赖，把规则写入生成的 JSCSS CSS；这不只限于被某个页面 import 的样式文件。生成 browser entry 引用 CSS，client asset manifest 再将其带入文档。自定义扫描范围通过 `frontend.styles.jscss.files` 调整。

这条路径不需要默认引入 Emotion 或 styled-components runtime。`style()` 或 `recipe()` 返回的 `className` 就是 React 与抽取 CSS 之间的连接。

`*.style.ts` 模块在 Node 构建步骤中执行，因此它应当只放声明；不要在模块顶层读取 `window`、`document`、请求数据或 server-only service。

## 常见样式任务

### 生成一个有名字的 class

只有一个 class 时使用 `style()`：

```ts
import { style } from "vextjs/style";

export const card = style(
  {
    padding: 16,
    borderRadius: 12,
    backgroundColor: "white",
  },
  { name: "card" },
);
```

在 CSS 期望长度的属性上，数字会转为像素值；`opacity`、`zIndex`、`fontWeight` 等无单位属性会保持无单位。

### 加入 hover 和 media 规则

嵌套 selector 使用 `&`，at-rule 仍放在同一个对象中：

下面替换上一段样式声明，沿用该文件已有的 `style` import：

```ts
export const card = style(
  {
    padding: 12,
    "&:hover": { transform: "translateY(-1px)" },
    "@media (min-width: 640px)": { padding: 16 },
  },
  { name: "card" },
);
```

### 在渲染期选择 variant

有限的视觉选择使用 recipe。选择名应描述组件含义（如 `intent`、`size`、`state`），不要照搬原始 CSS 值。

```tsx
<Button intent={isDestructive ? "danger" : "primary"}>保存</Button>
```

这是组件内的使用片段，`isDestructive` 由应用已有 props/state 提供。当前 recipe 选择以字符串键解析，未知选择值不会生成新规则；不要把运行时任意字符串当成已声明 variant，也不要假定函数提供所有 variant 名的编译期穷举校验。

## CSS Variables：构建期声明与浏览器改值

`createVar()` 创建语义化 CSS custom-property 引用。`setVar()` 返回可放进 JSCSS rule 的对象；它本身不会修改浏览器 document。

```ts
import { createVar, setVar, style, vars } from "vextjs/style";

export const accent = createVar("accent", "#4f46e5");

export const panel = style(
  {
    ...vars(setVar(accent, "#4f46e5")),
    borderColor: accent,
  },
  { name: "panel" },
);
```

上例在 panel 元素上生成初始变量声明和 `var(--vext-accent, #4f46e5)` 引用。若需要在 hydration 后变化，应在事件处理器或 effect 中更新该元素；下面的 `element` 是已取得的 panel HTMLElement，`accent` 从样式模块导入：

```ts
element.style.setProperty(accent.name, "#7c3aed");
```

不能在样式模块顶层或 SSR render 中访问 DOM。仅设置根元素的同名变量，不会覆盖 panel 自身声明；全局主题应把变量定义移到根元素、组件通过继承读取，再用 `document.documentElement.style.setProperty` 改值。`createVar()` 返回变量描述对象；直接作为 JSCSS 属性值使用，若需要字符串形式，使用其 `ref`，不能把整个对象插值成 CSS 字符串。

## 配置怎么选

JSCSS 默认已经启用。只有在明确的交付约束下才需要改变设置：

| 设置                                   | 默认值            | 什么时候改                                                 |
| -------------------------------------- | ----------------- | ---------------------------------------------------------- |
| `frontend.styles.jscss.enabled`        | `true`            | 只有项目完全不用 JSCSS source 时才设为 `false`。           |
| `frontend.styles.jscss.files`          | JSCSS file globs  | 项目确实需要另一种 source suffix 时再扩展。                |
| `frontend.styles.jscss.runtimeAdapter` | `"css-variables"` | 必须将 CSS variables 解析为静态 fallback 时设为 `"none"`。 |
| `frontend.styles.jscss.dynamicVars`    | `true`            | 生成产物不能包含变量声明或 `var(...)` 引用时设为 `false`。 |
| `frontend.styles.jscss.recipes`        | `true`            | 明确不需要 recipe variant class 时设为 `false`。           |

完整字段和默认值请查看 [前端配置](/zh/frontend/configuration)。

## 排错

| 现象                         | 先检查                                                                             | 恢复方式                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 没有生成 class CSS           | 文件是否在 `src/frontend/**` 下，且匹配 `*.style.ts`、`*.style.js` 或 `*.css.ts`。 | 移动或改名后再次执行 `npm run build`。                                        |
| `string` 不能赋给 JSCSS rule | 把 `style()` 返回值嵌进了 `recipe().base` 或 `recipe().variants`。                 | 像第一个例子一样，向 recipe 传入原始 rule object。                            |
| 修改主题没有效果             | 把 `setVar()` 当作 DOM 更新，或只改 root 但元素有自己的变量声明。                  | 在浏览器事件/effect中对实际目标元素 setProperty；全局主题先统一变量定义位置。 |
| 样式模块在 build 时失败      | 模块顶层读取了浏览器全局变量或请求/server state。                                  | 保持声明式；将浏览器工作移入 effect 或事件处理器。                            |
| 需要 Sass 语法               | Vext 没有一等 Sass/SCSS compiler。                                                 | 在外部将 Sass 编译为 CSS，或使用 CSS Modules/JSCSS。                          |

下一步：对比 [样式与资源](/zh/frontend/styles-and-assets) 了解其它受支持的样式路径；需要调节 JSCSS 抽取时阅读 [前端配置](/zh/frontend/configuration)。

## 验证示例

`npm run build` 成功后运行 `npm start -- --port 3000`，打开 `/settings`。核对 SSR HTML 中的 class、浏览器 CSS 文件中的对应规则，以及 danger 按钮实际颜色；只有 class 字符串存在不能证明 CSS 已加载。变量更新还需检查目标元素 computed style。构建时不匹配扫描规则的文件不会仅因运行时调用 style 就自动补出 CSS。结束后停止服务。
