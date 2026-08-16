# vext 性能基准测试

> 面向使用者的主基准比较同一个 Vext Normal 应用在 Native / Hono / Fastify / Express / Koa 五个 Adapter 上的表现；Raw framework 与 Native Core 只用于维护者诊断。
> 支持多轮取中位数模式（`--rounds`），消除 Windows 系统噪声，获取可信数据。

## 🎯 目标

- **支持 Adapter 选型**：固定 Vext 应用与能力，只比较 5 个可选 Adapter（Native / Hono / Fastify / Express / Koa）
- **保留可审计诊断**：Raw/Normal 和 Core 入口仍可定位框架组合成本，但不替代用户选型数据
- **多场景验证**：覆盖最常见的 API 使用模式

## ⚡ 最新结果与可比性

当前可引用的主结果只在 [`RESULTS.md`](./RESULTS.md) 中。它由 `run-adapter-matrix.mjs` 自动生成，并记录源码 SHA、worktree 状态、Node/OS/CPU/内存、锁定依赖版本、Autocannon 版本、npm latest 校验时间、完整参数、每轮样本、HTTP/telemetry 合同和 CV；不要把本 README 中的示例或其他机器的数值当作当前基准。所有 runner 会在启动压测前查询 npm registry；任一直接依赖或 Autocannon 不是 `latest`，或 manifest、lock、实际安装树不一致时都会直接失败。Autocannon 作为精确 devDependency 通过官方 programmatic API 运行，避免每个样本重复执行 `npm exec` 引入解析/网络/缓存噪声。也可单独运行 `npm run verify:benchmark-deps`。

Native adapter 使用 Node.js 内置 `http.createServer` + `route-core` 轻量路由核心，是 vext 默认 adapter 且唯一不依赖第三方 HTTP 框架的实现。Benchmark 必须区分 `chain`（handler 内联业务链）、`middleware-chain`（真实 route-level middleware chain）、Core（私有最短路径）与 Normal（正式 bootstrap），避免把任意一者误读为默认运行时性能。

仅当源码身份、Node.js、OS/CPU/内存、进程优先级、参数、场景和系统负载条件相同时，才可以把两份报告用作趋势或回归对比；跨机器/跨协议结果只能作为各自环境的局部观测。

## 📋 测试场景

| 场景             | 路径                    | 说明                                          |
| ---------------- | ----------------------- | --------------------------------------------- |
| **JSON 响应**    | `GET /json`             | 纯 JSON 序列化 + 路由匹配，测量最小开销       |
| **路由参数**     | `GET /users/:id`        | 动态路由参数解析，测量路由匹配 + 参数提取开销 |
| **处理器业务链** | `GET /chain`            | 3 层 handler 内联业务逻辑 + JSON 响应         |
| **真实中间件链** | `GET /middleware-chain` | 3 层 route-level middleware + JSON 响应       |

### 对比维度

- **Vext Adapter Matrix（主）**：同一个正式 bootstrap + `defineRoutes()` + router-loader + Normal 配置，仅 Adapter 不同。
- **Raw（维护诊断）**：直接使用框架原生 API，无 Vext 封装（Native 裸跑 = `http.createServer` + `route-core`）。
- **chain**：历史兼容场景，测 handler 内联业务逻辑链。
- **middleware-chain**：真实 route-level middleware chain，测 adapter 中间件链执行器。
- **Vext Normal**：通过正式 bootstrap + `defineRoutes()` + router-loader 使用对应 adapter，关闭可选中间件；它不是 Core。

## 🚀 使用方法

### 用户主基准：Vext Adapter Matrix

```bash
# 正式同步 handler：干净源码、五 Adapter、四场景、7 轮中位数
node --expose-gc --max-old-space-size=512 test/benchmark/run-adapter-matrix.mjs --formal --scenario all --duration 10 --connections 50 --pipelining 10 --warmup 5 --rounds 7 --max-cv 20 --process-priority 0 --handler-mode sync --results-json test/benchmark/.artifacts/adapter-matrix-formal-release.json
npm run generate:benchmark-docs

# 快速 smoke：验证五个 Adapter 的 HTTP 契约和 Normal chain telemetry，不作性能结论
npm run test:bench -- --scenario json --duration 1 --connections 10 --pipelining 1 --warmup 0 --rounds 1

# 受执行时限约束时：按场景分段，只合并同源码、同依赖、同环境、同协议且 CV 过门禁的完整目标组
node --expose-gc --max-old-space-size=512 test/benchmark/run-adapter-matrix.mjs --formal --scenario json --duration 10 --connections 50 --pipelining 10 --warmup 5 --rounds 7 --max-cv 20 --results-json ./test/benchmark/.artifacts/adapter-json.json --output ./test/benchmark/.artifacts/adapter-json.md
node test/benchmark/run-adapter-matrix.mjs --formal --from-results-json ./test/benchmark/.artifacts/adapter-json.json,./test/benchmark/.artifacts/adapter-params.json,./test/benchmark/.artifacts/adapter-chain.json,./test/benchmark/.artifacts/adapter-middleware-chain.json --require-complete-matrix --output test/benchmark/RESULTS.md
```

主 runner 会在写报告前断言：五个 Adapter 的 status、JSON body、content type、必要 header 与 Normal chain telemetry 都一致；`requestContext=false` 与 `frontend.enabled=false` 后每个 Adapter 的 global middleware 为 `1`（仅 `requestHook`），普通 route registration chain 为 `2`（`routeMatched + handler`），`middleware-chain` 为 `5`。每轮会轮转五个 Adapter 的起始目标；任一多轮样本 CV 超过 `--max-cv`（默认 20%）时只保留 `complete=false` 的原始 JSON，并拒绝生成可引用 Markdown 报告。

### 维护者诊断入口

```bash
# Raw Native / Raw Fastify / Vext Native Core / Normal：定位 Native 最短链和组合开销，不是用户选型主报告；默认写入独立的 NATIVE-FAIRNESS.md / native-fairness-latest.json
node --expose-gc --max-old-space-size=512 test/benchmark/run-native-fairness.mjs --scenario all --duration 10 --connections 50 --pipelining 10 --warmup 5 --rounds 5 --max-cv 15 --process-priority 0 --handler-mode sync

# Raw/Vext 成对结果：定位具体 Adapter 的组合增量，不用于横向 Adapter 排名
node --expose-gc --max-old-space-size=512 test/benchmark/run-benchmark.mjs --framework native,fastify --scenario json --duration 10 --connections 50 --pipelining 10 --warmup 5 --rounds 5 --max-cv 15 --process-priority 0

# 精确模式（发版前）— 7 轮取中位数，每轮 15s，长预热
npm run test:bench -- --rounds 7 --duration 15 --warmup 5

# 配合 V8 GC 控制（减少 GC 停顿干扰）
node --expose-gc --max-old-space-size=512 test/benchmark/run-adapter-matrix.mjs --rounds 7
```

`--from-results-json` 允许按场景分段，但只合并 source commit/worktree diff 指纹、Node/OS/CPU/内存/进程优先级环境，以及 duration/connections/pipelining/warmup/rounds 都相同的 complete 样本；partial、重复、协议不一致，或含连接错误、超时、非 2xx 响应的输入都会被拒绝，不能伪装成一个正式 baseline。`--formal` 会额外拒绝除当前生成报告和 JSON artifact 之外的任何脏源码，并要求合并输入也来自 formal run。差异指纹刻意排除 runner 本次读取或生成的 report/JSON artifact，避免报告内容和生成时间造成自引用；其余已跟踪差异及未跟踪候选文件内容都会纳入。仓库内分段结果统一写到已忽略的 `test/benchmark/.artifacts/`。正式全矩阵合并加 `--require-complete-matrix`，它会要求恰好五 adapter × 四场景的 20 组结果。通过后运行 `npm run generate:benchmark-docs`，将双语的完整样本、版本、provenance、P50/P99 和 telemetry 发布到文档站内页面；`npm run verify:benchmark-docs` 会拒绝 artifact 与站内页面漂移。

后台负载较高的 Windows 主机可显式使用 `--process-priority -14`（Node.js 的 high priority 值）；runner 会同时设置自身和每个被测子进程并核对实际值。平台不允许该优先级时会直接失败。所有待合并分段必须使用相同值，不能混合普通与高优先级样本。

### 自定义参数

```bash
# 指定压测持续时间和并发连接数
npm run test:bench -- --duration 20 --connections 100

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

| 选项                          | 默认值                      | 说明                                                               |
| ----------------------------- | --------------------------- | ------------------------------------------------------------------ |
| `--duration <seconds>`        | `10`                        | 压测持续时间（秒）                                                 |
| `--connections <number>`      | `50`                        | 并发连接数                                                         |
| `--pipelining <number>`       | `10`                        | HTTP 流水线深度                                                    |
| `--warmup <seconds>`          | `5`                         | 预热时间（秒）                                                     |
| `--rounds <number>`           | `5`                         | 轮次数（≥3 时取中位数，推荐 5 或 7）                               |
| `--max-cv <percent>`          | `20`                        | 多轮 RPS 的最大变异系数；任一结果超出时拒绝生成可引用报告          |
| `--process-priority <n>`      | `0`                         | runner 与被测子进程优先级（-20..19）；artifact 记录请求值和实际值  |
| `--scenario <name>`           | `all`                       | 场景过滤：`json` / `params` / `chain` / `middleware-chain` / `all` |
| `--handler-mode <mode>`       | `sync`                      | 同一 run 内固定 handler 形态：`sync` 或 `async`                    |
| `--output <path>`             | `test/benchmark/RESULTS.md` | 报告输出路径                                                       |
| `--results-json <path>`       | —                           | 写入完整原始样本，适合分段正式 matrix                              |
| `--from-results-json <paths>` | —                           | 合并逗号分隔的 complete JSON 样本；要求同一来源和协议              |
| `--require-complete-matrix`   | `false`                     | 合并时要求五 adapter × 四场景的完整正式矩阵                        |
| `--formal`                    | `false`                     | 只允许干净源码；用于可引用结果与站内公开结果页                     |

### 多轮模式说明

当 `--rounds` ≥ 2 时，每项测试会运行指定轮次，取 **RPS 中位数**作为最终结果。主 matrix 会轮转五个 Adapter 的每轮起始位置，避免把时间漂移固定压在某一方。CV 门禁在报告写入前执行：

- **中位数**优于平均值：自动排除极端异常值（如 Windows 后台干扰导致的偶发低值）
- 轮间自动**冷却 2 秒**，若启用 `--expose-gc` 还会触发手动 GC
- 报告自动生成**多轮统计表格**（各轮 RPS / min / max / mean / stddev / CV%）
- **CV > 20%** 时拒绝生成可引用报告，提示排查系统干扰

#### 耗时参考

| 模式        | 覆盖面             | 参数       | 预计总耗时 |
| ----------- | ------------------ | ---------- | ---------- |
| 快速定位    | 1 adapter × 4 场景 | 1 轮 × 10s | ≥ 2 分钟   |
| 聚焦对比    | 2 adapter × 4 场景 | 5 轮 × 10s | ≥ 15 分钟  |
| 正式 matrix | 5 adapter × 4 场景 | 7 轮 × 10s | 约 55 分钟 |

## 📁 文件结构

```
test/benchmark/
├── README.md                          # 本文件
├── run-adapter-matrix.mjs             # 用户主基准：同一 Vext 应用的五 Adapter 轮转矩阵
├── run-benchmark.mjs                  # Raw/Vext 成对维护者诊断
├── run-native-fairness.mjs            # Raw Native/Fastify + Vext Native Core/Normal 维护者诊断
├── RESULTS.md                         # 运行后自动生成的报告
├── NATIVE-FAIRNESS.md                 # Raw Native/Fastify/Core/Normal 的独立维护诊断报告
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
2. **vext Normal 服务器**：所有 adapter 共用 `vext-app` 的 `defineRoutes()` 路由代码；五个 Adapter 都通过 telemetry 输出并断言实际 global / route chain 长度。
3. **vext Core 服务器**：仅 Native 使用私有 direct harness，直接注册单 handler route；不读取、也不引入公开 benchmark 配置。
4. **子进程隔离**：所有服务器（裸跑和 vext）均在独立子进程中启动，避免状态污染和端口冲突。
5. **压测工具**：精确锁定的 [autocannon](https://github.com/mcollina/autocannon) devDependency，通过官方 programmatic API 直接运行；不在样本边界内执行 `npm exec`。
6. **预热**：正式压测前先进行短时间预热，消除 JIT 编译和冷启动影响。
7. **报告生成**：自动生成 Markdown 格式的对比报告，包含 RPS、延迟、吞吐量、轮次和 chain telemetry。

Raw Hono 按 Hono 官方 Node.js 方式使用 `@hono/node-server`；Vext Hono adapter 运行时只依赖 `hono`，通过 Vext 自有 `node:http` bridge 接入。因此 Raw/Vext Hono 成对诊断包含 bridge 实现成本，不进入用户主 matrix 的 Adapter 横向结论。

## 📊 报告内容

生成的报告（`RESULTS.md`）包含：

- **总结表格**：同一 Vext 应用的五个 Adapter × 场景 RPS 一览
- **详细结果**：每个场景的 RPS、P50/P99 延迟、平均延迟、吞吐量、错误数
- **Adapter 统计**：每个 Adapter 的轮次、P50/P99、错误数与 CV
- **多轮统计**（`--rounds` > 1 时）：各轮 RPS、中位数、平均值、最小值、最大值、标准差、CV%，以及高波动警告
- **测试环境**：Node.js 版本、平台、CPU、内存、轮次等
- **进程优先级**：artifact 会记录运行时优先级；分段结果只有优先级一致时才能合并
- **可追溯性**：源码 SHA/dirty 状态、runner 路径、Autocannon 版本、完整 framework/scenario 参数与可比性限制

## ⚠️ 注意事项

- 基准测试结果受硬件、系统负载、Node.js 版本等因素影响，不同环境下数值可能差异较大
- **正式基准建议使用 `--rounds 7`**（或更多）获取可信数据，单轮结果在 Windows 上波动可达 ±60%
- 建议在低负载环境下运行，关闭不必要的后台进程（尤其是 Windows Defender 实时扫描、Windows Update、Search 索引服务）
- matrix 关闭了大部分不参与这些 GET 场景的可选能力（accessLog、requestId、responseWrapper、cors、rateLimit），但仍保留 Normal 生命周期成本；不能把它标作 Core，也不能把它描述为全生产业务吞吐。
- 默认日志级别设为 `silent`，避免 I/O 操作干扰性能测量
- Windows 上信号处理行为与 Unix 不同，但不影响基准测试结果
- Windows 上裸跑 Native（每请求 ~1μs）受系统调度抖动影响最大，Vext 层因框架开销"缓冲"反而更稳定
- Linux/CI 环境下数据更稳定，建议作为正式发版的性能参考
- Native adapter 是默认 adapter（`BENCH_ADAPTER=native`），其他 adapter 需额外安装对应框架包
