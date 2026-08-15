# 性能基准

这份基准用于帮助你选择 Vext HTTP Adapter。它固定同一个 Vext 应用，在相同的轻量 Normal 负载下比较五个受支持的 Adapter。它适合作为 Adapter 选型输入，不替代你的应用在真实中间件、鉴权、日志、数据库和部署环境下的压测。

## 先看结论

- **这是 Adapter 对比，不是跨框架排行榜。** 每一行均使用相同的 Vext routes、Normal bootstrap、handler 模式、HTTP 契约、中间件 fixture 和压测协议；唯一变量是 Adapter。
- **本机和本负载下 Native 的吞吐最高。** 这是当前环境观测，不是它在所有环境中都最优的承诺。
- **本样本中 Fastify 与 Koa 的吞吐随后，Hono 与 Express 则取舍各自的编程模型和生态。** 对于较小差异，请结合 CV 和延迟数据判断。
- **先按集成和迁移需求选择，再用你的业务复测。** Native 是依赖更轻的默认路径；需要相应生态时选择 Fastify、Express、Koa 或 Hono。

<!-- benchmark-results:start -->

## 当前结果

本次正式运行记录于 **2026-08-15T00:07:37.413Z**，使用干净的 Vext 源码 `main@772d3eab9f3826a55526deaf2ad6b1c128bda446`（Vext 1.0.1；Node.js v20.20.2）。所有数字均为 **7** 轮 req/s 的中位数，数值越高表示该测试场景中的吞吐越高。

| 场景                |    Native |      Hono |   Fastify |  Express |       Koa |
| ------------------- | --------: | --------: | --------: | -------: | --------: |
| JSON 响应           | 25,085.82 | 11,158.19 | 22,191.28 | 7,651.82 | 19,017.46 |
| 参数路由            |  24,773.1 |    10,652 | 21,961.46 | 7,554.37 | 18,678.55 |
| 处理器业务链        | 21,802.91 |     9,387 |  18,865.6 |  7,155.2 | 16,527.64 |
| route middleware 链 | 21,584.73 |     9,383 |  18,729.1 | 7,137.64 | 16,219.64 |

全部 20 个 Adapter/场景测量均为零错误、零超时、零非 2xx 响应。每个场景的 CV 在 0.2%–1.4% 之间。[查看站内完整结果与全部样本](/zh/benchmark/results.html)，其中包含 P50/P99、精确版本、provenance 和路由生命周期 telemetry。

<!-- benchmark-results:end -->

## 为什么这样对比

面向使用者的决策是**选择哪个 Vext Adapter**，所以每个目标均运行同一个 Vext Normal 应用。routes、`defineRoutes()` 加载、路由匹配、请求/响应对象、中间件 fixture、handler 模式、响应契约、进程优先级和 Autocannon 协议均保持不变，唯一变量是 Adapter。

fixture 有意关闭这些 GET 场景不使用的可选请求能力：access log、生成的 request ID、CORS、rate limit、response wrap、body parser、request context、session、CSRF、security headers、frontend render 和应用日志。它仍保留 Normal bootstrap 与路由生命周期。因此比较具有聚焦性和可复现性，但它不是全能力生产负载，也不是数据库/I/O 基准。

裸框架与最短路径测量仍作为维护者诊断保留；它们回答的是另一个问题，不用于本页的 Adapter 排名。

### 如何选择

| 需求                                         | 建议起点       | 需要注意                                                               |
| -------------------------------------------- | -------------- | ---------------------------------------------------------------------- |
| 新项目、希望减少 HTTP 框架依赖               | Native（默认） | 用真实业务负载确认吞吐与延迟目标                                       |
| 已确定需要 Fastify 相关能力                  | Fastify        | Vext middleware 与底层原生 middleware 的签名不同，先核对集成边界       |
| 从 Express 或 Koa 迁移、团队已有经验         | 对应 adapter   | 不要仅依据开销百分比选择，先验证现有中间件的迁移方式                   |
| Node.js 服务中需要 Hono / Web Standards 风格 | Hono           | 当前是 Node.js adapter，不是 Edge 运行时承诺；对 bridge 敏感负载应实测 |

详细安装和配置请参见 [Adapter 指南](/guide/adapters)。

## 测试口径

| 项目   | 当前正式样本                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------ |
| 环境   | Node.js 20.20.2、Windows x64、Intel i7-9700、32 GiB RAM                                                                  |
| 负载   | 50 connections、pipelining 10、每次测量 10 秒                                                                            |
| 稳定性 | 5 秒预热、7 轮中位数、轮次顺序轮转、CV ≤ 20%                                                                             |
| 进程   | runner 与被测子进程使用相同 normal 优先级 0                                                                              |
| 依赖   | Fastify 5.12.0、Hono 4.13.2、`@hono/node-server` 2.1.1、Express 5.2.1、Koa 3.2.1、`@koa/router` 15.7.0、Autocannon 8.0.0 |

正式运行前，runner 会将这些依赖与当日 npm `latest` 核对；任一版本、源码身份、非 2xx、连接错误、超时、缺失结果或 CV 门禁失败都会拒绝生成可引用报告。目标按轮次交错执行，减少时间漂移固定偏向某一实现。

## 自己复现

先安装锁文件中的依赖并确认 benchmark 版本仍是当前 npm `latest`：

```bash
npm ci
npm run verify:benchmark-deps
```

运行与本页一致的公开 Adapter 对照：

```bash
node --expose-gc --max-old-space-size=512 test/benchmark/run-adapter-matrix.mjs --formal --scenario all --duration 10 --connections 50 --pipelining 10 --warmup 5 --rounds 7 --max-cv 20 --process-priority 0 --handler-mode sync
```

本样本使用同步 handler。如果你的平台或权限需要不同的优先级，请改用可用值，并将结果视为新的环境基线，不要直接与本页绝对数值比较。

runner 使用本地 Autocannon **programmatic API**，会自动启动和停止测试目标。[站内完整结果](/zh/benchmark/results.html)包含全部样本、P50/P99、精确版本、provenance 和路由生命周期 telemetry；完整参数、adapter matrix 命令和 artifact 合并规则见 [benchmark README](https://github.com/devcodex-labs/vextjs/blob/main/test/benchmark/README.md)。

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
- 本表只比较 Vext Adapter。裸框架与最短路径诊断单独维护，不是面向使用者的 Adapter 排名。

## 相关链接

- [结果与完整样本](/zh/benchmark/results.html)
- [Benchmark 复现说明](https://github.com/devcodex-labs/vextjs/blob/main/test/benchmark/README.md)
- [Adapter 选择与配置](/guide/adapters)
- [生产部署](/guide/deployment)
- [配置参考](/api/config)
