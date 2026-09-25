# 插件

VextJS 的插件系统负责应用启动阶段的能力扩展。通过插件，你可以向 `app` 对象注入自定义能力、注册全局中间件、替换内置实现、管理资源生命周期。路由、服务、Adapter与构建工具有各自的入口，职责边界见[架构规范](/zh/specification/architecture)。

先用下方“完整示例与验证”运行一个无需外部服务的插件应用。其余示例用于说明特定接口；Redis、数据库、监控SDK及业务service需要应用自行提供，不能把所有片段同时复制到plugins目录。

## 基本概念

插件放在 `src/plugins/` 目录下，由 `plugin-loader` 自动扫描加载。每个插件通过 `definePlugin()` 定义，包含名称、依赖声明和 `setup()` 初始化函数。

扫描递归支持`.ts/.js/.mjs/.cjs`，排除`_`、`.`开头文件/目录、`.test.`、`.spec.`及`.d.ts`。普通辅助模块放在扫描目录外或明确排除的位置；安装npm包不会自动把它变为用户插件，需要由这里的入口导出插件。

### 完整示例与验证

在已完成[快速开始](/zh/guide/quick-start)的独立 TypeScript 练习项目中使用以下四文件。保留该项目的 npm scripts 和 tsconfig，合并基础配置；插件目录只放本例两个插件。这里验证依赖排序、扩展、全局中间件、ready 和 close，无需 Redis 或数据库。若已有 local/provider 等配置覆盖端口，先确认实际监听地址。

```typescript
// src/config/default.ts
export default { port: 3000, adapter: "native", frontend: { enabled: false } };
```

```typescript
// src/plugins/store.ts
import { defineAppExtensions, definePlugin } from "vextjs";

export const appExtensions = defineAppExtensions<{
  demoState: {
    requests: number;
    ready: boolean;
    events: string[];
  };
}>();

export default definePlugin({
  name: "demo-store",
  setup(app) {
    const state = { requests: 0, ready: false, events: [] as string[] };
    app.extend("demoState", state);
    app.onClose(() => {
      state.events.push("store");
      app.logger.info({ events: [...state.events] }, "Demo plugin close order");
    });
  },
});
```

```typescript
// src/plugins/consumer.ts
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "demo-consumer",
  dependencies: ["demo-store"],
  setup(app) {
    const state = app.demoState as {
      requests: number;
      ready: boolean;
      events: string[];
    };
    app.use(async (_req, res, next) => {
      state.requests += 1;
      res.setHeader("x-demo-plugin", "active");
      await next();
    });
    app.onReady(() => {
      state.ready = true;
    });
    app.onClose(() => {
      state.events.push("consumer");
    });
  },
});
```

```typescript
// src/routes/plugin-info.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, async (_req, res) => {
    const state = app.demoState as { requests: number; ready: boolean };
    res.json({ requests: state.requests, ready: state.ready });
  });
});
```

1. 运行 `npm run dev`，在另一终端连续两次请求 `http://127.0.0.1:3000/plugin-info`，例如执行 `curl -i`（PowerShell 使用 `curl.exe -i`）加该 URL。
2. 无其他请求时，两次均应为200并含 `x-demo-plugin: active`；`data.ready=true`，`data.requests` 依次为1/2。浏览器可能额外请求favicon，因此验证精确计数时使用上述命令。
3. 在启动终端按 Ctrl+C 正常停止，观察 `Demo plugin close order` 日志中的 `events: ["consumer", "store"]`，验证后注册的consumer先关闭。日志级别需允许info；强制结束进程不会保证执行关闭钩子。
4. 执行 `npm run build`（快速开始的build脚本包含 `--typecheck`），再执行 `npm start`，重复请求和正常关闭。新进程的计数从零开始。

测试辅助也能在保存 `app.app.demoState` 引用后调用 `await app.close()`，检查同一events顺序；这验证应用关闭逻辑，不能代替CLI收到信号的验证。

`appExtensions` 为类型生成器提供显式声明；真正创建并挂载状态的是setup中的 `app.extend()`，只有类型声明不会产生运行时能力。

把consumer的依赖名临时改成不存在的名称，启动应报告缺失依赖；恢复后重试。重复插件名同样应报错，不应默默覆盖。测试辅助需显式传`plugins: true`，见[测试API](/zh/api/testing-api)。

### Redis 接入示意

以下是可选接入示意，需先安装 `ioredis` 并准备可访问的Redis服务。创建客户端不等于已验证连接成功；初始化失败和取消时的清理由插件负责。它不属于上面的四文件示例。

```typescript
// src/plugins/redis.ts
import { definePlugin } from "vextjs";
import Redis from "ioredis";

export default definePlugin({
  name: "redis",

  async setup(app) {
    const redis = new Redis(app.config.redis?.url ?? "redis://localhost:6379");

    // 向 app 挂载自定义能力
    app.extend("redis", redis);

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
  setup(
    app: VextPluginContext,
    context: VextPluginSetupContext,
  ): Promise<void> | void;

  /** HTTP 开始监听后执行的就绪钩子（可选） */
  onReady?(app: VextPluginContext): Promise<void> | void;

  /** 优雅关闭时执行的清理钩子（可选，按 LIFO 顺序） */
  onClose?(app: VextPluginContext): Promise<void> | void;
}
```

以上类型从`vextjs`导入；`VextPluginSetupContext`提供只读`signal: AbortSignal`。`VextPluginContext`不暴露路由注册方法，路由仍放在`defineRoutes()`中。

### `name` — 唯一标识

插件名称用于日志输出、错误信息和依赖声明。扫描到两个同名用户插件时会在执行setup之前报错，不会覆盖。内置MonSQLize在独立阶段初始化，不是用户插件拓扑图中的节点；不要用同名文件或`dependencies: ["monsqlize"]`尝试替换/声明它。

### `dependencies` — 依赖声明

声明当前插件依赖的其他用户插件名称（不是文件路径或npm包名）。`plugin-loader` 根据依赖关系进行**拓扑排序**，确保依赖的插件先于当前插件执行 `setup()`。缺失依赖或循环依赖时 Fail Fast 报错；依赖插件setup提前返回也不代表它提供了目标能力，消费者仍需匹配启用条件。

```typescript
export default definePlugin({
  name: "user-cache",
  dependencies: ["redis"], // 确保 redis 插件先初始化

  async setup(app) {
    // 此时 app.redis（由 redis 插件注入）已可用
    const redis = (app as any).redis;
    // ...
  },
});
```

### `setup()` — 初始化函数

插件的核心逻辑。在 `bootstrap` 阶段由 `plugin-loader` 调用，支持异步操作（如连接数据库）。第二个参数是 `{ signal: AbortSignal }`，应把 `signal` 传给支持取消的 I/O。每个 `setup()` 都有硬超时保护（当前标准入口为30秒，依赖事件循环能够执行计时回调）。失败或超时后，signal会中止，受管理的框架mutation会回滚，setup的受控写入facade随后被撤销。迟到 continuation 不能再通过它调用受控方法或写入顶层属性；这不能阻止用户继续修改捕获的嵌套对象，也不能撤销外部I/O。

```typescript
async setup(app, { signal }) {
  const response = await fetch(app.config.remotePluginUrl, { signal });
  if (!response.ok) throw new Error(`Remote plugin configuration: HTTP ${response.status}`);
  app.extend("remotePluginData", await response.json());
}
```

### `onReady()` / `onClose()` — 生命周期钩子

插件也可以直接声明 `onReady(app)` 与 `onClose(app)`。`plugin-loader` 会在 `setup()` 完成后把它们注册到应用生命周期中：

- `onReady(app)`：HTTP 开始监听后执行，适合预热缓存、检查外部依赖、打印启动信息。
- `onClose(app)`：优雅关闭时执行，所有关闭钩子按后注册先执行（LIFO）顺序清理资源。

setup成功后其mutation facade也会撤销；不要在迟到任务中调用setup参数上的extend/setter。已注册回调可以读取app或使用捕获的client。回滚仅覆盖受管理的框架状态，不会自动撤销网络写入或关闭未成功登记的外部资源；超时不能强制终止任意JavaScript/I/O。关闭还受应用整体shutdown期限限制。

## 插件能力

### `app.extend()` — 挂载自定义属性

向 `app` 对象注入自定义属性或方法。应在插件setup中声明；名称须为合法JavaScript标识符，不能覆盖已有属性、保留名或继承属性。更换validator/logger等使用对应setter。

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
如果你希望自动生成插件扩展声明，可在插件文件中导出 `appExtensions = defineAppExtensions<{ ... }>()`，并运行：

```bash
npm exec -- vext typegen
```

当前轻量扫描器优先识别内联对象泛型：

```typescript
import { defineAppExtensions, definePlugin } from "vextjs";

export const appExtensions = defineAppExtensions<{
  mailer: {
    send(to: string, subject: string, body: string): Promise<void>;
  };
}>();

export default definePlugin({
  name: "mailer",
  setup(app) {
    app.extend("mailer", {
      async send(to: string, subject: string, body: string) {
        app.logger.info({ to, subject }, "Email sent");
      },
    });
  },
});
```

命令也会 best-effort 扫描 `definePlugin()` 的 `setup` / `onReady` / `onClose` 生命周期内的 `app.extend("...")` 调用，并将结果写入 `.vext/types/app-extensions.generated.d.ts`，再通过 `src/types/generated/index.d.ts` 接入 TypeScript 项目。复杂类型、导入 type alias 或动态扩展不适合依赖自动扫描，建议使用手写 `declare module`：

```typescript
// src/types/extensions.d.ts
import "vextjs";

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

在插件中注册全局中间件。它们位于请求元数据、解析、包装等全局基础层之后，显式启用的CSRF与路由链之前；前面的步骤若已短路或抛错，插件中间件不会执行。完整顺序见[中间件指南](/zh/guide/middleware#全局中间件)。

```typescript
import { definePlugin, securityHeaders } from "vextjs";

export default definePlugin({
  name: "security-headers",

  setup(app) {
    app.use(securityHeaders({ preset: "strict" }));
  },
});
```

应用级浏览器安全响应头请优先使用 `config.securityHeaders`，这样错误响应、404、测试辅助和 dev soft reload 会保持一致。插件形式更适合局部迁移或特殊组合。

:::warning 注意
`app.use()` 只能在 `setup()` 中调用。路由注册完成后再调用将抛出错误。
:::

### `app.hooks.on()` — 注册运行时生命周期 hook

插件也可以通过 `app.hooks.on(name, handler)` 观察框架生命周期。它适合做请求审计、出站调用监控、service 调用追踪、响应 header patch、OpenAPI 文档补丁等横切逻辑。

```typescript
export default definePlugin({
  name: "runtime-observer",

  setup(app) {
    app.hooks.on("handler:error", ({ route, error, requestId }) => {
      app.logger.error({ route: route.path, err: error, requestId });
    });

    app.hooks.on("response:before", ({ headers }) => ({
      headers: { ...headers, "x-runtime": "vext" },
    }));
  },
});
```

`app.hooks` 是框架保留属性，不能用 `app.extend("hooks", ...)` 覆盖。插件 `setup()` 本身也会触发 `plugin:beforeSetup/afterSetup/error`，但一个插件不能观察自己的 `beforeSetup`，只能被此前已加载的插件观察。

### `app.onClose()` — 优雅关闭钩子

注册优雅关闭钩子。当收到 `SIGTERM` / `SIGINT` 信号时，框架按注册的**逆序**（LIFO）执行所有关闭钩子。

适合关闭数据库连接、刷新日志缓冲区、取消定时任务等。下方的 `createDatabaseConnection` 需由应用实现，并返回有 `disconnect()` 方法的客户端；使用独立的 `sqlDatabase` 配置与 `sql` 扩展名，避免覆盖内置 `app.db`。

```typescript
export default definePlugin({
  name: "database",

  async setup(app) {
    const db = await createDatabaseConnection(app.config.sqlDatabase);
    try {
      app.extend("sql", db);
      app.onClose(async () => {
        app.logger.info("Closing database connection...");
        await db.disconnect();
      });
    } catch (error) {
      // 例如extend命名冲突：此时不能依赖未登记成功的关闭钩子。
      await db.disconnect();
      throw error;
    }
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

替换框架内置的同步参数校验引擎。默认使用schema-dsl；下面演示保持合同的代理适配器。需要Zod实现时，使用[参数校验指南](/zh/guide/validation#替换校验引擎)中的DSL翻译示例，不把Zod实例直接放入RouteOptions.validate。

```typescript
import { definePlugin } from "vextjs";
import type { VextValidator } from "vextjs";

export default definePlugin({
  name: "validator-wrapper",

  setup(app) {
    const originalValidator = app.getValidator();

    const validator: VextValidator = {
      compile(schema) {
        const validate = originalValidator.compile(schema);
        return (input) => validate(input);
      },
    };

    app.setValidator(validator);
  },
});
```

替换应发生在路由注册及service编译schema之前。返回值须保留valid/data/errors合同；替换运行时引擎不放宽build、Doctor、OpenAPI和client使用的静态路由语法。

### `app.setThrow()` — 包装错误抛出

包装或替换 `app.throw()` 的实现。接收原始实现，返回保留全部重载及 `never` 返回语义的新实现；包括 i18n 快捷方式、位置参数和对象参数。下面通过 Proxy 原样转发参数，不把调用限制为四个位置参数。

```typescript
export default definePlugin({
  name: "error-tracker",

  setup(app) {
    const logger = app.logger;
    app.setThrow(
      (originalThrow) =>
        new Proxy(originalThrow, {
          apply(target, thisArg, args) {
            logger.warn("app.throw called");
            return Reflect.apply(target, thisArg, args);
          },
        }),
    );
  },
});
```

### `app.setRateLimiter()` — 替换限流实现

替换内置限流器。普通Redis需求优先配置内置store，见[请求限流](/zh/guide/rate-limit)。下面是固定窗口内存示意，使用全局max/window；自定义check只收到key，不会自动收到路由额度覆盖。先在配置启用rateLimit。

```typescript
export default definePlugin({
  name: "custom-rate-limit",

  setup(app) {
    const counters = new Map<string, { count: number; expires: number }>();
    const { max, window: windowSeconds } = app.config.rateLimit;
    app.setRateLimiter({
      async check(key: string) {
        const now = Date.now();
        let entry = counters.get(key);
        if (!entry || entry.expires <= now) {
          entry = { count: 0, expires: now + windowSeconds * 1000 };
          counters.set(key, entry);
        }
        entry.count += 1;
        return {
          allowed: entry.count <= max,
          remaining: Math.max(0, max - entry.count),
          resetAt: Math.ceil(entry.expires / 1000), // 绝对Unix秒，不是毫秒
        };
      },
    });
    app.onClose(() => counters.clear());
  },
});
```

该Map只在同key再次访问时淘汰旧窗口，未实现全局容量/过期清理，也不跨进程共享；不能直接作为无界客户端集合的生产store。生产自定义实现应补齐这些资源约束。

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
2. locales / 内置数据库 / fetch等启动能力 → 按启用条件初始化
3. plugins   → ⭐ 用户插件拓扑排序 + 执行 setup()（此处）
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

// plugins/query-cache.ts — 依赖 database
definePlugin({ name: 'query-cache', dependencies: ['database'], setup: ... });

// plugins/session.ts — 依赖 query-cache 和 database
definePlugin({ name: 'session', dependencies: ['query-cache', 'database'], setup: ... });
```

执行顺序：`database` → `query-cache` → `session`

如果存在循环依赖（A → B → A），框架会在启动时 Fail Fast 报错。

### 超时保护

当前开发、生产和测试标准入口使用Plugin Loader的 `30_000` 毫秒超时。虽然加载器内部选项和错误提示提到setupTimeout，标准入口尚未把 `config.plugin.setupTimeout` 传入；写这个配置不能改变实际期限。

初始化超时时，框架会中止 `context.signal`、回滚受管理的setup mutation，并关闭该setup参数的受控写入入口。插件仍负责自己在取消前创建的外部资源，应把signal传给支持取消的操作，并在自己的失败/取消路径关闭未完成初始化的client。此机制不能中断阻塞事件循环的同步代码，也不能强制终止任意异步I/O；不自动套用于独立初始化的内置数据库插件。

## 实战示例

### 数据库插件

下面仅演示连接池接口与关闭钩子，createPool是空实现，不能用于验证真实事务。内置MonSQLize使用`config.database`与`app.db`；自建SQL插件应使用自己的配置名和扩展名，避免冲突。

```typescript
// src/plugins/database.ts
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "database",

  async setup(app) {
    // 从配置中读取数据库连接信息
    const dbConfig = app.config.sqlDatabase ?? {
      host: "localhost",
      port: 5432,
      database: "myapp",
    };

    // 创建数据库连接（示例）
    const pool = await createPool(dbConfig);

    // 注入到 app
    app.extend("sql", {
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

这是接入位置示意，SDK调用被注释，没有完成实际上报。中间件catch只捕获从其next传播出来的异常，不能保证覆盖启动、后台任务或已被内层处理的所有错误；运行时观察入口另见[Hooks](/zh/guide/hooks)。

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

下面的setInterval是进程内示意：任务可能重叠，多worker会重复执行，清除timer不会取消已开始的任务。需要持久调度、租约和并发约束时使用[Jobs](/zh/guide/jobs)。

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

| 插件名        | 说明                      | 条件加载                                                        |
| ------------- | ------------------------- | --------------------------------------------------------------- |
| **monsqlize** | MonSQLize 数据库 ORM 集成 | config.database为非空对象时进入初始化；未配置、null或空对象跳过 |

内置插件通过 `shouldLoadMonSQLize()` 检查数据库配置，无需手动注册。没有数据库配置时跳过；已经启用却缺少运行依赖或配置错误时应修复启动错误，不能依赖静默跳过。详见[数据库](/zh/guide/database)。

当前没有`database.enabled`关闭开关；`database: { enabled: false }`仍为非空对象，会进入初始化并因缺少database.config报错。

## 文件上传

VextJS 内置 `multipart/form-data` 解析，基于 Node.js 20+ 原生 `Request.formData()` API，零外部依赖。只需在配置中开启即可。

### 开启内置解析

```typescript
// src/config/default.ts
export default {
  multipart: {
    enabled: true, // 开启内置解析
    maxFileSize: 10 * 1024 * 1024, // 单文件上限 10MB（默认）
    maxFiles: 10, // 单次最多文件数（默认）
    // allowedMimeTypes: ['image/jpeg', 'image/png'],  // 可选：MIME 白名单
  },
};
```

开启后，`multipart/form-data`请求进入内置解析，结果填充到`req.files`（`ParsedFile[]`）；普通文本字段不会自动填入req.body。未开启时跳过内置multipart解析分支。

### 路由中使用

```typescript
// src/routes/upload.ts
import { defineRoutes } from "vextjs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export default defineRoutes((app) => {
  app.post(
    "/",
    {
      multipart: {
        enabled: true,
        files: {
          avatar: "用户头像",
          resume: { description: "简历文件", required: true },
        },
      },
    },
    async (req, res) => {
      const avatarFile = req.files?.find((f) => f.fieldname === "avatar");
      if (!avatarFile) {
        res.json({ code: 400, message: "未上传文件" }, 400);
        return;
      }

      // 校验文件类型
      if (!avatarFile.mimetype.startsWith("image/")) {
        res.json({ code: 400, message: "仅支持图片格式" }, 400);
        return;
      }

      // 保存文件（avatarFile.buffer 保证二进制完整）
      const filename = randomUUID();
      const uploadDir = path.resolve("uploads");
      await mkdir(uploadDir, { recursive: true });
      await writeFile(path.join(uploadDir, filename), avatarFile.buffer);

      res.json({ filename, size: avatarFile.size });
    },
  );
});
```

全局解析关闭时，使用 `multipart.enabled: true` 可让单个路由启用内置解析。全局解析开启时，路由也可以设置 `multipart.enabled: false` 跳过内置解析。`files` 字段还会用于生成 OpenAPI `multipart/form-data` 文档，并在运行时校验 required 文件字段。

文件名前缀使请求地址为`/upload`；本片段要求multipart中同时提供avatar和resume。MIME是客户端声明，不是内容检测。全局解析已拒绝的请求不会被路由覆盖恢复；非multipart请求不会触发files.required，所以handler仍检查文件。完整配置、curl和413/415复验见[文件上传](/zh/guide/uploads)。

### ParsedFile 结构

| 字段        | 类型     | 说明                                              |
| ----------- | -------- | ------------------------------------------------- |
| `fieldname` | `string` | 表单字段名（`<input name="avatar">` 的 `avatar`） |
| `filename`  | `string` | 客户端原始文件名                                  |
| `mimetype`  | `string` | MIME 类型（如 `image/jpeg`）                      |
| `buffer`    | `Buffer` | 文件完整二进制内容                                |
| `size`      | `number` | 文件大小（字节）                                  |

:::tip Fastify 用户
`multipart.maxFileSize` 只限制单个文件大小；总请求体读取上限由 `bodyParser.maxBodySize` 控制。使用 Fastify 时，如额外配置 adapter `bodyLimit`，实际读取边界会取 adapter `bodyLimit` 与 body-parser 总体上限中的较小值。
:::

### 自定义解析（高级）

如需使用busboy等第三方库进行更细粒度的控制，可通过插件实现。下面是已安装busboy及其类型后的局部接线示例：它先读取完整rawBuffer，再收集文件到内存，**不是流式写盘方案**。

支持两种使用模式：

- **独占模式**：将 `multipart.enabled` 保持 `false`（默认），由插件全权负责解析
- **共存模式**：`multipart.enabled: true` 时全局 body-parser 先解析，插件通过 `req.files !== undefined` 检测并提前退出，避免双重解析

推荐共存模式时在插件开头加 guard，使两种场景均能安全使用：

```typescript
// src/plugins/upload-custom.ts
import { definePlugin } from "vextjs";
import type { ParsedFile } from "vextjs";
import busboy from "busboy";

export default definePlugin({
  name: "upload-custom",

  setup(app) {
    app.use(async (req, _res, next) => {
      const ct = req.headers["content-type"] ?? "";
      if (!ct.startsWith("multipart/form-data")) {
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
        const bb = busboy({ headers: { "content-type": ct } });
        const collected: ParsedFile[] = [];

        bb.on("file", (fieldname, stream, info) => {
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("end", () => {
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

        bb.on("finish", () => resolve(collected));
        bb.on("error", reject);
        bb.write(rawBuffer);
        bb.end();
      });

      await next();
    });
  },
});
```

:::tip 文件大小限制
`app.config.multipart.maxFileSize`只由内置解析器执行，自定义解析器必须自行实现limits、truncated检查和错误清理；上述接线片段没有实现这些限制。总请求体仍受bodyParser/adapter读取边界约束，maxFileSize不会扩大该上限。
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

如果插件打开了外部连接（数据库、消息队列、Redis 等），应注册 `app.onClose()` 或插件的 `onClose` 为正常关闭提供清理路径，避免为同一资源重复登记。清理受应用总关闭期限约束；setup失败/超时会回滚已登记的钩子，仍需由插件处理该次初始化的资源释放，不能只依赖正常关闭路径：

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

只有业务允许降级的可选能力才适合捕获初始化失败并提供空实现；必需的数据库、鉴权等能力应让启动失败。下面initAnalytics由应用提供，创建到一半的client也须自行清理：

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

## 排查与复验

| 症状                          | 处理                                            | 复验                       |
| ----------------------------- | ----------------------------------------------- | -------------------------- |
| 插件没加载                    | 核对实际src根、扩展名、排除规则及default export | 启动日志与plugin-info响应  |
| already registered / 缺失依赖 | name唯一，dependencies使用用户插件name          | 恢复后重启                 |
| setup context is closed       | 把框架mutation留在setup内，外部client单独捕获   | 等待异步任务结束并检查日志 |
| 超时仍占用连接                | signal需传递，catch/finally关闭未完成client     | 取消后确认连接被释放       |
| 服务在setup不存在             | 后置操作放onReady，资源初始化仍在setup          | ready后执行操作            |
| extend报冲突                  | 使用独立扩展名；内置能力用setter                | 启动与调用均成功           |

## 下一步

- 了解 [预加载 (Preload)](/zh/guide/preload) 机制，让插件包自动注入启动前脚本（如 OpenTelemetry SDK）
- 了解 [参数校验](/zh/guide/validation) 的声明式 DSL 语法
- 学习 [中间件](/zh/guide/middleware) 如何配合插件使用
- 查看 [配置](/zh/guide/configuration) 中插件相关的配置项
- 探索 [测试](/zh/guide/testing) 如何为插件编写测试
