/**
 * logger.ts — pino 封装 VextLogger
 *
 * 基于 pino 实现框架日志接口，支持：
 *   - pretty / JSON 双模式（开发环境可读、生产环境结构化）
 *   - requestId 自动注入（通过 pino mixin hook + AsyncLocalStorage，无需手动传入）
 *   - child logger（携带额外上下文字段，如 service 名称）
 *   - 日志级别动态控制（config.logger.level）
 *
 * 设计说明：
 *   pino 的 mixin 钩子在每条日志写入前调用，从 requestContext（AsyncLocalStorage）
 *   中读取当前请求的 requestId 并附加到日志字段。这样所有日志自动携带 requestId，
 *   无论是在 handler、service 还是中间件中调用 app.logger。
 *
 *   child logger 通过 pino.child(bindings) 实现，子 logger 继承父 logger 的
 *   mixin/level/transport 配置，并额外携带 bindings 中的字段。
 *
 * @module lib/logger
 * @see 06a-logger.md（VextLogger 接口 + 使用方式）
 * @see IMPLEMENTATION-PLAN.md 任务 1.7
 */

import pino from "pino";
import type { Logger as PinoLogger } from "pino";
import { requestContext } from "./request-context.js";
import type { VextLogger, VextLoggerConfig } from "../types/app.js";

// ── pino → VextLogger 适配 ──────────────────────────────────

/**
 * 将 pino Logger 实例包装为 VextLogger 接口
 *
 * pino 的方法签名与 VextLogger 完全兼容（msg + ...args 或 obj + msg + ...args），
 * 此函数只做接口适配，不做额外处理。
 *
 * @param pinoInstance pino Logger 实例
 * @returns VextLogger 实现
 */
function wrapPinoAsVextLogger(pinoInstance: PinoLogger): VextLogger {
  const logger: VextLogger = {
    info(...args: unknown[]) {
      (pinoInstance.info as (...a: unknown[]) => void)(...args);
    },

    warn(...args: unknown[]) {
      (pinoInstance.warn as (...a: unknown[]) => void)(...args);
    },

    error(...args: unknown[]) {
      (pinoInstance.error as (...a: unknown[]) => void)(...args);
    },

    debug(...args: unknown[]) {
      (pinoInstance.debug as (...a: unknown[]) => void)(...args);
    },

    fatal(...args: unknown[]) {
      (pinoInstance.fatal as (...a: unknown[]) => void)(...args);
    },

    child(bindings: Record<string, unknown>): VextLogger {
      return wrapPinoAsVextLogger(pinoInstance.child(bindings));
    },
  };

  return logger;
}

// ── 工厂函数 ────────────────────────────────────────────────

/**
 * 创建 VextLogger 实例
 *
 * 根据配置创建 pino 实例并包装为 VextLogger 接口。
 *
 * 功能：
 *   1. 日志级别由 config.logger.level 控制（默认 'info'）
 *   2. pretty 模式使用 pino-pretty transport（开发环境友好）
 *   3. JSON 模式直接输出结构化 JSON（生产环境，适合日志收集系统）
 *   4. mixin hook 自动从 requestContext 注入 requestId
 *
 * @param config 日志配置（来自 VextConfig.logger）
 * @returns VextLogger 实例
 *
 * @example
 * ```typescript
 * import { createLogger } from './logger.js'
 *
 * const logger = createLogger({ level: 'debug', pretty: true })
 * logger.info('服务启动')
 * logger.debug({ port: 3000 }, '监听端口')
 * logger.child({ service: 'UserService' }).info('创建用户')
 * ```
 */

/**
 * 空 mixin 占位对象（模块顶层常量）
 *
 * 用于 config.mixin 未配置时的无分支快速返回。
 * 注意：mixin() 最终返回的始终是通过 spread 新建的 result 对象，
 * pino 的 object mutation 只影响 result，不会污染此共享常量（BUG-012 防回归）。
 */
const EMPTY_MIXIN: Record<string, unknown> = {};

export function createLogger(
  config: VextLoggerConfig = {},
  options?: { requestContextEnabled?: boolean }
): VextLogger {
  const level = config.level ?? "info";
  const pretty = config.pretty ?? process.env.NODE_ENV !== "production";
  const alsEnabled = options?.requestContextEnabled !== false;

  // pino-pretty ignore 字段：默认隐藏 pid, hostname, requestId
  // requestId 仍通过 mixin 注入到 JSON 日志中（生产环境不受影响），
  // 但在 pretty 模式下隐藏以避免多行噪音。用户可通过 prettyIgnore 自定义。
  const prettyIgnoreFields = config.prettyIgnore ?? "pid,hostname,requestId";

  // pino-pretty singleLine：默认 true，将额外字段压缩到消息同一行，
  // 避免结构化字段（如 count、service 等）被展开为多行噪音。
  // 设为 false 可恢复 pino-pretty 默认的多行展开格式。
  const prettySingleLine = config.prettySingleLine !== false;

  // mixin 异常降级状态标志（防日志风暴：相同错误仅 warn 一次）
  let _mixinWarnEmitted = false;

  // ⚠️ 前向引用：pinoInstance 在 pinoOptions 之后赋值，
  // 但 mixin() 仅在日志写入时被 pino 调用（非初始化阶段），届时已赋值，运行时安全。
  let pinoInstance: PinoLogger;

  // ── pino 配置 ──────────────────────────────────────────

  const pinoOptions: pino.LoggerOptions = {
    level,

    /**
     * mixin hook — 每条日志写入前调用
     *
     * 合并框架内置字段（requestId / trace_id / span_id）与用户自定义 mixin，
     * 确保每条日志都携带请求级追踪信息，支持日志与链路追踪系统的关联查询。
     *
     * 合并优先级（从低到高）：
     *   1. 框架内置字段（ALS requestId、trace_id、span_id）
     *   2. 用户 config.mixin() 返回值（可覆盖 trace_id / span_id，但不能覆盖 requestId）
     *
     * requestId 保护规则：
     *   - ALS 中有值时：强制使用框架值，不允许用户 mixin 覆盖
     *   - ALS 中无值时：删除 requestId key（防止用户 mixin 注入此字段）
     *   结果对象中永远不含 requestId: undefined key，
     *   避免自定义序列化器或 Vitest toEqual 断言的意外行为。
     *
     * ⚠️ 返回的 result 始终是通过 spread 新建的对象，
     * pino 的 object mutation 只影响 result，不污染 EMPTY_MIXIN 共享常量（BUG-012 防回归）。
     */
    mixin() {
      // ── 层1：框架内置字段（ALS requestId + trace context）──────
      const builtIn: Record<string, unknown> = {};

      if (alsEnabled) {
        const store = requestContext.getStore();
        // requestId：框架核心追踪字段，最终会被强制保护（见下方合并逻辑）
        if (store?.requestId) builtIn.requestId = store.requestId;
        // F-03：ALS trace context 自动注入（若中间件已写入）
        if (store?.traceId) builtIn.trace_id = store.traceId;
        if (store?.spanId) builtIn.span_id = store.spanId;
      }

      // ── 层2：用户自定义 mixin（可覆盖非 requestId 字段）────────
      const userFields: Record<string, unknown> = (() => {
        if (!config.mixin) return EMPTY_MIXIN;
        try {
          const mixinResult = config.mixin();
          // 防御：用户误传 async 函数时 mixinResult 是 Promise 对象，
          // 直接展开会导致日志中出现 Promise 序列化的意外字段，降级处理
          if (
            mixinResult !== null &&
            typeof mixinResult === "object" &&
            typeof (mixinResult as Record<string, unknown>)["then"] ===
              "function"
          ) {
            if (!_mixinWarnEmitted) {
              _mixinWarnEmitted = true;
              // pinoInstance 此时已赋值（mixin 仅在日志写入时调用，非初始化时）
              pinoInstance.warn(
                "[vextjs] config.logger.mixin 返回了 Promise，mixin 必须是同步函数，已降级为 {}"
              );
            }
            return EMPTY_MIXIN;
          }
          return mixinResult ?? EMPTY_MIXIN;
        } catch (err) {
          if (!_mixinWarnEmitted) {
            _mixinWarnEmitted = true;
            // pinoInstance 此时已赋值（mixin 仅在日志写入时调用，非初始化时）
            pinoInstance.warn(
              { err },
              "[vextjs] config.logger.mixin 抛出异常，已降级为 {}"
            );
          }
          return EMPTY_MIXIN;
        }
      })();

      // ── 合并：builtIn 先、userFields 后；requestId 强制保护 ────
      // spread 操作始终创建新对象，pino 的 object mutation 只影响 result，
      // 不会污染 EMPTY_MIXIN 共享常量（BUG-012 防回归）
      const result: Record<string, unknown> = { ...builtIn, ...userFields };

      // requestId 保护：
      //   有值时强制用框架值覆盖 → 不允许用户 mixin 覆盖
      //   无值时 delete key   → 防止用户 mixin 注入 requestId key
      if (builtIn.requestId !== undefined) {
        result.requestId = builtIn.requestId;
      } else {
        delete result.requestId;
      }

      return result;
    },

    // 时间戳格式：ISO 8601（pino 默认是 epoch ms，改为人类可读格式）
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  // ── transport 配置（pretty 模式）──────────────────────

  if (pretty) {
    // pino-pretty 作为 pino 内置 transport（pino v7+ 支持）
    // 开发环境使用彩色格式化输出，更易阅读
    pinoInstance = pino({
      ...pinoOptions,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
          ignore: prettyIgnoreFields,
          singleLine: prettySingleLine,
        },
      },
    });
  } else {
    // 生产环境：纯 JSON 输出，适合日志收集系统（ELK、Datadog 等）
    pinoInstance = pino(pinoOptions);
  }

  return wrapPinoAsVextLogger(pinoInstance);
}
