# 配置

本页说明配置从哪里加载、各层如何合并，以及如何验证实际生效值。首次建项目见[快速开始](/zh/guide/quick-start)。先完成下方不依赖外部服务的完整示例，再按需要阅读加载机制与分项配置；字段的精确签名和完整嵌套项见[配置 API](/zh/api/config)。各分项代码是独立片段，需合并到已有配置中，不能反复覆盖整个文件。

## 完整示例

先在已完成[快速开始](/zh/guide/quick-start)的 TypeScript 项目中验证。项目需已有 `dev`、`build`（含 `--typecheck`）、`start` 三个 npm scripts；把以下配置合并到对应文件，新增诊断路由。为得到下述结果，请使用独立的练习项目，保留脚手架的空 `bootstrap.ts`，避免已有 provider 或其他 profile 改写示例值。

示例只显式设置本次验证需要的字段，其余使用框架默认值；不连接外部服务。完整字段说明见后续各节及[配置 API](/zh/api/config)。

```typescript
// src/config/default.ts
export default {
  port: Number(process.env.PORT) || 3000,
  host: "0.0.0.0",
  logger: { level: "info" },
  openapi: { enabled: true, title: "My App API", version: "1.0.0" },
  frontend: { enabled: false },
  // 自定义字段只演示合并；框架不会据此连接 Redis。
  redis: { url: process.env.REDIS_URL || "redis://localhost:6379" },
};
```

```typescript
// src/config/production.ts
export default {
  logger: { level: "warn" },
  cors: { origins: ["https://myapp.com"], credentials: true },
  openapi: { enabled: false },
  // logger.level: "warn" 会抑制普通 info/debug 访问日志；5xx 仍会提升为 error。
  accessLog: { level: "info", warnOn4xx: true },
  cluster: {
    enabled: false, // 本例单进程；生产多 worker 配置见后文 Cluster 节
  },
};
```

```typescript
// src/config/local.ts
export default {
  port: 8080,
  redis: {
    url: "redis://localhost:6380",
  },
};
```

```typescript
// src/routes/config-info.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, async (_req, res) => {
    res.json({
      port: app.config.port,
      logLevel: app.config.logger.level,
      docsEnabled: app.config.openapi.enabled,
    });
  });
});
```

1. 清除本终端先前设置的PORT、VEXT_PORT/VEXT_HOST、VEXT_CONFIG等覆盖（或在干净终端执行），运行 `npm run dev`。请求 `http://127.0.0.1:8080/config-info`，应为200，data中port=8080、logLevel=info、docsEnabled=true，证明local在开发模式生效。
2. 停止dev，运行 `npm run build`，成功后 `npm start`。请求 `http://127.0.0.1:3000/config-info`，应为200，port=3000、logLevel=warn、docsEnabled=false，证明production覆盖生效且未读取local。
3. 停止服务后运行 `npm start -- --port 3100`，请求3100端口应显示port=3100，验证CLI覆盖优先级。验证结束停止该服务。

只输出本例的三个非敏感诊断字段，不要把整个app.config作为业务接口返回。监听host可能是0.0.0.0或::，它不是对外服务的公开base URL；代理/CDN后的公开地址由部署合同决定，不能仅由host/port推断。

VextJS 采用 **多层配置合并** 机制，支持按环境覆盖配置，同时提供丰富的内置配置项覆盖框架行为。

## 配置加载机制

框架启动时，`config-loader` 按以下顺序加载配置文件并深度合并：

```
框架内置默认值 → default.ts → {configProfile}.ts → local.ts（仅 development/test）→ bootstrap provider patch → CLI override
```

运行时合并允许后层只声明需要覆盖的字段。TypeScript 则有意区分项目基础配置与后层 patch：`default.ts` 使用 `VextUserConfig`，环境 profile 与 local 配置文件使用 `VextConfigOverride`，`createTestApp()` 采用同一覆盖合同。bootstrap provider 继续使用 JSON-like `Record<string, unknown>` patch，并由现有运行时校验。

直接加载 TypeScript 配置源码时，框架负责编译，不要求额外安装 TS loader。模块在当前应用进程中执行，支持顶层 `await`，模块导出的 provider 函数仍可使用当前进程状态；同一进程对同一个 TS 配置模块复用求值结果。`import.meta.url` / `filename` / `dirname` 指向该模块的源码位置。临时执行文件由框架管理，正常加载和加载失败都会清理；发现外部改动时会保留冲突文件并报告错误。compiled 生产模式继续加载选定构建目录中的配置产物。

### 配置文件

| 文件                        | 用途                                   | 是否必须 |
| --------------------------- | -------------------------------------- | -------- |
| `src/config/default.ts`     | 所有环境的基础配置                     | ✅ 必须  |
| `src/config/development.ts` | 开发 profile 覆盖（`vext dev` 默认）   | 可选     |
| `src/config/production.ts`  | 生产 profile 覆盖（`vext start` 默认） | 可选     |
| `src/config/test.ts`        | 测试 profile 覆盖                      | 可选     |
| `src/config/local.ts`       | 本地开发覆盖（应加入 `.gitignore`）    | 可选     |
| `src/config/bootstrap.ts`   | 启动期 provider 注册入口               | 可选     |

配置 profile 通过 `--config <name>` 或 `VEXT_CONFIG=<name>` 显式选择。未指定时，`vext start`、`vext build`、`vext deploy assets` 默认使用 `production` profile，`vext dev` 默认使用 `development` profile。

显式CLI profile优先于VEXT_CONFIG。非标准NODE_ENV名称仍有带警告的旧兼容入口，推荐改用显式profile；标准NODE_ENV不能取代命令自己的默认模式。profile名称只允许字母、数字、下划线和连字符，default/local/bootstrap是保留名；不要传文件路径。

profile 名可以是自定义部署环境名，例如：

- `src/config/sg-sit.ts`
- `src/config/us-uat.ts`
- `src/config/us-prod.ts`

启动时传入 profile 名：

```bash
npm start -- --config sg-sit
VEXT_CONFIG=sg-sit npm start
```

第二行是POSIX shell写法；PowerShell可用 `$env:VEXT_CONFIG = "sg-sit"` 后再执行命令，或直接使用跨shell的 `--config`。配置文件示例使用.ts；Loader也支持.js/.mjs/.cjs。

上述生产启动使用 `default -> sg-sit -> bootstrap provider patch -> CLI override`。`local.ts` 只在 development/test 运行模式加载；生产 build 与 start（JS 源码或编译后的 TS）均不隐式执行它。部署覆盖使用显式 profile 或 bootstrap provider；选择自定义 profile 不改变运行模式。

:::warning Build、Runtime 与 Config Profile 的语义
`vext build` 会将用户源码中的 `process.env.NODE_ENV` 静态注入为 `"production"`，`vext start` 运行时也会使用 production runtime mode。配置 profile 是独立概念，由 `--config` / `VEXT_CONFIG` 决定。

因此，推荐把环境差异放进：

- `src/config/<env>.ts`
- `src/config/bootstrap.ts`
- 其他显式业务环境变量

而不是依赖 build 后源码中的 `process.env.NODE_ENV` 条件分支。
:::

### 合并规则

- **普通对象字段**：深度合并，后层只声明覆盖字段；类实例和运行能力对象有原子边界，不能据此递归patch任意实例
- **`middlewares` 数组**：智能 patch 策略——按 `name` 匹配并合并，而非简单替换整个数组
- **其他数组**：后层覆盖前层
- **`bootstrap provider patch`**：在 `local.ts` 之后、CLI override 之前参与同一套 merge / validate / freeze 流程
- **最终结果**：普通配置对象和数组深冻结，运行时不应修改；客户端等非普通类实例保留内部可变状态，不会被递归冻结

### TypeScript 基础配置与覆盖层

- **基础配置（`default.ts`）**：使用 `VextUserConfig`。它的顶层字段可选，但一旦写出某个嵌套对象，该对象不会自动变成深度可选。例如 `default.ts` 中的 `database` 必须满足完整 `MonSQLizeDatabaseConfig`，包括必填的连接 `config`。
- **覆盖层**：`development.ts`、`production.ts`、自定义 profile 与 `local.ts` 使用 `VextConfigOverride`。它与运行时深度合并一致，后层可以只 patch `database.findLimit` 或 `logger.level`，其余字段从完整 base 继承。
- **原子能力**：adapter、store、callback、数组以及注册为 runtime capability 的路径仍要求完整值，不会被递归放宽。

不要把一个必填的基础对象拆到多个文件，并期待 TypeScript 等后续合并再补齐。即使 `development.ts` 会提供 `uri`，`default.ts` 中的半截 `database` 仍然无效；应先在 base 提供完整连接，再由后层只覆盖环境差异。参见[数据库配置](./database#多环境配置)。

### Bootstrap Config Provider

如果你需要在 **配置定稿前** 拉取远程配置（例如 Nacos / 配置中心 / 启动期密钥派发），可以新增 `src/config/bootstrap.ts`：

```typescript
import { defineBootstrapConfig } from "vextjs";

export default defineBootstrapConfig({
  providers: [
    {
      name: "remote-config",
      timeoutMs: 10_000,
      async load({ configProfile, baseConfig, signal }) {
        const response = await fetch(
          `https://config.example.com/${configProfile}`,
          { signal },
        );
        if (!response.ok)
          throw new Error(`Config request failed: ${response.status}`);

        const remote = await response.json();
        return {
          database: remote.database,
          logger: {
            lifecycleLevel: baseConfig.logger?.lifecycleLevel ?? "concise",
          },
        };
      },
    },
  ],
});
```

provider 上下文字段：

| 字段                    | 说明                                                             |
| ----------------------- | ---------------------------------------------------------------- |
| `mode`                  | 当前运行模式：development / production / test                    |
| `configProfile`         | 本次选中的配置文件profile，可以与mode不同                        |
| `env`                   | 兼容别名，已弃用；使用mode或configProfile明确表达意图            |
| `baseConfig`            | default/profile/local合并后的只读配置，可用于按现有配置决定patch |
| `signal`                | 超时或取消时会 abort 的 `AbortSignal`                            |
| `rootDir` / `configDir` | 当前项目与配置目录路径                                           |
| `command` / `isBuilt`   | 当前启动命令与是否走编译产物                                     |

`dev` 和 `build` 在后端编译前从 `src/config` 求值一次完整配置，先确定自定义前端等目录；这两个入口的 provider 上下文中 `configDir` 指向源码配置目录，`isBuilt=false`。后端编译、前端构建和开发监视复用本次配置，不为获取目录再次执行 provider。`start` 消费编译产物时仍使用产物配置目录与 `isBuilt=true`；不要把 `isBuilt` 当成“是否正在执行 build 命令”。

约束：

- provider 必须返回 **plain object patch** 或 `null`
- patch 只支持 JSON-like 结构；**不支持**函数、类实例、adapter factory
- 默认优先级：`local < provider < CLI`
- 未声明 `required` 时：`production` 默认 fail-fast，`development / test` 默认 warning 后继续
- Cluster 模式下，Master 会将本轮 provider patch 传递给 Worker 复用，避免同一启动周期出现配置漂移

超时会触发 signal，但不会强制终止任意用户异步工作；provider 中的网络操作应接收该 signal。占位远端地址需要替换为实际服务，不属于开篇完整示例的必需文件。

### 配置文件格式

每个配置文件使用 `export default` 导出一个对象：

```typescript
// src/config/default.ts
import type { VextUserConfig } from "vextjs";

const config: VextUserConfig = {
  port: 3000,
  host: "0.0.0.0",
  logger: {
    level: "info",
    lifecycleLevel: "concise",
  },
  cors: {
    origins: ["*"],
  },
  openapi: {
    enabled: true,
  },
  session: {
    name: "vext.sid",
    ttl: 86400,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: "auto",
    },
  },
  csrf: {
    enabled: false,
  },
  securityHeaders: {
    enabled: false,
    preset: "basic",
  },
};

export default config;
```

```typescript
// src/config/production.ts — 仅覆盖需要变更的字段
import type { VextConfigOverride } from "vextjs";

const config: VextConfigOverride = {
  logger: {
    level: "warn", // 生产环境减少日志输出
  },
  cors: {
    origins: ["https://myapp.com"], // 生产环境限制来源
  },
  openapi: {
    enabled: false, // 生产环境关闭文档
  },
};

export default config;
```

```typescript
// src/config/local.ts — 本地开发特殊配置（不提交 Git）
import type { VextConfigOverride } from "vextjs";

const config: VextConfigOverride = {
  port: 8080, // 本地使用其他端口
};

export default config;
```

`config.session.enabled: true` 会在生产、开发、测试和软重载链路中自动注册 Session，应用配置默认值为 `false`。内置 memory store 适合单进程部署；共享部署应把 `createCacheSessionStore(cacheLike)` 或自定义 `VextSessionStore` 设置到 `config.session.store`。路由可通过 `session: false` 跳过，也可在全局关闭时通过 `session: true` 单独启用。显式 `session()` 中间件仍保留给作用域化或手动注册场景。

`config.csrf.enabled: true` 会在 body parsing 与插件全局中间件之后自动注册内置 CSRF 中间件。若只想保护指定路径，请保持禁用并手动注册 `csrf()`。

`config.securityHeaders.enabled: true` 会自动注册低破坏浏览器安全响应头。默认建议使用 `preset: "basic"`；启用 `strict` 或显式 CSP/COEP 前，请先检查前端资源、CDN、iframe 嵌入和 OAuth popup 流程。

### Middlewares Patch 策略

`middlewares` 数组使用智能合并，按中间件 `name` 匹配：

同一个配置层中，每个中间件名称只能声明一次；同文件重名会在启动时失败。后续 profile/local 层可以声明一次同名项来 patch 前一层；`{ name, enabled: false }` 会保留名称并注册为空操作，不查找或执行原中间件文件。禁用后可按名称引用，但不能在路由引用中继续传 `options`：空操作按普通中间件处理，不再是工厂。

同名声明是浅合并：`options`被后层整个替换，不递归合并内部属性。空数组不表示删除继承的白名单，禁用已有项应使用enabled:false；片段中的auth/check-role/rate-limit-api须有对应实现，白名单名称不会自动生成中间件。

```typescript
// src/config/default.ts
export default {
  middlewares: [
    "auth",
    { name: "check-role", options: { roles: ["user"] } },
    { name: "rate-limit-api", options: { max: 100 } },
  ],
};
```

```typescript
// src/config/development.ts
export default {
  middlewares: [
    // 只需声明要覆盖的中间件，其余保留
    { name: "check-role", options: { roles: [] } }, // 空数组的业务含义由工厂实现决定
    { name: "rate-limit-api", options: { max: 10000 } }, // 放宽限流
  ],
};
```

合并后结果：

```typescript
middlewares: [
  "auth", // 保留
  { name: "check-role", options: { roles: [] } }, // 被覆盖
  { name: "rate-limit-api", options: { max: 10000 } }, // 被覆盖
];
```

## 使用 Adapter

默认使用 Native Adapter（`http.createServer` + `route-core`）。要切换其他 Adapter，先按 [Adapter 指南](/zh/guide/adapters)安装对应的可选依赖，再从以下四种配置中选择一种合并到 `default.ts`：

```typescript
// src/config/default.ts — 使用 Hono Adapter
import { honoAdapter } from "vextjs/adapters/hono";

export default {
  adapter: honoAdapter(),
  port: 3000,
};
```

```typescript
// src/config/default.ts — 使用 Fastify Adapter
import { fastifyAdapter } from "vextjs/adapters/fastify";

export default {
  adapter: fastifyAdapter(),
  port: 3000,
};
```

```typescript
// src/config/default.ts — 使用 Express Adapter
import { expressAdapter } from "vextjs/adapters/express";

export default {
  adapter: expressAdapter(),
  port: 3000,
};
```

```typescript
// src/config/default.ts — 使用 Koa Adapter
import { koaAdapter } from "vextjs/adapters/koa";

export default {
  adapter: koaAdapter(),
  port: 3000,
};
```

:::tip
不指定 `adapter` 时默认使用 Native Adapter，它不依赖第三方 HTTP 框架。切换其他Adapter前需安装对应包；吞吐表现会随场景变化，请结合[当前性能基准](/zh/benchmark)和你的业务负载判断。
:::

## 前端配置 (`frontend`)

`frontend` 控制内置浏览器流水线。它可以是 `true`、`false` 或对象。以下展示多个可选能力的组合，假定项目已按[前端指南](/zh/frontend/overview)建立页面、样式及语言资源；其中 `admin/app/shell` 必须是实际存在的页面。仅启用默认集成可以使用 `frontend: true`，不必照搬整个片段。

```typescript
export default {
  frontend: {
    enabled: true,
    framework: "react",
    root: "src/frontend",
    publicDir: "public",
    publicPath: "/",
    styles: {
      jscss: {
        enabled: true,
      },
    },
    i18n: {
      enabled: true,
      defaultLocale: "en-US",
    },
    spaFallback: {
      scopes: [
        {
          basePath: "/admin/app",
          page: "admin/app/shell",
          exclude: ["/admin/api/**"],
        },
      ],
    },
    apiClient: {
      enabled: true,
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
      },
      budgets: {
        maxTotalBytes: 5_000_000,
      },
    },
    deploy: {
      integrity: true,
      upload: {
        enabled: false,
        adapter: "filesystem",
        targetDir: ".vext/deploy/frontend-assets",
        prefix: "my-app",
        exclude: ["**/*.map"],
      },
    },
  },
};
```

| 配置项                                  | 类型                 | 默认值                                         | 说明                                                  |
| --------------------------------------- | -------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| `frontend.enabled`                      | `boolean`            | `false`                                        | 启用内置前端集成                                      |
| `frontend.framework`                    | `string`             | `'react'`                                      | 前端框架标签                                          |
| `frontend.root`                         | `string`             | `'src/frontend'`                               | 前端源码目录                                          |
| `frontend.entry`                        | `string`             | `'.vext/generated/frontend/browser-entry.tsx'` | 自动生成的浏览器入口；通常不需要手写                  |
| `frontend.indexHtml`                    | `string`             | `'src/frontend/pages/_document.html'`          | HTML document 模板                                    |
| `frontend.outDir`                       | `string`             | 开发期 `.vext/client`，生产期 `dist/client`    | 前端输出目录                                          |
| `frontend.styles.jscss`                 | `boolean \| object`  | `{ enabled: true }`                            | Vext JSCSS 构建期 CSS 抽取与动态 CSS variables        |
| `frontend.publicDir`                    | `string`             | `'public'`                                     | 会复制到输出目录并进入 deploy manifest 的静态资源目录 |
| `frontend.publicPath`                   | `string`             | `'/'`                                          | 公开资源路径前缀                                      |
| `frontend.spaFallback`                  | `boolean \| object`  | `{ scopes: [] }`                               | 只对显式声明的 client-router 子应用范围服务 fallback  |
| `frontend.apiClient`                    | `boolean \| object`  | `true`                                         | 生成 client contract 产物                             |
| `frontend.build.target`                 | `string \| string[]` | `'es2022'`                                     | 浏览器构建目标                                        |
| `frontend.build.minify`                 | `boolean`            | 生产期 `true`                                  | 压缩前端产物                                          |
| `frontend.build.sourcemap`              | `boolean`            | 开发期 `true`                                  | 生成前端 source map                                   |
| `frontend.build.server.minify`          | `boolean`            | `false`                                        | SSR renderer 压缩；刻意独立于浏览器产物               |
| `frontend.build.server.sourcemap`       | `boolean`            | 开发期 `true`                                  | SSR renderer source-map 设置                          |
| `frontend.build.diagnostics.sizeReport` | `boolean`            | `true`                                         | 写入实际 `frontend.outDir` 下的 `size-report.json`    |
| `frontend.build.client.external`        | `string[]`           | `[]`                                           | 浏览器构建外置模块列表                                |
| `frontend.build.client.externalRuntime` | `object`             | `{}`                                           | 外置模块的 import map URL                             |
| `frontend.build.vendorChunks`           | `boolean \| object`  | `{ enabled: true }`                            | 公共依赖共享 chunk 管理                               |
| `frontend.build.budgets`                | `object`             | 全部 `0`                                       | 构建体积预算；`0` 表示不限制                          |
| `frontend.build.assets.inlineLimit`     | `number`             | `0`                                            | import 型图片/字体等资源内联阈值                      |
| `frontend.build.css.modules`            | `boolean`            | `true`                                         | 支持 `.module.css` CSS Modules                        |
| `frontend.deploy.assetBaseUrl`          | `string`             | 无                                             | CDN 资源绝对前缀                                      |
| `frontend.deploy.integrity`             | `boolean`            | `false`                                        | 为 JS/CSS 注入 SRI integrity                          |
| `frontend.deploy.upload`                | `boolean \| object`  | `{ enabled: false, exclude: ["**/*.map"] }`    | 静态资源上传和增量发布配置                            |
| `frontend.deploy.upload.adapter`        | `string \| object`   | `'filesystem'`                                 | 内置本地 staging adapter、`mock` 或显式自定义 adapter |
| `frontend.deploy.upload.stateFile`      | `string`             | `.vext/deploy/frontend-assets-state.json`      | 增量上传历史；应位于 `frontend.outDir` 外             |

默认 `spaFallback.scopes` 为空，因此未知 HTML 路径不会被自动吞成 SPA 页面。需要混合 SSR + client-router 子应用时，在 `scopes[]` 中声明具体 `basePath`。`spaFallback: true` 仅作为兼容 shorthand，不推荐在企业级混合项目中使用。

`frontend.deploy.upload` 启用后，`vext deploy assets` 会读取实际所选前端输出中的deploy-manifest，默认是 `dist/client/deploy-manifest.json`，按uploadKey和sha256增量上传。内置filesystem adapter写入targetDir，适合作为CDN同步前的staging；真实云厂商上传通过自定义adapter扩展。

默认上传排除 `index.html` 和 `**/*.map`：HTML 仍由 Vext 服务端渲染，source map 可保留在服务器调试链路中，不随 CDN 静态资源发布。

本表只是通用配置总览。需要精确嵌套字段、resolved default、构建输出拓扑或 CDN/upload 决策时，请阅读[前端配置](/zh/frontend/configuration)与权威的 [VextFrontendConfig API 参考](/zh/api/config#vextfrontendconfig)。创建项目、修改页面、添加组件、CSS/JSCSS、静态资源、API 调用、HTML 模板和常见排错见 [前端指南](/zh/frontend/overview)。

## 常用配置项总览

本节保留常用字段及默认值；未列出的缓存、fetch、locale、Session/CSRF细项等，以[配置 API](/zh/api/config)为完整参考。单独设置某个参数不代表对应功能已启用。

### 基础配置

| 配置项       | 类型                                | 默认值               | 说明                                           |
| ------------ | ----------------------------------- | -------------------- | ---------------------------------------------- |
| `port`       | `number`                            | `3000`               | HTTP 监听端口                                  |
| `host`       | `string`                            | `'0.0.0.0'`          | HTTP 监听地址                                  |
| `adapter`    | `string \| Function \| VextAdapter` | `'native'`           | 底层适配器                                     |
| `trustProxy` | `boolean`                           | `false`              | 是否信任代理（影响 `req.ip` / `req.protocol`） |
| `frontend`   | `boolean \| object`                 | `{ enabled: false }` | 内置前端构建与静态服务配置                     |

```typescript
export default {
  port: 3000,
  host: "0.0.0.0",
  trustProxy: false,
};
```

生产或容器环境可使用 `host: "0.0.0.0"` 监听 IPv4 all interfaces，也可使用 `host: "::"` 监听 IPv6 all interfaces。`host: "::"` 的 ready 日志会额外显示 `http://[::1]:PORT` 和 bracketed IPv6 Network URL；具体 IPv6 host 也会按 `http://[IPv6]:PORT` 输出。

### CORS 配置 (`cors`)

| 配置项             | 类型       | 默认值                                                   | 说明                 |
| ------------------ | ---------- | -------------------------------------------------------- | -------------------- |
| `cors.enabled`     | `boolean`  | `true`                                                   | 是否启用 CORS 中间件 |
| `cors.origins`     | `string[]` | `['*']`                                                  | 允许的来源列表       |
| `cors.methods`     | `string[]` | `['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']` | 允许的 HTTP 方法     |
| `cors.headers`     | `string[]` | `['Content-Type','Authorization','X-Request-Id']`        | 允许的请求头         |
| `cors.credentials` | `boolean`  | `false`                                                  | 是否允许携带凭证     |

```typescript
export default {
  cors: {
    origins: ["https://myapp.com"], // 生产环境限制来源（数组格式）
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
};
```

### 限流配置 (`rateLimit`)

| 配置项              | 类型                 | 默认值                | 说明                      |
| ------------------- | -------------------- | --------------------- | ------------------------- |
| `rateLimit.enabled` | `boolean`            | `false`               | 是否安装全局限流          |
| `rateLimit.max`     | `number`             | `100`                 | 时间窗口内最大请求数      |
| `rateLimit.window`  | `number`             | `60`                  | 时间窗口（秒）            |
| `rateLimit.message` | `string`             | `'Too Many Requests'` | 限流响应消息              |
| `rateLimit.keyBy`   | `string \| function` | `'ip'`                | 内置维度或同步请求key函数 |
| `rateLimit.store`   | `string \| object`   | `'memory'`            | 内存或Redis Store         |

```typescript
export default {
  rateLimit: {
    enabled: true,
    max: 100,
    window: 60, // 1 分钟（单位：秒）
    message: "Too many requests, please try again later",
    keyBy: "ip",
  },
};
```

关闭或省略时，Vext 不安装限流中间件，也不会产生限流响应头或 HTTP 429。
`app.setRateLimiter()` 只替换实现，不会改变这个显式启用开关。

`keyBy: "user"`读取req.user.id，未取得时回退IP；全局限流早于普通认证中间件，不会自动用req.auth隔离额度。Redis、路由覆盖和自定义实现见[请求限流](/zh/guide/rate-limit)。

:::tip 路由级限流覆盖
全局已启用限流时，可以在路由的 `options.override.rateLimit` 中为特定路由覆盖限流配置。下面是 `defineRoutes` 回调内的片段，`handler` 代表你已有的处理函数：

```typescript
app.post(
  "/login",
  {
    override: {
      rateLimit: { max: 5, window: 60 }, // 登录接口更严格（window 单位：秒）
    },
  },
  handler,
);

app.get(
  "/health",
  {
    override: {
      rateLimit: false, // 健康检查不限流
    },
  },
  handler,
);
```

:::

### Security Headers 配置 (`securityHeaders`)

| 配置项                                  | 类型                              | 默认值             | 说明                          |
| --------------------------------------- | --------------------------------- | ------------------ | ----------------------------- |
| `securityHeaders.enabled`               | `boolean`                         | `false`            | 是否自动注册安全响应头        |
| `securityHeaders.preset`                | `"basic" \| "strict" \| "custom"` | `"basic"`          | 响应头预设                    |
| `securityHeaders.hsts`                  | `false \| object`                 | basic 中为 `false` | HTTPS-only HSTS 配置          |
| `securityHeaders.contentSecurityPolicy` | `false \| string \| object`       | `false`            | CSP 或 CSP report-only 配置   |
| `securityHeaders.permissionsPolicy`     | `false \| string \| object`       | basic 中为 `false` | Permissions-Policy 配置       |
| `securityHeaders.headers`               | `Record<string, string>`          | `{}`               | preset 字段之后合并的自定义头 |
| `securityHeaders.skipPaths`             | `string[]`                        | `[]`               | 精确路径或尾部 `*` 前缀跳过   |

```typescript
export default {
  securityHeaders: {
    enabled: true,
    preset: "basic",
    headers: {
      "X-App-Security": "vext",
    },
  },
};
```

`basic` 发送 `X-Content-Type-Options`、`Referrer-Policy` 与 `X-Frame-Options`。`strict` 额外启用 HTTPS-only HSTS、最小 `Permissions-Policy`、COOP 和 CORP；CSP 与 COEP 仍需显式配置。路由可通过 `{ securityHeaders: false }` 跳过。

### 请求 ID 配置 (`requestId`)

| 配置项                     | 类型           | 默认值              | 说明                             |
| -------------------------- | -------------- | ------------------- | -------------------------------- |
| `requestId.enabled`        | `boolean`      | `true`              | 是否启用请求 ID                  |
| `requestId.header`         | `string`       | `'x-request-id'`    | 请求 ID 透传的 header 名称       |
| `requestId.responseHeader` | `string`       | `'x-request-id'`    | 响应中回传请求 ID 的 header 名称 |
| `requestId.generate`       | `() => string` | `crypto.randomUUID` | 自定义 ID 生成函数               |

```typescript
export default {
  requestId: {
    enabled: true,
    header: "x-request-id",
  },
};
```

默认从 `X-Request-Id` 请求头读取 ID，缺失或为空时调用生成器，并写入响应头。读取到的 ID 和生成器返回值都必须是长度 1–512 的字符串，且不含控制字符，否则会抛错；数组形式的请求头只取首项。它用于请求关联，不自动等同于分布式追踪的 traceId。

### 日志配置 (`logger`)

| 配置项                    | 类型                            | 默认值                     | 说明                                                                                        |
| ------------------------- | ------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| `logger.level`            | `string`                        | `'info'`                   | 日志级别                                                                                    |
| `logger.lifecycleLevel`   | `'concise' \| 'verbose'`        | `'concise'`                | 框架生命周期日志详细程度：启动、loader、hot reload、cluster 等系统日志                      |
| `logger.pretty`           | `boolean`                       | 开发环境 `true`            | 是否使用内置 pretty formatter 输出可读格式；生产环境默认关闭（输出 JSON）                   |
| `logger.prettyColor`      | `'auto' \| 'always' \| 'never'` | `'auto'`                   | pretty 模式下是否给 level label 添加 ANSI；生产 JSON 不包含 ANSI                            |
| `logger.prettySingleLine` | `boolean`                       | `true`                     | pretty 模式下将额外字段以 JSON 内联形式压缩到消息同一行；`false` 使用多行展开格式           |
| `logger.prettyIgnore`     | `string`                        | `'pid,hostname,requestId'` | pretty 模式下忽略的字段（逗号分隔）；默认隐藏 `requestId` 避免 mixin 注入字段展开为多行噪音 |
| `logger.redactKeys`       | `string[]`                      | `[]`                       | 按任意层级 exact key 脱敏结构化日志字段                                                     |
| `logger.redactPaths`      | `string[]`                      | `[]`                       | 按 dot notation exact path 脱敏结构化日志字段                                               |
| `logger.redactValue`      | `string`                        | `'[Redacted]'`             | 脱敏替换值                                                                                  |
| `logger.mixin`            | `function`                      | `undefined`                | 同步返回自定义结构化字段；`requestId` 不可被覆盖，`trace_id` / `span_id` 可由用户字段覆盖   |

支持的日志级别（从低到高）：`'trace'` → `'debug'` → `'info'` → `'warn'` → `'error'` → `'fatal'` → `'silent'`

```typescript
export default {
  logger: {
    level: "info", // 生产环境建议 'warn'
    lifecycleLevel: "concise", // 如需排障可设为 'verbose'
    pretty: true, // 开发环境开启可读格式化（生产环境默认关闭）
    // prettyColor: 'auto',              // TTY 或 FORCE_COLOR=1 时给 level label 加色
    // prettySingleLine: true,              // 额外字段压缩到同行（默认）
    // prettyIgnore: 'pid,hostname,requestId',  // 默认隐藏字段
    // redactKeys: ['password', 'token'],    // exact key 脱敏
    // redactPaths: ['headers.authorization'], // exact path 脱敏
    // mixin: () => ({ service_name: 'my-app' }), // 自定义结构化字段
  },
};
```

VextJS使用内置logger kernel与pretty formatter。默认logger支持trace、getLevel/setLevel和exact key/path redaction；完整说明见[日志文档](/zh/guide/logger)。

### 优雅关闭配置 (`shutdown`)

| 配置项             | 类型     | 默认值 | 说明                                                           |
| ------------------ | -------- | ------ | -------------------------------------------------------------- |
| `shutdown.timeout` | `number` | `10`   | 整个关闭流水线的总期限（秒）；到期后仍调用剩余清理，但不再等待 |

```typescript
export default {
  shutdown: {
    timeout: 15, // 15 秒超时（单位：秒）
  },
};
```

正常HTTP进程收到SIGTERM/SIGINT后进入有界关闭：停止接收、处理在途请求，再按注册逆序调用onClose。整个流水线共享期限，到期仍调用剩余清理但不再等待；测试helper关闭不会调用process.exit，也不能把某个未结束异步清理当成已完成。

### HTTP Server 配置 (`server`)

`server` 控制入站 Node.js HTTP server 层行为，适用于内置 Native / Hono / Fastify / Express / Koa adapter，也适用于 `vext dev` 创建的开发 server。未配置的字段保持当前 Node.js 默认值。

| 配置项                               | 类型     | 默认值         | 说明                                            |
| ------------------------------------ | -------- | -------------- | ----------------------------------------------- |
| `server.requestTimeout`              | `number` | Node.js 默认值 | 接收完整请求的最大时间（毫秒），`0` 表示禁用    |
| `server.headersTimeout`              | `number` | Node.js 默认值 | 接收完整 HTTP headers 的最大时间（毫秒）        |
| `server.keepAliveTimeout`            | `number` | Node.js 默认值 | 响应完成后 keep-alive 空闲等待时间（毫秒）      |
| `server.socketTimeout`               | `number` | Node.js 默认值 | socket inactivity timeout（毫秒），`0` 表示禁用 |
| `server.maxHeaderSize`               | `number` | Node.js 默认值 | 最大请求头大小（bytes）                         |
| `server.maxRequestsPerSocket`        | `number` | Node.js 默认值 | 单 socket 最大请求数，`0` 表示不限              |
| `server.connectionsCheckingInterval` | `number` | Node.js 默认值 | 未完成请求超时检查间隔（毫秒）                  |

```typescript
export default {
  server: {
    requestTimeout: 120_000,
    headersTimeout: 60_000,
    keepAliveTimeout: 5_000,
    socketTimeout: 0,
    maxHeaderSize: 16 * 1024,
    maxRequestsPerSocket: 0,
    connectionsCheckingInterval: 30_000,
  },
};
```

:::tip
`config.server` 只影响入站服务请求；出站 `app.fetch` / `app.fetch.proxy` 的超时仍由 `config.fetch.timeout` 或调用时 options 控制。
:::

### 响应配置 (`response`)

| 配置项                             | 类型      | 默认值  | 说明                                                                        |
| ---------------------------------- | --------- | ------- | --------------------------------------------------------------------------- |
| `response.wrap`                    | `boolean` | `true`  | 是否启用出口包装（`res.json(data)` 自动包装为 `{ code, data, requestId }`） |
| `response.hideInternalErrors`      | `boolean` | `true`  | 是否隐藏未知异常的原始消息；不隐藏显式 HttpError 的消息与 details           |
| `response.logErrors.unknownErrors` | `boolean` | `true`  | 是否记录未知 500 错误（含完整 err 对象和 stack trace）                      |
| `response.logErrors.http5xx`       | `boolean` | `true`  | 是否记录 HttpError 5xx（error 级别）                                        |
| `response.logErrors.http4xx`       | `boolean` | `false` | 是否记录 HttpError 4xx（warn 级别，高流量场景建议关闭以减少日志噪音）       |

```typescript
export default {
  response: {
    wrap: true,
    hideInternalErrors: true,
    logErrors: {
      unknownErrors: true, // 未知错误必须记录
      http5xx: true, // 5xx 是服务端责任
      http4xx: false, // 4xx 默认不记录（高流量场景避免噪音）
    },
  },
};
```

这里的 `response.hideInternalErrors` 针对的是“未知异常”的 500 路径，例如代码中直接 `throw new Error("...")`。如果你使用 `app.throw(...)` 主动抛出 `404`、`409` 等结构化 HTTP 错误，框架仍会按你指定的状态码和消息返回，不受该配置影响。

启用 `wrap: true` 后，`res.json(data)` 的实际输出：

```json
{
  "code": 0,
  "data": { "name": "Alice" },
  "requestId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

设置 `wrap: false` 可关闭包装，`res.json(data)` 直接输出原始数据。

### Body Parser 配置 (`bodyParser`)

| 配置项                   | 类型               | 默认值  | 说明               |
| ------------------------ | ------------------ | ------- | ------------------ |
| `bodyParser.enabled`     | `boolean`          | `true`  | 是否启用 body 解析 |
| `bodyParser.maxBodySize` | `string \| number` | `'1mb'` | 最大请求体大小     |

```typescript
export default {
  bodyParser: {
    enabled: true,
    maxBodySize: "5mb", // 允许更大的请求体
  },
};
```

`maxBodySize` 支持字符串格式（`'1mb'`、`'500kb'`）和数字格式（字节数）。

这是整请求边界，不因multipart.maxFileSize增大而自动放宽；Adapter/反向代理还可能有更严格限额。

### Multipart / 文件上传配置 (`multipart`)

| 配置项                       | 类型       | 默认值      | 说明                                                      |
| ---------------------------- | ---------- | ----------- | --------------------------------------------------------- |
| `multipart.enabled`          | `boolean`  | `false`     | 是否启用内置 multipart 解析（开启后自动填充 `req.files`） |
| `multipart.maxFileSize`      | `number`   | `10485760`  | 单个文件最大大小（字节，默认 10MB）                       |
| `multipart.maxFiles`         | `number`   | `10`        | 单次请求最多文件数                                        |
| `multipart.allowedMimeTypes` | `string[]` | `undefined` | 允许的 MIME 类型白名单（不设置则不限制）                  |

```typescript
export default {
  multipart: {
    enabled: true, // 开启内置解析
    maxFileSize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
    allowedMimeTypes: ["image/jpeg", "image/png", "application/pdf"],
  },
};
```

内置multipart是纯内存解析，不自动写盘；普通multipart文本字段不会自动进入req.body，路由覆盖也不能挽回全局提前拒绝的文件。完整示例与错误复验见[文件上传](/zh/guide/uploads)。

### Access Log 配置 (`accessLog`)

| 配置项                       | 类型       | 默认值   | 说明                                       |
| ---------------------------- | ---------- | -------- | ------------------------------------------ |
| `accessLog.enabled`          | `boolean`  | `true`   | 是否启用访问日志                           |
| `accessLog.level`            | `string`   | `'info'` | 基础日志级别，仅支持 `'info'` 或 `'debug'` |
| `accessLog.skipPaths`        | `string[]` | `[]`     | 精确匹配跳过的路径列表                     |
| `accessLog.skipPathPrefixes` | `string[]` | `[]`     | 前缀匹配跳过的路径列表                     |
| `accessLog.slowThreshold`    | `number`   | `0`      | 慢请求阈值，`0` 表示不启用                 |
| `accessLog.warnOn4xx`        | `boolean`  | `false`  | 是否将 4xx 响应提升为 `warn`               |
| `accessLog.logResponseSize`  | `boolean`  | `false`  | 是否追加响应体大小                         |

```typescript
export default {
  accessLog: {
    enabled: true,
    level: "info",
    skipPaths: ["/health", "/ready"],
    skipPathPrefixes: ["/internal"],
    slowThreshold: 1000,
    warnOn4xx: false,
    logResponseSize: false,
  },
};
```

启用后，请求完成时会按日志级别和路径过滤设置记录访问日志；以下是 pretty 模式下的示意：

```
GET /api/users 200 12ms | 127.0.0.1
```

### OpenAPI 配置 (`openapi`)

| 配置项                                  | 类型                     | 默认值                | 说明                                                                                                                                                                                  |
| --------------------------------------- | ------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openapi.enabled`                       | `boolean`                | `false`               | 是否启用 OpenAPI 文档                                                                                                                                                                 |
| `openapi.title`                         | `string`                 | `'VextJS API'`        | OpenAPI 规范的 info.title；内置 UI 标题可由 docs.ui.title 单独配置，无两者时 UI 使用 Vext API Docs                                                                                    |
| `openapi.description`                   | `string`                 | `''`                  | 文档描述                                                                                                                                                                              |
| `openapi.version`                       | `string`                 | `'1.0.0'`             | API 版本号                                                                                                                                                                            |
| `openapi.docs.path`                     | `string`                 | `'/docs'`             | Vext Docs 文档路径                                                                                                                                                                    |
| `openapi.docs.assetsPath`               | `string`                 | `'/_vext/docs'`       | Vext 内部注册的 docs 资产与 source-aware 数据端点前缀，包含 app.js / style.css / favicon.svg                                                                                          |
| `openapi.docs.assetsPublicPath`         | `string`                 | 同 `assetsPath`       | 浏览器可见的 docs 资产/数据前缀。HTML 中的 app.js / style.css / favicon.svg 使用该公开前缀，适合反向代理剥离公开前缀时配置                                                            |
| `openapi.docsPath`                      | `string`                 | `'/docs'`             | 兼容字段；新项目推荐使用 `openapi.docs.path`                                                                                                                                          |
| `openapi.jsonPath`                      | `string`                 | `'/openapi.json'`     | OpenAPI JSON 端点路径（vext 内部路由注册路径）                                                                                                                                        |
| `openapi.jsonPublicPath`                | `string`                 | 同 `jsonPath`         | 外部工具和链接使用的公开 OpenAPI 规范地址。内置 source-aware docs 数据使用 `openapi.docs.assetsPublicPath` / `assetsPath`，详见[反向代理部署](/zh/guide/openapi#反向代理路径前缀场景) |
| `openapi.docs.renderer`                 | `'vext'`                 | `'vext'`              | 内置 Vext Docs renderer；不再支持第三方 renderer object，外部工具请直接消费 `/openapi.json`                                                                                           |
| `openapi.docs.code`                     | `object`                 | `{ enabled: 'auto' }` | services / utils / models / components / plugins / middlewares 文档源配置                                                                                                             |
| `openapi.docs.code.scan`                | `'lazy' \| 'background'` | `'lazy'`              | Code Docs 扫描生命周期；`lazy` 每次请求 docs data 时扫描，`background` 在文档注册时预热一次进程内快照并复用                                                                           |
| `openapi.docs.sources`                  | `Array`                  | `[]`                  | 可选的 Public/Admin/Internal 或多版本文档面配置。每个 source 都需要 `match`；非 `All` code docs 需要显式 `code.include` / `code.exclude`                                              |
| `openapi.docs.tryItOut.hookScript`      | `string`                 | `undefined`           | 可选的浏览器端 hook 脚本路径，Vext Docs 会加载后再按 `hookGlobal` 查找请求/响应 hook                                                                                                  |
| `openapi.docs.tryItOut.hookGlobal`      | `string`                 | `'VextDocsHooks'`     | Try it out `beforeRequest` / `afterResponse` hook 的浏览器全局变量名                                                                                                                  |
| `openapi.docs.tryItOut.defaultServer`   | `string`                 | `undefined`           | Try it out 初始 server，支持 `"first"`、`"same-origin"`、`"custom"` 或精确 OpenAPI server URL                                                                                         |
| `openapi.docs.tryItOut.sameOrigin`      | `boolean \| 'auto'`      | `'auto'`              | 是否显示 Same origin server 选项；`auto` 仅在没有配置 OpenAPI servers 时显示                                                                                                          |
| `openapi.docs.tryItOut.customServer`    | `boolean`                | `true`                | 是否允许访问者在浏览器中临时填写 Try it out base URL                                                                                                                                  |
| `openapi.docs.tryItOut.customServerUrl` | `string`                 | `undefined`           | Custom server 输入框的可选默认值                                                                                                                                                      |
| `openapi.docs.access.openapiJson`       | `'filtered' \| 'public'` | `'filtered'`          | canonical `/openapi.json` 是否跟随 docs 权限过滤，或保持公开                                                                                                                          |
| `openapi.scalar`                        | `object`                 | `undefined`           | 已废弃兼容字段；仅显式配置时触发 warning，不影响内置 Vext Docs 页面                                                                                                                   |
| `openapi.servers`                       | `Array`                  | `[]`                  | API 服务器列表                                                                                                                                                                        |
| `openapi.tags`                          | `Array`                  | `[]`                  | 标签定义                                                                                                                                                                              |
| `openapi.securitySchemes`               | `object`                 | `{}`                  | 安全方案                                                                                                                                                                              |
| `openapi.contact`                       | `object`                 | `{}`                  | 联系方式                                                                                                                                                                              |
| `openapi.license`                       | `object`                 | `{}`                  | 许可证信息                                                                                                                                                                            |

`openapi.docs.access.cacheKey` 当前版本不支持，并会被配置校验拒绝。请直接配置 resolver；后续若引入文档缓存层，应由独立缓存契约重新定义。

固定本地或部署 API 目标时，`openapi.servers[].url` 建议直接写带端口的完整 base URL，例如 `http://127.0.0.1:3000`。只有环境名、区域、租户或 API 版本这类真正会变化的 URL 片段，才建议使用 `openapi.servers[].variables`。`openapi.docs.tryItOut.defaultServer` 用于控制 Try it out 初始选中的 server，`openapi.docs.tryItOut.customServer` 用于允许用户在浏览器里临时输入其他目标地址，不需要修改项目配置。

```typescript
export default {
  openapi: {
    enabled: true,
    title: "My App API",
    description: "我的应用 API 文档",
    version: "1.0.0",
    docs: {
      path: "/docs",
      renderer: "vext",
      code: {
        enabled: "auto",
      },
    },
    jsonPath: "/openapi.json",
    servers: [
      { url: "http://localhost:3000", description: "本地开发" },
      { url: "https://api.myapp.com", description: "生产环境" },
    ],
    tags: [
      { name: "用户", description: "用户管理相关接口" },
      { name: "订单", description: "订单管理相关接口" },
    ],
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    contact: {
      name: "API Support",
      email: "support@myapp.com",
    },
    license: {
      name: "Apache-2.0",
      url: "https://www.apache.org/licenses/LICENSE-2.0",
    },
  },
};
```

### 数据库配置 (`database`)

提供非空 `database` 时，会启用 Vext 内置的 `monsqlize@3.3.0` 生命周期；当前没有database.enabled关闭开关，未配置、null或空对象才会跳过。生命周期包括连接归一化、
日志桥接、Model 加载、挂载原始 `app.db` 以及关闭清理。这些由
Vext 管理的能力继续使用一等字段配置。`database.monsqlizeOptions` 是带类型且
经过运行时校验的高级 allowlist 入口；受保护或未知字段会在上游构造函数运行前失败。

```typescript
export default {
  database: {
    config: { uri: "mongodb://localhost:27017/myapp" },
    maxTimeMS: 2_000,
    monsqlizeOptions: {
      findMaxLimit: 2_000,
      transaction: { enableRetry: true, maxRetries: 2 },
      writePathPolicy: { default: "model-only" },
    },
  },
};
```

完整 allowlist、所有权边界、原始实例 API、Vector Search 与关系保护删除前提见
[数据库 (MonSQLize)](./database.md#受控的-monsqlize-高级配置)。

### 请求上下文配置 (`requestContext`)

| 配置项                   | 类型      | 默认值 | 说明                                  |
| ------------------------ | --------- | ------ | ------------------------------------- |
| `requestContext.enabled` | `boolean` | `true` | 是否启用 AsyncLocalStorage 请求上下文 |

```typescript
export default {
  requestContext: {
    enabled: true,
  },
};
```

:::warning 性能提示
禁用 `requestContext` 会移除基于请求上下文的生命周期能力，也可能减少相应开销，但收益取决于负载，必须用实际应用验证。以下功能将失效：

- `app.logger` 自动携带 `requestId`
- `app.throw()` 自动解析请求 locale
- `app.fetch` 自动传播 `requestId`

仅在确认这些能力不需要、且实际压测证明收益成立时考虑禁用。
:::

### Cluster 配置 (`cluster`)

| 配置项                           | 类型               | 默认值        | 说明                                   |
| -------------------------------- | ------------------ | ------------- | -------------------------------------- |
| `cluster.enabled`                | `boolean`          | `false`       | 是否启用 Cluster 模式                  |
| `cluster.workers`                | `number \| string` | `'auto'`      | Worker 数量（`'auto'` = CPU 核数）     |
| `cluster.autoRestart`            | `boolean`          | `true`        | Worker 崩溃时自动重启                  |
| `cluster.maxRestarts`            | `number`           | `5`           | 时间窗口内最大重启次数                 |
| `cluster.restartWindow`          | `number`           | `60000`       | 重启计数窗口（毫秒）                   |
| `cluster.restartBaseDelay`       | `number`           | `1000`        | 重启基础延迟（毫秒）                   |
| `cluster.restartMaxDelay`        | `number`           | `30000`       | 重启最大延迟（毫秒）                   |
| `cluster.healthCheck.enabled`    | `boolean`          | `true`        | 是否启用 Worker 心跳检测               |
| `cluster.healthCheck.interval`   | `number`           | `15000`       | 心跳探测间隔（毫秒）                   |
| `cluster.healthCheck.timeout`    | `number`           | `30000`       | 心跳超时（毫秒）                       |
| `cluster.reload.workerDelay`     | `number`           | `2000`        | 替换下一个 Worker 前的等待时间（毫秒） |
| `cluster.reload.readyTimeout`    | `number`           | `30000`       | Worker 就绪超时（毫秒）                |
| `cluster.reload.shutdownTimeout` | `number`           | `10000`       | Worker 关闭超时（毫秒）                |
| `cluster.pidFile`                | `string`           | `'.vext.pid'` | PID 文件路径                           |

```typescript
export default {
  cluster: {
    enabled: true,
    workers: "auto", // 自动检测 CPU 核数
    autoRestart: true,
    maxRestarts: 5,
    healthCheck: { enabled: true },
    reload: { workerDelay: 2000 },
  },
};
```

也可以通过环境变量 `VEXT_CLUSTER=1` 开启 Cluster 模式，无需修改配置文件。

### Jobs 配置

`config.jobs` 配置 Job runtime 的任务发现、scheduler、worker、Store、租约和默认执行策略，不会让 HTTP 启动自动执行 Job。测试 helper 使用显式传入的 Job 定义；Vext Docs 的 Job source 有自己的目录配置，不能假定修改 jobs.dir 会自动同步所有文档或工具入口。各入口的职责与实际生效字段见下方指南及 API。

```ts
export default {
  jobs: {
    enabled: true,
    dir: "jobs",
    runner: "inline",
    store: { type: "file", dir: ".vext/jobs" },
    scheduler: { enabled: true, mode: "inline" },
    worker: { enabled: true, concurrency: 4 },
  },
};
```

详见 [任务与 Jobs](/zh/guide/jobs) 与 [Jobs API](/zh/api/jobs)。

### Dev 模式配置 (`dev`)

| 配置项                       | 类型                | 默认值   | 说明                                                            |
| ---------------------------- | ------------------- | -------- | --------------------------------------------------------------- |
| `dev.errorOverlay.enabled`   | `boolean`           | `true`   | 是否启用 Dev 错误覆盖层（浏览器访问出错路由时显示 HTML 错误页） |
| `dev.errorOverlay.theme`     | `'dark' \| 'light'` | `'dark'` | 错误覆盖层主题                                                  |
| `dev.errorOverlay.maxFrames` | `number`            | `25`     | 最多显示的堆栈帧数                                              |

```typescript
export default {
  dev: {
    errorOverlay: {
      enabled: true, // 设为 false 可禁用 HTML 错误覆盖层
      theme: "dark",
      maxFrames: 25,
    },
  },
};
```

:::tip 仅开发模式生效
`dev` 配置项仅在 `vext dev` 开发模式下读取，生产模式（`vext start`）自动忽略所有字段。

Dev 错误覆盖层基于 **Accept 内容协商**，而非 HTTP 方法：

- `Accept: text/html`（浏览器地址栏 GET、HTML 表单 POST）→ 返回 HTML 错误页
- `Accept: application/json`（前端 fetch / axios / curl）→ 始终返回 JSON

控制台日志**不受 overlay 影响**——无论响应返回 HTML 还是 JSON，`logErrors` 配置的日志行为完全相同。
:::

### 中间件白名单 (`middlewares`)

| 配置项        | 类型                                            | 默认值 | 说明               |
| ------------- | ----------------------------------------------- | ------ | ------------------ |
| `middlewares` | `Array<string \| { name, options?, enabled? }>` | `[]`   | 路由级中间件白名单 |

```typescript
export default {
  middlewares: [
    // 普通中间件 — 字符串声明
    "auth",
    "timing",

    // 工厂中间件 — 对象声明（附带默认参数）
    { name: "check-role", options: { roles: ["user"] } },
    { name: "cache-control", options: { maxAge: 3600 } },
  ],
};
```

只有在白名单中声明的中间件才能在路由的 `options.middlewares` 中被引用。

## 在代码中访问配置

### 路由中

```typescript
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/info", {}, async (_req, res) => {
    res.json({
      port: app.config.port,
      openapi: app.config.openapi.enabled,
    });
  });
});
```

### 服务中

```typescript
import type { VextApp } from "vextjs";

export default class MyService {
  constructor(private app: VextApp) {}

  getListenAddress() {
    const { host, port } = this.app.config;
    const address = host.includes(":") ? `[${host}]` : host;
    return `http://${address}:${port}`;
  }
}
```

### 插件中

```typescript
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "my-plugin",
  setup(app) {
    const myConfig = app.config.myPlugin ?? { enabled: false };
    if (!myConfig.enabled) return;
    // ...
  },
});
```

:::tip 配置只读
`app.config`的普通对象与数组在加载后被深冻结；ESM严格模式下改写冻结属性会抛TypeError。显式传入的非普通类实例不被递归冻结，因此不能把这个机制理解成会冻结Redis客户端内部状态。
:::

## 自定义配置字段

`VextConfig` 接口允许扩展自定义字段。插件和业务代码可以在配置中添加任意字段：

```typescript
// src/config/default.ts
export default {
  port: 3000,

  // 自定义字段
  redis: {
    url: "redis://localhost:6379",
    db: 0,
  },
  mailer: {
    smtp: "smtp://localhost:1025",
    from: "noreply@myapp.com",
  },
};
```

配合 `declare module` 获得类型提示：

```typescript
// src/types/config.d.ts
import "vextjs";

declare module "vextjs" {
  interface VextConfig {
    redis?: {
      url: string;
      db?: number;
    };
    mailer?: {
      smtp: string;
      from: string;
    };
  }
}
```

## 环境变量

除了配置文件，部分设置也可以通过环境变量控制：

VextJS 不会自动解析 `.env` 文件。`process.env` 中可见的值，必须已由操作系统、
shell、进程管理器、容器/CI 平台、密钥系统或应用显式拥有的 loader 注入。Vext
配置 profile 由 `--config` 或 `VEXT_CONFIG` 选择；`.env` 文件不是另一个内建的
Vext profile 层。

| 环境变量               | 说明                                                   |
| ---------------------- | ------------------------------------------------------ |
| `VEXT_CONFIG`          | 选择要加载的配置 profile                               |
| `NODE_ENV`             | 运行时模式；`vext start` 固定为 production             |
| `PORT`                 | 可在 `default.ts` 中引用 `process.env.PORT`            |
| `VEXT_PORT`            | CLI `--port` 的内部传递变量，优先级高于 provider patch |
| `VEXT_HOST`            | CLI `--host` 的内部传递变量，优先级高于 provider patch |
| `VEXT_PORT_CONFLICT`   | 端口冲突策略：`error` / `prompt` / `kill` / `next`     |
| `VEXT_LIFECYCLE_LEVEL` | 生命周期日志级别：`concise` / `verbose`                |
| `VEXT_CLUSTER`         | 设为 `1` 时启用 Cluster 模式                           |

```typescript
// src/config/default.ts — 使用环境变量
export default {
  port: Number(process.env.PORT) || 3000,
  logger: {
    level: process.env.LOG_LEVEL || "info",
  },
};
```

:::tip 配置来源选择
部署值可以由项目选定的配置文件、平台注入或provider提供；框架不要求统一使用某一种来源。例如：

- 使用环境变量：`process.env.DB_PASSWORD`
- 使用 `local.ts`（已加入 `.gitignore`）存放本地开发的敏感配置

生产模式不会加载local.ts，生产值应通过实际加载的profile/provider或显式环境输入提供。
:::

## 配置校验

`config-loader` 在合并完成后执行启动校验。下面是常见检查摘要；各配置域还有专用校验，不能把这份清单理解为所有字段和业务值均已被验证：

- `port` 必须是 1-65535 范围内的正整数
- `adapter` 必须是已知的内置标识或合法的 adapter 对象/函数
- `middlewares` 数组中每个元素必须是字符串或 `{ name: string }` 对象
- `rateLimit.max`、`rateLimit.window` 当前检查类型为 number 且不小于 1，并未完整检查有限性与整数性。应用应使用有限的正数，次数 `max` 使用整数；`window` 的单位是秒
- `logger.level` 必须是合法的日志级别
- `logger.redactKeys` / `logger.redactPaths` 必须是字符串数组，`logger.redactValue` 必须是字符串
- `shutdown.timeout` 必须是有限非负数（单位：秒）
- `server.requestTimeout`、`server.headersTimeout`、`server.keepAliveTimeout`、`server.socketTimeout` 必须是非负有限数（单位：毫秒）
- `server.maxHeaderSize`、`server.connectionsCheckingInterval` 必须是正整数，`server.maxRequestsPerSocket` 必须是非负整数
- `cluster.workers` 必须是正整数或 `'auto'` / `'auto-1'`

命中已有校验时，框架在启动阶段报错。自定义字段、外部服务可用性及未覆盖的业务约束仍需应用检查；配置加载通过不能单独证明应用可用。

## 排查与复验

| 症状                   | 判断与处理                                                                        | 复验                       |
| ---------------------- | --------------------------------------------------------------------------------- | -------------------------- |
| profile似乎未生效      | CLI/env选择、profile文件名与实际构建是否一致；文件本身可选，不存在时没有该层patch | 用上方诊断字段验证         |
| production仍读到本地值 | 区分环境变量、provider和local层，不把自定义profile当运行模式                      | 干净环境build/start重试    |
| 中间件options缺字段    | 同名options整项替换，不是内部深合并                                               | 检查最终配置并请求对应路由 |
| provider超时后启动失败 | production默认required；核对远端状态与signal处理                                  | 恢复依赖后重启验证         |
| 修改配置抛TypeError    | 普通配置已冻结，调整源配置后按需重启                                              | 从新进程读取生效值         |

## 下一步

- 了解 [Adapter 架构](/zh/guide/adapters) 的详细配置和切换方法
- 学习 [中间件](/zh/guide/middleware) 白名单的配置方式
- 查看 [OpenAPI 文档](/zh/guide/openapi) 的高级配置
- 探索 [Cluster 多进程](/zh/guide/cluster) 的配置选项
