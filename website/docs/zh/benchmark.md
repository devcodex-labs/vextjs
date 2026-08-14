# 性能基准

这份基准帮助你理解 VextJS 在轻量 HTTP 场景中的框架开销，以及 Native 与 Fastify 在相同负载下的差异。它适合做初步选型，不替代你的应用在真实中间件、鉴权、日志、数据库和部署环境下的压测。

## 先看结论

- **没有跨场景的总冠军。** 同步 handler 组中 Raw Fastify 在四个场景领先；异步 handler 组中 Raw Native 领先 JSON、参数路由和处理器业务链，Raw Fastify 领先 route middleware 链。
- **Vext Native Normal 展示的是可运行框架路径的成本。** 同步组相对 Raw Native 低 11.8%–18.1%、相对 Raw Fastify 低 17.8%–20.8%；异步组对应为 17.2%–32.0% 和 20.0%–30.5%。
- **这些数字不能解释成“Fastify 永远最快”或“Vext 排名第二”。** 场景、handler 形态和底层 adapter 都会改变结果。
- **选择 adapter 时先看能力与迁移成本。** Native 是零第三方 HTTP 框架依赖的默认路径；需要特定生态时再选择 Fastify、Express、Koa 或 Hono，并用自己的业务负载复测。

## 当前结果

以下结果采集于 **2026-08-14**。所有数字均为 5 轮的 req/s 中位数，数值越高表示这个测试场景中的吞吐越高。

### 同步 handler

| 场景                | Raw Native | Raw Fastify | Vext Native Normal |
| ------------------- | ---------: | ----------: | -----------------: |
| JSON                |     26,444 |      28,857 |             22,880 |
| 参数路由            |     25,895 |      27,785 |             22,828 |
| 处理器业务链        |     24,091 |      24,615 |             19,723 |
| route middleware 链 |     24,053 |      24,985 |             19,776 |

### 异步 handler

| 场景                | Raw Native | Raw Fastify | Vext Native Normal |
| ------------------- | ---------: | ----------: | -----------------: |
| JSON                |     33,351 |      28,782 |             22,856 |
| 参数路由            |     34,193 |      32,300 |             23,244 |
| 处理器业务链        |     30,088 |      26,185 |             20,940 |
| route middleware 链 |     25,236 |      30,085 |             20,903 |

同步与异步两组在不同时间采样，只能在各自表格内比较，不能用两张表的绝对值证明某种 handler 写法更快。

完整的轮次样本、CV、P50/P99、源码身份和生命周期 telemetry 可查看[原始结果](https://github.com/devcodex-labs/vextjs/blob/main/test/benchmark/RESULTS.md)。

## 这些差距包含什么

`Raw Native` 和 `Raw Fastify` 直接使用各自底层 API。`Vext Native Normal` 使用 Vext 的正式 bootstrap、router loader、路由匹配、请求/响应对象和生命周期；为对齐核心负载，测试关闭了非必要的可选请求能力：

- access log、request ID、CORS 和 rate limit；
- response wrap、body parser 和 request context；
- session、CSRF、security headers 和 frontend（默认即关闭或在 fixture 中明确关闭）；
- 日志输出设为 `silent`。

因此，Normal 与 Raw 的差值主要反映这个精简负载中的 Vext 路由、请求/响应抽象和生命周期成本。它不是开启全部生产能力后的吞吐，也不能代表包含 I/O 的完整业务接口。

### 为什么原始报告中的 Core 有 `N/A`

Core 是 benchmark 内部用来定位最短执行路径的诊断入口，不经过正式 bootstrap，也不是用户可选择的运行模式。

| Core 诊断场景       | 同步 | 异步 |
| ------------------- | ---: | ---: |
| route middleware 链 |  N/A |  N/A |

`N/A` 表示“不适用”：Core 不注册 route middleware chain，所以无法测量该场景；它既不是漏测，也不表示成本为零。用户选型应以 Normal 结果为主。

## Adapter 对比

下面是同一协议下，Vext 相对每个 adapter 对应 Raw 实现的吞吐差值；负值表示 Vext 在该组中较低。它衡量的是 **Vext 与该 adapter 的组合开销**，不能把不同行直接当成框架总排名。

| Adapter |   JSON | 参数路由 | 处理器业务链 | route middleware 链 |
| ------- | -----: | -------: | -----------: | ------------------: |
| Native  | -31.6% |   -29.6% |       -29.4% |              -27.6% |
| Fastify | -43.0% |   -41.7% |       -38.3% |              -39.1% |
| Express |  -9.4% |    -2.6% |        -7.4% |              -12.7% |
| Koa     | -31.4% |   -33.3% |       -37.4% |              -34.2% |
| Hono    | -69.1% |   -68.6% |       -67.0% |              -67.9% |

Express 的百分比更小不表示它的绝对吞吐最高；百分比受各自 Raw 基线影响。Hono 的差距包含 Vext 自有 `node:http` bridge 成本：Raw Hono 使用官方 `@hono/node-server`，而 Vext Hono adapter 的运行时只依赖 `hono`。这两个入口都是真实公开路径，但不是同一个 server wrapper。

### 如何选择

| 需求                                         | 建议起点       | 需要注意                                                           |
| -------------------------------------------- | -------------- | ------------------------------------------------------------------ |
| 新项目、希望减少 HTTP 框架依赖               | Native（默认） | 用真实业务负载确认吞吐与延迟目标                                   |
| 已确定需要 Fastify 相关能力                  | Fastify        | Vext middleware 与底层原生 middleware 的签名不同，先核对集成边界   |
| 从 Express 或 Koa 迁移、团队已有经验         | 对应 adapter   | 不要仅依据开销百分比选择，先验证现有中间件的迁移方式               |
| Node.js 服务中需要 Hono / Web Standards 风格 | Hono           | 当前是 Node.js adapter，不是 Edge 运行时承诺；现有 bridge 开销较大 |

详细安装和配置请参见 [Adapter 指南](/guide/adapters)。

## 测试口径

| 项目   | 当前正式样本                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------ |
| 环境   | Node.js 20.20.2、Windows x64、Intel i7-9700、32 GiB RAM                                                                  |
| 负载   | 50 connections、pipelining 10、每轮 10 秒                                                                                |
| 稳定性 | 5 秒预热、5 轮中位数、目标逐轮交错、CV ≤ 15%                                                                             |
| 进程   | runner 与被测子进程使用相同优先级 -14                                                                                    |
| 依赖   | Fastify 5.12.0、Hono 4.13.2、`@hono/node-server` 2.1.1、Express 5.2.1、Koa 3.2.1、`@koa/router` 15.7.0、Autocannon 8.0.0 |

正式运行前，runner 会将这些依赖与当日 npm `latest` 核对；任一版本、源码身份、非 2xx、连接错误、超时、缺失结果或 CV 门禁失败都会拒绝生成可引用报告。目标按轮次交错执行，减少时间漂移固定偏向某一实现。

## 自己复现

先安装锁文件中的依赖并确认 benchmark 版本仍是当前 npm `latest`：

```bash
npm ci
npm run verify:benchmark-deps
```

运行与本页一致的同步主对照：

```bash
node --expose-gc --max-old-space-size=512 test/benchmark/run-native-fairness.mjs --scenario all --duration 10 --connections 50 --pipelining 10 --warmup 5 --rounds 5 --max-cv 15 --process-priority -14 --handler-mode sync
```

将最后一个参数改为 `--handler-mode async` 可运行异步组。`--process-priority -14` 是本页 Windows 样本的一部分；如果你的平台或权限不支持，请改用可用值，并把结果视为新的环境基线，不要直接与本页数字比较。

runner 使用本地 Autocannon **programmatic API**，会自动启动和停止测试目标。完整参数、adapter matrix 命令和 artifact 合并规则见 [benchmark README](https://github.com/devcodex-labs/vextjs/blob/main/test/benchmark/README.md)。

### 测试真实应用

框架微基准只回答“核心 HTTP 路径的成本”。上线前至少应在与你的生产环境相近的机器上加入：

1. 实际认证、日志、响应包装和中间件；
2. 数据库、缓存和外部 API 的真实或可控替身；
3. 预热、多个轮次、吞吐、P95/P99、错误率和资源占用；
4. 与生产一致的 Node.js 版本、进程数、容器限额和反向代理。

## 限制

- 当前结果来自一台 Windows 主机，不代表 Linux、容器或云环境。
- 这是轻量 HTTP 微基准，不衡量开发体验、插件质量、可维护性或完整业务延迟。
- 不同日期、机器、依赖版本、handler 模式或压测协议的绝对数字不可直接合并排名。
- adapter matrix 与 Native/Fastify 主对照用途不同：前者观察组合开销，后者提供更严格的同场景对照。

## 相关链接

- [原始结果与完整样本](https://github.com/devcodex-labs/vextjs/blob/main/test/benchmark/RESULTS.md)
- [Benchmark 复现说明](https://github.com/devcodex-labs/vextjs/blob/main/test/benchmark/README.md)
- [Adapter 选择与配置](/guide/adapters)
- [生产部署](/guide/deployment)
- [配置参考](/api/config)
