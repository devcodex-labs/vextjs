# vext 性能基准测试

> 量化 vext 框架开销，对比 Native / Hono / Fastify / Express / Koa 五个底层框架的裸跑性能与通过 vext 封装后的性能。

## 🎯 目标

- **量化框架开销**：测量 vext adapter 层引入的 overhead
- **全框架覆盖**：测试 vext 支持的全部 5 个 adapter（Native / Hono / Fastify / Express / Koa）
- **多场景验证**：覆盖最常见的 API 使用模式

## ⚡ 性能概览（JSON 场景）

| Adapter | Raw RPS | Vext RPS | Overhead | 额外依赖 |
|---------|--------:|--------:|---------:|----------|
| Fastify | 88,003 | 52,743 | 40.1% | `fastify` |
| Koa | 61,401 | 42,010 | 31.6% | `koa` |
| **Native** ⭐ | 52,431 | 50,144 | 4.4% | ✅ 零依赖（默认） |
| Hono | 42,768 | 26,630 | 37.7% | `hono` `@hono/node-server` |
| Express | 15,815 | 14,098 | 10.9% | `express` |

> Native adapter 使用 Node.js 内置 `http.createServer` + `find-my-way` radix trie，是 vext 默认 adapter 且唯一不依赖第三方 HTTP 框架的实现。Native adapter 的 overhead 仅 4.4%（所有 adapter 中最低）。
> 测试环境：Node.js 22, Windows x64, i5-14400, autocannon (50 connections, 10 pipelining, 10s duration)。

## 📋 测试场景

| 场景 | 路径 | 说明 |
|------|------|------|
| **JSON 响应** | `GET /json` | 纯 JSON 序列化 + 路由匹配，测量最小开销 |
| **路由参数** | `GET /users/:id` | 动态路由参数解析，测量路由匹配 + 参数提取开销 |
| **中间件链** | `GET /chain` | 3 层洋葱模型中间件（计时 + requestId + 鉴权模拟）+ JSON 响应 |

### 对比维度

- **Raw（裸跑）**：直接使用框架原生 API，无 vext 封装（Native 裸跑 = `http.createServer` + `find-my-way`）
- **Vext（封装）**：通过 vext bootstrap 使用对应 adapter，关闭非必要中间件

## 🚀 使用方法

### 快速运行

```bash
npm run test:bench
```

### 自定义参数

```bash
# 指定压测持续时间和并发连接数
node test/benchmark/run-benchmark.mjs --duration 20 --connections 100

# 仅测试指定框架
node test/benchmark/run-benchmark.mjs --framework native,fastify

# 仅运行指定场景
node test/benchmark/run-benchmark.mjs --scenario json

# 调整流水线深度
node test/benchmark/run-benchmark.mjs --pipelining 20

# 指定报告输出路径
node test/benchmark/run-benchmark.mjs --output ./my-results.md
```

### 可用选项

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `--duration <seconds>` | `10` | 压测持续时间（秒） |
| `--connections <number>` | `50` | 并发连接数 |
| `--pipelining <number>` | `10` | HTTP 流水线深度 |
| `--warmup <seconds>` | `3` | 预热时间（秒） |
| `--scenario <name>` | `all` | 场景过滤：`json` / `params` / `chain` / `all` |
| `--framework <names>` | 全部 | 框架过滤（逗号分隔）：`native,hono,fastify,express,koa` |
| `--output <path>` | `test/benchmark/RESULTS.md` | 报告输出路径 |

## 📁 文件结构

```
test/benchmark/
├── README.md                          # 本文件
├── run-benchmark.mjs                  # 主基准测试脚本
├── RESULTS.md                         # 运行后自动生成的报告
└── servers/
    ├── raw-native.mjs                 # Native 裸跑服务器（http.createServer + find-my-way）
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
                ├── chain.mjs          # GET /chain — 3 层中间件链
                └── health.mjs         # GET /health — 健康检查
```

## 🔧 工作原理

1. **裸跑服务器**：每个框架都有一个独立的裸跑服务器文件，实现相同的 3 个路由场景，使用框架原生 API（Native 裸跑使用 `http.createServer` + `find-my-way`）
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
- **测试环境**：Node.js 版本、平台、CPU、内存等

## ⚠️ 注意事项

- 基准测试结果受硬件、系统负载、Node.js 版本等因素影响，不同环境下数值可能差异较大
- 建议在低负载环境下运行，关闭不必要的后台进程以获得更稳定的结果
- vext 服务器关闭了大部分内置中间件（accessLog、requestId、responseWrapper、cors、rateLimit），仅测量 adapter 层和路由层的核心开销
- 默认日志级别设为 `silent`，避免 I/O 操作干扰性能测量
- Windows 上信号处理行为与 Unix 不同，但不影响基准测试结果
- Windows 上 params/chain 场景数据波动较大，建议在 Linux/CI 环境复验获取稳定的生产参考数据
- Native adapter 是默认 adapter（`BENCH_ADAPTER=native`），其他 adapter 需额外安装对应框架包