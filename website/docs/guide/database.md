# 数据库 (MonSQLize)

VextJS 内置了 [MonSQLize](https://github.com/vextjs/monSQLize) 数据库插件，提供开箱即用的 MongoDB 数据库支持。只需在配置文件中添加 `database` 字段，框架会自动完成连接管理、Model 加载和资源清理。

## 快速开始

### 1. 安装 MonSQLize

```bash
npm install monsqlize
```

### 2. 添加数据库配置

```typescript
// src/config/default.ts
export default {
  port: 3000,

  database: {
    config: {
      url: 'mongodb://localhost:27017/myapp',
    },
  },
};
```

### 3. 在服务中使用

```typescript
// src/services/user.ts
export class UserService {
  constructor(private app: any) {}

  async findById(userId: string) {
    return this.app.db.collection('users').findOne({ _id: userId });
  }

  async create(data: { name: string; email: string }) {
    return this.app.db.collection('users').insertOne(data);
  }
}
```

就这么简单！框架会在启动时自动连接数据库，在关闭时自动断开连接。

## 工作原理

### 条件加载

MonSQLize 插件采用**条件加载**策略——仅当 `config.database` 存在时才会启用。没有数据库配置的项目完全不受影响，零开销。

```
bootstrap()
  → 检测 config.database 是否存在
  → 是 → 创建 MonSQLize 实例 → 连接 → 加载 Model → 挂载 app.db
  → 否 → 跳过（零开销）
```

### 加载时机

MonSQLize 在**用户插件之前**加载，确保用户插件的 `setup()` 中可以安全使用 `app.db` 和 `app.monsqlize`：

```
createApp(config)
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

```typescript
// src/config/default.ts
export default {
  database: {
    // 连接类型（默认 'url'）
    type: 'url',

    // 连接配置
    config: {
      url: 'mongodb://localhost:27017/myapp',
    },
  },
};
```

### 副本集连接

```typescript
export default {
  database: {
    type: 'replica',

    config: {
      hosts: ['mongo1:27017', 'mongo2:27017', 'mongo3:27017'],
      database: 'myapp',
      replicaSet: 'rs0',
      username: 'admin',
      password: 'secret',
      authSource: 'admin',
    },
  },
};
```

### SRV 连接（MongoDB Atlas）

```typescript
export default {
  database: {
    type: 'srv',

    config: {
      host: 'cluster0.abc123.mongodb.net',
      database: 'myapp',
      username: 'admin',
      password: 'secret',
    },
  },
};
```

### 完整配置项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `type` | `'url' \| 'replica' \| 'srv'` | `'url'` | 连接类型 |
| `config` | `object` | — | 连接参数（url / hosts / host 等） |
| `maxTimeMS` | `number` | `2000` | 全局查询超时（毫秒） |
| `findLimit` | `number` | `10` | `find` 默认返回条数 |
| `findPageMaxLimit` | `number` | `500` | 分页最大 limit |
| `slowQueryMs` | `number` | `500` | 慢查询阈值（毫秒） |
| `autoConvertObjectId` | `boolean \| object` | — | 自动 ObjectId 转换 |
| `namespace` | `{ scope: string }` | `{ scope: 'database' }` | 缓存命名空间 |
| `cursorSecret` | `string` | — | 深分页游标加密密钥 |
| `useMemoryServer` | `boolean` | `false` | 使用内存数据库（测试用） |
| `logger` | `'app' \| false` | `'app'` | 日志桥接（`'app'` 使用 app.logger） |
| `cache` | `object` | — | 缓存配置（见下方） |
| `models` | `object` | — | Model 加载配置（见下方） |
| `pools` | `array` | — | 多连接池配置 |
| `poolStrategy` | `string` | `'auto'` | 连接池选择策略 |
| `slowQueryLog` | `object` | — | 慢查询持久化配置 |

### 缓存配置

MonSQLize 支持两级缓存：L1 内存 LRU + L2 Redis（可选）。

```typescript
export default {
  database: {
    config: { url: 'mongodb://localhost:27017/myapp' },

    cache: {
      // L1 内存缓存（默认开启）
      memory: {
        enabled: true,
        maxSize: 1000,    // 最大缓存条数
        ttl: 300,         // 默认 TTL（秒）
      },

      // L2 Redis 缓存（可选）
      redis: {
        enabled: true,
        url: 'redis://localhost:6379',
        prefix: 'myapp:cache:',
        ttl: 600,
      },
    },
  },
};
```

### 多环境配置

利用 VextJS 的三层配置合并机制，为不同环境配置不同的数据库：

```typescript
// src/config/default.ts — 基础配置
export default {
  database: {
    config: { url: 'mongodb://localhost:27017/myapp' },
    findLimit: 10,
    slowQueryMs: 500,
  },
};
```

```typescript
// src/config/production.ts — 生产环境覆盖
export default {
  database: {
    type: 'srv',
    config: {
      host: process.env.MONGODB_HOST,
      database: process.env.MONGODB_DATABASE,
      username: process.env.MONGODB_USER,
      password: process.env.MONGODB_PASSWORD,
    },
    slowQueryMs: 200,     // 生产环境慢查询阈值更低
  },
};
```

```typescript
// src/config/test.ts — 测试环境使用内存数据库
export default {
  database: {
    useMemoryServer: true,  // 使用 mongodb-memory-server
  },
};
```

## app.db — 连接对象

插件初始化成功后，`app.db` 上挂载了以下方法：

### collection(name)

获取集合操作对象，这是最常用的 API：

```typescript
// 获取 users 集合
const usersCol = app.db.collection('users');

// 查询
const user = await usersCol.findOne({ email: 'test@example.com' });
const users = await usersCol.find({ role: 'admin' });

// 插入
const result = await usersCol.insertOne({ name: '张三', email: 'zhangsan@example.com' });

// 更新
await usersCol.updateOne({ _id: userId }, { $set: { name: '李四' } });

// 删除
await usersCol.deleteOne({ _id: userId });

// 聚合
const stats = await usersCol.aggregate([
  { $group: { _id: '$role', count: { $sum: 1 } } },
]);

// 计数
const total = await usersCol.countDocuments({ role: 'admin' });
```

### model(name)

获取已注册的 Model 操作对象（需先定义 Model，见下方 Model 章节）：

```typescript
const User = app.db.model('User');

// Model 提供更高级的 API（分页、缓存、校验等）
const result = await User.findPage({ role: 'admin' }, { page: 1, limit: 20 });
```

### use(name)

获取其他数据库实例（跨库查询），类似 MongoDB shell 的 `use <db>` 命令：

```typescript
const logsDb = app.db.use('logs');
const errorLogs = logsDb.collection('errors');
const recent = await errorLogs.find({ level: 'error' });
```

> `app.db.db(name)` 仍可使用（向后兼容），但推荐使用语义更清晰的 `app.db.use(name)`。

### client

获取原始 MongoDB Client 实例（用于事务等高级场景）：

```typescript
const session = app.db.client.startSession();

try {
  await session.withTransaction(async () => {
    await app.db.collection('accounts').updateOne(
      { _id: fromId },
      { $inc: { balance: -amount } },
      { session },
    );
    await app.db.collection('accounts').updateOne(
      { _id: toId },
      { $inc: { balance: amount } },
      { session },
    );
  });
} finally {
  await session.endSession();
}
```

## app.monsqlize — 原始实例

`app.monsqlize` 暴露原始 MonSQLize 实例，用于高级场景：

```typescript
// 直接使用 MonSQLize API
const monsqlize = app.monsqlize;

// 事件监听
monsqlize.on('slow-query', (info) => {
  app.logger.warn({ ...info }, 'Slow query detected');
});
```

:::tip
大多数场景下使用 `app.db` 即可。只有在需要 MonSQLize 底层 API 时才使用 `app.monsqlize`。
:::

## Model 定义

Model 是对集合操作的封装，提供字段校验、钩子、虚拟字段等高级能力。

### 创建 Model 文件

> MonSQLize Model 层集成了 **schema-dsl**，schema 字段支持 DSL 简洁语法。

#### 推荐写法：schema-dsl 简洁语法 + options.timestamps

```typescript
// src/models/user.ts
export default {
  collection: 'users',

  // schema-dsl 简洁语法
  schema: {
    name:   'string:1-50!',          // 必填字符串，1~50 字符
    email:  'email!',                // 必填，邮箱格式
    role:   'admin|editor|viewer',   // 枚举值
    avatar: 'string',                // 可选字符串
  },

  // 索引
  indexes: [
    { fields: { email: 1 }, options: { unique: true } },
    { fields: { role: 1, createdAt: -1 } },
  ],

  // 使用 options.timestamps 自动管理 createdAt/updatedAt
  options: {
    timestamps: true,
  },
}
```

#### 对象格式（复杂场景）

当字段需要 `default` 函数、嵌套 schema 等高级能力时，可使用对象格式：

```typescript
// src/models/user.ts
export default {
  collection: 'users',

  // 字段定义（对象格式）
  schema: {
    name: { type: 'string', required: true },
    email: { type: 'string', required: true, unique: true },
    role: { type: 'string', enum: ['admin', 'editor', 'viewer'], default: 'viewer' },
    avatar: { type: 'string' },
  },

  // 索引
  indexes: [
    { fields: { email: 1 }, options: { unique: true } },
    { fields: { role: 1, createdAt: -1 } },
  ],

  // 钩子（仅用于非 timestamps 的自定义逻辑）
  hooks: {
    beforeInsert(doc: any) {
      // 自定义逻辑示例
      doc.slug = doc.name.toLowerCase().replace(/\s+/g, '-');
    },
  },

  options: {
    timestamps: true,
  },
}
```

### Model options（模型选项）

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `timestamps` | `boolean \| object` | `undefined` | 自动管理 createdAt/updatedAt |
| `softDelete` | `boolean \| object` | `undefined` | 软删除支持 |
| `version` | `boolean \| object` | `undefined` | 乐观锁版本号 |
| `validate` | `boolean` | `true` | 插入/更新时的 schema 校验开关 |

#### timestamps 配置

```typescript
// 简单模式：自动添加 createdAt + updatedAt
options: { timestamps: true }

// 自定义字段名
options: { timestamps: { createdAt: 'created_time', updatedAt: 'updated_time' } }

// 只启用 createdAt（日志类集合）
options: { timestamps: { createdAt: true, updatedAt: false } }
```

### 目录结构

Model 文件放在 `src/models/` 目录下，插件会自动扫描并注册：

```
src/
├── models/
│   ├── user.ts         → Model 名称: 'User'
│   ├── order.ts        → Model 名称: 'Order'
│   ├── product-item.ts → Model 名称: 'ProductItem'
│   └── index.ts        → ⚠️ 跳过（不作为 Model）
```

文件名推断 Model 名称的规则：
- `user.ts` → `'User'`（首字母大写）
- `order-item.ts` → `'OrderItem'`（kebab-case → PascalCase）
- `user_role.ts` → `'UserRole'`（snake_case → PascalCase）
- `.test.ts` / `.spec.ts` → 跳过（测试文件）
- `index.ts` → 跳过

### Model 加载配置

```typescript
export default {
  database: {
    config: { url: 'mongodb://localhost:27017/myapp' },

    models: {
      // Model 定义文件目录（相对于 src/，默认 'models'）
      dir: 'models',

      // 是否自动注册（默认 true）
      autoRegister: true,

      // 外部共享 Model 包（微服务场景）
      sharedPackage: '@myproject/shared-models',
    },
  },
};
```

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

## 在服务中使用

### 基础 CRUD 服务

```typescript
// src/services/user.ts
export class UserService {
  private logger;

  constructor(private app: any) {
    this.logger = app.logger.child({ service: 'UserService' });
  }

  async findById(id: string) {
    this.logger.debug({ id }, 'Finding user by ID');
    const user = await this.app.db.collection('users').findOne({ _id: id });

    if (!user) {
      this.app.throw(404, '用户不存在');
    }

    return user;
  }

  async findAll(options: { page?: number; limit?: number; role?: string } = {}) {
    const { page = 1, limit = 20, role } = options;
    const filter: Record<string, unknown> = {};
    if (role) filter.role = role;

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.app.db.collection('users').find(filter, { skip, limit }),
      this.app.db.collection('users').countDocuments(filter),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async create(data: { name: string; email: string; role?: string }) {
    // 检查邮箱唯一性
    const existing = await this.app.db.collection('users').findOne({
      email: data.email,
    });
    if (existing) {
      this.app.throw(409, '邮箱已注册', 'EMAIL_EXISTS');
    }

    const doc = {
      ...data,
      role: data.role ?? 'viewer',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await this.app.db.collection('users').insertOne(doc);
    this.logger.info({ id: result.insertedId, email: data.email }, 'User created');

    return { id: result.insertedId, ...doc };
  }

  async update(id: string, data: Partial<{ name: string; email: string; role: string }>) {
    const result = await this.app.db.collection('users').updateOne(
      { _id: id },
      { $set: { ...data, updatedAt: new Date() } },
    );

    if (result.matchedCount === 0) {
      this.app.throw(404, '用户不存在');
    }

    return this.findById(id);
  }

  async delete(id: string) {
    const result = await this.app.db.collection('users').deleteOne({ _id: id });

    if (result.deletedCount === 0) {
      this.app.throw(404, '用户不存在');
    }

    this.logger.info({ id }, 'User deleted');
  }
}
```

### 在路由中配合使用

```typescript
// src/routes/users.ts
import { defineRoutes } from 'vextjs';

export default defineRoutes((app) => {
  app.get('/users', {
    validate: {
      query: {
        page: 'number:1-',
        limit: 'number:1-100',
        role: 'admin|editor|viewer',
      },
    },
    docs: { summary: '获取用户列表', tags: ['Users'] },
  }, async (req, res) => {
    const { page, limit, role } = req.valid('query');
    const result = await app.services.user.findAll({ page, limit, role });
    res.json(result);
  });

  app.get('/users/:id', {
    validate: { param: { id: 'string!' } },
    docs: { summary: '获取用户详情', tags: ['Users'] },
  }, async (req, res) => {
    const { id } = req.valid('param');
    const user = await app.services.user.findById(id);
    res.json(user);
  });

  app.post('/users', {
    validate: {
      body: {
        name: 'string:1-50!',
        email: 'email!',
        role: 'admin|editor|viewer',
      },
    },
    docs: { summary: '创建用户', tags: ['Users'] },
  }, async (req, res) => {
    const data = req.valid('body');
    const user = await app.services.user.create(data);
    res.json(user, 201);
  });

  app.put('/users/:id', {
    validate: {
      param: { id: 'string!' },
      body: {
        name: 'string:1-50?',
        email: 'email?',
        role: 'admin|editor|viewer',
      },
    },
    docs: { summary: '更新用户', tags: ['Users'] },
  }, async (req, res) => {
    const { id } = req.valid('param');
    const data = req.valid('body');
    const user = await app.services.user.update(id, data);
    res.json(user);
  });

  app.delete('/users/:id', {
    validate: { param: { id: 'string!' } },
    docs: { summary: '删除用户', tags: ['Users'] },
  }, async (req, res) => {
    const { id } = req.valid('param');
    await app.services.user.delete(id);
    res.json({ success: true });
  });
});
```

## 在插件中使用

自定义插件可以通过 `dependencies` 确保在 MonSQLize 初始化之后执行：

```typescript
// src/plugins/seed-data.ts
import { definePlugin } from 'vextjs';

export default definePlugin({
  name: 'seed-data',

  async setup(app) {
    // 插件加载时 MonSQLize 已初始化，app.db 可用
    if (!app.db) {
      app.logger.debug('[seed-data] No database configured, skipping');
      return;
    }

    const count = await app.db.collection('users').countDocuments({});
    if (count === 0) {
      app.logger.info('[seed-data] Seeding initial admin user...');
      await app.db.collection('users').insertOne({
        name: 'Admin',
        email: 'admin@example.com',
        role: 'admin',
        createdAt: new Date(),
      });
      app.logger.info('[seed-data] Admin user seeded');
    }
  },
});
```

## 测试中使用

### 使用内存数据库

在测试环境中使用 `mongodb-memory-server` 运行内存数据库，无需外部 MongoDB 实例：

```bash
npm install -D mongodb-memory-server
```

```typescript
// src/config/test.ts
export default {
  database: {
    useMemoryServer: true,
  },
};
```

### 测试示例

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp } from 'vextjs/testing';

describe('UserService', () => {
  let app;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should create a user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users',
      body: { name: '张三', email: 'zhangsan@test.com' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe('张三');
  });

  it('should reject duplicate email', async () => {
    await app.inject({
      method: 'POST',
      url: '/users',
      body: { name: '张三', email: 'dup@test.com' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/users',
      body: { name: '李四', email: 'dup@test.com' },
    });

    expect(res.statusCode).toBe(409);
  });
});
```

## 慢查询监控

MonSQLize 内置慢查询检测。查询耗时超过 `slowQueryMs` 阈值时自动打印警告日志：

```typescript
export default {
  database: {
    config: { url: 'mongodb://localhost:27017/myapp' },
    slowQueryMs: 200,  // 超过 200ms 的查询会产生警告

    // 可选：持久化慢查询记录到专用集合
    slowQueryLog: {
      enabled: true,
      collection: '_slow_queries',
    },
  },
};
```

日志输出示例：

```
[14:23:05.123] WARN [monsqlize] Slow query: users.find({role:"admin"}) 523ms
```

## Model 热重载（开发模式）

在 `vext dev` 开发模式下，修改 `src/models/` 目录下的 Model 定义文件会自动触发 **Tier 2 软重载**，框架将重新加载变更的 Model 定义，无需手动重启服务器。

### 工作原理

```
修改 src/models/item.ts
  ↓
esbuild 重新编译 → dist/models/item.js
  ↓
model-reloader 检测到 invalidated 文件
  ↓
保存旧定义（回滚备份）
  ↓
Model.redefine("items", newDefinition)
  ↓
新请求使用新 Model 定义
```

### 重载行为说明

| 场景 | 行为 |
|------|------|
| 修改 schema 字段类型 | 下次写入使用新 schema 校验规则 |
| 修改 hooks | 新的 hooks 立即对后续操作生效 |
| 修改 indexes | 索引变更需要冷重启才能同步到 MongoDB |
| 重载失败（如语法错误） | 自动回滚到旧定义，服务继续运行 |
| 并发请求 | 重载期间正在处理的请求使用旧定义完成，新请求使用新定义 |

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
若新 Model 定义存在问题（如 schema 定义抛出异常），框架会自动将旧定义重新注册，确保服务不中断。修复代码后保存，重载会再次触发。
:::

:::info 框架内部机制
`Model.redefine()` / `Model.undefine()` 是 monSQLize v1.1.8 提供的原生 API，由 vext 框架在热重载流程中自动调用，用户无需手动调用。
:::

## 优雅关闭

MonSQLize 插件在 `app.onClose()` 中注册了数据库连接关闭钩子。当应用收到 `SIGTERM` / `SIGINT` 信号时：

1. 停止接受新请求
2. 等待飞行中的请求完成
3. 执行 `onClose` 钩子（LIFO 顺序）
4. MonSQLize 关闭数据库连接
5. 进程退出

无需手动管理连接关闭。

## 下一步

- 了解 [配置](/guide/configuration) 中的三层合并机制和环境覆盖
- 查看 [插件](/guide/plugins) 如何通过 `definePlugin()` 扩展框架
- 学习 [测试](/guide/testing) 中如何使用 `createTestApp()` 进行集成测试
- 探索 [app.fetch 内置 HTTP 客户端](/guide/fetch) 在微服务中调用其他服务