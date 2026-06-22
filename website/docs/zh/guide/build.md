# 构建 (vext build)

`vext build` 会将服务端源码编译为可部署的 JavaScript 产物；当 `frontend.enabled` 为 true 时，还会把浏览器客户端打包到 `dist/client/`。当前版本的 `vext build` 按 **production-target build** 设计：它会对用户源码中的 `process.env.NODE_ENV` 做生产模式静态注入，但运行时实际加载哪个环境配置文件，仍由 `vext start` 时的 `NODE_ENV` 决定。基于 [esbuild](https://esbuild.github.io/) 实现，编译阶段针对本地与 CI 反馈速度做了优化。

## 快速开始

```bash
# 编译生产产物
vext build

# 运行已构建产物（TypeScript 项目需已生成有效 dist/）
NODE_ENV=production vext start

# 加载自定义环境配置（需存在 src/config/sg-sit.ts）
NODE_ENV=sg-sit vext start
```

## 构建前置产物刷新

TypeScript 项目执行 `vext build` 时，会先刷新开发工具链需要的 generated 与 manifest 产物，再进入可选类型检查和 esbuild 编译：

1. `vext typegen` 基础刷新：写入 `.vext/types/*.generated.d.ts`、`src/types/generated/index.d.ts` 与 `.vext/manifest/services.json`
2. `doctor routes --refresh --write-manifest`：重新扫描路由并写入 `.vext/manifest/routes.json`
3. 如果传入 `--typecheck`，此时再执行 `tsc --noEmit`
4. 由 esbuild 将服务端运行时代码输出到 `dist/`
5. 如果 `config.frontend.enabled` 为 true，再由 esbuild 将浏览器客户端打包到 `dist/client/`

这保证新脚手架或刚清理过 `.vext/` 的项目，也能在 `vext build --typecheck` 中先拿到最新 generated 类型，再进入 TypeScript 校验。

## 编译策略

### 逐文件编译（File-by-File Transform）

`vext build` 对服务端代码采用**逐文件编译**模式，而非 bundle 模式——每个源文件独立编译为一个输出文件，保持 `src/` 的目录结构映射。`src/frontend/**` 不进入服务端逐文件编译步骤，而是由前端 bundler 和 SSR renderer 构建步骤单独处理。

```
src/                          dist/
├── index.ts            →     ├── index.js        + index.js.map
├── config/                   ├── config/
│   ├── default.ts      →     │   ├── default.js   + default.js.map
│   └── production.ts   →     │   └── production.js + production.js.map
├── routes/                   ├── routes/
│   ├── users.ts        →     │   ├── users.js      + users.js.map
│   └── posts.ts        →     │   └── posts.js      + posts.js.map
├── services/                 ├── services/
│   ├── user.ts         →     │   ├── user.js       + user.js.map
│   └── auth.ts         →     │   └── auth.js       + auth.js.map
├── plugins/                  ├── plugins/
│   └── redis.ts        →     │   └── redis.js      + redis.js.map
├── middlewares/              └── middlewares/
│   └── auth.ts         →         └── auth.js        + auth.js.map
└── models/                   └── models/
    └── user.ts         →         └── user.js        + user.js.map
```

### 为什么不 Bundle？

| 特性       | 逐文件编译                   | Bundle              |
| ---------- | ---------------------------- | ------------------- |
| 目录结构   | 保持原始结构，便于调试       | 合并为单个/少量文件 |
| Source Map | 精确映射到源文件行号         | 映射可能不准确      |
| 模块加载   | Node.js 原生解析 `require()` | 需要自定义 runtime  |
| 热重载     | 可单文件替换（开发模式）     | 需全量重编译        |
| 依赖管理   | 外部依赖由 Node.js 解析      | 需配置 externals    |

## 编译选项

### CLI 参数

| 参数              | 说明                                            | 默认值  |
| ----------------- | ----------------------------------------------- | ------- |
| `--outdir <path>` | 输出目录                                        | `dist`  |
| `--clean`         | 编译前清理输出目录                              | `false` |
| `--sourcemap`     | 生成 source map                                 | `true`  |
| `--no-sourcemap`  | 禁用 source map                                 | —       |
| `--minify`        | 压缩输出代码                                    | `false` |
| `--typecheck`     | 刷新 generated / manifest 后执行 `tsc --noEmit` | `false` |

## 前端构建

当 `config.frontend.enabled` 为 true 时，浏览器流水线使用 esbuild bundle 模式：

```text
src/frontend/pages/index.tsx      →  dist/client/assets/index-<hash>.js
generated browser entry           →  dist/client/assets/browser-entry-<hash>.js
src/frontend/pages/_document.html →  dist/client/index.html
src/frontend/styles/index.css     →  dist/client/assets/browser-entry-<hash>.css
public/** → dist/client/**
.vext/manifest/routes.json → dist/client/client-contract.json + dist/client/api.generated.ts
.vext/generated/frontend/server-renderer.ts → dist/client/server/renderer.cjs
```

前端构建会写入：

| 文件                                 | 说明                                                              |
| ------------------------------------ | ----------------------------------------------------------------- |
| `dist/client/index.html`             | `vext start` 服务的 HTML 入口                                     |
| `dist/client/assets/*`               | 打包后的 JavaScript、CSS 与导入资产                               |
| `dist/client/manifest.json`          | 前端资源 manifest                                                 |
| `dist/client/deploy-manifest.json`   | 可上传静态资源 manifest，含 sha256、SRI、content type、upload key |
| `dist/client/render-manifest.json`   | SSR 页面、layout、错误页与 renderer manifest                      |
| `dist/client/messages-manifest.json` | 前端 i18n messages manifest                                       |
| `dist/client/server/renderer.cjs`    | SSR renderer bundle                                               |
| `dist/client/size-report.json`       | 前端资源体积摘要                                                  |
| `dist/client/client-contract.json`   | 基于 route manifest 生成的路由契约                                |
| `dist/client/api.generated.ts`       | 轻量 typed API client module                                      |

启用前端但缺少 `dist/client/index.html` 时，`vext start` 会 fail fast。生产启动前请先执行 `vext build`。

浏览器端页面、layout、错误页和 locale 会通过动态 import 形成页面级 chunk；React 等公共依赖默认通过 Vext-managed vendor entry 配合 esbuild splitting 形成共享 chunk。`frontend.build.client.external` 可把模块排除出 browser bundle，但必须用 `frontend.build.client.externalRuntime` 给浏览器提供 import map URL，否则浏览器无法加载该外置模块。

`frontend.deploy.integrity=true` 时，Vext 会把构建期计算出的 SRI 写入生成 HTML 的 JS/CSS 标签。`deploy-manifest.json` 同时覆盖 esbuild 输出资源和 `public/**` 复制资源，可用于 `vext deploy assets` 的真实上传与增量发布；默认不包含服务端渲染的 `index.html` 和 source map。

### 输出格式

| 选项     | 值               | 说明                                         |
| -------- | ---------------- | -------------------------------------------- |
| Format   | `cjs` (CommonJS) | 统一输出 CommonJS，确保 `require.cache` 可控 |
| Target   | `node20`         | 与 `engines.node >= 20.19.0` 对齐            |
| Platform | `node`           | Node.js 运行时                               |
| Charset  | `utf8`           | 强制 UTF-8，避免中文转义                     |

### 优化选项

| 选项         | 默认值                       | 说明                                  |
| ------------ | ---------------------------- | ------------------------------------- |
| Source Map   | `external`（`.js.map` 文件） | 错误堆栈映射回 TypeScript 行号        |
| Tree Shaking | 开启                         | 移除未使用的导出（死代码消除）        |
| Keep Names   | 开启                         | 保留函数/类名称（错误堆栈可读性）     |
| Minify       | 关闭                         | 可选开启，减小产物体积                |
| packages     | `external`                   | 外部依赖不打包，运行时由 Node.js 解析 |

### 自动注入

编译时自动注入以下定义：

```typescript
define: {
  'process.env.NODE_ENV': '"production"'
}
```

这会让 build 后**用户源码中的** `process.env.NODE_ENV` 分支按 production 语义被静态折叠。

注意，这个注入并不等于“运行时固定加载 `config/production.ts`”。运行时实际加载哪个配置文件，仍由 `vext start` 时的 `NODE_ENV` 决定，例如：

```bash
NODE_ENV=sg-sit vext start
```

会尝试加载：

```text
dist/config/sg-sit.js
```

因此，当前 `vext build` 的推荐用法是：

- 用它生成 production-target artifact
- 用 `vext start` 的 `NODE_ENV` 选择环境配置文件
- 不要依赖 build 后用户源码中的 `process.env.NODE_ENV` 条件分支做 sit/uat/prod 切换

如果你希望在 `package.json` scripts 中跨平台设置 `NODE_ENV`，推荐使用 `cross-env`：

```json
{
  "scripts": {
    "start:sg-sit": "cross-env NODE_ENV=sg-sit vext start"
  }
}
```

## 文件扫描规则

### 包含的文件

`vext build` 扫描 `src/` 目录下所有匹配以下模式的文件：

```
**/*.{ts,js,mjs,cjs}
```

服务端逐文件编译会忽略 `src/frontend/**`；前端文件由浏览器 bundle 和 SSR renderer 构建步骤处理。

### 排除的文件

编译自动排除以下文件（两层排除规则）：

#### 通用排除（与开发模式共享）

| 模式              | 说明                                        |
| ----------------- | ------------------------------------------- |
| `**/*.d.ts`       | TypeScript 类型声明（仅类型，无运行时代码） |
| `**/*.test.*`     | 测试文件                                    |
| `**/*.spec.*`     | 测试文件                                    |
| `**/__tests__/**` | 测试目录                                    |

#### 生产编译额外排除

| 模式                      | 说明                                  |
| ------------------------- | ------------------------------------- |
| `**/config/development.*` | 开发环境配置（生产无意义）            |
| `**/config/local.*`       | 本地覆盖配置（永远不部署）            |
| `**/config/test.*`        | 测试环境配置（生产不需要）            |
| `**/client/**`            | 浏览器客户端源码，由前端 bundler 处理 |

:::tip
这意味着 `dist/` 中不会包含开发/测试/本地配置文件，避免敏感信息泄漏到生产环境。
:::

## Source Map

### 外部 Source Map

`vext build` 生成外部 `.js.map` 文件（与 `vext dev` 的 inline source map 不同）：

```
dist/
├── index.js          # 编译后的 JavaScript
├── index.js.map      # Source Map（映射回 src/index.ts）
├── routes/
│   ├── users.js
│   └── users.js.map
└── ...
```

### 启用 Source Map 支持

在 Node.js 运行时启用 source map，让错误堆栈显示 TypeScript 行号：

```bash
NODE_OPTIONS=--enable-source-maps NODE_ENV=production vext start
```

未启用时的错误堆栈：

```
Error: Something went wrong
    at UserService.findById (dist/services/user.js:23:11)
```

启用后的错误堆栈：

```
Error: Something went wrong
    at UserService.findById (src/services/user.ts:42:11)
```

### Source Map 用途

| 场景     | 说明                                  |
| -------- | ------------------------------------- |
| 错误堆栈 | 映射回原始 TypeScript 行号            |
| APM 工具 | Sentry / Datadog 等工具定位源码       |
| 调试     | `node --inspect --enable-source-maps` |

:::warning
生产环境部署时，`.js.map` 文件可以保留在服务器上（不会被 HTTP 暴露），但不要部署到 CDN 或静态文件服务中。
:::

## 与 DevCompiler 的对比

`vext build` 和 `vext dev` 共享相同的 esbuild 基础配置（`createBaseEsbuildConfig()`），确保开发和生产环境的编译行为一致：

| 特性              | `vext dev`（DevCompiler）       | `vext build`（BuildCompiler）   |
| ----------------- | ------------------------------- | ------------------------------- |
| **输出目录**      | `.vext/dev/`（临时，gitignore） | `dist/`（持久，可部署）         |
| **编译模式**      | 增量编译 + 单文件编译           | 全量编译（每次全量）            |
| **Source Map**    | inline（嵌入 JS 文件）          | external（独立 `.js.map`）      |
| **热重载**        | 支持（Tier 1/2/3）              | 不支持（一次性编译）            |
| **额外排除**      | 无                              | config/development, local, test |
| **NODE_ENV 注入** | 无                              | `"production"`                  |
| **MetaFile**      | 无                              | 有（编译统计）                  |
| **典型耗时**      | ~23ms（增量）                   | ~500ms（全量）                  |

### 共享配置

两者共享的 esbuild 配置包括：

- `platform: 'node'` — Node.js 运行时
- `target: 'node20'` — 最低支持 Node.js 20.19.0
- `format: 'cjs'` — CommonJS 输出
- `bundle: false` — 逐文件编译
- `treeShaking: true` — 死代码消除
- `keepNames: true` — 保留函数名
- `charset: 'utf8'` — UTF-8 编码
- `loader` — `.ts`/`.js`/`.json` 等文件类型映射

## 编译结果

`vext build` 执行完成后，输出编译报告：

```
vext build

  ✓ Compiled 42 files in 487ms
  ✓ Output: dist/

  Files:  42 JS + 42 Source Maps
  Errors: 0
  Warnings: 0
```

### BuildResult 结构

| 字段         | 类型        | 说明                             |
| ------------ | ----------- | -------------------------------- |
| `success`    | `boolean`   | 编译是否成功（无错误）           |
| `fileCount`  | `number`    | 输出的 JS 文件数量               |
| `totalFiles` | `number`    | 输入的源文件总数                 |
| `elapsed`    | `number`    | 编译耗时（毫秒）                 |
| `outDir`     | `string`    | 输出目录路径                     |
| `warnings`   | `Message[]` | esbuild 警告信息                 |
| `errors`     | `Message[]` | esbuild 错误信息                 |
| `metafile`   | `Metafile`  | esbuild 编译元信息（文件大小等） |

## 运行编译产物

```bash
# 基本启动
NODE_ENV=production vext start

# 启用 source map（推荐）
NODE_OPTIONS=--enable-source-maps NODE_ENV=production vext start

# 增大内存上限
NODE_OPTIONS="--enable-source-maps --max-old-space-size=4096" NODE_ENV=production vext start
```

如果 TypeScript 项目缺少 `dist/` 或关键构建产物，`vext start` 会直接失败并提示先执行 `vext build`。开发期源码启动请使用 `vext dev`。

如果启用了前端，`vext start` 还会检查 `dist/client/index.html`，并在 API / 文档路径之外以 SPA fallback 服务 `dist/client/`。

通用脚手架项目没有固定的 `dist/index.js` 启动入口；直接 `node dist/index.js` 只适用于你自己维护入口文件并显式调用框架启动逻辑的高级场景。

### VEXT_BUILT 标记

通过 `vext start` 运行有效 `dist/` 构建产物时，CLI 会设置 `VEXT_BUILT=1` 环境变量。这影响：

- **路径解析**：`src/routes/` → `dist/routes/`
- **模块加载**：从 `dist/` 目录加载 routes、services、plugins、middlewares
- **Model 加载**：MonSQLize 从 `dist/models/` 加载 Model 定义

你不需要手动设置这个变量，使用 `vext start` 时框架会自动处理。

## 部署清单

使用 `vext build` 部署到生产环境的推荐步骤：

```bash
# 1. 安装依赖
npm ci

# 2. 编译
npx vext build

# 3. 仅安装生产依赖（可选，用于 Docker 等场景）
npm ci --omit=dev

# 4. 启动
NODE_OPTIONS=--enable-source-maps NODE_ENV=production npx vext start
```

### Docker 多阶段构建

```dockerfile
# 阶段 1: 编译
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src/ src/
COPY tsconfig.json ./
RUN npx vext build

# 阶段 2: 运行
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
ENV NODE_ENV=production
ENV NODE_OPTIONS=--enable-source-maps
CMD ["npm", "start"]
```

### .gitignore

确保 `dist/` 目录在 `.gitignore` 中（编译产物不应提交到 Git）：

```
dist/
.vext/
node_modules/
```

## 故障排查

### 编译失败

```
Error: [vextjs] No source files found in /project/src
```

确保 `src/` 目录存在且包含 `.ts` 或 `.js` 文件。

### 运行时找不到模块

```
Error: Cannot find module './routes/users.js'
```

可能原因：

1. `vext build` 后没有重新安装依赖（`npm ci`）
2. 某些文件被排除规则跳过了（检查是否符合排除规则）
3. 使用了动态 `import()` 引用 `.d.ts` 文件

### Source Map 不生效

确保启动时通过 `NODE_OPTIONS` 传入 `--enable-source-maps` 参数：

```bash
# ✅ 正确
NODE_OPTIONS=--enable-source-maps NODE_ENV=production vext start

# ❌ 参数位置错误
vext start --enable-source-maps
```

## 下一步

- 了解 [部署与生产环境](/guide/deployment) 的完整部署指南
- 查看 [热重载](/guide/hot-reload) 了解开发模式的编译策略
- 学习 [CLI 命令](/guide/cli) 中 `vext build` 的完整参数
- 探索 [Cluster 多进程](/guide/cluster) 充分利用多核 CPU
