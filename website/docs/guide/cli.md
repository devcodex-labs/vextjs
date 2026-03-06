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

| 命令 | 说明 | 常用场景 |
|------|------|---------|
| `vext create <name>` | 创建新项目 | 项目初始化 |
| `vext dev` | 开发模式启动 | 日常开发 |
| `vext build` | 构建项目 | 部署前构建 |
| `vext start` | 生产模式启动 | 生产部署 |
| `vext stop` | 停止服务 | Cluster 模式管理 |
| `vext reload` | 滚动重启 | 零停机更新 |
| `vext status` | 查看运行状态 | Cluster 状态监控 |

## `vext create` — 创建项目

交互式创建新的 VextJS 项目，自动生成项目骨架和配置文件。

### 用法

```bash
npx vextjs create <project-name> [options]
```

### 选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--adapter <name>` | 指定 Adapter（native / hono / fastify / express / koa） | `native` |
| `--js` | 创建 JavaScript 项目（而非 TypeScript） | `false` |
| `--skip-install` | 跳过 `npm install` | `false` |
| `-h, --help` | 显示帮助 | — |

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
├── src/
│   ├── config/
│   │   └── default.ts        # 默认配置
│   ├── routes/
│   │   └── index.ts          # 示例路由
│   └── services/
│       └── example.ts        # 示例服务
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

## `vext dev` — 开发模式

以开发模式启动项目，支持文件监听和智能热重载。

### 用法

```bash
vext dev [options]
```

### 选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--port <number>` | 指定端口 | 配置文件中的值 |
| `--host <address>` | 指定监听地址 | 配置文件中的值 |
| `-h, --help` | 显示帮助 | — |

### 示例

```bash
# 使用配置文件中的默认设置
vext dev

# 指定端口
vext dev --port 8080

# 指定地址和端口
vext dev --host 127.0.0.1 --port 8080
```

### 热重载策略

`vext dev` 提供三层热重载策略，自动选择最优方式：

| 层级 | 触发条件 | 行为 | 速度 |
|------|---------|------|------|
| **Tier 1** — 路由热替换 | `src/routes/` 文件变更 | 原子替换请求处理器，零中断 | ⚡ 毫秒级 |
| **Tier 2** — 服务重载 | `src/services/` 或 `src/locales/` 文件变更 | 重建受影响的服务实例 | ⚡ 毫秒级 |
| **Tier 3** — 冷重启 | `src/config/` 或 `src/plugins/` 文件变更 | 完整重启进程 | 🔄 秒级 |

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

将 TypeScript 源码编译为 JavaScript，生成生产可用的 `dist/` 目录。

### 用法

```bash
vext build [options]
```

### 选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-h, --help` | 显示帮助 | — |

### 示例

```bash
# 构建项目
vext build

# 构建后启动
vext build && vext start
```

### 构建行为

- 使用 esbuild 进行极速编译（TypeScript → JavaScript）
- 输出目录：`dist/`
- 保持源码目录结构
- 生成 `.js` 和 `.d.ts` 文件

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

## `vext start` — 生产模式启动

以生产模式启动项目。从 `dist/` 目录加载编译后的代码，需要先执行 `vext build`。

### 用法

```bash
vext start [options]
```

### 选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--port <number>` | 指定端口 | 配置文件中的值 |
| `--host <address>` | 指定监听地址 | 配置文件中的值 |
| `-h, --help` | 显示帮助 | — |

### 示例

```bash
# 先构建，再启动
vext build
vext start

# 指定端口
vext start --port 8080

# 使用环境变量
PORT=8080 NODE_ENV=production vext start
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
    workers: 'auto',  // 自动检测 CPU 核数
  },
};
```

或通过环境变量启用：

```bash
VEXT_CLUSTER=1 vext start
```

### package.json 脚本

```json
{
  "scripts": {
    "start": "vext start",
    "build": "vext build",
    "prestart": "vext build"
  }
}
```

## `vext stop` — 停止服务

停止正在运行的 Cluster 模式服务。通过读取 PID 文件发送停止信号。

### 用法

```bash
vext stop [options]
```

### 选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--pid-file <path>` | PID 文件路径 | `.vext.pid` |
| `--force` | 强制终止（SIGKILL） | `false` |
| `-h, --help` | 显示帮助 | — |

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

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--pid-file <path>` | PID 文件路径 | `.vext.pid` |
| `-h, --help` | 显示帮助 | — |

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

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--pid-file <path>` | PID 文件路径 | `.vext.pid` |
| `-h, --help` | 显示帮助 | — |

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

| 选项 | 说明 |
|------|------|
| `-h, --help` | 显示帮助信息 |
| `-v, --version` | 显示版本号 |

```bash
# 查看版本
vext --version
# 输出: vextjs v0.1.4

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

VextJS 要求 Node.js >= 18.0.0。推荐在项目根目录创建 `.node-version` 或 `.nvmrc` 文件指定版本：

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