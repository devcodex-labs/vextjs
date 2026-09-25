# 请求限流

VextJS 的全局限流默认关闭。显式启用后，可以按 IP、自定义请求键或受支持的用户字段计数，并为单个路由覆盖额度或跳过限流。架构边界见[安全与资源规范](/zh/specification/security-and-resources#vext-sec-004)。

## 运行一个最小示例

前置条件：按[快速开始](/zh/guide/quick-start)准备 TypeScript 项目，npm scripts 为 `dev: vext dev`、`build: vext build`、`start: vext start`。下面两个文件使用进程内 Store；启动一个新进程后按顺序测试，以免先前请求影响计数。已有配置时合并字段。

```typescript
// src/config/default.ts
import type { VextUserConfig } from "vextjs";

export default {
  host: "127.0.0.1",
  port: 3000,
  adapter: "native",
  frontend: { enabled: false },
  rateLimit: {
    enabled: true,
    max: 2,
    window: 60,
    keyBy: (req) => `${req.ip}:${req.path}`,
    store: "memory",
  },
} satisfies VextUserConfig;
```

这里特意使用“IP + 实际路径”作为演示键，让三个入口分别计数。真实接口的动态路径可能产生大量不同键，生产策略应根据资源与访问维度设计，不能直接把这个演示键当成所有接口的通用策略。

```typescript
// src/routes/limits.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, async (_req, res) => {
    res.json({ ok: true });
  });
  app.get(
    "/once",
    { override: { rateLimit: { max: 1, window: 60 } } },
    async (_req, res) => {
      res.json({ ok: true });
    },
  );
  app.get("/free", { override: { rateLimit: false } }, async (_req, res) => {
    res.json({ ok: true });
  });
});
```

执行 `npm run dev`，以下请求对应示例的 `http://127.0.0.1:3000`；Windows PowerShell 可使用 `curl.exe`：

```bash
curl -i http://127.0.0.1:3000/limits
curl -i http://127.0.0.1:3000/limits
curl -i http://127.0.0.1:3000/limits
curl -i http://127.0.0.1:3000/limits/once
curl -i http://127.0.0.1:3000/limits/once
curl -i http://127.0.0.1:3000/limits/free
```

| 顺序                 | 预期结果                                                   |
| -------------------- | ---------------------------------------------------------- |
| `/limits` 第1、2次   | HTTP 200                                                   |
| `/limits` 第3次      | HTTP 429，`code: 429`，默认 `message: "Too Many Requests"` |
| `/limits/once` 第1次 | HTTP 200                                                   |
| `/limits/once` 第2次 | HTTP 429                                                   |
| `/limits/free`       | HTTP 200，无限流响应头；可重复访问                         |

429 使用直接 JSON 响应，包含 `code`、`message`、`requestId`，不要按成功响应的 `data` 包装解析它。停止开发服务，执行 `npm run build -- --typecheck`、`npm start`，再按相同顺序复验。等待窗口恢复或重新启动本演示的内存进程后再重复测试；重启应用不会清空 Redis 中已有的计数。

## 配置、单位与覆盖

| 字段      | 默认值              | 含义                           |
| --------- | ------------------- | ------------------------------ |
| `enabled` | `false`             | 框架启动是否注册全局限流       |
| `max`     | `100`               | 当前窗口的请求额度             |
| `window`  | `60`                | 窗口长度，单位**秒**           |
| `message` | `Too Many Requests` | 超限响应文案                   |
| `keyBy`   | `"ip"`              | 内置维度或同步返回字符串的函数 |
| `store`   | `"memory"`          | 内置 Store；也支持 Redis 配置  |

`RouteOptions.override.rateLimit` 可以设置 `max`、`window`、字符串 `keyBy`，或设为 `false` 跳过。公开路由类型不接受自定义 key 函数或单路由 Store。全局未启用时，仅写路由覆盖不会注册限流中间件。

底层内置 limiter 使用滑动窗口。默认 IP 键不含路由路径；内存 Store 中相同 max/window 的请求会进入同一 limiter，相同 key 共享额度。需要独立额度时应设计相应 key，并验证同键、不同键和不同路由的行为。Redis 的不同 max/window limiter 还会共用 Store，不能靠改变额度参数隔离 Redis 计数。

计数发生在请求进入后续业务之前，后续业务成功或失败都不会自动回滚；超额的尝试本身也会计入滑动窗口。因此持续重试可能延后恢复，客户端应遵守退避策略，不能把重置头理解成“整个额度在这一秒全部恢复”。

| 响应头                | 含义                                                               |
| --------------------- | ------------------------------------------------------------------ |
| `RateLimit-Limit`     | 当前有效 max                                                       |
| `RateLimit-Remaining` | 剩余次数                                                           |
| `RateLimit-Reset`     | 当前窗口最早一条记录到期的剩余秒数，不是 Unix 时间戳或整桶恢复承诺 |
| `Retry-After`         | 429 时返回的建议重试秒数，至少1秒                                  |

## IP、用户与认证顺序

- `keyBy: "ip"` 使用框架解析的 `req.ip`，代理环境必须核对客户端地址与信任配置。
- `keyBy: "user"` 读取 `req.user.id`；缺失时回退到 IP。它不会自动读取 `req.auth.subject` 或 `req.auth.userId`。其他字符串也按 IP 处理，例如 `"tenant"` 并不会自动读取租户字段。
- 全局限流在插件全局中间件和路由中间件之前执行。普通认证中间件后来才写入的身份，在这个位置通常尚不可用。
- 自定义 key 函数接收当时的请求，应同步返回非空字符串；不要依赖后续 Schema 校验结果或使用异步函数。若需要认证后的业务额度，应在认证完成后的明确位置实现和验证该策略。

身份接入见[认证与安全](/zh/guide/security)。限流不能替代接口授权或对象权限检查。

## 多 worker 与 Redis

内存额度属于当前进程，多 worker/多实例不会自动共享。需要统一计数时，选择 Redis Store，并给实际共享的一组实例使用一致的 namespace/keyPrefix。

`rateLimit.store` 支持 `"memory"`、`"redis"` 或 Redis 配置对象；对象必须指定 `type: "redis"`，可以提供 `url`、`uri` 或已有 `client`。地址选择顺序为 `url` → `uri` → `VEXT_REDIS_URL` → `REDIS_URL`；不能假设裸 `"redis"` 会自动发现正确服务。字段与环境选择见[配置 API](/zh/api/config)。

显式 `keyPrefix` 优先于 namespace；没有显式前缀/namespace 时，默认按项目包名、配置 profile、运行模式和模块生成前缀。跨实例共享时核对最终前缀一致；不同应用/环境需要隔离。Redis key 不会自动附加路由或 max/window，不同策略使用同一 key 可能互相影响计数和过期清理。

框架创建的 Redis 客户端会随限流运行时关闭；传入的外部客户端不由该运行时关闭。关闭自定义 limiter 的资源也需要应用显式安排，`setRateLimiter()` 本身不接管客户端生命周期。

### 存储故障与放行策略

当前内置依赖在算法或 Store 检查抛错时会记录错误并返回 `allowed: true`，请求可能继续进入业务，而不是必然返回500。Redis 断连还可能先经历连接/命令重试，不能承诺立即返回；即使请求成功或响应带有限流头，也不能据此认定共享存储正常。

这与初始化时缺少 Redis 目标导致启动失败、以及自定义 `check()` 抛错进入框架错误处理链（默认500）是不同路径。框架没有公开一个配置开关将内置故障策略直接切换为拒绝请求。需要存储故障时拒绝的业务，应选择明确实现该策略的自定义 limiter 或入口层限流，并验证故障与恢复行为。

## 自定义 limiter

插件可以通过 `app.setRateLimiter()` 提供 `check(key)`，返回 `allowed`、`remaining` 与 `resetAt`；全局仍须启用 `rateLimit.enabled: true`。这里 `resetAt` 是**秒单位的绝对 Unix 时间戳**，框架再转为响应头中的剩余秒数。

自定义接口只收到 key；框架仍处理 key 生成、启用/跳过、响应头与429，但路由 `max/window` 不会自动变成自定义算法的参数。替换时需要明确自己的额度策略，并核对响应头与真实策略相符。它是应用扩展点，不能把内置 limiter 的全部参数语义自动套到替换实现。

## 排查与验证

| 症状                       | 检查与处理                                   | 复验                                             |
| -------------------------- | -------------------------------------------- | ------------------------------------------------ |
| 路由写了额度但不生效       | 全局 enabled 是否为true                      | 用低额度重复请求，确认429                        |
| 不同用户共享额度           | keyBy读取字段和认证时机，是否回退IP          | 分别验证同IP不同身份的真实key策略                |
| 扩容后总额度变大           | 是否各进程仍使用memory                       | 在不同worker请求并检查共享Store计数              |
| 多实例不共享Redis额度      | 目标地址、profile/mode与prefix是否一致       | 用同key跨实例测试                                |
| Redis故障时仍200或等待较久 | 检查存储错误日志、连接重试与内置错误放行策略 | 用受控故障验证是否进入业务，再验证恢复后的计数   |
| 自定义limiter抛错时500     | 检查check异常与应用的错误处理                | 区分主动拒绝（allowed:false，429）和基础设施异常 |

应用测试 helper 默认关闭限流，验证此功能时须传入 `rateLimit.enabled: true`，不要把测试默认值误认为生产配置已生效。
