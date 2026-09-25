# 参数校验

VextJS 集成 schema-dsl，提供**声明式参数校验**。在路由 `options.validate` 中用 DSL 字符串或受支持的字段 Schema 描述规则，框架完成校验和类型转换；启用 OpenAPI 时再将这些规则投影到文档。参数校验不包含认证、授权或数据库唯一性保证。

## 基本用法

前置条件：已按 [快速开始](/zh/guide/quick-start) 建立 TypeScript 项目，包含 dev/build/start scripts。下面是独立 API 示例的配置和路由；已有项目可按需合并。本例直接返回校验结果，观察转换和错误，不依赖额外业务服务。

```typescript
// src/config/default.ts
import type { VextUserConfig } from "vextjs";

export default {
  port: 3000,
  host: "127.0.0.1",
  adapter: "native",
  frontend: { enabled: false },
} satisfies VextUserConfig;
```

在路由的三段式定义中，通过 `validate` 字段声明校验规则：

```typescript
// src/routes/validation.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.post(
    "/users",
    {
      validate: {
        body: {
          name: "string:1-50!", // 必填字符串，长度 1-50
          email: "email!", // 必填，邮箱格式
          age: "number?", // 可选数字
          role: "admin|user", // 枚举值
        },
      },
      docs: { summary: "创建用户" },
    },
    async (req, res) => {
      // 从独立的校验结果入口读取，而不是假定 req.body 被改写。
      const data = req.valid("body");
      res.json(data, 201);
    },
  );
  app.get(
    "/items/:id",
    {
      validate: {
        param: { id: "integer:1-!" },
        query: { active: "boolean?" },
      },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      const { active } = req.valid("query");
      res.json({ id, active });
    },
  );
});
```

运行 `npm run dev`，看到 ready 和监听地址后，在另一终端执行：

```bash
curl -i -H "Content-Type: application/json" -d '{"name":"Bob","email":"bob@example.com","age":"42","role":"user"}' http://127.0.0.1:3000/validation/users
curl -i -H "Content-Type: application/json" -d '{"name":"Bob","email":"invalid"}' http://127.0.0.1:3000/validation/users
curl -i "http://127.0.0.1:3000/validation/items/42?active=true"
curl -i "http://127.0.0.1:3000/validation/items/nope?active=1"
curl -i "http://127.0.0.1:3000/validation/items/42?active=1"
```

预期依次为201（`data.age` 是数字42）、422（email错误）、200（`data.id` 是数字42且active为true）、400（param先失败）、422（字符串1不满足boolean）。合法JSON不等于字段合法；破损JSON通常先被body parser以400拒绝。

Windows PowerShell 的 GET 使用 `curl.exe`；JSON 提交可用以下命令，避免 shell 引号影响请求体：

```powershell
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3000/validation/users' -ContentType 'application/json' -Body '{"name":"Bob","email":"bob@example.com","age":"42","role":"user"}'
```

Ctrl+C 结束开发服务，执行 `npm run build` 和 `npm start` 后重复请求，确认构建与运行时行为一致。端口被占用时，修改本例配置及请求地址，或先结束自己的旧示例进程。

后续无文件头的代码用于展示独立路由片段；其中的 `handler`、业务service和认证中间件需要由应用提供，不应将所有片段原样注册到同一应用。

校验通过后，通过 `req.valid(location)` 获取类型转换后的数据。`param`（路径参数）非法时自动返回 HTTP `400`；`query`、`header`、`cookie` 或 `body` 非法时自动返回 HTTP `422`，无需 handler 手动处理。

## 校验位置

`validate` 支持五个位置，对应请求的不同数据来源：

| 位置     | 数据来源      | 说明                         |
| -------- | ------------- | ---------------------------- |
| `param`  | `req.params`  | 路径动态参数（如 `/:id`）    |
| `query`  | `req.query`   | URL 查询参数（如 `?page=1`） |
| `header` | `req.headers` | 请求头                       |
| `cookie` | `req.cookies` | 已解析的 Cookie 值           |
| `body`   | `req.body`    | 请求体（JSON / URL-encoded） |

校验按 `param` → `query` → `header` → `cookie` → `body` 的顺序执行，任一位置校验失败会立即返回错误。

规则在路由注册时预编译，请求到来后复用校验函数。请求头字段请使用小写名称；`req.valid("header")` 只返回已声明字段，并使用小写键。Cookie 来自请求头解析，校验 Cookie 字符串本身不会验证其签名或建立登录会话。

```typescript
app.put(
  "/users/:id",
  {
    validate: {
      param: {
        id: "string!",
      },
      query: {
        fields: "string?", // 可选，指定返回字段
      },
      header: {
        "x-api-version": "string?",
      },
      cookie: {
        sid: "string?",
      },
      body: {
        name: "string:1-50?",
        email: "email?",
      },
    },
  },
  async (req, res) => {
    const { id } = req.valid("param");
    const cookies = req.valid("cookie");
    const body = req.valid("body");
    const user = await app.services.user.update(id, body);
    res.json(user);
  },
);
```

::::tip 注意
`validate` 中使用单数 `param`（与路径参数概念对应），但底层数据源是 `req.params`（复数）。框架内部已做正确映射，你无需关心。

如果动态路径使用了 `:id` 或 `*path`，但没有声明 `validate.param`，OpenAPI 仍会为该路径段生成 `required: true` 的 string path parameter，保证路径模板合法。需要更精确的类型、长度或格式约束时，请显式声明 `validate.param`。
::::

## DSL 语法详解

schema-dsl 使用简洁的字符串表达式描述数据类型和约束。

### 基本类型

| DSL 表达式  | 含义       | 示例值                  |
| ----------- | ---------- | ----------------------- |
| `'string'`  | 字符串     | `"hello"`               |
| `'number'`  | 数字       | `42`、`3.14`            |
| `'integer'` | 整数       | `1`、`42`               |
| `'boolean'` | 布尔值     | `true`、`false`         |
| `'email'`   | 邮箱格式   | `"user@example.com"`    |
| `'url'`     | URL 格式   | `"https://example.com"` |
| `'date'`    | 日期字符串 | `"2026-01-15"`          |

### 必填与可选

在类型表达式末尾添加 `!` 或 `?` 标记：

| 后缀   | 含义             | 示例                            |
| ------ | ---------------- | ------------------------------- |
| `!`    | 必填（required） | `'string!'` — 必填字符串        |
| `?`    | 可选（optional） | `'string?'` — 可选字符串        |
| 无后缀 | 可选（默认）     | `'string'` — 等同于 `'string?'` |

```typescript
validate: {
  body: {
    name: 'string!',     // 必填
    nickname: 'string?', // 可选
    bio: 'string',       // 可选（等同于 'string?'）
  },
}
```

`!` 只要求字段存在，不等于非空：`"string!"` 接受空字符串，需非空时写 `"string:1-!"`。`?` 允许缺省，不表示接受 `null`；显式可空见下文 JSON Schema。可选字段不会自动得到业务默认值，分页等默认值要在 handler 中明确提供，或使用支持的 Schema `default`。

### 范围约束

使用 `:min-max` 语法指定范围：

#### 字符串长度

```typescript
"string:1-50"; // 长度 1 到 50
"string:1-50!"; // 必填，长度 1 到 50
"string:5-"; // 最小长度 5，无上限
"string:-100"; // 最大长度 100
```

#### 数字范围

```typescript
"number:1-100"; // 值范围 1 到 100
"number:0-"; // 最小值 0（非负数）
"number:1-"; // 最小值 1，仍允许小数
"integer:1-"; // 最小值 1，要求整数
"number:-999"; // 最大值 999
"number:18-120!"; // 必填，范围 18 到 120
```

### 枚举值

使用 `|` 分隔枚举选项：

```typescript
"admin|user|guest"; // 枚举：admin / user / guest
"draft|published|archived"; // 枚举：draft / published / archived
"male|female|other"; // 枚举：male / female / other
```

上述裸 `|` 简写表示字符串枚举，在 OpenAPI 中映射为 `enum`。数字枚举使用明确的 `enum:number:1|2|3` 等定义；不要把数字与字符串枚举混为一谈。

### 组合示例

```typescript
validate: {
  body: {
    // 基本类型 + 必填/可选
    username: 'string:3-30!',      // 必填字符串，长度 3-30
    password: 'string:8-128!',     // 必填字符串，长度 8-128
    email: 'email!',               // 必填邮箱
    website: 'url?',               // 可选 URL
    age: 'number:0-150?',          // 可选数字，范围 0-150
    score: 'number:0-100',         // 可选数字，范围 0-100
    active: 'boolean!',            // 必填布尔值
    role: 'admin|editor|viewer',   // 枚举
    birthday: 'date?',             // 可选日期
  },
}
```

## 字段级 JSON Schema 与文档一致性

请求位置是字段表，可以将单个字段写为 JSON Schema。下面的完整路由同时演示必填数组、显式可空和默认值：

```typescript
// src/routes/shapes.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.post(
    "/",
    {
      validate: {
        body: {
          "label!": { type: "string", minLength: 2, maxLength: 20 },
          "tags!": { type: "array", minItems: 1, items: { type: "string" } },
          note: { type: ["string", "null"] },
          limit: { type: "integer", minimum: 1, default: 20 },
        },
      },
    },
    async (req, res) => {
      res.json(req.valid("body"));
    },
  );
});
```

向 `/shapes` POST `{"label":"ok","tags":["guide"],"note":null}`，预期 200，`data.limit` 为 20；label 缺失或只有一个字符、tags 为空数组时返回 422。这里 `"label!"` / `"tags!"` 在字段名上声明必填；`required: ["field"]` 则用于 JSON Schema object 节点，列出必填子字段。简单字符串数组也可使用 `array<string>` DSL；不要使用 `["string"]` 作为数组简写。

字段级裸 `type` / `enum` 按运行编译器解释，OpenAPI 与 typed client 也基于这些字段事实投影。根字段表可以有名为 type 的业务字段；嵌套对象需要同名字段时，显式写为 `{ metadata: { type: { type: "string" }, label: "string!" } }`，避免 `metadata.type: "string"` 被当作整个 metadata 的原生 schema 类型。

`?` 只表示可缺省，不会自动生成 `nullable: true`。显式允许 null 可用 `types:string|null` 或上例的 `{ type: ["string", "null"] }`。运行校验、TypeScript 推导与静态投影是三个需要分别核对的环节，不能仅凭一项成功推断其他环节均支持。

## 类型转换

默认校验引擎会执行受支持的类型转换，尤其适合 URL 中的字符串参数。下表以当前依赖为准；自定义 validator 可以有不同语义：

| 声明类型    | 原始值    | 转换后   |
| ----------- | --------- | -------- |
| `'number'`  | `"42"`    | `42`     |
| `'number'`  | `"3.14"`  | `3.14`   |
| `'boolean'` | `"true"`  | `true`   |
| `'boolean'` | `"false"` | `false`  |
| `'boolean'` | `"1"`     | 校验失败 |
| `'boolean'` | `"0"`     | 校验失败 |

```typescript
app.get(
  "/search",
  {
    validate: {
      query: {
        page: "number:1-", // ?page=3 → number 3（非字符串 "3"）
        limit: "number:1-100", // ?limit=20 → number 20
        active: "boolean", // ?active=true → boolean true
      },
    },
  },
  async (req, res) => {
    const { page, limit, active } = req.valid("query");
    // 已提供的值转换为 number / boolean；可选字段未传时仍可能为 undefined。
    res.json({ page, limit, active });
  },
);
```

## 获取校验后数据

### `req.valid(location)`

使用 `req.valid()` 获取经过校验和类型转换后的数据。只有配置对应位置并通过校验后才有结果；未声明的位置返回 `undefined`，详见下面的边界行为。

```typescript
app.post(
  "/orders",
  {
    validate: {
      body: {
        productId: "string!",
        quantity: "number:1-99!",
      },
      query: {
        coupon: "string?",
      },
    },
  },
  async (req, res) => {
    const body = req.valid("body"); // { productId: string, quantity: number }
    const query = req.valid("query"); // { coupon?: string }

    const order = await app.services.order.create(body, query.coupon);
    res.json(order, 201);
  },
);
```

### 边界行为

::::warning 注意事项

`req.valid(location)` 有以下边界行为需要了解：

1. **未配置 `validate` 时调用**

   如果路由未配置 `validate` 字段，调用 `req.valid("body")` 将返回 `undefined`。框架不会抛出错误，但你将无法获取经过校验和类型转换的数据。

2. **location 未在 `validate` 中声明**

   如果 `validate` 中只声明了 `body`，但调用了 `req.valid("query")`，同样返回 `undefined`。只有在 `validate` 中明确声明过的位置才会有校验后的数据。

3. **校验失败时不会到达 handler**

   handler 执行前，非法路径 `param` 返回 HTTP `400`，非法 `query`、`header`、`cookie` 或 `body` 返回 HTTP `422`；因此 handler 内通过 `req.valid()` 读取的数据已经通过校验。

4. **通过校验不等于只保留声明字段**

   默认引擎会保留未声明字段，例如 `{ name: "string!" }` 校验 `{ name: "Alice", extra: 42 }` 后仍有 extra。header 位置另有上述字段投影。业务写入应显式选择允许的字段；替换引擎时也要核对未知字段是保留、移除还是拒绝。

```typescript
// 边界情况示例
app.get(
  "/items",
  {
    validate: {
      query: { page: "number:1-" },
      // 未声明 body
    },
  },
  async (req, res) => {
    const query = req.valid("query"); // { page?: number }，已校验
    const body = req.valid("body"); // undefined，未在 validate 中声明
    const param = req.valid("param"); // undefined，未在 validate 中声明
    res.json({ query });
  },
);

// 未配置 validate 的路由
app.get("/health", {}, async (req, res) => {
  const body = req.valid("body"); // undefined，路由未配置 validate
  res.json({ status: "ok" });
});
```

**最佳实践**：始终确保 `req.valid(location)` 的 `location` 与 `validate` 中声明的位置一致。
::::

### 路由 Schema 自动类型推导

handler 会从同一个 `validate` 对象获得上下文类型，无需再把契约重复写成 TypeScript 接口：

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
  async (req, res) => {
    const data = req.valid("body");
    // data.name  — string
    // data.email — string
    // data.age   — number | undefined
    res.json(await app.services.user.create(data));
  },
);
```

自动推导覆盖 DSL 字符串、必填/可选标记、嵌套对象及可识别的字段级JSON Schema。抽出 Schema 到变量时应保留字面量类型（例如 `as const`），否则宽化为普通 string 后无法恢复具体字段类型。类型层能描述的结构不保证运行编译器和静态投影都支持：当前不要用 `["string"]` 或 `[{ code: "string!" }]` 作为数组简写；请使用显式 `{ type: "array", items: ... }` 或当前支持的数组DSL。
`schemaAdapter.compileField()` 返回的链式 builder 会诚实地推导为 `unknown`，因为其后续动态修改无法从静态类型恢复。
对于动态或外部提供的 Schema，仍可用 `req.valid<ExternalBody>("body")` 作为显式覆盖；它会覆盖自动推导，因此应用必须自行保证该类型与运行时契约一致。

## 校验错误响应

所有校验失败使用同一结构化错误形状：路径 `param` 非法时 HTTP/code 为 `400`，`query`、`header`、`cookie` 或 `body` 非法时 HTTP/code 为 `422`。下面是一个 `422` 示例：

```json
{
  "code": 422,
  "message": "Validation failed",
  "errors": [
    {
      "field": "email",
      "message": "must be a valid email address"
    },
    {
      "field": "name",
      "message": "length must be between 1 and 50"
    }
  ],
  "requestId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

- `code`：此例为422；路径param错误为400
- `message`：默认路由校验失败为 `"Validation failed"`
- `errors`：字段级错误数组，包含 `field`（字段名）和 `message`（错误描述）
- `requestId`：当前请求的唯一标识

校验错误由框架全局错误处理器统一处理，你不需要在路由中手动 try-catch。

上面的字段错误文字是形状示意，实际描述取决于校验引擎与语言配置；自定义错误处理也可能改变响应。不要把示例英文句子当成稳定业务错误码。

## 与 OpenAPI 文档的联动

OpenAPI 默认关闭。要查看本页示例的投影，在前面的配置对象中加入 `openapi: { enabled: true }` 并重启服务。支持的 `validate` 规则会投影为 `parameters` 和 `requestBody`；业务含义、权限与响应合同仍需单独表达：

```typescript
app.get(
  "/users",
  {
    validate: {
      query: {
        page: "number:1-",
        limit: "number:1-100",
        status: "active|inactive|banned",
      },
    },
    docs: { summary: "获取用户列表" },
  },
  handler,
);
```

上面的路由会在 OpenAPI 文档中自动生成：

- `page` — query parameter, type: number, minimum: 1
- `limit` — query parameter, type: number, minimum: 1, maximum: 100
- `status` — query parameter, type: string, enum: ["active", "inactive", "banned"]

启用后，默认可访问 `/docs` 查看页面、`/openapi.json` 查看原始文档；实际地址及开关见[OpenAPI指南](/zh/guide/openapi)。若分页只接受整数，应将上例number改为integer，再验证小数输入被拒绝。

如果希望 OpenAPI 文档展示字段的业务含义，请使用显式、无全局副作用的 builder。Vext 不再安装全局 String `.description()` 方法：

```typescript
// src/routes/translate.ts
import { defineRoutes, schemaAdapter } from "vextjs";

export default defineRoutes((app) => {
  app.post(
    "/",
    {
      validate: {
        body: {
          content: schemaAdapter
            .compileField("string:1-20000!")
            .description("待翻译文本，长度 1-20000 个字符"),
          targetLanguages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                code: {
                  type: "string",
                  minLength: 1,
                  maxLength: 64,
                  description: "目标语言代码",
                },
              },
              required: ["code"],
            },
          },
          format: schemaAdapter
            .compileField("enum:plain_text,preserve_line_breaks")
            .description("输出格式"),
        },
      },
      docs: { summary: "验证翻译请求合同" },
    },
    async (req, res) => {
      res.json(req.valid("body"));
    },
  );
});
```

此路由仅回显校验结果，不调用翻译服务。可向 `/translate` 提交包含content和targetLanguages的JSON，检查description投影及嵌套code约束。

生成的 OpenAPI schema 会保留这些 description，同时保留 `required`、`enum`、`minLength`、`maxLength` 等约束。字符串 DSL 未手写 description 时，转换器会生成兜底描述；裸 JSON Schema 字段不保证自动补充业务说明，需按需要显式填写。

构建期投影只识别从 `vextjs` named import 的 `schemaAdapter`（允许 alias）。有限
builder 语法为 `compileField(<静态字符串>)`，可追加最多一次
`.description(<静态字符串>)`；完整 builder 可保存为同文件无歧义 `const`，也可沿可分析的源码绑定解析。动态参数、
其他 chain、无法解析的导入与不透明 Zod/Yup 对象会携带 route 上下文失败；不能把所有import都当成不支持。

`?` 只表示字段可缺省，不会生成 `nullable: true`。需要显式允许 `null` 时，
使用 `types:string|null` 或 raw `{ type: ["string", "null"] }`。

## 高级用法

### 多位置组合校验

同一路由可以同时校验多个位置：

```typescript
app.put(
  "/users/:id/avatar",
  {
    validate: {
      param: { id: "string!" },
      header: { "content-type": "string!" },
      query: { size: "number:32-512?" },
      body: { url: "url!", alt: "string:0-200?" },
    },
  },
  async (req, res) => {
    const { id } = req.valid("param");
    const { url, alt } = req.valid("body");
    const { size } = req.valid("query");

    await app.services.user.updateAvatar(id, { url, alt, size });
    res.json({ success: true });
  },
);
```

### 与路由级中间件配合

校验中间件在路由级中间件之后、handler 之前执行。这意味着：

```
请求 → [全局中间件] → [路由级中间件: auth, check-role] → [validate 校验] → [handler]
```

认证中间件或Guard拒绝请求时不会到达后续Schema校验；仅配置身份提取而未要求认证，则不能保证匿名被拒绝。响应缓存命中或前置中间件短路也会跳过Schema校验和handler。下例假定auth/check-role已完整实现并注册：

```typescript
app.post(
  "/admin/users",
  {
    middlewares: [
      "auth",
      { name: "check-role", options: { roles: ["admin"] } },
    ],
    validate: {
      body: {
        name: "string:1-50!",
        email: "email!",
        role: "admin|editor|viewer!",
      },
    },
  },
  handler,
);
```

### 路由覆盖限流规则

除了参数校验，`options` 还支持路由级配置覆盖（`override`），可以为特定路由调整限流、超时等设置：

限流须先全局启用；路由覆盖不会自行注册全局限流，默认IP键也不会自动按路径隔离额度。完整验证流程见[请求限流](/zh/guide/rate-limit)。

```typescript
app.post(
  "/login",
  {
    validate: {
      body: {
        email: "email!",
        password: "string:8-128!",
      },
    },
    override: {
      rateLimit: { max: 5, window: 60 }, // 每分钟最多 5 次（window 单位：秒）
    },
  },
  handler,
);

app.get(
  "/public/health",
  {
    override: {
      rateLimit: false, // 健康检查不限流
    },
  },
  handler,
);
```

## 在服务层复用校验引擎

路由入口参数优先使用 `RouteOptions.validate` + `req.valid()`。如果 service 还需要校验非 HTTP 输入，例如定时任务、消息队列、外部回调或内部 DTO，可以通过 `this.app.getValidator()` 获取当前全局校验引擎。

`getValidator()` 返回当前的同步 `VextValidator`：默认由schema-dsl实现。替换引擎需要实现适配器并在路由注册、服务编译Schema之前完成；已保存的编译函数不会随之后的setValidator自动更新。

使用 `VextValidationError` 可以保留结构化字段错误。当异常传播回HTTP错误处理器时，默认返回422和errors；直接由Job或其他调用者执行时得到的是异常，由该调用者处理。普通Error在HTTP链中会进入未知异常500路径。

```typescript
import { VextValidationError, type VextApp, type VextValidator } from "vextjs";

const createUserSchema = {
  name: "string:1-50!",
  email: "email!",
};

export default class UserService {
  private validateCreateUser: ReturnType<VextValidator["compile"]>;

  constructor(private app: VextApp) {
    const validator = app.getValidator();
    this.validateCreateUser = validator.compile(createUserSchema);
  }

  async create(input: unknown) {
    const result = this.validateCreateUser(input);

    if (!result.valid) {
      throw new VextValidationError(result.errors ?? []);
    }

    const data = result.data as { name: string; email: string };
    // 继续执行业务逻辑...
    return data;
  }
}
```

::::tip

需要统一校验行为时使用 `app.getValidator()`；直接调用独立schema库会绕过框架替换能力。如确有独立引擎需求，需明确语法、转换与错误合同差异。

::::

## 替换校验引擎

VextJS 默认使用 schema-dsl 作为校验引擎。如果你更喜欢 Zod、Yup 等第三方校验库，可以通过插件替换内置校验引擎。

### 使用 Zod 示例

这是应用适配器示例，先执行 `npm install zod`，以下按 Zod 4 公开类型编写。只翻译列出的字符串子集，遇到其他字段时整个 Schema 回退到原引擎，不会丢掉未识别字段。`z.looseObject()` 保留未声明字段，见 [Zod 官方对象文档](https://zod.dev/api#zlooseobject)。两种引擎的格式校验、类型转换和错误文字仍可能不同；同步 `VextValidator` 也不接受需要异步解析的 refinement/transform。

```typescript
// src/plugins/zod-validator.ts
import { definePlugin } from "vextjs";
import type { VextValidator } from "vextjs";
import { z } from "zod";

export default definePlugin({
  name: "zod-validator",

  setup(app) {
    const originalValidator = app.getValidator();

    // 把 Vext 可序列化的路由 schema 翻译到所选引擎。
    // 这个应用级示例有意只支持一个小型子集。
    const toZodField = (definition: unknown): z.ZodType | null => {
      if (definition === "string!") return z.string();
      if (definition === "string:1-50!") return z.string().min(1).max(50);
      if (definition === "email!") return z.string().email();
      if (definition === "string?") return z.string().optional();
      return null;
    };

    const zodValidator: VextValidator = {
      compile(schema) {
        const toVextResult = (result: ReturnType<z.ZodType["safeParse"]>) =>
          result.success
            ? { valid: true, data: result.data }
            : {
                valid: false,
                errors: result.error.issues.map((issue) => ({
                  field: issue.path.join("."),
                  message: issue.message,
                })),
              };

        const zodShape: Record<string, z.ZodType> = {};
        for (const [key, definition] of Object.entries(schema)) {
          const field = toZodField(definition);
          if (!field) return originalValidator.compile(schema);
          zodShape[key] = field;
        }
        const zodSchema = z.looseObject(zodShape);
        return (data) => toVextResult(zodSchema.safeParse(data));
      },
    };

    app.setValidator(zodValidator);
    app.logger.info("Zod validator plugin activated");
  },
});
```

`app.setValidator()` 替换的是运行时编译引擎，不会扩展 `RouteOptions.validate` 的公开类型，也不会改变静态 route-source 语法。路由声明
仍必须使用可序列化的 Vext schema（DSL 字符串、嵌套字面量或 canonical
`schemaAdapter` builder），由 adapter 在内部翻译到 Zod/Yup。不要把不透明的第三方
schema 实例放入 `RouteOptions.validate`。build、Doctor、OpenAPI 与 client contract
需要可静态解释的路由合同，不能依赖运行插件 setup 才能解释 Schema。

安装并启用上面的插件后，可新增一个只使用该子集的路由验证替换行为：

```typescript
// src/routes/zod-check.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.post(
    "/",
    { validate: { body: { name: "string!", email: "email!" } } },
    async (req, res) => {
      res.json(req.valid("body"));
    },
  );
});
```

向 `/zod-check` POST `{"name":"","email":"alice@example.com","extra":42}` 应返回 200，并保留空 name 和 extra；省略 name 或提供非法 email 返回 422。基础例中的数字/布尔规则不在本适配器子集中，仍应走原引擎并保持相应转换。再运行 build 和生产入口，确认路由投影及HTTP请求均通过；两个校验器只比较已承诺的子集，不能据此认定全部行为等价。

## 常见模式

### 分页查询

```typescript
app.get(
  "/posts",
  {
    validate: {
      query: {
        page: "integer:1-",
        limit: "integer:1-100",
        sort: "createdAt|updatedAt|title",
        order: "asc|desc",
      },
    },
  },
  async (req, res) => {
    const {
      page = 1,
      limit = 20,
      sort = "createdAt",
      order = "desc",
    } = req.valid("query");
    const posts = await app.services.post.findAll({ page, limit, sort, order });
    res.json(posts);
  },
);
```

### 搜索过滤

```typescript
app.get(
  "/products",
  {
    validate: {
      query: {
        keyword: "string?",
        category: "string?",
        minPrice: "number:0-?",
        maxPrice: "number:0-?",
        inStock: "boolean?",
      },
    },
  },
  async (req, res) => {
    const filters = req.valid("query");
    const products = await app.services.product.search(filters);
    res.json(products);
  },
);
```

### 用户注册

```typescript
app.post(
  "/auth/register",
  {
    validate: {
      body: {
        username: "string:3-30!",
        email: "email!",
        password: "string:8-128!",
        confirmPassword: "string:8-128!",
      },
    },
    override: {
      rateLimit: { max: 3, window: 60 }, // 单位：秒
    },
  },
  async (req, res) => {
    const data = req.valid("body");

    if (data.password !== data.confirmPassword) {
      app.throw(400, "两次密码不一致");
    }

    const user = await app.services.auth.register(data);
    res.json(user, 201);
  },
);
```

### 文件路径参数

下面是文件路由 `src/routes/files/[id].ts` 的 `defineRoutes` 回调内片段，依赖应用提供的 file 服务（返回 stream、name、contentType、metadata）。文件前缀形成 `/files/:id`，与参数校验共同使用：

```typescript
app.get(
  "/",
  {
    validate: {
      param: { id: "string!" },
      query: { download: "boolean?" },
    },
  },
  async (req, res) => {
    const { id } = req.valid("param");
    const { download } = req.valid("query");

    const file = await app.services.file.findById(id);
    if (!file) return app.throw(404, "file.not_found");

    if (download) {
      res.download(file.stream, file.name, file.contentType);
    } else {
      res.json(file.metadata);
    }
  },
);
```

## 最佳实践

### 1. 始终使用 `req.valid()` 而非 `req.body`

配置了 `validate` 的路由，应使用 `req.valid('body')` 而非直接访问 `req.body`：

```typescript
// ✅ 正确 — 使用校验后的数据
const data = req.valid("body");

// 不应作为校验结果入口
const data = req.body;
```

`req.valid()` 是框架存储校验器 `result.data` 的入口。框架不会主动把结果赋回 `req.body` / `req.query`；具体校验器是否原地修改输入属于引擎行为，不能依赖两份对象必定相同或必定不同。

### 2. 合理使用必填标记

必填由接口需求决定，不由参数位置决定。例如分页 query 可以提供默认值后设为可选，创建资源的核心字段应设为必填；约定必须传入的 header 同样应标记必填：

```typescript
validate: {
  query: {
    page: 'number:1-',       // 可选；handler 需自行提供分页默认值
    keyword: 'string?',      // 可选（搜索关键字）
  },
  body: {
    name: 'string:1-50!',    // 必填（创建资源必须提供）
    email: 'email!',          // 必填
    bio: 'string:0-500?',    // 可选
  },
}
```

### 3. 校验规则即文档

校验规则提供输入合同的结构部分；还需要补齐接口用途、身份要求、响应、错误和业务约束，才能构成完整文档。字段规则应精确描述实际约束：

```typescript
// ✅ 精确约束 — 文档和校验都很清晰
validate: {
  body: {
    username: 'string:3-30!',     // 3-30 字符，必填
    age: 'number:0-150?',         // 0-150，可选
    role: 'admin|editor|viewer!', // 明确枚举
  },
}

// ❌ 宽泛约束 — 文档信息不足
validate: {
  body: {
    username: 'string!',          // 没有长度约束
    age: 'number?',               // 没有范围约束
    role: 'string!',              // 应该用枚举
  },
}
```

### 4. 为 Handler 中的自定义校验使用 `app.throw()`

DSL 语法无法覆盖所有校验场景（如跨字段校验、数据库唯一性检查）。对于这些场景，在 handler 或 service 中使用 `app.throw()` 手动抛出：

```typescript
app.post(
  "/users",
  {
    validate: {
      body: { email: "email!", password: "string:8-128!" },
    },
  },
  async (req, res) => {
    const data = req.valid("body");

    // 预查询提供友好提示；真正的并发唯一性仍需数据库约束。
    const existing = await app.services.user.findByEmail(data.email);
    if (existing) {
      app.throw(409, "邮箱已注册", 10001);
    }

    const user = await app.services.user.create(data);
    res.json(user, 201);
  },
);
```

应用层“先查再写”不能保证并发唯一性，还需处理数据库唯一约束冲突。Schema不代替授权、对象归属、库存或支付资格检查，见[参数与契约规范](/zh/specification/validation-and-contracts)。

## 排查与复验

| 症状                      | 检查                                       | 复验                                      |
| ------------------------- | ------------------------------------------ | ----------------------------------------- |
| 400而非422                | param先失败，或body parser先拒绝JSON       | 分开构造非法param和非法字段请求           |
| boolean传1失败            | 当前引擎不把字符串1/0转布尔                | 使用true/false并验证错误路径              |
| req.valid为undefined      | 对应位置是否声明，是否到达校验             | 核对location单数param并执行有效请求       |
| 编译/投影拒绝Schema       | 数组简写、动态builder或不透明第三方实例    | 改用支持的静态声明，再执行build和请求测试 |
| 自定义引擎与OpenAPI不一致 | 适配器是否改变转换、必填、未知字段语义     | 同时核对生成契约和合法/非法请求           |
| string!仍接受空字符串     | 必填仅限制字段存在                         | 改为string:1-!，分别提交缺失/空串/有效值  |
| 多余字段仍在结果中        | 默认引擎保留未知字段，业务尚未选择写入字段 | 提交额外字段，检查实际输出及持久化参数    |

## 下一步

- 了解 [配置](/zh/guide/configuration) 中校验相关的全局配置
- 查看 [OpenAPI 文档](/zh/guide/openapi) 如何与校验规则联动
- 学习 [路由](/zh/guide/routing) 中三段式的完整用法
- 探索 [插件](/zh/guide/plugins) 如何替换校验引擎
