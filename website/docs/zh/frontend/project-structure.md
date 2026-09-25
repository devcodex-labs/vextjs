# 项目结构

本页用于判断一个文件应由谁维护、在哪里执行，以及哪些产物应由工具生成。先完成[快速开始](/zh/frontend/getting-started)再阅读；以下默认路径以 TypeScript 全栈模板为准，可配置路径见[前端配置](/zh/frontend/configuration)。

## 目录导航

- [默认目录](#默认目录)
- [前端源码边界](#前端源码边界)
- [类型目录边界](#类型目录边界)
- [自动生成文件](#自动生成文件)
- [Alias](#alias)
- [静态文件](#静态文件)
- [API-only 项目](#api-only-项目)
- [验证目录调整](#验证目录调整)

## 默认目录

`npx vextjs create my-app` 默认生成 TypeScript 全栈项目。下面列出主要源码；`config` 中还会生成环境和 bootstrap 配置，详见[服务端项目结构](/zh/guide/project-structure)。

```text
src/
  config/
    default.ts
  routes/
    index.ts
  services/
    example.ts
  types/
    generated/
      .gitkeep
    shared/
      greeting.d.ts
    frontend/
      home.d.ts
  frontend/
    pages/
      index.tsx
      layout.tsx
      _document.html
      error/
        default.tsx
    components/
      AppShell.tsx
    styles/
      index.css
    locales/
      en-US.ts
public/
  favicon.svg
  vext-mark.svg
```

业务文件按需要增加，模板没有预先生成下面所有目录：

| 任务                      | 放置位置与配套工作                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 新增 dashboard 页面       | `src/frontend/pages/admin/dashboard.tsx`，并在 `src/routes/admin/dashboard.ts` 注册 `/`；页面文件不会自动创建 URL |
| 新增可复用 UI             | `src/frontend/components/UserMenu.tsx`，由页面或 layout 导入                                                      |
| 给 admin 页面增加公共布局 | `src/frontend/pages/admin/layout.tsx`；继承和数据规则见[Layout 与组件](/zh/frontend/layouts-and-components)       |
| 添加页面样式              | `src/frontend/styles/dashboard.module.css` 或 `card.style.ts`，由 UI 导入并使用                                   |
| 添加第二种语言            | `src/frontend/locales/zh-CN.ts`，同时核对语言配置与文案覆盖                                                       |
| 添加 404 页面             | `src/frontend/pages/error/404.tsx`，根据[错误页与 Document](/zh/frontend/errors-and-document)配置状态映射         |

需要通过固定 URL 访问的文件放 `public/**`。`src/frontend/assets/**` 用于浏览器构建图中的资源；当前 SSR 页面直接 import 图片存在构建限制，先使用本页的 Public URL 示例。资源是否内联或带 hash 取决于实际构建配置。

## 前端源码边界

服务端和浏览器文件必须分开。

| 位置                         | 运行位置                      | 用途                                                   |
| ---------------------------- | ----------------------------- | ------------------------------------------------------ |
| `src/routes/**`              | 服务端                        | URL 定义、`res.render()`、API 响应、鉴权、service 调用 |
| `src/services/**`            | 服务端                        | 数据库访问、上游调用、业务逻辑                         |
| `src/frontend/pages/**`      | 服务端 SSR + 浏览器 hydration | React 页面、layout、错误页、document 模板              |
| `src/frontend/components/**` | 服务端 SSR + 浏览器 hydration | 可复用 UI 组件                                         |
| `src/frontend/styles/**`     | 构建/浏览器                   | CSS、CSS Modules、JSCSS                                |
| `src/frontend/assets/**`     | 构建/浏览器                   | import 型图片、字体、媒体文件                          |
| `src/frontend/locales/**`    | 服务端 SSR + 浏览器 hydration | 前端页面文案                                           |

不要从 `src/frontend/**` import `src/services/**`、数据库客户端、密钥、`node:*` 或 route handler。默认开启的 `frontend.build.diagnostics.leakScan` 会检查已知服务端路径和 Node 模块边界，但它不等于识别所有私有数据或第三方包副作用。即使文件放在共享目录，也要检查实际依赖；关闭扫描不会使服务端代码变得适合浏览器。

表中页面和组件的运行位置以开启 SSR 与 hydration 为前提；关闭某一侧渲染时，对应执行阶段也会变化。页面和组件在 SSR 阶段可能执行，渲染期间不能无条件访问 `window`、`document` 等浏览器对象。`pages/_document.html` 是文档模板，不能按 React 页面组件使用。

## 类型目录边界

TypeScript 全栈 starter 通过三层类型目录表达所有权，而不会再预设一套后端类型树：

| 位置                     | 所有者      | 用途                                                                                                                                         |
| ------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types/generated/**` | Vext 工具链 | 连接隐藏类型输出的生成声明入口；不要手动修改。                                                                                               |
| `src/types/shared/**`    | 应用代码    | 服务端与 UI 共用、可序列化的数据契约；starter 中的 `GreetingDto` 是一个例子。                                                                |
| `src/types/frontend/**`  | 应用代码    | 由渲染页面的 route 与 `src/frontend/**` 共同使用的页面/渲染契约；starter 中的 `HomePageProps` 是一个例子。不要把服务端私有实现细节放进这里。 |

`vext typegen` 的声明主体在 `.vext/types/services.generated.d.ts` 和 `.vext/types/app-extensions.generated.d.ts`；TypeScript 项目的 `src/types/generated/index.d.ts` 引用它们。选择哪些声明由命令选项决定，`--write-manifest` 还会写 `.vext/manifest/services.json`。工具不会重写应用维护的 `shared/**` 或 `frontend/**`，也不会因为放进这两个目录就自动保证类型可序列化。

| 脚手架模式                                              | 初始类型目录                                 |
| ------------------------------------------------------- | -------------------------------------------- |
| TypeScript 全栈（默认）                                 | `generated/**`、`shared/**` 与 `frontend/**` |
| TypeScript API-only（`--template api --frontend none`） | 仅 `generated/**`                            |
| JavaScript 脚手架                                       | 不生成 `src/types` 目录                      |

脚手架不会预留 `src/types/server/**`。只被单个 route 或 service 使用的服务端类型，应放在该 owner 附近；只有应用形成真实的服务端共享边界时，再自行建立应用自定义的服务端目录。

## 自动生成文件

前端构建会生成浏览器入口、SSR 入口和注册表。默认布局的主要产物如下；可选功能还会产生附加文件，不应把这张图当成完整部署清单。

```text
.vext/
  generated/
    frontend/
      browser-entry.tsx
      server-renderer.ts
      page-registry.ts
      vext-runtime.tsx
  types/
    services.generated.d.ts
    app-extensions.generated.d.ts
  client/
    index.html
    manifest.json
    render-manifest.json
dist/
  client/
    index.html
    manifest.json
    render-manifest.json
    deploy-manifest.json
    size-report.json
    public-manifest.json
    client-contract.json
    route-contract.json
    server/
      renderer.cjs
    assets/
```

应用维护者编辑 `src` 下自己的路由、服务、UI、配置和类型，以及 `public` 资源；不要手写 `.vext/generated/frontend/**` 或生成声明。页面、layout 和错误页登记在 `page-registry.ts` 中；词典仅在前端国际化启用时扫描并登记到同一文件，不分别生成 `layout-registry.ts` 或 `locale-registry.ts`。

前端开发输出默认在 `.vext/client/`，生产输出默认在 `dist/client/`；`frontend.outDir` 可显式覆盖，CLI `--outdir` 的联动规则见[构建指南](/zh/guide/build)。SSR renderer 与浏览器资源必须成套交付，不能只上传 `assets/` 就认为服务端页面已发布。

## Alias

前端 resolver 提供默认 alias，下面是默认配置下的映射：

| Alias         | 指向                      |
| ------------- | ------------------------- |
| `@frontend`   | `src/frontend`            |
| `@pages`      | `src/frontend/pages`      |
| `@components` | `src/frontend/components` |
| `@styles`     | `src/frontend/styles`     |
| `@assets`     | `src/frontend/assets`     |

在完成快速开始的组件示例后，可以这样导入已有组件：

```tsx
import { Stat } from "@components/Stat";
```

调整 `frontend.root`、`pages.dir`、`componentsDir`、`assetsDir` 或 `styles.entry` 时，默认 alias 会跟随解析后的目录；`@styles` 指向样式入口所在目录。自定义 `frontend.alias` 值相对前端根解析，并可覆盖同名 alias。TypeScript 编辑器使用的 `tsconfig.json` 的 `paths` 也需保持一致，运行时 resolver 不会替你重写这份配置。

`root`、`publicDir`、`entry` 等路径相对项目根，而页面、组件、样式、资源路径通常相对前端根；修改目录前先核对[配置](/zh/frontend/configuration)中的具体字段。

## 静态文件

默认 `publicPath: "/"` 时，模板已有的 `public/favicon.svg` 可按下面的 URL 引用。这是可嵌入页面的组件片段：

```tsx
export function BrandIcon() {
  return <img src="/favicon.svg" alt="Vext" />;
}
```

需要展示模板标识时，同样直接引用已有 Public 资源：

```tsx
export function Hero() {
  return <img src="/vext-mark.svg" alt="Vext" />;
}
```

当前浏览器构建为 PNG、SVG 等资源配置了 loader，但 SSR 构建没有对应的图片 loader。把图片直接 import 到页面或其组件中，会使包含这些页面的构建失败；添加类型声明或仅关闭运行时 SSR 都不能补齐这个构建环节。这里采用 Public URL，不要求读者修改生成文件或自行补构建插件。

对已有、确实支持资源 import 的浏览器入口，TypeScript 若缺少资源模块声明，可在应用维护的类型目录添加声明，例如：

```ts
// src/types/frontend/assets.d.ts
declare module "*.svg" {
  const url: string;
  export default url;
}
```

声明只帮助类型检查，实际文件和构建 loader 仍需存在，不能用它解决上述 SSR 限制。更多格式、CSS Modules 和媒体处理见[样式与资源](/zh/frontend/styles-and-assets)。

`public/**` 会复制到前端输出目录并进入静态资源清单。不要放服务端配置或其他不应公开的文件；开发与生产的本地服务按配置的 `publicPath` 提供资源，CDN URL 改写另见[静态资源与 CDN](/zh/frontend/static-assets-and-cdn)。

## API-only 项目

创建时关闭前端：

```bash
npx vextjs create my-api --template api --frontend none
```

已有项目可以在默认配置中合并下面的设置；这是一段配置片段：

```ts
export default {
  frontend: false,
};
```

`frontend: false` 与 `{ enabled: false }` 都关闭内置前端构建和静态/页面处理。已有 route 中的 `res.render()` 也必须改成 API 响应或删除，否则会报前端未启用；关闭配置不会自动删除磁盘上已有的构建目录。

## 验证目录调整

在应用根目录执行已有命令：

```bash
npx vextjs typegen
npx vextjs typegen --check
npm run build
```

`typegen --check` 检查生成文件是否与当前源码一致，并执行工具自身的诊断，不代替 TypeScript 类型检查；默认 TypeScript 模板的 `npm run build` 含 `--typecheck`，自定义 build 脚本需自行确认。确认严格构建通过、页面和导入资源都在本次构建中；启动后实际访问调整过的 URL 和资源。若只有编辑器报 alias 错误，检查 tsconfig paths；若浏览器构建报告 boundary leak，检查 UI 的完整导入链；若页面不存在，检查 page id 与 `pages.dir`，不要通过修改生成注册表修补。完整运行示例继续使用[快速开始](/zh/frontend/getting-started)。
