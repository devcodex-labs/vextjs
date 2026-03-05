# Prisma ORM 集成

本示例展示如何将 [Prisma](https://www.prisma.io) 集成到 VextJS 项目中，通过编写一个数据库插件实现类型安全的数据库操作。

## 为什么选择 Prisma？

| 特性 | 说明 |
|------|------|
| **类型安全** | 代码生成的 Prisma Client，查询和结果自动类型推断 |
| **直观 API** | 高级查询 API，支持嵌套创建、关联查询、事务等 |
| **数据库迁移** | 内置 `prisma migrate` 进行声明式 schema 迁移 |
| **多数据库** | 支持 PostgreSQL、MySQL、SQLite、MongoDB、CockroachDB |
| **可视化工具** | Prisma Studio 提供数据库图形化管理界面 |
| **生态丰富** | 广泛的社区插件和第三方集成 |

:::tip
**Prisma vs Drizzle**：Prisma 提供更高层次的抽象和更丰富的查询 API（如 `include`、`select`、嵌套写入），适合需要快速开发和复杂关联操作的项目。Drizzle 更贴近 SQL 原生语义，适合对 SQL 控制力要求更高的场景。VextJS 两者都支持，选择取决于团队偏好。
:::

## 项目结构

```
prisma-orm/
  ├── prisma/
  │   ├── schema.prisma                ← Prisma schema 定义
  │   ├── seed.ts                      ← 种子数据脚本
  │   └── migrations/                  ← 迁移文件（prisma migrate 生成）
  ├── src/
  │   ├── config/
  │   │   ├── default.ts
  │   │   └── production.ts
  │   ├── plugins/
  │   │   └── database.ts              ← 数据库插件
  │   ├── routes/
  │   │   ├── index.ts
  │   │   ├── users.ts
  │   │   └── posts.ts
  │   ├── services/
  │   │   ├── user.ts
  │   │   └── post.ts
  │   └── index.ts
  ├── types/
  │   └── vext.d.ts                    ← 类型声明扩展
  ├── package.json
  └── tsconfig.json
```

## 1. 安装依赖

```bash
npx vextjs create prisma-orm-demo
cd prisma-orm-demo

# Prisma
pnpm add @prisma/client
pnpm add -D prisma
```

## 2. 初始化 Prisma

```bash
npx prisma init --datasource-provider sqlite
```

这会创建 `prisma/schema.prisma` 文件和 `.env` 文件。

## 3. 定义 Prisma Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

// ── 用户模型 ────────────────────────────────────────────────

model User {
  id        Int      @id @default(autoincrement())
  name      String
  email     String   @unique
  age       Int?
  role      String   @default("user")
  bio       String?
  avatarUrl String?  @map("avatar_url")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  // 关联
  posts    Post[]
  comments Comment[]

  @@map("users")
}

// ── 文章模型 ────────────────────────────────────────────────

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  content   String
  published Boolean  @default(false)
  viewCount Int      @default(0) @map("view_count")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  // 关联
  author   User      @relation(fields: [authorId], references: [id], onDelete: Cascade)
  authorId Int       @map("author_id")
  comments Comment[]
  tags     Tag[]

  @@map("posts")
}

// ── 评论模型 ────────────────────────────────────────────────

model Comment {
  id        Int      @id @default(autoincrement())
  content   String
  createdAt DateTime @default(now()) @map("created_at")

  author   User @relation(fields: [authorId], references: [id], onDelete: Cascade)
  authorId Int  @map("author_id")
  post     Post @relation(fields: [postId], references: [id], onDelete: Cascade)
  postId   Int  @map("post_id")

  @@map("comments")
}

// ── 标签模型（多对多）──────────────────────────────────────

model Tag {
  id    Int    @id @default(autoincrement())
  name  String @unique
  posts Post[]

  @@map("tags")
}
```

### 生成 Prisma Client

```bash
# 创建迁移并生成 Client
npx prisma migrate dev --name init

# 或仅生成 Client（不迁移）
npx prisma generate
```

### 环境变量

```bash
# .env
DATABASE_URL="file:./data/app.db"
```

## 4. 种子数据

```typescript
// prisma/seed.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('正在填充种子数据...');

  // 清空数据（按依赖顺序）
  await prisma.comment.deleteMany();
  await prisma.post.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.user.deleteMany();

  // 创建标签
  const tagBackend = await prisma.tag.create({ data: { name: '后端' } });
  const tagFrontend = await prisma.tag.create({ data: { name: '前端' } });
  const tagDevOps = await prisma.tag.create({ data: { name: 'DevOps' } });
  const tagTypeScript = await prisma.tag.create({ data: { name: 'TypeScript' } });

  // 创建用户 + 文章（嵌套创建）
  const alice = await prisma.user.create({
    data: {
      name: 'Alice',
      email: 'alice@example.com',
      age: 28,
      role: 'admin',
      bio: '全栈开发者，热爱开源',
      posts: {
        create: [
          {
            title: 'VextJS 入门指南',
            content: '本文介绍如何使用 VextJS 构建高性能 RESTful API。VextJS 提供 Adapter 架构、插件系统、约定式路由等企业级特性...',
            published: true,
            tags: { connect: [{ id: tagBackend.id }, { id: tagTypeScript.id }] },
          },
          {
            title: 'Prisma ORM 最佳实践',
            content: '深入探索 Prisma 的高级查询技巧，包括关联查询、事务、中间件等...',
            published: true,
            tags: { connect: [{ id: tagBackend.id }] },
          },
          {
            title: '未发布的草稿',
            content: '这是一篇还在编写中的文章...',
            published: false,
          },
        ],
      },
    },
  });

  const bob = await prisma.user.create({
    data: {
      name: 'Bob',
      email: 'bob@example.com',
      age: 32,
      role: 'user',
      bio: '前端工程师',
      posts: {
        create: [
          {
            title: 'React 18 新特性',
            content: '探索 React 18 中的并发特性、Suspense 改进和自动批量更新...',
            published: true,
            tags: { connect: [{ id: tagFrontend.id }, { id: tagTypeScript.id }] },
          },
        ],
      },
    },
  });

  const charlie = await prisma.user.create({
    data: {
      name: 'Charlie',
      email: 'charlie@example.com',
      age: 25,
      role: 'editor',
      bio: '技术博客作者',
    },
  });

  // 创建评论
  const alicePosts = await prisma.post.findMany({
    where: { authorId: alice.id, published: true },
  });

  if (alicePosts.length > 0) {
    await prisma.comment.createMany({
      data: [
        {
          content: '写得太好了！收藏了 👍',
          authorId: bob.id,
          postId: alicePosts[0].id,
        },
        {
          content: '请问有配套的视频教程吗？',
          authorId: charlie.id,
          postId: alicePosts[0].id,
        },
        {
          content: '非常实用的 Prisma 教程',
          authorId: charlie.id,
          postId: alicePosts[1].id,
        },
      ],
    });
  }

  console.log('种子数据填充完成 ✅');
  console.log(`  用户: ${await prisma.user.count()}`);
  console.log(`  文章: ${await prisma.post.count()}`);
  console.log(`  评论: ${await prisma.comment.count()}`);
  console.log(`  标签: ${await prisma.tag.count()}`);
}

main()
  .catch((e) => {
    console.error('种子数据填充失败:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

在 `package.json` 中配置种子命令：

```json
{
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  },
  "scripts": {
    "db:seed": "npx prisma db seed",
    "db:studio": "npx prisma studio",
    "db:migrate": "npx prisma migrate dev",
    "db:reset": "npx prisma migrate reset"
  }
}
```

运行种子：

```bash
pnpm db:seed
```

## 5. 数据库插件

```typescript
// src/plugins/database.ts
import { definePlugin } from 'vextjs';
import { PrismaClient } from '@prisma/client';

export default definePlugin({
  name: 'database',
  async setup(app) {
    app.logger.info('正在初始化 Prisma Client...');

    const prisma = new PrismaClient({
      log:
        app.config.logger.level === 'debug'
          ? [
              { emit: 'event', level: 'query' },
              { emit: 'stdout', level: 'info' },
              { emit: 'stdout', level: 'warn' },
              { emit: 'stdout', level: 'error' },
            ]
          : [
              { emit: 'stdout', level: 'warn' },
              { emit: 'stdout', level: 'error' },
            ],
    });

    // 开发环境打印 SQL 查询
    if (app.config.logger.level === 'debug') {
      prisma.$on('query' as any, (e: any) => {
        app.logger.debug(
          { query: e.query, params: e.params, duration: `${e.duration}ms` },
          'Prisma SQL',
        );
      });
    }

    // 连接数据库
    await prisma.$connect();
    app.logger.info('Prisma Client 连接成功');

    // 挂载到 app
    app.extend('prisma', prisma);

    // 就绪钩子：验证连接
    app.onReady(async () => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        const userCount = await prisma.user.count();
        app.logger.info({ userCount }, '数据库连接验证成功');
      } catch (err) {
        app.logger.error({ error: err }, '数据库连接验证失败');
        throw err;
      }
    });

    // 关闭钩子：断开连接
    app.onClose(async () => {
      await prisma.$disconnect();
      app.logger.info('Prisma Client 已断开连接');
    });
  },
});
```

### 类型声明扩展

```typescript
// types/vext.d.ts
import type { PrismaClient } from '@prisma/client';

declare module 'vextjs' {
  interface VextApp {
    prisma: PrismaClient;
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
    title: 'Prisma ORM 示例',
    version: '1.0.0',
    description: '使用 Prisma ORM 集成的 VextJS RESTful API',
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
};
```

## 7. 服务层

### 用户服务

```typescript
// src/services/user.ts
import type { VextApp, VextLogger } from 'vextjs';
import type { User, Prisma } from '@prisma/client';

export default class UserService {
  private logger: VextLogger;

  constructor(private app: VextApp) {
    this.logger = app.logger.child({ service: 'UserService' });
  }

  /**
   * 分页查询用户列表
   *
   * 支持关键词搜索、角色筛选和排序。
   */
  async findAll(options: {
    page: number;
    limit: number;
    keyword?: string;
    role?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    this.logger.debug(options, '查询用户列表');

    const prisma = this.app.prisma;

    // 构建 WHERE 条件
    const where: Prisma.UserWhereInput = {};

    if (options.keyword) {
      where.OR = [
        { name: { contains: options.keyword } },
        { email: { contains: options.keyword } },
        { bio: { contains: options.keyword } },
      ];
    }

    if (options.role) {
      where.role = options.role;
    }

    // 并行查询数据和总数
    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: (options.page - 1) * options.limit,
        take: options.limit,
        orderBy: {
          [options.sortBy ?? 'createdAt']: options.sortOrder ?? 'desc',
        },
        select: {
          id: true,
          name: true,
          email: true,
          age: true,
          role: true,
          bio: true,
          avatarUrl: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { posts: true, comments: true },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return {
      items,
      total,
      page: options.page,
      limit: options.limit,
      totalPages: Math.ceil(total / options.limit),
    };
  }

  /**
   * 根据 ID 查询用户详情
   *
   * 包含已发布的文章列表和统计信息。
   */
  async findById(id: number) {
    this.logger.debug({ userId: id }, '查询用户详情');

    const user = await this.app.prisma.user.findUnique({
      where: { id },
      include: {
        posts: {
          where: { published: true },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            title: true,
            published: true,
            viewCount: true,
            createdAt: true,
            tags: {
              select: { id: true, name: true },
            },
            _count: {
              select: { comments: true },
            },
          },
        },
        _count: {
          select: {
            posts: true,
            comments: true,
          },
        },
      },
    });

    return user;
  }

  /**
   * 创建用户
   */
  async create(data: {
    name: string;
    email: string;
    age?: number;
    role?: string;
    bio?: string;
  }): Promise<User> {
    this.logger.info({ email: data.email }, '创建用户');

    // Prisma 的 unique 约束会自动检测重复邮箱
    // 但我们提前检查以返回友好的业务错误码
    const existing = await this.app.prisma.user.findUnique({
      where: { email: data.email },
      select: { id: true },
    });

    if (existing) {
      this.app.throw(409, '邮箱已注册', 10001);
    }

    const user = await this.app.prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        age: data.age,
        role: data.role ?? 'user',
        bio: data.bio,
      },
    });

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

    // 检查用户是否存在
    const existing = await this.app.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true },
    });

    if (!existing) {
      this.app.throw(404, '用户不存在');
    }

    // 邮箱唯一性检查
    if (data.email && data.email !== existing.email) {
      const emailTaken = await this.app.prisma.user.findUnique({
        where: { email: data.email },
        select: { id: true },
      });

      if (emailTaken) {
        this.app.throw(409, '邮箱已被其他用户使用', 10002);
      }
    }

    const user = await this.app.prisma.user.update({
      where: { id },
      data,
    });

    this.logger.info({ userId: id }, '用户更新成功');
    return user;
  }

  /**
   * 删除用户
   *
   * 由于 schema 设置了 onDelete: Cascade，关联的文章和评论会自动删除。
   */
  async delete(id: number): Promise<void> {
    this.logger.info({ userId: id }, '删除用户');

    const existing = await this.app.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      this.app.throw(404, '用户不存在');
    }

    await this.app.prisma.user.delete({ where: { id } });

    this.logger.info({ userId: id }, '用户删除成功（关联数据已级联删除）');
  }

  /**
   * 统计用户数量
   */
  async count(): Promise<number> {
    return this.app.prisma.user.count();
  }
}
```

### 文章服务

```typescript
// src/services/post.ts
import type { VextApp, VextLogger } from 'vextjs';
import type { Post, Prisma } from '@prisma/client';

export default class PostService {
  private logger: VextLogger;

  constructor(private app: VextApp) {
    this.logger = app.logger.child({ service: 'PostService' });
  }

  /**
   * 查询已发布的文章列表
   */
  async findPublished(options: {
    page: number;
    limit: number;
    keyword?: string;
    tag?: string;
  }) {
    this.logger.debug(options, '查询文章列表');

    const prisma = this.app.prisma;

    const where: Prisma.PostWhereInput = {
      published: true,
    };

    if (options.keyword) {
      where.OR = [
        { title: { contains: options.keyword } },
        { content: { contains: options.keyword } },
      ];
    }

    if (options.tag) {
      where.tags = {
        some: { name: options.tag },
      };
    }

    const [items, total] = await Promise.all([
      prisma.post.findMany({
        where,
        skip: (options.page - 1) * options.limit,
        take: options.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          author: {
            select: { id: true, name: true, avatarUrl: true },
          },
          tags: {
            select: { id: true, name: true },
          },
          _count: {
            select: { comments: true },
          },
        },
      }),
      prisma.post.count({ where }),
    ]);

    return {
      items,
      total,
      page: options.page,
      limit: options.limit,
      totalPages: Math.ceil(total / options.limit),
    };
  }

  /**
   * 查询文章详情（含评论）
   */
  async findById(id: number) {
    this.logger.debug({ postId: id }, '查询文章详情');

    const prisma = this.app.prisma;

    const post = await prisma.post.findUnique({
      where: { id },
      include: {
        author: {
          select: { id: true, name: true, avatarUrl: true, bio: true },
        },
        tags: {
          select: { id: true, name: true },
        },
        comments: {
          orderBy: { createdAt: 'desc' },
          include: {
            author: {
              select: { id: true, name: true, avatarUrl: true },
            },
          },
        },
        _count: {
          select: { comments: true },
        },
      },
    });

    if (!post) return null;

    // 增加浏览计数
    await prisma.post.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
    });

    return post;
  }

  /**
   * 创建文章
   */
  async create(data: {
    title: string;
    content: string;
    authorId: number;
    published?: boolean;
    tags?: string[];
  }): Promise<Post> {
    this.logger.info({ authorId: data.authorId, title: data.title }, '创建文章');

    const prisma = this.app.prisma;

    // 验证作者是否存在
    const author = await prisma.user.findUnique({
      where: { id: data.authorId },
      select: { id: true },
    });

    if (!author) {
      this.app.throw(404, '作者不存在');
    }

    // 处理标签：connectOrCreate（已有则关联，没有则创建）
    const tagConnections = data.tags?.map((tagName) => ({
      where: { name: tagName },
      create: { name: tagName },
    }));

    const post = await prisma.post.create({
      data: {
        title: data.title,
        content: data.content,
        authorId: data.authorId,
        published: data.published ?? false,
        tags: tagConnections
          ? { connectOrCreate: tagConnections }
          : undefined,
      },
      include: {
        author: { select: { id: true, name: true } },
        tags: { select: { id: true, name: true } },
      },
    });

    this.logger.info({ postId: post.id }, '文章创建成功');
    return post;
  }

  /**
   * 更新文章
   */
  async update(
    id: number,
    data: {
      title?: string;
      content?: string;
      published?: boolean;
      tags?: string[];
    },
  ) {
    this.logger.info({ postId: id }, '更新文章');

    const prisma = this.app.prisma;

    const existing = await prisma.post.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      this.app.throw(404, '文章不存在');
    }

    // 如果提供了 tags，先断开所有现有标签，再关联新标签
    const updateData: Prisma.PostUpdateInput = {};

    if (data.title !== undefined) updateData.title = data.title;
    if (data.content !== undefined) updateData.content = data.content;
    if (data.published !== undefined) updateData.published = data.published;

    if (data.tags !== undefined) {
      updateData.tags = {
        set: [], // 清空现有标签
        connectOrCreate: data.tags.map((name) => ({
          where: { name },
          create: { name },
        })),
      };
    }

    const post = await prisma.post.update({
      where: { id },
      data: updateData,
      include: {
        author: { select: { id: true, name: true } },
        tags: { select: { id: true, name: true } },
      },
    });

    this.logger.info({ postId: id }, '文章更新成功');
    return post;
  }

  /**
   * 删除文章
   */
  async delete(id: number): Promise<void> {
    this.logger.info({ postId: id }, '删除文章');

    const existing = await this.app.prisma.post.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      this.app.throw(404, '文章不存在');
    }

    await this.app.prisma.post.delete({ where: { id } });

    this.logger.info({ postId: id }, '文章删除成功');
  }

  /**
   * 添加评论
   */
  async addComment(data: {
    postId: number;
    authorId: number;
    content: string;
  }) {
    this.logger.info({ postId: data.postId, authorId: data.authorId }, '添加评论');

    const prisma = this.app.prisma;

    // 验证文章存在且已发布
    const post = await prisma.post.findUnique({
      where: { id: data.postId },
      select: { id: true, published: true },
    });

    if (!post) {
      this.app.throw(404, '文章不存在');
    }

    if (!post.published) {
      this.app.throw(400, '不能评论未发布的文章');
    }

    const comment = await prisma.comment.create({
      data: {
        content: data.content,
        authorId: data.authorId,
        postId: data.postId,
      },
      include: {
        author: { select: { id: true, name: true } },
      },
    });

    this.logger.info({ commentId: comment.id }, '评论添加成功');
    return comment;
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
      database: 'connected',
      users: userCount,
      uptime: Math.floor(process.uptime()),
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
  // GET /users/list — 分页查询
  app.get('/list', {
    validate: {
      query: {
        page: 'number:1-',
        limit: 'number:1-100',
        keyword: 'string?',
        role: 'string?',
      },
    },
    docs: {
      summary: '用户列表',
      description: '分页查询用户列表，支持关键词搜索和角色筛选。返回每个用户的文章和评论计数。',
      tags: ['用户'],
    },
  }, async (req, res) => {
    const { page, limit, keyword, role } = req.valid('query');
    const result = await app.services.user.findAll({ page, limit, keyword, role });
    res.json(result);
  });

  // GET /users/:id — 查询详情（含文章列表）
  app.get('/:id', {
    validate: {
      param: { id: 'number:1-' },
    },
    docs: {
      summary: '获取用户详情',
      description: '查询用户详情，包含已发布文章列表及统计信息。',
      tags: ['用户'],
      responses: {
        200: { description: '查询成功' },
        404: { description: '用户不存在' },
      },
    },
  }, async (req, res) => {
    const { id } = req.valid('param');
    const user = await app.services.user.findById(id);
    if (!user) app.throw(404, '用户不存在');
    res.json(user);
  });

  // POST /users — 创建用户（需认证）
  app.post('/', {
    validate: {
      body: {
        name: 'string:1-50',
        email: 'email',
        age: 'number:0-200?',
        role: 'enum:admin,user,editor?',
        bio: 'string?',
      },
    },
    middlewares: ['auth'],
    docs: {
      summary: '创建用户',
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

  // PUT /users/:id — 更新用户（需认证）
  app.put('/:id', {
    validate: {
      param: { id: 'number:1-' },
      body: {
        name: 'string:1-50?',
        email: 'email?',
        age: 'number:0-200?',
        bio: 'string?',
      },
    },
    middlewares: ['auth'],
    docs: {
      summary: '更新用户',
      tags: ['用户'],
      responses: {
        200: { description: '更新成功' },
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

  // DELETE /users/:id — 删除用户（需认证）
  app.delete('/:id', {
    validate: {
      param: { id: 'number:1-' },
    },
    middlewares: ['auth'],
    docs: {
      summary: '删除用户',
      description: '删除用户及其所有文章和评论（级联删除）。',
      tags: ['用户'],
      responses: {
        204: { description: '删除成功' },
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

### 文章路由

```typescript
// src/routes/posts.ts
import { defineRoutes } from 'vextjs';

export default defineRoutes((app) => {
  // GET /posts/list — 查询已发布文章
  app.get('/list', {
    validate: {
      query: {
        page: 'number:1-',
        limit: 'number:1-100',
        keyword: 'string?',
        tag: 'string?',
      },
    },
    docs: {
      summary: '文章列表',
      description: '查询已发布文章列表，支持关键词搜索和标签筛选。',
      tags: ['文章'],
    },
  }, async (req, res) => {
    const { page, limit, keyword, tag } = req.valid('query');
    const result = await app.services.post.findPublished({ page, limit, keyword, tag });
    res.json(result);
  });

  // GET /posts/:id — 文章详情（含评论）
  app.get('/:id', {
    validate: {
      param: { id: 'number:1-' },
    },
    docs: {
      summary: '文章详情',
      description: '查询文章详情，包含作者信息、标签、评论列表。每次访问自动增加浏览计数。',
      tags: ['文章'],
      responses: {
        200: { description: '查询成功' },
        404: { description: '文章不存在' },
      },
    },
  }, async (req, res) => {
    const { id } = req.valid('param');
    const post = await app.services.post.findById(id);
    if (!post) app.throw(404, '文章不存在');
    res.json(post);
  });

  // POST /posts — 创建文章（需认证）
  app.post('/', {
    validate: {
      body: {
        title: 'string:1-200',
        content: 'string:1-',
        published: 'boolean?',
      },
    },
    middlewares: ['auth'],
    docs: {
      summary: '创建文章',
      description: '创建一篇新文章。可通过请求体中的 tags 字段关联标签（字符串数组）。',
      tags: ['文章'],
      responses: {
        201: { description: '创建成功' },
        401: { description: '未认证' },
      },
    },
  }, async (req, res) => {
    const body = req.valid('body');

    // 从认证信息中获取作者 ID
    const authorId = parseInt(req.user?.id ?? '0', 10);
    if (!authorId) {
      app.throw(401, '无法确定用户身份');
    }

    // tags 从原始 body 中获取（不在 validate schema 中声明，因为 schema-dsl 不支持数组校验）
    const rawBody = req.body as any;
    const tags = Array.isArray(rawBody?.tags) ? rawBody.tags : undefined;

    const post = await app.services.post.create({
      title: body.title,
      content: body.content,
      authorId,
      published: body.published,
      tags,
    });

    res.json(post, 201);
  });

  // PUT /posts/:id — 更新文章（需认证）
  app.put('/:id', {
    validate: {
      param: { id: 'number:1-' },
      body: {
        title: 'string:1-200?',
        content: 'string?',
        published: 'boolean?',
      },
    },
    middlewares: ['auth'],
    docs: {
      summary: '更新文章',
      tags: ['文章'],
      responses: {
        200: { description: '更新成功' },
        404: { description: '文章不存在' },
      },
    },
  }, async (req, res) => {
    const { id } = req.valid('param');
    const body = req.valid('body');

    const rawBody = req.body as any;
    const tags = Array.isArray(rawBody?.tags) ? rawBody.tags : undefined;

    const post = await app.services.post.update(id, { ...body, tags });
    res.json(post);
  });

  // DELETE /posts/:id — 删除文章（需认证）
  app.delete('/:id', {
    validate: {
      param: { id: 'number:1-' },
    },
    middlewares: ['auth'],
    docs: {
      summary: '删除文章',
      tags: ['文章'],
      responses: {
        204: { description: '删除成功' },
        404: { description: '文章不存在' },
      },
    },
  }, async (req, res) => {
    const { id } = req.valid('param');
    await app.services.post.delete(id);
    res.status(204).json(null);
  });

  // POST /posts/:id/comments — 添加评论（需认证）
  app.post('/:id/comments', {
    validate: {
      param: { id: 'number:1-' },
      body: {
        content: 'string:1-1000',
      },
    },
    middlewares: ['auth'],
    docs: {
      summary: '添加评论',
      description: '为指定文章添加评论。文章必须已发布。',
      tags: ['文章'],
      responses: {
        201: { description: '评论成功' },
        400: { description: '不能评论未发布的文章' },
        404: { description: '文章不存在' },
      },
    },
  }, async (req, res) => {
    const { id: postId } = req.valid('param');
    const { content } = req.valid('body');

    const authorId = parseInt(req.user?.id ?? '0', 10);
    if (!authorId) {
      app.throw(401, '无法确定用户身份');
    }

    const comment = await app.services.post.addComment({
      postId,
      authorId,
      content,
    });

    res.json(comment, 201);
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
# 初始化数据库
npx prisma migrate dev --name init

# 填充种子数据
pnpm db:seed

# 启动开发服务器
pnpm dev
```

### 接口验证

```bash
# 健康检查
curl http://localhost:3000/
# → {"code":0,"data":{"status":"ok","database":"connected","users":3,...},...}

# 用户列表（含文章/评论计数）
curl "http://localhost:3000/users/list?page=1&limit=10"
# → {"code":0,"data":{"items":[{"id":1,"name":"Alice",...,"_count":{"posts":3,"comments":0}},...],...},...}

# 用户详情（含文章列表和标签）
curl http://localhost:3000/users/1
# → {"code":0,"data":{"id":1,"name":"Alice","posts":[{"id":1,"title":"VextJS 入门指南","tags":[{"name":"后端"},...]},...]},...}

# 文章列表（按标签筛选）
curl "http://localhost:3000/posts/list?page=1&limit=10&tag=TypeScript"
# → 只返回包含 "TypeScript" 标签的文章

# 文章详情（含评论）
curl http://localhost:3000/posts/1
# → {"code":0,"data":{"id":1,"title":"VextJS 入门指南","viewCount":1,"comments":[...],"author":{"name":"Alice"},...},...}

# 创建文章（含标签）
curl -X POST http://localhost:3000/posts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user-1-admin" \
  -d '{
    "title": "Node.js 性能优化",
    "content": "分享 Node.js 性能优化的经验...",
    "published": true,
    "tags": ["后端", "性能"]
  }'
# → 201 {"code":0,"data":{"id":4,"title":"Node.js 性能优化","tags":[{"name":"后端"},{"name":"性能"}],...},...}

# 添加评论
curl -X POST http://localhost:3000/posts/1/comments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user-2-user" \
  -d '{"content": "非常实用的文章！学到了很多"}'
# → 201 {"code":0,"data":{"id":4,"content":"非常实用的文章！...","author":{"name":"Bob"}},...}

# 关键词搜索
curl "http://localhost:3000/posts/list?page=1&limit=10&keyword=VextJS"
# → 只返回标题或内容包含 "VextJS" 的文章

# 打开 Prisma Studio（可视化管理数据库）
pnpm db:studio
```

## Prisma 高级用法

### 中间件（Soft Delete）

Prisma 中间件可以拦截查询，实现软删除等功能：

```typescript
// src/plugins/database.ts 中添加
prisma.$use(async (params, next) => {
  // 软删除：delete 操作改为 update deletedAt
  if (params.action === 'delete') {
    params.action = 'update';
    params.args.data = { deletedAt: new Date() };
  }

  // 查询时自动过滤已删除记录
  if (params.action === 'findMany' || params.action === 'findFirst') {
    if (!params.args.where) params.args.where = {};
    params.args.where.deletedAt = null;
  }

  return next(params);
});
```

### 事务

```typescript
// 交互式事务
const result = await prisma.$transaction(async (tx) => {
  // 在事务中创建用户和初始文章
  const user = await tx.user.create({
    data: { name: 'Diana', email: 'diana@example.com' },
  });

  const post = await tx.post.create({
    data: {
      title: '我的第一篇文章',
      content: '欢迎来到我的博客！',
      authorId: user.id,
      published: true,
    },
  });

  return { user, post };
});

// 批量事务（数组形式）
const [updatedUser, newPost] = await prisma.$transaction([
  prisma.user.update({
    where: { id: 1 },
    data: { name: 'Alice Updated' },
  }),
  prisma.post.create({
    data: {
      title: '新文章',
      content: '内容',
      authorId: 1,
    },
  }),
]);
```

### 原生 SQL

```typescript
// 复杂统计查询可以使用原生 SQL
const stats = await prisma.$queryRaw`
  SELECT
    u.name,
    COUNT(p.id) as post_count,
    COALESCE(SUM(p.view_count), 0) as total_views
  FROM users u
  LEFT JOIN posts p ON p.author_id = u.id AND p.published = 1
  GROUP BY u.id
  ORDER BY total_views DESC
  LIMIT 10
`;
```

### 优化查询

```typescript
// 使用 select 只查询需要的字段（减少数据传输）
const users = await prisma.user.findMany({
  select: {
    id: true,
    name: true,
    email: true,
    // 不查询 bio、avatarUrl 等大字段
  },
});

// 使用 cursor 分页（大数据量时比 skip/take 高效）
const posts = await prisma.post.findMany({
  take: 10,
  cursor: { id: lastPostId },
  skip: 1, // 跳过 cursor 本身
  orderBy: { id: 'desc' },
});
```

## 测试

```typescript
// test/users.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestApp } from 'vextjs/testing';
import type { TestApp } from 'vextjs';

describe('用户 CRUD (Prisma)', () => {
  let testApp: TestApp;
  const AUTH = 'Bearer user-1-admin';

  beforeEach(async () => {
    testApp = await createTestApp({
      plugins: true,
    });
  });

  afterEach(async () => {
    await testApp?.close();
  });

  it('GET /users/list 应包含用户统计', async () => {
    const res = await testApp.request
      .get('/users/list')
      .query({ page: 1, limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body.data.items[0]).toHaveProperty('_count');
    expect(res.body.data.items[0]._count).toHaveProperty('posts');
  });

  it('GET /users/:id 应包含关联文章和标签', async () => {
    const res = await testApp.request.get('/users/1');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.posts)).toBe(true);

    if (res.body.data.posts.length > 0) {
      expect(res.body.data.posts[0]).toHaveProperty('tags');
      expect(res.body.data.posts[0]).toHaveProperty('_count');
    }
  });

  it('POST /users 应创建用户', async () => {
    const res = await testApp.request
      .post('/users')
      .set('Authorization', AUTH)
      .send({
        name: 'Diana',
        email: 'diana@example.com',
        bio: '新用户',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Diana');
    expect(res.body.data.role).toBe('user');
    expect(res.body.data.createdAt).toBeDefined();
  });

  it('DELETE /users/:id 应级联删除文章和评论', async () => {
    const deleteRes = await testApp.request
      .delete('/users/1')
      .set('Authorization', AUTH);

    expect(deleteRes.status).toBe(204);

    // 确认关联文章也被删除
    const postsRes = await testApp.request
      .get('/posts/list')
      .query({ page: 1, limit: 100 });

    const alicePosts = postsRes.body.data.items.filter(
      (p: any) => p.author.id === 1,
    );
    expect(alicePosts).toHaveLength(0);
  });
});

describe('文章与评论 (Prisma)', () => {
  let testApp: TestApp;
  const AUTH = 'Bearer user-1-admin';

  beforeEach(async () => {
    testApp = await createTestApp({ plugins: true });
  });

  afterEach(async () => {
    await testApp?.close();
  });

  it('GET /posts/list 应支持标签筛选', async () => {
    const res = await testApp.request
      .get('/posts/list')
      .query({ page: 1, limit: 10, tag: 'TypeScript' });

    expect(res.status).toBe(200);
    for (const post of res.body.data.items) {
      const tagNames = post.tags.map((t: any) => t.name);
      expect(tagNames).toContain('TypeScript');
    }
  });

  it('POST /posts/:id/comments 应添加评论', async () => {
    const res = await testApp.request
      .post('/posts/1/comments')
      .set('Authorization', AUTH)
      .send({ content: '测试评论' });

    expect(res.status).toBe(201);
    expect(res.body.data.content).toBe('测试评论');
    expect(res.body.data.author).toHaveProperty('name');
  });

  it('GET /posts/:id 应自增浏览计数', async () => {
    const res1 = await testApp.request.get('/posts/1');
    const viewCount1 = res1.body.data.viewCount;

    const res2 = await testApp.request.get('/posts/1');
    const viewCount2 = res2.body.data.viewCount;

    expect(viewCount2).toBe(viewCount1 + 1);
  });
});
```

## 项目模式总结

| 层级 | 职责 | 文件 |
|------|------|------|
| **Schema** | Prisma 数据模型定义 | `prisma/schema.prisma` |
| **种子数据** | 初始数据填充 | `prisma/seed.ts` |
| **迁移** | 数据库结构版本管理 | `prisma/migrations/` |
| **插件** | 初始化 PrismaClient、挂载 `app.prisma`、清理 | `src/plugins/database.ts` |
| **服务层** | 业务逻辑 + Prisma 查询 | `src/services/*.ts` |
| **路由层** | 请求校验 + 调用服务 + 响应 | `src/routes/*.ts` |
| **类型声明** | `app.prisma` 类型扩展 | `types/vext.d.ts` |

### 与 Drizzle 方案的对比

| 维度 | Prisma | Drizzle |
|------|--------|---------|
| Schema 定义 | `.prisma` DSL 文件 | TypeScript 代码 |
| 类型生成 | 代码生成（`prisma generate`） | Schema 推断（`$inferSelect`） |
| 查询 API | 高级 ORM API（`include`、嵌套写入） | SQL-like API（接近原生 SQL） |
| 关联查询 | `include` / `select` 嵌套 | Relations API / 手动 JOIN |
| 迁移 | `prisma migrate`（声明式） | `drizzle-kit`（声明式） |
| 事务 | `$transaction` | `db.transaction` |
| 可视化工具 | Prisma Studio | Drizzle Studio |
| 性能 | 中等（有查询层抽象） | 较高（直接编译 SQL） |
| 包体积 | 较大（生成的 Client） | 轻量 |
| 学习曲线 | 低（文档丰富） | 中（需要 SQL 基础） |

两种方案在 VextJS 中的集成模式完全相同：**通过插件初始化连接 → 挂载到 app → 服务层封装查询 → 路由层编排调用**。选择哪种取决于团队偏好和项目需求。

## 下一步

- 📖 [Drizzle ORM 集成](/examples/drizzle-orm) — 另一种 ORM 集成方案
- 📖 [Zod 校验集成](/examples/zod-validation) — 更强大的参数校验
- 📖 [插件](/guide/plugins) — 深入了解 VextJS 插件系统
- 📖 [服务层](/guide/services) — 深入了解服务层设计模式
- 📖 [测试](/guide/testing) — 测试数据库相关的业务逻辑