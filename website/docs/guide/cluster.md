# Cluster 多进程

VextJS 内置 **Cluster 多进程管理**，通过 `ClusterMaster` 管理多个 Worker 进程，充分利用多核 CPU，并支持零停机滚动重启、心跳检测、自动故障恢复等企业级特性。

## 快速开始

### 通过配置启用

```typescript
// src/config/default.ts
export default {
  port: 3000,
  cluster: {
    enabled: true,
    workers: 'auto',  // 自动检测 CPU 核数
  },
};
```

### 通过环境变量启用

无需修改配置文件，设置 `VEXT_CLUSTER=1` 即可开启 Cluster 模式：

```bash
VEXT_CLUSTER=1 vext start
```

### 启动效果

```bash
$ vext start
[vextjs] Cluster master started (PID: 12345)
[vextjs] Spawning 4 workers...
[vextjs] Worker 1 (PID: 12346) ready
[vextjs] Worker 2 (PID: 12347) ready
[vextjs] Worker 3 (PID: 12348) ready
[vextjs] Worker 4 (PID: 12349) ready
[vextjs] All 4 workers ready, listening on port 3000
```

## 架构概览

```
                    ┌──────────────────┐
                    │  Master Process  │
                    │  (ClusterMaster) │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
        ┌─────┴─────┐ ┌─────┴─────┐ ┌─────┴─────┐
        │  Worker 1  │ │  Worker 2  │ │  Worker 3  │
        │ (HTTP App) │ │ (HTTP App) │ │ (HTTP App) │
        └───────────┘ └───────────┘ └───────────┘
```

- **Master 进程**：不处理 HTTP 请求，负责管理 Worker 进程的生命周期
- **Worker 进程**：每个 Worker 运行一个完整的 VextJS 应用实例，独立处理 HTTP 请求
- **IPC 通信**：Master 和 Worker 之间通过 Node.js 内置的进程间通信（IPC）交换消息

## 配置选项

在 `config/default.ts` 中配置 Cluster 相关选项：

```typescript
export default {
  cluster: {
    // 是否启用 Cluster 模式
    enabled: true,

    // Worker 数量
    // 'auto'   — 等于 CPU 核数（默认推荐）
    // 'auto-1' — 等于 CPU 核数 - 1（为 Master 预留一个核心）
    // number   — 固定数量
    workers: 'auto',

    // Worker 崩溃时自动重启
    autoRestart: true,

    // 时间窗口内最大重启次数（超过则停止重启，防止无限崩溃循环）
    maxRestarts: 5,

    // 重启计数窗口（毫秒）
    restartWindow: 60000,

    // 重启基础延迟（毫秒，指数退避）
    restartBaseDelay: 1000,

    // 重启最大延迟（毫秒）
    restartMaxDelay: 30000,

    // Worker 心跳检测配置
    healthCheck: {
      enabled: true,        // 是否启用心跳检测
      interval: 15000,      // 探测间隔（毫秒）
      timeout: 30000,       // 心跳超时（毫秒）
    },

    // 零停机滚动重启配置
    reload: {
      workerDelay: 2000,      // 替换下一个 Worker 前的等待时间（毫秒）
      readyTimeout: 30000,    // Worker 就绪超时（毫秒）
      shutdownTimeout: 10000, // Worker 关闭超时（毫秒）
    },

    // PID 文件路径（用于 vext stop / vext reload 定位进程）
    pidFile: '.vext.pid',

    // Worker 进程标题前缀
    titlePrefix: 'vext',

    // sticky session 模式（'none' | 'ip'）
    // 'none' — 不启用（默认）
    // 'ip'   — 基于客户端 IP 分配固定 Worker（WebSocket / SSE 场景）
    sticky: 'none',
  },
};
```

### Worker 数量策略

| 值 | 含义 | 适用场景 |
|-----|------|---------|
| `'auto'` | CPU 核数 | 生产环境（默认推荐） |
| `'auto-1'` | CPU 核数 - 1 | 单机混部（为 Master 预留一个核心） |
| `2` | 固定 2 个 Worker | 开发环境测试 Cluster |
| `1` | 固定 1 个 Worker | 调试 Cluster 逻辑 |

```typescript
// 生产环境：充分利用所有 CPU 核心
cluster: { workers: 'auto' }

// 单机混部：保留一个核心给系统 / Master 进程
cluster: { workers: 'auto-1' }

// 开发测试：固定 2 个 Worker
cluster: { workers: 2 }
```

## CLI 命令

VextJS CLI 提供了完整的 Cluster 管理命令：

### `vext start` — 启动

```bash
# 普通模式启动
vext start

# Cluster 模式启动（通过环境变量）
VEXT_CLUSTER=1 vext start

# 指定端口
vext start --port 8080
```

如果配置中 `cluster.enabled: true` 或设置了 `VEXT_CLUSTER=1`，`vext start` 会自动以 Cluster 模式启动。

### `vext stop` — 停止

```bash
# 停止正在运行的 Cluster
vext stop
```

`vext stop` 通过读取 PID 文件（默认 `.vext.pid`）找到 Master 进程，发送 `SIGTERM` 信号触发优雅关闭。

关闭流程：

1. Master 收到 `SIGTERM`
2. Master 向所有 Worker 发送关闭指令
3. 每个 Worker 执行 `onClose` 钩子（关闭数据库连接等）
4. Worker 停止接受新请求，等待现有请求完成
5. 超时后强制退出（由 `shutdown.timeout` 控制）
6. 所有 Worker 退出后，Master 退出
7. PID 文件自动删除

### `vext reload` — 滚动重启

```bash
# 零停机滚动重启
vext reload
```

`vext reload` 执行**零停机滚动重启**（Rolling Restart）：

1. Master 收到 reload 信号
2. 逐个重启 Worker（而非一次性全部重启）
3. 新 Worker 启动并就绪后，再关闭旧 Worker
4. 依次处理所有 Worker
5. 整个过程中始终有 Worker 在服务请求

```
Worker 1: [运行中] → [关闭] → [重启] → [就绪] ✅
Worker 2:                [运行中] → [关闭] → [重启] → [就绪] ✅
Worker 3:                               [运行中] → [关闭] → [重启] → [就绪] ✅
```

适用场景：

- 部署新版本代码后，无需停机即可让新代码生效
- 更新配置后重载
- 热修复

:::warning 前提条件
`vext reload` 要求 `cluster.reload` 已配置（默认启用）。如需禁用滚动重启，移除 `reload` 配置项即可。
:::

### `vext status` — 查看状态

```bash
# 查看 Cluster 运行状态
vext status
```

输出示例：

```
Cluster Status
──────────────────────────────
Master PID:  12345
Workers:     4 / 4 (all healthy)
Uptime:      2h 35m 12s

Worker  PID    Status   Uptime      Requests
  1     12346  healthy  2h 35m 12s  45,230
  2     12347  healthy  2h 35m 11s  44,891
  3     12348  healthy  2h 35m 10s  45,102
  4     12349  healthy  2h 35m 09s  44,975
```

## 自动故障恢复

### Worker 崩溃重启

当 `autoRestart: true`（默认）时，Worker 崩溃后 Master 会自动重启：

```
[vextjs] Worker 3 (PID: 12348) exited unexpectedly (code: 1)
[vextjs] Restarting Worker 3... (restart 1/10 in 60s window)
[vextjs] Worker 3 (PID: 12350) ready
```

### 指数退避

连续崩溃时，重启延迟逐步增加（指数退避），避免频繁重启消耗系统资源：

```
第 1 次重启: 延迟 1s  (restartBaseDelay)
第 2 次重启: 延迟 2s
第 3 次重启: 延迟 4s
第 4 次重启: 延迟 8s
...
最大延迟:    30s (restartMaxDelay)
```

### 崩溃循环保护

如果在 `restartWindow`（默认 60 秒）内重启次数达到 `maxRestarts`（默认 5 次），Master 将停止重启并输出告警：

```
[vextjs] ⚠️ Worker 3 has restarted 5 times in 60s, stopping auto-restart
[vextjs] Please investigate the root cause before manually restarting
```

这防止了有 Bug 的代码导致无限崩溃-重启循环。

### 心跳检测

当 `healthCheck.enabled: true`（默认）时，Master 每隔 `healthCheck.interval`（默认 15 秒）向 Worker 发送心跳探测。如果 Worker 在 `healthCheck.timeout`（默认 30 秒）内未响应（可能死锁或阻塞），Master 会强制杀死并重启该 Worker：

```
[vextjs] Worker 2 (PID: 12347) heartbeat timeout, killing...
[vextjs] Worker 2 (PID: 12347) force killed
[vextjs] Restarting Worker 2...
[vextjs] Worker 2 (PID: 12351) ready
```

## PID 文件

Cluster 模式启动时，Master 进程会写入 PID 文件（默认 `.vext.pid`），用于 `vext stop` / `vext reload` / `vext status` 命令定位进程。

```
# .vext.pid 内容
12345
```

PID 文件在以下时机自动管理：

- **创建**：Master 启动时
- **删除**：Master 正常退出时
- **检测**：启动时检测是否已有运行中的 Cluster

```bash
# 自定义 PID 文件路径
cluster: { pidFile: '/var/run/myapp.pid' }
```

:::tip
将 `.vext.pid` 添加到 `.gitignore`，避免提交到版本控制。
:::

## 与优雅关闭的配合

Cluster 模式下的优雅关闭流程：

```
SIGTERM/SIGINT
    ↓
Master 收到信号
    ↓
Master 向所有 Worker 发送 shutdown 消息
    ↓
每个 Worker:
  1. 停止接受新连接
  2. 等待处理中的请求完成
  3. 执行所有 onClose 钩子（LIFO 顺序）
     - 关闭数据库连接
     - 刷新日志缓冲
     - 清理临时资源
  4. Worker 退出
    ↓
所有 Worker 退出后，Master 退出
PID 文件自动删除
```

超时控制：

- Worker 级超时由 `shutdown.timeout`（默认 10 秒）控制
- 超时后 Worker 被强制终止（`SIGKILL`）

```typescript
export default {
  shutdown: {
    timeout: 15000,  // 15 秒超时
  },
  cluster: {
    enabled: true,
    workers: 'auto',
  },
};
```

## 按环境配置

```typescript
// src/config/default.ts — 默认不启用 Cluster
export default {
  port: 3000,
  // cluster 不配置，默认禁用
};
```

```typescript
// src/config/production.ts — 生产环境启用
export default {
  cluster: {
    enabled: true,
    workers: 'auto',
    autoRestart: true,
    healthCheck: { enabled: true },
    reload: { workerDelay: 2000 },
  },
};
```

```typescript
// src/config/development.ts — 开发环境显式禁用
export default {
  cluster: {
    enabled: false,
    // 开发模式使用 vext dev（热重载），不需要 Cluster
  },
};
```

:::tip
开发环境推荐使用 `vext dev`（热重载模式）而非 Cluster 模式。Cluster 主要用于生产环境的多核利用和高可用。
:::

## 进程间通信

Master 和 Worker 之间通过 IPC 消息通信。VextJS 定义了标准化的消息协议：

### Worker → Master 消息

| 消息类型 | 说明 |
|---------|------|
| `worker:ready` | Worker 初始化完成，开始接受请求 |
| `worker:heartbeat` | 心跳响应 |
| `worker:metrics` | Worker 上报运行指标（请求数、内存等） |
| `worker:request-restart` | Worker 请求自身重启（如检测到内存泄漏） |

### Master → Worker 消息

| 消息类型 | 说明 |
|---------|------|
| `master:set-title` | 设置 Worker 进程标题 |
| `master:shutdown` | 通知 Worker 优雅关闭 |
| `master:health-check` | 心跳探测 |
| `master:broadcast` | 广播消息到所有 Worker |

## 与 Docker 部署

在 Docker 容器中使用 Cluster 模式时的注意事项：

### Dockerfile 示例

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY dist/ ./dist/

# 使用 SIGTERM 信号（Docker 默认）
STOPSIGNAL SIGTERM

# 启动 Cluster 模式
ENV VEXT_CLUSTER=1
CMD ["node", "dist/lib/bootstrap.js"]
```

### 建议

- **Worker 数量**：Docker 容器中建议根据分配的 CPU 资源设置 `workers`，而非使用 `'auto'`（`'auto'` 会检测宿主机的全部 CPU 核心数）
- **PID 文件**：容器中 PID 文件路径无需特别配置，使用默认的 `.vext.pid` 即可
- **优雅关闭**：确保 Docker 的 `stop_grace_period` 大于 VextJS 的 `shutdown.timeout`
- **单容器多进程**：Cluster 模式在单容器中运行多个 Worker 是合理的做法，但如果使用 Kubernetes 等编排工具，也可以选择单进程模式 + 多 Pod 副本

```yaml
# docker-compose.yml
services:
  api:
    build: .
    environment:
      - VEXT_CLUSTER=1
      - NODE_ENV=production
    ports:
      - "3000:3000"
    stop_grace_period: 30s  # 大于 shutdown.timeout
```

## 常见问题

### Cluster 模式下 WebSocket / SSE 需要注意什么？

长连接（WebSocket、SSE）在 Cluster 模式下需要考虑 sticky session，确保同一客户端的连接始终路由到同一个 Worker。可以通过 `cluster.sticky: true` 启用。

### Worker 数量设多少合适？

- **CPU 密集型**：设置为 CPU 核数（`'auto'`）
- **I/O 密集型**：可以设置为 CPU 核数的 1-2 倍
- **混合负载**：从 CPU 核数开始，根据实际监控数据调整

### 如何监控各 Worker 的状态？

使用 `vext status` 命令查看各 Worker 的运行状态、PID、存活时间和请求计数。在生产环境中，建议配合 Prometheus 或其他监控工具收集更详细的指标。

### 与 PM2 有何区别？

VextJS 内置的 Cluster 管理针对框架特性深度集成（如与 `onClose` 钩子、配置系统、热重载的协作），提供了零配置的开箱即用体验。PM2 是一个通用的进程管理器，功能更广泛但与框架的集成度不如内置方案。两者可以配合使用（PM2 管理 Master 进程），但通常不需要。

## 下一步

- 了解 [CLI 命令](/guide/cli) 中 Cluster 相关的命令详解
- 查看 [配置](/guide/configuration) 中 Cluster 的完整配置项
- 学习 [热重载](/guide/hot-reload) 与 Cluster 的关系
- 探索 [测试](/guide/testing) 中 Cluster 相关的测试方法