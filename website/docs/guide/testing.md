# 测试

VextJS 内置了完整的测试工具，通过 `vextjs/testing` 子路径导入。无需启动真实 HTTP 服务器，即可对路由、中间件、服务进行端到端测试。

## 快速开始

```typescript
import { describe, it, expect } from 'vitest';
import { createTestApp } from 'vextjs/testing';

describe('GET /health', () => {
  it('should return ok', async () => {
    const app = await createTestApp();

    const res = await app.request.get('/health');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: 'ok' });
  });
});
```

VextJS 推荐使用 [Vitest](https://vitest.dev/) 作为测试框架，但测试工具本身不依赖任何特定测试框架，你也可以搭配 Jest、Node.js 内置 test runner 等使用。

## `createTestApp()`

`createTestApp()` 是测试的核心 API。它创建一个完整的应用实例，模拟请求处理流程，但不启动 HTTP 监听。

### 基本用法

```typescript
import { createTestApp } from 'vextjs/testing';

// 使用默认配置（自动加载 src/routes、src/services 等）
const app = await createTestApp();

// 发送测试请求
const res = await app.request.get('/users');
expect(res.status).toBe(200);
```

### 配置选项

```typescript
interface CreateTestAppOptions {
  /** 自定义配置（覆盖 default.ts） */
  config?: Partial<VextConfig>;

  /** 是否加载 src/plugins/ 目录中的插件（默认 true） */
  loadPlugins?: boolean;

  /** 自定义插件 setup 函数（替代或补充文件系统扫描） */
  setupPlugins?: (app: VextApp) => Promise<void> | void;

  /** 是否加载 src/services/ 目录中的服务（默认 true） */
  loadServices?: boolean;

  /** 模拟服务对象（替代自动扫描的服务） */
  mockServices?: Record<string, unknown>;

  /** 是否加载 src/routes/ 目录中的路由（默认 true） */
  loadRoutes?: boolean;

  /** 是否加载 src/middlewares/ 目录中的中间件（默认 true） */
  loadMiddlewares?: boolean;
}
```

### 常见配置场景

#### 自定义端口和日志级别

```typescript
const app = await createTestApp({
  config: {
    port: 0,
    logger: { level: 'silent' },  // 测试时静默日志
  },
});
```

#### 跳过插件加载

```typescript
const app = await createTestApp({
  loadPlugins: false,  // 不加载 src/plugins/ 下的插件
});
```

#### 模拟服务

```typescript
const app = await createTestApp({
  loadServices: false,  // 不加载真实的 service
  mockServices: {
    user: {
      findAll: async () => [{ id: '1', name: 'Alice' }],
      findById: async (id: string) => ({ id, name: 'Alice' }),
      create: async (data: any) => ({ id: '99', ...data }),
    },
  },
});
```

#### 自定义插件

```typescript
const app = await createTestApp({
  loadPlugins: false,
  setupPlugins: async (app) => {
    // 注入测试用的模拟对象
    app.extend('cache', new Map());
    app.extend('mailer', {
      send: async () => ({ messageId: 'test-123' }),
    });
  },
});
```

## 发送测试请求

`createTestApp()` 返回的对象包含 `request` 属性，支持所有 HTTP 方法：

```typescript
const app = await createTestApp();

// GET
const res1 = await app.request.get('/users');

// POST
const res2 = await app.request.post('/users');

// PUT
const res3 = await app.request.put('/users/1');

// PATCH
const res4 = await app.request.patch('/users/1');

// DELETE
const res5 = await app.request.delete('/users/1');

// OPTIONS
const res6 = await app.request.options('/users');

// HEAD
const res7 = await app.request.head('/users');
```

### 链式构建请求

每个 HTTP 方法返回一个 `TestRequestBuilder`，支持链式调用来配置请求：

```typescript
const res = await app.request
  .post('/users')
  .set('Authorization', 'Bearer test-token')  // 设置单个 header
  .headers({                                    // 批量设置 headers
    'X-Custom': 'value',
    'Accept-Language': 'zh-CN',
  })
  .query({ page: '1', limit: '10' })           // 设置 query 参数
  .type('application/json')                     // 设置 Content-Type
  .send({ name: 'Alice', email: 'alice@example.com' });  // 设置请求体
```

#### `.set(name, value)` — 设置单个请求头

```typescript
app.request
  .get('/profile')
  .set('Authorization', 'Bearer my-token')
  .set('Accept-Language', 'en-US');
```

#### `.headers(obj)` — 批量设置请求头

```typescript
app.request
  .get('/data')
  .headers({
    'Authorization': 'Bearer token',
    'X-Request-Id': 'test-req-001',
  });
```

#### `.query(obj)` — 设置 URL 查询参数

```typescript
app.request
  .get('/search')
  .query({ keyword: 'vext', page: '1', limit: '20' });
// 实际请求 URL: /search?keyword=vext&page=1&limit=20
```

#### `.send(body)` — 设置请求体

```typescript
// 发送 JSON（默认 Content-Type: application/json）
app.request
  .post('/users')
  .send({ name: 'Alice', email: 'alice@example.com' });

// 发送字符串
app.request
  .post('/raw')
  .type('text/plain')
  .send('Hello World');
```

#### `.type(contentType)` — 设置 Content-Type

```typescript
app.request
  .post('/upload')
  .type('application/x-www-form-urlencoded')
  .send('name=Alice&email=alice@example.com');
```

### `TestResponse` 响应对象

请求完成后返回 `TestResponse` 对象：

```typescript
interface TestResponse {
  /** HTTP 状态码 */
  status: number;

  /** 响应头（小写 key） */
  headers: Record<string, string>;

  /** 解析后的响应体（JSON 自动解析为对象） */
  body: any;

  /** 原始响应体文本 */
  text: string;
}
```

```typescript
const res = await app.request.get('/users');

// 断言状态码
expect(res.status).toBe(200);

// 断言响应体（JSON 自动解析）
expect(res.body).toEqual({
  code: 0,
  data: [{ id: '1', name: 'Alice' }],
  requestId: expect.any(String),
});

// 断言响应头
expect(res.headers['content-type']).toContain('application/json');
expect(res.headers['x-request-id']).toBeDefined();

// 断言原始文本
expect(res.text).toContain('"code":0');
```

## 测试模式特性

`createTestApp()` 创建的应用处于测试模式（`_testMode: true`），与生产模式有以下区别：

| 特性 | 测试模式 | 生产模式 |
|------|---------|---------|
| HTTP 监听 | ❌ 不启动 | ✅ 监听端口 |
| `process.exit()` | ❌ 不调用 | ✅ 关闭时调用 |
| 日志级别 | 默认 `silent` | 由配置决定 |
| 限流 | 默认放宽到 100000 | 由配置决定 |
| 关闭超时 | 默认 1 秒 | 由配置决定 |

## 实战示例

### 测试 CRUD 路由

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { createTestApp, type TestApp } from 'vextjs/testing';

describe('Users API', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({
      config: {
        logger: { level: 'silent' },
      },
    });
  });

  describe('GET /users', () => {
    it('should return user list', async () => {
      const res = await app.request.get('/users');

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(Array.isArray(res.body.data.items)).toBe(true);
    });

    it('should support pagination', async () => {
      const res = await app.request
        .get('/users')
        .query({ page: '2', limit: '5' });

      expect(res.status).toBe(200);
    });
  });

  describe('POST /users', () => {
    it('should create a user', async () => {
      const res = await app.request
        .post('/users')
        .set('Authorization', 'Bearer test-token')
        .send({ name: 'Bob', email: 'bob@example.com' });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        name: 'Bob',
        email: 'bob@example.com',
      });
    });

    it('should return 422 for invalid data', async () => {
      const res = await app.request
        .post('/users')
        .set('Authorization', 'Bearer test-token')
        .send({ name: '', email: 'invalid' });

      expect(res.status).toBe(422);
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors.length).toBeGreaterThan(0);
    });

    it('should return 401 without token', async () => {
      const res = await app.request
        .post('/users')
        .send({ name: 'Bob', email: 'bob@example.com' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /users/:id', () => {
    it('should return user by id', async () => {
      const res = await app.request.get('/users/1');

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe('1');
    });

    it('should return 404 for non-existent user', async () => {
      const res = await app.request.get('/users/non-existent');

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /users/:id', () => {
    it('should delete user', async () => {
      const res = await app.request
        .delete('/users/1')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(204);
    });
  });
});
```

### 测试中间件

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { createTestApp, type TestApp } from 'vextjs/testing';

describe('Auth Middleware', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({
      config: {
        logger: { level: 'silent' },
      },
    });
  });

  it('should allow request with valid token', async () => {
    const res = await app.request
      .get('/admin/dashboard')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
  });

  it('should reject request without token', async () => {
    const res = await app.request.get('/admin/dashboard');

    expect(res.status).toBe(401);
    expect(res.body.message).toContain('Authorization');
  });

  it('should reject request with expired token', async () => {
    const res = await app.request
      .get('/admin/dashboard')
      .set('Authorization', 'Bearer expired-token');

    expect(res.status).toBe(401);
  });
});
```

### 使用模拟服务测试

当你只想测试路由逻辑而不想依赖真实的数据库时，使用 `mockServices`：

```typescript
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createTestApp, type TestApp } from 'vextjs/testing';

describe('Users API with mock services', () => {
  const mockUserService = {
    findAll: vi.fn().mockResolvedValue({
      items: [{ id: '1', name: 'Alice' }],
      total: 1,
    }),
    findById: vi.fn().mockImplementation(async (id: string) => {
      if (id === '1') return { id: '1', name: 'Alice' };
      return null;
    }),
    create: vi.fn().mockImplementation(async (data: any) => ({
      id: '2',
      ...data,
    })),
  };

  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({
      loadServices: false,
      mockServices: {
        user: mockUserService,
      },
      config: {
        logger: { level: 'silent' },
      },
    });
  });

  it('should call findAll service method', async () => {
    const res = await app.request.get('/users');

    expect(res.status).toBe(200);
    expect(mockUserService.findAll).toHaveBeenCalled();
  });

  it('should call findById with correct id', async () => {
    await app.request.get('/users/1');

    expect(mockUserService.findById).toHaveBeenCalledWith('1');
  });

  it('should return 404 when service returns null', async () => {
    const res = await app.request.get('/users/999');

    expect(res.status).toBe(404);
    expect(mockUserService.findById).toHaveBeenCalledWith('999');
  });

  it('should pass validated body to create', async () => {
    const res = await app.request
      .post('/users')
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'Bob', email: 'bob@example.com' });

    expect(res.status).toBe(201);
    expect(mockUserService.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Bob', email: 'bob@example.com' }),
    );
  });
});
```

### 测试服务层（单元测试）

服务层可以独立于 HTTP 进行单元测试。直接实例化 service，传入模拟的 `app` 对象：

```typescript
import { describe, it, expect, vi } from 'vitest';
import UserService from '../../src/services/user.js';

describe('UserService', () => {
  function createMockApp() {
    return {
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      throw: vi.fn().mockImplementation((status, message) => {
        const err = new Error(message);
        (err as any).status = status;
        throw err;
      }),
      config: { port: 3000 },
      services: {},
    };
  }

  it('should create user', async () => {
    const app = createMockApp();
    const service = new UserService(app as any);

    const user = await service.create({ name: 'Alice', email: 'alice@test.com' });

    expect(user).toMatchObject({ name: 'Alice', email: 'alice@test.com' });
    expect(user.id).toBeDefined();
    expect(app.logger.info).toHaveBeenCalled();
  });

  it('should find user by id', async () => {
    const app = createMockApp();
    const service = new UserService(app as any);

    const user = await service.findById('1');

    expect(user).toBeDefined();
    expect(user?.id).toBe('1');
  });
});
```

### 测试错误响应

```typescript
describe('Error handling', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({
      config: { logger: { level: 'silent' } },
    });
  });

  it('should return 404 for unknown routes', async () => {
    const res = await app.request.get('/this-route-does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      code: 404,
      message: expect.any(String),
      requestId: expect.any(String),
    });
  });

  it('should include requestId in error responses', async () => {
    const res = await app.request.get('/non-existent');

    expect(res.body.requestId).toBeDefined();
    expect(typeof res.body.requestId).toBe('string');
  });

  it('should return 422 for validation errors', async () => {
    const res = await app.request
      .post('/users')
      .set('Authorization', 'Bearer test-token')
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.errors).toBeInstanceOf(Array);
  });
});
```

### 测试自定义请求头

```typescript
describe('Request headers', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({
      config: { logger: { level: 'silent' } },
    });
  });

  it('should forward X-Request-Id header', async () => {
    const customId = 'my-custom-request-id';

    const res = await app.request
      .get('/health')
      .set('X-Request-Id', customId);

    expect(res.body.requestId).toBe(customId);
  });

  it('should generate request id when not provided', async () => {
    const res = await app.request.get('/health');

    expect(res.body.requestId).toBeDefined();
    expect(res.body.requestId.length).toBeGreaterThan(0);
  });
});
```

## 项目配置

### Vitest 配置

推荐的 `vitest.config.ts` 配置：

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types/**', 'src/cli/**'],
    },
  },
});
```

### 测试目录结构

推荐的测试目录组织方式：

```
test/
├── unit/                    # 单元测试
│   ├── services/
│   │   ├── user.test.ts
│   │   └── order.test.ts
│   ├── middlewares/
│   │   └── auth.test.ts
│   └── lib/
│       └── config-loader.test.ts
│
├── integration/             # 集成测试
│   ├── routes/
│   │   ├── users.test.ts
│   │   └── orders.test.ts
│   └── plugins/
│       └── redis.test.ts
│
└── e2e/                     # 端到端测试
    └── api.test.ts
```

### package.json 脚本

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run test/unit",
    "test:int": "vitest run test/integration",
    "test:e2e": "vitest run test/e2e",
    "test:cov": "vitest run --coverage"
  }
}
```

## 最佳实践

### 1. 测试时静默日志

避免测试输出被日志信息淹没：

```typescript
const app = await createTestApp({
  config: {
    logger: { level: 'silent' },
  },
});
```

### 2. 使用 `beforeAll` 复用应用实例

`createTestApp()` 有一定的初始化开销。在同一个 `describe` 块中复用应用实例：

```typescript
describe('Users API', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  it('test 1', async () => { /* 复用 app */ });
  it('test 2', async () => { /* 复用 app */ });
});
```

### 3. 隔离测试副作用

如果测试会修改数据状态，使用模拟服务避免测试间的副作用：

```typescript
const app = await createTestApp({
  loadServices: false,
  mockServices: {
    user: createFreshMockUserService(), // 每组测试使用新的 mock
  },
});
```

### 4. 测试边界情况

不要只测试正常路径，也要覆盖错误情况：

```typescript
// ✅ 测试正常 + 异常
it('should create user', async () => { /* 正常创建 */ });
it('should reject invalid email', async () => { /* 校验失败 */ });
it('should reject duplicate email', async () => { /* 业务错误 */ });
it('should reject without auth', async () => { /* 未认证 */ });
it('should reject with wrong role', async () => { /* 无权限 */ });
```

### 5. 断言响应结构

使用 `toMatchObject` 或 `toEqual` 断言完整的响应结构，而非只检查单个字段：

```typescript
// ✅ 断言完整结构
expect(res.body).toMatchObject({
  code: 0,
  data: {
    id: expect.any(String),
    name: 'Alice',
    email: 'alice@example.com',
  },
  requestId: expect.any(String),
});

// ❌ 只检查单个字段（容易遗漏问题）
expect(res.body.data.name).toBe('Alice');
```

## 下一步

- 了解 [路由](/guide/routing) 如何定义可测试的 API
- 学习 [服务层](/guide/services) 的单元测试模式
- 查看 [CLI 命令](/guide/cli) 中的 `vext test` 相关说明
- 探索 [中间件](/guide/middleware) 的测试技巧