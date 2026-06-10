# CLI 命令

VextJS 提供了 `vext` 命令行工具，覆盖项目创建、开发、构建、部署的完整生命周期。

## 安装

`vext` CLI 随 `vextjs` 包一起安装，无需额外安装：

```bash
npm install vextjs
```

安装后可以通过以下方式调用：

```bash
# 通过 npx
npx vext <command>

# 通过 package.json scripts（推荐）
npm run dev    # → vext dev
npm start      # → vext start
npm run build  # → vext build
```

## 命令概览

| 命令                 | 说明                                              | 常用场景           |
| -------------------- | ------------------------------------------------- | ------------------ |
| `vext create <name>` | 创建新项目                                        | 项目初始化         |
| `vext dev`           | 开发模式启动                                      | 日常开发           |
| `vext build`         | 构建项目                                          | 部署前构建         |
| `vext typegen`       | 生成声明 + service 依赖诊断（experimental）       | TS/JS 项目工程辅助 |
| `vext doctor routes` | 静态路由诊断 + inspect / manifest（experimental） | OpenAPI / 路由治理 |
| `vext start`         | 生产模式启动                                      | 生产部署           |
| `vext stop`          | 停止服务                                          | Cluster 模式管理   |
| `vext reload`        | 滚动重启                                          | 零停机更新         |
| `vext status`        | 查看运行状态                                      | Cluster 状态监控   |

## `vext create` — 创建项目

交互式创建新的 VextJS 项目，自动生成项目骨架和配置文件。

### 用法

```bash
npx vextjs create <project-name> [options]
```

### 选项

| 选项               | 说明                                                    | 默认值   |
| ------------------ | ------------------------------------------------------- | -------- |
| `--adapter <name>` | 指定 Adapter（native / hono / fastify / express / koa） | `native` |
| `--js`             | 创建 JavaScript 项目（而非 TypeScript）                 | `false`  |
| `--skip-install`   | 跳过 `npm install`                                      | `false`  |
| `--force`          | 目标目录存在且非空时强制覆盖                            | `false`  |
| `-h, --help`       | 显示帮助                                                | —        |

### 示例

```bash
# 创建 TypeScript 项目（默认 Native Adapter）
npx vextjs create my-app

# 指定 Adapter
npx vextjs create my-app --adapter hono
npx vextjs create my-app --adapter fastify

# 创建 JavaScript 项目
npx vextjs create my-app --js

# 跳过依赖安装
npx vextjs create my-app --skip-install
```

### 生成的目录结构

```
my-app/
├── preload/
│   └── README.md             # 项目级 preload 脚本占位说明
├── src/
│   ├── config/
│   │   ├── default.ts        # 默认配置（port: 3000）
│   │   ├── development.ts    # 开发环境覆盖
│   │   ├── production.ts     # 生产环境覆盖（port: 3001）
│   │   ├── local.example.ts  # 复制为 local.ts 后启用本地覆盖
│   │   └── bootstrap.example.ts # 复制为 bootstrap.ts 后启用启动期 provider
│   ├── routes/
│   │   └── index.ts          # 示例路由
│   ├── services/
│   │   └── example.ts        # 示例服务
│   ├── middlewares/
│   │   └── README.md         # 自定义中间件占位说明
│   ├── plugins/
│   │   └── README.md         # 自定义插件占位说明
│   ├── locales/
│   │   └── README.md         # i18n 语言包占位说明
│   └── types/
│       └── generated/
│           └── .gitkeep      # typegen 输出目录占位（TS 项目）
├── package.json
├── tsconfig.json
└── .gitignore
```

创建完成后：

```bash
cd my-app
npm run dev
```

访问 `http://localhost:3000`，你应该能看到框架的 JSON 响应。

如需在配置冻结前拉取远程配置（例如 Nacos / 启动期数据库配置），可将 `src/config/bootstrap.example.ts` 复制为 `src/config/bootstrap.ts` 并通过 `defineBootstrapConfig()` 注册 provider。需要本地覆盖时，可将 `src/config/local.example.ts` 复制为 `src/config/local.ts`，该文件默认被 `.gitignore` 排除。

## `vext dev` — 开发模式

以开发模式启动项目，支持文件监听和智能热重载。

### 用法

```bash
vext dev [options]
```

### 选项

| 选项                         | 说明                                        | 默认值         |
| ---------------------------- | ------------------------------------------- | -------------- |
| `--port <number>`            | 指定端口                                    | 配置文件中的值 |
| `--host <address>`           | 指定监听地址                                | 配置文件中的值 |
| `--debounce <ms>`            | 防抖间隔（毫秒，0 = 不开启）                | `0`            |
| `--poll`                     | 强制轮询模式（Docker / NFS 环境）           | `false`        |
| `--poll-interval <ms>`       | 轮询间隔（毫秒，仅 `--poll` 时有效）        | `1000`         |
| `--no-hot`                   | 禁用 Soft Reload，所有变更走 Cold Restart   | —              |
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
- `kill`：尝试终止占用端口的进程
- `next`：自动选择下一个可用端口

```bash
vext dev --port-conflict prompt
vext start --port-conflict next
```

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

# 禁用 Soft Reload（所有变更均走 Cold Restart）
vext dev --no-hot

# 输出启动阶段摘要与详细耗时
vext dev --startup-profile

# 仅写 JSON，不打印 summary/details
vext dev --startup-profile-json .vext/inspect/startup-profile.json
```

### 热重载策略

`vext dev` 提供三层热重载策略，自动选择最优方式：

| 层级                    | 触发条件                                   | 行为                       | 速度      |
| ----------------------- | ------------------------------------------ | -------------------------- | --------- |
| **Tier 1** — 路由热替换 | `src/routes/` 文件变更                     | 原子替换请求处理器，零中断 | ⚡ 毫秒级 |
| **Tier 2** — 服务重载   | `src/services/` 或 `src/locales/` 文件变更 | 重建受影响的服务实例       | ⚡ 毫秒级 |
| **Tier 3** — 冷重启     | `src/config/` 或 `src/plugins/` 文件变更   | 完整重启进程               | 🔄 秒级   |

详见 [热重载](/guide/hot-reload) 章节。

### package.json 脚本

```json
{
  "scripts": {
    "dev": "vext dev"
  }
}
```

## `vext build` — 构建项目

将 TypeScript 源码编译为 JavaScript，生成生产可用的 `dist/` 目录；构建前会刷新 typegen 与 route manifest 这类工具产物。

### 用法

```bash
vext build [options]
```

### 选项

| 选项              | 说明                                            | 默认值  |
| ----------------- | ----------------------------------------------- | ------- |
| `--outdir <path>` | 输出目录                                        | `dist`  |
| `--clean`         | 编译前清理输出目录                              | `false` |
| `--sourcemap`     | 生成 source map                                 | `true`  |
| `--no-sourcemap`  | 禁用 source map                                 | —       |
| `--minify`        | 压缩输出代码                                    | `false` |
| `--typecheck`     | 刷新 generated / manifest 后执行 `tsc --noEmit` | `false` |
| `-h, --help`      | 显示帮助                                        | —       |

### 示例

```bash
# 构建项目
vext build

# 刷新 generated / manifest 后执行类型检查，再构建
vext build --typecheck

# 清理旧 dist 后构建
vext build --clean

# 指定输出目录
vext build --outdir build

# 构建后启动
vext build && vext start
```

### 构建行为

- 先刷新 `.vext/types/*.generated.d.ts`、`src/types/generated/index.d.ts`、`.vext/manifest/services.json` 与 `.vext/manifest/routes.json`
- `--typecheck` 开启时，在 generated / manifest 刷新后执行 `tsc --noEmit`
- 使用 esbuild 进行极速编译（TypeScript → JavaScript）
- 输出目录默认为 `dist/`
- 保持源码目录结构
- 默认生成 `.js` 和 `.js.map` 文件；不会在 `dist/` 中生成声明文件

### package.json 脚本

```json
{
  "scripts": {
    "build": "vext build",
    "prepublishOnly": "vext build"
  }
}
```

:::tip 开发 vs 构建

- **`vext dev`**：直接从 `src/` 加载 `.ts` 文件，通过 esbuild 即时编译，支持热重载
- **`vext build`**：将 `src/` 编译到 `dist/`，生产模式从 `dist/` 加载
  :::

## `vext typegen` — 生成声明并执行 service 依赖诊断（experimental）

为 `app.services` 与插件里的 `app.extend()` / `defineAppExtensions<{ ... }>()` 提供 generated 声明，同时执行 tooling-only 的 service 依赖检查。

### 用法

```bash
vext typegen [options]
```

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
src/types/generated/index.d.ts
.vext/manifest/services.json
```

### 示例

```bash
vext typegen
vext typegen --check
vext typegen --write-manifest
vext typegen --services --root ./examples/hello-world
```

### 适用边界

- `typegen` 整体仍属于 **tooling-only** 能力，不会进入 `vext start` 的 runtime 主路径；
- `vext dev` 会在 preflight 中自动执行基础 `typegen`，`vext build` 也会在可选 typecheck 与编译前刷新 generated 声明和 manifest；
- TypeScript 语义诊断默认在 ready / reload 后异步输出；如果希望像旧行为一样阻塞启动或重载，可使用 `--strict-preflight` 或 `VEXT_DEV_STRICT_PREFLIGHT=1`；
- TS 项目优先输出高质量类型，JS 项目允许退化到 `import(...).default` / `unknown`，但命令本身仍可用；
- `--write-manifest` 会把 service 索引、`app.extend()` / `defineAppExtensions<{ ... }>()` 聚合结果与服务依赖图摘要写入 `.vext/manifest/services.json`；
- 更多 generated 声明示例可结合 [服务](./services) 与 [插件](./plugins) 文档查看。

## `vext doctor routes` — 静态路由诊断（experimental）

扫描 `src/routes/` 中的静态路由元数据，输出重复路由、缺失 `docs.summary`、自动推断 `operationId` 等诊断，并可将结果落盘到 inspect / manifest 产物中。

### 用法

```bash
vext doctor <target> [options]
```

### Targets

| Target   | 说明                                         |
| -------- | -------------------------------------------- |
| `routes` | 扫描静态路由元数据与 OpenAPI 相关字段        |
| `all`    | 当前仍是 `routes` 的别名，用于保留后续扩展位 |

### 选项

| 选项               | 说明                                | 默认值   |
| ------------------ | ----------------------------------- | -------- |
| `--json`           | 输出机器可读 JSON                   | `false`  |
| `--write-inspect`  | 写入 `.vext/inspect/routes.json`    | `false`  |
| `--write-manifest` | 写入 `.vext/manifest/routes.json`   | `false`  |
| `--refresh`        | 跳过缓存 manifest，重新扫描路由诊断 | `false`  |
| `--root <path>`    | 指定项目根目录                      | 当前目录 |
| `-C <path>`        | `--root` 别名                       | —        |
| `-h, --help`       | 显示帮助                            | —        |

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

- 当前 route manifest 与 services manifest 仍分层维护，不合并为单一总 manifest；
- `docs.operationId` 缺失时，doctor 会按 runtime 行为给出 `auto-operation-id` 信息提示，而不是误报 warning；
- 路由侧仍由 `doctor routes --write-manifest` 负责；service 侧则由 `typegen --write-manifest` 负责。

## `vext start` — 生产模式启动

以生产模式启动项目。TypeScript 项目从 `dist/` 目录加载编译后的代码，需要先执行 `vext build`；如果缺少有效构建产物，命令会直接失败并提示使用 `vext build` 或开发期改用 `vext dev`。

### 用法

```bash
vext start [options]
```

### 选项

| 选项                         | 说明                                     | 默认值         |
| ---------------------------- | ---------------------------------------- | -------------- |
| `--port <number>`            | 指定端口                                 | 配置文件中的值 |
| `--host <address>`           | 指定监听地址                             | 配置文件中的值 |
| `--port-conflict <strategy>` | 端口冲突策略（`error/prompt/kill/next`） | `error`        |
| `--startup-profile`          | 输出生产启动阶段摘要与详细耗时           | —              |
| `--startup-profile-json <p>` | 将生产启动阶段耗时写入 JSON 文件         | —              |
| `--verbose-lifecycle`        | 输出详细生命周期日志                     | —              |
| `-h, --help`                 | 显示帮助                                 | —              |

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

# 加载 production 配置
PORT=8080 NODE_ENV=production vext start

# 加载自定义环境配置（需存在 src/config/sg-sit.ts）
NODE_ENV=sg-sit vext start
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
    workers: "auto", // 自动检测 CPU 核数
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
2. 应用项目根目录中的 `preload/`

在子进程启动前，这些脚本会统一通过 `--import` 注入。例如 `vextjs-opentelemetry` 可利用包级 `vext.preload` 在应用代码加载前自动初始化 OpenTelemetry SDK；应用项目本身也可以直接在根目录 `preload/` 中放置脚本做启动前环境桥接。

首期项目级 preload 规则：

- 目录固定为项目根 `preload/`
- 非递归扫描
- 项目级 preload 先执行，包级 preload 后执行
- `.mjs` / `.js` 直接注入
- `.ts` / `.mts` 会在启动前编译到 `.vext/preload/*.mjs` 再注入
- `vext dev` 下若 `preload/` 里的文件发生变化，会触发 cold restart

详见 [预加载 (Preload)](/guide/preload)。

### 启动期配置 Provider

如果项目存在 `src/config/bootstrap.ts`，`vext start` / `vext dev` 会在配置 validate / freeze 前执行其中声明的 `bootstrap config provider`，并将 provider 返回的 patch 合并到最终配置中。优先级为：`default < env < local < provider < CLI`。

Cluster 模式下，Master 会把本轮 provider patch 传递给 Worker 复用，避免同一启动周期内 Master / Worker 看到不同远程配置。

### package.json 脚本

推荐在跨平台项目中使用 `cross-env` 设置环境变量：

```bash
npm i -D cross-env
```

```json
{
  "scripts": {
    "build": "vext build",
    "start": "cross-env NODE_ENV=production vext start",
    "start:sg-sit": "cross-env NODE_ENV=sg-sit vext start",
    "start:us-uat": "cross-env NODE_ENV=us-uat vext start"
  }
}
```

Vext 本身不内置 `cross-env`；它只是推荐的脚本层兼容工具，用于在 Windows、macOS、Linux 下统一设置 `NODE_ENV`。

:::tip 环境文件选择
当前 `vext start` 没有 `--config <file>` 这样的参数。环境配置文件的选择机制是：

- 读取运行时 `NODE_ENV`
- 匹配 `src/config/{NODE_ENV}.ts`（build 后对应 `dist/config/{NODE_ENV}.js`）

如果你需要 `sg-sit.ts`、`us-uat.ts` 这类自定义环境，只需在启动时设置对应的 `NODE_ENV`。
:::

## `vext stop` — 停止服务

停止正在运行的 Cluster 模式服务。通过读取 PID 文件发送停止信号。

### 用法

```bash
vext stop [options]
```

### 选项

| 选项                | 说明                | 默认值      |
| ------------------- | ------------------- | ----------- |
| `--pid-file <path>` | PID 文件路径        | `.vext.pid` |
| `--force`           | 强制终止（SIGKILL） | `false`     |
| `-h, --help`        | 显示帮助            | —           |

### 示例

```bash
# 优雅停止
vext stop

# 强制停止
vext stop --force

# 指定 PID 文件
vext stop --pid-file /var/run/myapp.pid
```

:::info
`vext stop` 仅在 Cluster 模式下可用。单进程模式下直接使用 `Ctrl+C` 或发送 `SIGTERM` 信号即可优雅关闭。
:::

## `vext reload` — 滚动重启

触发 Cluster 模式的零停机滚动重启（Rolling Restart）。逐个重启 Worker 进程，确保服务始终可用。

### 用法

```bash
vext reload [options]
```

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
1. 向 Master 进程发送 SIGUSR2 信号
2. Master 逐个重启 Worker：
   a. 启动新 Worker
   b. 等待新 Worker ready
   c. 优雅关闭旧 Worker
   d. 重复，直到所有 Worker 更新完成
3. 整个过程中始终有 Worker 处理请求，零停机
```

:::tip 适用场景
代码更新后执行 `vext build` + `vext reload`，无需停机即可完成版本更新。适合需要高可用性的生产环境。
:::

## `vext status` — 查看运行状态

查看 Cluster 模式下的服务运行状态，包括 Master 进程和各 Worker 进程的信息。

### 用法

```bash
vext status [options]
```

### 选项

| 选项                | 说明         | 默认值      |
| ------------------- | ------------ | ----------- |
| `--pid-file <path>` | PID 文件路径 | `.vext.pid` |
| `-h, --help`        | 显示帮助     | —           |

### 示例

```bash
vext status
```

### 输出示例

```
VextJS Cluster Status

Master PID: 12345
Workers: 4/4 running
Uptime: 2d 5h 32m

  PID     State    CPU    Memory    Requests
  12346   online   2.1%   48 MB     125,432
  12347   online   1.8%   52 MB     124,891
  12348   online   2.3%   47 MB     126,003
  12349   online   1.9%   50 MB     125,720
```

## 全局选项

所有命令都支持以下全局选项：

| 选项            | 说明         |
| --------------- | ------------ |
| `-h, --help`    | 显示帮助信息 |
| `-v, --version` | 显示版本号   |

```bash
# 查看版本
vext --version
# 输出: vextjs v0.3.22

# 查看帮助
vext --help
```

## 推荐的 package.json 脚本

```json
{
  "name": "my-app",
  "type": "module",
  "scripts": {
    "dev": "vext dev",
    "build": "vext build",
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

需要先执行 `vext build` 编译 TypeScript 代码。`vext start` 从 `dist/` 加载编译后的 JavaScript 文件。

### 开发时应该用 `vext dev` 还是 `vext start`？

日常开发使用 `vext dev`，它直接加载 `src/` 下的 TypeScript 文件，支持热重载，无需手动编译。`vext start` 用于生产环境。

### 如何指定 Node.js 版本？

VextJS 要求 Node.js >= 20.19.0。推荐在项目根目录创建 `.node-version` 或 `.nvmrc` 文件指定版本：

```bash
echo "22" > .node-version
```

### `vext stop` / `vext reload` / `vext status` 不工作？

这三个命令仅在 Cluster 模式下可用。确保配置中启用了 `cluster.enabled: true` 或使用了 `VEXT_CLUSTER=1` 环境变量，且服务通过 `vext start` 启动。

## 下一步

- 了解 [热重载](/guide/hot-reload) 的三层策略细节
- 学习 [Cluster 多进程](/guide/cluster) 的完整配置
- 查看 [配置](/guide/configuration) 中端口、日志等选项
- 探索 [项目结构](/guide/project-structure) 的约定
