# 插件

VextJS 的插件系统是框架的**唯一扩展入口**。通过插件，你可以向 `app` 对象注入自定义能力、注册全局中间件、替换内置实现、管理资源生命周期。

## 基本概念

插件放在 `src/plugins/` 目录下，由 `plugin-loader` 自动扫描加载。每个插件通过 `definePlugin()` 定义，包含名称、依赖声明和 `setup()` 初始化函数。

```typescript
// src/plugins/redis.ts
import { definePlugin } from "vextjs";
import Redis from "ioredis";

export default definePlugin({
  name: "redis",

  async setup(app) {
    const redis = new Redis(app.config.redis?.url ?? "redis://localhost:6379");

    // 向 app 挂载自定义能力
    app.extend("cache", redis);

    // 注册优雅关闭钩子
    app.onClose(async () => {
      app.logger.info("Closing Redis connection...");
      await redis.quit();
    });

    app.logger.info("Redis plugin initialized");
  },
});
```

## 插件接口

```typescript
interface VextPlugin {
  /** 插件名称（唯一标识） */
  readonly name: string;

  /** 依赖的其他插件名称列表 */
  readonly dependencies?: string[];

  /** 插件初始化函数 */
  setup(app: VextApp): Promise<void> | void;
}
```

### `name` — 唯一标识

插件名称用于日志输出、错误信息和依赖声明。同名插件后加载的会覆盖先加载的，可用于替换内置实现。

### `dependencies` — 依赖声明

声明当前插件依赖的其他插件。`plugin-loader` 根据依赖关系进行**拓扑排序**，确保依赖的插件先于当前插件执行 `setup()`。存在循环依赖时 Fail Fast 报错。

```typescript
export default definePlugin({
  name: "user-cache",
  dependencies: ["redis"], // 确保 redis 插件先初始化

  async setup(app) {
    // 此时 app.cache（由 redis 插件注入）已可用
    const redis = (app as any).cache;
    // ...
  },
});
```

### `setup()` — 初始化函数

插件的核心逻辑。在 `bootstrap` 阶段由 `plugin-loader` 调用，支持异步操作（如连接数据库）。每个 `setup()` 有超时保护（默认 30 秒），超时后自动抛出错误。

## 插件能力

### `app.extend()` — 挂载自定义属性

向 `app` 对象注入自定义属性或方法。只有插件可以使用此 API。

```typescript
export default definePlugin({
  name: "mailer",

  async setup(app) {
    const mailer = {
      async send(to: string, subject: string, body: string) {
        // 发送邮件逻辑...
        app.logger.info({ to, subject }, "Email sent");
      },
    };

    app.extend("mailer", mailer);
  },
});
```

使用时：

```typescript
// 在路由或服务中
await (app as any).mailer.send("user@example.com", "Welcome", "Hello!");
```

:::tip 类型提示
配合 `declare module` 获得完整的类型支持：

```typescript
// src/types/extensions.d.ts
declare module "vextjs" {
  interface VextApp {
    mailer: {
      send(to: string, subject: string, body: string): Promise<void>;
    };
  }
}
```

扩展后 `app.mailer.send()` 将获得 IDE 自动补全，无需 `as any` 断言。
:::

### `app.use()` — 注册全局中间件

在插件中注册全局中间件，对所有路由生效。这些中间件在内置全局中间件之后、路由级中间件之前执行。

```typescript
export default definePlugin({
  name: "security-headers",

  setup(app) {
    app.use(async (req, res, next) => {
      await next();
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("X-XSS-Protection", "1; mode=block");
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    });
  },
});
```

:::warning 注意
`app.use()` 只能在 `setup()` 中调用。路由注册完成后再调用将抛出错误。
:::

### `app.onClose()` — 优雅关闭钩子

注册优雅关闭钩子。当收到 `SIGTERM` / `SIGINT` 信号时，框架按注册的**逆序**（LIFO）执行所有关闭钩子。

适合：关闭数据库连接、刷新日志缓冲区、取消定时任务等。

```typescript
export default definePlugin({
  name: "database",

  async setup(app) {
    const db = await createDatabaseConnection(app.config.database);
    app.extend("db", db);

    app.onClose(async () => {
      app.logger.info("Closing database connection...");
      await db.disconnect();
    });
  },
});
```

### `app.onReady()` — 就绪钩子

注册就绪钩子。所有插件加载完成、HTTP 开始监听之后触发。适合：预热缓存、检查外部依赖、打印启动信息。

```typescript
export default definePlugin({
  name: "warmup",

  setup(app) {
    app.onReady(async () => {
      // HTTP 已开始监听，可以执行预热操作
      app.logger.info("Warming up caches...");
      await app.services.product.warmupCache();
      app.logger.info("Cache warmup complete");
    });
  },
});
```

### `app.setValidator()` — 替换校验引擎

替换框架内置的参数校验引擎。默认使用 schema-dsl，可替换为 Zod、Yup 等第三方校验库。

```typescript
import { definePlugin } from "vextjs";
import type { VextValidator } from "vextjs";

export default definePlugin({
  name: "zod-validator",

  setup(app) {
    const zodValidator: VextValidator = {
      validate(schema, data) {
        // Zod 校验逻辑...
        return { valid: true, data };
      },
      toJSONSchema(schema) {
        // 转换为 JSON Schema（供 OpenAPI 使用）
        return {};
      },
    };

    app.setValidator(zodValidator);
  },
});
```

### `app.setThrow()` — 包装错误抛出

包装或替换 `app.throw()` 的实现。接收原始实现，返回新实现。

```typescript
export default definePlugin({
  name: "error-tracker",

  setup(app) {
    app.setThrow((originalThrow) => {
      return (status, message, paramsOrCode, code) => {
        // 在抛出前记录错误
        app.logger.warn({ status, message }, "HTTP error thrown");
        // 调用原始实现
        originalThrow(status, message, paramsOrCode, code);
      };
    });
  },
});
```

### `app.setRateLimiter()` — 替换限流实现

替换内置的限流器。默认使用 `flex-rate-limit`，可替换为 Redis 分布式限流等。

```typescript
export default definePlugin({
  name: "redis-rate-limit",
  dependencies: ["redis"],

  setup(app) {
    app.setRateLimiter({
      async check(key: string) {
        // 基于 Redis 的分布式限流
        const count = await (app as any).cache.incr(`ratelimit:${key}`);
        if (count === 1) {
          await (app as any).cache.expire(`ratelimit:${key}`, 60);
        }
        return {
          allowed: count <= app.config.rateLimit.max,
          remaining: Math.max(0, app.config.rateLimit.max - count),
          resetAt: Date.now() + 60000,
        };
      },
    });
  },
});
```

### `app.setRequestIdGenerator()` — 自定义请求 ID

覆盖请求 ID 的生成算法。默认使用 `crypto.randomUUID()`。

```typescript
export default definePlugin({
  name: "custom-request-id",

  setup(app) {
    let counter = 0;

    app.setRequestIdGenerator(() => {
      // 使用自定义格式：时间戳 + 计数器
      return `${Date.now()}-${++counter}`;
    });
  },
});
```

## 插件加载流程

### 启动时序

在 `bootstrap` 启动流程中，插件在以下阶段执行：

```
1. config    → 加载并合并配置
2. locales   → 加载 i18n 语言包
3. plugins   → ⭐ 拓扑排序 + 执行 setup()（此处）
4. middlewares → 扫描中间件定义
5. services  → 实例化服务
6. routes    → 注册路由
7. HTTP 监听 → onReady 钩子触发
```

这意味着：

- ✅ `setup()` 中可以访问 `app.config`（已加载）
- ✅ `setup()` 中可以访问 `app.logger`（已初始化）
- ✅ `setup()` 中可以调用 `app.extend()` / `app.use()` / `app.onClose()` / `app.onReady()`
- ❌ `setup()` 中**不能**访问 `app.services`（服务尚未加载）
- ❌ `setup()` 中**不能**假设路由已注册

如需在所有模块加载完成后执行操作，使用 `app.onReady()`。

### 拓扑排序

`plugin-loader` 根据 `dependencies` 声明进行拓扑排序：

```typescript
// plugins/database.ts — 无依赖，最先执行
definePlugin({ name: 'database', setup: ... });

// plugins/cache.ts — 依赖 database
definePlugin({ name: 'cache', dependencies: ['database'], setup: ... });

// plugins/session.ts — 依赖 cache 和 database
definePlugin({ name: 'session', dependencies: ['cache', 'database'], setup: ... });
```

执行顺序：`database` → `cache` → `session`

如果存在循环依赖（A → B → A），框架会在启动时 Fail Fast 报错。

### 超时保护

每个 `setup()` 有超时保护（默认 30 秒）。如果插件初始化超时（例如数据库连接超时），框架会抛出明确的错误信息。

## 实战示例

### 数据库插件

```typescript
// src/plugins/database.ts
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "database",

  async setup(app) {
    // 从配置中读取数据库连接信息
    const dbConfig = app.config.database ?? {
      host: "localhost",
      port: 5432,
      database: "myapp",
    };

    // 创建数据库连接（示例）
    const pool = await createPool(dbConfig);

    // 注入到 app
    app.extend("db", {
      query: (sql: string, params?: unknown[]) => pool.query(sql, params),
      transaction: (fn: Function) => pool.transaction(fn),
    });

    // 优雅关闭
    app.onClose(async () => {
      app.logger.info("Closing database pool...");
      await pool.end();
    });

    // 就绪检查
    app.onReady(async () => {
      try {
        await pool.query("SELECT 1");
        app.logger.info("Database connection verified");
      } catch (err) {
        app.logger.error({ err }, "Database health check failed");
      }
    });

    app.logger.info("Database plugin initialized");
  },
});

async function createPool(config: any) {
  // 实际实现中使用 pg、mysql2 等驱动
  return {
    query: async (sql: string, params?: unknown[]) => ({ rows: [] }),
    transaction: async (fn: Function) => fn(),
    end: async () => {},
  };
}
```

### Sentry 错误监控插件

```typescript
// src/plugins/sentry.ts
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "sentry",

  setup(app) {
    const dsn = app.config.sentry?.dsn;
    if (!dsn) {
      app.logger.warn("Sentry DSN not configured, skipping initialization");
      return;
    }

    // 初始化 Sentry
    // Sentry.init({ dsn });

    // 注册全局错误捕获中间件
    app.use(async (req, res, next) => {
      try {
        await next();
      } catch (err) {
        // 上报到 Sentry
        // Sentry.captureException(err, { extra: { requestId: req.requestId } });
        app.logger.error(
          { err, requestId: req.requestId },
          "Error captured by Sentry",
        );

        // 重新抛出，让框架的 error-handler 处理响应
        throw err;
      }
    });

    app.logger.info("Sentry plugin initialized");
  },
});
```

### 定时任务插件

```typescript
// src/plugins/scheduler.ts
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "scheduler",

  setup(app) {
    const timers: NodeJS.Timeout[] = [];

    app.extend("scheduler", {
      every(ms: number, name: string, fn: () => Promise<void>) {
        const timer = setInterval(async () => {
          try {
            await fn();
          } catch (err) {
            app.logger.error({ err, task: name }, "Scheduled task failed");
          }
        }, ms);
        timers.push(timer);
        app.logger.info({ name, intervalMs: ms }, "Scheduled task registered");
      },
    });

    // 优雅关闭时清除所有定时器
    app.onClose(() => {
      for (const timer of timers) {
        clearInterval(timer);
      }
      app.logger.info(`Cleared ${timers.length} scheduled task(s)`);
    });

    // 就绪后注册定时任务
    app.onReady(async () => {
      (app as any).scheduler.every(
        60_000,
        "cleanup-expired-sessions",
        async () => {
          // await app.services.session.cleanupExpired();
          app.logger.debug("Expired sessions cleaned up");
        },
      );
    });
  },
});
```

## 内置插件

VextJS 内置了以下插件：

| 插件名        | 说明                      | 条件加载                          |
| ------------- | ------------------------- | --------------------------------- |
| **monsqlize** | MonSQLize 数据库 ORM 集成 | 检测到 `monsqlize` 依赖时自动加载 |

内置插件通过 `shouldLoadMonSQLize()` 检测是否应加载，实现零配置零开销——未安装对应依赖时完全不加载。

## 文件上传

VextJS 内置 `multipart/form-data` 解析，基于 Node.js 18+ 原生 `Request.formData()` API，零外部依赖。只需在配置中开启即可。

### 开启内置解析

```typescript
// vext.config.ts
export default defineConfig({
  multipart: {
    enabled: true,          // 开启内置解析
    maxFileSize: 10 * 1024 * 1024,  // 单文件上限 10MB（默认）
    maxFiles: 10,           // 单次最多文件数（默认）
    // allowedMimeTypes: ['image/jpeg', 'image/png'],  // 可选：MIME 白名单
  },
});
```

开启后，所有 `multipart/form-data` 请求体将由 body-parser 自动解析，结果填充到 `req.files`（类型 `ParsedFile[]`）。未开启时对性能零影响。

### 路由中使用

```typescript
// src/routes/upload.ts
export default defineRoutes((app) => {
  app.post('/upload', {
    multipart: {
      files: { avatar: '用户头像', resume: { description: '简历文件', required: true } },
    },
  }, async (req, res) => {
    const avatarFile = req.files?.find(f => f.fieldname === 'avatar');
    if (!avatarFile) {
      res.json({ code: 400, message: '未上传文件' }, 400);
      return;
    }

    // 校验文件类型
    if (!avatarFile.mimetype.startsWith('image/')) {
      res.json({ code: 400, message: '仅支持图片格式' }, 400);
      return;
    }

    // 保存文件（avatarFile.buffer 保证二进制完整）
    const filename = `${Date.now()}-${avatarFile.filename}`;
    await fs.writeFile(`./uploads/${filename}`, avatarFile.buffer);

    res.json({ filename, size: avatarFile.size });
  });
});
```

### ParsedFile 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `fieldname` | `string` | 表单字段名（`<input name="avatar">` 的 `avatar`） |
| `filename` | `string` | 客户端原始文件名 |
| `mimetype` | `string` | MIME 类型（如 `image/jpeg`） |
| `buffer` | `Buffer` | 文件完整二进制内容 |
| `size` | `number` | 文件大小（字节） |

:::tip Fastify 用户
Fastify adapter 会自动将 `bodyLimit` 与 `multipart.maxFileSize` 联动（取较大值），确保大文件不被 Fastify 层提前以 413 拒绝。
:::

### 自定义解析（高级）

如需使用 [busboy](https://github.com/mscdex/busboy) 等第三方库进行更细粒度的控制（如流式写入磁盘），可通过插件实现。

支持两种使用模式：

- **独占模式**：将 `multipart.enabled` 保持 `false`（默认），由插件全权负责解析
- **共存模式**：`multipart.enabled: true` 时全局 body-parser 先解析，插件通过 `req.files !== undefined` 检测并提前退出，避免双重解析

推荐共存模式时在插件开头加 guard，使两种场景均能安全使用：

```typescript
// src/plugins/upload-custom.ts
import { definePlugin } from 'vextjs';
import type { ParsedFile } from 'vextjs';
import busboy from 'busboy';

export default definePlugin({
  name: 'upload-custom',

  setup(app) {
    app.use(async (req, _res, next) => {
      const ct = req.headers['content-type'] ?? '';
      if (!ct.startsWith('multipart/form-data')) {
        await next();
        return;
      }

      // guard：全局 body-parser 已解析时直接跳过，避免双重处理
      if (req.files !== undefined) {
        await next();
        return;
      }

      const rawBuffer = await req._getRawBodyBuffer();

      req.files = await new Promise<ParsedFile[]>((resolve, reject) => {
        const bb = busboy({ headers: { 'content-type': ct } });
        const collected: ParsedFile[] = [];

        bb.on('file', (fieldname, stream, info) => {
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => {
            const buffer = Buffer.concat(chunks);
            collected.push({
              fieldname,
              filename: info.filename,
              mimetype: info.mimeType,
              buffer,
              size: buffer.byteLength,
            });
          });
        });

        bb.on('finish', () => resolve(collected));
        bb.on('error', reject);
        bb.write(rawBuffer);
        bb.end();
      });

      await next();
    });
  },
});
```

:::tip 文件大小限制
通过 `app.config.multipart.maxFileSize`（字节）控制最大文件大小。Fastify adapter 会自动将此值与 `bodyLimit` 联动，确保底层框架也接受足够大的请求体。
:::

## 插件 vs 中间件 vs 服务

| 方面       | 插件                   | 中间件               | 服务                   |
| ---------- | ---------------------- | -------------------- | ---------------------- |
| 放置目录   | `src/plugins/`         | `src/middlewares/`   | `src/services/`        |
| 定义方式   | `definePlugin()`       | `defineMiddleware()` | `export default class` |
| 执行时机   | 启动时（一次性）       | 每个请求             | 每次方法调用           |
| 访问 `app` | `setup(app)`           | `req.app`            | `constructor(app)`     |
| 主要职责   | 扩展框架能力           | 请求拦截/处理        | 业务逻辑               |
| 典型用例   | 数据库连接、缓存、监控 | 认证、日志、限流     | CRUD、计算、外部 API   |

**选择指南：**

- 需要在启动时初始化资源（如数据库连接）→ **插件**
- 需要拦截每个请求（如认证检查）→ **中间件**
- 需要封装可复用的业务逻辑 → **服务**
- 需要向 `app` 添加新能力 → **插件**（`app.extend()`）
- 需要替换框架内置行为 → **插件**（`app.setValidator()` 等）

## 最佳实践

### 1. 条件初始化

根据配置决定是否初始化插件，避免在不需要时浪费资源：

```typescript
export default definePlugin({
  name: "redis",

  async setup(app) {
    if (!app.config.redis?.enabled) {
      app.logger.info("Redis not configured, skipping");
      return;
    }

    // 初始化...
  },
});
```

### 2. 始终注册关闭钩子

如果插件打开了外部连接（数据库、消息队列、Redis 等），必须注册 `app.onClose()` 钩子确保优雅关闭：

```typescript
app.extend("mq", messageQueue);
app.onClose(async () => {
  await messageQueue.close();
});
```

### 3. 明确声明依赖

如果插件依赖其他插件的注入能力，务必在 `dependencies` 中声明，而非假设加载顺序：

```typescript
// ✅ 正确 — 显式声明
definePlugin({
  name: "session",
  dependencies: ["redis"],
  setup(app) {
    /* ... */
  },
});

// ❌ 危险 — 依赖文件名排序
definePlugin({
  name: "session",
  // 没有 dependencies，假设 redis 因为字母序在前面会先加载
  setup(app) {
    /* ... */
  },
});
```

### 4. 使用 `app.onReady()` 执行后置操作

需要等到所有模块加载完成再执行的操作（如预热缓存），应放在 `app.onReady()` 而非 `setup()` 中：

```typescript
setup(app) {
  // ❌ setup 时 services 尚未加载
  // await app.services.user.warmupCache();

  // ✅ onReady 时一切就绪
  app.onReady(async () => {
    await app.services.user.warmupCache();
  });
},
```

### 5. 错误容忍

非核心插件的初始化失败不应阻塞整个应用启动：

```typescript
export default definePlugin({
  name: "analytics",

  async setup(app) {
    try {
      const client = await initAnalytics(app.config.analytics);
      app.extend("analytics", client);
    } catch (err) {
      app.logger.warn(
        { err },
        "Analytics plugin init failed, continuing without analytics",
      );
      // 提供空实现，避免其他代码因 app.analytics 不存在而崩溃
      app.extend("analytics", {
        track: () => {},
        identify: () => {},
      });
    }
  },
});
```

## 下一步

- 了解 [预加载 (Preload)](/guide/preload) 机制，让插件包自动注入启动前脚本（如 OpenTelemetry SDK）
- 了解 [参数校验](/guide/validation) 的声明式 DSL 语法
- 学习 [中间件](/guide/middleware) 如何配合插件使用
- 查看 [配置](/guide/configuration) 中插件相关的配置项
- 探索 [测试](/guide/testing) 如何为插件编写测试
