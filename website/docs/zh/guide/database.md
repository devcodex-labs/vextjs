# 数据库 (MonSQLize)

VextJS 内置了 [MonSQLize](https://github.com/devcodex-labs/monSQLize) 数据库插件，提供开箱即用的 MongoDB 数据库支持。只需在配置文件中添加 `database` 字段，框架会自动完成连接管理、Model 加载和资源清理。

## 快速开始

先完成[快速开始](/zh/guide/quick-start)中的 TypeScript 项目准备，并使用以下 npm scripts：`dev: vext dev`、`build: vext build`、`start: vext start`。Vext 已包含 MonSQLize 运行时依赖；这条入门路径无需额外安装第二份。

下面五个文件组成完整的用户 CRUD 示例。先准备可连接的 MongoDB；没有外部实例时，可按[使用内存数据库](#使用内存数据库)添加验证 profile 和依赖，以 `npm run dev -- --config database-check` 启动。示例采用独立数据库名和 UUID 字符串 `_id`，不依赖 ObjectId 转换。它只演示数据访问；实际账户管理还需业务认证和授权。

### 1. 添加数据库配置

```typescript
// src/config/default.ts
import type { VextUserConfig } from "vextjs";

export default {
  host: "127.0.0.1",
  port: 3000,
  adapter: "native",
  frontend: { enabled: false },
  database: {
    databaseName: "vext_docs_database",
    config: { uri: "mongodb://127.0.0.1:27017/vext_docs_database" },
    // 启动插件显式等待索引完成，再对外接收请求。
    monsqlizeOptions: { autoIndex: false },
  },
} satisfies VextUserConfig;
```

### 2. 定义 Model

`collection: "users"` 同时决定这里的注册键和实际集合名。接口描述查询结果类型，schema 负责运行时校验，唯一索引负责并发写入约束。索引选项 `unique` 与 `key` 同级；写成 `options: { unique: true }` 不会建立预期的唯一约束。

```typescript
// src/models/user.ts
import type { VextModelDefinition } from "vextjs";

export type UserRole = "admin" | "editor" | "viewer";

export interface UserDocument {
  _id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export default {
  collection: "users",
  schema: {
    _id: "uuid!",
    name: "string:1-50!",
    email: "email!",
    role: "admin|editor|viewer",
  },
  indexes: [{ key: { email: 1 }, unique: true }],
  options: { timestamps: true },
} satisfies VextModelDefinition;
```

### 3. 等待唯一索引就绪

内置数据库已在用户插件之前完成连接和 Model 注册。下面在 HTTP 监听之前等待索引建立；建立失败会终止启动。仅“先查询邮箱是否存在，再插入”不能避免并发重复写入。

当前 `VextPluginContext` 将扩展属性视为 `unknown`；本例依据内置初始化合同，将 `db` 明确为 `VextDatabase | undefined` 后检查是否存在。Service 中的 `VextApp.db` 已有对应类型，无需重复转换。

```typescript
// src/plugins/database-indexes.ts
import { definePlugin, type VextDatabase } from "vextjs";

export default definePlugin({
  name: "database-indexes",
  async setup(app) {
    const db = app.db as VextDatabase | undefined;
    if (!db) throw new Error("Database is not configured");
    await db.model("users").ensureIndexes({ throwOnError: true });
  },
});
```

<a id="2-在服务中使用"></a>

### 4. 在服务中使用

Service 必须默认导出。输入按字段选取，避免把请求中的额外属性直接写入数据库；创建和更新都处理唯一约束冲突，其余错误继续传播。

```typescript
// src/services/user.ts
import { randomUUID } from "node:crypto";
import type { VextApp } from "vextjs";
import type { UserDocument, UserRole } from "../models/user.js";

type UserInput = { name: string; email: string; role?: UserRole };

export default class UserService {
  constructor(private app: VextApp) {}

  private get users() {
    if (!this.app.db) throw new Error("Database is not configured");
    return this.app.db.model<UserDocument>("users");
  }

  private rethrowWriteError(error: unknown): never {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    if (code === 11000 || code === "DUPLICATE_KEY") {
      this.app.throw(409, "用户 ID 或邮箱已存在");
    }
    throw error;
  }

  async findById(id: string) {
    const user = await this.users.findOne({ _id: id });
    if (!user) this.app.throw(404, "用户不存在");
    return user;
  }

  async findAll({
    page = 1,
    limit = 20,
    role,
  }: {
    page?: number;
    limit?: number;
    role?: UserRole;
  } = {}) {
    const filter = role ? { role } : {};
    const { data, total } = await this.users.findAndCount(filter, {
      skip: (page - 1) * limit,
      limit,
      sort: { _id: 1 },
    });
    return {
      items: data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async create(input: UserInput) {
    const doc = {
      _id: randomUUID(),
      name: input.name,
      email: input.email,
      role: input.role ?? "viewer",
    };
    try {
      await this.users.insertOne(doc);
    } catch (error) {
      this.rethrowWriteError(error);
    }
    return this.findById(doc._id);
  }

  async update(id: string, input: Partial<UserInput>) {
    const changes: Partial<UserInput> = {};
    if (input.name !== undefined) changes.name = input.name;
    if (input.email !== undefined) changes.email = input.email;
    if (input.role !== undefined) changes.role = input.role;
    if (Object.keys(changes).length === 0)
      this.app.throw(400, "没有可更新字段");
    try {
      const result = await this.users.updateOne({ _id: id }, { $set: changes });
      if (result.matchedCount === 0) this.app.throw(404, "用户不存在");
    } catch (error) {
      this.rethrowWriteError(error);
    }
    return this.findById(id);
  }

  async delete(id: string) {
    const result = await this.users.deleteOne({ _id: id });
    if (result.deletedCount === 0) this.app.throw(404, "用户不存在");
  }
}
```

### 5. 注册路由

文件 `src/routes/users.ts` 已带来 `/users` 前缀，内部注册 `"/"`、`"/:id"`。分页只接受整数并设置上限；局部更新使用 PATCH。若从后台任务或其他 Service 直接调用这些方法，也应验证对应输入。

```typescript
// src/routes/users.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/",
    {
      validate: {
        query: {
          page: "integer:1-1000",
          limit: "integer:1-100",
          role: "admin|editor|viewer",
        },
      },
    },
    async (req, res) => {
      res.json(await app.services.user.findAll(req.valid("query")));
    },
  );
  app.get(
    "/:id",
    { validate: { param: { id: "uuid!" } } },
    async (req, res) => {
      res.json(await app.services.user.findById(req.valid("param").id));
    },
  );
  app.post(
    "/",
    {
      validate: {
        body: {
          name: "string:1-50!",
          email: "email!",
          role: "admin|editor|viewer",
        },
      },
    },
    async (req, res) => {
      const user = await app.services.user.create(req.valid("body"));
      res.setHeader("Location", `/users/${user._id}`);
      res.json(user, 201);
    },
  );
  app.patch(
    "/:id",
    {
      validate: {
        param: { id: "uuid!" },
        body: {
          name: "string:1-50",
          email: "email",
          role: "admin|editor|viewer",
        },
      },
    },
    async (req, res) => {
      res.json(
        await app.services.user.update(
          req.valid("param").id,
          req.valid("body"),
        ),
      );
    },
  );
  app.delete(
    "/:id",
    { validate: { param: { id: "uuid!" } } },
    async (req, res) => {
      await app.services.user.delete(req.valid("param").id);
      res.json(null, 204);
    },
  );
});
```

### 6. 启动并验证

先执行 `npx vext typegen` 生成 Service 类型，再执行 `npm run dev`；使用临时数据库时按下方测试章节选择 `--config database-check`。使用新邮箱创建记录，响应为 201，正文中的 `data._id` 是后续访问所用 ID：

```powershell
$body = @{ name = "Alice"; email = "alice@example.com" } | ConvertTo-Json
$created = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/users -ContentType "application/json" -Body $body
$userId = $created.data._id
Invoke-RestMethod "http://127.0.0.1:3000/users/$userId"
Invoke-RestMethod "http://127.0.0.1:3000/users?page=1&limit=20"
$change = @{ name = "Alice Updated" } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "http://127.0.0.1:3000/users/$userId" -ContentType "application/json" -Body $change
Invoke-WebRequest -Method Delete -Uri "http://127.0.0.1:3000/users/$userId"
```

创建后先用相同邮箱再次 POST，应返回 409；非法邮箱或小数页码应返回 422，非法路径 UUID 返回 400。DELETE 成功为 204 空正文，删除后 GET 为 404。修改环境或配置后要重新启动。停止开发服务，再执行 `npm run build -- --typecheck` 和 `npm start`，复验同一流程；使用临时数据库时，两条命令均按测试章节附加 `--config database-check`，重启后的数据不保留。

## 工作原理

### 条件加载

MonSQLize 插件采用**条件加载**策略：仅当 `config.database` 是非空对象时才会启用。未配置或空对象会跳过 setup，不建立连接和相关 hook；包本身仍是 Vext 的运行时依赖。

```
bootstrap()
  → 检测 config.database 是否为非空对象
  → 是 → 创建 MonSQLize 实例 → 连接 → 加载 Model → 挂载 app.db
  → 否 → 跳过插件 setup
```

### 加载时机

MonSQLize 在**用户插件之前**加载，确保用户插件的 `setup()` 中可以安全使用 `app.db`：

```
CLI bootstrap
  → 内置 MonSQLize 插件 setup()    ← 在这里
  → 用户插件 plugin-loader          ← app.db 已可用
  → middleware-loader
  → service-loader
  → router-loader
```

### 失败即终止 (Fail Fast)

数据库连接失败时，插件会直接抛出错误并终止启动——不会让应用在数据库不可用的状态下运行：

```
[monsqlize] connected successfully     ← 正常
[monsqlize] plugin ready

[monsqlize] Error: connect ECONNREFUSED 127.0.0.1:27017  ← 连接失败，启动终止
```

## 配置详解

### 基础连接

当前内置集成使用 MongoDB。连接地址写入 `config.uri`；`config.url` 是兼容别名。`databaseName` 显式值优先，否则尝试从 URI 路径提取。建议明确数据库名，特别是在测试和多节点 URI 中。

```typescript
// src/config/default.ts
export default {
  database: {
    // 连接配置
    config: {
      uri: "mongodb://localhost:27017/myapp",
    },
  },
};
```

### 副本集连接

将节点、认证和副本集选项写入 MongoDB URI：

```typescript
export default {
  database: {
    databaseName: "myapp",
    config: {
      uri: "mongodb://admin:secret@mongo1:27017,mongo2:27017,mongo3:27017/myapp?replicaSet=rs0&authSource=admin",
    },
  },
};
```

用户名或密码中的 URI 保留字符应进行百分号编码。驱动选项也可通过 `config.options` 传入。

### SRV 连接（MongoDB Atlas）

```typescript
export default {
  database: {
    databaseName: "myapp",
    config: {
      uri: "mongodb+srv://admin:secret@cluster0.abc123.mongodb.net/myapp",
    },
  },
};
```

`database.type` 的旧 `url/replica/srv` 值仍在兼容类型中，但当前插件统一创建 MongoDB 实例，不根据该字段拼装连接地址。只写 `host`、`hosts`、`username` 等分散字段不能代替 `config.uri`。

### 完整配置项

| 配置项                | 类型                          | 默认值                  | 说明                                                            |
| --------------------- | ----------------------------- | ----------------------- | --------------------------------------------------------------- |
| `type`                | `'url' \| 'replica' \| 'srv'` | `'url'`                 | 兼容字段，实际连接方式由 URI 决定                               |
| `config`              | `object`                      | —                       | `uri` 连接字符串及 `options` 驱动配置；`url` 仅兼容             |
| `maxTimeMS`           | `number`                      | `2000`                  | 全局查询超时（毫秒）                                            |
| `findLimit`           | `number`                      | `10`                    | `find` 默认返回条数                                             |
| `findPageMaxLimit`    | `number`                      | `500`                   | 分页最大 limit                                                  |
| `slowQueryMs`         | `number`                      | `500`                   | 慢查询阈值（毫秒）                                              |
| `autoConvertObjectId` | `boolean \| object`           | 上游 MongoDB 默认开启   | 常见场景使用布尔开关；UUID 示例不依赖此转换                     |
| `namespace`           | `{ scope: string }`           | `{ scope: 'database' }` | 缓存命名空间                                                    |
| `cursorSecret`        | `string`                      | —                       | 深分页游标签名密钥；签名不隐藏游标内容                          |
| `useMemoryServer`     | `boolean`                     | `false`                 | 启动临时 MongoDB 进程用于测试，需额外依赖                       |
| `memoryServerOptions` | `object`                      | —                       | 转交 `MongoMemoryServer.create()` 的配置，例如二进制版本        |
| `logger`              | `'app' \| false`              | `'app'`                 | 日志桥接（`'app'` 使用 app.logger）                             |
| `cache`               | `object`                      | —                       | 缓存配置（见下方）                                              |
| `models`              | `object`                      | —                       | Model 加载配置（见下方）                                        |
| `databaseName`        | `string`                      | 尝试从 URI 提取         | 显式值优先；临时服务器、多节点 URI 建议始终设置                 |
| `pools`               | `array`                       | —                       | 多连接池配置                                                    |
| `poolStrategy`        | `string`                      | `'auto'`                | 连接池选择策略                                                  |
| `slowQueryLog`        | `object`                      | —                       | 慢查询持久化配置                                                |
| `monsqlizeOptions`    | `VextMonSQLizeOptions`        | —                       | 受控的 MonSQLize 高级配置；连接与 Vext 生命周期相关字段仍受保护 |

### 受控的 MonSQLize 高级配置

应用需要上游构造能力、但不希望替换 Vext 所有的连接或生命周期配置时，使用
`database.monsqlizeOptions`：

```typescript
import type { VextUserConfig } from "vextjs";

export default {
  database: {
    config: { uri: "mongodb://localhost:27017/myapp" },
    monsqlizeOptions: {
      findMaxLimit: 2_000,
      findMaxSkip: 20_000,
      transaction: { enableRetry: true, maxRetries: 2 },
      autoIndex: { enabled: true, emitEvents: true },
      cacheAutoInvalidate: true,
      writePathPolicy: { default: "model-only" },
    },
  },
} satisfies VextUserConfig;
```

公开类型 `VextMonSQLizeOptions` 直接从固定的 `monsqlize@3.3.0`
`MonSQLizeOptions` 中取型；运行时使用同一 allowlist：

- `schemaDsl`
- `poolFallback`、`maxPoolsCount`
- `sync`、`transaction`
- `findMaxLimit`、`findMaxSkip`
- `requireCursorSecret`、`cursorSecretWarning`、`cursorTypes`、
  `cursorValueNormalizer`
- `log`、`countQueue`、`autoIndex`、`cacheAutoInvalidate`、`writePathPolicy`

Vext 会在调用 MonSQLize 构造函数前拒绝未知字段，以及这些由 Vext 管理的字段：
`type`、`databaseName`、`database`、`config`、`cache`、`logger`、
`pools`、`poolStrategy`、`maxTimeMS`、`findLimit`、
`findPageMaxLimit`、`slowQueryMs`、`slowQueryLog`、
`autoConvertObjectId`、`namespace`、`cursorSecret`、`models`。请继续通过
一等 `database.*` 字段配置它们，以保持连接归一化、日志、Model 加载与关闭流程
可预测。

### 缓存配置

MonSQLize 支持 L1 内存 LRU 和可选 L2 Redis。配置缓存存储不代表每条查询自动使用缓存；按查询传入毫秒 TTL，例如 `users.findOne(filter, { cache: 5_000 })`。写入失效也不提供跨进程事务一致性。

```typescript
export default {
  database: {
    config: { uri: "mongodb://localhost:27017/myapp" },

    cache: {
      // L1 内存缓存（默认开启）
      memory: {
        enabled: true,
        maxSize: 1000, // 最大缓存条数
        ttl: 300_000, // 默认 TTL（毫秒，5 分钟）
      },

      // L2 Redis 缓存（可选）
      redis: {
        enabled: true,
        uri: "redis://localhost:6379",
        prefix: "myapp:cache:",
        ttl: 600_000, // 毫秒，10 分钟
      },
    },
  },
};
```

Redis 缓存连接字段以 `uri` 为准；`url` 仅作为旧配置兼容别名保留，新项目建议统一使用 `uri`。

上例 TTL 是显式配置值。当前 Vext 在提供 `cache` 对象且未禁用 memory 分支时，会把缺省 `memory.ttl` 填为 **300 毫秒**、`maxSize` 填为 1000；因此建议明确 TTL。`memory.enabled: false` 只让 Vext 不传这一分支，上游仍可能创建默认 L1，不能据此认为内存缓存已关闭。不需要查询缓存时不要为查询设置正数 `cache`。`logger: false` 同样只关闭 Vext 日志桥接，不保证上游完全静默。

### 多环境配置

运行时深度合并支持按环境 patch 数据库，但 TypeScript 文件的职责不同：`default.ts` 是完整 base，使用 `VextUserConfig`；profile 文件是后层 patch，使用 `VextConfigOverride`。

:::warning 不要跨层拆分半截 database
不要在 `default.ts` 里只写 `findLimit` / `models`，再把必填的 `config.uri` 留到 `development.ts`。`default.ts` 中写出的 `database` 对象必须独立满足 `MonSQLizeDatabaseConfig`；TypeScript 不会把检查推迟到运行时合并之后。应先在 base 提供完整连接，再由后层只覆盖环境差异。
:::

`MonSQLizeDatabaseConfig` 要求存在 `config` 对象，但兼容类型中的 `uri/url` 本身仍是可选字段。因此“类型通过”不能证明连接字符串已提供或可连接；当前运行时连接还必须通过真实启动验证。

可以选择两种健全结构：像下面的例子一样，在 `default.ts` 中保留一份完整
`database`，后续 profile 用 `VextConfigOverride` 只写差异；或者让 `default.ts`
完全不声明 `database`，每个会启用数据库的 profile 都提供完整
`MonSQLizeDatabaseConfig`。第二种结构应单独用 `MonSQLizeDatabaseConfig`
校验 profile 的 database 值；前层不存在 database 时，不得用更宽松的覆盖类型
掩盖连接缺失。

#### 布局 A — base 中提供完整 database

```typescript
// src/config/default.ts — 完整 base
import type { VextUserConfig } from "vextjs";

const config: VextUserConfig = {
  database: {
    config: { uri: "mongodb://localhost:27017/myapp" },
    findLimit: 10,
    models: { dir: "models" },
    slowQueryMs: 500,
  },
};

export default config;
```

```typescript
// src/config/development.ts — 合法的局部 database patch
import type { VextConfigOverride } from "vextjs";

const config: VextConfigOverride = {
  database: {
    findLimit: 25,
    models: { validation: "strict" },
  },
};

export default config;
```

```typescript
// src/config/production.ts — patch 环境专属的连接 URI
import type { VextConfigOverride } from "vextjs";

const config: VextConfigOverride = {
  database: {
    config: {
      uri: "mongodb://prod-db:27017/myapp",
    },
    slowQueryMs: 200, // 生产环境慢查询阈值更低
  },
};

export default config;
```

```typescript
// src/config/database-check.ts — 验证环境使用临时数据库
import type { VextConfigOverride } from "vextjs";

const config: VextConfigOverride = {
  database: {
    databaseName: "vext_docs_database_test",
    useMemoryServer: true, // 使用 mongodb-memory-server-core
  },
};

export default config;
```

#### 布局 B — database 从 profile 开始

如果 base 有意省略 `database`，第一个启用数据库的 profile 必须拥有完整值。先用
严格数据库类型校验该值，再放入 profile override：

```typescript
// src/config/development.ts — 前层不存在 database
import type { MonSQLizeDatabaseConfig, VextConfigOverride } from "vextjs";

const database = {
  config: { uri: "mongodb://localhost:27017/myapp" },
  findLimit: 25,
  models: { dir: "models", validation: "strict" },
} satisfies MonSQLizeDatabaseConfig;

const config = { database } satisfies VextConfigOverride;

export default config;
```

每个可能作为首个数据库启用层、且可独立选择的 profile，都必须重复提供完整的
`MonSQLizeDatabaseConfig`。

## app.db — 原始 MonSQLize 实例

插件初始化成功后，`app.db` 就是内置插件创建的同一个原始 `MonSQLize` 实例，
Vext 不再增加 facade 或 Proxy。框架只在该对象上窄幅补充只读 `client` getter 和
软删除返回值兼容，因此 `withTransaction()`、`on()`、`sync()`、`pool()`、
`scopedModel()` 等上游实例能力都从唯一入口 `app.db` 访问。

以下都是数据库已配置后的参考片段，`app` 来自 Service 或插件。TypeScript 中先检查 `if (!app.db) throw new Error("Database is not configured")`。涉及 ID、金额或向量的变量需由业务输入提供；这些片段不是额外的完整项目文件。

### collection(name)

获取集合操作对象。直接 collection 写入不会自动经过 Model 的 schema、hooks 和 timestamps；需要这些语义时使用 `model()`，可通过 `writePathPolicy` 约束写入路径：

```typescript
// 获取 users 集合
const usersCol = app.db.collection("users");

// 查询
const user = await usersCol.findOne({ email: "test@example.com" });
const users = await usersCol.find({ role: "admin" });

// 插入
const result = await usersCol.insertOne({
  name: "张三",
  email: "zhangsan@example.com",
});

// 更新
await usersCol.updateOne({ _id: userId }, { $set: { name: "李四" } });

// 删除
await usersCol.deleteOne({ _id: userId });

// 聚合
const stats = await usersCol.aggregate([
  { $group: { _id: "$role", count: { $sum: 1 } } },
]);

// 计数
const total = await usersCol.countDocuments({ role: "admin" });
```

### model(name)

获取已注册的 Model 操作对象（需先定义 Model，见下方 Model 章节）：

```typescript
// src/models/user.ts 导出 { collection: "users", ... } 时，根目录注册键
// 就是精确的 "users"，不会自动单数化或转为 PascalCase。
const User = app.db.model("users");

// Model 提供更高级的 API（分页、缓存、校验等）
const result = await User.findPage({
  query: { role: "admin" },
  page: 1,
  limit: 20,
  sort: { createdAt: -1, _id: -1 },
  totals: { mode: "sync" },
});
const { items, pageInfo, totals } = result;
```

`findPage(options)` 接收单个 options 对象，条件放在 `query`。返回 `items`、`pageInfo` 和可选 `totals/meta`；不要使用双参数写法或读取 `result.data`。游标翻页使用 `after` / `before`，并保持相同过滤条件与稳定排序。

`findAndCount(query, options)` 返回 `{ data, total }`，`find(query, options)` 也是合法原生 API。需要分页时优先原生分页，不先读取固定数量的文档再在 service 中筛选、计数或 `slice`。页码、limit、游标及超出上限的行为要经过请求校验和数据库测试。

TypeScript 使用 `app.db.model<PostDocument>(registeredKey)` 获得原生查询结果类型。领域文档可放 `src/types/server/models/`，service 输入/输出契约放 `src/types/server/services/`；目录遵从项目自有规范，不复制一套 Collection 或 Repository 接口。部分写入参数允许 `unknown`，仍需输入类型、请求 schema 和模型 schema。

数据库缓存的查询 `cache`、`cache.memory.ttl`、`cache.redis.ttl` 均为毫秒；session store 的 `ttlSeconds` 则是秒，由适配器转换，不能混用。配置值直接交给底层，本次说明不改变运行值。

<a id="mcp-消费者验证中的分页与校验边界"></a>

### 分页总数与缓存

在当前 MonSQLize 中，`findPage({ totals: { mode: "sync" } })` 的总数仍可能来自独立缓存，默认 `totals.ttlMs` 为 600000 毫秒。`cache: 0` 不代表强制重新统计；也不能把统计失败返回的 `null/error` 显示为 0。需要直接计数的编号分页可采用开头的 `findAndCount()`，消费 `data/total`，同时保留两次读取不是事务快照的边界。数组字段和唯一错误码的说明分别见 Model 定义和服务章节。

### use(dbName)

切换到指定数据库（默认连接池），适合单连接多库的场景：

```typescript
// 访问 billing 数据库的 invoices 集合
const billing = app.db.use("billing");
const invoice = await billing.collection("invoices").findOne({ _id: id });

// 也可直接链式调用
const anotherInvoice = await app.db
  .use("billing")
  .collection("invoices")
  .findOne({ _id: id });

// use() 只切换数据库 scope，不会改写注册键。
// models/billing/invoice.ts 这类 depth-1 文件注册为 BillingInvoice。
const Invoice = app.db.use("billing").model("BillingInvoice");
```

### pool(poolName)

先配置池名和实际可连接的地址，例如合并以下配置到应用的 `database`：

```typescript
// database 对象内的配置片段；先准备这两个 MongoDB 实例。
pools: [
  { name: "cn", config: { uri: "mongodb://127.0.0.1:27018/myapp" } },
  { name: "billing", config: { uri: "mongodb://127.0.0.1:27019/billing" } },
],
poolStrategy: "auto",
```

池的驱动选项写在与 `name/config` 同级的 `options` 中。下面的 Model 访问还要求已注册对应定义或别名（见 Model 章节）；只有数据库连接配置并不会自动生成 Model。

切换到指定连接池后，返回包含 `collection` / `model` / `use` 的访问器：

```typescript
// 访问 cn 池的 orders 集合
const order = await app.db.pool("cn").collection("orders").findOne({ _id: id });

// 连接池中的 Model 查询仍使用精确注册键。
const Invoice = app.db.pool("billing").model("BillingInvoice");
// 只有 Model 显式声明 key: "Invoice" 时，短键才有效。
const InvoiceAlias = app.db.pool("billing").model("Invoice");

// cn 池 + billing 库（collection）
const invoice = await app.db
  .pool("cn")
  .use("billing")
  .collection("invoices")
  .findOne({});

// cn 池 + billing 库 + 精确的 Model 注册键
const InvoiceCn = app.db.pool("cn").use("billing").model("BillingInvoice");

// 深度-2 模型目录（models/cn/billing/order.ts）：注册键 = CnBillingOrder
// scope accessor 不会自动添加前缀，也不会回落到另一个键。
const Order1 = app.db.model("CnBillingOrder"); // 完整 key
const Order2 = app.db.pool("cn").use("billing").model("CnBillingOrder");
// 两者用不同的显式 scope 解析同一个已注册 Model。
```

> ⚠️ `pool()` 会立即校验连接池是否存在，通过后才返回 accessor。未配置连接池管理器时抛出 `NO_POOL_MANAGER`；找不到指定池名时抛出 `POOL_NOT_FOUND`（`err.available` 含可用池列表）。model / collection / use 仅在校验通过后可用。

> ℹ️ **`pool().use(dbName)` 中的 `dbName` 会覆盖 Model 定义中 `connection.database` 的值**。例如，Model 定义了 `connection.database: "billing"`，通过 `pool("cn").use("archive")` 访问时，实际查询将使用 `archive` 数据库而非 `billing`。
> 如需按精确 key 并显式覆盖数据库/连接池，请使用 `app.db.scopedModel(key, { pool, database })`。

### client

只读 `client` getter 指向默认连接的原始 MongoDB Client。以下示例要求 MongoDB 副本集或分片集群支持事务；单节点临时实例不能据此验证事务。`fromId`、`toId`、`amount` 来自业务输入，同一个事务中的操作必须显式传入同一 `session`，不要跨不属于该 Client 的连接池使用：

```typescript
const session = app.db.client.startSession();

try {
  await session.withTransaction(async () => {
    await app.db
      .collection("accounts")
      .updateOne({ _id: fromId }, { $inc: { balance: -amount } }, { session });
    await app.db
      .collection("accounts")
      .updateOne({ _id: toId }, { $inc: { balance: amount } }, { session });
  });
} finally {
  await session.endSession();
}
```

## app.db 上的完整 MonSQLize API

`app.db` 就是原始 `MonSQLize` 实例，不是 Vext 缩减包装；v2 不再提供独立的
`app.monsqlize` 入口。

```typescript
const monsqlize = app.db;
if (!monsqlize) throw new Error("Database is not configured");

// 实例级完整能力都保留在 app.db。
await monsqlize.withTransaction(async (transaction) => {
  // ...
});
monsqlize.on("slow-query", (info) => {
  app.logger.warn({ ...info }, "Slow query detected");
});

// app.db 返回上游 Collection / Model 实例。
const hits = await monsqlize.collection("products").vectorSearch({
  index: "product_embedding",
  path: "embedding",
  queryVector: embedding,
  numCandidates: 100,
  limit: 10,
});

const Product = monsqlize.model("Product");
const usage = await Product.checkRelationUsage({ _id: productId });
await Product.deleteOneWithRelations({ _id: productId });
```

:::tip
collection、Model、事务、连接池、同步、事件、诊断和管理 API 都使用唯一入口
`app.db`。Vector Search 需要兼容的 MongoDB 部署和预先创建的索引。关系保护删除
只覆盖已注册、已声明的关系；把结果视为完整证据前应检查 coverage。
:::

Vext 根包只导出 `VextMonSQLizeOptions` 等 Vext 自有集成类型，不镜像全部上游
symbol。需要 MonSQLize 专属类或类型时，请直接从 `monsqlize` 导入。

### 手动注册的类型化 descriptor（3.3.0）

MonSQLize 3.3.0 可以从对象字面量 schema 推导 Model 文档类型。应用代码需要导入
这一包级 API 时，应将与 Vext 所用版本兼容的 `monsqlize` 声明为应用的直接依赖，并确认解析为同一份 Model registry，而不是依赖包管理器碰巧提升传递依赖。这里的 3.3.0 是当前仓库核对的上游版本，不是要求固定 Vext 的安装版本。请先一次性注册 descriptor，再通过原始实例获取 Model：

```typescript
import { defineModel, Model } from "monsqlize";
import type { VextApp } from "vextjs";

const UserDescriptor = defineModel("manual_users", {
  schema: {
    email: "email!",
    age: "number?",
  },
});

Model.define(UserDescriptor);

export async function findUser(app: VextApp, email: string) {
  const User = app.db?.model(UserDescriptor);
  return User?.findOne({ email }); // email: string；age?: number
}
```

这是显式的上游注册路径。不要把 descriptor 作为 `src/models/*` 文件的默认导出：
Vext 自动 Model 加载器仍接收 definition object，并按下文规则推导注册键。由于
`app.db` 是原始实例，手动代码既可以把精确字符串键传给 `app.db.model()`，也可以
传入上游类型化 descriptor。手动注册不属于 Vext 自动加载器的 ownership 和热重载计划；应用应自行安排一次性注册、冲突处理与对应清理，不要在每次请求或模块反复重载时执行 `Model.define()`。

## Model 定义

Model 是对集合操作的封装，提供字段校验、钩子、虚拟字段等高级能力。

### 创建 Model 文件

> MonSQLize Model 层集成了 **schema-dsl**，schema 字段支持 DSL 简洁语法。

#### 推荐写法：schema-dsl 简洁语法 + options.timestamps

下面展示字段与复合索引的定义方式。它是参考片段；合并到开头的 UUID 示例时，应保留原有 `_id` schema 和结果类型。

```typescript
// src/models/user.ts
export default {
  collection: "users",

  // schema-dsl 简洁语法
  schema: {
    name: "string:1-50!", // 必填字符串，1~50 字符
    email: "email!", // 必填，邮箱格式
    role: "admin|editor|viewer", // 枚举值
    avatar: "string", // 可选字符串
  },

  // 索引
  indexes: [
    { key: { email: 1 }, unique: true },
    { key: { role: 1, createdAt: -1 } },
  ],

  // 使用 options.timestamps 自动管理 createdAt/updatedAt
  options: {
    timestamps: true,
  },
};
```

#### 对象格式（复杂场景）

字段可使用 JSON Schema 对象。必填用字段名后缀 `!`，动态默认值使用 Model 顶层 `defaults`；唯一性由 `indexes` 保证，不要在字段内写 `unique: true` 代替索引。下面使用独立的 `members` 注册键，可以与开头的 `users` 共存。

```typescript
// src/models/member.ts
import { randomUUID } from "node:crypto";
import type { VextModelDefinition } from "vextjs";

export default {
  collection: "members",
  schema: {
    "_id!": { type: "string", format: "uuid" },
    "name!": { type: "string", minLength: 1, maxLength: 50 },
    "email!": { type: "string", format: "email" },
    role: { type: "string", enum: ["admin", "editor", "viewer"] },
    tags: { type: "array", items: { type: "string" } },
    slug: { type: "string" },
  },
  defaults: { _id: () => randomUUID(), role: "viewer" },
  indexes: [{ key: { email: 1 }, unique: true }],
  hooks: {
    beforeInsert(context) {
      const doc = context.data;
      if (typeof doc !== "object" || doc === null || !("name" in doc)) return;
      if (typeof doc.name === "string") {
        Object.assign(doc, {
          slug: doc.name.toLowerCase().replace(/\s+/g, "-"),
        });
      }
    },
  },
  options: { timestamps: true },
} satisfies VextModelDefinition;
```

数组使用显式 `{ type: "array", items: { type: "string" } }` 或 `array<string>` DSL。当前 schema-dsl 3.0.4 不正确编译 `["string"]` 简写，静态候选检查也会要求改用显式结构。模型 schema 仍需真实写入验证；仅通过 TypeScript 不能证明校验有效。

### Model options（模型选项）

| 选项         | 类型                | 默认值      | 说明                          |
| ------------ | ------------------- | ----------- | ----------------------------- |
| `timestamps` | `boolean \| object` | `undefined` | 自动管理 createdAt/updatedAt  |
| `softDelete` | `boolean \| object` | `undefined` | 软删除支持                    |
| `version`    | `boolean \| object` | `undefined` | 乐观锁版本号                  |
| `validate`   | `boolean`           | `true`      | 插入/更新时的 schema 校验开关 |

对象式 `hooks` 与 monSQLize 保持一致，接收 `context` 参数；常见写入文档可从 `context.data` 读取。需要访问 Model 实例时，也可以使用 `(model) => ({ ... })` 的 factory 形式。

#### timestamps 配置

```typescript
// 简单模式：自动添加 createdAt + updatedAt
options: { timestamps: true }

// 自定义字段名
options: { timestamps: { createdAt: 'created_time', updatedAt: 'updated_time' } }

// 只启用 createdAt（日志类集合）
options: { timestamps: { createdAt: true, updatedAt: false } }
```

### `key` 别名（跨连接池快捷访问）

当 Model 集合名包含前缀（如 `BillingInvoice`）时，可以定义 `key` 别名，通过短名快捷访问：

```typescript
// src/models/billing-invoice.ts
export default {
  collection: "BillingInvoice", // MongoDB 实际集合名
  key: "Invoice", // 短名别名（可选）

  schema: {
    amount: "number!",
    currency: "CNY|USD|EUR",
    status: "draft|pending|paid",
  },

  // 绑定到指定连接池 + 数据库（让 app.db.model() 路由正确）
  connection: {
    pool: "billing",
    database: "billing",
  },
};
```

注册后，两个 key 均可使用：

```typescript
app.db.model("BillingInvoice"); // 按集合名（全路径）
app.db.model("Invoice"); // 按别名（短名）

// scope 切换不会改写任一精确键
app.db.pool("billing").model("BillingInvoice");
app.db.pool("billing").model("Invoice");
```

> **注意**：primary 注册键与 `key` 别名作为一个 Model 注册组检查冲突。默认 `validation: "strict"` 下冲突使加载失败；显式 `"lenient"` 会警告并跳过有问题的注册组，不保证只丢弃别名而保留 primary。

Model 文件放在 `src/models/` 目录下，插件会自动扫描并注册：

```
src/
├── models/
│   ├── user.ts         → Model 名称: 'User'
│   ├── order.ts        → Model 名称: 'Order'
│   ├── product-item.ts → Model 名称: 'ProductItem'
│   └── index.ts        → Model 名称: 'Index'（除非 collection/name 覆盖）
```

上图以未声明 `collection/name` 为前提。开头的 `user.ts` 声明了 `collection: "users"`，实际注册键是 `users`。文件名推断规则：

- `user.ts` → `'User'`（首字母大写）
- `order-item.ts` → `'OrderItem'`（kebab-case → PascalCase）
- `user_role.ts` → `'UserRole'`（snake_case → PascalCase）
- `.test.ts` / `.spec.ts` / `.d.ts` → 跳过
- `_` 开头的文件 → 跳过
- `index.ts` 是普通 Model 文件；位于根目录时推导为 `'Index'`

### 目录路由（自动绑定连接池 / 数据库）

将 Model 文件放入 `models/` 的子目录，可以让 vext 自动推断所属连接池和数据库，无需在每个文件中手动填写 `connection` 字段。

**目录深度规则：**

| 目录结构                         | 注册键名                                           | 自动注入                                            |
| -------------------------------- | -------------------------------------------------- | --------------------------------------------------- |
| `models/order.ts`                | `Order`（或 `def.collection` / `def.name`）        | 无（行为不变）                                      |
| `models/billing/invoice.ts`      | `BillingInvoice`                                   | `connection: { database: 'billing' }`               |
| `models/main/billing/invoice.ts` | `MainBillingInvoice`                               | `connection: { pool: 'main', database: 'billing' }` |
| `models/a/b/c/invoice.ts`        | ❌ 超出最大深度 2：strict 失败，lenient 警告并跳过 | —                                                   |

> 💡 显式 `connection` 不会放宽最大扫描深度。如需更复杂的数据库路由，将文件放在受支持的深度内并显式设置连接信息，或通过共享 Model 定义包组织。

**示例：按业务领域拆分 Model**

```
src/models/
├── order.ts              → 注册为 'Order'（默认数据库）
├── billing/
│   ├── invoice.ts        → 注册为 'BillingInvoice'，database: 'billing'
│   └── payment.ts        → 注册为 'BillingPayment'，database: 'billing'
└── main/
    └── billing/
        └── invoice.ts    → 注册为 'MainBillingInvoice'，pool: 'main', database: 'billing'
```

```typescript
// src/models/billing/invoice.ts
import type { VextModelDefinition } from "vextjs";

// 无需手动写 connection — 由目录路径自动推断
export default {
  schema: {
    amount: "number!",
    currency: "CNY|USD|EUR",
    status: "draft|pending|paid",
  },
} satisfies VextModelDefinition;

// 效果等同于显式配置：
// export default {
//   name: "invoice",
//   connection: { database: "billing" },
//   schema: { ... },
// };
```

**三种名称与注入优先级：** 根目录 primary 注册键为 `collection ?? name ?? PascalCase(file)`；一至二级目录的 primary 始终由完整相对路径生成（如 `BillingInvoice`）。`collection` / `name` 决定真实集合名；目录模式未显式设置时使用原始文件名 `invoice`，不会把 `BillingInvoice` 当集合名。`key` 另外增加精确别名，不改 primary。显式 `connection` 整体优先；目录不会补齐或覆盖其中字段。`app.db.model()` 按精确注册键访问，`app.db.collection()` 则直接访问集合。

### Model 加载配置

```typescript
export default {
  database: {
    config: { uri: "mongodb://localhost:27017/myapp" },

    models: {
      // Model 定义文件目录（相对于 src/，默认 'models'）
      dir: "models",

      // 是否自动注册（默认 true）
      autoRegister: true,

      // 发现策略：strict（默认）或 lenient
      validation: "strict",

      // 外部共享 Model 包（微服务场景）
      sharedPackage: "@myproject/shared-models",
    },
  },
};
```

`validation: "strict"` 会在修改全局 Model registry 前完成发现、导入、解析与校验。任何无效定义、冲突或提交失败都会终止启动，并回滚整份注册计划。显式使用 `"lenient"` 时只会警告并跳过发现阶段的无效输入；registry 冲突和提交失败仍然 fail closed。注册项归当前应用所有，应用关闭时只释放自己的 Model，不会清空其它应用的注册项。

### 共享 Model 包（微服务场景）

在微服务架构中，多个服务可能共享同一套 Model 定义。通过 `sharedPackage` 从 npm 包加载：

```typescript
// 加载顺序：先 shared 包 → 再本地 models/
// 本地 Model 可以覆盖 shared 包中同名的 Model
models: {
  sharedPackage: '@myproject/shared-models',
  dir: 'models',  // 本地 Model（可覆盖 shared）
}
```

本地覆盖仅适用于同一 primary 注册键；别名和其他注册组之间的冲突仍按发现/注册规则处理。

共享包必须 default export Model 定义对象，例如 `{ User: { schema: ... } }`。回调式 `registerModels()` 包会被拒绝，因为 Vext 无法预检、归属所有权或回滚不透明回调注册的 key。

共享包从当前服务根目录解析，支持 monorepo 提升安装和 pnpm 链接。使用 Node 的 `node` / `import` 条件选择 `exports`，可加载 ESM default、CommonJS `module.exports` 及编译后的 `__esModule`/default 包装。开发编译目录不改变依赖归属；被 `exports` 隐藏的入口或缺少的编译文件会明确报错。共享包应先完成自己的构建，再启动消费它的服务。

## 在服务中使用

### 基础 CRUD 服务

[快速开始](#快速开始)中的 `src/services/user.ts` 是本页完整服务实现：默认导出类、显式输入/结果类型、Model 校验及 timestamps、唯一索引冲突转换、带范围限制的分页和 404。通过 getter 获取 Model，避免在长期存活对象中固定旧 Model 实例。

`findAndCount(query, { skip, limit, sort })` 返回 `data/total`，不需要先读取固定条数再做数组过滤或 `slice`。两次读取不等于事务快照，并发修改仍可能产生读取时刻差异。请求校验限制 page/limit，其他调用者应保持同一约束。

### 在路由中配合使用

复用开头的 `src/routes/users.ts`：GET/POST `/users`、GET/PATCH/DELETE `/users/:id`。不要在这个文件中再次注册 `"/users"`。默认 JSON 响应包装把结果放入 `data`；204 不包含正文。

MongoDB 唯一键错误可能表现为数值 `11000`，也可能被上游归一为 `"DUPLICATE_KEY"`。服务对本例用户 ID/邮箱唯一约束统一返回 409，其余错误继续传播；不要按错误文本包含某个单词来吞掉失败。请求 schema 和 Model schema 需要分别验证，TypeScript 通过不代表数据库写入校验通过。

## 在插件中使用

内置 MonSQLize 在用户插件之前初始化，这一顺序由 bootstrap 保证，无需在用户插件 `dependencies` 中声明内置插件名。上面的 `database-indexes` 就是在 setup 中等待数据库工作的完整例子。

初始化数据也可在 setup 中操作，但每个进程都会执行。不要用“先 count 为 0，再插入管理员”作为并发安全保障；初始化账号应遵循业务认证、幂等键和唯一约束，并妥善处理多进程竞争。插件依赖字段仅用于实际存在的用户插件间排序。

## 测试中使用

### 使用内存数据库

在测试环境中使用 `mongodb-memory-server-core` 运行内存数据库，无需外部 MongoDB 实例：

```bash
npm install -D mongodb-memory-server-core
```

Vext 使用 core 包以避免 `mongodb-memory-server` wrapper 在 `npm install` 阶段触发 binary 下载。测试首次启动时仍可能下载 MongoDB binary；建议在 CI 中设置 `MONGOMS_DOWNLOAD_DIR=.cache/mongodb-binaries` 与 `MONGOMS_PREFER_GLOBAL_PATH=false`，并缓存该目录；缓存命中后可用 `MONGOMS_RUNTIME_DOWNLOAD=false` 验证不会再次下载。

下面的局部 `database-check.ts` 仅在前层已经拥有完整 database 配置时成立。如果
`default.ts` 完全不声明 `database`，这个 profile 必须改为提供完整的
`MonSQLizeDatabaseConfig`。

```typescript
// src/config/database-check.ts
import type { VextConfigOverride } from "vextjs";

const config: VextConfigOverride = {
  database: {
    databaseName: "vext_docs_database_test",
    useMemoryServer: true,
  },
};

export default config;
```

临时实例由 Vext 在启动时创建并在关闭时停止；它是真实的 mongod 子进程，会使用本地临时数据目录。内置选项会替换原 URI，应显式设置测试数据库名。在项目目录启动：

```bash
npm run dev -- --config database-check
```

验证结束按 Ctrl+C 关闭。profile 由 `--config` 或 `VEXT_CONFIG` 选择，不能用 `NODE_ENV=test` 代替。验证生产构建时执行 `npm run build -- --typecheck --config database-check`，然后 `npm start -- --config database-check`；正常应用启动则选择自己的 profile。

这里有意使用自定义名字 `database-check`：构建会排除 `config/development.*`、`config/local.*`、`config/test.*`，因此不能把开发模式中的 `test.ts` 直接当成构建后可用的验证 profile。启动前确认对应配置已进入产物。

### 测试示例

数据库端到端测试应针对上面已用 `--config database-check` 启动的 CLI 应用发起请求。`createTestApp()` 不会自动读取项目配置或初始化内置 MonSQLize；其返回值是 `{ app, request, close }`，不存在 `app.inject()`。只测路由/Service 时可以显式注入 mock；不能把这种结果当成数据库集成验证。

以下使用 Node 内置测试运行器，不需要额外测试依赖。另开终端保存并执行 `node --test test/database.test.mjs`：

```javascript
// test/database.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

test("创建用户、拒绝重复邮箱并清理数据", async () => {
  const base = "http://127.0.0.1:3000";
  const body = { name: "Alice", email: `reader-${randomUUID()}@example.com` };
  const create = () =>
    fetch(`${base}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const created = await create();
  assert.equal(created.status, 201);
  const { data } = await created.json();
  try {
    assert.equal(data.name, "Alice");
    const duplicate = await create();
    assert.equal(duplicate.status, 409);
    await duplicate.text();
  } finally {
    const removed = await fetch(`${base}/users/${data._id}`, {
      method: "DELETE",
    });
    assert.equal(removed.status, 204);
  }
});
```

这条测试覆盖真实 HTTP、框架加载、Model 和唯一索引。事务、副本集、多连接池及 Redis 缓存需要相应测试环境，不能由单实例 CRUD 测试推导通过。

## 慢查询监控

MonSQLize 内置慢查询检测。查询耗时超过 `slowQueryMs` 阈值时自动打印警告日志：

```typescript
export default {
  database: {
    config: { uri: "mongodb://localhost:27017/myapp" },
    slowQueryMs: 200, // 超过 200ms 的查询会产生警告

    // 可选：持久化慢查询记录到专用集合
    slowQueryLog: {
      enabled: true,
      collection: "_slow_queries",
    },
  },
};
```

日志输出示例：

```
[14:23:05.123] WARN [monsqlize] Slow query: users.find({role:"admin"}) 523ms
```

## Model 热重载（开发模式）

在 `vext dev` 开发模式下，修改 `src/models/` 目录下的 Model 定义文件会自动触发软重载（日志标记 `T1:code`），框架将重新加载变更的 Model 定义，无需手动重启服务器。

### 工作原理

```
修改 src/models/item.ts
  ↓
esbuild 重新编译 → .vext/dev/models/item.js
  ↓
model-reloader 检测到 invalidated 文件
  ↓
构建并校验完整替换计划
  ↓
使用 rollback journal 原子替换本应用受影响的定义
  ↓
后续重新获取 Model 时使用新定义
```

### 重载行为说明

| 场景                   | 行为                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------- |
| 修改 schema / hooks    | 重新获取的 Model 使用新定义；长期持有的旧实例不会自动变成新实例                       |
| 修改 indexes           | 定义变化不等于数据库迁移完成；自动建索引策略和显式 `ensureIndexes()` 的结果需另外验证 |
| 重载计划校验或提交失败 | 回滚注册计划并报告错误；运行时写入才触发的校验错误不等于重载已被拒绝                  |
| 并发请求               | 已持有旧 Model 的操作仍可能沿用旧实例；不要承诺所有在途请求一起切换                   |

索引涉及存量数据和唯一约束，不应仅凭“冷重启过”判定同步成功。开头示例关闭自动建索引，在启动插件里显式等待；热重载 Model 不会重新执行该插件。修改索引后按部署流程重新执行索引检查并处理冲突，再验证写入行为。

### 日志输出示例

保存 `src/models/item.ts` 后，终端会输出：

```
[vext dev] 1 file(s) changed:
  🟢 src/models/item.ts (modify)
[vext dev] source change detected → soft reload [T1:code]...
[hot-reload] model "items" reloaded
[hot-reload] [OK] 48ms [T1:code] (compile:3ms cache:2ms i18n:0ms mw:5ms svc:8ms model:3ms route:25ms swap:2ms) [12 modules evicted] #3
```

注意日志中的 `model:3ms` 计时段，表示 Model 重载耗时。

:::tip 回滚保障
发现、预检或注册提交阶段的失败会回滚。并非所有字段语义错误都会在该阶段暴露；仍须执行对应数据库写入验证。修复代码后保存，重载会再次触发。
:::

:::info 框架内部机制
`Model.redefine()` / `Model.undefine()` 是 monSQLize 提供的原生 Model API，由 vext 框架在热重载流程中自动调用，用户无需手动调用。
:::

## 优雅关闭

MonSQLize 插件在 `app.onClose()` 中注册了数据库连接关闭钩子。当应用收到 `SIGTERM` / `SIGINT` 信号时：

1. 停止接受新请求
2. 等待飞行中的请求完成
3. 执行 `onClose` 钩子（LIFO 顺序）
4. MonSQLize 关闭数据库连接
5. 进程退出

内置连接、该应用拥有的 Model 注册项和由插件启动的临时 MongoDB 会一起清理。无需手动关闭 `app.db`；自行创建的其他连接和手动注册项应自行负责。关闭等待受 shutdown 超时限制，并非无限等待。

<a id="迁移指南-v02x--v030"></a>

## 旧代码与当前 API 的兼容边界

<a id="b1appdbdb-已移除"></a>

### B1：`app.db.db()` 与 `use()`

当前原始 MonSQLize 实例公开 `db(name?)`，不能再断言它“已移除”或“一定报错”。`db()` 提供数据库集合访问器；需要集合与 Model 统一的 scope 访问时，本指南使用 `use(dbName)`：

```typescript
const logsDb = app.db.use("logs");
const logsCollection = app.db.db("logs").collection("events");
// 需要同时指定池和库时：
const regionalLogs = app.db.pool("cn").use("logs");
```

### B2：`app.db.use()` 变为单参数

当前签名为 `use(dbName)`。不要把池名和库名作为两个参数传入；应显式组合 `app.db.pool("cn").use("billing")`。旧扩展代码迁移时，按实际使用的上游版本与返回类型核对。

## 下一步

- 阅读[配置](/zh/guide/configuration)，了解 base、环境 profile 和覆盖层。
- 查看[插件](/zh/guide/plugins)，了解 setup 顺序与资源管理。
- 阅读[测试](/zh/guide/testing)，区分 mock、HTTP 和数据库集成测试。
- 参照[数据访问规范](/zh/specification/data-access)，理解模型、分页与写入边界。
- 探索[app.fetch 内置 HTTP 客户端](/zh/guide/fetch)，处理服务间调用。
