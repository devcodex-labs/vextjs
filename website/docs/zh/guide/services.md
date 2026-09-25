# 服务层

服务层（Service Layer）用于集中业务逻辑。把默认导出的服务类放在 `src/services/`，框架会自动扫描、实例化并挂载到 `app.services`，路由 handler 通过 `app.services.xxx` 调用。本页先完成一个不依赖数据库的示例，再说明命名、依赖和生命周期。

## 设计理念

```
路由层 (routes)    ← 参数提取 + 响应返回（薄层）
   ↓
服务层 (services)  ← 业务逻辑（核心）
   ↓
数据层 (models)    ← 数据访问（通过插件提供）
```

- **路由 handler** 只负责从请求中提取参数、调用 service、返回响应
- **服务层** 承载业务用例，推荐不直接操作 `req` / `res`，让路由和 Job 等消费者复用
- **数据层** 由插件提供（如数据库 ORM），通过 `app` 对象访问

这种分层使得：

- 业务逻辑可以在不同路由间复用
- 服务层可以独立进行单元测试（不依赖 HTTP）
- 切换底层 Adapter 不影响业务代码

这是推荐的职责边界，不是框架自动拦截所有跨层调用的机制。`app.throw()` 仍可以表达 HTTP 错误；需要 HTTP 之外的复用时，消费者应明确如何转换这些错误，见[架构规范](/zh/specification/architecture)及[参数与契约规范](/zh/specification/validation-and-contracts)。

## 基本写法

### 服务类

每个服务文件默认导出可用 `new` 调用的 class 或构造函数，接收 `app` 参数；推荐 class 写法。本节提供一组不依赖数据库的可运行示例，返回模拟数据，用于验证服务注入、调用与参数校验，不会持久化用户。

前置条件：已完成[快速开始](/zh/guide/quick-start)的 TypeScript 应用，可以通过 `npm run dev` 启动。把以下片段合并到基础配置，再添加 service 和 route 文件；已有同名文件时合并或替换对应示例，不重复定义。本文请求使用3000端口，若local/provider/CLI等覆盖了端口，应先按[配置](/zh/guide/configuration)核对实际监听值。

```typescript
// src/config/default.ts
import type { VextUserConfig } from "vextjs";

export default { port: 3000 } satisfies VextUserConfig;
```

```typescript
// src/services/user.ts
import type { VextApp } from "vextjs";

export default class UserService {
  private app: VextApp;

  constructor(app: VextApp) {
    this.app = app;
  }

  async findAll(options?: { page?: number; limit?: number }) {
    const { page = 1, limit = 20 } = options ?? {};
    // 业务逻辑...
    return {
      items: [],
      total: 0,
      page,
      limit,
    };
  }

  async findById(id: string) {
    // 业务逻辑...
    const user = { id, name: "Alice", email: "alice@example.com" };
    return user;
  }

  async create(data: { name: string; email: string }) {
    this.app.logger.info({ data }, "Creating user");
    // 业务逻辑...
    return { id: crypto.randomUUID(), ...data };
  }

  async update(id: string, data: Partial<{ name: string; email: string }>) {
    this.app.logger.info({ id, data }, "Updating user");
    return { id, ...data };
  }

  async delete(id: string) {
    this.app.logger.info({ id }, "Deleting user");
  }
}
```

### 在路由中使用

```typescript
// src/routes/users.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, async (_req, res) => {
    // 通过 app.services 访问已注入的服务实例
    const users = await app.services.user.findAll();
    res.json(users);
  });

  app.get(
    "/:id",
    {
      validate: { param: { id: "string!" } },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      const user = await app.services.user.findById(id);
      if (!user) app.throw(404, "user.not_found");
      res.json(user);
    },
  );

  app.post(
    "/",
    {
      validate: {
        body: { name: "string:1-50!", email: "email!" },
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

启动 `npm run dev` 后，在另一终端执行请求。以下写法适用于 Bash 等 POSIX shell：

```bash
curl -i http://127.0.0.1:3000/users
curl -i http://127.0.0.1:3000/users/42
curl -i -H "Content-Type: application/json" -d '{"name":"Bob","email":"bob@example.com"}' http://127.0.0.1:3000/users
curl -i -H "Content-Type: application/json" -d '{"name":"Bob","email":"invalid"}' http://127.0.0.1:3000/users
```

Windows PowerShell 可用以下写法，避免旧版PowerShell向原生命令传递JSON引号时改变正文：

```powershell
Invoke-RestMethod http://127.0.0.1:3000/users
Invoke-RestMethod http://127.0.0.1:3000/users/42
Invoke-RestMethod http://127.0.0.1:3000/users -Method Post -ContentType 'application/json' -Body '{"name":"Bob","email":"bob@example.com"}'
try {
  Invoke-RestMethod http://127.0.0.1:3000/users -Method Post -ContentType 'application/json' -Body '{"name":"Bob","email":"invalid"}'
} catch {
  [int]$_.Exception.Response.StatusCode # 预期422
}
```

依次应得到200（`data.items` 为空、page=1、limit=20）、200（`data.id` 为42字符串）、201（`data.id` 为生成的UUID）、422（字段校验失败）。本示例开放访问；需要认证的应用在路由上按[认证与安全](/zh/guide/security)接入完整认证中间件与Guard，不能只复制一个尚未注册的 auth 名称。

验证开发请求后，停止开发服务，执行快速开始配置的 `npm run build`（含 `--typecheck`）和 `npm start`，重复上述请求。创建后再次查询列表仍为空，因为本例没有持久化存储。

后续章节是各自独立的模式与扩展示意；多个 `UserService` 示例用于替换或合并对应方法，不要在同一文件重复声明多个默认导出。

## 文件命名与映射

`service-loader` 按文件路径自动将服务实例挂载到 `app.services` 的对应属性上。

### 映射规则

| 文件路径                        | 访问方式                        | 说明                   |
| ------------------------------- | ------------------------------- | ---------------------- |
| `services/user.ts`              | `app.services.user`             | 扁平命名               |
| `services/order.ts`             | `app.services.order`            | 扁平命名               |
| `services/user-profile.ts`      | `app.services.userProfile`      | kebab-case → camelCase |
| `services/payment/stripe.ts`    | `app.services.payment.stripe`   | 嵌套命名空间           |
| `services/payment/alipay.ts`    | `app.services.payment.alipay`   | 嵌套命名空间           |
| `services/admin/user-manage.ts` | `app.services.admin.userManage` | 嵌套 + 驼峰转换        |

**转换规则：**

1. 文件路径相对于 `services/` 目录，去除扩展名
2. 文件名自动从 `kebab-case` 转换为 `camelCase`
3. 子目录映射为嵌套对象

`index` 是普通服务 key，不会像路由那样折叠：`services/payment/index.ts` 对应 `app.services.payment.index`。所有路径段都参与命名转换；转换后 key 重复，或某 key 既作为服务实例又作为目录命名空间时，会在加载阶段报冲突。

### 嵌套服务示例

```
src/services/
├── user.ts                    → app.services.user
├── order.ts                   → app.services.order
└── payment/
    ├── stripe.ts              → app.services.payment.stripe
    └── wechat-pay.ts          → app.services.payment.wechatPay
```

```typescript
// src/services/payment/stripe.ts
import type { VextApp } from "vextjs";

export default class StripeService {
  private app: VextApp;

  constructor(app: VextApp) {
    this.app = app;
  }

  async createPayment(amount: number, currency: string) {
    this.app.logger.info({ amount, currency }, "Creating Stripe payment");
    // Stripe API 调用...
    return { paymentId: "pi_xxx", status: "pending" };
  }

  async refund(paymentId: string) {
    this.app.logger.info({ paymentId }, "Refunding Stripe payment");
    return { refundId: "re_xxx", status: "refunded" };
  }
}
```

```typescript
// 在路由中使用嵌套服务
app.post("/pay", {}, async (_req, res) => {
  const result = await app.services.payment.stripe.createPayment(100, "usd");
  res.json(result);
});
```

## Service Hooks

Vext 会为加载到 `app.services` 的实例方法安装轻量 wrapper。当没有注册 service hook 时，调用会直接走原方法；注册 hook 后，可观察调用前后和错误：

当前包装范围是原型链上的普通方法，不包括构造函数，也不包括实例字段形式的箭头函数或 getter/setter。`service:beforeCall` 监听器抛错会阻止原方法执行；afterCall/error 观察回调使用安全派发，不替换原调用结果。

```typescript
// src/plugins/service-observer.ts
import { definePlugin } from "vextjs";

export default definePlugin({
  name: "service-observer",
  setup(app) {
    app.hooks.on("service:beforeCall", ({ service, method }) => {
      app.logger.debug({ service, method }, "service call start");
    });

    app.hooks.on("service:error", ({ service, method, error }) => {
      app.logger.error({ service, method, err: error }, "service call failed");
    });
  },
});
```

`service:beforeCall`、`service:afterCall` 和 `service:error` 都是同步 hook。不要在这些 handler 中返回 Promise；如需异步上报，建议放入队列或使用不阻塞主调用的日志传输。

## 服务间调用

服务之间可以相互调用。推荐通过 `this.app.services` 在**方法中**按需访问（延迟访问），而非在构造函数中直接引用：

```typescript
// src/services/order.ts
import type { VextApp } from "vextjs";

export default class OrderService {
  private app: VextApp;

  constructor(app: VextApp) {
    this.app = app;
  }

  async createOrder(
    userId: string,
    items: Array<{ productId: string; quantity: number }>,
  ) {
    // 调用其他 service — 通过 this.app.services 延迟访问
    const user = await this.app.services.user.findById(userId);
    if (!user) {
      this.app.throw(404, "user.not_found");
    }

    // 计算价格
    const total = await this.calculateTotal(items);

    // 调用支付服务
    const payment = await this.app.services.payment.stripe.createPayment(
      total,
      "usd",
    );

    return {
      orderId: crypto.randomUUID(),
      userId,
      items,
      total,
      paymentId: payment.paymentId,
      status: "created",
    };
  }

  private async calculateTotal(
    items: Array<{ productId: string; quantity: number }>,
  ) {
    // 业务逻辑...
    return items.reduce((sum, item) => sum + item.quantity * 10, 0);
  }
}
```

::::warning 避免循环依赖
`service-loader` 和 `vext doctor` 共用有限的静态依赖图；识别出的 `ServiceA` 与 `ServiceB` 相互依赖会在启动时报错。默认导出构造函数的第一个参数是注入来源，参数可命名为 `app`、`application` 等；直接保存到实例属性（含 TypeScript 参数属性）及可追溯的局部别名均可识别。命名空间服务支持静态字符串访问。

注释、字符串和无关局部对象不产生依赖。动态服务名、重赋值、继承或无法追溯的来源会报告分析不完整；运行时预检输出警告，Doctor 保留不完整状态。静态图不能证明所有运行路径都没有循环，也不会执行业务代码来补全结论。

**✅ 正确做法** — 在方法中延迟访问：

延迟访问只解决初始化顺序问题；如果 A 和 B 的方法仍互相依赖，依然可能形成静态环或运行时递归，必须调整依赖方向。

```typescript
export default class OrderService {
  constructor(private app: VextApp) {}

  async createOrder() {
    // ✅ 方法调用时 user service 已经初始化完成
    const user = await this.app.services.user.findById("123");
  }
}
```

**❌ 错误做法** — 在构造函数中直接引用：

```typescript
export default class OrderService {
  private userService: UserService;

  constructor(app: VextApp) {
    // ❌ 构造函数执行时 user service 可能尚未初始化
    this.userService = app.services.user;
  }
}
```

::::

## 使用插件提供的能力

插件通过 `app.extend()` 注入的能力，在服务中通过 `this.app` 访问：

```typescript
// 假设 redis 插件已通过 app.extend('redis', redis) 注入
// src/services/user.ts
import type { VextApp } from "vextjs";

export default class UserService {
  private app: VextApp;

  constructor(app: VextApp) {
    this.app = app;
  }

  async findById(id: string) {
    // 先查缓存
    const cached = await (this.app as any).redis.get(`user:${id}`);
    if (cached) return JSON.parse(cached) as { id: string; name: string };

    // 缓存未命中，查数据库
    const user = await this.queryDatabase(id);

    // 写入缓存
    if (user) {
      await (this.app as any).redis.set(`user:${id}`, JSON.stringify(user));
    }

    return user;
  }

  private async queryDatabase(id: string) {
    // 数据库查询逻辑...
    return { id, name: "Alice" };
  }
}
```

::::tip 类型提示
使用 `declare module` 扩展 `VextApp` 接口可获得完整的类型提示：

```typescript
// src/types/extensions.d.ts
import "vextjs";

declare module "vextjs" {
  interface VextApp {
    redis: {
      get(key: string): Promise<string | null>;
      set(key: string, value: string, ttl?: number): Promise<void>;
    };
  }
}
```

扩展后 `this.app.redis` 即可获得 IDE 自动补全。

声明必须匹配实际注入的客户端 API；此处描述的是应用的封装合同，不代表所有 Redis SDK 都采用相同 set 签名或返回值。模块声明不会创建运行时连接。
::::

## 使用 `app.throw()` 抛出错误

服务层中可以通过 `this.app.throw()` 抛出 HTTP 错误。从 HTTP 请求链调用并把异常传播出去时，框架会捕获并转化为统一错误响应，无需在路由层手动 try-catch。独立调用或 Job 消费者收到的是异常，不会凭空产生 HTTP 响应：

- 需要主动返回 `404`、`409`、`401` 等明确 HTTP 语义时，使用 `this.app.throw(...)`
- 需要返回字段级校验详情时，抛出 `VextValidationError`
- 发生未预期异常时，可以直接 `throw new Error("...")`，框架会统一转成 500

```typescript
export default class UserService {
  constructor(private app: VextApp) {}

  async findById(id: string) {
    const user = await this.queryDatabase(id);
    if (!user) {
      // 直接在 service 中抛出，框架统一处理
      this.app.throw(404, "user.not_found");
    }
    return user;
  }

  async create(data: { name: string; email: string }) {
    const existing = await this.findByEmail(data.email);
    if (existing) {
      this.app.throw(409, "邮箱已注册", 10001);
    }
    // 创建逻辑...
    return { id: crypto.randomUUID(), ...data };
  }

  private async queryDatabase(id: string) {
    return null; // 模拟
  }

  private async findByEmail(email: string) {
    return null; // 模拟
  }
}
```

如果 service 内部直接 `throw new Error("...")`，框架也会捕获它；这条路径表示未知运行时异常，而不是主动设计好的 HTTP 错误响应。默认情况下客户端会收到安全的 `500 Internal Server Error`，开发环境下可通过 `response.hideInternalErrors = false` 额外暴露 `stack` 便于排查。

## 在服务中校验非 HTTP 输入

路由入口参数优先通过 `RouteOptions.validate` 声明，并在 handler 中使用 `req.valid()` 读取校验后的数据。对于 service 直接处理的非 HTTP 输入，例如定时任务、消息队列、外部回调或其他 service 调用，可以通过 `this.app.getValidator()` 复用当前全局校验引擎。

`getValidator()` 默认返回基于 schema-dsl 的同步 validator；插件可以提供满足 `VextValidator` 的适配器进行替换，不能直接假设任意 Zod、Yup 实例具有相同接口。本例在构造时编译并保存校验函数，替换引擎应在服务加载前完成；后来替换不会自动重新编译已保存的函数。

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

  async createFromJob(input: unknown) {
    const result = this.validateCreateUser(input);

    if (!result.valid) {
      throw new VextValidationError(result.errors ?? []);
    }

    const data = result.data as { name: string; email: string };
    return this.create(data);
  }

  async create(data: { name: string; email: string }) {
    // 创建逻辑...
    return { id: crypto.randomUUID(), ...data };
  }
}
```

::::tip

需要跟随框架统一校验合同的输入，使用 `app.getValidator()`。直接调用独立 schema 库会绕过 `app.setValidator()`；如果有意使用独立引擎，应明确其不同的语法、错误和转换语义。Schema 校验不能替代库存、资格或唯一性等业务判断。

::::

## 使用 `app.logger` 记录日志

服务层推荐通过 `this.app.logger` 记录结构化日志。在已建立请求上下文的 HTTP 调用链中，日志可通过 AsyncLocalStorage 携带 requestId；进程启动、Job 或脱离该上下文的调用不能假定有 HTTP requestId：

```typescript
export default class PaymentService {
  constructor(private app: VextApp) {}

  async processPayment(orderId: string, amount: number) {
    this.app.logger.info({ orderId, amount }, "Processing payment");

    try {
      // 调用外部支付 API...
      const result = { transactionId: "txn_xxx" };
      this.app.logger.info(
        { orderId, transactionId: result.transactionId },
        "Payment successful",
      );
      return result;
    } catch (err) {
      this.app.logger.error({ orderId, err }, "Payment failed");
      this.app.throw(500, "payment.failed");
    }
  }
}
```

## 加载顺序与生命周期

### 加载时机

在 `bootstrap` 启动流程中，`service-loader` 在以下阶段执行：

```
1. config    → 加载配置
2. locales   → 加载语言包
3. plugins   → 执行插件 setup()
4. middlewares → 按配置挂载名称加载中间件
5. services  → ⭐ 实例化服务（此处）
6. routes    → 注册路由（handler 中可安全访问 app.services）
```

这意味着：

- ✅ 服务构造函数中可以访问 `app.config`（已加载）
- ✅ 服务构造函数中可以访问 `app.logger`（已初始化）
- ✅ 服务构造函数中可以访问插件注入的能力（插件已 setup）
- ⚠️ 服务构造函数中访问 `app.services` 需注意顺序（见循环依赖章节）
- ✅ 路由 handler 中可以安全访问所有 `app.services`（已全部注入完成）

### 实例化过程

1. **扫描** — 递归发现 `.ts` / `.mts` / `.cts` / `.js` / `.mjs` / `.cjs` 服务文件，按下方规则排除辅助文件
2. **排序** — 按文件路径字母序排序（确保加载顺序确定性）
3. **实例化** — 逐个 `new ServiceClass(app)` 创建实例
4. **挂载** — 包装服务方法以支持Service Hooks，再将实例挂载到 `app.services` 的对应属性
5. **检测** — 执行循环依赖检测（可选，默认开启）

`createTestApp()` 直接加载 TS service 源文件时使用框架内置编译和原生 ESM 执行，无需额外 TS loader；再次加载 TS service 会重新求值并创建新实例。其 `import.meta.url` / `filename` / `dirname` 指向源文件位置，临时执行文件在返回前完成归属校验和清理。dev 与 compiled 生产运行仍使用各自的编译输出和既有重载流程。

### 排除规则

以下文件会被自动跳过：

- 测试文件：名称包含 `.test.`、`.spec.`
- 声明文件：`.d.ts`、`.d.mts`、`.d.cts`
- 以 `_` 或 `.` 开头的文件/目录
- 名称包含 `.__vext_compiled__` 的临时执行文件

上述排除不代表扫描目录可以存放任意辅助内容；当前 Service Loader 没有针对服务目录内 `node_modules` 的专用排除分支。依赖安装在项目根，服务目录只存放服务入口。

`_` 前缀会让运行时跳过自动注入，但不应把共享工具和类型依赖隐藏在扫描目录中。推荐让服务目录只承载服务入口，其他内容按实际消费者归属放置：

```
src/
├── services/
│   ├── user.ts
│   └── order.ts
├── modules/shared/base-service.ts   # 确有复用时放置基类，普通import
└── types/server/services/order.ts  # 后端共享的type-only契约
```

## 服务层最佳实践

### 1. 保持服务层的 HTTP 无关性

服务层不应直接操作 `req` / `res` 对象。如果需要请求上下文信息（如当前用户），作为参数传入：

```typescript
// ✅ 正确 — 参数传入
async createOrder(userId: string, items: OrderItem[]) {
  // ...
}

// ❌ 错误 — 直接操作请求对象
async createOrder(req: VextRequest, res: VextResponse) {
  // service 不应感知 HTTP
}
```

### 2. 单一职责

每个服务对应一个业务领域。避免将不同领域的逻辑放在同一个服务中：

```
services/
├── user.ts           # 用户管理
├── order.ts          # 订单管理
├── notification.ts   # 通知服务
└── payment/
    ├── stripe.ts     # Stripe 支付
    └── wechat-pay.ts # 微信支付
```

### 3. 使用基类共享通用逻辑

确实存在共同服务行为时可以使用基类；无状态逻辑通常也可用普通函数组合。本例把基类放在扫描目录外，继承关系可能使依赖分析结果不完整，需结合测试验证，不把未识别的依赖当成不存在：

```typescript
// src/modules/shared/base-service.ts
import type { VextApp } from "vextjs";

export abstract class BaseService {
  protected app: VextApp;

  constructor(app: VextApp) {
    this.app = app;
  }

  protected async paginate<T>(
    queryFn: (offset: number, limit: number) => Promise<T[]>,
    countFn: () => Promise<number>,
    page: number,
    limit: number,
  ) {
    const offset = (page - 1) * limit;
    const [items, total] = await Promise.all([
      queryFn(offset, limit),
      countFn(),
    ]);
    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }
}
```

```typescript
// src/services/user.ts
import { BaseService } from "../modules/shared/base-service.js";

export default class UserService extends BaseService {
  async findAll(page = 1, limit = 20) {
    return this.paginate(
      (offset, limit) => this.queryUsers(offset, limit),
      () => this.countUsers(),
      page,
      limit,
    );
  }

  private async queryUsers(offset: number, limit: number) {
    return []; // 数据库查询
  }

  private async countUsers() {
    return 0; // 计数查询
  }
}
```

### 4. TypeScript 类型声明

为 `app.services` 添加类型声明，获得完整的 IDE 支持：

推荐优先使用框架提供的生成命令：

```bash
npm exec -- vext typegen
```

该命令会在 `.vext/types/services.generated.d.ts` 中自动生成 `VextServices` 扩展声明，并通过 `src/types/generated/index.d.ts` 接入 TypeScript 项目，同时执行一轮 tooling 层 service 依赖检查。

当前 `vext dev` 会在 preflight 中自动执行基础 typegen，用于使开发态的 generated 声明与当前 `services` / `plugins` 定义保持同步；如果你需要 `--check`、`--write-manifest` 或独立 CI 控制，仍应显式运行 `vext typegen`。

如果你还想把 service 索引、`app.extend()` 聚合结果与依赖图摘要提供给编辑器、CI 或其他工具链消费，可以额外执行：

```bash
npm exec -- vext typegen --write-manifest
```

对应产物会写入：`.vext/manifest/services.json`。

如果你需要手写或补充少量高级声明，仍可保留自定义 `.d.ts` 文件；generated文件与手写文件分开保存，但TypeScript会合并它们的声明。同名属性必须具有兼容且一致的类型，不应再手写一套与生成结果冲突的声明。下方为手动声明方式的示意，要求对应服务文件已存在；已生成这些属性时无需重复添加。

```typescript
// src/types/services.d.ts
import type UserService from "../services/user.js";
import type OrderService from "../services/order.js";

declare module "vextjs" {
  interface VextServices {
    user: UserService;
    order: OrderService;
    payment: {
      stripe: import("../services/payment/stripe.js").default;
    };
  }
}
```

添加后，`app.services.user.findById()` 等调用将获得完整的方法签名提示和类型检查。

### 实例范围与资源关闭

每次应用加载为每个服务创建一个实例，供该应用请求共享；不是每个请求创建一个。不要把当前用户、请求对象或临时请求结果存成可被并发请求覆盖的实例字段。多 worker 各有自己的实例与内存状态。

框架不会因为 service 有名为 `close()` 或 `init()` 的方法就自动调用它。应用关闭时需要的清理由资源所有者显式注册 `app.onClose()`；长期连接优先由插件管理，服务借用连接时避免重复关闭。

开发态的服务定向重载有独立的可选 `dispose()` 约定：被替换或删除的旧实例会调用并等待该方法，方法抛错会记录警告并继续重载。这不等于应用关闭时也会自动调用 `dispose()`。若后续加载失败，恢复旧实例引用也不会撤销已经执行的资源清理，因此清理应可重复，且不要把“回滚引用”理解为连接状态已恢复。完整重载场景见[热重载](/zh/guide/hot-reload)。

### 排查与复验

| 症状                             | 检查                                            | 复验                                 |
| -------------------------------- | ----------------------------------------------- | ------------------------------------ |
| 服务为undefined                  | 路径key、默认导出、排除规则、加载是否成功       | 启动后调用本文完整示例               |
| Failed to instantiate service    | 默认导出是否可new、构造期是否访问尚未挂载依赖   | 修正初始化并重启                     |
| Circular dependency / 分析不完整 | 检查依赖方向和动态访问，不靠延迟调用隐藏环      | 重新运行typegen/doctor及对应业务测试 |
| IDE类型陈旧                      | generated入口是否被tsconfig包含，源码是否已变更 | `vext typegen` 后独立类型检查        |
| 多请求数据串用                   | 检查实例字段是否存放请求状态                    | 用不同身份并发调用复验               |

## 下一步

- 了解 [中间件](/zh/guide/middleware) 如何拦截和处理请求
- 学习 [插件](/zh/guide/plugins) 如何扩展框架能力
- 查看 [测试](/zh/guide/testing) 如何对服务层进行单元测试
