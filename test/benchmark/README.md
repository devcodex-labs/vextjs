# vext 性能基准测试

> 主对照量化 Raw Native、Raw Fastify、Vext Native Core 与 Vext Native Normal；另保留 Native / Hono / Fastify / Express / Koa adapter matrix 用于横向观察。
> 支持多轮取中位数模式（`--rounds`），消除 Windows 系统噪声，获取可信数据。

## 🎯 目标

- **量化框架开销**：测量 vext adapter 层引入的 overhead
- **全框架覆盖**：测试 vext 支持的全部 5 个 adapter（Native / Hono / Fastify / Express / Koa）
- **多场景验证**：覆盖最常见的 API 使用模式

## ⚡ 最新结果与可比性

当前可引用的测量结果只在 [`RESULTS.md`](./RESULTS.md) 中。该文件由 runner 自动生成，并记录源码 SHA、worktree 状态、Node/OS/CPU/内存、Autocannon 版本、完整参数、每轮样本和 CV；不要把本 README 中的示例或其他机器的数值当作当前基准。

Native adapter 使用 Node.js 内置 `http.createServer` + `route-core` 轻量路由核心，是 vext 默认 adapter 且唯一不依赖第三方 HTTP 框架的实现。Benchmark 必须区分 `chain`（handler 内联业务链）、`middleware-chain`（真实 route-level middleware chain）、Core（私有最短路径）与 Normal（正式 bootstrap），避免把任意一者误读为默认运行时性能。

仅当源码身份、Node.js、OS/CPU、参数、场景和系统负载条件相同时，才可以把两份报告用作趋势或回归对比；跨机器/跨协议结果只能作为各自环境的局部观测。

## 📋 测试场景

| 场景             | 路径                    | 说明                                          |
| ---------------- | ----------------------- | --------------------------------------------- |
| **JSON 响应**    | `GET /json`             | 纯 JSON 序列化 + 路由匹配，测量最小开销       |
| **路由参数**     | `GET /users/:id`        | 动态路由参数解析，测量路由匹配 + 参数提取开销 |
| **处理器业务链** | `GET /chain`            | 3 层 handler 内联业务逻辑 + JSON 响应         |
| **真实中间件链** | `GET /middleware-chain` | 3 层 route-level middleware + JSON 响应       |

### 对比维度

- **Raw（裸跑）**：直接使用框架原生 API，无 vext 封装（Native 裸跑 = `http.createServer` + `route-core`）
- **chain**：历史兼容场景，测 handler 内联业务逻辑链。
- **middleware-chain**：真实 route-level middleware chain，测 adapter 中间件链执行器。
- **Vext Normal**：通过正式 bootstrap + `defineRoutes()` + router-loader 使用对应 adapter，关闭可选中间件；它不是 Core。

## 🚀 使用方法

### 主公平性对照（Raw Native / Fastify / Vext Native）

```bash
# 正式：四个目标、四场景（Core 的 middleware-chain 明确为 N/A）、5 轮中位数
node --expose-gc --max-old-space-size=512 test/benchmark/run-native-fairness.mjs --scenario all --duration 10 --connections 50 --pipelining 10 --warmup 5 --rounds 5

# 快速 smoke：验证 HTTP 契约和 chain telemetry，不作性能结论
npm run test:bench:fairness -- --duration 1 --connections 10 --pipelining 1 --warmup 0 --rounds 1
```

主 runner 会在写报告前断言：Core 的 global middleware 为 `0` 且参测 route registration chain 为 `1`；Normal 在 `frontend.enabled=false` 后 global middleware 为 `2`（`authContext`、`requestHook`），普通 route registration chain 为 `2`（`routeMatched + handler`），`middleware-chain` 为 `5`。不符合时结果会失败，不会生成可引用报告。

Raw Fastify 的三层 hook 只附着在 `/middleware-chain` 路由，不会穿过 `/json`、`/users/:id`、`/chain`；Raw Native / Raw Fastify 都使用预序列化 JSON body。Core 是 `test/benchmark` 的私有 direct harness，刻意绕过 bootstrap/router-loader；它表示最短 Vext Native 路径，不表示完整生产配置。

### Adapter matrix（辅助）

```bash
npm run test:bench
```

### 推荐模式

```bash
# 正式 adapter matrix — 五 adapter、四场景、5 轮中位数（约 40 分钟）
node --expose-gc --max-old-space-size=512 test/benchmark/run-benchmark.mjs --framework native,hono,fastify,express,koa --scenario all --duration 10 --connections 50 --pipelining 10 --warmup 5 --rounds 5

# 聚焦模式（PR 前对比）— 两个 adapter、5 轮中位数
npm run test:bench -- --framework native,fastify --scenario all --duration 10 --warmup 5 --rounds 5

# 受执行时限约束时：按 adapter × 场景分段，但保持相同正式协议
node --expose-gc --max-old-space-size=512 test/benchmark/run-benchmark.mjs --framework native --scenario json --duration 10 --connections 50 --pipelining 10 --warmup 5 --rounds 5 --results-json ./artifacts/native-json.json --output ./artifacts/native-json.md
node --expose-gc --max-old-space-size=512 test/benchmark/run-benchmark.mjs --framework native --scenario params --duration 10 --connections 50 --pipelining 10 --warmup 5 --rounds 5 --results-json ./artifacts/native-params.json --output ./artifacts/native-params.md
node test/benchmark/run-benchmark.mjs --from-results-json ./artifacts/native-json.json,./artifacts/native-params.json --output test/benchmark/RESULTS.md

# 精确模式（发版前）— 7 轮取中位数，每轮 15s，长预热
npm run test:bench -- --rounds 7 --duration 15 --warmup 5

# 配合 V8 GC 控制（减少 GC 停顿干扰）
node --expose-gc --max-old-space-size=512 test/benchmark/run-benchmark.mjs --rounds 5
```

`--from-results-json` 允许按场景分段，但只合并 source commit/worktree diff 指纹、Node/OS/CPU 环境，以及 duration/connections/pipelining/warmup/rounds 都相同的 complete 样本；partial、重复、协议不一致，或含连接错误、超时、非 2xx 响应的输入都会被拒绝，不能伪装成一个正式 baseline。差异指纹刻意排除 runner 自动生成的 `RESULTS.md`，避免报告内容和生成时间造成自引用；其余已跟踪差异及未跟踪候选文件内容都会纳入。正式全矩阵合并加 `--require-complete-matrix`，它会要求恰好五 adapter × 四场景的 20 组结果。

### 自定义参数

```bash
# 指定压测持续时间和并发连接数
npm run test:bench -- --duration 20 --connections 100

# 仅测试指定框架
npm run test:bench -- --framework native,fastify

# 仅运行指定场景
npm run test:bench -- --scenario json

# 多轮取中位数（消除 Windows 系统噪声）
npm run test:bench -- --rounds 5

# 调整流水线深度
npm run test:bench -- --pipelining 20

# 指定报告输出路径
npm run test:bench -- --output ./my-results.md
```

### 可用选项

| 选项                          | 默认值                      | 说明                                                                                           |
| ----------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| `--duration <seconds>`        | `15`                        | 压测持续时间（秒）                                                                             |
| `--connections <number>`      | `50`                        | 并发连接数                                                                                     |
| `--pipelining <number>`       | `10`                        | HTTP 流水线深度                                                                                |
| `--warmup <seconds>`          | `5`                         | 预热时间（秒）                                                                                 |
| `--rounds <number>`           | `1`                         | 轮次数（≥3 时取中位数，推荐 5 或 7）                                                           |
| `--scenario <name>`           | `all`                       | 场景过滤：`json` / `params` / `chain` / `middleware-chain` / `all`                             |
| `--framework <names>`         | 五个 Vext adapter           | 框架过滤（逗号分隔）：`native,hono,fastify,express,koa`；Egg 只在显式 `--framework egg` 时运行 |
| `--output <path>`             | `test/benchmark/RESULTS.md` | 报告输出路径                                                                                   |
| `--results-json <path>`       | —                           | 写入完整原始样本，适合分段正式 matrix                                                          |
| `--from-results-json <paths>` | —                           | 合并逗号分隔的 complete JSON 样本；要求同一来源和协议                                          |
| `--require-complete-matrix`   | `false`                     | 合并时要求五 adapter × 四场景的完整正式矩阵                                                    |

### 多轮模式说明

当 `--rounds` ≥ 2 时，每项测试会运行指定轮次，取 **RPS 中位数**作为最终结果：

- **中位数**优于平均值：自动排除极端异常值（如 Windows 后台干扰导致的偶发低值）
- 轮间自动**冷却 2 秒**，若启用 `--expose-gc` 还会触发手动 GC
- 报告自动生成**多轮统计表格**（各轮 RPS / min / max / mean / stddev / CV%）
- **CV > 15%** 时输出高波动警告，提示排查系统干扰

#### 耗时参考

| 模式        | 覆盖面             | 参数       | 预计总耗时 |
| ----------- | ------------------ | ---------- | ---------- |
| 快速定位    | 1 adapter × 4 场景 | 1 轮 × 10s | ≥ 2 分钟   |
| 聚焦对比    | 2 adapter × 4 场景 | 5 轮 × 10s | ≥ 15 分钟  |
| 正式 matrix | 5 adapter × 4 场景 | 5 轮 × 10s | 约 40 分钟 |

## 📁 文件结构

```
test/benchmark/
├── README.md                          # 本文件
├── run-benchmark.mjs                  # 主基准测试脚本
├── run-native-fairness.mjs            # Raw Native/Fastify + Vext Native Core/Normal 主对照
├── RESULTS.md                         # 运行后自动生成的报告
└── servers/
    ├── raw-native.mjs                 # Native 裸跑服务器（http.createServer + route-core）
    ├── raw-hono.mjs                   # Hono 裸跑服务器
    ├── raw-fastify.mjs                # Fastify 裸跑服务器
    ├── raw-express.mjs                # Express 裸跑服务器
    ├── raw-koa.mjs                    # Koa 裸跑服务器
    ├── vext-start.mjs                 # vext 子进程启动脚本
    ├── vext-core-start.mjs            # benchmark 私有 Native Core 入口
    ├── vext-normal-adapter.mjs        # Normal chain telemetry wrapper
    └── vext-app/                      # vext 项目骨架
        └── src/
            ├── config/
            │   └── default.mjs        # 配置（adapter 通过 BENCH_ADAPTER 环境变量切换）
            └── routes/
                ├── json.mjs           # GET /json — 纯 JSON 响应
                ├── users.mjs          # GET /users/:id — 路由参数
                ├── chain.mjs          # GET /chain — 3 层 handler 内联业务链
                ├── middleware-chain.mjs # GET /middleware-chain — 3 层 route-level middleware
                └── health.mjs         # GET /health — 健康检查
```

## 🔧 工作原理

1. **裸跑服务器**：每个框架都有一个独立的裸跑服务器文件，实现相同路由场景，使用框架原生 API（Native 裸跑使用 `http.createServer` + `route-core`）
2. **vext Normal 服务器**：所有 adapter 共用 `vext-app` 的 `defineRoutes()` 路由代码；Native Normal 通过 telemetry 输出实际 global / route chain 长度。
3. **vext Core 服务器**：仅 Native 使用私有 direct harness，直接注册单 handler route；不读取、也不引入公开 benchmark 配置。
4. **子进程隔离**：所有服务器（裸跑和 vext）均在独立子进程中启动，避免状态污染和端口冲突。
5. **压测工具**：通过 `npm run test:bench` 按需解析 [autocannon](https://github.com/mcollina/autocannon)，避免根安装树携带可选 benchmark 依赖。
6. **预热**：正式压测前先进行短时间预热，消除 JIT 编译和冷启动影响。
7. **报告生成**：自动生成 Markdown 格式的对比报告，包含 RPS、延迟、吞吐量、轮次和 chain telemetry。

## 📊 报告内容

生成的报告（`RESULTS.md`）包含：

- **总结表格**：所有框架 × 场景的 Raw RPS / Vext RPS / Overhead 一览
- **详细结果**：每个场景的 RPS、P50/P99 延迟、平均延迟、吞吐量、错误数
- **框架排名**：按 Raw RPS 排名，附带 Vext Overhead
- **Overhead 分析**：平均/最大/最小 Overhead，是否达标判定
- **多轮统计**（`--rounds` > 1 时）：各轮 RPS、中位数、平均值、最小值、最大值、标准差、CV%，以及高波动警告
- **测试环境**：Node.js 版本、平台、CPU、内存、轮次等
- **可追溯性**：源码 SHA/dirty 状态、runner 路径、Autocannon 版本、完整 framework/scenario 参数与可比性限制

## ⚠️ 注意事项

- 基准测试结果受硬件、系统负载、Node.js 版本等因素影响，不同环境下数值可能差异较大
- **强烈建议使用 `--rounds 5`**（或更多）获取可信数据，单轮结果在 Windows 上波动可达 ±60%
- 建议在低负载环境下运行，关闭不必要的后台进程（尤其是 Windows Defender 实时扫描、Windows Update、Search 索引服务）
- adapter matrix 关闭了大部分可选中间件（accessLog、requestId、responseWrapper、cors、rateLimit），但仍有 Normal 生命周期成本；不能把它标作 Core。
- 默认日志级别设为 `silent`，避免 I/O 操作干扰性能测量
- Windows 上信号处理行为与 Unix 不同，但不影响基准测试结果
- Windows 上裸跑 Native（每请求 ~1μs）受系统调度抖动影响最大，Vext 层因框架开销"缓冲"反而更稳定
- Linux/CI 环境下数据更稳定，建议作为正式发版的性能参考
- Native adapter 是默认 adapter（`BENCH_ADAPTER=native`），其他 adapter 需额外安装对应框架包
