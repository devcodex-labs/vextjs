import type { VextAdapter } from "./adapter.js";
import type { VextMiddleware } from "./middleware.js";

/**
 * VextServices — 服务集合类型
 *
 * service-loader 扫描 src/services/ 目录后，
 * 将所有 service 实例注入到 app.services 中。
 *
 * 用户通过 declare module 'vextjs' 扩展此接口获得类型提示：
 * @example
 * declare module 'vextjs' {
 *   interface VextServices {
 *     user: UserService
 *     order: OrderService
 *   }
 * }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface VextServices {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/**
 * VextLogger — 框架日志接口
 *
 * 内置实现基于 pino，插件可通过覆盖 app.logger 替换实现。
 * 所有日志方法自动携带 requestId（通过 child logger 实现）。
 */
export interface VextLogger {
  info(msg: string, ...args: unknown[]): void;
  info(obj: Record<string, unknown>, msg?: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  warn(obj: Record<string, unknown>, msg?: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  error(obj: Record<string, unknown>, msg?: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
  debug(obj: Record<string, unknown>, msg?: string, ...args: unknown[]): void;
  fatal(msg: string, ...args: unknown[]): void;
  fatal(obj: Record<string, unknown>, msg?: string, ...args: unknown[]): void;

  /**
   * 创建子 logger（携带额外上下文字段）
   * @param bindings 额外的上下文键值对
   */
  child(bindings: Record<string, unknown>): VextLogger;
}

/**
 * VextRateLimiter — 速率限制器接口
 *
 * 内置实现基于 flex-rate-limit，插件可通过 app.setRateLimiter() 替换。
 */
export interface VextRateLimiter {
  /** 检查是否允许请求通过 */
  check(
    key: string,
  ): Promise<{ allowed: boolean; remaining: number; resetAt: number }>;
}

/**
 * VextValidator — 校验引擎接口
 *
 * 内置实现基于 schema-dsl，插件可通过 app.setValidator() 替换为 Zod / Yup 等。
 */
export interface VextValidator {
  /**
   * 编译 schema 并返回校验函数
   * @param schema 原始 schema 定义
   * @returns 校验函数，接收数据返回校验结果
   */
  compile(schema: Record<string, unknown>): (data: unknown) => {
    valid: boolean;
    errors?: Array<{ field: string; message: string }>;
    data?: unknown;
  };
}

// ── 配置类型定义 ────────────────────────────────────────────

/**
 * 中间件配置项
 */
export interface VextMiddlewareConfig {
  /** 中间件名称（对应 src/middlewares/ 下的文件名，不含扩展名） */
  name: string;
  /** 中间件配置选项（传给 middlewareFactory(options)） */
  options?: Record<string, unknown>;
}

/**
 * CORS 配置
 */
export interface VextCorsConfig {
  enabled?: boolean;
  origins?: string[];
  methods?: string[];
  headers?: string[];
  credentials?: boolean;
  maxAge?: number;
}

/**
 * 速率限制配置
 */
export interface VextRateLimitConfig {
  /** 是否启用速率限制（默认 true） */
  enabled?: boolean;
  /** 时间窗口内最大请求数（默认 100） */
  max?: number;
  /** 时间窗口（秒，默认 60） */
  window?: number;
  /** 超过限制时的错误消息（默认 'Too Many Requests'） */
  message?: string;
  /** 用于标识请求来源的 key（默认 'ip'）：'ip' | 'user' | 自定义函数 */
  keyBy?: string | ((req: import("./request.js").VextRequest) => string);
}

/**
 * RequestId 配置
 */
export interface VextRequestIdConfig {
  /** 是否启用请求 ID 追踪（默认 true）；设为 false 时 req.requestId 为空字符串 */
  enabled?: boolean;
  /** 从哪个请求头读取 requestId（网关透传），不存在则调用 generate()（默认 'x-request-id'） */
  header?: string;
  /** 将 requestId 写入响应头（默认 'x-request-id'） */
  responseHeader?: string;
  /** 自定义 ID 生成函数；undefined 时框架使用内置 crypto.randomUUID() */
  generate?: () => string;
}

/**
 * 日志配置
 */
export interface VextLoggerConfig {
  /** 日志级别（默认 'info'） */
  level?: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  /** 是否美化输出（默认 development 时启用） */
  pretty?: boolean;
}

/**
 * 优雅关闭配置
 */
export interface VextShutdownConfig {
  /** 关闭超时（秒，默认 10） */
  timeout?: number;

  /**
   * 致命错误回调（uncaughtException / unhandledRejection）
   *
   * 当进程捕获到未处理的异常或 Promise rejection 时调用。
   * 适合接入告警通知（钉钉、企微、Slack、Webhook 等），
   * 在进程退出前通知运维人员。
   *
   * 注意：
   *   - 回调执行有 10 秒超时保护，超时后强制退出进程
   *   - 回调内部不应抛出异常（框架会捕获并静默忽略）
   *   - uncaughtException 触发后进程处于不确定状态，回调应尽量轻量
   *
   * @param error  捕获到的错误对象
   * @param origin 错误来源：'uncaughtException' | 'unhandledRejection'
   *
   * @example
   * ```typescript
   * // src/config/production.ts
   * export default {
   *   shutdown: {
   *     timeout: 10,
   *     onFatalError: async (error, origin) => {
   *       await fetch('https://webhook.example.com/alert', {
   *         method: 'POST',
   *         headers: { 'Content-Type': 'application/json' },
   *         body: JSON.stringify({
   *           app: 'my-service',
   *           origin,
   *           error: error.message,
   *           stack: error.stack,
   *           time: new Date().toISOString(),
   *         }),
   *       });
   *     },
   *   },
   * };
   * ```
   */
  onFatalError?: (
    error: Error,
    origin: "uncaughtException" | "unhandledRejection",
  ) => void | Promise<void>;
}

/**
 * 响应配置
 */
export interface VextResponseConfig {
  /**
   * 是否隐藏内部错误详情（默认 true）
   * 生产环境建议开启，500 错误不暴露 stack trace
   */
  hideInternalErrors?: boolean;

  /**
   * 是否启用出口包装（默认 true）
   *
   * 启用时，res.json(data) 自动包装为 { code: 0, data, requestId }。
   * 禁用时，res.json(data) 直接发送原始 data，不做任何包装。
   *
   * 典型禁用场景：
   *   - 性能基准测试（减少 JSON 序列化开销）
   *   - 微服务间通信（不需要统一包装格式）
   *   - 与第三方 API 规范对齐（如 RESTful 纯净响应）
   */
  wrap?: boolean;
}

/**
 * OpenAPI 文档配置
 */
export interface VextOpenAPIConfig {
  /** 是否启用 OpenAPI 文档生成（默认：dev 启用，production 关闭） */
  enabled?: boolean;
  /** 文档标题 */
  title?: string;
  /** 文档版本 */
  version?: string;
  /** 文档描述 */
  description?: string;
  /** Swagger UI 路径（默认 '/docs'） */
  docsPath?: string;
  /** OpenAPI JSON 路径（默认 '/openapi.json'） */
  jsonPath?: string;

  /** 联系信息 */
  contact?: { name?: string; email?: string; url?: string };
  /** 许可证 */
  license?: { name: string; url?: string };

  /** 服务器地址列表 */
  servers?: Array<{ url: string; description?: string }>;
  /** 全局标签定义 */
  tags?: Array<{ name: string; description?: string }>;

  /**
   * Guard → Security Scheme 映射
   *
   * 用于从路由 middlewares 名称推断安全方案。
   * 例如: { auth: 'bearerAuth', apiKey: 'apiKeyAuth' }
   */
  guardSecurityMap?: Record<string, string>;

  /** 安全方案定义 */
  securitySchemes?: Record<
    string,
    {
      type: "http" | "apiKey" | "oauth2" | "openIdConnect";
      scheme?: string;
      bearerFormat?: string;
      name?: string;
      in?: "header" | "query" | "cookie";
      description?: string;
    }
  >;

  /** 是否启用 "Try it out" 功能 @default true */
  tryItOutEnabled?: boolean;
  /** 默认展开级别 @default 'list' */
  docExpansion?: "none" | "list" | "full";
}

/**
 * Body 解析配置
 */
export interface VextBodyParserConfig {
  /**
   * 是否启用 body 解析（默认 true）
   *
   * 禁用时，body-parser 中间件不会注册到中间件链中，
   * req.body 始终为 undefined。适用于纯 GET 服务或自定义 body 解析场景。
   */
  enabled?: boolean;

  /** 最大请求体大小（默认 '1mb'） */
  maxBodySize?: string | number;
}

/**
 * Access Log 配置
 *
 * 控制内置 access-log 中间件的行为。
 * 利用洋葱模型 after-middleware（`await next()` 后）记录请求耗时、状态码、路径等。
 *
 * 配置位置：src/config/default.ts → config.accessLog
 */
export interface VextAccessLogConfig {
  /** 是否启用 access-log（默认 true） */
  enabled?: boolean;

  /**
   * 日志输出级别（默认 'info'）
   *
   * 使用 app.logger 对应级别的方法输出。
   * 设为 'debug' 可在生产环境通过 logger.level 统一控制是否输出。
   */
  level?: "info" | "debug";

  /**
   * 跳过记录的路径列表（精确匹配）
   *
   * 常见用途：排除健康检查、metrics 等高频探针路径，减少日志噪音。
   *
   * @example ['/health', '/ready', '/metrics']
   */
  skipPaths?: string[];
}

/**
 * Cluster 配置
 *
 * 控制多进程模式的行为。
 * 也可通过 VEXT_CLUSTER=1 环境变量开启。
 *
 * 配置位置：src/config/default.ts → config.cluster
 *
 * @see 12-cluster.md（多进程 Cluster 设计方案）
 * @see 12a-master.md §3.1（完整配置项）
 */
/**
 * AsyncLocalStorage 请求上下文配置
 *
 * 控制是否启用 AsyncLocalStorage（requestContext.run()）包裹请求处理。
 *
 * 启用时（默认）：
 *   - app.throw 的 I18nError 可通过 requestContext 获取请求级 locale
 *   - app.logger 的 mixin 自动注入 requestId 到每条日志
 *   - app.fetch 自动传播 requestId 到出站请求
 *   - 中间件/handler 可通过 requestContext.getStore() 访问请求级数据
 *
 * 禁用时（enabled: false）：
 *   - 跳过 requestContext.run() 调用，预估全 adapter +3-8% RPS
 *   - ⚠️ app.throw 的 I18nError locale 解析失效（回退到默认 locale）
 *   - ⚠️ app.logger 不自动注入 requestId（日志中无 requestId 字段）
 *   - ⚠️ app.fetch 不自动传播 requestId（需手动设置 x-request-id header）
 *   - ⚠️ requestContext.getStore() 始终返回 undefined
 *
 * 适用场景：
 *   - 纯 API 网关 / 代理层，不需要 I18n / requestId 日志关联
 *   - 极致性能要求的微服务（可接受上述功能降级）
 *
 * 配置位置：src/config/default.ts → config.requestContext
 *
 * @see request-context.ts（AsyncLocalStorage 实例）
 * @see IMPLEMENTATION-PLAN.md 任务 5.7
 */
export interface VextRequestContextConfig {
  /**
   * 是否启用 AsyncLocalStorage 请求上下文
   *
   * @default true
   */
  enabled: boolean;
}

export interface VextClusterConfig {
  /** 是否启用 cluster 模式。也可通过 VEXT_CLUSTER=1 开启 @default false */
  enabled: boolean;

  /**
   * Worker 数量
   *
   * - 'auto':   等于 CPU 核心数（感知 Docker cgroups）
   * - 'auto-1': 等于 CPU 核心数 - 1（为 Master 预留一个核心）
   * - number:   显式指定（clamp 到 [1, 64]）
   *
   * @default 'auto'
   */
  workers: "auto" | "auto-1" | number;

  /** Worker 崩溃后自动重启 @default true */
  autoRestart: boolean;

  /** 允许在窗口内重启的最大次数（第 N+1 次触发限流）@default 5 */
  maxRestarts: number;

  /** 快速重启检测窗口（毫秒）@default 60000 */
  restartWindow: number;

  /** 重启间隔退避基数（毫秒）@default 1000 */
  restartBaseDelay: number;

  /** 重启间隔上限（毫秒）@default 30000 */
  restartMaxDelay: number;

  /** 健康检查配置 */
  healthCheck: {
    /** 是否启用健康检查 @default true */
    enabled: boolean;
    /** Master 检查间隔（毫秒）@default 15000 */
    interval: number;
    /** 心跳超时（毫秒）@default 30000 */
    timeout: number;
  };

  /** 零停机重启配置 */
  reload: {
    /** 替换下一个 Worker 前的等待时间（毫秒）@default 2000 */
    workerDelay: number;
    /** Worker 就绪超时（毫秒）@default 30000 */
    readyTimeout: number;
    /** Worker 关闭超时（毫秒）@default 10000 */
    shutdownTimeout: number;
  };

  /** PID 文件路径 @default '.vext.pid' */
  pidFile: string;

  /** 进程标题前缀 @default 'vext' */
  titlePrefix: string;

  /** 粘性会话模式 @default 'none' */
  sticky: "none" | "ip";
}

/**
 * VextConfig — 框架运行时配置（只读）
 *
 * 由 config-loader 通过 default → env → local 三层合并后 deepFreeze 生成。
 * 运行时通过 app.config 访问，不可修改。
 *
 * 配置文件位置：
 *   - src/config/default.ts    — 所有配置项的基准值
 *   - src/config/{env}.ts      — 环境覆盖（development / production / ...）
 *   - src/config/local.ts      — 本地覆盖（最高优先级，不提交 git）
 */
export interface VextConfig {
  /** HTTP 监听端口（默认 3000） */
  port: number;

  /** HTTP 监听地址（默认 '0.0.0.0'） */
  host: string;

  /**
   * 底层适配器
   *
   * 字符串：内置 adapter 标识（如 'hono'、'fastify'）
   * 函数：adapter 工厂函数（如 fastifyAdapter({ bodyLimit: 5MB })）
   * 对象：第三方 adapter 实例（必须实现 VextAdapter 接口）
   */
  adapter: string | ((app: VextApp) => VextAdapter) | VextAdapter;

  /** 是否信任代理（影响 req.ip / req.protocol 从 X-Forwarded-* 读取） */
  trustProxy: boolean;

  /** 路由级中间件白名单（按 name + options 声明） */
  middlewares: VextMiddlewareConfig[];

  /** CORS 配置 */
  cors: VextCorsConfig;

  /** 全局速率限制配置 */
  rateLimit: VextRateLimitConfig;

  /** RequestId 配置 */
  requestId: VextRequestIdConfig;

  /** 日志配置 */
  logger: VextLoggerConfig;

  /** 优雅关闭配置 */
  shutdown: VextShutdownConfig;

  /** 响应配置 */
  response: VextResponseConfig;

  /** Body 解析配置 */
  bodyParser: VextBodyParserConfig;

  /** Access Log 配置 */
  accessLog: VextAccessLogConfig;

  /** OpenAPI 文档配置 */
  openapi: VextOpenAPIConfig;

  /**
   * AsyncLocalStorage 请求上下文配置
   *
   * 控制是否启用 requestContext.run() 包裹请求处理。
   * 禁用后可提升 +3-8% RPS，但 logger requestId 自动注入、
   * app.throw locale 解析、app.fetch requestId 传播均失效。
   *
   * @see VextRequestContextConfig
   */
  requestContext: VextRequestContextConfig;

  /**
   * Cluster 多进程配置
   *
   * 启用后 Master 进程管理多个 Worker 进程，
   * 利用多核 CPU 并支持零停机重启。
   *
   * 也可通过 VEXT_CLUSTER=1 环境变量开启。
   *
   * @see 12-cluster.md（设计方案）
   */
  cluster?: Partial<VextClusterConfig>;

  /**
   * 测试模式标志（内部使用）
   *
   * createTestApp 设置为 true，阻止 shutdown 中的 process.exit()。
   * 用户不应手动设置此字段。
   *
   * @internal
   */
  _testMode?: boolean;

  /**
   * 允许用户扩展自定义配置字段
   *
   * 插件可通过 declare module 'vextjs' 扩展 VextConfig 接口获得类型提示。
   */
  [key: string]: unknown;
}

/**
 * 用户配置输入类型（所有字段可选，由 config-loader 合并默认值）
 */
export type VextUserConfig = Partial<VextConfig>;

// ── VextApp 类型定义 ────────────────────────────────────────

/**
 * VextApp — 框架应用实例
 *
 * 通过 createApp(config) 创建，是整个应用的核心对象。
 * 挂载配置、服务、日志、错误抛出等内置能力，
 * 并通过 extend() / use() 等方法支持插件扩展。
 *
 * 路由 handler 通过 defineRoutes(app => ...) 闭包访问 app。
 * 中间件通过 req.app 访问 app。
 *
 * 生命周期：
 *   createApp(config)
 *     → plugin-loader（app.use() 可用）
 *     → middleware-loader
 *     → service-loader（app.services 注入）
 *     → router-loader（路由注册）
 *     → lockUse()（禁止 app.use()）
 *     → listen()（HTTP 开始监听）
 *     → onReady 钩子
 *     → SIGTERM/SIGINT → shutdown
 */
export interface VextApp {
  // ── HTTP 方法（三段式：path, options, handler）──────────

  get(path: string, options: RouteOptions, handler: VextHandler): void;
  get(path: string, handler: VextHandler): void;

  post(path: string, options: RouteOptions, handler: VextHandler): void;
  post(path: string, handler: VextHandler): void;

  put(path: string, options: RouteOptions, handler: VextHandler): void;
  put(path: string, handler: VextHandler): void;

  patch(path: string, options: RouteOptions, handler: VextHandler): void;
  patch(path: string, handler: VextHandler): void;

  delete(path: string, options: RouteOptions, handler: VextHandler): void;
  delete(path: string, handler: VextHandler): void;

  head(path: string, options: RouteOptions, handler: VextHandler): void;
  head(path: string, handler: VextHandler): void;

  options(path: string, options: RouteOptions, handler: VextHandler): void;
  options(path: string, handler: VextHandler): void;

  // ── 内置模块（插件可覆盖）──────────────────────────────

  /**
   * 结构化日志（内置 pino，插件可替换）
   * 自动携带 requestId，支持 .child() 创建子 logger
   */
  logger: VextLogger;

  /**
   * 抛出 HTTP 错误，框架统一转为 { code, message, requestId } 响应
   *
   * 内部基于 schema-dsl I18nError 实现，支持多语言 + 错误码映射。
   * 无 i18n 语言包时退化为原始 message 传递。
   *
   * 支持三种调用形式：
   *
   * **快捷方式**（i18n key，status 从 i18n 配置读取，默认 400）：
   * @example app.throw('balance.insufficient')
   * @example app.throw('balance.insufficient', { balance: 50 })
   *
   * **标准调用**（显式指定 HTTP 状态码）：
   * @example app.throw(404, 'user.not_found')
   * @example app.throw(400, '邮箱已注册', 10001)
   * @example app.throw(401, '缺少认证令牌', 'UNAUTHORIZED')
   * @example app.throw(400, 'balance.insufficient', { balance: 50 })
   * @example app.throw(400, 'balance.insufficient', { balance: 50 }, 20001)
   */
  throw(messageKey: string): never;
  throw(messageKey: string, params: Record<string, unknown>): never;
  throw(
    status: number,
    message: string,
    paramsOrCode?: Record<string, unknown> | number | string,
    code?: number | string,
  ): never;

  // ── 运行时数据（不可覆盖）─────────────────────────────

  /**
   * 最终合并后的运行时配置（只读）
   *
   * 由 config-loader 加载 default → env → local 三层合并并 deepFreeze。
   */
  config: Readonly<VextConfig>;

  /**
   * service-loader 注入的所有 service 实例
   *
   * 通过 app.services.<name> 方式访问。
   * service-loader 在 router-loader 之前执行，
   * 因此 handler 中访问 app.services 是安全的。
   */
  services: VextServices;

  /**
   * 底层适配器实例（由 adapter-resolver 解析后挂载）
   *
   * bootstrap 通过 app.adapter 注册中间件、路由、错误处理等。
   * 用户代码不应直接使用此属性。
   *
   * @internal
   */
  adapter: VextAdapter;

  // ── 框架扩展 API ──────────────────────────────────────

  /**
   * 向 app 挂载自定义属性（插件专用）
   *
   * 只有插件可以通过此方法扩展 app 对象。
   * 配合 declare module 'vextjs' 获得类型提示。
   *
   * @param key   属性名
   * @param value 属性值
   *
   * @example
   * // 在插件中
   * app.extend('cache', new RedisCache())
   *
   * // 类型声明
   * declare module 'vextjs' {
   *   interface VextApp { cache: RedisCache }
   * }
   */
  extend<K extends string, V>(key: K, value: V): void;

  /**
   * 替换全局校验引擎（插件专用）
   *
   * 默认：schema-dsl
   * 可替换为 Zod / Yup 等第三方校验库。
   *
   * @param validator 新的校验引擎实例
   */
  setValidator(validator: VextValidator): void;

  /**
   * 获取当前校验引擎
   * @returns 当前校验引擎实例
   */
  getValidator(): VextValidator;

  /**
   * 包装或替换 app.throw 的实现（插件专用）
   *
   * 默认：schema-dsl I18nError（支持多语言、错误码映射）
   * @param wrapper 接收原始实现，返回新实现
   */
  setThrow(wrapper: (original: VextApp["throw"]) => VextApp["throw"]): void;

  /**
   * 替换全局速率限制实现（插件专用）
   *
   * 默认：flex-rate-limit
   * @param limiter 新的速率限制器实例
   */
  setRateLimiter(limiter: VextRateLimiter): void;

  /**
   * 覆盖 requestId 生成算法（插件专用）
   *
   * 默认：crypto.randomUUID()
   * 常见替换：APM traceId、Snowflake ID 等。
   *
   * @param generate 新的 ID 生成函数
   */
  setRequestIdGenerator(generate: () => string): void;

  /**
   * 注册优雅关闭钩子（LIFO 顺序执行）
   *
   * SIGTERM/SIGINT 信号触发时，按注册的逆序执行所有关闭钩子。
   * 适合：关闭数据库连接、刷新日志缓冲区、取消定时任务等。
   *
   * @param handler 关闭时执行的回调
   *
   * @example
   * app.onClose(async () => {
   *   await app.db.disconnect()
   * })
   */
  onClose(handler: () => Promise<void> | void): void;

  /**
   * 注册就绪钩子（HTTP 监听后执行）
   *
   * 所有插件加载完成、HTTP 开始监听之后触发。
   * 适合：预热缓存、检查外部依赖、打印启动信息。
   *
   * @param handler 就绪时执行的回调
   *
   * @example
   * app.onReady(async () => {
   *   await warmupCache()
   *   app.logger.info('Cache warmed up')
   * })
   */
  onReady(handler: () => Promise<void> | void): void;

  /**
   * 注册全局 HTTP 中间件（插件专用）
   *
   * 对所有路由生效，在路由级 middlewares 之前执行。
   * 只能在插件 setup() 中调用，路由注册完成后调用将抛出错误。
   *
   * @param middleware 标准 VextMiddleware
   *
   * @example
   * // 在插件中注册全局安全头中间件
   * app.use(securityHeaders)
   */
  use(middleware: VextMiddleware): void;

  /**
   * 内置 HTTP 客户端（封装 Node.js fetch）
   *
   * 自动传播 requestId，结构化日志记录请求/响应。
   * 插件可通过 app.setFetch() 替换实现。
   *
   * @see 06d-fetch.md
   */
  fetch?: (url: string, options?: RequestInit) => Promise<Response>;

  // ── 允许插件扩展（declare module 方式）──────────────────
  [key: string]: unknown;
}

// ── 路由相关类型 ────────────────────────────────────────────

/**
 * 路由级中间件引用
 *
 * 字符串引用：对应 config.middlewares 白名单中的 name
 * 对象引用：带配置覆盖的中间件引用
 */
export type VextMiddlewareRef = string | { name: string; options?: unknown };

/**
 * OpenAPI 文档配置（路由级）
 *
 * 在路由 options.docs 中声明，控制 OpenAPI 文档生成行为。
 * 所有字段均可选，未声明时使用自动推断值。
 *
 * @see 14-openapi.md §1.1（docs 配置接口）
 */
export interface RouteDocsConfig {
  /** 接口摘要（一句话描述），映射到 OpenAPI operation.summary */
  summary?: string;

  /** 接口详细描述（支持 Markdown），映射到 OpenAPI operation.description */
  description?: string;

  /** 标签分组，映射到 OpenAPI operation.tags。默认从路由文件路径推断 */
  tags?: string[];

  /**
   * 操作标识（全局唯一），映射到 OpenAPI operation.operationId。
   * 默认自动推断：POST /users → 'createUsers'
   */
  operationId?: string;

  /** 是否从文档中隐藏此路由 @default false */
  hidden?: boolean;

  /** 是否已废弃，映射到 OpenAPI operation.deprecated @default false */
  deprecated?: boolean;

  /**
   * 安全方案覆盖。
   * 默认从 middlewares 推断（如 middlewares: ['auth'] → bearer token）。
   * 设为 [] 表示无需认证。
   */
  security?: Array<Record<string, string[]>>;

  /**
   * 自定义扩展字段（x- 前缀），映射到 OpenAPI operation 的 x-* 字段。
   */
  extensions?: Record<string, unknown>;

  /**
   * 响应定义，映射到 OpenAPI operation.responses。
   * key 为 HTTP 状态码（数字或字符串）。
   */
  responses?: Record<
    string | number,
    {
      /** 响应描述 */
      description?: string;
      /**
       * 响应体 schema（schema-dsl 字符串对象 或 引用字符串）
       */
      schema?: Record<string, unknown> | string;
      /** Content-Type @default 'application/json' */
      contentType?: string;
      /** 响应示例 */
      example?: unknown;
      /** 多个响应示例 */
      examples?: Record<
        string,
        {
          summary?: string;
          description?: string;
          value: unknown;
        }
      >;
      /** 响应头 */
      headers?: Record<
        string,
        {
          description?: string;
          schema?: { type: string };
        }
      >;
    }
  >;
}

/**
 * RouteOptions — 路由三段式的第二个参数（options）
 *
 * 声明式配置对象，描述中间件、参数校验、文档元信息等。
 * 暴露给文档生成工具，也用于框架内部的中间件组装。
 *
 * @example
 * app.post('/users', {
 *   validate: { body: { name: 'string:1-50', email: 'email' } },
 *   middlewares: ['auth'],
 *   docs: { summary: '创建用户', tags: ['用户'] },
 * }, handler)
 */
export interface RouteOptions {
  /**
   * 请求数据校验（schema-dsl DSL 对象）
   *
   * 框架内部统一调用 dsl() + validate()，用户无需 import schema-dsl。
   * 校验顺序：param → query → header → body
   */
  validate?: {
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
    param?: Record<string, unknown>;
    header?: Record<string, unknown>;
  };

  /**
   * 路由级中间件引用
   *
   * 在 config/default.ts 的 middlewares[] 白名单中声明后才可引用。
   * 字符串引用名称，对象可附带配置覆盖。
   */
  middlewares?: VextMiddlewareRef[];

  /**
   * OpenAPI 文档配置（可选）
   */
  docs?: RouteDocsConfig;

  /**
   * 路由级覆盖（覆盖 config/default.ts 中的全局配置）
   *
   * 第一期类型定稳但暂不实现。
   */
  override?: {
    rateLimit?: { max?: number; window?: number; keyBy?: string } | false;
    timeout?: number;
    maxBodySize?: string | number;
    cors?: VextCorsConfig;
  };
}

// ── 路由内部类型 ────────────────────────────────────────────

/**
 * 路由记录（内部数据结构）
 *
 * defineRoutes 收集到的单条路由信息，
 * 由 router-loader 调用 register() 注册到 adapter。
 */
export interface RouteRecord {
  /** HTTP 方法（大写） */
  method: string;
  /** 相对子路径（未含前缀） */
  path: string;
  /** 路由配置（validate / middlewares / docs） */
  options: RouteOptions;
  /** 路由处理函数 */
  handler: VextHandler;
}

/** 路由处理函数类型（从 middleware.ts 中的 VextHandler 对齐） */
type VextHandler = import("./middleware.js").VextHandler;
