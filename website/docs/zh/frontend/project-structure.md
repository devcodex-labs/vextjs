# 项目结构

## 目录导航

- [默认目录](#默认目录)
- [前端源码边界](#前端源码边界)
- [类型目录边界](#类型目录边界)
- [自动生成文件](#自动生成文件)
- [Alias](#alias)
- [静态文件](#静态文件)
- [API-only 项目](#api-only-项目)

## 默认目录

默认 `vext create` 脚手架是全栈项目。前端源码统一放在 `src/frontend/**`，让服务端代码和浏览器代码保持物理边界。

```text
src/
  routes/
    index.ts
    api/
      users.ts
  services/
    user.service.ts
  types/
    generated/
    shared/
      greeting.d.ts
    frontend/
      home.d.ts
  frontend/
    pages/
      index.tsx
      layout.tsx
      _document.html
      admin/
        layout.tsx
        dashboard.tsx
      error/
        default.tsx
        404.tsx
    components/
      AppShell.tsx
      UserMenu.tsx
    styles/
      app.css
      dashboard.module.css
      card.style.ts
    assets/
      logo.png
      hero.avif
    locales/
      en-US.ts
      zh-CN.ts
public/
  favicon.svg
  robots.txt
```

需要通过固定 URL 访问的文件放 `public/**`。会被组件 import、需要 hash 和进入构建图的文件放 `src/frontend/assets/**`。

## 前端源码边界

服务端和浏览器文件必须分开。

| 位置 | 运行位置 | 用途 |
|------|----------|------|
| `src/routes/**` | 服务端 | URL 定义、`res.render()`、API 响应、鉴权、service 调用 |
| `src/services/**` | 服务端 | 数据库访问、上游调用、业务逻辑 |
| `src/frontend/pages/**` | 服务端 SSR + 浏览器 hydration | React 页面、layout、错误页、document 模板 |
| `src/frontend/components/**` | 服务端 SSR + 浏览器 hydration | 可复用 UI 组件 |
| `src/frontend/styles/**` | 构建/浏览器 | CSS、CSS Modules、JSCSS |
| `src/frontend/assets/**` | 构建/浏览器 | import 型图片、字体、媒体文件 |
| `src/frontend/locales/**` | 服务端 SSR + 浏览器 hydration | 前端页面文案 |

不要从 `src/frontend/**` import `src/services/**`、数据库客户端、密钥、`node:*` 或 route handler。构建期 leakScan 会阻断这类导入，因为服务端代码不能进入浏览器 bundle。

## 类型目录边界

TypeScript 全栈 starter 通过三层类型目录表达所有权，而不会再预设一套后端类型树：

| 位置                     | 所有者      | 用途                                                                                                                                         |
| ------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types/generated/**` | Vext 工具链 | `vext typegen` 刷新的输出；不要手动修改生成声明。                                                                                            |
| `src/types/shared/**`    | 应用代码    | 服务端与 UI 共用、可序列化的数据契约；starter 中的 `GreetingDto` 是一个例子。                                                                |
| `src/types/frontend/**`  | 应用代码    | 由渲染页面的 route 与 `src/frontend/**` 共同使用的页面/渲染契约；starter 中的 `HomePageProps` 是一个例子。不要把服务端私有实现细节放进这里。 |

`vext typegen` 只会写入 `src/types/generated/**`，不会重写 `shared/**` 或 `frontend/**`。

| 脚手架模式                                              | 初始类型目录                                 |
| ------------------------------------------------------- | -------------------------------------------- |
| TypeScript 全栈（默认）                                 | `generated/**`、`shared/**` 与 `frontend/**` |
| TypeScript API-only（`--template api --frontend none`） | 仅 `generated/**`                            |
| JavaScript 脚手架                                       | 不生成 `src/types` 目录                      |

脚手架不会预留 `src/types/server/**`。只被单个 route 或 service 使用的服务端类型，应放在该 owner 附近；只有应用形成真实的服务端共享边界时，再自行建立应用自定义的服务端目录。

## 自动生成文件

Vext 会自动生成浏览器入口和 SSR 入口。

```text
.vext/
  generated/
    frontend/
      browser-entry.tsx
      render-entry.tsx
      page-registry.ts
      layout-registry.ts
      locale-registry.ts
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
    assets/
```

日常只编辑 `src/frontend/**`，不要手写 `.vext/generated/frontend/**`。开发期输出在 `.vext/client/`，生产输出在 `dist/client/`。

## Alias

前端 resolver 提供默认 alias，避免大量相对路径。

| Alias | 指向 |
|-------|------|
| `@frontend` | `src/frontend` |
| `@pages` | `src/frontend/pages` |
| `@components` | `src/frontend/components` |
| `@styles` | `src/frontend/styles` |
| `@assets` | `src/frontend/assets` |

```tsx
import { UserMenu } from "@components/UserMenu";
import styles from "@styles/dashboard.module.css";
import logoUrl from "@assets/logo.png";
```

## 静态文件

文件需要固定 URL 时使用 `public/**`：

```tsx
export function BrandIcon() {
  return <img src="/favicon.svg" alt="Vext" />;
}
```

文件属于组件、需要构建期 hash 时使用 `src/frontend/assets/**`：

```tsx
import heroUrl from "@assets/hero.avif";

export function Hero() {
  return <img src={heroUrl} alt="" />;
}
```

## API-only 项目

创建时关闭前端：

```bash
npx vextjs create my-api --template api --frontend none
```

也可以在配置中关闭：

```ts
export default {
  frontend: false,
};
```

`frontend.enabled=false` 时，Vext 不应构建前端资源、挂载前端静态文件，也不应给纯 API 项目增加前端 watcher 成本。
