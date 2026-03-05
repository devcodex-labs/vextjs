import { describe, it, expect, vi, beforeEach } from "vitest"

import { createAccessLogMiddleware } from "../../src/lib/middlewares/access-log.js"
import type { VextAccessLogConfig } from "../../src/types/app.js"

// ── 测试工具 ────────────────────────────────────────────────

/**
 * 创建模拟的 VextLogger
 */
function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  }
}

/**
 * 创建模拟的 VextRequest
 */
function createMockReq(overrides: Record<string, unknown> = {}): any {
  return {
    method: "GET",
    path: "/users",
    url: "/users?page=1",
    headers: {},
    requestId: "req-123",
    ip: "127.0.0.1",
    app: {
      logger: createMockLogger(),
    },
    ...overrides,
  }
}

/**
 * 创建模拟的 VextResponse（带 statusCode getter）
 */
function createMockRes(overrides: Record<string, unknown> = {}): any {
  return {
    statusCode: 200,
    setHeader: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    _enableWrap: vi.fn(),
    ...overrides,
  }
}

/**
 * 创建一个简单的 next 函数
 *
 * @param delay 模拟下游处理耗时（毫秒）
 * @param sideEffect 在 next 内执行的副作用（如修改 res.statusCode）
 */
function createNext(
  delay: number = 0,
  sideEffect?: () => void,
): () => Promise<void> {
  return async () => {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    if (sideEffect) {
      sideEffect()
    }
  }
}

// ── 测试 ────────────────────────────────────────────────────

describe("createAccessLogMiddleware", () => {
  let logger: ReturnType<typeof createMockLogger>

  beforeEach(() => {
    logger = createMockLogger()
    vi.restoreAllMocks()
  })

  // ── 基本功能 ────────────────────────────────────────────

  describe("基本功能", () => {
    it("应创建一个有效的中间件函数", () => {
      const middleware = createAccessLogMiddleware({}, logger)

      expect(typeof middleware).toBe("function")
      expect(middleware.length).toBe(3) // (req, res, next)
    })

    it("应在 await next() 后记录日志", async () => {
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq()
      const res = createMockRes()
      const next = createNext()

      await middleware(req, res, next)

      expect(logger.info).toHaveBeenCalledTimes(1)
    })

    it("日志应包含 method 字段", async () => {
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq({ method: "POST" })
      const res = createMockRes()

      await middleware(req, res, createNext())

      const logObj = logger.info.mock.calls[0][0]
      expect(logObj.method).toBe("POST")
    })

    it("日志应包含 path 字段", async () => {
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq({ path: "/api/users" })
      const res = createMockRes()

      await middleware(req, res, createNext())

      const logObj = logger.info.mock.calls[0][0]
      expect(logObj.path).toBe("/api/users")
    })

    it("日志应包含 statusCode 字段", async () => {
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq()
      const res = createMockRes({ statusCode: 201 })

      await middleware(req, res, createNext())

      const logObj = logger.info.mock.calls[0][0]
      expect(logObj.statusCode).toBe(201)
    })

    it("日志应包含 responseTime 字段（非负数）", async () => {
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq()
      const res = createMockRes()

      await middleware(req, res, createNext())

      const logObj = logger.info.mock.calls[0][0]
      expect(typeof logObj.responseTime).toBe("number")
      expect(logObj.responseTime).toBeGreaterThanOrEqual(0)
    })

    it("日志应包含 requestId 字段", async () => {
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq({ requestId: "abc-123" })
      const res = createMockRes()

      await middleware(req, res, createNext())

      const logObj = logger.info.mock.calls[0][0]
      expect(logObj.requestId).toBe("abc-123")
    })

    it("日志应包含 ip 字段", async () => {
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq({ ip: "192.168.1.100" })
      const res = createMockRes()

      await middleware(req, res, createNext())

      const logObj = logger.info.mock.calls[0][0]
      expect(logObj.ip).toBe("192.168.1.100")
    })

    it("日志消息应包含 method、path、statusCode 和 responseTime", async () => {
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq({ method: "GET", path: "/test" })
      const res = createMockRes({ statusCode: 200 })

      await middleware(req, res, createNext())

      const logMsg = logger.info.mock.calls[0][1]
      expect(logMsg).toContain("GET")
      expect(logMsg).toContain("/test")
      expect(logMsg).toContain("200")
      expect(logMsg).toContain("ms")
    })
  })

  // ── 洋葱模型 ──────────────────────────────────────────

  describe("洋葱模型（after-middleware）", () => {
    it("应在 next() 之后读取 statusCode", async () => {
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq()
      // 模拟 handler 在执行时修改 statusCode
      const res = createMockRes({ statusCode: 200 })
      const next = createNext(0, () => {
        res.statusCode = 404
      })

      await middleware(req, res, next)

      const logObj = logger.info.mock.calls[0][0]
      expect(logObj.statusCode).toBe(404)
    })

    it("应正确测量包含异步操作的 responseTime", async () => {
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq()
      const res = createMockRes()
      // 模拟 50ms 处理耗时
      const next = createNext(50)

      await middleware(req, res, next)

      const logObj = logger.info.mock.calls[0][0]
      expect(logObj.responseTime).toBeGreaterThanOrEqual(40)
    })

    it("即使 next() 抛出错误也应传播（不吞掉异常）", async () => {
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq()
      const res = createMockRes()
      const errorNext = async () => {
        throw new Error("handler error")
      }

      await expect(middleware(req, res, errorNext)).rejects.toThrow(
        "handler error",
      )
    })

    it("next() 抛出错误时不应记录日志（异常由错误处理中间件处理）", async () => {
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq()
      const res = createMockRes()
      const errorNext = async () => {
        throw new Error("handler error")
      }

      try {
        await middleware(req, res, errorNext)
      } catch {
        // 预期异常
      }

      // 异常时 await next() 后的代码不会执行，因此不记录日志
      expect(logger.info).not.toHaveBeenCalled()
    })

    it("应调用 next()（中间件链不能中断）", async () => {
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq()
      const res = createMockRes()
      const nextFn = vi.fn().mockResolvedValue(undefined)

      await middleware(req, res, nextFn)

      expect(nextFn).toHaveBeenCalledTimes(1)
    })
  })

  // ── config.enabled ────────────────────────────────────

  describe("config.enabled", () => {
    it("enabled 默认为 true（不传入 enabled 时记录日志）", async () => {
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq()
      const res = createMockRes()

      await middleware(req, res, createNext())

      expect(logger.info).toHaveBeenCalledTimes(1)
    })

    it("enabled: true 时记录日志", async () => {
      const middleware = createAccessLogMiddleware({ enabled: true }, logger)
      const req = createMockReq()
      const res = createMockRes()

      await middleware(req, res, createNext())

      expect(logger.info).toHaveBeenCalledTimes(1)
    })

    it("enabled: false 时不记录日志", async () => {
      const middleware = createAccessLogMiddleware({ enabled: false }, logger)
      const req = createMockReq()
      const res = createMockRes()

      await middleware(req, res, createNext())

      expect(logger.info).not.toHaveBeenCalled()
      expect(logger.debug).not.toHaveBeenCalled()
    })

    it("enabled: false 时仍然调用 next()", async () => {
      const middleware = createAccessLogMiddleware({ enabled: false }, logger)
      const req = createMockReq()
      const res = createMockRes()
      const nextFn = vi.fn().mockResolvedValue(undefined)

      await middleware(req, res, nextFn)

      expect(nextFn).toHaveBeenCalledTimes(1)
    })

    it("enabled: false 时零开销（不计算 responseTime）", async () => {
      const middleware = createAccessLogMiddleware({ enabled: false }, logger)
      const req = createMockReq()
      const res = createMockRes()

      // 只要不报错、next 被调用、不记日志即可
      const nextFn = vi.fn().mockResolvedValue(undefined)
      await middleware(req, res, nextFn)

      expect(nextFn).toHaveBeenCalledTimes(1)
      expect(logger.info).not.toHaveBeenCalled()
    })
  })

  // ── config.level ──────────────────────────────────────

  describe("config.level", () => {
    it("level 默认为 'info'", async () => {
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq()
      const res = createMockRes()

      await middleware(req, res, createNext())

      expect(logger.info).toHaveBeenCalledTimes(1)
      expect(logger.debug).not.toHaveBeenCalled()
    })

    it("level: 'info' 时使用 logger.info", async () => {
      const middleware = createAccessLogMiddleware({ level: "info" }, logger)
      const req = createMockReq()
      const res = createMockRes()

      await middleware(req, res, createNext())

      expect(logger.info).toHaveBeenCalledTimes(1)
      expect(logger.debug).not.toHaveBeenCalled()
    })

    it("level: 'debug' 时使用 logger.debug", async () => {
      const middleware = createAccessLogMiddleware({ level: "debug" }, logger)
      const req = createMockReq()
      const res = createMockRes()

      await middleware(req, res, createNext())

      expect(logger.debug).toHaveBeenCalledTimes(1)
      expect(logger.info).not.toHaveBeenCalled()
    })

    it("level: 'debug' 时日志内容与 'info' 格式一致", async () => {
      const middleware = createAccessLogMiddleware({ level: "debug" }, logger)
      const req = createMockReq({ method: "PUT", path: "/api/data" })
      const res = createMockRes({ statusCode: 202 })

      await middleware(req, res, createNext())

      const logObj = logger.debug.mock.calls[0][0]
      expect(logObj.method).toBe("PUT")
      expect(logObj.path).toBe("/api/data")
      expect(logObj.statusCode).toBe(202)
      expect(typeof logObj.responseTime).toBe("number")
      expect(logObj.requestId).toBeDefined()
      expect(logObj.ip).toBeDefined()
    })
  })

  // ── config.skipPaths ──────────────────────────────────

  describe("config.skipPaths", () => {
    it("skipPaths 默认为空（记录所有路径）", async () => {
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq({ path: "/health" })
      const res = createMockRes()

      await middleware(req, res, createNext())

      expect(logger.info).toHaveBeenCalledTimes(1)
    })

    it("skipPaths 为空数组时记录所有路径", async () => {
      const middleware = createAccessLogMiddleware(
        { skipPaths: [] },
        logger,
      )
      const req = createMockReq({ path: "/health" })
      const res = createMockRes()

      await middleware(req, res, createNext())

      expect(logger.info).toHaveBeenCalledTimes(1)
    })

    it("skipPaths 匹配时跳过日志", async () => {
      const middleware = createAccessLogMiddleware(
        { skipPaths: ["/health", "/ready"] },
        logger,
      )
      const req = createMockReq({ path: "/health" })
      const res = createMockRes()

      await middleware(req, res, createNext())

      expect(logger.info).not.toHaveBeenCalled()
    })

    it("skipPaths 匹配时仍调用 next()", async () => {
      const middleware = createAccessLogMiddleware(
        { skipPaths: ["/health"] },
        logger,
      )
      const req = createMockReq({ path: "/health" })
      const res = createMockRes()
      const nextFn = vi.fn().mockResolvedValue(undefined)

      await middleware(req, res, nextFn)

      expect(nextFn).toHaveBeenCalledTimes(1)
    })

    it("skipPaths 不匹配时正常记录日志", async () => {
      const middleware = createAccessLogMiddleware(
        { skipPaths: ["/health", "/ready"] },
        logger,
      )
      const req = createMockReq({ path: "/api/users" })
      const res = createMockRes()

      await middleware(req, res, createNext())

      expect(logger.info).toHaveBeenCalledTimes(1)
    })

    it("skipPaths 是精确匹配（不匹配子路径）", async () => {
      const middleware = createAccessLogMiddleware(
        { skipPaths: ["/health"] },
        logger,
      )
      const req = createMockReq({ path: "/health/detailed" })
      const res = createMockRes()

      await middleware(req, res, createNext())

      expect(logger.info).toHaveBeenCalledTimes(1)
    })

    it("skipPaths 多个路径全部生效", async () => {
      const config: VextAccessLogConfig = {
        skipPaths: ["/health", "/ready", "/metrics"],
      }
      const middleware = createAccessLogMiddleware(config, logger)

      for (const p of ["/health", "/ready", "/metrics"]) {
        const req = createMockReq({ path: p })
        const res = createMockRes()
        await middleware(req, res, createNext())
      }

      expect(logger.info).not.toHaveBeenCalled()
    })

    it("skipPaths 区分大小写", async () => {
      const middleware = createAccessLogMiddleware(
        { skipPaths: ["/Health"] },
        logger,
      )
      const req = createMockReq({ path: "/health" })
      const res = createMockRes()

      await middleware(req, res, createNext())

      // /health !== /Health，不跳过
      expect(logger.info).toHaveBeenCalledTimes(1)
    })
  })

  // ── HTTP 方法覆盖 ─────────────────────────────────────

  describe("HTTP 方法覆盖", () => {
    const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]

    for (const method of methods) {
      it(`应正确记录 ${method} 请求`, async () => {
        const middleware = createAccessLogMiddleware({}, logger)
        const req = createMockReq({ method })
        const res = createMockRes()

        await middleware(req, res, createNext())

        const logObj = logger.info.mock.calls[0][0]
        expect(logObj.method).toBe(method)
      })
    }
  })

  // ── 状态码覆盖 ────────────────────────────────────────

  describe("状态码覆盖", () => {
    const statusCodes = [200, 201, 204, 301, 302, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503]

    for (const code of statusCodes) {
      it(`应正确记录 HTTP ${code} 状态码`, async () => {
        const middleware = createAccessLogMiddleware({}, logger)
        const req = createMockReq()
        const res = createMockRes({ statusCode: code })

        await middleware(req, res, createNext())

        const logObj = logger.info.mock.calls[0][0]
        expect(logObj.statusCode).toBe(code)
      })
    }
  })

  // ── 组合配置 ──────────────────────────────────────────

  describe("组合配置", () => {
    it("enabled: true + level: 'debug' + skipPaths 组合", async () => {
      const config: VextAccessLogConfig = {
        enabled: true,
        level: "debug",
        skipPaths: ["/health"],
      }
      const middleware = createAccessLogMiddleware(config, logger)

      // 跳过 /health
      const reqHealth = createMockReq({ path: "/health" })
      await middleware(reqHealth, createMockRes(), createNext())
      expect(logger.debug).not.toHaveBeenCalled()

      // 记录 /api/users（使用 debug 级别）
      const reqApi = createMockReq({ path: "/api/users", method: "POST" })
      const resApi = createMockRes({ statusCode: 201 })
      await middleware(reqApi, resApi, createNext())
      expect(logger.debug).toHaveBeenCalledTimes(1)
      expect(logger.info).not.toHaveBeenCalled()

      const logObj = logger.debug.mock.calls[0][0]
      expect(logObj.method).toBe("POST")
      expect(logObj.path).toBe("/api/users")
      expect(logObj.statusCode).toBe(201)
    })

    it("enabled: false 时 skipPaths 和 level 不影响行为", async () => {
      const config: VextAccessLogConfig = {
        enabled: false,
        level: "debug",
        skipPaths: ["/health"],
      }
      const middleware = createAccessLogMiddleware(config, logger)

      const req = createMockReq({ path: "/api/users" })
      const res = createMockRes()
      const nextFn = vi.fn().mockResolvedValue(undefined)

      await middleware(req, res, nextFn)

      expect(nextFn).toHaveBeenCalledTimes(1)
      expect(logger.info).not.toHaveBeenCalled()
      expect(logger.debug).not.toHaveBeenCalled()
    })
  })

  // ── 空配置 / 默认行为 ─────────────────────────────────

  describe("空配置 / 默认行为", () => {
    it("空对象配置应使用所有默认值", async () => {
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq()
      const res = createMockRes()

      await middleware(req, res, createNext())

      // 默认 enabled=true, level='info', skipPaths=[]
      expect(logger.info).toHaveBeenCalledTimes(1)
    })

    it("undefined 字段应被忽略并使用默认值", async () => {
      const config: VextAccessLogConfig = {
        enabled: undefined,
        level: undefined,
        skipPaths: undefined,
      }
      const middleware = createAccessLogMiddleware(config, logger)
      const req = createMockReq()
      const res = createMockRes()

      await middleware(req, res, createNext())

      expect(logger.info).toHaveBeenCalledTimes(1)
    })
  })

  // ── 并发请求 ──────────────────────────────────────────

  describe("并发请求", () => {
    it("多个并发请求应各自独立记录", async () => {
      const middleware = createAccessLogMiddleware({}, logger)

      const requests = [
        { method: "GET", path: "/a", statusCode: 200 },
        { method: "POST", path: "/b", statusCode: 201 },
        { method: "DELETE", path: "/c", statusCode: 204 },
      ]

      await Promise.all(
        requests.map((r) => {
          const req = createMockReq({ method: r.method, path: r.path })
          const res = createMockRes({ statusCode: r.statusCode })
          return middleware(req, res, createNext(10))
        }),
      )

      expect(logger.info).toHaveBeenCalledTimes(3)

      // 验证每个请求都被正确记录（顺序不确定，用 Set 验证）
      const loggedPaths = new Set(
        logger.info.mock.calls.map((call: any[]) => call[0].path),
      )
      expect(loggedPaths).toEqual(new Set(["/a", "/b", "/c"]))
    })
  })

  // ── 边界情况 ──────────────────────────────────────────

  describe("边界情况", () => {
    it("path 为根路径 '/' 应正常记录", async () => {
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq({ path: "/" })
      const res = createMockRes()

      await middleware(req, res, createNext())

      const logObj = logger.info.mock.calls[0][0]
      expect(logObj.path).toBe("/")
    })

    it("requestId 为空字符串应正常记录", async () => {
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq({ requestId: "" })
      const res = createMockRes()

      await middleware(req, res, createNext())

      const logObj = logger.info.mock.calls[0][0]
      expect(logObj.requestId).toBe("")
    })

    it("ip 为 IPv6 地址应正常记录", async () => {
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq({ ip: "::1" })
      const res = createMockRes()

      await middleware(req, res, createNext())

      const logObj = logger.info.mock.calls[0][0]
      expect(logObj.ip).toBe("::1")
    })

    it("极长路径应正常记录", async () => {
      const longPath = `/${"a".repeat(1000)}`
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq({ path: longPath })
      const res = createMockRes()

      await middleware(req, res, createNext())

      const logObj = logger.info.mock.calls[0][0]
      expect(logObj.path).toBe(longPath)
    })

    it("skipPaths 为 '/' 时应跳过根路径", async () => {
      const middleware = createAccessLogMiddleware(
        { skipPaths: ["/"] },
        logger,
      )
      const req = createMockReq({ path: "/" })
      const res = createMockRes()

      await middleware(req, res, createNext())

      expect(logger.info).not.toHaveBeenCalled()
    })

    it("statusCode 为 0 时（响应尚未设置）应正常记录", async () => {
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq()
      const res = createMockRes({ statusCode: 0 })

      await middleware(req, res, createNext())

      const logObj = logger.info.mock.calls[0][0]
      expect(logObj.statusCode).toBe(0)
    })

    it("同一中间件实例可连续处理多个请求", async () => {
      const middleware = createAccessLogMiddleware({}, logger)

      for (let i = 0; i < 5; i++) {
        const req = createMockReq({ path: `/req-${i}` })
        const res = createMockRes({ statusCode: 200 + i })
        await middleware(req, res, createNext())
      }

      expect(logger.info).toHaveBeenCalledTimes(5)

      for (let i = 0; i < 5; i++) {
        const logObj = logger.info.mock.calls[i][0]
        expect(logObj.path).toBe(`/req-${i}`)
        expect(logObj.statusCode).toBe(200 + i)
      }
    })
  })

  // ── logger 方法绑定 ───────────────────────────────────

  describe("logger 方法绑定", () => {
    it("logger.info 的 this 绑定正确（不因解构丢失）", async () => {
      // 模拟 pino 之类需要正确 this 绑定的 logger
      const infoFn = vi.fn()
      const boundLogger = {
        ...createMockLogger(),
        info: infoFn,
      }
      const middleware = createAccessLogMiddleware(
        { level: "info" },
        boundLogger,
      )
      const req = createMockReq()
      const res = createMockRes()

      await middleware(req, res, createNext())

      expect(infoFn).toHaveBeenCalledTimes(1)
    })

    it("logger.debug 的 this 绑定正确", async () => {
      const debugFn = vi.fn()
      const boundLogger = {
        ...createMockLogger(),
        debug: debugFn,
      }
      const middleware = createAccessLogMiddleware(
        { level: "debug" },
        boundLogger,
      )
      const req = createMockReq()
      const res = createMockRes()

      await middleware(req, res, createNext())

      expect(debugFn).toHaveBeenCalledTimes(1)
    })
  })

  // ── 日志格式 ──────────────────────────────────────────

  describe("日志格式", () => {
    it("第一个参数应为结构化对象，第二个参数应为格式化字符串", async () => {
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq({ method: "GET", path: "/test" })
      const res = createMockRes({ statusCode: 200 })

      await middleware(req, res, createNext())

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: "/test",
          statusCode: 200,
          responseTime: expect.any(Number),
          requestId: expect.any(String),
          ip: expect.any(String),
        }),
        expect.stringContaining("GET /test 200"),
      )
    })

    it("格式化字符串应包含 responseTime 单位 'ms'", async () => {
      const middleware = createAccessLogMiddleware({}, logger)
      const req = createMockReq()
      const res = createMockRes()

      await middleware(req, res, createNext())

      const logMsg = logger.info.mock.calls[0][1]
      expect(logMsg).toMatch(/\d+ms$/)
    })
  })

  // ── skipPaths 性能（Set 查找）──────────────────────────

  describe("skipPaths 性能", () => {
    it("大量 skipPaths 不影响正确性", async () => {
      const skipPaths = Array.from({ length: 100 }, (_, i) => `/skip-${i}`)
      const middleware = createAccessLogMiddleware({ skipPaths }, logger)

      // 匹配的路径应跳过
      const reqSkip = createMockReq({ path: "/skip-50" })
      await middleware(reqSkip, createMockRes(), createNext())
      expect(logger.info).not.toHaveBeenCalled()

      // 不匹配的路径应记录
      const reqLog = createMockReq({ path: "/api/users" })
      await middleware(reqLog, createMockRes(), createNext())
      expect(logger.info).toHaveBeenCalledTimes(1)
    })
  })
})
