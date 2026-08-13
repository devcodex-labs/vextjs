# 性能基准测试

本页展示 VextJS 与其他主流 Node.js Web 框架的性能基准对比数据。当前版本的可复现基准以仓库内 `test/benchmark/run-benchmark.mjs` 为准；页面中的历史 benchmark 仓库数据仅用于趋势参考。

## 当前可复现结果（2026-08-14，本地时区）

> - **代码身份**：`main@cea18d760592b790d602f61f343e8d71c4a35735`
> - **协议**：10 秒 / 50 connections / pipelining 10 / 预热 5 秒 / 5 轮取中位数
> - **环境**：Node.js 20.20.2、win32 x64、Intel i7-9700、32 GiB RAM
> - **依赖版本**：Fastify 5.11.3、Hono 4.13.2、`@hono/node-server` 2.1.0、Express 5.2.1、Koa 3.2.1、`@koa/router` 15.7.0、Autocannon 8.0.0（均在正式运行前从 registry 核验并锁定）

这组结果替代下方 2026-01-15 的历史数值作为当前参考。完整的 5 轮样本、CV、延迟和 telemetry 见[主基准原始报告](https://github.com/devcodex-labs/vextjs/blob/main/test/benchmark/RESULTS.md)。

### Native 与 Fastify 的主对照

所有数字均为 req/s 中位数。**Core** 是仅用于定位最短 Vext Native 路径的私有 harness，不经过 bootstrap；**Normal** 走正式 bootstrap + router-loader，但为公平比较关闭了可选请求能力。Normal 中 `requestContext=false` 时不会注册 `authContext`，`frontend.enabled=false` 时不会注册 noop middleware；普通路由只保留一个全局 `requestHook` 节点。

| 同步 handler 场景        | Raw Native | Raw Fastify | Vext Native Core | Vext Native Normal |
| ------------------------ | ---------: | ----------: | ---------------: | -----------------: |
| JSON                     |     35,283 |      33,726 |           30,299 |             29,691 |
| 参数路由                 |     34,073 |      33,206 |           28,612 |             28,066 |
| 处理器业务链             |     29,726 |      32,240 |           24,376 |             25,244 |
| 真实 route middleware 链 |     28,907 |      28,108 |                — |             24,741 |

| 异步 handler 场景        | Raw Native | Raw Fastify | Vext Native Core | Vext Native Normal |
| ------------------------ | ---------: | ----------: | ---------------: | -----------------: |
| JSON                     |     34,773 |      33,520 |           28,848 |             28,783 |
| 参数路由                 |     33,810 |      34,141 |           27,946 |             27,839 |
| 处理器业务链             |     28,559 |      30,335 |           25,061 |             23,927 |
| 真实 route middleware 链 |     28,319 |      29,115 |                — |             23,755 |

结论不能写成“Fastify 总是更快”或“Vext 排名第二”：Raw Native 与 Raw Fastify 在不同场景、同步/异步模型下互有领先。当前合成路径中，Vext Native Normal 相对 Raw Native 的差距为 14%–18%，相对 Raw Fastify 的差距为 12%–22%；这是框架的路由、请求/响应对象和生命周期成本，不能外推为真实业务的端到端吞吐承诺。

### 五个 adapter 的最新矩阵

下表是同一协议下、各 adapter 的 Raw 对照与 Vext 对照的开销（Vext 相对该 adapter Raw，负值表示较低）。它用于观察 adapter 开销，不用于将不同框架的 Raw 吞吐排成总榜。

| Adapter |   JSON | 参数路由 | 处理器业务链 | route middleware 链 |
| ------- | -----: | -------: | -----------: | ------------------: |
| Native  | -16.3% |   -14.2% |       -16.1% |              -13.3% |
| Fastify | -28.7% |   -28.1% |       -30.4% |              -32.3% |
| Express |  -6.4% |   -10.0% |       -10.1% |              -11.0% |
| Koa     | -22.6% |   -21.0% |       -23.0% |              -26.7% |
| Hono    | -65.5% |   -65.7% |       -61.9% |              -61.8% |

Hono 的差距是独立的 adapter 优化课题；它不应被混入 Native 与 Fastify 的公平性结论。生产选型还应以真实中间件、认证、日志、序列化、I/O 与部署环境的压测为准。

## 对比口径说明（请先阅读）

当前 repo-local benchmark 衡量的是**相同场景、相同压测参数、尽量相同功能负载**下的吞吐量对比，而不是“默认开箱全功能配置”的直接对比。

- **Raw（裸跑）**：直接使用底层框架原生 API 实现同一测试场景
- **Vext**：通过 Vext 启动相同场景，但为了与 Raw 公平对比，会关闭非必要默认能力，只保留 adapter / 路由层核心开销
- **chain**：历史兼容场景，表示 handler 内联业务逻辑链
- **middleware-chain**：真实 route-level middleware chain，会进入 adapter 的中间件链执行器

当前 benchmark 中，Vext 侧会关闭或收紧以下非核心默认能力：

- `accessLog`
- `requestId`
- `cors`
- `rateLimit`
- `response.wrap`
- `bodyParser`
- `requestContext`
- 日志级别改为 `silent`

> ⚠️ 这意味着：本页数据更接近“框架核心路径 / adapter 层”的对比结果，而**不是**默认生产配置下开启全部内置能力时的最终吞吐量承诺。
>
> 若你要评估真实业务场景，请结合自己的中间件、日志、鉴权、响应包装、数据库访问和部署环境重新压测。

## 历史数据环境（2026-01-15，仅趋势参考）

> 下方所有历史章节使用的是另一台机器、另一套依赖和负载协议；不得与上方当前结果直接比较，也不得据此得出当前版本的框架排名。

| 项目         | 规格                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------- |
| **CPU**      | Intel Core i9-13900K (24 核 / 32 线程)                                                        |
| **内存**     | 64 GB DDR5-5600                                                                               |
| **操作系统** | Ubuntu 22.04 LTS                                                                              |
| **Node.js**  | v22.12.0                                                                                      |
| **测试工具** | [autocannon](https://github.com/mcollina/autocannon) v8.0.0（通过 `npm exec --package` 调用） |
| **并发连接** | 100                                                                                           |
| **持续时间** | 30 秒                                                                                         |
| **预热**     | 5 秒（不计入统计）                                                                            |

> ⚠️ **注意**: 性能基准测试结果受测试环境、负载模式和代码实现方式影响较大。建议在自己的硬件上运行基准测试以获得最准确的结果。

---

## Hello World 基准

最简路由场景：返回固定字符串响应，不含任何业务逻辑，测试框架原始吞吐量。

### 测试代码

::: code-tabs
@tab VextJS

```typescript
// src/routes/index.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, async (req, res) => {
    res.json({ message: "Hello, World!" });
  });
});
```

@tab Fastify

```javascript
const fastify = require("fastify")();

fastify.get("/", async () => {
  return { message: "Hello, World!" };
});

fastify.listen({ port: 3000 });
```

@tab Express

```javascript
const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.json({ message: "Hello, World!" });
});

app.listen(3000);
```

@tab Hono (Node)

```typescript
import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();

app.get("/", (c) => c.json({ message: "Hello, World!" }));

serve({ fetch: app.fetch, port: 3000 });
```

:::

### 结果

| 框架                | 请求/秒 (avg) | 延迟 p50 | 延迟 p95 | 延迟 p99 |  吞吐量   |
| ------------------- | :-----------: | :------: | :------: | :------: | :-------: |
| **VextJS** (Native) |  **98,421**   |  0.9 ms  |  1.8 ms  |  3.2 ms  | 18.2 MB/s |
| VextJS (Fastify)    |    87,653     |  1.1 ms  |  2.1 ms  |  3.8 ms  | 16.2 MB/s |
| VextJS (Hono)       |    72,841     |  1.3 ms  |  2.5 ms  |  4.4 ms  | 13.5 MB/s |
| Fastify v5          |    85,320     |  1.1 ms  |  2.2 ms  |  3.9 ms  | 15.8 MB/s |
| Hono v4 (Node)      |    68,412     |  1.4 ms  |  2.7 ms  |  4.9 ms  | 12.7 MB/s |
| Express v5          |    18,934     |  4.9 ms  |  9.8 ms  | 17.2 ms  | 3.5 MB/s  |
| Koa v2              |    24,716     |  3.8 ms  |  7.6 ms  | 13.4 ms  | 4.6 MB/s  |
| NestJS (Express)    |    16,821     |  5.5 ms  | 11.2 ms  | 19.8 ms  | 3.1 MB/s  |
| NestJS (Fastify)    |    79,234     |  1.2 ms  |  2.3 ms  |  4.1 ms  | 14.7 MB/s |

> 历史数据来源：[benchmark 仓库](https://github.com/vextjs/benchmarks)，2026-01-15 测试。当前版本复现实测请优先运行本仓库 `test/benchmark/run-benchmark.mjs`。

---

## JSON 序列化基准

测试返回包含嵌套对象的 JSON 响应的性能，贴近真实 API 场景。

### 响应结构

```json
{
  "id": 1,
  "name": "John Doe",
  "email": "john@example.com",
  "createdAt": "2026-01-15T08:00:00.000Z",
  "profile": {
    "avatar": "https://example.com/avatar.png",
    "bio": "Software Engineer",
    "location": "Shanghai, China"
  },
  "roles": ["user", "admin"],
  "metadata": {
    "loginCount": 42,
    "lastLogin": "2026-01-14T20:30:00.000Z"
  }
}
```

### 结果

| 框架                | 请求/秒 (avg) | 延迟 p50 | 延迟 p95 | 延迟 p99 |
| ------------------- | :-----------: | :------: | :------: | :------: |
| **VextJS** (Native) |  **91,247**   |  1.0 ms  |  2.0 ms  |  3.5 ms  |
| VextJS (Fastify)    |    81,334     |  1.1 ms  |  2.3 ms  |  4.0 ms  |
| VextJS (Hono)       |    67,523     |  1.4 ms  |  2.8 ms  |  4.9 ms  |
| Fastify v5          |    79,876     |  1.2 ms  |  2.4 ms  |  4.2 ms  |
| Hono v4 (Node)      |    62,103     |  1.5 ms  |  3.0 ms  |  5.3 ms  |
| Express v5          |    16,782     |  5.6 ms  | 11.3 ms  | 19.9 ms  |
| NestJS (Fastify)    |    73,910     |  1.3 ms  |  2.6 ms  |  4.6 ms  |

---

## 参数校验基准

测试在路由处理时进行请求参数校验的性能开销，VextJS 使用内置 schema-dsl 校验，其他框架使用 zod 或 joi。

### 测试场景

POST 请求，Body 包含 10 个字段，包括字符串、数字、枚举和嵌套对象。

| 框架                             | 请求/秒 (avg) | 延迟 p50 | 延迟 p95 |     校验库      |
| -------------------------------- | :-----------: | :------: | :------: | :-------------: |
| **VextJS** (Native + schema-dsl) |  **84,312**   |  1.1 ms  |  2.2 ms  | 内置 schema-dsl |
| VextJS (Fastify + schema-dsl)    |    74,891     |  1.2 ms  |  2.5 ms  | 内置 schema-dsl |
| Fastify v5 (ajv)                 |    78,234     |  1.2 ms  |  2.4 ms  |     ajv v8      |
| Fastify v5 (zod)                 |    51,823     |  1.8 ms  |  3.7 ms  |     zod v3      |
| Express + zod                    |    12,341     |  7.6 ms  | 15.3 ms  |     zod v3      |
| NestJS (class-validator)         |    42,156     |  2.2 ms  |  4.4 ms  | class-validator |

> VextJS 的 schema-dsl 基于 ajv 编译，拥有接近原生 ajv 的校验性能，同时提供更简洁的 DSL 语法。

---

## 中间件链基准

测试经过 5 层中间件后的最终路由处理性能，模拟真实应用中认证、日志、限流等中间件叠加场景。

### 中间件配置

5 层中间件：

1. 请求 ID 注入
2. 请求日志记录（内存 Buffer，不写磁盘）
3. JWT 验证（跳过签名验证，仅解析）
4. 限流检查（内存计数器）
5. 响应头注入

| 框架                | 请求/秒 (avg) | 较无中间件损耗 | 延迟 p99 |
| ------------------- | :-----------: | :------------: | :------: |
| **VextJS** (Native) |  **79,834**   |     -18.9%     |  4.1 ms  |
| VextJS (Fastify)    |    57,221     |     -21.5%     |  5.6 ms  |
| Fastify v5          |    68,901     |     -19.2%     |  4.8 ms  |
| Express v5          |    13,421     |     -29.1%     | 22.4 ms  |
| Koa v2              |    18,934     |     -23.4%     | 18.1 ms  |

---

## Adapter 对比

VextJS 支持多种底层 HTTP Adapter，性能差异主要来源于底层 HTTP 实现：

| Adapter          | 请求/秒 (Hello World，历史) | 特性                                              | 适用场景              |
| ---------------- | :-------------------------: | ------------------------------------------------- | --------------------- |
| `native`（默认） |           ~98,000           | 零外部 HTTP 框架依赖，Node 原生 http + route-core | 推荐，性能最高        |
| `fastify`        |           ~87,000           | 高性能 + 生态丰富                                 | 需要 Fastify 插件生态 |
| `hono`           |           ~72,000           | Web Standards API，超轻量                         | 全栈 / 边缘运行时     |
| `express`        |           ~18,000           | 最大中间件生态                                    | 迁移现有 Express 项目 |
| `koa`            |           ~24,000           | 轻量优雅                                          | 中小型项目            |
| `node-cluster`   |         ~340,000\*          | 多进程，线性扩展                                  | 多核 CPU 服务器       |

> `*` Cluster 数据为 8 核 worker 合计吞吐量（单进程 ×8 近线性扩展）。
> 注：uWS（uWebSockets.js）adapter 尚未内置，列为未来规划（roadmap）。

### Adapter 性能可视化

```
Native      ████████████████████████████████████████  98,421 req/s
Fastify     ████████████████████████████████████      87,653 req/s
Hono        ████████████████████████████████          72,841 req/s
Koa         ██████████                                24,716 req/s
Express     ████████                                  18,934 req/s
```

---

## Cluster 模式基准

测试在多核环境下，VextJS Cluster 模式与单进程模式的吞吐量对比：

| 模式            | Worker 数 | 请求/秒 | CPU 利用率 |  内存  |
| --------------- | :-------: | :-----: | :--------: | :----: |
| 单进程 (Native) |     1     | 98,421  |    12%     | 48 MB  |
| Cluster × 2     |     2     | 192,834 |    24%     | 96 MB  |
| Cluster × 4     |     4     | 381,201 |    47%     | 192 MB |
| Cluster × 8     |     8     | 743,892 |    91%     | 384 MB |
| Cluster × 16    |    16     | 891,234 |    98%     | 768 MB |

> 8 核以上受 CPU 调度开销影响，扩展效率略有下降，但仍接近线性扩展。

---

## 内存基准

框架空载时的内存占用（仅启动 HTTP 服务器，无请求处理）：

| 框架                | 启动内存  | 10 万请求后 | GC 压力 |
| ------------------- | :-------: | :---------: | :-----: |
| **VextJS** (Native) | **18 MB** |    22 MB    |   低    |
| VextJS (Hono)       |   24 MB   |    28 MB    |   低    |
| VextJS (Fastify)    |   31 MB   |    38 MB    |   低    |
| Fastify v5          |   29 MB   |    36 MB    |   低    |
| Express v5          |   42 MB   |    58 MB    |   中    |
| NestJS (Express)    |   86 MB   |   112 MB    |   中    |
| NestJS (Fastify)    |   71 MB   |    94 MB    |  低-中  |

---

## 启动时间

从进程启动到第一个请求可响应的时间（冷启动）：

| 框架                | 冷启动时间 | 热重载时间 |
| ------------------- | :--------: | :--------: |
| **VextJS** (Native) | **42 ms**  |   180 ms   |
| VextJS (Fastify)    |   68 ms    |   210 ms   |
| Fastify v5          |   61 ms    |     —      |
| Express v5          |   38 ms    |     —      |
| NestJS              |  1,240 ms  |     —      |

> VextJS 热重载时间包含 esbuild 增量编译 + worker 替换的完整流程，实际热重载感知延迟约 200 ms。

---

## 如何自行运行基准测试

### 运行当前仓库内基准

```bash
npm install
npm run test:bench -- --scenario all --rounds 5
```

### 运行单个框架

```bash
# 仅测试 VextJS (Native)
npm run test:bench -- --framework native --scenario all --rounds 5

# 仅测试 VextJS (Fastify)
npm run test:bench -- --framework fastify --scenario all --rounds 5

# 仅测试真实 route-level middleware chain
npm run test:bench -- --scenario middleware-chain --rounds 5
```

### 使用 autocannon 手动测试

当前仓库的 benchmark runner 会自动启动/停止测试服务器，并通过 `npm exec --package=autocannon@8.0.0` 调用 autocannon。通常不需要手动启动服务器。

如需对一个已启动的本地服务单独压测，可直接运行：

```bash
# 运行 autocannon
npx --yes --package=autocannon@8.0.0 autocannon -c 100 -d 30 -p 10 http://localhost:3000/
```

### 配置说明

当前 benchmark 通过 CLI 参数配置，不存在 `bench.config.ts`：

| 参数            | 默认值                      | 说明                                                     |
| --------------- | --------------------------- | -------------------------------------------------------- |
| `--duration`    | `15`                        | 压测持续秒数                                             |
| `--connections` | `50`                        | 并发连接数                                               |
| `--pipelining`  | `10`                        | HTTP pipeline 深度                                       |
| `--warmup`      | `5`                         | 预热秒数                                                 |
| `--rounds`      | `1`                         | 轮次；PR / 发版前建议 5 或 7                             |
| `--scenario`    | `all`                       | `json` / `params` / `chain` / `middleware-chain` / `all` |
| `--framework`   | 全部                        | 框架过滤，逗号分隔                                       |
| `--output`      | `test/benchmark/RESULTS.md` | 报告输出路径                                             |

---

## 结论

- 当前可引用的结果是页面顶部的 2026-08-14 5 轮正式测量和对应原始报告；下方数字均为历史参考。
- Raw Native 与 Raw Fastify 的领先项随场景和 handler 模型变化，不能据此宣布通用总排名。
- Vext Native Normal 已确认不存在被禁用的 `authContext` 或 frontend noop middleware 遗留在请求链中；其剩余差距主要是可见的框架运行时成本。
- Hono adapter 的当前差距显著高于其他 adapter，已明确为独立后续优化方向，而不是掩盖在 Native/Fastify 结论里的数据。

### 性能建议

| 场景                           | 推荐配置                                                   |
| ------------------------------ | ---------------------------------------------------------- |
| 极致性能（云原生，单机高并发） | `adapter: 'native'` + Cluster × CPU核数                    |
| 生产环境（通用）               | `adapter: 'native'` 或 `'fastify'` + Cluster × (CPU核数-1) |
| 轻量部署（容器 / 边缘）        | `adapter: 'native'`，单进程，零框架依赖                    |
| 全栈 / 边缘运行时              | `adapter: 'hono'`，兼容 Web Standards API                  |
| 开发环境                       | `adapter: 'native'`（默认），热重载最快                    |

---

## 相关链接

- [当前 benchmark 源码与原始报告](https://github.com/devcodex-labs/vextjs/tree/main/test/benchmark) — 可复现命令、测试代码和最新原始数据
- [Adapter 架构](/guide/adapters) — 了解各 Adapter 的技术实现
- [Cluster 多进程](/guide/cluster) — 如何配置和使用 Cluster 模式
- [配置项](/api/config) — `adapter` 配置字段详情
