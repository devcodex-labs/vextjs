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

Vext JSCSS 会在构建期把 TypeScript 对象转换为 CSS class。组件需要有名字的 variants、语义化 CSS variables 或嵌套规则，同时希望浏览器最终加载的是 CSS 而不是 CSS-in-JS runtime 时，就使用它。

按需求选择最小的工具：

| 需求                                            | 优先使用    | 原因                                               |
| ----------------------------------------------- | ----------- | -------------------------------------------------- |
| reset、排版、页面级 token                       | CSS 文件    | 有意维护的一份全局样式最容易检查。                 |
| 规则固定的局部组件                              | CSS Modules | class map 简单且局部。                             |
| 有 variants、CSS variables 或生成嵌套规则的组件 | Vext JSCSS  | 类型化 rule object 会生成 CSS 和 class-name 函数。 |

Vext 不会编译 Sass 或 SCSS 源文件。如果团队继续使用 Sass，请先在交给 Vext 前编译为 CSS。JSCSS 不是 Sass 的替代品；它是 Vext 内置的、面向组件的类型化生成 CSS 路径。

## 跑通第一个组件样式

推荐先走这一条路径：在 `*.style.ts` 中定义有名字的 recipe，然后在 React 的 `className` 中调用它。

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
import { button } from "../styles/button.style";

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

```tsx
import { Button } from "@components/Button";

export default function SettingsPage() {
  return <Button intent="danger">删除项目</Button>;
}
```

## 构建后如何进入浏览器

执行正常的生产构建：

```bash
npm run build
```

Vext 会发现 `src/frontend/**` 下匹配 `*.style.ts`、`*.style.js` 和 `*.css.ts` 的文件，在构建期执行其中的样式声明，并将收集到的规则写入生成的 JSCSS CSS。生成的 browser entry 会引用该 CSS，最终 client asset manifest 会把它带入渲染文档。

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

上面的例子会在抽取 CSS 中生成初始声明和 `var(--vext-accent, #4f46e5)`。如果值需要在 hydration 后变化，请在事件处理器或 effect 中使用标准浏览器 CSS API，不要在样式模块或 SSR render 中执行：

```ts
document.documentElement.style.setProperty(accent.name, "#7c3aed");
```

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

| 现象                         | 先检查                                                                             | 恢复方式                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 没有生成 class CSS           | 文件是否在 `src/frontend/**` 下，且匹配 `*.style.ts`、`*.style.js` 或 `*.css.ts`。 | 移动或改名后再次执行 `npm run build`。                                                  |
| `string` 不能赋给 JSCSS rule | 把 `style()` 返回值嵌进了 `recipe().base` 或 `recipe().variants`。                 | 像第一个例子一样，向 recipe 传入原始 rule object。                                      |
| 修改主题没有效果             | 把 `setVar()` 当作 DOM 更新。                                                      | 在浏览器代码中执行 `document.documentElement.style.setProperty(variable.name, value)`。 |
| 样式模块在 build 时失败      | 模块顶层读取了浏览器全局变量或请求/server state。                                  | 保持声明式；将浏览器工作移入 effect 或事件处理器。                                      |
| 需要 Sass 语法               | Vext 没有一等 Sass/SCSS compiler。                                                 | 在外部将 Sass 编译为 CSS，或使用 CSS Modules/JSCSS。                                    |

下一步：对比 [样式与资源](/zh/frontend/styles-and-assets) 了解其它受支持的样式路径；需要调节 JSCSS 抽取时阅读 [前端配置](/zh/frontend/configuration)。
