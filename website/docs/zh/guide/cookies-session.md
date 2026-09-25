# Cookies 与 Sessions

Vext 提供 Cookie 读取/写入、配置驱动的 Session 和 CSRF 中间件，覆盖 Native、Hono、Fastify、Express、Koa adapter。基础 Cookie 和内存 Session 不需要额外安装库；使用 Redis 等外部 Store 时需要对应客户端。本页先跑通一个完整流程，再说明保存、隔离和失败边界。

## 先运行 Cookie、Session 与 CSRF 流程

按[快速开始](/zh/guide/quick-start)准备 TypeScript 应用，npm scripts 为 `dev: vext dev`、`build: vext build`、`start: vext start`。放入以下两个文件；已有配置时合并字段。本例用访问次数演示会话状态，身份认证另见[认证与安全](/zh/guide/security)。

```typescript
// src/config/default.ts
import type { VextUserConfig } from "vextjs";

export default {
  host: "127.0.0.1",
  port: 3000,
  adapter: "native",
  frontend: { enabled: false },
  session: { enabled: true },
  csrf: { enabled: true, mode: "session" },
} satisfies VextUserConfig;
```

```typescript
// src/routes/session-demo.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, async (req, res) => {
    res.json({
      theme: req.cookie("theme") ?? "system",
      visits: req.session!.visits ?? 0,
    });
  });
  app.get("/token", {}, async (req, res) => {
    res.json({ token: req.csrfToken() });
  });
  app.post("/visit", {}, async (req, res) => {
    const previous = req.session!.visits;
    req.session!.visits = (typeof previous === "number" ? previous : 0) + 1;
    res.cookie("theme", "dark", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 3600,
    });
    res.json({ visits: req.session!.visits });
  });
  app.post("/rotate", {}, async (req, res) => {
    await req.session!.regenerate();
    res.json({ visits: req.session!.visits ?? 0 });
  });
  app.post("/logout", {}, async (req, res) => {
    await req.session!.destroy();
    res.clearCookie("theme", { path: "/" });
    res.json({ ok: true });
  });
  app.get("/public", { session: false }, async (req, res) => {
    res.json({ hasSession: req.session !== undefined });
  });
});
```

执行 `npm run dev`。下列请求使用 `cookies.txt` 保存/发送 Cookie；请在示例目录执行，Windows PowerShell 可使用 `curl.exe`。先验证缺少token被拒绝，再取得token：

```bash
curl -i -X POST http://127.0.0.1:3000/session-demo/visit
curl -i -c cookies.txt http://127.0.0.1:3000/session-demo/token
```

第一条返回403、`CSRF_TOKEN_MISSING`。第二条返回200、`data.token`，并设置 `vext.sid` 和 `Cache-Control: no-store`。把下面 `TOKEN` 替换成返回的 token；保留同一份 cookies.txt，不能只发送token而丢失关联会话：

```bash
curl -i -b cookies.txt -c cookies.txt -X POST -H "x-csrf-token: TOKEN" http://127.0.0.1:3000/session-demo/visit
curl -i -b cookies.txt http://127.0.0.1:3000/session-demo
curl -i -b cookies.txt -X POST -H "x-csrf-token: invalid" http://127.0.0.1:3000/session-demo/visit
curl -i -b cookies.txt -c cookies.txt -X POST -H "x-csrf-token: TOKEN" http://127.0.0.1:3000/session-demo/rotate
curl -i -b cookies.txt -c cookies.txt -X POST -H "x-csrf-token: TOKEN" http://127.0.0.1:3000/session-demo/logout
curl -i -b cookies.txt http://127.0.0.1:3000/session-demo
curl -i http://127.0.0.1:3000/session-demo/public
```

| 步骤                   | 预期                                                |
| ---------------------- | --------------------------------------------------- |
| visit + 正确token/会话 | 200，visits为1，写入theme与会话Cookie               |
| 读取状态               | 200，theme为dark、visits为1                         |
| 错误token              | 403，CSRF_TOKEN_INVALID，次数不增加                 |
| rotate                 | 200，vext.sid改变，已有数据包括次数和CSRF token保留 |
| logout                 | 200，清除会话及theme Cookie，Store中原会话删除      |
| 再读状态               | 200，theme为system、visits为0                       |
| public                 | 200，hasSession为false                              |

以上使用默认成功响应包装，值位于 `data` 内。停止开发服务，执行 `npm run build -- --typecheck` 和 `npm start`，重新获取token及Cookie后复验。内存 Store 的数据不会跨应用进程重启保留；这也是重新获取token的原因。

## Cookies

每个请求都会暴露已解析的 cookies。以下路由片段放在 `defineRoutes((app) => { ... })` 内：

```typescript
app.get("/preferences", {}, async (req, res) => {
  const theme = req.cookie("theme") ?? "system";
  res.json({ theme, all: req.cookies });
});
```

通过 `res.cookie()` 设置 cookie，通过 `res.clearCookie()` 清除 cookie：

```typescript
res.cookie("theme", "dark", {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
});

res.clearCookie("theme", { path: "/" });
```

多次调用 `res.cookie()` 会输出多个 `Set-Cookie` 响应头。Vext 不会把它们用逗号合并。

`req.cookies` 是只读对象，重复 cookie name 采用 first-wins 语义。`res.cookie()` 也支持 `priority`、`partitioned` 和自定义 `encode` 函数等高级选项。

`maxAge` 的单位是秒，`expires` 接收 Date；普通 Cookie 的 `secure` 是布尔值，只有 Session/CSRF 配置额外支持 `"auto"`。清除时要匹配原 Cookie 的 path/domain。这些方法设置响应头，不会修改当前请求的 `req.cookies`，需要下一次请求携带新 Cookie 才能读到。

## Cookie 校验

`validate.cookie` 会校验已解析的 cookie 值，并生成 OpenAPI `in: cookie` 参数：

```typescript
app.get(
  "/me",
  {
    validate: {
      cookie: {
        sid: "string!",
      },
    },
  },
  async (req, res) => {
    const { sid } = req.valid("cookie");
    res.json({ sid });
  },
);
```

校验顺序为 `param -> query -> header -> cookie -> body`。

内置 OpenAPI 文档会把 `validate.cookie` 展示为 cookie 参数。浏览器 Try it out 不能直接设置受限的 `Cookie` header；如需手动 cookie 值，请使用同源页面已有 cookie、浏览器登录流程，或使用 cURL 等 HTTP 客户端。

## Sessions

Session 默认关闭。通过配置启用后，开发与生产启动链会注册运行时，软重载也遵循对应配置。`createTestApp()` 不自动读取项目配置，测试时必须显式传入 `config.session.enabled: true`：

```typescript
// 配置片段：合并到 src/config/default.ts
export default {
  session: {
    enabled: true,
  },
};
```

在 route handler 中使用 `req.session`：

```typescript
app.post("/demo-user", {}, async (req, res) => {
  // 固定值仅演示状态写入；真实登录须先验证身份，再更新会话。
  req.session!.userId = "u_123";
  res.json({ ok: true });
});

app.post("/logout", {}, async (req, res) => {
  await req.session!.destroy();
  res.json({ ok: true });
});
```

Session 对象支持：

| 方法           | 说明                                                           |
| -------------- | -------------------------------------------------------------- |
| `save()`       | 等待Store写入或刷新成功，并设置响应的session Cookie            |
| `regenerate()` | 删除旧id、生成新id并保留数据；新id等autoCommit或显式save持久化 |
| `destroy()`    | 删除 store 数据并清除 cookie                                   |

`id`、`isNew`、`save`、`regenerate`、`destroy` 等 session 元数据不可枚举，也不会被持久化进 store。

`autoCommit: true` 是默认值。普通响应发送屏障会等待需要执行的异步Store提交；失败时不会继续发出尚未发送的原成功响应和新会话Cookie。显式方法应顺序 `await`，然后再发送响应；不要并发调用它们或在响应后继续修改会话。已完成save且数据未再修改时，正常autoCommit不会重复写入；这不代表多请求之间有事务或并发更新保护。

`regenerate()` 不清空数据，也不会自动完成登录认证；`autoCommit: false` 时须再调用 `save()` 保存新id。`destroy()` 会删除Store条目并清除Cookie，不应在销毁后继续写入业务状态。流式响应或下载前，若有待保存的会话或启用了rolling，应先 `await req.session!.save()`，再调用 `res.stream()` / `res.download()`。

未修改的新会话在默认非rolling模式下不会仅因读取就写入Store或发送Cookie。普通读请求也不会刷新既有会话的TTL；rolling启用后会在响应时刷新。可持久化数据应与所选Store/serializer相容；多个请求同时修改同一会话需要应用/Store提供并发策略，框架不承诺自动合并。

## 配置

`config.session.enabled: true` 启用全局 Session 运行时，其余字段用于配置运行时：

```typescript
export default {
  session: {
    enabled: true,
    name: "vext.sid",
    ttl: 86400,
    rolling: false,
    autoCommit: true,
    idLength: 32,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: "auto",
    },
  },
};
```

ttl单位为秒，默认86400；Cookie maxAge未单独指定时跟随ttl。idLength是生成ID的随机字节数（16～128，默认32），不是编码后的字符串长度。`secure: "auto"` 仅在 `req.protocol === "https"` 时添加Secure，反向代理部署需核对trustProxy及实际协议。

默认memory Store会在访问时移除已过期条目，并通过有界的机会式 sweep 清理其余过期项，不创建阻止进程退出的timer；它适合开发、测试和接受进程内状态的单进程部署。多worker/多实例需共享Store；软重载不能代替对进程重启与数据持久化的设计。

### 可选：接入共享 Store

可使用根入口导出的 `createCacheSessionStore()` 接入结构型cache。以下为替换session字段的Redis配置片段，合并时保留主例的其他配置。消费项目先执行 `npm install cache-hub ioredis`，并准备自己的Redis服务；示例地址需按实际环境调整：

```typescript
import { createCacheSessionStore } from "vextjs";
import { createRedisCacheAdapter } from "cache-hub/redis";
import { Redis } from "ioredis";

// 配置也可能被build等命令读取；延迟到首次Store操作才建立连接。
const redis = new Redis("redis://localhost:6379", { lazyConnect: true });
const sessionCache = createRedisCacheAdapter(redis);

export default {
  session: {
    enabled: true,
    store: createCacheSessionStore(sessionCache, {
      prefix: "my-app:sess:",
      close: async () => {
        if (redis.status === "wait" || redis.status === "end") {
          redis.disconnect();
        } else {
          await redis.quit();
        }
      },
    }),
  },
};
```

`createCacheSessionStore()` 接收具备 `get`、`set`、`del` 的结构型 cache，把 `VextSessionStore` 的 TTL 秒转换为 cache 毫秒，默认把 session data 写成 JSON string，并用 cache `get` + `set` 实现 rolling `touch()`。消费项目需要自行安装 `cache-hub` 和选用的后端 client，例如 `ioredis`。

`config.cache.cacheHub` 与 `app.cache` 只服务路由响应缓存，不是 Session Store 捷径，也应与session使用不同键前缀。这里的prefix由应用选择，默认 `vext:session:` 不含自动项目/环境隔离；同组实例要一致，不同应用/环境应区分。`touch()` 的get/set不是原子更新，应按并发要求选择实现。

每个Session运行时关闭时会调用所用Store暴露的 `close()`，且仅调用一次；`createCacheSessionStore()` 仅在传入close回调时暴露它。上述cache-hub adapter包装外部Redis实例，adapter.close不会代替调用方关闭，所以示例将这个独占实例的关闭交给Store回调；若把同一客户端共享给其他模块，应另设统一关闭方。直接以URL创建cache-hub adapter时，它才拥有并关闭自己创建的连接。需要特殊持久化契约时，可直接实现get/set/delete及可选touch/close的 `VextSessionStore`。

公开路由可设置 `session: false` 跳过Session；这不会销毁已有Store数据或清除Cookie。全局运行时关闭时，可通过 `session: true` 或 `{ session: { enabled: true, rolling: true } }` 为单个路由启用；路由只覆盖enabled/rolling/autoCommit，不改变Store或Cookie身份。显式 `session()` 中间件仍保留给作用域化或手动注册场景；不要与全局配置重复使用。

## CSRF 防护

CSRF 防护通过 `csrf()` 与 `config.csrf` 提供。`mode: "auto"` 下，若配置的 Session 运行时已提供 `req.session`，Vext 会使用 session 同步 token；否则可在配置 `config.csrf.secret` 后使用签名 double-submit cookie。

本页开头的两文件示例提供完整token获取与提交流程。Session模式的token保存在服务端会话中；signed-cookie模式需稳定secret，用Cookie中的签名值核对客户端提交的原始token。多实例必须使用一致的secret/Store等对应条件。

默认保护 `POST`、`PUT`、`PATCH`、`DELETE`。客户端可通过 `x-csrf-token`、`x-xsrf-token` 或 body 字段 `_csrf` 提交 token。必须开放的 unsafe 路由可在 route options 中设置 `{ csrf: false }` 跳过。

设置 `config.csrf.enabled: true` 可自动全局注册CSRF。它在body parsing、全局Session和插件全局中间件之后执行，但早于路由专用Session与路由身份Guard。需要Session模式时，优先像主例一样全局启用Session；只在路由启用Session，不能保证它在全局CSRF执行时已存在。若要在插件内按路径手动调用 `csrf()`，应保证它之前已挂载所需Session，并避免与全局CSRF重复注册。

未注册CSRF时，路由 `csrf: true` 不会自行增加中间件。`csrf: false` 跳过检查，但中间件仍会挂载token方法；调用token方法仍要求可用Session或secret。`req.csrfToken()` 会设置 `Cache-Control: no-store`，不要把token响应放入共享缓存。

默认启用Fetch Metadata检查：保护的方法若带 `Sec-Fetch-Site: cross-site` 会返回403。Origin检查默认关闭；配置 `origin: { trustedOrigins: [...] }` 后会检查已有Origin，缺少时尝试Referer，两者都没有时不靠此项拒绝。token、来源检查和业务身份授权需分别验证。

## 缓存安全

Cookie 与响应缓存需同时验证冷缓存和已有缓存：

- 当前默认禁止带 `Cookie` 的回源结果写入，但带 Cookie 的请求仍可能读到已存在的公开缓存；完全绕过须显式添加 `condition: (req) => req.headers.cookie === undefined` 或使用 `cache: false`，见[响应缓存限制](/zh/guide/cache#缓存-key-算法)
- 包含 `Set-Cookie` 的响应永不写入缓存
- 只有确认 cookie 输入安全时，才为路由设置 `allowCookieCache: true`

```typescript
app.get(
  "/public-ab-test",
  {
    cache: {
      ttl: 60_000,
      allowCookieCache: true,
      vary: ["cookie"],
    },
  },
  async (req, res) => {
    res.json({ theme: req.cookie("theme") ?? "system" });
  },
);
```

该片段只演示已明确按Cookie区分的响应缓存，不用于会话token或私有用户数据。创建Session或更新Cookie的响应仍不得写入共享缓存。

当前缓存实现的“不写入”不等于“不参与并发合并”：同 key 的在途请求仍可能复用首份正文。创建/修改会话、返回私有数据或必须每次独立执行的接口，应在进入缓存前使用 `cache: false` 或 `condition` 排除，不能只依赖 `Set-Cookie` / `private` / `no-store` 响应头。具体限制见[响应缓存的并发回源](/zh/guide/cache#并发回源)。

## 常见问题与复验

| 症状                         | 核对与修复                                                     | 复验                                                 |
| ---------------------------- | -------------------------------------------------------------- | ---------------------------------------------------- |
| 没有Set-Cookie               | 是否只读取了新会话；浏览器是否拒收Secure/path/domain条件       | 执行token或visit请求，检查原始响应头与下一请求Cookie |
| req.session不存在            | 全局/路由开关、手动注册位置、测试是否显式传config              | 分别验证普通路由和session:false路由                  |
| token正确仍403               | 是否丢失关联Cookie、用到旧进程内存会话、跨站元数据或Origin被拒 | 重新获取token+Cookie，按错误code区分原因             |
| 500 CSRF_CONFIGURATION_ERROR | 执行CSRF时没有可用Session/secret                               | 核对全局与路由链序再复验                             |
| 多实例状态丢失或互相覆盖     | 是否用memory、prefix不一致或并发写同一会话                     | 跨实例请求及并发修改验证实际Store合同                |
| Store失败却期望返回成功      | 检查get/set/delete错误与响应是否已发送                         | 故障时确认成功响应被阻止，恢复后重新读写             |

更多字段见[配置 API](/zh/api/config)，请求/响应方法见[上下文 API](/zh/api/context)，职责边界见[安全与资源规范](/zh/specification/security-and-resources)。
