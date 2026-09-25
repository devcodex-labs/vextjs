# CLI 命令

:::tip 稳定版本
本站记录稳定发布的 `v2.0.0`；通用安装命令不固定精确版本。
:::

VextJS 的 `vext` 命令覆盖创建、开发、构建、生产启动与运维。本页先给出一条可验证的使用流程，再按命令查阅选项；Job、MCP 等扩展入口放在基本生命周期之后。

前置条件：Node.js 满足当前包的 `^20.19.0 || >=22.12.0`，已安装 npm，除 create 从目标父目录执行外，其余命令在应用 package.json 所在目录执行；只有声明了 `--root` 的子命令支持该选项。版本可用 `npx vextjs --version` 查看；示例输出仅说明格式，不要求安装固定版本。

## 安装

`vext` CLI 随 `vextjs` 包一起安装，无需额外安装：

```bash
npm install vextjs
```

带 `NAME=value command` 的示例使用 Bash 语法；PowerShell 先设置 `$env:NAME = "value"` 再运行命令，用完恢复原环境值。

安装后可以通过以下方式调用。下文的 `vext ...` 是 package scripts 内的写法；普通终端可写 `npx vextjs ...`，无需全局安装。`npm run` 传递额外参数时使用 `--`，例如 `npm run dev -- --port 8080`：

```bash
# 通过 npx
npx vextjs <command>

# 通过 package.json scripts（推荐）
npm run dev    # → vext dev
npm start      # → vext start
npm run build  # → vext build
```

## 命令概览

| 命令                          | 作用                               | 是否启动长期进程或写文件              |
| ----------------------------- | ---------------------------------- | ------------------------------------- |
| `vext create <name>`          | 创建项目                           | 写项目文件，默认安装依赖              |
| `vext dev`                    | 开发与重载                         | 启动服务并生成开发产物                |
| `vext build`                  | 构建生产产物                       | 写声明、清单及构建结果                |
| `vext start`                  | 生产启动                           | 启动应用或 Cluster                    |
| `vext stop`                   | 停止 Cluster                       | 向 PID 对应进程发信号                 |
| `vext reload`                 | 请求 Cluster 滚动替换              | 发信号；Windows 不支持                |
| `vext status`                 | 查询 Cluster PID 与健康端点        | 读取 PID、请求 HTTP                   |
| `vext typegen`                | 生成类型与依赖诊断（experimental） | 默认写产物；`--check` 只读            |
| `vext doctor routes / all`    | 静态诊断（experimental）           | 默认只读；写入选项需显式选择          |
| `vext deploy assets`          | 上传前端静态资源                   | 默认执行上传；`--dry-run` 只输出计划  |
| `vext job ...`                | 查看或运行后台任务                 | 随子命令查看、入队、执行或常驻        |
| `vext mcp` / `sync` / `skill` | MCP 服务、宿主同步与 Skill 导出    | stdio 常驻；sync/skill write 可写文件 |

## 从创建到生产启动

选择尚不存在的目录，以下以 TypeScript API-only 项目为例，便于先验证 CLI 生命周期：

```bash
npx vextjs create my-api --template api --frontend none
cd my-api
npm run dev
```

创建成功时依赖已经安装；若使用 `--skip-install` 或安装失败，先在生成目录执行 `npm install`。另开终端请求（PowerShell 使用 `curl.exe`）：

```bash
curl -i http://127.0.0.1:3000/
curl -i http://127.0.0.1:3000/health
```

预期均为 200；首页返回问候信息，健康检查的 `data.status` 为 `"ok"`。用 Ctrl+C 停止 dev，等待端口释放，再执行：

```bash
npm run build
npm start -- --port 3000
```

构建应通过类型检查并生成有效产物，随后重复两个请求验证生产启动。这里显式保持 3000 便于复验；当前脚手架的 production 配置默认使用 3001。结束后用 Ctrl+C 停止单进程服务。CLI 退出码为 0 只证明该命令完成到它声明的阶段，服务可用性仍需实际请求确认。

默认全栈模板的首页为 React 服务端渲染页面，API 改为 `/api/hello` 与 `/api/health`，具体流程见[快速开始](/zh/guide/quick-start)。后续各命令示例是独立用法，不要逐行启动多个服务。

## `vext create` — 创建项目

根据项目名和选项生成项目骨架与配置文件；目标目录非空且未加 `--force` 时才询问是否替换。默认模板是 `fullstack-react`；API-only 脚手架仍可通过 `--template api --frontend none` 创建。全栈 starter 默认展示可直接修改的服务端渲染 Vext launchpad，并在首页同时提供官方 Vext Guide 与本地 API 文档入口 `/docs`。其默认配置会启用 OpenAPI，因此该本地入口在 `vext dev` 与生产 `vext start` 后均可访问；API-only 项目仍保持显式启用。

### 用法

```bash
npx vextjs create <project-name> [options]
```

### 选项

| 选项                | 说明                                                    | 默认值                                        |
| ------------------- | ------------------------------------------------------- | --------------------------------------------- |
| `--template <name>` | 项目模板（`fullstack-react` / `api`）                   | `fullstack-react`                             |
| `--frontend <name>` | 前端目标（`react` / `none`）                            | 随模板：fullstack-react 为 react，api 为 none |
| `--adapter <name>`  | 指定 Adapter（native / hono / fastify / express / koa） | `native`                                      |
| `--js`              | 创建 JavaScript 项目（而非 TypeScript）                 | `false`                                       |
| `--skip-install`    | 跳过 `npm install`                                      | `false`                                       |
| `--force`           | 跳过确认，先删除非空目标目录再重新创建                  | `false`                                       |
| `-h, --help`        | 显示帮助                                                | —                                             |

### 示例

```bash
# 创建 TypeScript 全栈项目（默认 Native Adapter）
npx vextjs create my-app

# 指定 Adapter
npx vextjs create my-app --adapter hono
npx vextjs create my-app --adapter fastify

# 创建 JavaScript 全栈项目
npx vextjs create my-app --js

# 创建 API-only 项目
npx vextjs create my-api --template api --frontend none

# 跳过依赖安装
npx vextjs create my-app --skip-install
```

项目名必须以字母、数字或下划线开头，只能包含字母、数字、下划线、连字符和点，不接受路径分隔符；先进入目标父目录再创建。上述创建示例互为选择。`--template api` 与 `--frontend react`、`fullstack-react` 与 `none` 的组合会拒绝。

命令只接受一个项目名；多余的位置参数会在创建目标目录前直接失败。自动安装依赖失败时，`create` 以非零状态退出但保留已生成文件，可执行 `cd <project-name>` 后重新运行 `npm install`。生成的 TypeScript 全栈项目会为内置的 `@frontend`、`@pages`、`@components`、`@styles` 和 `@assets` 提供兼容 NodeNext 的路径映射。

### 生成的目录结构

```
my-app/
├── public/
│   ├── favicon.svg           # 使用同一 V 几何的高对比 favicon 变体
│   └── vext-mark.svg         # starter AppShell 使用的透明 V 标记
├── src/
│   ├── config/
│   │   ├── default.ts        # 共享配置（port: 3000）
│   │   ├── development.ts    # 开发环境 profile
│   │   ├── production.ts     # 生产环境 profile
│   │   ├── local.ts          # 空本地覆盖；被 Git 忽略
│   │   └── bootstrap.ts      # 可跟踪的启动入口，默认 providers: []
│   ├── frontend/
│   │   ├── components/AppShell.tsx # 公共 React shell
│   │   ├── locales/en-US.ts  # starter 文案
│   │   ├── pages/            # React 页面、layout、document 和错误页
│   │   └── styles/index.css  # Vext launchpad 样式
│   ├── routes/index.ts       # URL handler 和服务端数据
│   ├── services/example.ts   # 示例服务
│   └── types/
│       ├── generated/.gitkeep # Vext/typegen 管理的输出根（TypeScript 项目）
│       ├── shared/
│       │   └── greeting.d.ts # 应用维护、供服务端和 UI 共用的数据契约
│       └── frontend/
│           └── home.d.ts     # 应用维护的页面/渲染契约
├── package.json
├── tsconfig.json
└── .gitignore
```

#### 类型目录边界

上面的树对应默认的 **TypeScript 全栈** starter。`src/types/**` 中的三层目录有不同的所有权：

| 位置                     | 所有者      | 用途                                                                                                                      |
| ------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/types/generated/**` | Vext 工具链 | `vext typegen` 刷新的声明输出；不要手动修改生成文件。                                                                     |
| `src/types/shared/**`    | 应用代码    | 服务端与 UI 共用、可序列化的数据契约，例如 `GreetingDto`。                                                                |
| `src/types/frontend/**`  | 应用代码    | 由渲染页面的 route 与 `src/frontend/**` 共同使用的页面/渲染契约，例如 `HomePageProps`；不要把服务端私有实现细节放进这里。 |

在 TypeScript 项目中，`vext typegen` 只会写入 `src/types/generated/**`，不会覆盖应用维护的 `shared/**` 或 `frontend/**` 文件。JavaScript 的 create/dev/typegen 流程不会创建这棵公开 TypeScript 目录；工具声明只保留在 `.vext/types`。

| 脚手架模式                                              | 初始 `src/types/**` 结构                     |
| ------------------------------------------------------- | -------------------------------------------- |
| TypeScript 全栈（默认）                                 | `generated/**`、`shared/**` 与 `frontend/**` |
| TypeScript API-only（`--template api --frontend none`） | 仅 `generated/**`                            |
| JavaScript 脚手架                                       | 创建时不生成 `src/types` 目录                |

脚手架不会预留 `src/types/server/**`。只被单个 route 或 service 使用的类型应放在服务端 owner 附近；形成真实的后端 service 共享边界后，再创建 `src/types/server/services/**`。运行时 enum/constant 应就近放置或进入 `src/constants/services/**`，不能放进 `src/types/**`；详见[项目结构](/zh/guide/project-structure)。

脚手架不会生成根目录或目录级的占位 `README.md` 文件。TypeScript、JavaScript 的全栈与 API-only 模板所生成的用户源码均以英文为默认语言；只有显式 locale 目录下的语言资源不受该约束。`src/middlewares/`、`src/plugins/`、`src/locales/` 与规范的 `src/preload/` 等约定目录仍受支持；添加真实源码时会按需创建。历史项目根 `preload/` 不会由脚手架生成。

默认全栈 starter 的 `public/vext-mark.svg` 是透明导航标记，`public/favicon.svg` 是高对比 favicon 变体；两者使用同一 V 几何。前者由 AppShell 使用，两者都会随 `public/` 静态资源一起复制。

创建完成后：

```bash
cd my-app
npm run dev
```

访问 `http://localhost:3000`，应看到 React 服务端渲染页面及客户端交互。API 路由位于 `/api/hello` 与 `/api/health`。

`vext create` 会直接生成空 `VextConfigOverride` 的 `src/config/local.ts`，以及 `providers: []` 的 `src/config/bootstrap.ts`。默认内容不包含 logger、provider、外部连接或其他业务副作用。`local.ts` 被 `.gitignore` 排除，clone 后可以不存在；`bootstrap.ts` 正常跟踪，后续可通过 `defineBootstrapConfig()` 注册 provider。

## `vext dev` — 开发模式

以开发模式启动项目，支持文件监听和智能热重载。

### 用法

```bash
vext dev [options]
```

`vext dev` 不支持位置参数。`--root`、`--port`、`--host`、`--config`、`--poll-interval`、`--debounce`、`--startup-profile-json`、`--port-conflict` 等取值参数必须跟随非 option 值；数字参数必须是完整整数，`3000x`、`50x` 这类数字前缀会失败。

### 选项

| 选项                         | 说明                                        | 默认值         |
| ---------------------------- | ------------------------------------------- | -------------- |
| `--root <path>`              | 指定项目根目录                              | 当前目录       |
| `--config <name>`            | 选择 development 配置 profile               | `development`  |
| `--port <number>`            | 指定端口                                    | 配置文件中的值 |
| `--host <address>`           | 指定监听地址                                | 配置文件中的值 |
| `--debounce <ms>`            | 防抖间隔（毫秒，0 = 不开启）                | `0`            |
| `--poll`                     | 强制轮询模式（Docker / NFS 环境）           | `false`        |
| `--poll-interval <ms>`       | 轮询间隔（毫秒，仅 `--poll` 时有效）        | `1000`         |
| `--no-hot`                   | 禁用后端 Soft Reload，前端 client 更新独立  | —              |
| `--strict-preflight`         | 让 TypeScript 语义诊断重新阻塞启动 / 重载   | —              |
| `--port-conflict <strategy>` | 端口冲突策略（`error/prompt/kill/next`）    | `error`        |
| `--verbose-lifecycle`        | 输出详细生命周期日志与完整 watcher 变更列表 | —              |
| `--startup-profile`          | 输出启动阶段摘要与详细耗时                  | —              |
| `--startup-profile-json <p>` | 将启动阶段耗时写入 JSON 文件                | —              |
| `--clear`                    | 每次重载后清空控制台                        | —              |
| `-h, --help`                 | 显示帮助                                    | —              |

#### 端口冲突策略

- `error`：直接失败（默认）
- `prompt`：在 TTY 环境下询问父进程如何处理
- `kill`：核对本地监听地址、完整端口和唯一 PID 后尝试终止占用进程；执行前再次检查归属。多个进程、PID 不可见或归属变化时停止并报错，需要重新检查后重试。
- `next`：自动选择下一个可用端口

```bash
vext dev --port-conflict prompt
vext start --port-conflict next
```

在 monorepo 中，从具体服务目录执行命令，或为 `vext dev` 指定 `--root`。start、dev、cluster worker、包级 preload 和 TypeScript 检查都以该服务解析到的依赖为准，支持提升安装与 pnpm 链接；启动入口缺失时需构建或重新安装该版本的框架。Doctor/typegen 的源码结构分析不会因此要求框架启动产物已存在。

项目语言按实际后端运行源码识别。JavaScript 项目可保留用于 `allowJs`/`checkJs` 的 `tsconfig.json`，仍使用 JavaScript 启动流程；实际存在后端 TypeScript 源文件时，即使没有 tsconfig，也需先构建再生产启动。声明、测试、默认 `src/client/` 和单独处理的 preload 不触发后端 TypeScript 判定。配置入口使用 `default.ts`、`default.js`、`default.mjs` 或 `default.cjs`；`default.mts`/`default.cts` 会给出明确的未支持诊断。

#### 启动日志分层

默认 `vext dev` 只打印监听地址与总启动耗时，随后在 cold restart / hot reload 时打印必要结果。`vext dev --startup-profile` 才会输出人类可读的启动摘要与详细事件；摘要按 `main/preflight`、`main/preload`、`pre-worker-bootstrap`、`compile`、`config`、`i18n`、`database`、`plugins`、`middleware`、`services`、`routes`、`openapi`、`listen`、`onReady` 等阶段归类；超过阈值的未命名空窗会以 `gap.*` 形式进入 profile JSON。

`--startup-profile-json <path>` 只写 JSON 文件，不会自动打印摘要或 details；如需两者同时输出，可组合 `--startup-profile --startup-profile-json <path>`。

如需生命周期排障细节，可开启：

```bash
vext dev --verbose-lifecycle
VEXT_VERBOSE_LIFECYCLE=1 vext start
```

### 示例

```bash
# 使用配置文件中的默认设置
vext dev

# 指定端口
vext dev --port 8080

# 指定地址和端口
vext dev --host 127.0.0.1 --port 8080

# 开启 50ms 防抖（快速连续保存时合并为一次重载）
vext dev --debounce 50

# Docker / NFS 环境使用轮询模式
vext dev --poll --poll-interval 2000

# 禁用后端 Soft Reload（前端 client 更新仍独立）
vext dev --no-hot

# 输出启动阶段摘要与详细耗时
vext dev --startup-profile

# 仅写 JSON，不打印 summary/details
vext dev --startup-profile-json .vext/inspect/startup-profile.json
```

### 热重载策略

`vext dev` 根据变更和依赖关系选择处理路径；下表是概览，耗时与可否保留状态取决于实际变更，不能保证固定毫秒数：

| 路径             | 常见变更                                                        | 行为                                                                  |
| ---------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| 后端 Soft Reload | routes、services、middlewares、models 或其他后端源码            | 编译候选，按依赖更新服务/模型与请求处理器；失败可能保留旧代或转冷重启 |
| 语言字典更新     | 后端 locales 文件                                               | 加载并校验字典后替换应用翻译运行时                                    |
| Cold Restart     | config、plugins、preload、package/lockfile、tsconfig 等启动输入 | 重启 worker，端口/连接会经历重建                                      |
| 前端更新         | frontend 源码、public 资源                                      | 前端重建；合适的 React 模块可 Fast Refresh，其他变化可能刷新页面      |

`--no-hot` 将后端软重载改为冷重启，纯前端 client 变更仍走前端更新；已退出的 worker 需要重新启动。详见 [热重载](/zh/guide/hot-reload) 章节。

自定义目录、依赖扩散、`--no-hot` 和配置中的 cold/ignore 模式会改变分类结果；以终端实际重载结果为准。前端页面更新不等于服务端请求数据也已刷新，详见[前端开发流程](/zh/frontend/dev-workflow)。

### package.json 脚本

```json
{
  "scripts": {
    "dev": "vext dev"
  }
}
```

## `vext build` — 构建项目

将 TypeScript 源码编译为 JavaScript，默认生成 `dist/`；构建前会刷新 typegen 与 route manifest。build、start 和产物检查按 `--outdir` → `VEXT_BUILD_OUTDIR` → `.vext/build-location.json` → `dist` 选择目录，`build --clean` 清理同一个目标。前端未显式配置 `frontend.outDir` 时输出到该目录的 `client/`。

完成项目识别和配置求值后，构建登记 `building` 身份。后端、前端及可选上传全部成功，才通过同一事务提交 `.vext/build-location.json` 和输出内 `.vext-build.json` 的 `ready` 状态，并输出最终成功提示；两者的 buildId、profile、backend 和目录必须一致。产物阶段失败时只将当前代标为 `failed`，不推进成功位置。同目录失败或中断会阻止启动；不同输出目录失败不会使上一份成功目录失效。准备阶段失败尚未开始产物构建，不改动上一份身份。

启动遇到未完成事务或已登记身份被外部改写时会失败。下一次构建先验证并恢复中断事务；较旧或失败代不能自行标记成功，必须重新构建。已登记的位置记录被删除时不会退回 `dist` 启动或构建，需明确选择目标目录。位置记录缺失或损坏时可显式选择 `vext build --outdir <目录>`，但该选项不会绕过已登记文件的归属冲突；先核实冲突文件，或选择新的输出目录。旧版无记录 `dist/` 保留结构检查，没有构建身份保证。构建身份校验不代表逐个校验所有业务产物内容。

### 用法

```bash
vext build [options]
```

### 选项

| 选项               | 说明                                            | 默认值                            |
| ------------------ | ----------------------------------------------- | --------------------------------- |
| `--outdir <path>`  | 输出目录                                        | 环境变量、成功记录，最后回退 dist |
| `--config <name>`  | 加载 `src/config/<name>` 作为构建期配置         | `production`                      |
| `--clean`          | 候选编译成功后清理归属清单中的陈旧产物          | `false`                           |
| `--sourcemap`      | 生成 source map                                 | `true`                            |
| `--no-sourcemap`   | 禁用 source map                                 | —                                 |
| `--minify`         | 压缩输出代码（默认开启；保留兼容选项）          | `true`                            |
| `--no-minify`      | 关闭输出压缩                                    | —                                 |
| `--typecheck`      | 刷新 generated / manifest 后执行 `tsc --noEmit` | `false`                           |
| `--upload-assets`  | 前端构建完成后执行静态资源上传                  | `false`                           |
| `--deploy-dry-run` | 只输出前端上传计划，不写入目标                  | `false`                           |
| `-h, --help`       | 显示帮助                                        | —                                 |

对已有项目而言，CLI flag 仍是 opt-in。新 TypeScript starter 生成的 `package.json` 会把 build script 设为 `vext build --typecheck`，因此 `npm run build` 默认包含语义类型检查；JavaScript 全栈 starter 使用 `vext build`；JavaScript API-only starter不生成 build script，可直接启动源码。

`--deploy-dry-run` 需与 `--upload-assets` 配合，且只模拟上传阶段；构建仍会实际生成本地产物。

生产 CLI 构建默认压缩后端输出。需要可读的本地输出时使用 `--no-minify`；若由环境控制该退出开关，可设置 `VEXT_BUILD_MINIFY=false`。前端生产压缩仍遵循 `frontend.build.minify`。

### 示例

```bash
# 构建项目
vext build

# 刷新 generated / manifest 后执行类型检查，再构建
vext build --typecheck

# 构建成功后清理已归属的陈旧产物
vext build --clean

# 指定输出目录
vext build --outdir build

# 保留可读输出，便于本地检查
vext build --no-minify

# 构建后上传前端静态资源
vext build --upload-assets

# 只看前端静态资源上传计划
vext build --upload-assets --deploy-dry-run

# 构建后启动
vext build && vext start
```

### 构建行为

- TypeScript 后端先刷新 `.vext/types/*.generated.d.ts`、`.vext/manifest/services.json` 与 `.vext/manifest/routes.json`；TypeScript 项目还会刷新 `src/types/generated/index.d.ts`
- TypeScript 后端的 `--typecheck` 开启时，在 generated 产物刷新后只执行项目本地的 `tsc --noEmit`；缺少本地 TypeScript 时给出可操作错误，不回退到网络解析
- 使用 esbuild 编译 TypeScript 后端；纯 JavaScript 后端保持 source 模式，不因 build 自动变成 dist 后端。启用前端时另行打包前端
- 不支持位置参数；`--outdir`、`--config` 等取值参数必须提供非 option 值
- 没有显式目录或成功构建记录时，输出目录为 `dist/`；下文 `dist/` 均表示此默认示例
- 保持源码目录结构
- 默认生成 `.js` 和 `.js.map` 文件；不会在 `dist/` 中生成声明文件
- 重复构建会在候选成功后移除已删除或重命名服务端源码留下的已归属陈旧产物；`--clean` 也遵循归属清单，保留未知文件。编译失败保留上一代成功产物；未知文件占用目标路径时报告冲突。
- 解析后的输出若是项目根、源码根或其父目录，破坏性清理会 fail closed；前端输出、资源目录、命名模式与 server outfile 也必须留在声明的构建边界内
- 启用前端时，会生成 `dist/client/index.html`、`manifest.json`、`deploy-manifest.json`、`size-report.json`、静态资源与 client contract 产物
- 使用 `--upload-assets` 时，会读取 `dist/client/deploy-manifest.json`，按 sha256 和 `frontend.deploy.upload.stateFile` 增量上传静态资源

### package.json 脚本

```json
{
  "scripts": {
    "build": "vext build --typecheck",
    "prepublishOnly": "vext build --typecheck"
  }
}
```

:::tip 开发 vs 构建

- **`vext dev`**：直接从 `src/` 加载 `.ts` 文件，通过 esbuild 即时编译，支持热重载
- **`vext build`**：TypeScript 后端编译到所选输出，JavaScript 后端保持 source 模式；前端按配置单独构建
  :::

## `vext start` — 生产模式启动

以生产模式启动项目。TypeScript 项目需先执行 `vext build`，start 从所选构建目录加载代码；缺少有效产物时会失败。未指定 `--config` / `VEXT_CONFIG` / 兼容 NODE_ENV profile 时，使用该产物记录的 profile，无记录时为 production。

有效 compiled 部署可以省略 `src/`：携带 package.json、运行依赖、所选输出目录及 `.vext/build-location.json`，或通过 `--outdir` 选择输出；输出内 `.vext-build.json` 随产物保留。纯 JavaScript source 模式仍需源码。开发和再次构建也需源码。

`.vext/freshness/` 是绑定本地项目真实路径的归属与中断恢复记录，不是可迁移的部署清单。部署到另一个目录时按上述清单复制成功产物，不复制整个 `.vext/`；存在未完成事务的工作目录应先恢复并重新成功构建，再制作部署包。

### 用法

```bash
vext start [options]
```

`vext start` 不支持位置参数。`--port`、`--host`、`--config`、`--port-conflict`、`--startup-profile-json` 等取值参数必须跟随非 option 值。

### 选项

| 选项                         | 说明                                                  | 默认值                   |
| ---------------------------- | ----------------------------------------------------- | ------------------------ |
| `--port <number>`            | 指定端口                                              | 配置文件中的值           |
| `--outdir <path>`            | 选择编译产物目录                                      | 环境变量、成功记录、dist |
| `--host <address>`           | 指定监听地址                                          | 配置文件中的值           |
| `--config <name>`            | 选择配置 profile；compiled 模式从产物 config 目录加载 | 见下方 profile 选择规则  |
| `--port-conflict <strategy>` | 端口冲突策略（`error/prompt/kill/next`）              | `error`                  |
| `--startup-profile`          | 输出生产启动阶段摘要与详细耗时                        | —                        |
| `--startup-profile-json <p>` | 将生产启动阶段耗时写入 JSON 文件                      | —                        |
| `--verbose-lifecycle`        | 输出详细生命周期日志                                  | —                        |
| `-h, --help`                 | 显示帮助                                              | —                        |

### 示例

```bash
# 先构建，再启动
vext build
vext start

# 指定端口
vext start --port 8080

# 端口冲突时自动切到下一个可用端口
vext start --port-conflict next

# 排查生产 cold-start 阶段耗时
vext start --startup-profile
vext start --startup-profile-json .vext/inspect/start-profile.json

# 显式加载 production profile 并覆盖端口
vext start --config production --port 8080

# 加载自定义配置 profile（需存在 src/config/sg-sit.ts）
vext start --config sg-sit
```

### 默认命令

当不传任何命令时，`vext` 默认执行 `start`：

```bash
# 以下两种方式等效
vext
vext start
```

### Cluster 模式

如果配置中启用了 `cluster`，`vext start` 会自动进入 Cluster 模式，由 Master 进程管理多个 Worker 进程：

```typescript
// src/config/production.ts
export default {
  cluster: {
    enabled: true,
    workers: "auto", // 由框架按可用 CPU 计算 Worker 数量
  },
};
```

或通过环境变量启用：

```bash
VEXT_CLUSTER=1 vext start
```

### 预加载（Preload）自动注入

`vext start` 和 `vext dev` 会自动解析两类 preload 来源：

1. 已安装依赖包中声明的 `vext.preload`
2. 应用项目中的规范目录 `src/preload/`

在子进程启动前，这些脚本会统一通过 `--import` 注入。例如 `@devcodex/opentelemetry` 可利用包级 `vext.preload` 在应用代码加载前自动初始化 OpenTelemetry SDK；应用项目本身也可以直接在 `src/preload/` 中放置脚本做启动前环境桥接。

项目级 preload 规则：

- 规范目录固定为 `src/preload/`
- 非递归扫描
- 项目级 preload 先执行，包级 preload 后执行
- `.mjs` / `.js` 直接注入
- dev 和纯 JS source 模式会在启动前将 `.ts` / `.mts` 编译为 `.vext/preload/*.mjs`；compiled start 使用所选产物内的 `preload/*.mjs`
- 显式外部输出目录同样适用：start 先验证构建身份，再以所选产物根约束 preload 读取。空目录不会回退到源码，逃逸该产物根的链接会被拒绝；依赖包仍从服务根解析。单进程与 cluster 使用同一规则。
- 外部后端产物包含受管的 `.vext-dependencies.cjs`；项目 preload 入口先建立依赖作用域，再加载 `.vext-preload/` 中的编译内容。部署需携带完整产物目录及服务的 `package.json`、运行时依赖，并保留服务与产物的相对位置；源码可以省略。不要单独搬移辅助文件或把多个服务的产物混放到同一输出目录。
- `vext dev` 下若 `src/preload/` 里的文件发生变化，会触发 cold restart
- 项目根 `preload/` 是仅用于迁移的临时兼容回退；使用时会输出迁移 warning。不要在两个目录同时放置支持的 preload 文件，Vext 会 fail-fast，避免脚本重复执行

详见 [预加载 (Preload)](/zh/guide/preload)。

### 启动期配置 Provider

如果项目存在 `src/config/bootstrap.ts`，`vext start` / `vext dev` 会在配置 validate / freeze 前执行其中声明的 `bootstrap config provider`，并将 provider 返回的 patch 合并到最终配置中。优先级为：`default < config profile < local（仅 development 模式）< provider < CLI`。compiled start 从所选构建目录读取配置；JSON/JS等入口格式与加载条件见[配置](/zh/guide/configuration)。

Cluster 模式下，Master 会把本轮 provider patch 传递给 Worker 复用，避免同一启动周期内 Master / Worker 看到不同远程配置。

### package.json 脚本

```json
{
  "scripts": {
    "build": "vext build --typecheck",
    "start": "vext start",
    "start:sg-sit": "vext start --config sg-sit",
    "start:us-uat": "vext start --config us-uat",
    "deploy:assets:sg-sit": "vext deploy assets --config sg-sit --dry-run"
  }
}
```

:::tip 配置 profile 选择
显式选择按 `--config > VEXT_CONFIG > 非标准 NODE_ENV 的兼容 profile` 解析。未显式选择时，`dev` 默认 development，`build` 默认 production；`start` 与 `deploy assets` 优先沿用选中成功产物记录的 profile，无记录时才回退 production。需要指定 profile 时：

- CLI 参数：`vext start --config sg-sit`
- 环境变量：`VEXT_CONFIG=sg-sit vext start`

profile 名匹配 `src/config/{profile}.ts`（build 后对应 `dist/config/{profile}.js`）。
每条命令最多传入一次 `--config`。`start`、`dev`、`build` 与 `deploy assets` 遇到重复参数时会直接失败，不会静默采用最后一个值。
:::

## `vext stop` — 停止服务

停止正在运行的 Cluster 模式服务。读取 PID 文件后发送 SIGTERM，并最多等待 Master 退出 30 秒；超时会以非零码退出，不表示进程已经停止。信号处理和连接排空还受平台与运行环境影响，应复核进程及端口状态。

### 用法

```bash
vext stop [options]
```

`vext stop` 不支持位置参数。`--pid-file` 必须跟随非 option 路径值。

### 选项

| 选项                | 说明         | 默认值      |
| ------------------- | ------------ | ----------- |
| `--pid-file <path>` | PID 文件路径 | `.vext.pid` |
| `-h, --help`        | 显示帮助     | —           |

### 示例

```bash
# 优雅停止
vext stop

# 指定 PID 文件
vext stop --pid-file /var/run/myapp.pid
```

:::info
`vext stop` 面向 Cluster PID 文件。单进程优先在启动终端使用 `Ctrl+C`；进程管理器应按平台支持的方式请求关闭，并复核连接和资源是否完成清理。
:::

## `vext reload` — 滚动重启

向 Cluster Master 发送 `SIGHUP` 请求逐个替换 Worker（Rolling Restart）。仅 Unix/macOS 支持；Windows 会返回非零退出码并提示手动停止、启动。CLI 信号发送成功不代表全部 Worker 已替换成功。

### 用法

```bash
vext reload [options]
```

`vext reload` 不支持位置参数。`--pid-file` 必须跟随非 option 路径值。

### 选项

| 选项                | 说明         | 默认值      |
| ------------------- | ------------ | ----------- |
| `--pid-file <path>` | PID 文件路径 | `.vext.pid` |
| `-h, --help`        | 显示帮助     | —           |

### 示例

```bash
# 部署新版本后滚动重启
vext build
vext reload
```

### 滚动重启流程

```
1. 向 Master 进程发送 SIGHUP 信号
2. Master 逐个重启 Worker：
   a. 启动新 Worker
   b. 等待新 Worker ready
   c. 优雅关闭旧 Worker
   d. 重复，直到所有 Worker 更新完成
3. 新 Worker 未 ready 时保留旧 Worker并记录失败；核对 replaced/total 和业务请求
```

:::tip 适用场景
部署前先确认构建成功，再请求 reload，并观察 Master 日志与实际业务响应。可用性取决于新 Worker 就绪、旧连接排空、资源余量和业务兼容性；长连接可能在关闭超时后被终止。Windows 的 stop/start 会中断服务，不能称为滚动替换。
:::

## `vext status` — 查看运行状态

读取 PID 文件判断对应进程是否存活，再探测指定 host/port 的 `/health`。不会列出全部 Worker、CPU 或请求数；只有该 HTTP 响应顶层含 `pid`、`uptime`、`memory` 时，才打印相应信息。默认包装在 `data` 内的业务健康数据不会被自动展开。

### 用法

```bash
vext status [options]
```

`vext status` 不支持位置参数。`--pid-file`、`--port`、`--host` 等取值参数必须跟随非 option 值。

### 选项

| 选项                | 说明         | 默认值      |
| ------------------- | ------------ | ----------- |
| `--pid-file <path>` | PID 文件路径 | `.vext.pid` |
| `--port <number>`   | 健康探测端口 | `3000`      |
| `--host <address>`  | 健康探测主机 | `127.0.0.1` |
| `-h, --help`        | 显示帮助     | —           |

### 示例

```bash
vext status
vext status --port 8080
```

### 输出示例

```text
Status: 🟢 running
  Master PID: 12345
  PID file:   /srv/my-app/.vext.pid
  Health:     (endpoint unreachable at http://127.0.0.1:3000/health)
```

这是进程存活、但健康端点不可达时的输出格式，PID 和路径为示意。其他状态包括 `not running`、`stale` 和 `invalid PID file`。状态查询返回 0 并不代表服务健康；它不会自动读取项目端口，也不能用该退出码作为就绪探针。全栈 starter 的健康路由在 `/api/health`，该命令的探测路径仍固定为 `/health`，应另行验证实际健康入口。

## `vext deploy assets` — 上传前端静态资源

读取最近成功构建和解析后的 `frontend.outDir/deploy-manifest.json`，把公开清单内的 JS、CSS、图片、字体和 `public/**` 资源上传到配置目标。内置 `filesystem` 与 `mock` adapter；云厂商上传可使用自定义 adapter。

### 用法

```bash
vext deploy assets [options]
```

`vext deploy assets` 不支持位置参数。`--manifest`、`--adapter`、`--target-dir`、`--prefix`、`--state-file` 等取值参数必须跟随非 option 值，例如 `--manifest dist/client/deploy-manifest.json`；`--manifest --dry-run` 会作为缺值错误失败。

### 选项

| 选项                  | 说明                                    | 默认值                                          |
| --------------------- | --------------------------------------- | ----------------------------------------------- |
| `--outdir <path>`     | 显式选择后端构建输出                    | 成功构建记录，缺省 `dist`                       |
| `--config <name>`     | 显式选择部署 profile                    | 成功构建的 profile                              |
| `--manifest <path>`   | 指定 deploy manifest 路径               | 解析后的 `frontend.outDir/deploy-manifest.json` |
| `--adapter <name>`    | 上传 adapter，例如 `filesystem`、`mock` | 配置值                                          |
| `--target-dir <path>` | `filesystem` adapter 写入目录           | 配置值                                          |
| `--prefix <path>`     | 上传 key 前缀                           | 配置值                                          |
| `--state-file <path>` | 增量上传状态文件                        | 配置值                                          |
| `--dry-run`           | 只输出上传计划，不写入目标              | `false`                                         |
| `--json`              | 输出结果或错误及逐资源状态的 JSON       | `false`                                         |
| `-h, --help`          | 显示帮助                                | —                                               |

### 示例

```bash
# 使用配置中的 upload 目标
vext deploy assets

# 只看计划
vext deploy assets --dry-run

# 本次覆盖上传目录和 key 前缀
vext deploy assets --target-dir .deploy/cdn --prefix my-app/v1
```

第二次执行时，Vext 会读取 `frontend.deploy.upload.stateFile`，对比每个 `uploadKey` 的 sha256；内容未变化的资源会跳过，不会重复上传图片、字体或稳定 public 文件。默认 deploy manifest 不包含 `index.html` 和 source map：HTML 仍由 Vext 服务端渲染，source map 不随 CDN 静态资源发布。

## `vext typegen` — 生成声明并执行 service 依赖诊断（experimental）

为 `app.services` 与插件里的 `app.extend()` / `defineAppExtensions<{ ... }>()` 提供 generated 声明，同时执行 tooling-only 的 service 依赖检查。

### 用法

```bash
vext typegen [options]
```

`vext typegen` 不接受位置参数。未知参数会立即失败，并输出可操作的诊断信息。`--root` / `-C` 这类取值选项必须跟随非 option 值；`--root --json` 会被拒绝，不会把 `--json` 当成路径。

### 选项

| 选项               | 说明                                   | 默认值   |
| ------------------ | -------------------------------------- | -------- |
| `--services`       | 仅生成 `services.generated.d.ts`       | `false`  |
| `--app-extensions` | 仅生成 `app-extensions.generated.d.ts` | `false`  |
| `--check`          | 只校验 generated 结果，不写文件        | `false`  |
| `--json`           | 输出机器可读 JSON                      | `false`  |
| `--write-manifest` | 写入 `.vext/manifest/services.json`    | `false`  |
| `--root <path>`    | 指定项目根目录                         | 当前目录 |
| `-C <path>`        | `--root` 别名                          | —        |
| `--verbose`        | 预留给后续详细日志                     | `false`  |
| `-h, --help`       | 显示帮助                               | —        |

### 产物

```text
.vext/types/services.generated.d.ts
.vext/types/app-extensions.generated.d.ts
src/types/generated/index.d.ts # 仅 TypeScript 项目；Vext 管理
.vext/manifest/services.json # 显式 --write-manifest 时生成
```

对 TypeScript 项目，`src/types/generated/**` 是 `vext typegen` 在 `src/types/**` 内唯一会写入的位置。JavaScript 项目仍保留隐藏的 `.vext/types` 产物，但不会收到公开 `.d.ts` shim。全栈 starter 的 `shared/**` 与 `frontend/**` 是应用维护的契约目录；它们的职责与各模板的生成条件见[生成的目录结构](#生成的目录结构)。

### 示例

```bash
vext typegen
vext typegen --check
vext typegen --write-manifest
vext typegen --services --root ./examples/hello-world
```

### 适用边界

- 同一次 typegen 的服务清单、插件扩展、依赖诊断和生成候选共用一份封存源码，不在诊断阶段重新读盘，也不执行项目模块。`.d.ts`、`.d.mts`、`.d.cts` 声明文件不作为服务；源码中的 `.mts` / `.cts` 类型导入分别映射为 `.mjs` / `.cjs`。
- 源码按 UTF-8 严格读取。默认预算为 5000 个文件、单文件 2MiB、合计 64MiB，目录发现最多消费 50000 个条目；可通过 `VEXT_SOURCE_MAX_FILES`、`VEXT_SOURCE_MAX_FILE_BYTES`、`VEXT_SOURCE_MAX_TOTAL_BYTES`、`VEXT_SOURCE_MAX_SCAN_ENTRIES` 指定非负整数覆盖，字节项单位为 byte。Doctor、typegen 和构建中的静态采集共用此策略；内部显式调用参数优先于环境。超限表示分析未完整完成，会报出原因，不输出空的成功结果。这些预算不限制服务运行，也不是 MCP 响应预算。
- 项目根内的目录链接保留逻辑路径，例如 `src/routes/billing` 链接到项目内共享目录后仍使用 `/billing` 前缀。目录循环、越过已声明根的链接和文件链接明确报告无法完成分析，不静默漏掉路由。封存分析不是整个目录树的原子快照，仍需在提交时核对源码是否改变。
- 选中的声明、shim 和可选 service manifest 会在依赖检查完成后一起提交。阻断诊断、不可读输出或归属冲突会保留原有文件；未选中的声明不被删除，shim 只引用本次选中的声明。
- `--check` 只比较实际文件，不写输出或归属记录，可在开发服务运行时执行。缺失或内容不符报告 stale；读取失败会保留具体错误。同内容生成不重写文件。手动修改生成文件后，应先核对并处理冲突，再重新生成。
- `typegen` 整体仍属于 **tooling-only** 能力，不会进入 `vext start` 的 runtime 主路径；
- `vext dev` 会在 preflight 中自动执行基础 `typegen`，`vext build` 也会在可选 typecheck 与编译前刷新 generated 声明和 manifest；
- TypeScript 语义诊断默认在 ready / reload 后异步输出；如果希望像旧行为一样阻塞启动或重载，可使用 `--strict-preflight` 或 `VEXT_DEV_STRICT_PREFLIGHT=1`；
- TS 项目优先输出高质量类型，JS 项目允许退化到 `import(...).default` / `unknown`，但命令本身仍可用；
- `--write-manifest` 会把 service 索引、`app.extend()` / `defineAppExtensions<{ ... }>()` 聚合结果与服务依赖图摘要写入 `.vext/manifest/services.json`；
- 更多 generated 声明示例可结合 [服务](./services) 与 [插件](./plugins) 文档查看。

service manifest 同时记录 `sourceRevision`、`complete`、`incompleteFiles`，绑定当次封存源码；文件生成不代表静态推断完整。无法证明插件扩展或依赖时保留 incomplete，不把当前摘要补写到旧 manifest 来伪造新鲜度。

## `vext doctor routes` — 静态路由诊断（experimental）

`vext doctor all` 使用独立的综合分析，检查路由、服务依赖和可静态证明的插件扩展，JSON 中列出 profile、valid、每域状态与证据。运行配置、数据库连接等未实测域保留未检查状态；`routes` 只检查路由，不将部分检查冒充整个项目健康。

扫描 `src/routes/` 中的静态路由元数据，输出重复路由、缺失 `docs.summary`、自动推断 `operationId` 等诊断，并可将结果落盘到 inspect / manifest 产物中。

### 用法

```bash
vext doctor <target> [options]
```

`--root` / `-C` 这类取值选项必须跟随非 option 值；`--root --json` 会被拒绝，不会把 `--json` 当成路径。

### Targets

| Target   | 说明                                                   |
| -------- | ------------------------------------------------------ |
| `routes` | 扫描静态路由元数据与 OpenAPI 相关字段                  |
| `all`    | 检查路由合同、服务依赖和插件扩展，输出分域完整性与证据 |

### 选项

| 选项               | 说明                              | 默认值   |
| ------------------ | --------------------------------- | -------- |
| `--json`           | 输出机器可读 JSON                 | `false`  |
| `--write-inspect`  | 写入 `.vext/inspect/routes.json`  | `false`  |
| `--write-manifest` | 写入 `.vext/manifest/routes.json` | `false`  |
| `--refresh`        | 兼容选项；默认已分析当前源码      | `false`  |
| `--manifest-only`  | 显式读取已有 manifest 快照        | `false`  |
| `--root <path>`    | 指定项目根目录                    | 当前目录 |
| `-C <path>`        | `--root` 别名                     | —        |
| `-h, --help`       | 显示帮助                          | —        |

### 产物定位

| 产物                         | 定位                                         | 适用对象                         |
| ---------------------------- | -------------------------------------------- | -------------------------------- |
| `.vext/inspect/routes.json`  | inspect / 诊断中间层，包含诊断明细与调试字段 | `doctor`、debug、深度分析        |
| `.vext/manifest/routes.json` | 稳定消费层，字段收敛为 routes-only manifest  | 编辑器、CI、可视化、后续 codemod |

### 示例

```bash
vext doctor routes
vext doctor routes --write-inspect
vext doctor routes --write-inspect --write-manifest --json
```

### 当前边界

- `profile` 为 `static-routes` 或 `static-project`。`domains` 逐域报告 `checked`、`not-present`、`unsupported`、`incomplete`；动态服务访问和无法完整投影的插件会保留局限。`valid` 仅在该静态 profile 的必需项完整且没有错误时为 true；`ok` 仅表示没有错误诊断。configuration、models、frontend、runtime 的实际配置/运行验证不属于该静态 profile，不能把它们的 unsupported 解释为能力未启用。

- Doctor 默认分析本次封存的路由源码，用同一份原始字节生成路由条目、fingerprint 与源码文件清单，不复用磁盘 manifest 作为静态分析缓存。`--refresh` 保留为兼容选项。
- CLI 文本、JSON 和 inspect 报告均标明 `sourceFreshness`：`current` 表示本次源码分析；`--manifest-only` 保留历史快照自身的来源信息，摘要不同为 `stale`，摘要缺失或仅声明匹配为 `unverified`。缺少摘要用 `null` 表示，缺失的 schema、freshness 或 docsKind 保持未知并给出诊断。`ok` 仅表示没有阻断诊断，不代表历史快照已重新验证，也不保证分析结束后磁盘没有再次修改。
- `--manifest-only` 不能与 `--refresh` 或 `--write-manifest` 组合。历史快照读取有大小与格式校验，损坏或越界来源会报告错误。
- 同时指定 `--write-inspect --write-manifest` 时，两份结果一起提交；任一输出不可读或被外部修改，均保留原文件并报告错误。普通诊断是只读的，写入模式与同一项目的 dev/build 共用写入权。
- 运行中的开发服务也会收集并生成 route manifest，与 Doctor 共用该文件的归属记录。清单是诊断或构建输入；它的存在不能证明服务已启动、某一代重载已完成，或诊断没有阻断项。
- 当前 route manifest 与 services manifest 仍分层维护，不合并为单一总 manifest；
- `docs.operationId` 缺失时，doctor 会按 runtime 行为给出 `auto-operation-id` 信息提示，而不是误报 warning；
- 路由侧仍由 `doctor routes --write-manifest` 负责；service 侧则由 `typegen --write-manifest` 负责。

## Job 命令

后台任务使用 `vext job list`、`vext job inspect <name>`、`vext job run <name>`、`vext job enqueue <name>`、`vext job scheduler`、`vext job worker`、`vext job runs` 和 `vext job status <runId>`。这些命令加载 headless Job runtime，不启动 HTTP 服务。详见 [任务与 Jobs](/zh/guide/jobs)。

```bash
vext job --help
vext job list --json
vext job inspect <name> --json
vext job runs --limit 10 --json
```

`<name>`、`<runId>` 替换为项目实际 Job 名或运行记录。共同选项包括 `--config <profile>`、`--outdir <dir>`、`--source` 和 `--json`；run/enqueue 支持 `--payload <json>` 或 `--payload-file <path>`，runs 的 `--limit` 为正整数。scheduler/worker 是常驻进程，run/enqueue 会产生业务副作用，使用前按 Jobs 指南完成 payload、store、worker/scheduler 配置与退出清理。list/inspect 仍会加载 headless runtime，不能当作不求值项目模块的纯静态分析。

## MCP 命令

### 调用入口

| 用法                                                         | 行为                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| `vext mcp --root .`                                          | 由宿主连接的 stdio 服务，持续运行直到连接关闭             |
| `vext mcp sync --root . --host codex --check --json`         | 读取并报告计划，不写宿主配置                              |
| `vext mcp sync --root . --host codex --dry-run --json`       | 输出拟写入的受管配置；不能与 --check 同时使用             |
| `vext mcp sync --root . --host codex --skill --json`         | 实际写宿主配置及可选项目 Skill；先核对 check/dry-run 结果 |
| `vext mcp skill check` / `print`                             | 读取随包 Skill 摘要或正文                                 |
| `vext mcp skill write --output .vext/skills/vextjs/SKILL.md` | 导出到指定文件；不同内容冲突时拒绝，显式 --force 才替换   |

`--root` 缺省为当前目录；`sync --host` 可选 codex、claude-code、cursor、vscode 或 grok，省略时按计划处理声明的宿主。帮助入口分别为 `vext mcp --help`、`vext mcp sync --help` 和 `vext mcp skill --help`。stdio 入口本身不写宿主配置，sync/write 才执行上表所列写入；不要把 stdio 的只读承诺泛化到所有 MCP 子命令。

### 服务与宿主边界

当前 CLI 提供 `vext mcp --root <dir>`，用于启动随包提供的 stdio MCP 服务。它绑定单个 Vext 项目根，注册 7 个 Tools、11 个 Resources 和 4 个 Prompts，并提供有界项目检查、内置 Vext 知识搜索、17 条 Recipe 的 create-only ChangeSet 草稿、候选校验和应用后宿主验证计划。MCP 服务不执行 shell 命令、不启动或重启服务、不应用文件修改、不运行测试，也不修改宿主 MCP 配置；它只返回分析结果、机器可校验诊断和需要宿主执行的步骤。

`vext_knowledge_search` 返回随包知识、原生 API 示例与适用性，区分框架声明范围、知识审查版本和服务/框架各自解析的安装版本。版本不匹配或缺包时明确标注，MCP 不联网抓取文档或连接数据库。目录覆盖、全部 17 条 Recipe、JS/TS 类型、注释及实际接入流程见 [MCP 代码生成与依赖知识](./mcp-generation)。

`vext_validate_changes` 校验内容身份、源码覆盖、目录/物理边界、已有文件、重复路径、UTF-8、内容摘要、语法及导入，并将候选放入共享 overlay 检查路由冲突等问题。返回文件判定、目录来源与 requiredHostSteps；未知或不完整证据不能获得 applyReady。默认目录可覆盖，不强制创建空目录，也不按一行代码或 function 数量判定业务正确；格式和注释遵从项目规范并由宿主复核。

`vext_project_check` 会执行有界静态诊断，覆盖目录缺失、路由 response schema 缺失、过期 docs.tags、service 依赖分析不完整、数据库 cursorSecret 配置选择、Redis store 目标缺失或依赖未配置环境变量、SVG 上传审查、前端 form/API 边界和占位测试等问题。返回值包含 `diagnostics`、`totalBySeverity`、`affectedConsumers` 和 `generatedState`；命令建议仍由宿主执行。`vext_runtime_inspect` 会读取框架运行时写入的 `.vext/runtime/snapshots/<instanceId>.json` 受管快照；MCP 不启动服务、不执行 Job、不读取原始日志；宿主 MCP 配置写入由 `vext mcp sync` 负责。

`vext_project_inspect` 的 `jobs` section 会静态读取 `config.jobs` 和 Job 源文件，返回 Job 名称、来源文件、queue、schedule、payload schema presence、scheduler/worker/store 配置摘要、可由宿主执行的 `vext job ...` 命令和多进程/cluster 部署提示。MCP 不执行 Job、不连接队列、不读取运行时队列表。

monorepo 通过实际 workspace 成员、共享包声明、package exports/sourceExports 和消费者依赖验证源码归属；相邻服务不会自动进入读取范围。显式配置的外部 models/locales/前端源目录仅在路径可证明时作为只读来源。跨根候选不因目录名称或共享声明而自动获得写入许可。

普通 CI 会显式运行 MCP 定向单测、`npm run verify:mcp` 和 `npm run verify:public-surface`，避免 MCP 协议面、公共清单和 CLI stdio 行为在普通 PR 中漂移。Redis 相关能力由独立 Redis service lane 覆盖；本地无 Redis 时集成测试可以提示跳过，但 CI 中该 lane 必须连接真实 Redis。

发布前的同包验收使用 `npm run verify:pack-install` 覆盖打包安装后的 ESM/CJS、TypeScript 合同、运行时 smoke 和 MCP stdio smoke。该脚本成功后会自动清理临时安装 workspace；失败时保留 evidence 目录便于排查。需要成功后也保留证据时，显式设置 `VEXT_PREFLIGHT_KEEP_EVIDENCE=1` 或 `VEXT_PREFLIGHT_WORKSPACE=<dir>`。真实平台、数据库、浏览器和五宿主矩阵仍属于发布验收流程，不能只用本地协议模拟替代。

宿主同步当前支持两种模式：`vext mcp sync --root <dir> --check --json` 或 `--dry-run` 只输出计划；不带这两个参数时会写入项目内 `.vext/mcp/launcher.cjs`、`.vext/mcp/hosts.json`，为 Codex 写入用户级 Codex 配置（优先 `CODEX_HOME/config.toml`，否则当前用户 `.codex/config.toml`），并为 Claude Code、Cursor、VS Code 等 JSON/JSONC 宿主配置写入受管 MCP server entry，为 Grok 等 TOML 宿主写入 Vext 受管块。写入结果会返回目标级 `verified` 回读校验；若 TOML 中已有同名非受管 table，会返回 blocked 并保留原文件；发生 launcher、宿主配置或 Skill 实际写入时，`applied.nextSteps` 会按宿主返回重载、重新打开会话和只读验证提示。五宿主真实运行验收仍属于发布验收流程，不能只用本地文件回读替代。

可选 Skill 随包构建，可用 `vext mcp skill check` 查看摘要、`vext mcp skill print` 输出 Markdown，或用 `vext mcp skill write --output <file>` 写入用户指定位置。`vext mcp sync --skill` 会按所选宿主的项目内 Skill 路径写入官方 Skill；若目标文件已存在且内容不同，会返回 blocked 并保留原文件。

## 全局选项

以下选项放在 CLI 入口后：`vext --help`、`vext --version`。子命令帮助使用 `vext <command> --help`；不要把入口版本选项当成所有子命令都支持的参数。

| 选项            | 说明         |
| --------------- | ------------ |
| `-h, --help`    | 显示帮助信息 |
| `-v, --version` | 显示版本号   |

```bash
# 查看版本
vext --version
# 当前包的示例输出: vextjs v2.0.0；以实际安装版本为准

# 查看帮助
vext --help
```

## 推荐的 package.json 脚本

下面以 TypeScript 项目为例，合入现有 package.json，保留依赖。stop/reload/status 用于 Cluster；test 脚本需要先按[测试指南](/zh/guide/testing)配置 Vitest 和覆盖率依赖。JS 项目删除不适用的 typecheck，并按是否启用前端选择 build。

```json
{
  "name": "my-app",
  "type": "module",
  "scripts": {
    "dev": "vext dev",
    "build": "vext build --typecheck",
    "start": "vext start",
    "stop": "vext stop",
    "reload": "vext reload",
    "status": "vext status",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:cov": "vitest run --coverage",
    "typecheck": "tsc --noEmit"
  }
}
```

## 常见问题

### `vext start` 报错 "dist/ not found"

TypeScript 后端先成功执行 `vext build`，再检查 start 选中的输出目录（显式选项、环境、成功记录、默认 dist）。构建失败或身份不一致也会拒绝启动，不应只凭目录存在就跳过检查。启用前端时还需完整的前端产物；默认前端目录是所选输出下的 client，自定义 frontend.outDir 则按其配置检查。纯 JavaScript source 模式保留 src，见[构建与编译](/zh/guide/build)。

### 开发时应该用 `vext dev` 还是 `vext start`？

日常开发使用 `vext dev`，它直接加载 `src/` 下的 TypeScript 文件，支持热重载，无需手动编译。`vext start` 用于生产环境。

### 如何指定 Node.js 版本？

VextJS 要求 Node.js **`^20.19.0 || >=22.12.0`**。使用满足该范围且经项目验证的版本；`.node-version` 或 `.nvmrc` 由所用版本管理器读取，CLI 本身不会安装或切换 Node。以下只是文件写法示例：

```bash
echo "22" > .node-version
```

### `vext stop` / `vext reload` / `vext status` 不工作？

这些命令围绕 Cluster PID 文件工作。检查启动方式、工作目录和实际 PID 文件路径；自定义 `cluster.pidFile` 时，三个命令都要传入相同的 `--pid-file`。status 的端口需显式对应实际监听端口；reload 还要求 Unix/macOS。单进程用启动终端 Ctrl+C 停止。

## 下一步

- 了解 [热重载](/zh/guide/hot-reload) 的变更分类和重载边界
- 配置 [前端指南](/zh/frontend/overview)
- 学习 [Cluster 多进程](/zh/guide/cluster) 的完整配置
- 查看 [配置](/zh/guide/configuration) 中端口、日志等选项
- 探索 [项目结构](/zh/guide/project-structure) 的约定
