# Drizzle ORM 集成

本示例展示如何将 [Drizzle ORM](https://orm.drizzle.team) 集成到 VextJS 项目中，通过编写一个数据库插件实现类型安全的数据库操作。

## 为什么选择 Drizzle ORM？

| 特性 | 说明 |
|------|------|
| **类型安全** | Schema 即类型，查询结果自动推断 TypeScript 类型 |
| **轻量** | 无运行时代码生成，零抽象开销 |
| **SQL-like** | API 贴近 SQL 语法，学习成本低 |
| **多数据库** | 支持 PostgreSQL、MySQL、SQLite |
| **迁移工具** | 内置 `drizzle-kit` 进行 schema 迁移 |
| **性能** | 无额外查询层，直接编译为 SQL |

## 项目结构

```
drizzle-orm/
  ├── src/
  │   ├── config/
  │   │   ├── default.ts
  │   │   └── production.ts
  │   ├── db/
  │   │   ├── schema.ts              ← Drizzle schema 定义
  │   │   ├── index.ts               ← 数据库连接工厂
  │   │   └── migrate.ts             ← 迁移脚本
  │   ├── plugins/
  │   │   └── database.ts            ← 数据库插件
  │   ├── routes/
  │   │   ├── index.ts
  │   │   └── users.ts
  │   ├── services/
  │   │   └── user.ts
  │   └── index.ts
  ├── drizzle/                        ← 迁移文件（drizzle-kit 生成）
  ├── drizzle.config.ts               ← drizzle-kit 配置
  ├── package.json
  └── tsconfig.json
```

## 1. 安装依赖

本示例使用 SQLite（通过 `better-sqlite3`）作为演示数据库。生产环境中可替换为 PostgreSQL 或 MySQL。

```bash
npx vextjs create drizzle-orm-demo
cd drizzle-orm-demo

# Drizzle ORM + SQLite 驱动
pnpm add drizzle-orm better-sqlite3

# 开发依赖
pnpm add -D drizzle-kit @types/better-sqlite3
```

:::tip
**其他数据库驱动**：
- PostgreSQL：`pnpm add drizzle-orm postgres` 或 `pnpm add drizzle-orm @neondatabase/serverless`
- MySQL：`pnpm add drizzle-orm mysql2`

更换驱动后只需修改 `src/db/index.ts` 中的连接逻辑和 `src/db/schema.ts` 中的表定义导入路径，业务代码几乎无需改动。
:::

## 2. 数据库 Schema

使用 Drizzle 的 TypeScript-first schema 定义表结构。Schema 既是数据库表定义，也是 TypeScript 类型的来源。

```typescript
// src/db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ── 用户表 ──────────────────────────────────────────────────

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  age: integer('age'),
  role: text('role', { enum: ['admin', 'user', 'editor'] })
    .notNull()
    .default('user'),
  bio: text('bio'),
  avatarUrl: text('avatar_url'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ── 文章表（演示关联查询）──────────────────────────────────

export const posts = sqliteTable('posts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  content: text('content').notNull(),
  authorId: integer('author_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  published: integer('published', { mode: 'boolean' })
    .notNull()
    .default(false),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ── 导出推断类型 ────────────────────────────────────────────

/** 用户完整类型（查询结果） */
export type User = typeof users.$inferSelect;

/** 用户插入类型（创建时使用） */
export type NewUser = typeof users.$inferInsert;

/** 文章完整类型 */
export type Post = typeof posts.$inferSelect;

/** 文章插入类型 */
export type NewPost = typeof posts.$inferInsert;
```

:::tip
Drizzle 的 `$inferSelect` 和 `$inferInsert` 类型工具非常强大：
- `$inferSelect` — 从表定义推断查询结果类型（包含所有字段，`id`、`createdAt` 等为必填）
- `$inferInsert` — 从表定义推断插入类型（有默认值的字段变为可选，如 `role`、`createdAt`）

这些类型可以直接用于服务层的参数和返回值声明，无需手动维护接口定义。
:::

## 3. 数据库连接工厂

```typescript
// src/db/index.ts
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema.js';

export interface DatabaseConfig {
  /** SQLite 数据库文件路径 */
  url: string;
  /** 是否开启 WAL 模式（Write-Ahead Logging，提升并发性能） */
  wal?: boolean;
  /** 是否在连接时自动创建表（开发环境用） */
  autoCreate?: boolean;
}

/**
 * 创建 Drizzle ORM 数据库实例
 *
 * @param config 数据库配置
 * @returns { db, client }
 *   - db: Drizzle ORM 实例（用于查询）
 *   - client: better-sqlite3 原始客户端（用于关闭连接）
 */
export function createDatabase(config: DatabaseConfig) {
  const client = new Database(config.url);

  // WAL 模式：提升并发读写性能
  if (config.wal !== false) {
    client.pragma('journal_mode = WAL');
  }

  // 启用外键约束
  client.pragma('foreign_keys = ON');

  const db = drizzle(client, { schema });

  // 开发环境自动创建表
  if (config.autoCreate) {
    client.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        age INTEGER,
        role TEXT NOT NULL DEFAULT 'user',
        bio TEXT,
        avatar_url TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        published INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  return { db, client };
}

/** Drizzle DB 实例类型 */
export type DrizzleDB = ReturnType<typeof createDatabase>['db'];
```

:::warning
生产环境中不要使用 `autoCreate: true`。应该使用 `drizzle-kit` 迁移工具管理数据库结构变更。`autoCreate` 仅用于快速开发和演示。
:::

## 4. 数据库迁移配置

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? './data/app.db',
  },
});
```

迁移命令：

```bash
# 生成迁移文件
pnpm drizzle-kit generate

# 执行迁移
pnpm drizzle-kit migrate

# 打开 Drizzle Studio（可视化数据库管理）
pnpm drizzle-kit studio
```

## 5. 数据库插件

```typescript
// src/plugins/database.ts
import { definePlugin } from 'vextjs';
import { createDatabase } from '../db/index.js';
import type { DrizzleDB } from '../db/index.js';
import { users, posts } from '../db/schema.js';

export default definePlugin({
  name: 'database',
  async setup(app) {
    const dbConfig = (app.config as any).database ?? {
      url: './data/app.db',
      wal: true,
      autoCreate: true,
    };

    app.logger.info({ url: dbConfig.url }, '正在连接数据库...');

    const { db, client } = createDatabase(dbConfig);

    // 挂载到 app
    app.extend('db', db);

    // 就绪钩子：验证连接 + 填充种子数据
    app.onReady(async () => {
      try {
        // 验证连接
        client.pragma('quick_check');
        app.logger.info('数据库连接验证成功');

        // 检查是否需要种子数据
        const userCount = db.select().from(users).all();
        if (userCount.length === 0) {
          app.logger.info('数据库为空，正在填充种子数据...');
          await seedDatabase(db);
          app.logger.info('种子数据填充完成');
        }
      } catch (err) {
        app.logger.error({ error: err }, '数据库初始化失败');
        throw err;
      }
    });

    // 关闭钩子：断开连接
    app.onClose(() => {
      client.close();
      app.logger.info('数据库连接已关闭');
    });
  },
});

/**
 * 填充种子数据（仅在数据库为空时执行）
 */
async function seedDatabase(db: DrizzleDB): Promise<void> {
  // 插入用户
  const insertedUsers = db
    .insert(users)
    .values([
      {
        name: 'Alice',
        email: 'alice@example.com',
        age: 28,
        role: 'admin',
        bio: '全栈开发者，热爱开源',
      },
      {
        name: 'Bob',
        email: 'bob@example.com',
        age: 32,
        role: 'user',
        bio: '前端工程师',
      },
      {
        name: 'Charlie',
        email: 'charlie@example.com',
        age: 25,
        role: 'editor',
        bio: '技术博客作者',
      },
    ])
    .returning()
    .all();

  // 插入文章
  db.insert(posts)
    .values([
      {
        title: 'VextJS 入门指南',
        content: '本文介绍如何使用 VextJS 构建高性能 RESTful API...',
        authorId: insertedUsers[0].id,
        published: true,
      },
      {
        title: 'Drizzle ORM 最佳实践',
        content: '探索 Drizzle ORM 的高级查询技巧...',
        authorId: insertedUsers[0].id,
        published: true,
      },
      {
        title: 'TypeScript 类型体操',
        content: '深入理解 TypeScript 的高级类型系统...',
        authorId: insertedUsers[2].id,
        published: false,
      },
    ])
    .run();
}
```

为 `app.db` 添加类型声明：

```typescript
// types/vext.d.ts
import type { DrizzleDB } from '../src/db/index.js';

declare module 'vextjs' {
  interface VextApp {
    db: DrizzleDB;
  }

  interface VextConfig {
    database?: {
      url: string;
      wal?: boolean;
      autoCreate?: boolean;
    };
  }

  interface VextRequest {
    user?: {
      id: string;
      role: string;
    };
  }
}
```

## 6. 配置

```typescript
// src/config/default.ts
export default {
  port: 3000,
  adapter: 'native',
  logger: {
    level: 'debug',
    pretty: true,
  },
  cors: {
    enabled: true,
    origins: ['*'],
  },
  response: {
    wrap: true,
    hideInternalErrors: false,
  },
  openapi: {
    enabled: true,
    title: 'Drizzle ORM 示例',
    version: '1.0.0',
    description: '使用 Drizzle ORM 集成的 VextJS RESTful API',
    tags: [
      { name: '基础', description: '基础接口' },
      { name: '用户', description: '用户管理接口' },
      { name: '文章', description: '文章管理接口' },
    ],
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    guardSecurityMap: {
      auth: 'bearerAuth',
    },
  },
  middlewares: [
    { name: 'auth' },
  ],
  // 数据库配置
  database: {
    url: './data/app.db',
    wal: true,
    autoCreate: true,
  },
};
```

```typescript
// src/config/production.ts
export default {
  logger: {
    level: 'info',
    pretty: false,
  },
  response: {
    hideInternalErrors: true,
  },
  openapi: {
    enabled: false,
  },
  database: {
    url: process.env.DATABASE_URL ?? './data/production.db',
    autoCreate: false, // 生产环境使用迁移
  },
};
```

## 7. 服务层

```typescript
// src/services/user.ts
import type { VextApp, VextLogger } from 'vextjs';
import { users, posts } from '../db/schema.js';
import type { User, NewUser } from '../db/schema.js';
import { eq, like, or, sql, desc, asc, count } from 'drizzle-orm';

export default class UserService {
  private logger: VextLogger;

  constructor(private app: VextApp) {
    this.logger = app.logger.child({ service: 'UserService' });
  }

  /**
   * 分页查询用户列表
   *
   * 支持关键词搜索（按 name 或 email 模糊匹配）和排序。
   */
  async findAll(options: {
    page: number;
    limit: number;
    keyword?: string;
    sortBy?: 'name' | 'createdAt';
    sortOrder?: 'asc' | 'desc';
  }): Promise<{
    items: User[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    this.logger.debug(options, '查询用户列表');

    const db = this.app.db;
    const offset = (options.page - 1) * options.limit;

    // 构建 WHERE 条件
    const whereCondition = options.keyword
      ? or(
          like(users.name, `%${options.keyword}%`),
          like(users.email, `%${options.keyword}%`),
        )
      : undefined;

    // 构建排序
    const orderBy =
      options.sortBy === 'name'
        ? options.sortOrder === 'desc'
          ? desc(users.name)
          : asc(users.name)
        : options.sortOrder === 'asc'
          ? asc(users.createdAt)
          : desc(users.createdAt);

    // 查询数据
    const items = db
      .select()
      .from(users)
      .where(whereCondition)
      .orderBy(orderBy)
      .limit(options.limit)
      .offset(offset)
      .all();

    // 查询总数
    const [{ total }] = db
      .select({ total: count() })
      .from(users)
      .where(whereCondition)
      .all();

    return {
      items,
      total,
      page: options.page,
      limit: options.limit,
      totalPages: Math.ceil(total / options.limit),
    };
  }

  /**
   * 根据 ID 查询用户（含文章列表）
   */
  async findById(id: number): Promise<(User & { posts: any[] }) | null> {
    this.logger.debug({ userId: id }, '查询用户详情');

    const db = this.app.db;

    const user = db.select().from(users).where(eq(users.id, id)).get();

    if (!user) return null;

    // 查询该用户的文章
    const userPosts = db
      .select()
      .from(posts)
      .where(eq(posts.authorId, id))
      .orderBy(desc(posts.createdAt))
      .all();

    return {
      ...user,
      posts: userPosts,
    };
  }

  /**
   * 创建用户
   */
  async create(data: {
    name: string;
    email: string;
    age?: number;
    role?: 'admin' | 'user' | 'editor';
    bio?: string;
    avatarUrl?: string;
  }): Promise<User> {
    this.logger.info({ email: data.email }, '创建用户');

    const db = this.app.db;

    // 检查邮箱唯一性
    const existing = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, data.email))
      .get();

    if (existing) {
      this.app.throw(409, '邮箱已注册', 10001);
    }

    // 插入并返回完整记录
    const user = db
      .insert(users)
      .values({
        name: data.name,
        email: data.email,
        age: data.age,
        role: data.role ?? 'user',
        bio: data.bio,
        avatarUrl: data.avatarUrl,
      })
      .returning()
      .get();

    this.logger.info({ userId: user.id, email: user.email }, '用户创建成功');

    return user;
  }

  /**
   * 更新用户
   */
  async update(
    id: number,
    data: {
      name?: string;
      email?: string;
      age?: number;
      bio?: string;
      avatarUrl?: string;
    },
  ): Promise<User> {
    this.logger.info({ userId: id }, '更新用户');

    const db = this.app.db;

    // 检查用户是否存在
    const existing = db.select().from(users).where(eq(users.id, id)).get();
    if (!existing) {
      this.app.throw(404, '用户不存在');
    }

    // 如果更新邮箱，检查唯一性
    if (data.email && data.email !== existing.email) {
      const emailTaken = db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, data.email))
        .get();

      if (emailTaken) {
        this.app.throw(409, '邮箱已被其他用户使用', 10002);
      }
    }

    // 更新记录
    const updated = db
      .update(users)
      .set({
        ...data,
        updatedAt: sql`datetime('now')`,
      })
      .where(eq(users.id, id))
      .returning()
      .get();

    this.logger.info({ userId: id }, '用户更新成功');

    return updated;
  }

  /**
   * 删除用户
   *
   * 由于设置了 ON DELETE CASCADE，关联的文章会自动删除。
   */
  async delete(id: number): Promise<void> {
    this.logger.info({ userId: id }, '删除用户');

    const db = this.app.db;

    const existing = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, id))
      .get();

    if (!existing) {
      this.app.throw(404, '用户不存在');
    }

    db.delete(users).where(eq(users.id, id)).run();

    this.logger.info({ userId: id }, '用户删除成功');
  }

  /**
   * 统计用户数量
   */
  async count(): Promise<number> {
    const [{ total }] = this.app.db
      .select({ total: count() })
      .from(users)
      .all();

    return total;
  }
}
```

## 8. 路由

### 根路由

```typescript
// src/routes/index.ts
import { defineRoutes } from 'vextjs';

export default defineRoutes((app) => {
  app.get('/', {
    docs: {
      summary: '健康检查',
      tags: ['基础'],
    },
  }, async (_req, res) => {
    const userCount = await app.services.user.count();
    res.json({
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      database: 'connected',
      users: userCount,
      timestamp: new Date().toISOString(),
    });
  });
});
```

### 用户路由

```typescript
// src/routes/users.ts
import { defineRoutes } from 'vextjs';

export default defineRoutes((app) => {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // GET /users/list — 分页查询用户列表
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.get('/list', {
    validate: {
      query: {
        page: 'number:1-',
        limit: 'number:1-100',
        keyword: 'string?',
      },
    },
    docs: {
      summary: '用户列表',
      description: '分页查询用户列表。支持按姓名或邮箱关键词搜索。',
      tags: ['用户'],
      responses: {
        200: {
          description: '查询成功',
          example: {
            items: [
              {
                id: 1,
                name: 'Alice',
                email: 'alice@example.com',
                age: 28,
                role: 'admin',
                bio: '全栈开发者',
                createdAt: '2026-03-05 00:00:00',
              },
            ],
            total: 3,
            page: 1,
            limit: 10,
            totalPages: 1,
          },
        },
      },
    },
  }, async (req, res) => {
    const { page, limit, keyword } = req.valid('query');
    const result = await app.services.user.findAll({ page, limit, keyword });
    res.json(result);
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // GET /users/:id — 查询用户详情（含文章）
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.get('/:id', {
    validate: {
      param: { id: 'number:1-' },
    },
    docs: {
      summary: '获取用户详情',
      description: '查询用户详情，包含该用户发布的所有文章。',
      tags: ['用户'],
      responses: {
        200: { description: '查询成功' },
        404: { description: '用户不存在' },
      },
    },
  }, async (req, res) => {
    const { id } = req.valid('param');
    const user = await app.services.user.findById(id);

    if (!user) {
      app.throw(404, '用户不存在');
    }

    res.json(user);
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // POST /users — 创建用户（需认证）
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.post('/', {
    validate: {
      body: {
        name: 'string:1-50',
        email: 'email',
        age: 'number:0-200?',
        role: 'enum:admin,user,editor?',
      },
    },
    middlewares: ['auth'],
    docs: {
      summary: '创建用户',
      description: '创建新用户。需要 Bearer Token 认证。邮箱必须唯一。',
      tags: ['用户'],
      responses: {
        201: { description: '创建成功' },
        400: { description: '参数校验失败' },
        401: { description: '未认证' },
        409: { description: '邮箱已注册' },
      },
    },
  }, async (req, res) => {
    const body = req.valid('body');
    const user = await app.services.user.create(body);
    res.json(user, 201);
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PUT /users/:id — 更新用户（需认证）
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.put('/:id', {
    validate: {
      param: { id: 'number:1-' },
      body: {
        name: 'string:1-50?',
        email: 'email?',
        age: 'number:0-200?',
      },
    },
    middlewares: ['auth'],
    docs: {
      summary: '更新用户',
      description: '更新用户信息。只需传入需要更新的字段。',
      tags: ['用户'],
      responses: {
        200: { description: '更新成功' },
        400: { description: '参数校验失败' },
        401: { description: '未认证' },
        404: { description: '用户不存在' },
        409: { description: '邮箱已被占用' },
      },
    },
  }, async (req, res) => {
    const { id } = req.valid('param');
    const body = req.valid('body');
    const user = await app.services.user.update(id, body);
    res.json(user);
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DELETE /users/:id — 删除用户（需认证）
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.delete('/:id', {
    validate: {
      param: { id: 'number:1-' },
    },
    middlewares: ['auth'],
    docs: {
      summary: '删除用户',
      description: '删除用户及其所有文章（CASCADE）。不可逆操作。',
      tags: ['用户'],
      responses: {
        204: { description: '删除成功' },
        401: { description: '未认证' },
        404: { description: '用户不存在' },
      },
    },
  }, async (req, res) => {
    const { id } = req.valid('param');
    await app.services.user.delete(id);
    res.status(204).json(null);
  });
});
```

## 9. 入口文件

```typescript
// src/index.ts
import { bootstrap } from 'vextjs';

bootstrap().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
```

## 10. 运行与验证

```bash
# 创建数据目录
mkdir -p data

# 启动开发服务器
pnpm dev
```

### 接口验证

```bash
# 健康检查
curl http://localhost:3000/
# → {"code":0,"data":{"status":"ok","database":"connected","users":3,...},"requestId":"..."}

# 查询用户列表
curl "http://localhost:3000/users/list?page=1&limit=10"
# → {"code":0,"data":{"items":[...],"total":3,"page":1,"limit":10,"totalPages":1},"requestId":"..."}

# 搜索用户
curl "http://localhost:3000/users/list?page=1&limit=10&keyword=alice"
# → 只返回匹配 "alice" 的用户

# 查询用户详情（含文章）
curl http://localhost:3000/users/1
# → {"code":0,"data":{"id":1,"name":"Alice",...,"posts":[...]},"requestId":"..."}

# 创建用户
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user-1-admin" \
  -d '{"name":"Diana","email":"diana@example.com","age":26}'
# → 201 {"code":0,"data":{"id":4,"name":"Diana","email":"diana@example.com",...},"requestId":"..."}

# 更新用户
curl -X PUT http://localhost:3000/users/4 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user-1-admin" \
  -d '{"name":"Diana Updated","age":27}'
# → {"code":0,"data":{"id":4,"name":"Diana Updated","age":27,...},"requestId":"..."}

# 删除用户
curl -X DELETE http://localhost:3000/users/4 \
  -H "Authorization: Bearer user-1-admin"
# → 204 No Content

# 邮箱唯一性校验
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user-1-admin" \
  -d '{"name":"Test","email":"alice@example.com"}'
# → 409 {"code":10001,"message":"邮箱已注册","requestId":"..."}
```

## 11. 测试

```typescript
// test/users.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestApp } from 'vextjs/testing';
import type { TestApp } from 'vextjs';

describe('用户 CRUD (Drizzle)', () => {
  let testApp: TestApp;
  const AUTH = 'Bearer user-1-admin';

  beforeEach(async () => {
    testApp = await createTestApp({
      plugins: true, // 加载数据库插件
      config: {
        database: {
          url: ':memory:', // 使用内存数据库，测试间隔离
          autoCreate: true,
        },
      },
    });
  });

  afterEach(async () => {
    await testApp?.close();
  });

  it('GET /users/list 应返回种子数据', async () => {
    const res = await testApp.request
      .get('/users/list')
      .query({ page: 1, limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(3); // 种子数据 3 个用户
    expect(res.body.data.items[0]).toHaveProperty('id');
    expect(res.body.data.items[0]).toHaveProperty('name');
    expect(res.body.data.items[0]).toHaveProperty('email');
  });

  it('GET /users/:id 应包含关联文章', async () => {
    const res = await testApp.request.get('/users/1');

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Alice');
    expect(Array.isArray(res.body.data.posts)).toBe(true);
    expect(res.body.data.posts.length).toBeGreaterThan(0);
  });

  it('POST /users 应创建用户并返回自增 ID', async () => {
    const res = await testApp.request
      .post('/users')
      .set('Authorization', AUTH)
      .send({
        name: 'Diana',
        email: 'diana@example.com',
        age: 26,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(4); // 种子数据占了 1-3
    expect(res.body.data.role).toBe('user'); // 默认值
    expect(res.body.data.createdAt).toBeDefined();
  });

  it('DELETE /users/:id 应级联删除文章', async () => {
    // Alice (id=1) 有 2 篇文章
    const deleteRes = await testApp.request
      .delete('/users/1')
      .set('Authorization', AUTH);

    expect(deleteRes.status).toBe(204);

    // 确认用户和文章都已删除
    const getRes = await testApp.request.get('/users/1');
    expect(getRes.status).toBe(404);
  });
});
```

## Drizzle 高级用法

### 关联查询（Relations API）

Drizzle 支持声明式的关联查询，避免手动 JOIN：

```typescript
import { relations } from 'drizzle-orm';
import { users, posts } from './schema.js';

// 声明关联关系
export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
}));

export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, {
    fields: [posts.authorId],
    references: [users.id],
  }),
}));

// 使用关联查询
const usersWithPosts = await db.query.users.findMany({
  with: {
    posts: {
      where: eq(posts.published, true),
      orderBy: desc(posts.createdAt),
      limit: 5,
    },
  },
});
```

### 事务

```typescript
import { eq, sql } from 'drizzle-orm';

// 事务：转账操作
async function transfer(fromId: number, toId: number, amount: number) {
  await db.transaction(async (tx) => {
    // 扣减
    tx.update(accounts)
      .set({ balance: sql`balance - ${amount}` })
      .where(eq(accounts.id, fromId))
      .run();

    // 增加
    tx.update(accounts)
      .set({ balance: sql`balance + ${amount}` })
      .where(eq(accounts.id, toId))
      .run();

    // 记录交易
    tx.insert(transactions)
      .values({ fromId, toId, amount, type: 'transfer' })
      .run();
  });
}
```

### 子查询与聚合

```typescript
import { eq, count, avg, gt, sql } from 'drizzle-orm';

// 统计每个用户的文章数
const userPostCounts = db
  .select({
    userId: users.id,
    name: users.name,
    postCount: count(posts.id),
  })
  .from(users)
  .leftJoin(posts, eq(users.id, posts.authorId))
  .groupBy(users.id)
  .having(gt(count(posts.id), 0))
  .all();

// 子查询：查询文章数大于平均值的用户
const avgPostCount = db
  .select({ avg: avg(count(posts.id)) })
  .from(posts)
  .groupBy(posts.authorId);

const activeAuthors = db
  .select()
  .from(users)
  .where(
    gt(
      db
        .select({ count: count() })
        .from(posts)
        .where(eq(posts.authorId, users.id)),
      sql`(SELECT AVG(cnt) FROM (SELECT COUNT(*) as cnt FROM posts GROUP BY author_id))`,
    ),
  )
  .all();
```

### 动态条件构建

```typescript
import { and, or, eq, like, gte, lte, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

interface UserFilter {
  keyword?: string;
  role?: string;
  minAge?: number;
  maxAge?: number;
}

function buildUserFilter(filter: UserFilter): SQL | undefined {
  const conditions: SQL[] = [];

  if (filter.keyword) {
    conditions.push(
      or(
        like(users.name, `%${filter.keyword}%`),
        like(users.email, `%${filter.keyword}%`),
      )!,
    );
  }

  if (filter.role) {
    conditions.push(eq(users.role, filter.role));
  }

  if (filter.minAge !== undefined) {
    conditions.push(gte(users.age, filter.minAge));
  }

  if (filter.maxAge !== undefined) {
    conditions.push(lte(users.age, filter.maxAge));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

// 使用
const items = db
  .select()
  .from(users)
  .where(buildUserFilter({ keyword: 'alice', role: 'admin', minAge: 20 }))
  .all();
```

### 使用 PostgreSQL

切换到 PostgreSQL 只需修改两个文件：

```typescript
// src/db/schema.ts — 改用 pg 导入
import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  boolean,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  age: integer('age'),
  role: text('role').notNull().default('user'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```

```typescript
// src/db/index.ts — 改用 pg 驱动
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export function createDatabase(config: { url: string }) {
  const client = postgres(config.url);
  const db = drizzle(client, { schema });
  return { db, client };
}
```

业务代码（服务层、路由层）**完全无需修改**。

## 项目模式总结

| 层级 | 职责 | 文件 |
|------|------|------|
| **Schema** | 表定义 + 类型推断 | `src/db/schema.ts` |
| **连接工厂** | 创建数据库实例 | `src/db/index.ts` |
| **插件** | 初始化连接、挂载 `app.db`、清理 | `src/plugins/database.ts` |
| **服务层** | 业务逻辑 + Drizzle 查询 | `src/services/user.ts` |
| **路由层** | 请求校验 + 调用服务 + 响应 | `src/routes/users.ts` |
| **类型声明** | `app.db` 类型扩展 | `types/vext.d.ts` |

### 核心原则

1. **Schema 即类型**：使用 `$inferSelect` / `$inferInsert` 从 Drizzle schema 推断类型，不手动维护接口
2. **插件管理生命周期**：数据库连接的创建和销毁由插件负责，通过 `app.extend()` 和 `app.onClose()` 管理
3. **服务层封装查询**：所有 Drizzle 查询封装在服务层，路由层只做编排
4. **路由层声明式**：路由专注于校验规则、文档配置和服务调用

## 下一步

- 📖 [Prisma ORM 集成](/guide/examples/prisma-orm) — 另一种流行的 ORM 集成方案
- 📖 [Zod 校验集成](/guide/examples/zod-validation) — 更强大的参数校验
- 📖 [插件](/guide/plugins) — 深入了解 VextJS 插件系统
- 📖 [服务层](/guide/services) — 深入了解服务层设计模式
- 📖 [测试](/guide/testing) — 测试数据库相关的业务逻辑