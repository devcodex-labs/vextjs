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

import pino from 'pino'
import type { Logger as PinoLogger } from 'pino'
import { requestContext } from './request-context.js'
import type { VextLogger, VextLoggerConfig } from '../types/app.js'

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
      ;(pinoInstance.info as (...a: unknown[]) => void)(...args)
    },

    warn(...args: unknown[]) {
      ;(pinoInstance.warn as (...a: unknown[]) => void)(...args)
    },

    error(...args: unknown[]) {
      ;(pinoInstance.error as (...a: unknown[]) => void)(...args)
    },

    debug(...args: unknown[]) {
      ;(pinoInstance.debug as (...a: unknown[]) => void)(...args)
    },

    fatal(...args: unknown[]) {
      ;(pinoInstance.fatal as (...a: unknown[]) => void)(...args)
    },

    child(bindings: Record<string, unknown>): VextLogger {
      return wrapPinoAsVextLogger(pinoInstance.child(bindings))
    },
  }

  return logger
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
export function createLogger(config: VextLoggerConfig = {}): VextLogger {
  const level = config.level ?? 'info'
  const pretty = config.pretty ?? (process.env['NODE_ENV'] !== 'production')

  // ── pino 配置 ──────────────────────────────────────────

  const pinoOptions: pino.LoggerOptions = {
    level,

    /**
     * mixin hook — 每条日志写入前调用
     *
     * 从 AsyncLocalStorage（requestContext）读取当前请求的 requestId，
     * 自动附加到日志字段中。这确保了：
     *   - handler / service / 中间件中的所有日志都携带 requestId
     *   - 无需手动传入 requestId（零侵入）
     *   - 并发安全（每个请求有独立的 AsyncLocalStorage store）
     *
     * 当 store 不存在时（非请求上下文，如启动日志），不注入 requestId。
     */
    mixin() {
      const store = requestContext.getStore()
      if (store?.requestId) {
        return { requestId: store.requestId }
      }
      return {}
    },

    // 时间戳格式：ISO 8601（pino 默认是 epoch ms，改为人类可读格式）
    timestamp: pino.stdTimeFunctions.isoTime,
  }

  // ── transport 配置（pretty 模式）──────────────────────

  let pinoInstance: PinoLogger

  if (pretty) {
    // pino-pretty 作为 pino 内置 transport（pino v7+ 支持）
    // 开发环境使用彩色格式化输出，更易阅读
    pinoInstance = pino({
      ...pinoOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      },
    })
  } else {
    // 生产环境：纯 JSON 输出，适合日志收集系统（ELK、Datadog 等）
    pinoInstance = pino(pinoOptions)
  }

  return wrapPinoAsVextLogger(pinoInstance)
}
