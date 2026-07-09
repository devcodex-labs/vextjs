# Cookies 与 Sessions

Vext 提供一等 cookie 解析、响应 cookie 辅助方法和显式 session 中间件。该能力零第三方依赖，并覆盖 Native、Hono、Fastify、Express、Koa adapter。

## Cookies

每个请求都会暴露已解析的 cookies：

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

Session 需要显式安装：

```typescript
import { definePlugin, session } from "vextjs";

export default definePlugin({
  name: "session",
  setup(app) {
    app.use(session());
  },
});
```

在 route handler 中使用 `req.session`：

```typescript
app.post("/login", {}, async (req, res) => {
  req.session!.userId = "u_123";
  res.json({ ok: true });
});

app.post("/logout", {}, async (req, res) => {
  await req.session!.destroy();
  res.json({ ok: true });
});
```

Session 对象支持：

| 方法           | 说明                            |
| -------------- | ------------------------------- |
| `save()`       | 立即持久化并发送 session cookie |
| `regenerate()` | 更换 session id，并删除旧 id    |
| `destroy()`    | 删除 store 数据并清除 cookie    |

`id`、`isNew`、`save`、`regenerate`、`destroy` 等 session 元数据不可枚举，也不会被持久化进 store。

## 配置

`config.session` 为 `session()` 提供默认值：

```typescript
export default {
  session: {
    name: "vext.sid",
    ttl: 86400,
    rolling: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: "auto",
    },
  },
};
```

`secure: "auto"` 只会在 HTTPS 请求中发送 `Secure`。默认 memory store 适合开发、测试和单进程部署；生产共享 store 推荐通过官方 adapter 接入用户自有 cache-like 后端：

```typescript
import { createCacheSessionStore, session } from "vextjs";
import { createRedisCacheAdapter } from "cache-hub/redis";

const sessionCache = createRedisCacheAdapter("redis://localhost:6379");

app.use(
  session({
    store: createCacheSessionStore(sessionCache, {
      prefix: "my-app:sess:",
      close: () => sessionCache.close?.(),
    }),
  }),
);
```

`createCacheSessionStore()` 接收具备 `get`、`set`、`del` 的结构型 cache，把 `VextSessionStore` 的 TTL 秒转换为 cache 毫秒，默认把 session data 写成 JSON string，并用 cache `get` + `set` 实现 rolling `touch()`。消费项目需要自行安装 `cache-hub` 和选用的后端 client，例如 `ioredis`。

`config.cache.cacheHub` 与 `app.cache` 只服务路由响应缓存，不是 Session Store 捷径，也应与 session 使用不同 namespace。若传入 `close`，Vext 会在返回的 store 上暴露 `close()`，便于在 `app.onClose()` 或插件 teardown 中关闭。需要特殊持久化契约时，仍可直接实现底层 `VextSessionStore`。

## CSRF 防护

CSRF 防护通过 `csrf()` 与 `config.csrf` 提供。`mode: "auto"` 下，若显式 `session()` 中间件已写入 `req.session`，Vext 会使用 session 同步 token；若没有 session，则可在配置 `config.csrf.secret` 后使用签名 double-submit cookie。

```typescript
import { csrf, definePlugin, session } from "vextjs";

export default definePlugin({
  name: "security",
  setup(app) {
    app.use(session());
    app.use(csrf());
  },
});

app.get("/csrf-token", {}, async (req, res) => {
  res.json({ token: req.csrfToken() });
});
```

默认保护 `POST`、`PUT`、`PATCH`、`DELETE`。客户端可通过 `x-csrf-token`、`x-xsrf-token` 或 body 字段 `_csrf` 提交 token。必须开放的 unsafe 路由可在 route options 中设置 `{ csrf: false }` 跳过。

设置 `config.csrf.enabled: true` 可自动全局注册 CSRF。它会在 body parsing 与插件全局中间件之后执行，因此 session 数据会先于 CSRF 校验可用。若只想保护部分路径，请在插件里手动注册 `csrf()` 并按路径调用。

## 缓存安全

路由缓存对 cookie 采取保守默认：

- 带 `Cookie` 请求头的请求默认绕过缓存
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
  handler,
);
```
