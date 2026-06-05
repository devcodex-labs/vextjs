# OpenAPI 文档

VextJS 内置 OpenAPI 文档自动生成功能。基于路由的 `validate` 和 `docs` 配置，框架自动生成 OpenAPI 3.0 规范的 JSON 文档，并提供 [Scalar API Reference](https://github.com/scalar/scalar) 在线查看和交互式调试。

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
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/",
    {
      validate: {
        query: {
          page: "number:1-",
          limit: "number:1-100",
        },
      },
      docs: {
        summary: "获取用户列表",
        description: "分页获取所有用户信息",
        tags: ["用户管理"],
      },
    },
    async (req, res) => {
      const { page = 1, limit = 20 } = req.valid("query");
      const users = await app.services.user.findAll({ page, limit });
      res.json(users);
    },
  );

  app.post(
    "/",
    {
      validate: {
        body: {
          name: "string:1-50!",
          email: "email!",
          age: "number:0-150?",
        },
      },
      middlewares: ["auth"],
      docs: {
        summary: "创建用户",
        tags: ["用户管理"],
      },
    },
    async (req, res) => {
      const data = req.valid("body");
      const user = await app.services.user.create(data);
      res.json(user, 201);
    },
  );
});
```

### 3. 访问文档

启动项目后，访问以下地址：

| 地址                                 | 说明                                               |
| ------------------------------------ | -------------------------------------------------- |
| `http://localhost:3000/docs`         | Scalar API Reference 文档界面（含内置 Try it out） |
| `http://localhost:3000/openapi.json` | OpenAPI JSON 规范文件                              |

如果需要在生成后追加组织级扩展字段，可使用 OpenAPI hook。`OpenAPIGenerator.generate()` 仍保持同步，`openapi:afterGenerate` 也必须同步返回 patch：

```typescript
// src/plugins/openapi-extra.ts
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "openapi-extra",
  setup(app) {
    app.hooks.on("openapi:afterGenerate", ({ document }) => ({
      document: {
        ...(document as Record<string, unknown>),
        "x-service-owner": "platform",
      },
    }));
  },
});
```

## 文档配置

### 全局配置

在 `config/default.ts` 中配置 OpenAPI 全局信息：

```typescript
// src/config/default.ts
export default {
  openapi: {
    enabled: true,
    title: "My App API",
    description: "我的应用程序 RESTful API 文档",
    version: "1.0.0",

    // Scalar 文档路径
    docsPath: "/docs",

    // OpenAPI JSON 路径
    jsonPath: "/openapi.json",

    // 反向代理公开路径（代理剥离前缀时配置，详见"自定义文档路径"章节）
    // jsonPublicPath: '/admin/openapi.json',

    // Scalar API Reference 配置
    scalar: {
      theme: "default", // 主题：'default' | 'moon' | 'purple' | 'solarized' | ...
      darkMode: false, // 深色模式
      layout: "modern", // 布局：'modern'（三栏） | 'classic'（双栏）
      favicon: "/favicon.svg", // 文档页面图标
    },

    // API 服务器列表
    servers: [
      { url: "http://localhost:3000", description: "本地开发" },
      { url: "https://api.myapp.com", description: "生产环境" },
    ],

    // 标签定义（控制分组顺序和描述）
    tags: [
      { name: "用户管理", description: "用户 CRUD 操作" },
      { name: "订单管理", description: "订单相关接口" },
      { name: "系统", description: "系统级接口" },
    ],

    // 安全方案定义
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
      apiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
      },
    },

    // 中间件名 → 安全方案映射
    guardSecurityMap: {
      auth: "bearerAuth",
      "api-key": "apiKeyAuth",
    },

    // 联系方式
    contact: {
      name: "API Support",
      email: "support@myapp.com",
      url: "https://myapp.com/support",
    },

    // 许可证
    license: {
      name: "MIT",
      url: "https://opensource.org/licenses/MIT",
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

一句话描述接口功能，显示在文档 UI 的接口列表中：

```typescript
docs: {
  summary: "获取用户列表";
}
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
docs: {
  tags: ["用户管理", "管理后台"];
}
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
docs: {
  operationId: "createNewUser";
}
```

### `hidden` — 隐藏路由

不希望出现在文档中的路由（如内部接口）：

```typescript
app.get(
  "/internal/metrics",
  {
    docs: { hidden: true },
  },
  handler,
);

app.get(
  "/_health",
  {
    docs: { hidden: true },
  },
  handler,
);
```

### `deprecated` — 标记废弃

标记接口为已废弃，在文档中会有删除线和废弃提示：

```typescript
app.get(
  "/v1/users",
  {
    docs: {
      summary: "获取用户列表（已废弃）",
      description: "请使用 `/v2/users` 替代",
      deprecated: true,
    },
  },
  handler,
);
```

### `security` — 安全方案

默认情况下，框架会从路由的 `middlewares` 自动推断安全方案。通过 `guardSecurityMap` 配置中间件名到安全方案的映射：

```typescript
// config/default.ts
export default {
  openapi: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    guardSecurityMap: {
      auth: "bearerAuth", // middlewares 中包含 'auth' → 映射为 bearerAuth
    },
  },
};
```

路由使用 `middlewares: ['auth']` 时，OpenAPI 文档自动标注需要 Bearer Token 认证。

手动覆盖：

```typescript
// 无需认证（即使有 auth 中间件）
docs: {
  security: [];
}

// 指定特定安全方案
docs: {
  security: [{ apiKeyAuth: [] }];
}
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
app.get(
  "/users",
  {
    validate: {
      query: {
        page: "number:1-",
        limit: "number:1-100",
        status: "active|inactive|banned",
        keyword: "string?",
      },
    },
    docs: { summary: "获取用户列表" },
  },
  handler,
);
```

自动生成的 OpenAPI 参数：

| 参数      | 位置  | 类型    | 约束                                   |
| --------- | ----- | ------- | -------------------------------------- |
| `page`    | query | integer | minimum: 1                             |
| `limit`   | query | integer | minimum: 1, maximum: 100               |
| `status`  | query | string  | enum: ["active", "inactive", "banned"] |
| `keyword` | query | string  | —                                      |

`validate.body` 的规则自动映射为 `requestBody`（JSON schema）：

```typescript
app.post(
  "/users",
  {
    validate: {
      body: {
        name: "string:1-50!",
        email: "email!",
        age: "number:0-150?",
      },
    },
  },
  handler,
);
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

字段级业务描述可以直接写在 DSL 上，生成器会把它输出为 OpenAPI schema 的 `description`：

```typescript
app.post(
  "/translate",
  {
    validate: {
      body: {
        content: "string:1-20000!".description(
          "待翻译文本，长度 1-20000 个字符",
        ),
        targetLanguages: [
          {
            code: "string:1-64!".description("目标语言代码"),
          },
        ],
        format: "enum:plain_text,preserve_line_breaks".description("输出格式"),
      },
    },
  },
  handler,
);
```

生成的 requestBody schema 中会包含：

```json
{
  "type": "object",
  "required": ["content"],
  "properties": {
    "content": {
      "type": "string",
      "minLength": 1,
      "maxLength": 20000,
      "description": "待翻译文本，长度 1-20000 个字符"
    },
    "format": {
      "type": "string",
      "enum": ["plain_text", "preserve_line_breaks"],
      "description": "输出格式"
    }
  }
}
```

### 文件上传路由（multipart/form-data）

使用 `RouteOptions.multipart.files` 声明文件上传路由，生成器自动输出 `multipart/form-data` requestBody。

```typescript
app.post(
  "/upload/avatar",
  {
    middlewares: ["upload"],
    multipart: {
      files: {
        avatar: {
          description: "头像图片（JPEG/PNG，最大 5MB）",
          required: true,
        },
      },
    },
    docs: {
      summary: "上传头像",
      tags: ["用户"],
    },
  },
  handler,
);
```

生成的 OpenAPI 片段：

```json
{
  "requestBody": {
    "required": true,
    "content": {
      "multipart/form-data": {
        "schema": {
          "type": "object",
          "required": ["avatar"],
          "properties": {
            "avatar": {
              "type": "string",
              "format": "binary",
              "description": "头像图片（JPEG/PNG，最大 5MB）"
            }
          }
        }
      }
    }
  }
}
```

:::tip 和 validate.body 的关系
`multipart.files` 和 `validate.body` 互斥。同时配置时，`multipart.files` 优先。
:::

## 按环境控制

建议在开发环境启用文档，生产环境关闭：

```typescript
// src/config/default.ts
export default {
  openapi: {
    enabled: true,
    title: "My App API",
    scalar: {
      theme: "default",
      favicon: "/favicon.svg",
    },
  },
};
```

```typescript
// src/config/production.ts
export default {
  openapi: {
    enabled: false, // 生产环境关闭文档
  },
};
```

如果生产环境需要保留 API 文档（只读参考）：

```typescript
// src/config/production.ts
export default {
  openapi: {
    enabled: true,
    scalar: {
      darkMode: false,
    },
  },
};
```

## 自定义文档路径

通过 `docsPath` 和 `jsonPath` 修改两个端点的注册路径：

```typescript
export default {
  openapi: {
    enabled: true,
    docsPath: "/api-docs", // 文档: http://localhost:3000/api-docs
    jsonPath: "/api/spec.json", // JSON: http://localhost:3000/api/spec.json
  },
};
```

### 反向代理路径前缀场景

当应用部署在反向代理后，需要根据代理是否**剥离前缀**分两种情况处理。

#### 情况一：代理剥离前缀（`proxy_pass` 末尾带 `/`）

```nginx
# Nginx：/admin/* → vext（剥离 /admin 前缀）
location /admin/ {
    proxy_pass http://127.0.0.1:3000/;
}
```

此时 vext 收到的请求路径已去掉 `/admin`，路由注册无需修改。但 Scalar HTML 里的 spec URL 是绝对路径（如 `/openapi.json`），浏览器会请求 `https://example.com/openapi.json`，**丢失了 `/admin` 前缀**，导致 404。

需要通过 `jsonPublicPath` 告诉 Scalar 使用带前缀的公开地址：

```typescript
// config/production.ts
export default {
  openapi: {
    enabled: true,
    // vext 内部路由保持默认
    jsonPath: "/openapi.json",
    docsPath: "/docs",
    // 告诉 Scalar HTML 用带前缀的完整路径获取 spec
    jsonPublicPath: "/admin/openapi.json",
  },
};
```

请求链路：

```
浏览器 GET /admin/docs
  → Nginx 剥离 /admin → vext GET /docs → 返回 Scalar HTML
  → Scalar 读取 jsonPublicPath，fetch /admin/openapi.json
  → Nginx 剥离 /admin → vext GET /openapi.json → 返回 spec ✅
```

#### 情况二：代理透传前缀（`proxy_pass` 末尾不带 `/`）

```nginx
# Nginx：/admin/* → vext（保留 /admin 前缀透传）
location /admin/ {
    proxy_pass http://127.0.0.1:3000;
}
```

此时 vext 收到的请求路径仍带 `/admin`，需要同步配置端点路径，无需配置 `jsonPublicPath`：

```typescript
// config/production.ts
export default {
  openapi: {
    enabled: true,
    jsonPath: "/admin/openapi.json",
    docsPath: "/admin/docs",
  },
};
```

#### 两种情况对比

|                    | 代理剥离前缀                           | 代理透传前缀                          |
| ------------------ | -------------------------------------- | ------------------------------------- |
| Nginx `proxy_pass` | `http://127.0.0.1:3000/`（末尾有 `/`） | `http://127.0.0.1:3000`（末尾无 `/`） |
| `jsonPath`         | `/openapi.json`（默认）                | `/admin/openapi.json`                 |
| `docsPath`         | `/docs`（默认）                        | `/admin/docs`                         |
| `jsonPublicPath`   | `/admin/openapi.json`（**必须配置**）  | 无需配置                              |

### `servers` — 文档交互地址

`servers` 是写入 OpenAPI 规范文档本身的元数据字段，**与端点注册路径无关**。它的唯一作用是告诉 Scalar "Try it out" 功能发请求时使用哪个基础地址。

**默认行为**（不配置时）：

```json
{ "url": "/", "description": "Current server" }
```

相对路径 `/` 会自动跟随当前页面的域名，**绝大多数情况下默认值已够用**。

**需要显式配置的场景**：

- 文档页面和 API 不在同一个域（跨域）
- 希望在 Scalar 顶部提供多环境切换下拉框

```typescript
export default {
  openapi: {
    enabled: true,
    servers: [
      { url: "https://sit-api.example.com/admin", description: "SIT 环境" },
      { url: "https://api.example.com/admin", description: "生产环境" },
    ],
  },
};
```

配置后 Scalar 顶部出现服务器下拉框，用户可手动切换目标环境。

## 导入外部 OpenAPI

Scalar 支持同时加载多个 OpenAPI 文档，在文档页面顶部显示切换器。通过 `scalar.sources` 配置：

```typescript
export default {
  openapi: {
    enabled: true,
    scalar: {
      sources: [
        // 框架自动生成的 spec 会作为第一个 source 注入（无需手动添加）
        {
          title: "Partner API",
          url: "https://partner.example.com/openapi.json",
          slug: "partner",
        },
        {
          title: "Payment API",
          url: "https://pay.example.com/v1/openapi.json",
          slug: "payment",
        },
      ],
    },
  },
};
```

每个 source 支持以下字段：

| 字段      | 类型     | 说明                                            |
| --------- | -------- | ----------------------------------------------- |
| `title`   | `string` | 文档标题（显示在切换器中）                      |
| `url`     | `string` | OpenAPI 规范 URL（远程或本地端点）              |
| `content` | `string` | OpenAPI 规范内联 JSON 字符串（与 `url` 二选一） |
| `slug`    | `string` | URL slug 标识（如 `/docs#/slug`）               |

:::tip 自动注入
当配置了 `sources` 时，框架自动生成的 `/openapi.json` 会作为第一个 source 注入（除非 sources 中已包含相同路径），无需手动重复声明。
:::

也可以通过 `content` 内联提供规范（适合小型/固定的 spec）：

```typescript
scalar: {
  sources: [
    {
      title: 'Mock API',
      content: JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Mock', version: '1.0.0' },
        paths: {},
      }),
      slug: 'mock',
    },
  ],
}
```

## 本地资产自动服务（v0.3.0+）

从 **v0.3.0** 开始，当 `openapi.enabled: true` 时，框架**强制本地服务** Scalar JS，不再依赖外部 CDN。这解决了中国大陆、内网、离线环境下白屏或加载缓慢的问题。

### 工作原理

启动时框架自动执行以下流程：

```
1. 检测 @scalar/api-reference 是否已安装
   ├─ 已安装 → 读取本地文件，注册 GET /_vext/scalar.js 路由
   └─ 未安装 → 检测包管理器（pnpm / yarn / bun / npm）→ 自动安装 → 注册路由
```

`/docs` 页面的 `<script src>` 将自动指向 `/_vext/scalar.js`（本地路由），而非 CDN 地址。

### 手动预装（推荐用于生产环境）

自动安装依赖运行时网络访问，不适合 Docker/K8s 只读容器或 CI/CD 部署。建议在构建阶段提前安装：

```bash
# npm
npm install @scalar/api-reference --no-save

# pnpm
pnpm add @scalar/api-reference

# yarn
yarn add @scalar/api-reference

# bun
bun add @scalar/api-reference
```

:::tip 生产环境最佳实践
在 `Dockerfile` 中的依赖安装步骤提前安装 `@scalar/api-reference`，避免容器启动时触发网络请求：

```dockerfile
RUN npm install && npm install @scalar/api-reference --no-save
```

:::

:::warning 安装失败
如果自动安装失败（如无网络访问权限），框架会抛出明确错误并提示手动安装命令，**不会静默降级回 CDN**。
:::

### 使用自定义地址（覆盖本地服务）

如果你有特殊需求（如内网 CDN 镜像、版本锁定），可以通过 `scalar.cdnUrl` 显式指定加载地址。配置后框架**跳过**本地检测和安装，直接使用你提供的地址：

```typescript
export default {
  openapi: {
    enabled: true,
    scalar: {
      // 锁定特定版本（此时框架不再自动安装本地包）
      cdnUrl: "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.25.0",

      // 或使用内网 CDN 镜像
      // cdnUrl: 'https://static.internal.com/libs/scalar-api-reference.js',
    },
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
docs: {
  summary: "获取用户列表";
}
docs: {
  summary: "创建订单";
}
docs: {
  summary: "上传用户头像";
}

// ❌ 不好的 summary
docs: {
  summary: "这个接口用于获取系统中所有用户的列表数据";
} // 太长
docs: {
  summary: "GET users";
} // 没有价值
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
app.get("/health", { docs: { hidden: true } }, handler);
app.get("/metrics", { docs: { hidden: true } }, handler);
app.get("/debug/config", { docs: { hidden: true } }, handler);
```

### 5. 善用 `deprecated`

API 版本迭代时，使用 `deprecated` 而非直接删除旧接口：

```typescript
// v1 接口标记废弃
app.get(
  "/v1/users",
  {
    docs: {
      summary: "获取用户列表 (v1)",
      deprecated: true,
      description: "此接口已废弃，请使用 `GET /v2/users`",
    },
  },
  handler,
);

// v2 新接口
app.get(
  "/v2/users",
  {
    docs: {
      summary: "获取用户列表",
      tags: ["用户 v2"],
    },
  },
  handler,
);
```

## 多级目录示例

VextJS 的文件路由支持多层嵌套目录，每一级目录自动映射为 URL 路径段。配合 `tags` 分组，多级路由在 Scalar 文档页面中自动归类展示。

### 目录结构

```bash
src/routes/
├── index.ts                          # → /
├── api/
│   └── v1/
│       ├── index.ts                  # → /api/v1
│       ├── users.ts                  # → /api/v1/users
│       ├── users/
│       │   └── [id]/
│       │       └── orders.ts         # → /api/v1/users/:id/orders
│       └── admin/
│           ├── dashboard.ts          # → /api/v1/admin/dashboard
│           └── users.ts              # → /api/v1/admin/users
└── webhooks/
    └── stripe.ts                     # → /webhooks/stripe
```

### 路径映射对照

| 文件路径                             | URL 前缀                   | 说明                     |
| ------------------------------------ | -------------------------- | ------------------------ |
| `routes/index.ts`                    | `/`                        | 根路由（健康检查）       |
| `routes/api/v1/index.ts`             | `/api/v1`                  | API 版本入口             |
| `routes/api/v1/users.ts`             | `/api/v1/users`            | 用户公开接口             |
| `routes/api/v1/users/[id]/orders.ts` | `/api/v1/users/:id/orders` | 用户订单（动态参数嵌套） |
| `routes/api/v1/admin/dashboard.ts`   | `/api/v1/admin/dashboard`  | 管理后台仪表盘           |
| `routes/api/v1/admin/users.ts`       | `/api/v1/admin/users`      | 管理后台用户管理         |
| `routes/webhooks/stripe.ts`          | `/webhooks/stripe`         | Stripe 回调              |

### 全局 tags 定义

在配置中预定义标签，Scalar 文档会按标签分组展示：

```typescript
// src/config/default.ts
export default {
  port: 3000,
  openapi: {
    enabled: true,
    title: "My App API",
    version: "2.0.0",
    tags: [
      { name: "v1/用户", description: "用户公开接口" },
      { name: "v1/用户订单", description: "用户关联订单" },
      { name: "v1/管理后台", description: "管理员专用接口" },
      { name: "Webhook", description: "第三方回调" },
    ],
  },
};
```

### 各路由文件

#### `routes/api/v1/users.ts` — 用户公开接口

```typescript
// src/routes/api/v1/users.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  // GET /api/v1/users → 用户列表
  app.get(
    "/",
    {
      validate: {
        query: {
          page: "number:1-",
          limit: "number:1-50",
          role: "admin|user?",
        },
      },
      docs: {
        summary: "获取用户列表",
        tags: ["v1/用户"],
      },
    },
    async (req, res) => {
      const filters = req.valid("query");
      const users = await app.services.user.findAll(filters);
      res.json(users);
    },
  );

  // GET /api/v1/users/:id → 用户详情
  app.get(
    "/:id",
    {
      validate: { param: { id: "string!" } },
      docs: {
        summary: "获取用户详情",
        tags: ["v1/用户"],
        responses: {
          200: { description: "用户信息" },
          404: { description: "用户不存在" },
        },
      },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      const user = await app.services.user.findById(id);
      if (!user) app.throw(404, "user.not_found");
      res.json(user);
    },
  );
});
```

#### `routes/api/v1/users/[id]/orders.ts` — 用户订单（多级动态参数）

```typescript
// src/routes/api/v1/users/[id]/orders.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  // GET /api/v1/users/:id/orders → 该用户的订单列表
  app.get(
    "/",
    {
      validate: {
        param: { id: "string!" },
        query: {
          status: "pending|paid|shipped|completed?",
          limit: "number:1-100",
        },
      },
      docs: {
        summary: "获取用户订单列表",
        description: "获取指定用户的所有订单，支持按状态筛选。",
        tags: ["v1/用户订单"],
        responses: {
          200: { description: "订单列表" },
          404: { description: "用户不存在" },
        },
      },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      const filters = req.valid("query");
      const orders = await app.services.order.findByUserId(id, filters);
      res.json(orders);
    },
  );

  // GET /api/v1/users/:id/orders/:orderId → 订单详情
  app.get(
    "/:orderId",
    {
      validate: {
        param: { id: "string!", orderId: "string!" },
      },
      docs: {
        summary: "获取订单详情",
        tags: ["v1/用户订单"],
      },
    },
    async (req, res) => {
      const { id, orderId } = req.valid("param");
      const order = await app.services.order.findOne(id, orderId);
      if (!order) app.throw(404, "order.not_found");
      res.json(order);
    },
  );
});
```

#### `routes/api/v1/admin/dashboard.ts` — 管理后台

```typescript
// src/routes/api/v1/admin/dashboard.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  // GET /api/v1/admin/dashboard/stats → 统计数据
  app.get(
    "/stats",
    {
      middlewares: [
        "auth",
        { name: "check-role", options: { roles: ["admin"] } },
      ],
      docs: {
        summary: "获取仪表盘统计",
        tags: ["v1/管理后台"],
        responses: {
          200: {
            description: "统计数据",
            example: {
              totalUsers: 1024,
              activeToday: 256,
              totalOrders: 8192,
              revenue: 99999.99,
            },
          },
          401: { description: "未认证" },
          403: { description: "权限不足" },
        },
      },
    },
    async (_req, res) => {
      const stats = await app.services.dashboard.getStats();
      res.json(stats);
    },
  );
});
```

#### `routes/api/v1/admin/users.ts` — 管理后台用户管理

```typescript
// src/routes/api/v1/admin/users.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  // GET /api/v1/admin/users → 管理员查看所有用户
  app.get(
    "/",
    {
      middlewares: [
        "auth",
        { name: "check-role", options: { roles: ["admin"] } },
      ],
      validate: {
        query: {
          page: "number:1-",
          limit: "number:1-100",
          status: "active|banned|suspended?",
        },
      },
      docs: {
        summary: "管理员查看用户列表",
        description: "管理员专用，支持按用户状态筛选，返回完整用户信息。",
        tags: ["v1/管理后台"],
      },
    },
    async (req, res) => {
      const filters = req.valid("query");
      const users = await app.services.user.adminFindAll(filters);
      res.json(users);
    },
  );

  // PATCH /api/v1/admin/users/:id/ban → 封禁用户
  app.patch(
    "/:id/ban",
    {
      middlewares: [
        "auth",
        { name: "check-role", options: { roles: ["admin"] } },
      ],
      validate: {
        param: { id: "string!" },
        body: { reason: "string:1-500!" },
      },
      docs: {
        summary: "封禁用户",
        tags: ["v1/管理后台"],
        responses: {
          200: { description: "封禁成功" },
          404: { description: "用户不存在" },
        },
      },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      const { reason } = req.valid("body");
      await app.services.user.ban(id, reason);
      res.json({ success: true });
    },
  );
});
```

#### `routes/webhooks/stripe.ts` — 第三方回调

```typescript
// src/routes/webhooks/stripe.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  // POST /webhooks/stripe → Stripe 事件回调
  app.post(
    "/",
    {
      validate: {
        header: { "stripe-signature": "string!" },
      },
      docs: {
        summary: "Stripe Webhook 回调",
        tags: ["Webhook"],
        description: "接收 Stripe 支付事件通知。需要验证签名。",
        responses: {
          200: { description: "处理成功" },
          400: { description: "签名验证失败" },
        },
      },
    },
    async (req, res) => {
      const signature = req.valid("header")["stripe-signature"];
      await app.services.payment.handleStripeWebhook(req.body, signature);
      res.json({ received: true });
    },
  );
});
```

### 生成的 OpenAPI 路径

以上目录结构最终自动生成以下 OpenAPI 路径，在 Scalar 文档中按 tags 分组展示：

| OpenAPI 路径                          | 方法  | Tag         | 来源文件                      |
| ------------------------------------- | ----- | ----------- | ----------------------------- |
| `/api/v1/users`                       | GET   | v1/用户     | `api/v1/users.ts`             |
| `/api/v1/users/{id}`                  | GET   | v1/用户     | `api/v1/users.ts`             |
| `/api/v1/users/{id}/orders`           | GET   | v1/用户订单 | `api/v1/users/[id]/orders.ts` |
| `/api/v1/users/{id}/orders/{orderId}` | GET   | v1/用户订单 | `api/v1/users/[id]/orders.ts` |
| `/api/v1/admin/dashboard/stats`       | GET   | v1/管理后台 | `api/v1/admin/dashboard.ts`   |
| `/api/v1/admin/users`                 | GET   | v1/管理后台 | `api/v1/admin/users.ts`       |
| `/api/v1/admin/users/{id}/ban`        | PATCH | v1/管理后台 | `api/v1/admin/users.ts`       |
| `/webhooks/stripe`                    | POST  | Webhook     | `webhooks/stripe.ts`          |

:::tip 多级目录最佳实践

- **用目录层级表达 URL 结构**：`api/v1/admin/` 自动映射为 `/api/v1/admin/` 前缀，无需手动拼接
- **动态参数用 `[param]` 目录**：`users/[id]/orders.ts` 自动变为 `/users/:id/orders`，文件内的 `param` 校验会出现在 OpenAPI 文档中
- **tags 统一管理**：在全局配置中预定义 tags，各路由文件通过 `docs.tags` 引用，Scalar 文档按标签分组
- **文件名即路由**：无需 `app.group()` 或手动注册路由前缀，目录结构就是路由结构
  :::

## 标签分组（x-tagGroups）

OpenAPI 3.x 规范的 `tags` 是**一维扁平列表**，不原生支持嵌套层级。当路由数量较多时，所有 tags 在 Scalar 文档侧边栏中平铺并列，不便于导航。

VextJS 通过 [Scalar 支持的 `x-tagGroups` 扩展](https://github.com/scalar/scalar) 实现**两级导航**：将多个 tags 归入更高级别的分组（group），在 Scalar 侧边栏中展示为可折叠的分组层级。

### 自动推断（默认行为）

当路由文件分布在多个顶层目录时，框架**自动推断** `x-tagGroups`：

- 提取每条路由文件在 `routes/` 之后的**第一层目录名**作为分组名（首字母大写）
- 直接位于 `routes/` 下的文件归入 **"General"** 分组
- 如果所有路由都在同一个分组中，则不生成 `x-tagGroups`（避免冗余）

```
src/routes/
├── health.ts              → 分组: General
├── api/
│   ├── users.ts           → 分组: Api
│   └── orders.ts          → 分组: Api
├── admin/
│   ├── dashboard.ts       → 分组: Admin
│   └── users.ts           → 分组: Admin
└── webhooks/
    └── stripe.ts          → 分组: Webhooks
```

生成的 `x-tagGroups`：

```json
{
  "x-tagGroups": [
    { "name": "Admin", "tags": ["admin-dashboard", "admin-users"] },
    { "name": "Api", "tags": ["api-orders", "api-users"] },
    { "name": "Webhooks", "tags": ["webhooks-stripe"] },
    { "name": "General", "tags": ["health"] }
  ]
}
```

:::tip
分组按字母排序，**General 始终排在最后**。同一分组内的 tags 也按字母排序且自动去重。
:::

### 手动配置（覆盖自动推断）

如果自动推断的分组不满足需求，可以在配置中显式指定 `tagGroups`：

```typescript
// src/config/app.ts
export default {
  port: 3000,
  openapi: {
    enabled: true,
    title: "My API",
    version: "1.0.0",

    // 手动配置标签分组
    tagGroups: [
      {
        name: "User API",
        tags: ["users", "user-profile", "user-orders"],
      },
      {
        name: "Administration",
        tags: ["admin-dashboard", "admin-users"],
      },
      {
        name: "Integration",
        tags: ["webhooks"],
      },
    ],

    // tags 定义（可选，提供描述信息）
    tags: [
      { name: "users", description: "用户公开接口" },
      { name: "user-profile", description: "用户个人资料" },
      { name: "user-orders", description: "用户订单" },
      { name: "admin-dashboard", description: "管理后台仪表盘" },
      { name: "admin-users", description: "管理后台用户管理" },
      { name: "webhooks", description: "第三方回调" },
    ],
  },
};
```

:::warning
配置了 `tagGroups` 后，框架**不再自动推断**，直接使用用户配置。请确保所有 tags 都被覆盖到至少一个分组中，否则未分组的 tags 在 Scalar 中可能不显示。
:::

### 效果对比

|                      无 x-tagGroups                      |                       有 x-tagGroups                       |
| :------------------------------------------------------: | :--------------------------------------------------------: |
|                  所有 tags 平铺在侧边栏                  |                    tags 按分组折叠展示                     |
| `users` / `admin-dashboard` / `orders` / `webhooks` 并列 | **User API** ▸ users, orders / **Admin** ▸ admin-dashboard |
|                       适合少量路由                       |                   适合路由数量较多的项目                   |

### 与热重载的兼容性

在 dev 模式下，热重载（soft reload）会**自动重新生成** `x-tagGroups`：

1. 路由文件变更 → 触发热重载
2. 创建新的 adapter 实例
3. 重新加载路由 + 收集路由元信息
4. 重新生成 OpenAPI spec（含 `x-tagGroups`）
5. 在新 adapter 上重新注册 `/docs` 和 `/openapi.json` 端点

无需重启 dev server，刷新文档页面即可看到更新后的分组。

## 完整示例

```typescript
// src/routes/orders.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  // 获取订单列表
  app.get(
    "/",
    {
      validate: {
        query: {
          page: "number:1-",
          limit: "number:1-50",
          status: "pending|paid|shipped|completed|cancelled",
          startDate: "date?",
          endDate: "date?",
        },
      },
      middlewares: ["auth"],
      docs: {
        summary: "获取订单列表",
        description: "分页获取当前用户的订单列表，支持按状态和日期范围筛选。",
        tags: ["订单"],
        responses: {
          200: {
            description: "订单列表",
            headers: {
              "X-Total-Count": {
                description: "总订单数",
                schema: { type: "integer" },
              },
            },
          },
        },
      },
    },
    async (req, res) => {
      const filters = req.valid("query");
      const orders = await app.services.order.findAll(filters);
      res.json(orders);
    },
  );

  // 创建订单
  app.post(
    "/",
    {
      validate: {
        body: {
          productId: "string!",
          quantity: "number:1-99!",
          shippingAddress: "string:1-200!",
          couponCode: "string?",
        },
      },
      middlewares: ["auth"],
      docs: {
        summary: "创建订单",
        tags: ["订单"],
        responses: {
          201: {
            description: "订单创建成功",
            example: {
              orderId: "ord_abc123",
              status: "pending",
              total: 99.99,
            },
          },
          400: { description: "库存不足或优惠券无效" },
          401: { description: "未认证" },
        },
      },
    },
    async (req, res) => {
      const data = req.valid("body");
      const order = await app.services.order.create(data);
      res.json(order, 201);
    },
  );

  // 取消订单
  app.post(
    "/:id/cancel",
    {
      validate: {
        param: { id: "string!" },
        body: { reason: "string:1-500?" },
      },
      middlewares: ["auth"],
      docs: {
        summary: "取消订单",
        tags: ["订单"],
        responses: {
          200: { description: "取消成功" },
          400: { description: "订单状态不允许取消" },
          404: { description: "订单不存在" },
        },
      },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      const { reason } = req.valid("body");
      await app.services.order.cancel(id, reason);
      res.json({ success: true });
    },
  );
});
```

## 下一步

- 了解 [参数校验](/guide/validation) 的 DSL 语法如何映射到 OpenAPI
- 学习 [配置](/guide/configuration) 中 OpenAPI 的完整选项
- 查看 [Adapter 架构](/guide/adapters) 了解不同 Adapter 下的文档行为
- 探索 [测试](/guide/testing) 如何验证 API 文档的准确性
