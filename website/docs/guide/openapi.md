# OpenAPI 文档

VextJS 内置 OpenAPI 文档自动生成功能。基于路由的 `validate` 和 `docs` 配置，框架自动生成 OpenAPI 3.0 规范的 JSON 文档，并提供 Swagger UI 在线查看和调试。

## 快速开始

### 1. 启用 OpenAPI

在配置中开启 `openapi.enabled`：

```typescript
// src/config/default.ts
export default {
  port: 3000,
  openapi: {
    enabled: true,
  },
};
```

### 2. 在路由中添加文档信息

```typescript
// src/routes/users.ts
import { defineRoutes } from 'vextjs';

export default defineRoutes((app) => {
  app.get('/', {
    validate: {
      query: {
        page: 'number:1-',
        limit: 'number:1-100',
      },
    },
    docs: {
      summary: '获取用户列表',
      description: '分页获取所有用户信息',
      tags: ['用户管理'],
    },
  }, async (req, res) => {
    const { page = 1, limit = 20 } = req.valid('query');
    const users = await app.services.user.findAll({ page, limit });
    res.json(users);
  });

  app.post('/', {
    validate: {
      body: {
        name: 'string:1-50!',
        email: 'email!',
        age: 'number:0-150?',
      },
    },
    middlewares: ['auth'],
    docs: {
      summary: '创建用户',
      tags: ['用户管理'],
    },
  }, async (req, res) => {
    const data = req.valid('body');
    const user = await app.services.user.create(data);
    res.json(user, 201);
  });
});
```

### 3. 访问文档

启动项目后，访问以下地址：

| 地址 | 说明 |
|------|------|
| `http://localhost:3000/docs` | Swagger UI 交互界面 |
| `http://localhost:3000/openapi.json` | OpenAPI JSON 规范文件 |

## 文档配置

### 全局配置

在 `config/default.ts` 中配置 OpenAPI 全局信息：

```typescript
// src/config/default.ts
export default {
  openapi: {
    enabled: true,
    title: 'My App API',
    description: '我的应用程序 RESTful API 文档',
    version: '1.0.0',

    // Swagger UI 路径
    docsPath: '/docs',

    // OpenAPI JSON 路径
    specPath: '/openapi.json',

    // 启用 "Try it out" 按钮
    tryItOut: true,

    // 文档展开方式：'list' | 'full' | 'none'
    docExpansion: 'list',

    // API 服务器列表
    servers: [
      { url: 'http://localhost:3000', description: '本地开发' },
      { url: 'https://api.myapp.com', description: '生产环境' },
    ],

    // 标签定义（控制分组顺序和描述）
    tags: [
      { name: '用户管理', description: '用户 CRUD 操作' },
      { name: '订单管理', description: '订单相关接口' },
      { name: '系统', description: '系统级接口' },
    ],

    // 安全方案定义
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      apiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
      },
    },

    // 中间件名 → 安全方案映射
    guardSecurityMap: {
      auth: 'bearerAuth',
      'api-key': 'apiKeyAuth',
    },

    // 联系方式
    contact: {
      name: 'API Support',
      email: 'support@myapp.com',
      url: 'https://myapp.com/support',
    },

    // 许可证
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
};
```

### 路由级文档配置

每个路由可以通过 `options.docs` 配置其 OpenAPI 文档信息：

```typescript
app.post('/users', {
  validate: { ... },
  docs: {
    // 接口摘要（一句话描述）
    summary: '创建用户',

    // 详细描述（支持 Markdown）
    description: '创建一个新用户。\n\n**注意：** 邮箱必须唯一。',

    // 标签分组（默认从路由文件路径推断）
    tags: ['用户管理'],

    // 操作标识（全局唯一，默认自动推断）
    operationId: 'createUser',

    // 是否已废弃
    deprecated: false,

    // 是否从文档中隐藏
    hidden: false,

    // 安全方案覆盖
    security: [{ bearerAuth: [] }],

    // 自定义响应定义
    responses: {
      201: {
        description: '创建成功',
        schema: { id: 'string', name: 'string', email: 'email' },
      },
      409: {
        description: '邮箱已存在',
      },
    },

    // 自定义扩展字段（x- 前缀）
    extensions: {
      'x-internal': true,
      'x-rate-limit': '10/min',
    },
  },
}, handler);
```

## docs 配置详解

### `summary` — 接口摘要

一句话描述接口功能，显示在 Swagger UI 的接口列表中：

```typescript
docs: { summary: '获取用户列表' }
```

### `description` — 详细描述

支持 Markdown 格式的详细说明，展开接口时显示：

```typescript
docs: {
  summary: '创建用户',
  description: `
创建一个新用户账户。

**前置条件：**
- 需要管理员权限
- 邮箱地址必须唯一

**返回值：**
- 成功时返回新创建的用户对象
- 邮箱冲突时返回 409 错误
  `,
}
```

### `tags` — 标签分组

控制接口在文档中的分组。如果不指定，框架会从路由文件路径自动推断：

```
src/routes/users.ts      → 默认 tag: 'users'
src/routes/admin/users.ts → 默认 tag: 'admin'
```

```typescript
// 手动指定（覆盖自动推断）
docs: { tags: ['用户管理', '管理后台'] }
```

### `operationId` — 操作标识

全局唯一的操作标识符。如果不指定，框架自动推断：

```
POST /users       → operationId: 'createUsers'
GET  /users       → operationId: 'getUsers'
GET  /users/:id   → operationId: 'getUsersById'
PUT  /users/:id   → operationId: 'updateUsersById'
DELETE /users/:id → operationId: 'deleteUsersById'
```

```typescript
// 手动指定
docs: { operationId: 'createNewUser' }
```

### `hidden` — 隐藏路由

不希望出现在文档中的路由（如内部接口）：

```typescript
app.get('/internal/metrics', {
  docs: { hidden: true },
}, handler);

app.get('/_health', {
  docs: { hidden: true },
}, handler);
```

### `deprecated` — 标记废弃

标记接口为已废弃，在 Swagger UI 中会有删除线提示：

```typescript
app.get('/v1/users', {
  docs: {
    summary: '获取用户列表（已废弃）',
    description: '请使用 `/v2/users` 替代',
    deprecated: true,
  },
}, handler);
```

### `security` — 安全方案

默认情况下，框架会从路由的 `middlewares` 自动推断安全方案。通过 `guardSecurityMap` 配置中间件名到安全方案的映射：

```typescript
// config/default.ts
export default {
  openapi: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    guardSecurityMap: {
      auth: 'bearerAuth',  // middlewares 中包含 'auth' → 映射为 bearerAuth
    },
  },
};
```

路由使用 `middlewares: ['auth']` 时，OpenAPI 文档自动标注需要 Bearer Token 认证。

手动覆盖：

```typescript
// 无需认证（即使有 auth 中间件）
docs: { security: [] }

// 指定特定安全方案
docs: { security: [{ apiKeyAuth: [] }] }
```

### `responses` — 响应定义

自定义路由的响应文档。key 为 HTTP 状态码：

```typescript
docs: {
  responses: {
    200: {
      description: '成功返回用户列表',
      schema: {
        id: 'string',
        name: 'string',
        email: 'email',
        role: 'admin|user',
      },
    },
    401: {
      description: '未认证',
    },
    403: {
      description: '权限不足',
    },
    500: {
      description: '服务器内部错误',
    },
  },
}
```

响应 `schema` 使用与 `validate` 相同的 DSL 语法，自动转换为 JSON Schema。

#### 响应示例

```typescript
docs: {
  responses: {
    200: {
      description: '用户详情',
      example: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Alice',
        email: 'alice@example.com',
        role: 'admin',
      },
    },
    404: {
      description: '用户不存在',
      example: {
        code: 40001,
        message: '用户不存在',
        requestId: 'xxx',
      },
    },
  },
}
```

#### 多响应示例

```typescript
docs: {
  responses: {
    200: {
      description: '用户详情',
      examples: {
        admin: {
          summary: '管理员用户',
          value: { id: '1', name: 'Admin', role: 'admin' },
        },
        regular: {
          summary: '普通用户',
          value: { id: '2', name: 'User', role: 'user' },
        },
      },
    },
  },
}
```

#### 自定义 Content-Type

```typescript
docs: {
  responses: {
    200: {
      description: 'CSV 导出文件',
      contentType: 'text/csv',
    },
  },
}
```

#### 响应头

```typescript
docs: {
  responses: {
    200: {
      description: '成功',
      headers: {
        'X-Total-Count': {
          description: '总记录数',
          schema: { type: 'integer' },
        },
        'X-Page': {
          description: '当前页码',
          schema: { type: 'integer' },
        },
      },
    },
  },
}
```

## validate 与文档的自动联动

路由中的 `validate` 规则会自动映射到 OpenAPI 文档，无需重复编写：

```typescript
app.get('/users', {
  validate: {
    query: {
      page: 'number:1-',
      limit: 'number:1-100',
      status: 'active|inactive|banned',
      keyword: 'string?',
    },
  },
  docs: { summary: '获取用户列表' },
}, handler);
```

自动生成的 OpenAPI 参数：

| 参数 | 位置 | 类型 | 约束 |
|------|------|------|------|
| `page` | query | integer | minimum: 1 |
| `limit` | query | integer | minimum: 1, maximum: 100 |
| `status` | query | string | enum: ["active", "inactive", "banned"] |
| `keyword` | query | string | — |

`validate.body` 的规则自动映射为 `requestBody`（JSON schema）：

```typescript
app.post('/users', {
  validate: {
    body: {
      name: 'string:1-50!',
      email: 'email!',
      age: 'number:0-150?',
    },
  },
}, handler);
```

生成的 requestBody schema：

```json
{
  "type": "object",
  "required": ["name", "email"],
  "properties": {
    "name": { "type": "string", "minLength": 1, "maxLength": 50 },
    "email": { "type": "string", "format": "email" },
    "age": { "type": "number", "minimum": 0, "maximum": 150 }
  }
}
```

## 按环境控制

建议在开发环境启用文档，生产环境关闭：

```typescript
// src/config/default.ts
export default {
  openapi: {
    enabled: true,
    title: 'My App API',
    tryItOut: true,
  },
};
```

```typescript
// src/config/production.ts
export default {
  openapi: {
    enabled: false,   // 生产环境关闭 Swagger UI
  },
};
```

如果生产环境需要保留 API 文档但禁用在线调试：

```typescript
// src/config/production.ts
export default {
  openapi: {
    enabled: true,
    tryItOut: false,   // 禁用 "Try it out" 按钮
  },
};
```

## 自定义文档路径

```typescript
export default {
  openapi: {
    enabled: true,
    docsPath: '/api-docs',       // Swagger UI: http://localhost:3000/api-docs
    specPath: '/api/spec.json',  // JSON: http://localhost:3000/api/spec.json
  },
};
```

## 与第三方工具集成

### 导出 OpenAPI 规范

访问 `http://localhost:3000/openapi.json` 获取完整的 OpenAPI 3.0 JSON 文件，可用于：

- **Postman** — 导入 API 集合
- **Insomnia** — 导入 API 工作区
- **代码生成** — 使用 `openapi-generator` 生成客户端 SDK
- **API 网关** — 导入到 Kong、AWS API Gateway 等
- **文档平台** — 导入到 Stoplight、ReadMe 等

### 示例：生成 TypeScript 客户端

```bash
npx openapi-generator-cli generate \
  -i http://localhost:3000/openapi.json \
  -g typescript-fetch \
  -o ./generated/api-client
```

## 文档最佳实践

### 1. 始终提供 `summary`

`summary` 是接口在文档列表中最重要的标识，应简洁明了：

```typescript
// ✅ 好的 summary
docs: { summary: '获取用户列表' }
docs: { summary: '创建订单' }
docs: { summary: '上传用户头像' }

// ❌ 不好的 summary
docs: { summary: '这个接口用于获取系统中所有用户的列表数据' }  // 太长
docs: { summary: 'GET users' }  // 没有价值
```

### 2. 使用一致的标签

统一使用中文或英文标签，并在全局 `tags` 中预定义顺序和描述：

```typescript
// ✅ 在 config 中统一定义
openapi: {
  tags: [
    { name: '认证', description: '登录、注册、Token 管理' },
    { name: '用户', description: '用户 CRUD' },
    { name: '订单', description: '订单管理' },
    { name: '系统', description: '健康检查、配置信息' },
  ],
}
```

### 3. 为错误响应添加文档

常见的错误码应在 `responses` 中说明：

```typescript
docs: {
  summary: '创建用户',
  responses: {
    201: { description: '创建成功' },
    400: { description: '请求参数错误' },
    401: { description: '未认证' },
    409: { description: '邮箱已存在' },
    422: { description: '参数校验失败' },
  },
}
```

### 4. 隐藏内部接口

框架内部或运维使用的接口应标记为 `hidden`：

```typescript
// 健康检查、指标、调试接口等
app.get('/health', { docs: { hidden: true } }, handler);
app.get('/metrics', { docs: { hidden: true } }, handler);
app.get('/debug/config', { docs: { hidden: true } }, handler);
```

### 5. 善用 `deprecated`

API 版本迭代时，使用 `deprecated` 而非直接删除旧接口：

```typescript
// v1 接口标记废弃
app.get('/v1/users', {
  docs: {
    summary: '获取用户列表 (v1)',
    deprecated: true,
    description: '此接口已废弃，请使用 `GET /v2/users`',
  },
}, handler);

// v2 新接口
app.get('/v2/users', {
  docs: {
    summary: '获取用户列表',
    tags: ['用户 v2'],
  },
}, handler);
```

## 完整示例

```typescript
// src/routes/orders.ts
import { defineRoutes } from 'vextjs';

export default defineRoutes((app) => {
  // 获取订单列表
  app.get('/', {
    validate: {
      query: {
        page: 'number:1-',
        limit: 'number:1-50',
        status: 'pending|paid|shipped|completed|cancelled',
        startDate: 'date?',
        endDate: 'date?',
      },
    },
    middlewares: ['auth'],
    docs: {
      summary: '获取订单列表',
      description: '分页获取当前用户的订单列表，支持按状态和日期范围筛选。',
      tags: ['订单'],
      responses: {
        200: {
          description: '订单列表',
          headers: {
            'X-Total-Count': {
              description: '总订单数',
              schema: { type: 'integer' },
            },
          },
        },
      },
    },
  }, async (req, res) => {
    const filters = req.valid('query');
    const orders = await app.services.order.findAll(filters);
    res.json(orders);
  });

  // 创建订单
  app.post('/', {
    validate: {
      body: {
        productId: 'string!',
        quantity: 'number:1-99!',
        shippingAddress: 'string:1-200!',
        couponCode: 'string?',
      },
    },
    middlewares: ['auth'],
    docs: {
      summary: '创建订单',
      tags: ['订单'],
      responses: {
        201: {
          description: '订单创建成功',
          example: {
            orderId: 'ord_abc123',
            status: 'pending',
            total: 99.99,
          },
        },
        400: { description: '库存不足或优惠券无效' },
        401: { description: '未认证' },
      },
    },
  }, async (req, res) => {
    const data = req.valid('body');
    const order = await app.services.order.create(data);
    res.json(order, 201);
  });

  // 取消订单
  app.post('/:id/cancel', {
    validate: {
      param: { id: 'string!' },
      body: { reason: 'string:1-500?' },
    },
    middlewares: ['auth'],
    docs: {
      summary: '取消订单',
      tags: ['订单'],
      responses: {
        200: { description: '取消成功' },
        400: { description: '订单状态不允许取消' },
        404: { description: '订单不存在' },
      },
    },
  }, async (req, res) => {
    const { id } = req.valid('param');
    const { reason } = req.valid('body');
    await app.services.order.cancel(id, reason);
    res.json({ success: true });
  });
});
```

## 下一步

- 了解 [参数校验](/guide/validation) 的 DSL 语法如何映射到 OpenAPI
- 学习 [配置](/guide/configuration) 中 OpenAPI 的完整选项
- 查看 [Adapter 架构](/guide/adapters) 了解不同 Adapter 下的文档行为
- 探索 [测试](/guide/testing) 如何验证 API 文档的准确性