# 性能基准测试

本页展示 VextJS 与其他主流 Node.js Web 框架的性能基准对比数据。所有测试均在相同硬件环境下运行，以确保公平比较。

## 对比口径说明（请先阅读）

这些数据衡量的是**相同场景、相同压测参数、尽量相同功能负载**下的吞吐量对比，而不是“默认开箱全功能配置”的直接对比。

- **Raw（裸跑）**：直接使用底层框架原生 API 实现同一测试场景
- **Vext**：通过 Vext 启动相同场景，但为了与 Raw 公平对比，会关闭非必要默认能力，只保留 adapter / 路由层核心开销

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

## 测试环境

| 项目         | 规格                                                         |
| ------------ | ------------------------------------------------------------ |
| **CPU**      | Intel Core i9-13900K (24 核 / 32 线程)                       |
| **内存**     | 64 GB DDR5-5600                                              |
| **操作系统** | Ubuntu 22.04 LTS                                             |
| **Node.js**  | v22.12.0                                                     |
| **测试工具** | [autocannon](https://github.com/mcollina/autocannon) v7.15.0 |
| **并发连接** | 100                                                          |
| **持续时间** | 30 秒                                                        |
| **预热**     | 5 秒（不计入统计）                                           |

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

> 数据来源：[benchmark 仓库](https://github.com/vextjs/benchmarks)，2026-01-15 测试

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

| Adapter          | 请求/秒 (Hello World) | 特性                                     | 适用场景              |
| ---------------- | :-------------------: | ---------------------------------------- | --------------------- |
| `native`（默认） |        ~98,000        | 零框架依赖，Node 原生 http + find-my-way | 推荐，性能最高        |
| `fastify`        |        ~87,000        | 高性能 + 生态丰富                        | 需要 Fastify 插件生态 |
| `hono`           |        ~72,000        | Web Standards API，超轻量                | 全栈 / 边缘运行时     |
| `express`        |        ~18,000        | 最大中间件生态                           | 迁移现有 Express 项目 |
| `koa`            |        ~24,000        | 轻量优雅                                 | 中小型项目            |
| `node-cluster`   |      ~340,000\*       | 多进程，线性扩展                         | 多核 CPU 服务器       |

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

### 克隆基准仓库

```bash
git clone https://github.com/vextjs/benchmarks
cd benchmarks
pnpm install
```

### 运行所有基准

```bash
pnpm run bench
```

### 运行单个框架

```bash
# 仅测试 VextJS (Native)
pnpm run bench:vext-native

# 仅测试 VextJS (Fastify)
pnpm run bench:vext-fastify

# 仅测试 Express
pnpm run bench:express
```

### 使用 autocannon 手动测试

```bash
# 启动 VextJS 测试服务器
pnpm run start:vext &

# 运行 autocannon
npx autocannon -c 100 -d 30 -p 10 http://localhost:3000/

# 停止服务器
kill %1
```

### 配置说明

在 `bench.config.ts` 中调整测试参数：

```typescript
export default {
  connections: 100, // 并发连接数
  duration: 30, // 测试持续秒数
  warmup: 5, // 预热秒数
  pipelining: 1, // HTTP 管道化请求数
  workers: 1, // autocannon worker 线程数
};
```

---

## 结论

- **最高吞吐量**: VextJS + Native Adapter，在 Hello World 场景下达到约 **98,000 req/s**，开启 Cluster 模式可突破 **700,000 req/s**（8 核）
- **最低内存**: VextJS + Native Adapter，空载仅 **18 MB**，适合资源受限环境
- **最快启动**: VextJS + Native Adapter，冷启动约 **42 ms**，热重载约 **180 ms**
- **校验性能**: 内置 schema-dsl 基于 ajv 编译，校验开销极低，接近原生 ajv 性能
- **扩展性**: Cluster 模式下接近线性扩展，8 核可获得约 7.6× 的吞吐量提升

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

- [benchmarks 仓库](https://github.com/vextjs/benchmarks) — 完整测试代码和历史数据
- [Adapter 架构](/guide/adapters) — 了解各 Adapter 的技术实现
- [Cluster 多进程](/guide/cluster) — 如何配置和使用 Cluster 模式
- [配置项](/api/config) — `adapter` 配置字段详情
