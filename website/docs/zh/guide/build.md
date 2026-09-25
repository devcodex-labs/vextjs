# 构建 (vext build)

`vext build` 为生产运行准备应用产物。TypeScript 后端编译为 JavaScript；纯 JavaScript 后端直接使用源码。启用前端时，还会构建浏览器资源、服务端 renderer 和相关 manifest。

本页先完成一次构建、启动和请求验证，再说明编译规则、配置、产物与部署。命令总览见 [CLI](/zh/guide/cli)，前端交付细节见[前端构建与发布](/zh/frontend/build-and-deploy)。

## 快速开始

### 前置条件与项目类型

在包含 `package.json` 和 `src/` 的应用根目录执行命令，先安装项目依赖。本文的 `npx vextjs` 调用已安装的 Vext CLI；npm scripts 中可以直接使用 `vext`。首次创建项目见[快速开始](/zh/guide/quick-start)。

| 项目类型            | 构建行为                                 | 部署时保留什么                                 |
| ------------------- | ---------------------------------------- | ---------------------------------------------- |
| TypeScript API 项目 | 刷新类型与路由清单，再编译后端           | 后端输出目录、构建身份、生产依赖和项目运行资源 |
| TypeScript + 前端   | 后端编译后继续构建前端                   | 后端与前端的完整产物、身份及生产依赖           |
| JavaScript API 项目 | 无后端编译步骤，可直接 start             | `src/`、生产依赖和项目运行资源                 |
| JavaScript + 前端   | 刷新路由清单并构建前端，后端仍从源码运行 | `src/`、前端产物、构建身份及生产依赖           |

以下流程针对 TypeScript 项目。先停止该项目的 `vext dev`，避免项目写入者冲突，再执行：

```bash
npx vextjs build --typecheck
npx vextjs start --port 3000
```

`--typecheck` 要求项目已安装 TypeScript，并有可用的 `tsconfig.json`。不传此项时 esbuild 负责转译，不能据此认定 TypeScript 类型检查通过。

若使用 [CLI 页的 API 脚手架](/zh/guide/cli#从创建到生产启动)，在另一个终端运行：

```bash
curl -i http://127.0.0.1:3000/
curl -i http://127.0.0.1:3000/health
```

两次请求应返回 HTTP 200；第一条返回问候信息，第二条 JSON 中 `data.status` 为 `"ok"`。自己的项目应请求已定义的路由并检查业务结果。验证后用 Ctrl+C 停止服务。这里显式指定端口；脚手架的生产配置默认端口为 3001。

### 输出目录与配置 profile

输出目录按显式 `--outdir` → `VEXT_BUILD_OUTDIR` → 上次成功构建记录 → `dist` 选择。以下显式用法适合检查独立输出：

```bash
npx vextjs build --typecheck --outdir dist
npx vextjs start --outdir dist --port 3000
```

自定义 profile 需先提供对应的 `src/config/<name>.ts` 等配置文件，再构建和启动：

```bash
npx vextjs build --config sg-sit
npx vextjs start --config sg-sit
```

构建时 profile 优先级为 `--config` → `VEXT_CONFIG` → 非标准 `NODE_ENV` 的兼容回退 → `production`。启动未显式选择 profile 时会优先沿用构建记录，再回退到 production；详见[配置](/zh/guide/configuration)。

后端编译会把用户源码中的 `process.env.NODE_ENV` 静态替换为 `"production"`。配置 profile 与这个编译常量用途不同，不应依赖编译后源码的 NODE_ENV 分支切换 sit/uat/prod。

## 构建前置产物刷新

TypeScript 项目执行 `vext build` 时，会先刷新开发工具链需要的 generated 与 manifest 产物，再进入可选类型检查和 esbuild 编译：

1. `vext typegen` 基础刷新：写入 `.vext/types/*.generated.d.ts`、`src/types/generated/index.d.ts` 与 `.vext/manifest/services.json`
2. `doctor routes --refresh --write-manifest`：重新扫描路由并写入 `.vext/manifest/routes.json`
3. 如果传入 `--typecheck`，此时再执行 `tsc --noEmit`
4. 由 esbuild 将服务端运行时代码输出到所选目录（默认 `dist/`）
5. 如果 `config.frontend.enabled` 为 true，继续构建前端（默认输出目录为后端输出下的 `client/`）

这保证新脚手架或刚清理过 `.vext/` 的项目，也能在 `vext build --typecheck` 中先拿到最新 generated 类型，再进入 TypeScript 校验。

## 编译策略

### 逐文件编译（File-by-File Transform）

后端保留每个源码模块对应的独立 CommonJS `.js` 产物及目录结构，供运行时加载器发现 routes、services、plugins、middlewares 和 models。以下是路径映射示意，不要求项目创建全部目录：

```text
src/                            dist/
├── config/                     ├── config/
│   ├── default.ts       →       │   ├── default.js
│   └── production.ts    →       │   └── production.js
├── routes/users.ts      →       ├── routes/users.js
├── services/user.ts     →       ├── services/user.js
├── plugins/redis.ts     →       ├── plugins/redis.js
├── middlewares/auth.ts  →       ├── middlewares/auth.js
└── models/user.ts       →       └── models/user.js
```

默认还会生成对应 `.js.map`、输出目录的 `package.json`（声明 CommonJS）和构建身份文件。业务 JSON 保留相对路径；项目 preload 走单独的 ESM 构建流程。

启用前端后，配置解析得到的前端角色目录和文件由浏览器/SSR 构建处理，从后端扫描中排除。未启用前端时，不能仅凭目录名叫 `frontend` 或 `client` 就认定它会被排除。

### 为什么不 Bundle？

这里的“逐文件”描述**最终模块边界**。实现使用 esbuild `bundle: true` 解析和改写本地引用，但把本地模块及 npm 包标记为 external，避免把业务模块合并成一个后端 bundle。

这样可保留加载器需要的目录和模块身份，并与开发期模块替换配合。普通 bundle 同样可以生成准确的 Source Map，也不必然需要自定义 runtime；两者的区别不能用“bundle 无法调试或热更新”概括。

### 输出格式

| 选项     | 值       | 说明                                                                  |
| -------- | -------- | --------------------------------------------------------------------- |
| Format   | `cjs`    | 后端模块输出为 CommonJS；项目 preload 另输出 ESM `.mjs`               |
| Target   | `node20` | 编译目标；运行环境仍需满足包的 Node.js `^20.19.0 \|\| >=22.12.0` 要求 |
| Platform | `node`   | Node.js 后端                                                          |
| Charset  | `utf8`   | 保留 UTF-8 字符                                                       |

### 优化选项

| 选项         | 后端 CLI 默认值 | 说明                                                             |
| ------------ | --------------- | ---------------------------------------------------------------- |
| Source Map   | `external`      | 生成独立 map；运行时自动映射的限制见下文                         |
| Tree Shaking | 开启            | 消除可判定的死代码；独立模块的导出不会因其他文件未引用就全部移除 |
| Keep Names   | 开启            | 尽量保留函数/类名称                                              |
| Minify       | 开启            | 本地诊断可用 `--no-minify` 或 `VEXT_BUILD_MINIFY=false`          |
| packages     | `external`      | npm 依赖不打包，部署环境仍需安装生产依赖                         |

前端使用独立配置：生产期浏览器 `frontend.build.client.minify` 默认 true、`sourcemap` 默认 false；SSR renderer 的 `frontend.build.server.minify` 默认 false。浏览器输出为 ESM bundle，与此处后端 CJS 表分开理解。

### 自动注入

后端编译器使用以下定义：

```typescript
define: {
  'process.env.NODE_ENV': '"production"'
}
```

因此用户源码中的相关分支可能在编译时被折叠。这不等于运行时只能加载 production profile；例如 `npx vextjs start --config sg-sit` 会按所选输出目录加载 `config/sg-sit.js`。外部 npm 依赖没有被这个后端编译步骤重新打包，不能把静态替换承诺扩展到所有依赖代码。

项目可按需增加启动脚本：

```json
{
  "scripts": {
    "start": "vext start",
    "start:sg-sit": "vext start --config sg-sit"
  }
}
```

## 编译选项

### CLI 参数

`vext build` 不支持位置参数。`--outdir`、`--config` 等取值参数必须紧跟非 option 值，例如 `--outdir dist`；`--outdir --minify` 或 `--config --clean` 会作为缺值错误失败。

| 参数               | 说明                                                      | 默认值           |
| ------------------ | --------------------------------------------------------- | ---------------- |
| `--outdir <path>`  | 显式指定输出目录                                          | 按上文优先级选择 |
| `--config <name>`  | 选择 build-time 配置 profile                              | `production`     |
| `--clean`          | 成功编译后按归属清单清理旧产物                            | `false`          |
| `--sourcemap`      | 生成 source map                                           | `true`           |
| `--no-sourcemap`   | 禁用 source map                                           | —                |
| `--minify`         | 压缩输出代码（默认开启；保留兼容选项）                    | `true`           |
| `--no-minify`      | 关闭输出压缩                                              | —                |
| `--typecheck`      | 刷新 generated / manifest 后执行 `tsc --noEmit`           | `false`          |
| `--upload-assets`  | 前端构建完成后上传静态资源                                | `false`          |
| `--deploy-dry-run` | 与 `--upload-assets` 合用，只模拟上传；本地构建仍写入产物 | `false`          |
| `-h, --help`       | 查看构建命令帮助                                          | —                |

生产 CLI 构建默认压缩后端输出。需要本地阅读构建结果时使用 `--no-minify`；若必须由环境提供该开关，可设置 `VEXT_BUILD_MINIFY=false`。前端生产压缩由 `frontend.build.client.minify` 控制，未单独设置时才回退到 `frontend.build.minify`。后端 Source Map 也可通过 `VEXT_BUILD_SOURCEMAP=false` 关闭，显式 CLI 开关优先。

重复构建在候选编译成功后，依据 `.vext/freshness/v1/artifacts.json` 回收已删除或重命名源码对应的旧产物。后端 JavaScript、source map、项目 preload 和业务 JSON 一起提交；编译失败保留上一批有效文件。`--clean` 同样遵循归属清单，不会提前递归清空输出目录，也不会删除未登记的文件。

嵌套 JSON 数据（例如 `src/locales/account/security/zh-CN.json`）保留目录和原始字节，支持后端模块导入。前端角色目录、测试文件以及作为编译元数据的 `package.json` / `tsconfig*.json` 不按业务 JSON 复制。

输出被手工修改，或旧版本留下的文件无法证明归属时，命令返回 `VEXT_OUTPUT_CONFLICT` 并指出路径。先保留、移动或核实这些文件再重试，亦可选择新的 `--outdir`；不要通过删除整个项目目录处理冲突。与本次候选字节完全一致的已有文件可以直接认领且不重写。

归属和构建记录在读取过程中发生增长、替换或删除时，会报告状态无法核验；不能把它当作缺失记录继续构建。先等待修改结束，再按诊断重新检查或恢复。单个文件的读取校验不代表整个目录树具有同时发生的原子快照。

进程登记中断后，下一次登记会在互斥保护下分批回收仍可核验的临时记录。部分写入、外部改写或旧格式的文件会保留，并在诊断中给出路径；请根据该路径检查，不要清空整个登记目录。临时记录不会自动取代当前有效记录。

同一服务根及其嵌套根同一时间只有一个写入者；`dev` 运行时竞争执行 `build` 或 `typegen` 会返回 `VEXT_OWNER_BUSY`。不同的独立服务可以同时开发。事务记录用于进程中断恢复；逐文件替换不等于操作系统支持多文件同时原子可见，运行流程必须等待构建成功。

配置准备完成后，输出内 `.vext-build.json` 先登记 `building`。全部产物阶段及可选上传成功，才将它与 `.vext/build-location.json` 一起提交为 `ready`；失败代标记为 `failed`，同目录启动随即被阻止。启动不消费未恢复的事务或被外部修改的已登记身份。各类产物分别保留其事务边界，后端已提交而前端或远程上传失败，不表示整个构建的所有文件及远端资源都被回滚。构建身份和可迁移部署清单详见 [CLI 构建说明](./cli.md)。

## 前端构建

前端先生成本次构建的候选源码与资源，浏览器编译、SSR、媒体、静态页面、SEO 和预算全部成功后，再一起提交 `.vext/generated/frontend/` 与配置的 `frontend.outDir`。任一步失败保留上一代产物；开发期失败重建继续提供上一代有效静态资源，修复后再次重建。相同候选不重写，旧资源仅按归属清单回收，未登记文件不自动公开或上传。

JSCSS 保留原生 ESM 和顶层 `await`，在独立构建线程求值；模块目录保持最终逻辑位置，支持相对导入。线程结束后回收临时模块和模块缓存；构建线程不共享父进程全局对象。临时文件的异常遗留依据收据和内容摘要恢复，外部修改仍作为冲突保留。

当 `config.frontend.enabled` 为 true 时，浏览器流水线使用 esbuild bundle 模式。以下使用默认目录；`--outdir` 会影响默认 client 位置，显式 `frontend.outDir` 及 client/server 子配置会改变实际路径：

```text
.vext/generated/frontend/browser-entry.tsx → dist/client/assets/browser-entry-<hash>.js
.vext/generated/frontend/vendor-entry.tsx  → dist/client/assets/vext-vendor-<hash>.js（启用时）
src/frontend/pages/** 的动态 import         → dist/client/assets/<page-or-layout-chunk>-<hash>.js
src/frontend/pages/_document.html           → dist/client/index.html
src/frontend/styles/index.css                → dist/client/assets/browser-entry-<hash>.css
public/**                                    → dist/client/**
.vext/manifest/routes.json                  → client-contract.json + route-contract.json + api.generated.ts（apiClient 启用时）
.vext/generated/frontend/server-renderer.ts → dist/client/server/renderer.cjs
```

前端构建会写入：

| 文件                                 | 说明                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `dist/client/index.html`             | `vext start` 服务的 HTML 入口                                                  |
| `dist/client/assets/*`               | 打包后的 JavaScript、CSS 与导入资产                                            |
| `dist/client/manifest.json`          | 前端资源 manifest                                                              |
| `dist/client/deploy-manifest.json`   | 可上传静态资源 manifest，含 sha256、SRI、content type、upload key              |
| `dist/client/render-manifest.json`   | SSR 页面、layout、错误页与 renderer manifest                                   |
| `dist/client/messages-manifest.json` | 前端 i18n messages manifest；i18n 关闭时可不含 locale entries                  |
| `dist/client/media-manifest.json`    | 本地图片/字体 artifact manifest                                                |
| `dist/client/static-manifest.json`   | static 与 freshness artifact manifest                                          |
| `dist/client/server/renderer.cjs`    | SSR renderer bundle                                                            |
| `dist/client/size-report.json`       | 前端资源体积摘要；`build.diagnostics.sizeReport` 开启时写入（默认开启）        |
| `dist/client/client-contract.json`   | 基于 route manifest 生成的路由契约；`apiClient.enabled` 开启时写入（默认开启） |
| `dist/client/route-contract.json`    | route response-schema 契约；`apiClient.enabled` 开启时写入（默认开启）         |
| `dist/client/api.generated.ts`       | 轻量 typed API client module；`apiClient.enabled` 开启时写入（默认开启）       |

`size-report.json` 顶层的 `initialJs*` 表示所有页面中最大的完整首载闭包，包含 browser entry 继续 import 的共享 chunk。其他路由和错误页的延迟 chunk 会在浏览器实际请求时才加载，因此不计入首载。逐路由的精确闭包请查看 `routes[]`；因此默认预算不会再被单个 entry 文件大小低估。

启用前端但配置的前端输出目录缺少 `index.html` 时，`vext start` 会 fail fast。生产启动前请先执行 `vext build`。

浏览器端页面、layout、错误页和 locale 会通过动态 import 形成页面级 chunk；React 等公共依赖默认通过 Vext-managed vendor entry 配合 esbuild splitting 形成共享 chunk。`frontend.build.client.external` 可把模块排除出 browser bundle，但必须用 `frontend.build.client.externalRuntime` 给浏览器提供 import map URL，否则浏览器无法加载该外置模块。

`frontend.deploy.integrity=true` 时，Vext 会把构建期计算出的 SRI 写入生成 HTML 的 JS/CSS 标签。`deploy-manifest.json` 同时覆盖 esbuild 输出资源和 `public/**` 复制资源，可用于 `vext deploy assets` 的真实上传与增量发布；默认不包含服务端渲染的 `index.html` 和 source map。

## 文件扫描规则

### 包含的文件

`vext build` 扫描 `src/` 目录下所有匹配以下模式的文件：

```
**/*.{ts,mts,cts,js,mjs,cjs}
```

此规则用于 TypeScript 项目的后端构建。普通业务 `.json` 另行扫描、校验并复制；不是把所有静态文件自动复制到输出目录。

### 排除的文件

编译自动排除以下文件（两层排除规则）：

#### 通用排除（与开发模式共享）

| 模式                                    | 说明                                                   |
| --------------------------------------- | ------------------------------------------------------ |
| `**/*.d.ts`、`**/*.d.mts`、`**/*.d.cts` | 类型声明                                               |
| `**/*.test.*`、`**/*.spec.*`            | 测试文件                                               |
| `**/__tests__/**`                       | 测试目录                                               |
| `**/*.__vext_compiled__*`               | 工具生成的临时模块                                     |
| 已启用前端的角色目录/文件               | 按解析后的项目布局排除，而非无条件排除所有 client 目录 |

#### 生产编译额外排除

| 模式                                                 | 说明                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `**/config/development.{ts,js,mts,mjs,cts,cjs,json}` | development 配置不进入生产后端输出                                       |
| `**/config/local.{ts,js,mts,mjs,cts,cjs,json}`       | local 覆盖不进入生产后端输出                                             |
| `**/config/test.{ts,js,mts,mjs,cts,cjs,json}`        | test 配置不进入生产后端输出                                              |
| `preload/**`                                         | 不走普通 CJS 编译；顶层支持的项目 preload 文件单独构建为 `preload/*.mjs` |

以上配置文件排除不等于扫描并清除所有敏感内容，也不能用来部署被排除的 profile。部署清单需覆盖业务自己读取的模板、文件或其他运行资源；框架不会从任意 `fs.readFile` 表达式推断复制需求。preload 规则见 [Preload](/zh/guide/preload)。

## Source Map

### 外部 Source Map

后端生产构建默认生成与 `.js` 相邻的 `.js.map`：

```text
dist/
└── services/
    ├── user.js
    └── user.js.map
```

当前实现使用 esbuild 的 `external` 模式：**生成 map，但不在 JS 末尾添加 `sourceMappingURL` 注释**。这与包含链接注释的 `linked` 模式不同，见 [esbuild Source Map 说明](https://esbuild.github.io/api/#sourcemap)。

### 启用 Source Map 支持

[Node 的 `--enable-source-maps`](https://nodejs.org/api/cli.html#--enable-source-maps) 用于启用堆栈映射，但前提是运行时能够发现对应 map。**对当前 Vext 后端生产产物，仅添加这个参数不能保证自动显示 TypeScript 行号。** 应结合调试器或 APM 的显式 map 加载/上传功能，并按部署产物验证。

以下仅演示 Node 参数传递方式，不代表 Vext 已自动关联外部 map：

```bash
# Bash / 类 Unix shell
NODE_OPTIONS=--enable-source-maps npx vextjs start
```

```powershell
# PowerShell；验证后按需移除本次设置
$env:NODE_OPTIONS = "--enable-source-maps"
npx vextjs start
Remove-Item Env:NODE_OPTIONS
```

`vext start --enable-source-maps` 不是合法 Vext 参数。不要直接修改框架已登记的生产 JS 来追加注释，这会改变归属清单中的文件摘要。需要可读产物辅助定位时，可重新执行 `npx vextjs build --no-minify`。

### Source Map 用途

| 场景         | 使用条件                                        |
| ------------ | ----------------------------------------------- |
| 错误堆栈定位 | map 与当前 JS 同一构建，且运行时/工具已正确关联 |
| APM 分析     | 按所用平台规则上传和关联版本，框架不自动配置    |
| 本地调试     | 使用支持外部 map 的调试器并验证实际断点位置     |

后端 map 不会因生成而自动成为前端静态资源，但反向代理或自建静态服务可能暴露文件。map 可能包含源码，部署时应明确其访问范围。

## 与 DevCompiler 的对比

`vext build` 和 `vext dev` 共享相同的 esbuild 基础配置（`createBaseEsbuildConfig()`），保持基础模块语义一致；开发重建与生产交付仍有以下区别：

| 特性              | `vext dev`（DevCompiler）                | `vext build`（BuildCompiler）          |
| ----------------- | ---------------------------------------- | -------------------------------------- |
| **输出目录**      | `.vext/dev/`（临时，gitignore）          | `dist/`（持久，可部署）                |
| **编译模式**      | 增量编译 + 单文件编译                    | 全量编译（每次全量）                   |
| **Source Map**    | 全量编译为 linked；单文件编译为 external | external（独立 `.js.map`，无链接注释） |
| **热重载**        | 支持（Tier 1/2/3）                       | 不支持（一次性编译）                   |
| **额外排除**      | 无                                       | config/development, local, test        |
| **NODE_ENV 注入** | 无                                       | `"production"`                         |
| **MetaFile**      | 无                                       | 有（编译统计）                         |

耗时取决于项目规模、机器、缓存和前端流水线，不能将示例耗时当作保证。这里的开发编译器比较针对 TypeScript 后端。

### 共享配置

两者共享的 esbuild 配置包括：

- `platform: 'node'` — Node.js 运行时
- `target: 'node20'` — 最低支持 Node.js 20.19.0
- `format: 'cjs'` — CommonJS 输出
- 每个后端源文件保留独立 CJS `.js` 产物；通过 esbuild 解析本地引用并标记为 external，避免合并模块而改变热重载身份
- `.ts/.js/.mts/.cts/.mjs/.cjs` 的静态本地引用、字面量 `import()` 和 `require.resolve()` 映射到实际 `.js` 产物；tsconfig 的 JSONC、extends、paths 在全量与增量编译中使用相同解析
- 后端引用被排除的前端文件、根外源码或没有独立产物的文件会报告错误；目录扫描支持不等于任意运行时动态表达式可转换
- `treeShaking: true` — 死代码消除
- `keepNames: true` — 保留函数名
- `charset: 'utf8'` — UTF-8 编码
- `loader` — `.ts`/`.js`/`.json` 等文件类型映射

## 编译结果

成功时会打印后端统计及最终完成标记。以下是 API 脚手架一次构建的输出节选；文件数、耗时和路径以实际项目为准：

```text
[vextjs] backend compiled
[vextjs]    files:   5
[vextjs]    time:    134ms
[vextjs]    output:  <project>/dist/
[vextjs] ✅ build complete
```

启用前端时，后端成功日志后还有前端及可选上传阶段。只有整个命令成功退出，才可以进入部署；不能只看到 `backend compiled` 就认为全部完成。

### BuildResult 结构

下表是内部后端编译器的结果，便于理解日志和实现，**不是从 `vextjs` 包根导出的公共调用 API**，也不是前端上传结果。

| 字段                  | 类型                    | 说明                                                     |
| --------------------- | ----------------------- | -------------------------------------------------------- |
| `success`             | `boolean`               | 此次后端编译是否成功                                     |
| `fileCount`           | `number`                | 后端 JS、复制的业务 JSON 与项目 preload 的计数，不含 map |
| `totalFiles`          | `number`                | 后端源码、业务 JSON 与项目 preload 输入计数              |
| `elapsed`             | `number`                | 后端编译耗时（毫秒）                                     |
| `outDir`              | `string`                | 输出目录                                                 |
| `warnings` / `errors` | `Message[]`             | esbuild 诊断                                             |
| `metafile`            | `Metafile \| undefined` | 后端编译元信息，失败等情况下可缺失                       |

## 运行编译产物

```bash
npx vextjs start
# 显式选择已完成构建的输出目录
npx vextjs start --outdir dist
```

TypeScript 项目缺少有效产物、构建失败或身份不一致时会拒绝启动。开发期源码启动使用 `vext dev`；纯 JavaScript 后端则在生产期继续从源码加载。

启用前端时会检查前端输出的 `index.html`，并按公共资源清单提供静态文件。页面渲染依赖路由中的 `res.render()` 等配置；**未配置 spaFallback 时，其默认 scopes 为空，不会自动把全部非 API 请求变为 SPA 首页**。显式开启 `spaFallback: true` 或配置 scopes 才会建立对应回退范围，见 [CSR 与 SPA fallback](/zh/frontend/csr-and-spa-fallback)。

通用脚手架没有固定的 `dist/index.js` 启动入口。使用 `vext start` 启动，不要仅根据目录映射图推断一个可直接执行的入口。

### VEXT_BUILT 标记

启动 compiled 后端时，CLI 设置 `VEXT_BUILT=1` 并传递实际构建目录，routes、services、plugins、middlewares 和 models 等由所选输出目录加载；显式配置路径仍需符合各模块的解析规则。纯 JavaScript source 模式继续保留并使用 `src/`。

这些标记由 CLI 管理，无需手工伪造。仅设置 `VEXT_BUILT=1` 不能替代构建成功与身份校验。

## 部署清单

已有项目和 lockfile 时，在构建环境执行：

```bash
npm ci
npx vextjs build --typecheck --outdir dist
```

构建成功后，将产物交给运行环境：

| 内容                        | 用途                                                                    |
| --------------------------- | ----------------------------------------------------------------------- |
| `package.json`、lockfile    | 安装生产依赖；`vextjs` 及运行时导入的包必须在 dependencies              |
| 完整 `dist/`                | 后端产物、`dist/package.json`、`.vext-build.json`、默认前端 client 产物 |
| 自定义前端输出目录          | 若配置在 dist 之外，需一并部署                                          |
| `.vext/build-location.json` | 使用构建位置记录发现输出时保留；显式 `start --outdir dist` 可直接指定   |
| 项目额外运行资源            | 业务自行读取的文件、宿主 preload 等按实际路径部署                       |
| `src/`                      | JavaScript source 模式需要；compiled 后端通常不需要                     |

在运行环境中执行 `npm ci --omit=dev`，然后 `npx vextjs start --outdir dist`。先请求健康接口与关键业务路由，再接入流量。构建所需 TypeScript 不应在构建前被移除；也不必为每一次原地构建重新安装全部依赖。

### Docker 多阶段构建

以下模板限定为 **TypeScript API 项目**：无额外运行资源，`package.json` 的 start 为 `vext start`，配置和源码均在 src。前端项目还需复制 public 等构建输入；继承其他 tsconfig 或依赖工作区包的项目也需补齐相应文件。

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src/ src/
COPY tsconfig.json ./
RUN npx vextjs build --typecheck --outdir dist

FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
CMD ["npm", "start", "--", "--outdir", "dist"]
```

此处运行阶段显式选择 dist，并保留其内部身份文件；不是只复制几份 JS。基础镜像、启动端口和挂载资源按部署环境选择，完整发布操作见[部署](/zh/guide/deployment)。

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

确认命令所在项目根、源码目录、语言识别和排除规则；TypeScript 后端需有实际可编译输入。类型检查失败应先处理具体诊断，不能以关闭 `--typecheck` 当作类型问题已修复。

### 运行时找不到模块

```
Error: Cannot find module './routes/users.js'
```

先区分模块类型：

1. 裸包名（例如 `redis`）缺失：检查 package.json 的生产依赖和运行环境安装情况。
2. 相对模块路径缺失：检查文件是否被排除、部署是否完整、引用是否指向真实输出路径。
3. 业务运行时动态拼接路径或读取额外文件：检查运行目录和额外资源，构建器不会推断任意表达式。
4. 引用了 `.d.ts` 等纯声明文件：改为正确的运行时模块，而不是复制类型声明充当实现。

不要把所有缺失模块问题都归结为“构建后忘了重新安装依赖”。

### Source Map 不生效

先检查是否生成 map、JS 是否有可发现的链接、map 是否匹配当前部署。当前后端生产构建为 external 模式，仅设置 `NODE_OPTIONS=--enable-source-maps` 不足以自动关联；具体限制和参数写法见本页 [Source Map](#source-map)。

### 构建成功但启动失败

检查 start 实际选择的输出目录、profile、构建身份及前端目录。切换机器时必须携带完整产物；构建阶段失败、未恢复的事务、外部修改造成的摘要冲突，都不能通过手改 ready 标志解决。根据错误路径修复输入或重新构建，详见 [CLI](/zh/guide/cli)。

## 下一步

- 了解 [部署与生产环境](/zh/guide/deployment) 的完整部署指南
- 查看 [热重载](/zh/guide/hot-reload) 了解开发模式的编译策略
- 学习 [CLI 命令](/zh/guide/cli) 中 `vext build` 的完整参数
- 探索 [Cluster 多进程](/zh/guide/cluster) 充分利用多核 CPU
