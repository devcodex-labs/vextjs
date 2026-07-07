# Cookies and Sessions

Vext provides first-party cookie parsing, response cookie helpers, and an explicit session middleware. The feature is zero-dependency and works across Native, Hono, Fastify, Express, and Koa adapters.

## Cookies

Every request exposes parsed cookies:

```typescript
app.get("/preferences", {}, async (req, res) => {
  const theme = req.cookie("theme") ?? "system";
  res.json({ theme, all: req.cookies });
});
```

Set cookies through `res.cookie()` and clear them through `res.clearCookie()`:

```typescript
res.cookie("theme", "dark", {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
});

res.clearCookie("theme", { path: "/" });
```

Multiple `res.cookie()` calls are emitted as multiple `Set-Cookie` headers. Vext does not join them with commas.

`req.cookies` is readonly and uses first-wins semantics for duplicate cookie names. `res.cookie()` also supports `priority`, `partitioned`, and a custom `encode` function for advanced cases.

## Cookie Validation

`validate.cookie` validates parsed cookie values and emits OpenAPI `in: cookie` parameters:

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

Validation order is `param -> query -> header -> cookie -> body`.

Built-in OpenAPI docs can display `validate.cookie` as cookie parameters. Browser Try it out cannot set the forbidden `Cookie` header directly; use cookies already present for the same origin, a browser login flow, or an HTTP client such as cURL for manual cookie values.

## Sessions

Session support is installed explicitly:

```typescript
import { definePlugin, session } from "vextjs";

export default definePlugin({
  name: "session",
  setup(app) {
    app.use(session());
  },
});
```

Use `req.session` in route handlers:

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

The session object supports:

| Method         | Description                                     |
| -------------- | ----------------------------------------------- |
| `save()`       | Persist immediately and send the session cookie |
| `regenerate()` | Replace the session id and delete the old id    |
| `destroy()`    | Delete store data and clear the cookie          |

Session metadata such as `id`, `isNew`, `save`, `regenerate`, and `destroy` is non-enumerable and is not persisted into the store.

## Configuration

`config.session` provides defaults consumed by `session()`:

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

`secure: "auto"` sends `Secure` only for HTTPS requests. The default memory store is suitable for development, tests, and single-process deployments. Use `VextSessionStore` for shared production stores:

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

If a custom store exposes `close()`, Vext treats it as store-owned lifecycle. Register an `app.onClose()` hook or close it in your plugin teardown; the session middleware does not automatically close stores it did not create.

## Cache Safety

Route cache is conservative around cookies:

- requests with a `Cookie` header bypass cache by default
- responses with `Set-Cookie` are never written to cache
- set `allowCookieCache: true` only for routes whose cookie input is known to be safe

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
