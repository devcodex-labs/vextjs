# Cluster 多进程

VextJS 通过一个 Master 管理多个 HTTP Worker。每个 Worker 有独立应用实例，监听同一服务端口；Master 负责启动、故障替换、心跳检查和滚动重启。

先完成双 Worker 启动与请求验证，再调整数量和恢复策略。开发热重载见[热重载](/zh/guide/hot-reload)，生产构建前置步骤见[构建](/zh/guide/build)。

## 快速开始

### 通过配置启用

使用已安装依赖的 TypeScript API 项目，例如 [CLI 页的脚手架](/zh/guide/cli#从创建到生产启动)。在现有生产配置对象中合并以下项，保留业务配置：

```typescript
// src/config/production.ts
import type { VextConfigOverride } from "vextjs";

export default {
  port: 3000,
  cluster: {
    enabled: true,
    workers: 2,
  },
} satisfies VextConfigOverride;
```

新增一个仅供验证的路由：

```typescript
// src/routes/worker-info.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", async (_req, res) => {
    res.json({ pid: process.pid, workerId: process.env.VEXT_WORKER_ID });
  });
});
```

停止同项目的 dev 服务后，在项目根执行：

```bash
npx vextjs build --typecheck
npx vextjs start --port 3000 --verbose-lifecycle
```

应看到两个 Worker 各自 ready，最终汇总 `workers=2/2`。首个 Worker 启动失败会终止启动；后续 Worker 失败可能以不足目标数量的状态继续，所以需检查实际 ready 数。

### 启动效果与请求验证

另开终端，多次建立新请求：

```bash
curl -i -H "Connection: close" http://127.0.0.1:3000/worker-info
curl -i -H "Connection: close" http://127.0.0.1:3000/worker-info
npx vextjs status --port 3000
```

请求应为 HTTP 200，`data.pid` / `data.workerId` 来自实际处理该请求的 Worker。结合详细启动日志确认两个 Worker 就绪；连接调度不保证两次请求一定轮流命中不同 Worker，因此不能只用两次返回值判断容量。

检查项目根生成的 `.vext.pid`：它记录 Master PID，不是 HTTP Worker PID。`status` 的能力边界见下文。验证后通过前台 Ctrl+C 关闭，Unix/macOS 也可在另一终端执行 `npx vextjs stop`，并核实进程、端口和 PID 文件状态。示例诊断路由按项目需要保留或移除。

### 通过环境变量启用

`VEXT_CLUSTER=1` 也能启用 Cluster，Worker 数量仍由配置控制。它会覆盖未启用的配置；设置为 0 不会反向禁用已配置的 `cluster.enabled: true`。

```bash
# Bash / 类 Unix shell
VEXT_CLUSTER=1 npx vextjs start
```

```powershell
$env:VEXT_CLUSTER = "1"
npx vextjs start
Remove-Item Env:VEXT_CLUSTER
```

:::tip 配置一致性
Master 先加载配置并进行端口预检，将本次 bootstrap config provider 的 patch 传给 Worker 复用。每个 Worker 仍执行自己的应用初始化；不要据此把插件副作用当作只执行一次。
:::

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

在 `src/config/production.ts` 等选定 profile 中配置 Cluster。以下列出当前默认参数，并显式开启 Cluster；一般只需覆盖需要修改的字段：

```typescript
import type { VextConfigOverride } from "vextjs";

export default {
  cluster: {
    // 是否启用 Cluster 模式
    enabled: true,

    // Worker 数量
    // 'auto'   — 等于检测到的可用 CPU 数（默认）
    // 'auto-1' — 检测到的可用 CPU 数 - 1，至少 1，不绑定核心
    // number   — 固定数量
    workers: "auto",

    // Worker 崩溃时自动重启
    autoRestart: true,

    // 整个 Master 的自动重启窗口预算，第 N+1 次触发限流
    maxRestarts: 5,

    // 重启计数窗口（毫秒）
    restartWindow: 60000,

    // 重启基础延迟（毫秒，指数退避）
    restartBaseDelay: 1000,

    // 重启最大延迟（毫秒）
    restartMaxDelay: 30000,

    // Worker 堆内存阈值（字节；默认 1 GiB）
    memoryThreshold: 1024 * 1024 * 1024,

    // Worker 心跳检测配置
    healthCheck: {
      enabled: true, // 是否启用心跳检测
      interval: 15000, // Master 检查 lastHeartbeat 的间隔（毫秒）
      timeout: 30000, // 心跳超时（毫秒）
    },

    // 滚动替换与 Worker 启停等待配置
    reload: {
      workerDelay: 2000, // 替换下一个 Worker 前的等待时间（毫秒）
      readyTimeout: 30000, // Worker 就绪超时（毫秒）
      shutdownTimeout: 10000, // Worker 关闭超时（毫秒）
    },

    // PID 文件路径（用于 vext stop / vext reload 定位进程）
    pidFile: ".vext.pid",

    // Worker 进程标题前缀
    titlePrefix: "vext",

    // sticky session 模式（'none' | 'ip'）
    // 'none' — 不启用（默认）
    // 'ip'   — 当前仅影响调度策略分支，不提供 IP 粘性分配保证
    sticky: "none",
  },
} satisfies VextConfigOverride;
```

### Worker 数量策略

| 值         | 实际规则                     | 使用考虑                      |
| ---------- | ---------------------------- | ----------------------------- |
| `"auto"`   | 检测到的可用 CPU 数，最多 64 | 按实际容器与主机结果核实      |
| `"auto-1"` | 检测值减 1，至少 1           | 只减少数量，不做 CPU 核心绑定 |
| 正整数     | 数值限制在 1～64             | 双 Worker 验证可使用 2        |

请使用有效正整数，不依赖越界值兜底。CPU 检测先尝试 `os.availableParallelism()`，失败后才按 Linux cgroup v1 与 `os.cpus()` 降级；不要认为它必然精确对应所有容器 CPU quota。

每增加一个 Worker 都会增加应用实例、数据库连接池、缓存和堆内存占用。根据请求负载、内存和外部连接限额确定数量，并以实际压测验证，不能仅按 CPU 倍数保证吞吐。

### 状态与多进程边界

Worker 之间不共享普通变量、Service 实例或内存 Store。需要全局一致的数据，应选择具有共享语义的存储；例如内存限流是各 Worker 独立计数，不能视为全局配额，见[限流](/zh/guide/rate-limit)。Session 与缓存的共享方式同样需按对应 Store 设计。

`sticky: "ip"` 虽在类型中可配置，当前 Master 只据此选择 Node 调度策略，没有实现按客户端 IP 映射 Worker。不要用它作为会话一致性或 WebSocket/SSE 重连保持状态的依据。

## CLI 命令

VextJS CLI 提供了完整的 Cluster 管理命令：

### `vext start` — 启动

```bash
# 普通模式启动
npx vextjs start

# Cluster 模式启动（通过环境变量）
VEXT_CLUSTER=1 npx vextjs start

# 指定端口
npx vextjs start --port 8080
```

如果配置中 `cluster.enabled: true` 或设置了 `VEXT_CLUSTER=1`，`vext start` 会自动以 Cluster 模式启动。

### `vext stop` — 停止

```bash
npx vextjs stop
# 自定义 PID 文件时，控制命令也需显式使用相同路径
npx vextjs stop --pid-file .vext/app.pid
```

命令读取 PID 文件并发送 SIGTERM，最多等待 Master 退出 30 秒。正常 Master 关闭流程通知 Worker 停止接收请求、等待处理和清理、退出后清理 PID 文件。超时返回非零不代表进程已经停止。

Windows 的外部进程终止不等同于 Unix 信号驱动的完整清理。通过前台 `vext start` 的 Ctrl+C，CLI 可经父子 IPC 请求关闭；独立 `vext stop` 或操作系统强制终止不能保证 onClose 执行。具体超时层次见[优雅关闭](#与优雅关闭的配合)。

### `vext reload` — 滚动重启

```bash
# Unix/macOS，指向目标 Master 的 PID 文件
npx vextjs reload
```

CLI 向 Master 发送 SIGHUP 后即返回；发送成功不等于所有 Worker 已替换完成。Master 对启动时记录的旧 Worker 逐个执行：

1. 启动新 Worker，等待 ready。
2. 新 Worker ready 后，通知对应旧 Worker 关闭。
3. 等待旧 Worker 退出；超时则强制终止。
4. 按 workerDelay 等待，再处理下一个。

```text
旧 Worker A：运行 ─────────────→ 排空/关闭
新 Worker A：     启动 → ready → 接收请求
                                 ↓
                        继续替换下一对 Worker
```

新 Worker 启动失败时保留旧 Worker，记录失败并继续其他替换。检查日志中的 `replaced/total` 以及实际请求，不能把出现 complete 字样当作全部成功。长连接、关闭超时、应用错误或资源不足仍可能导致中断；滚动策略不提供任意场景的零停机保证。

滚动替换不重新创建 Master。Worker 数量、Master 心跳/退避配置以及启动时取得的 provider patch 等不会因发送信号就整体刷新；修改这些设置应重新启动完整服务，并按部署流程切换流量。

:::warning 平台与构建条件
Windows 不支持当前 `vext reload` 的信号操作，命令会失败。TypeScript 应先成功构建可用产物，再执行部署更新。省略 `cluster.reload` 使用默认等待参数，并不禁用 reload。代码、配置和产物的更新方式需保证旧、新 Worker 都能读取一致版本。
:::

### `vext status` — 查看状态

```bash
# 查看 Cluster 运行状态
npx vextjs status
```

正常可显示 Master PID 和 PID 文件路径；随后尝试 `http://<host>:<port>/health`，默认 host 为 127.0.0.1、port 为 3000：

```text
Status: 🟢 running
  Master PID: 12345
  PID file:   <project>/.vext.pid
```

只有健康响应顶层包含 `pid` / `uptime` / `memory` 时，才追加对应详情。它不会解包 Vext 常规响应的 `data`，不会读取应用配置中的端口，也不会扫描全部 Worker。`/health` 需由应用提供；位于 `/api/health` 等其他路径时不适用这个固定探测。

例如，目标健康接口直接返回上述顶层字段时，输出可以为：

```text
Status: 🟢 running
  Master PID: 12345
  PID file:   .vext.pid
  Worker PID: 12346
  Uptime:     2h 35m 12s
  Heap Used:  64.0 MB
  RSS:        128.0 MB
```

这些数值仅示意一次健康请求返回的进程信息；本页默认包装响应的示例不会自动产生这些详情，也不能将它作为全部 Worker 的统计。

`status` 对 not running、stale、不可达等查询结果也可退出 0，不应直接作为部署健康门禁。使用 `--host`、`--port`、`--pid-file` 指向实际实例，并独立检查业务健康响应。

## 自动故障恢复

### Worker 崩溃重启

`autoRestart: true` 时，非主动关闭的 Worker 退出通常触发替换；ready 前的候选失败由对应启动或替换流程处理。新 Worker 有新的编号/PID，不是让原进程原地恢复。

常见日志形式如下，数值为示意：

```text
[cluster] worker 3 (pid: 12348) exited: code 1
[cluster] restarting worker in 1000ms...
```

Worker 内存、未完成请求及未持久化状态不会随进程自动恢复。

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

`restartWindow` 默认 60,000 毫秒，`maxRestarts` 默认 5。计数由整个 Master 共用，多个 Worker 的异常退出共同消耗预算；窗口内第 6 次触发时暂停该次自动重启。

```text
[cluster] ❌ restart rate exceeded (5 in 60000ms), pausing auto-restart
```

时间窗口过期不会自动启动一个补齐容量的定时任务。排查根因并明确恢复实例/容量；不能仅因 Master 进程还存在就认定所有 Worker 健康。全部 Worker 消失时，当前实现仅发出内部 all-workers-dead 事件，不能依赖它主动退出 Master 来触发外层重启；还需检查有效 Worker 数与业务请求。

### 心跳检测

Worker 默认每 10 秒自发发送 heartbeat。Master 在 `healthCheck.enabled: true` 时，每隔 interval（默认 15 秒）检查 ready Worker 的最后心跳时间；超过 timeout（默认 30 秒）会强制终止对应 Worker，后续是否替换还受 autoRestart 与重启预算控制。

这不是向 HTTP `/health` 发请求，也不是每 15 秒主动发送 IPC health-check。由于按间隔检查，检测时间不保证恰好在第 30 秒发生。

### 内存阈值

Worker 每 60 秒检查一次 heapUsed，默认阈值 1 GiB，可用 `cluster.memoryThreshold`（字节）调整。超限时该 Worker 仅发送一次 request-restart，请求 Master 先启动替代 Worker；它不会立即退出，也不是 RSS/容器总内存硬限制。

替换请求失败不能视为已经释放内存，应观察日志和实际进程。

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

```typescript
// 合并到选定 profile 的现有 cluster 对象中
cluster: {
  pidFile: ".vext/app.pid";
}
```

相对路径以启动工作目录解析。stop/reload/status 不会自动从应用配置读取该路径，请传相同的 `--pid-file`。异常强制终止可能留下旧文件；先核实其中 PID 对应的实际进程，避免以删除 PID 文件代替停止服务。

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

超时有独立的两层，注意单位：

| 配置                             | 单位     | 默认   | 控制范围                                                  |
| -------------------------------- | -------- | ------ | --------------------------------------------------------- |
| `shutdown.timeout`               | **秒**   | 10     | Worker 应用内部关闭总预算                                 |
| `cluster.reload.shutdownTimeout` | **毫秒** | 10,000 | Master 等待 Worker 退出的预算；整体关闭与滚动替换都会使用 |
| CLI stop 等待                    | 毫秒     | 30,000 | 控制命令等待 Master 退出的固定上限                        |

Master 等待到期可能 SIGKILL Worker，应用清理不能保证继续执行。为内部清理留足外层时间，例如：

```typescript
// 合并到已有生产配置
import type { VextConfigOverride } from "vextjs";

export default {
  shutdown: { timeout: 15 },
  cluster: {
    enabled: true,
    workers: 2,
    reload: { shutdownTimeout: 20000 },
  },
} satisfies VextConfigOverride;
```

关闭顺序更完整的说明见 [Hooks](/zh/guide/hooks)。强制终止或超时不能作为清理钩子已完成的证据。

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
    workers: "auto",
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

Master 和 Worker 之间通过内部 IPC 协议通信。下表用于理解运行机制，不是业务插件可以假定稳定的包根公共 API；应用不应手工发送 ready 来绕过真实初始化。

由 `vext start` 启动时，Windows CLI 会通过父子 IPC 向 Master 发送关闭请求；Master 将其交给同一优雅关闭流程，通知 Worker、等待退出并清理 PID 文件。操作系统外部直接终止进程与此流程不同，不保证执行关闭钩子。

下表中的消息类型是 IPC payload 中 `type` 字段的精确字符串字面量，不包含方向前缀。

### Worker → Master 消息

| 消息类型          | 说明                                                                            |
| ----------------- | ------------------------------------------------------------------------------- |
| `ready`           | Worker 初始化完成，开始接受请求                                                 |
| `heartbeat`       | 心跳响应                                                                        |
| `metrics`         | 每 30 秒上报内存等快照；无请求指标提供者时计数为占位 0，并带 metricsUnavailable |
| `request-restart` | Worker 请求自身重启（如检测到内存泄漏）                                         |

### Master → Worker 消息

| 消息类型       | 说明                                                          |
| -------------- | ------------------------------------------------------------- |
| `set-title`    | 设置 Worker 进程标题                                          |
| `shutdown`     | 通知 Worker 优雅关闭                                          |
| `health-check` | Worker 支持的即时心跳响应指令；当前定时检查依赖自发 heartbeat |
| `broadcast`    | 接收后当前仅打印 debug 日志，不自动触发业务事件或同步配置     |

这些消息由框架维护。请求指标占位不等于服务没有流量；生产监控应基于已接入的实际请求观测。

## 与 Docker 部署

### Dockerfile 示例

以下运行镜像示例要求 TypeScript API 项目已在构建阶段成功生成 dist、start 所需配置位于产物中，且没有额外运行资源。完整多阶段构建见[构建](/zh/guide/build)。JavaScript source 模式还需携带 src。

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
STOPSIGNAL SIGTERM
ENV VEXT_CLUSTER=1
CMD ["./node_modules/.bin/vext", "start", "--outdir", "dist"]
```

### 建议

- 保留 dist 内身份文件与生产依赖；自定义前端目录、工作区包和外部资源需另行携带。
- Worker 数量以容器实际 CPU、内存及连接配额验证，必要时使用显式数字。
- PID 路径需可写并且每实例独立。
- 容器停止宽限期应大于 Master 等待与应用清理所需时间。
- 若使用外层进程管理器或多个容器副本，要计算总 Worker 数，避免两层自动扩容意外叠加。

```yaml
# docker-compose.yml；应用配置或参数需实际监听 3000
services:
  api:
    build: .
    environment:
      - VEXT_CLUSTER=1
    ports:
      - "3000:3000"
    stop_grace_period: 30s
```

## Jobs 与 Cluster

HTTP cluster worker 默认不执行 Job，避免多个 HTTP worker 各自触发同一定时任务。HTTP、`vext job scheduler` 和 `vext job worker` 可作为独立进程部署；多个 scheduler/worker 的协作依赖共享 Job store 与 lease。进程拆分不自动提供 exactly-once 或业务幂等性，详见[任务与 Jobs](/zh/guide/jobs)。

## 常见问题

### Cluster 模式下 WebSocket / SSE 需要注意什么？

已建立的长连接由持有它的 Worker 处理，Worker 退出时仍可能断开。重连、跨请求状态、消息广播和关闭超时需单独设计；当前 `sticky: "ip"` 未实现 IP 粘性分配，不能据此保证同一客户端重新连接到原 Worker。是否支持具体协议还取决于适配器与应用实现。

### Worker 数量设多少合适？

先从可控数量验证，再依据 CPU、内存、响应延迟和数据库连接总量调整。每 Worker 都会初始化应用和连接池；`"auto-1"` 只是减少进程数，不为 Master 保留或绑定某个物理核心。

### 如何监控各 Worker 的状态？

使用 `vext status` 查看 Master PID、PID 文件状态，以及 `/health` 可达时的单个健康端点详情。当前命令不会输出 worker 表或请求数；生产环境建议配合 Prometheus 或其他监控工具收集更详细的多 Worker 指标。

### 与 PM2 有何区别？

Vext 内置 Master 负责本框架 Worker 的生命周期。若再由外部进程管理器托管，应明确它管理的是一个 Master 还是多个独立应用实例，并避免双层 Cluster 造成 Worker 数、PID 文件和关闭流程冲突。外层仍需负责 Master 自身退出后的恢复策略。

## 下一步

- 了解 [CLI 命令](/zh/guide/cli) 中 Cluster 相关的命令详解
- 查看 [配置](/zh/guide/configuration) 中 Cluster 的完整配置项
- 学习 [热重载](/zh/guide/hot-reload) 与 Cluster 的关系
- 探索 [测试](/zh/guide/testing) 中 Cluster 相关的测试方法
