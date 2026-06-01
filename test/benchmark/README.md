# vext 性能基准测试

> 量化 vext 框架开销，对比 Native / Hono / Fastify / Express / Koa 五个底层框架的裸跑性能与通过 vext 封装后的性能。
> 支持多轮取中位数模式（`--rounds`），消除 Windows 系统噪声，获取可信数据。

## 🎯 目标

- **量化框架开销**：测量 vext adapter 层引入的 overhead
- **全框架覆盖**：测试 vext 支持的全部 5 个 adapter（Native / Hono / Fastify / Express / Koa）
- **多场景验证**：覆盖最常见的 API 使用模式

## ⚡ 性能概览（5 轮中位数）

### Native vs Fastify 核心对比

| 场景                      | Raw Native | Vext Native | Raw Fastify | Vext Fastify | Native 领先 |
| ------------------------- | ---------: | ----------: | ----------: | -----------: | :---------: |
| **JSON 响应**             |     44,932 |  **36,819** |      45,619 |       29,203 | **+26.1%**  |
| **路由参数**              |     43,859 |  **36,755** |      43,676 |       24,386 | **+50.7%**  |
| **处理器业务链（chain）** |     28,337 |  **31,698** |      41,286 |       22,719 | **+39.5%**  |

### 全 Adapter 性能概览（JSON 场景）

| Adapter       |   Vext RPS | Overhead | 额外依赖                   |
| ------------- | ---------: | -------: | -------------------------- |
| **Native** ⭐ | **36,819** |    18.1% | ✅ 零依赖（默认）          |
| Express       |     30,974 |    -3.7% | `express`                  |
| Fastify       |     29,203 |    36.0% | `fastify`                  |
| Koa           |     22,488 |    29.4% | `koa`                      |
| Hono          |     15,684 |    24.2% | `hono` `@hono/node-server` |

> Native adapter 使用 Node.js 内置 `http.createServer` + `route-core` 轻量路由核心，是 vext 默认 adapter 且唯一不依赖第三方 HTTP 框架的实现。Benchmark 需区分 `chain`（handler 内联业务链）与 `middleware-chain`（真实 route-level middleware chain），避免把 core-mode 数据误读为默认运行时性能。
> 测试环境：Node.js v24.14.0, Windows x64, i7-9700, 32GB RAM, autocannon (50 connections, 10 pipelining, 10s × 5 轮取中位数，2026-03-23)。
> 绝大多数场景 CV（变异系数）< 3.5%，数据高度可信。

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
- **Vext（封装）**：通过 vext bootstrap 使用对应 adapter，关闭非必要中间件

## 🚀 使用方法

### 快速运行

```bash
npm run test:bench
```

### 推荐模式

```bash
# 标准模式（PR 前对比）— 5 轮取中位数，每轮 10s
node test/benchmark/run-benchmark.mjs --framework native,fastify --rounds 5

# 精确模式（发版前）— 7 轮取中位数，每轮 15s，长预热
node test/benchmark/run-benchmark.mjs --rounds 7 --duration 15 --warmup 5

# 配合 V8 GC 控制（减少 GC 停顿干扰）
node --expose-gc --max-old-space-size=512 test/benchmark/run-benchmark.mjs --rounds 5
```

### 自定义参数

```bash
# 指定压测持续时间和并发连接数
node test/benchmark/run-benchmark.mjs --duration 20 --connections 100

# 仅测试指定框架
node test/benchmark/run-benchmark.mjs --framework native,fastify

# 仅运行指定场景
node test/benchmark/run-benchmark.mjs --scenario json

# 多轮取中位数（消除 Windows 系统噪声）
node test/benchmark/run-benchmark.mjs --rounds 5

# 调整流水线深度
node test/benchmark/run-benchmark.mjs --pipelining 20

# 指定报告输出路径
node test/benchmark/run-benchmark.mjs --output ./my-results.md
```

### 可用选项

| 选项                     | 默认值                      | 说明                                                               |
| ------------------------ | --------------------------- | ------------------------------------------------------------------ |
| `--duration <seconds>`   | `15`                        | 压测持续时间（秒）                                                 |
| `--connections <number>` | `50`                        | 并发连接数                                                         |
| `--pipelining <number>`  | `10`                        | HTTP 流水线深度                                                    |
| `--warmup <seconds>`     | `5`                         | 预热时间（秒）                                                     |
| `--rounds <number>`      | `1`                         | 轮次数（≥3 时取中位数，推荐 5 或 7）                               |
| `--scenario <name>`      | `all`                       | 场景过滤：`json` / `params` / `chain` / `middleware-chain` / `all` |
| `--framework <names>`    | 全部                        | 框架过滤（逗号分隔）：`native,hono,fastify,express,koa`            |
| `--output <path>`        | `test/benchmark/RESULTS.md` | 报告输出路径                                                       |

### 多轮模式说明

当 `--rounds` ≥ 2 时，每项测试会运行指定轮次，取 **RPS 中位数**作为最终结果：

- **中位数**优于平均值：自动排除极端异常值（如 Windows 后台干扰导致的偶发低值）
- 轮间自动**冷却 2 秒**，若启用 `--expose-gc` 还会触发手动 GC
- 报告自动生成**多轮统计表格**（各轮 RPS / min / max / mean / stddev / CV%）
- **CV > 15%** 时输出高波动警告，提示排查系统干扰

#### 耗时参考

| 模式         | 轮次 | 每轮耗时 | 6 场景(2 框架) | 总耗时  |
| ------------ | :--: | :------: | :------------: | :-----: |
| 单轮（快速） |  1   |   ~20s   |      × 12      | ~4 min  |
| 标准 5 轮    |  5   | ~17s × 5 |      × 12      | ~17 min |
| 精确 7 轮    |  7   | ~22s × 7 |      × 12      | ~31 min |

## 📁 文件结构

```
test/benchmark/
├── README.md                          # 本文件
├── run-benchmark.mjs                  # 主基准测试脚本
├── RESULTS.md                         # 运行后自动生成的报告
└── servers/
    ├── raw-native.mjs                 # Native 裸跑服务器（http.createServer + route-core）
    ├── raw-hono.mjs                   # Hono 裸跑服务器
    ├── raw-fastify.mjs                # Fastify 裸跑服务器
    ├── raw-express.mjs                # Express 裸跑服务器
    ├── raw-koa.mjs                    # Koa 裸跑服务器
    ├── vext-start.mjs                 # vext 子进程启动脚本
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
2. **vext 服务器**：所有框架共用同一套 vext-app 路由代码，仅通过 `BENCH_ADAPTER` 环境变量切换底层 adapter（默认 `native`）
3. **子进程隔离**：所有服务器（裸跑和 vext）均在独立子进程中启动，避免状态污染和端口冲突
4. **压测工具**：使用 [autocannon](https://github.com/mcollina/autocannon) 进行 HTTP 压测
5. **预热**：正式压测前先进行短时间预热，消除 JIT 编译和冷启动影响
6. **报告生成**：自动生成 Markdown 格式的对比报告，包含 RPS、延迟、吞吐量和 Overhead 分析

## 📊 报告内容

生成的报告（`RESULTS.md`）包含：

- **总结表格**：所有框架 × 场景的 Raw RPS / Vext RPS / Overhead 一览
- **详细结果**：每个场景的 RPS、P50/P99 延迟、平均延迟、吞吐量、错误数
- **框架排名**：按 Raw RPS 排名，附带 Vext Overhead
- **Overhead 分析**：平均/最大/最小 Overhead，是否达标判定
- **多轮统计**（`--rounds` > 1 时）：各轮 RPS、中位数、平均值、最小值、最大值、标准差、CV%，以及高波动警告
- **测试环境**：Node.js 版本、平台、CPU、内存、轮次等

## ⚠️ 注意事项

- 基准测试结果受硬件、系统负载、Node.js 版本等因素影响，不同环境下数值可能差异较大
- **强烈建议使用 `--rounds 5`**（或更多）获取可信数据，单轮结果在 Windows 上波动可达 ±60%
- 建议在低负载环境下运行，关闭不必要的后台进程（尤其是 Windows Defender 实时扫描、Windows Update、Search 索引服务）
- vext 服务器关闭了大部分内置中间件（accessLog、requestId、responseWrapper、cors、rateLimit），仅测量 adapter 层和路由层的核心开销
- 默认日志级别设为 `silent`，避免 I/O 操作干扰性能测量
- Windows 上信号处理行为与 Unix 不同，但不影响基准测试结果
- Windows 上裸跑 Native（每请求 ~1μs）受系统调度抖动影响最大，Vext 层因框架开销"缓冲"反而更稳定
- Linux/CI 环境下数据更稳定，建议作为正式发版的性能参考
- Native adapter 是默认 adapter（`BENCH_ADAPTER=native`），其他 adapter 需额外安装对应框架包
