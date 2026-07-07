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

`secure: "auto"` 只会在 HTTPS 请求中发送 `Secure`。默认 memory store 适合开发、测试和单进程部署；生产共享 store 可通过 `VextSessionStore` 接入：

```typescript
import { session, type VextSessionStore } from "vextjs";

const store: VextSessionStore = {
  async get(id) {
    return await redisJsonGet(id);
  },
  async set(id, data, ttlSeconds) {
    await redisJsonSet(id, data, ttlSeconds);
  },
  async delete(id) {
    await redisDel(id);
  },
};

app.use(session({ store }));
```

如果自定义 store 暴露 `close()`，Vext 将其视为 store 自身生命周期。请在 `app.onClose()` 或插件 teardown 中主动关闭；session middleware 不会自动关闭用户传入的 store。

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
