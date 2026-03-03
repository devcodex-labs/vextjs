import { describe, it, expect, vi, beforeEach } from "vitest"

import {
  HotSwappableHandler,
  type RequestHandler,
} from "../../src/lib/dev/hot-swappable-handler.js"

// ── 测试工具 ────────────────────────────────────────────────

/**
 * 创建模拟的 Node.js IncomingMessage
 */
function createMockReq(overrides: Record<string, unknown> = {}): any {
  return {
    method: "GET",
    url: "/",
    headers: {},
    ...overrides,
  }
}

/**
 * 创建模拟的 Node.js ServerResponse
 */
function createMockRes(): any {
  return {
    statusCode: 200,
    end: vi.fn(),
    setHeader: vi.fn(),
    writeHead: vi.fn(),
    write: vi.fn(),
  }
}

/**
 * 创建一个可追踪调用的 handler
 */
function createTrackingHandler(
  id: string = "default",
): RequestHandler & { calls: Array<{ req: any; res: any; id: string }> } {
  const calls: Array<{ req: any; res: any; id: string }> = []
  const handler = ((req: any, res: any) => {
    calls.push({ req, res, id })
  }) as RequestHandler & { calls: Array<{ req: any; res: any; id: string }> }
  handler.calls = calls
  return handler
}

// ── 测试 ────────────────────────────────────────────────────

describe("HotSwappableHandler", () => {
  // ── 构造函数 ────────────────────────────────────────────

  describe("constructor", () => {
    it("应正确接受初始 handler", () => {
      const handler = createTrackingHandler()
      const hot = new HotSwappableHandler(handler)

      expect(hot.getCurrentHandler()).toBe(handler)
    })

    it("初始 reloadCount 应为 0", () => {
      const handler = createTrackingHandler()
      const hot = new HotSwappableHandler(handler)

      expect(hot.getReloadCount()).toBe(0)
    })

    it("初始 lastSwapTime 应为 null", () => {
      const handler = createTrackingHandler()
      const hot = new HotSwappableHandler(handler)

      expect(hot.getLastSwapTime()).toBeNull()
    })
  })

  // ── handle 方法 ─────────────────────────────────────────

  describe("handle", () => {
    it("应调用当前 handler 处理请求", () => {
      const handler = createTrackingHandler()
      const hot = new HotSwappableHandler(handler)
      const req = createMockReq()
      const res = createMockRes()

      hot.handle(req, res)

      expect(handler.calls).toHaveLength(1)
      expect(handler.calls[0].req).toBe(req)
      expect(handler.calls[0].res).toBe(res)
    })

    it("多次调用 handle 应每次都路由到当前 handler", () => {
      const handler = createTrackingHandler()
      const hot = new HotSwappableHandler(handler)

      for (let i = 0; i < 5; i++) {
        hot.handle(createMockReq(), createMockRes())
      }

      expect(handler.calls).toHaveLength(5)
    })

    it("handle 是箭头函数，解构传递后 this 绑定正确", () => {
      const handler = createTrackingHandler()
      const hot = new HotSwappableHandler(handler)

      // 模拟 createServer(hot.handle) 的解构传递
      const detachedHandle = hot.handle
      const req = createMockReq()
      const res = createMockRes()

      // 不应抛出 TypeError（this 绑定丢失）
      expect(() => detachedHandle(req, res)).not.toThrow()
      expect(handler.calls).toHaveLength(1)
    })

    it("handle 传递正确的 req 和 res 引用（不复制）", () => {
      const handler = vi.fn()
      const hot = new HotSwappableHandler(handler)
      const req = createMockReq({ url: "/test" })
      const res = createMockRes()

      hot.handle(req, res)

      expect(handler).toHaveBeenCalledWith(req, res)
      // 确认是同一个引用
      expect(handler.mock.calls[0][0]).toBe(req)
      expect(handler.mock.calls[0][1]).toBe(res)
    })
  })

  // ── swap 方法 ──────────────────────────────────────────

  describe("swap", () => {
    it("swap 后新请求应走新 handler", () => {
      const oldHandler = createTrackingHandler("old")
      const newHandler = createTrackingHandler("new")
      const hot = new HotSwappableHandler(oldHandler)

      hot.swap(newHandler)

      const req = createMockReq()
      const res = createMockRes()
      hot.handle(req, res)

      expect(oldHandler.calls).toHaveLength(0)
      expect(newHandler.calls).toHaveLength(1)
      expect(newHandler.calls[0].id).toBe("new")
    })

    it("swap 前的请求走旧 handler，swap 后的请求走新 handler", () => {
      const handlerA = createTrackingHandler("A")
      const handlerB = createTrackingHandler("B")
      const hot = new HotSwappableHandler(handlerA)

      // swap 前发 2 个请求
      hot.handle(createMockReq(), createMockRes())
      hot.handle(createMockReq(), createMockRes())

      // swap
      hot.swap(handlerB)

      // swap 后发 3 个请求
      hot.handle(createMockReq(), createMockRes())
      hot.handle(createMockReq(), createMockRes())
      hot.handle(createMockReq(), createMockRes())

      expect(handlerA.calls).toHaveLength(2)
      expect(handlerB.calls).toHaveLength(3)
    })

    it("多次 swap 应始终使用最新的 handler", () => {
      const handlers = Array.from({ length: 5 }, (_, i) =>
        createTrackingHandler(`handler-${i}`),
      )
      const hot = new HotSwappableHandler(handlers[0])

      for (let i = 1; i < handlers.length; i++) {
        hot.swap(handlers[i])
      }

      hot.handle(createMockReq(), createMockRes())

      // 只有最后一个 handler 应被调用
      for (let i = 0; i < handlers.length - 1; i++) {
        expect(handlers[i].calls).toHaveLength(0)
      }
      expect(handlers[handlers.length - 1].calls).toHaveLength(1)
    })

    it("swap 应递增 reloadCount", () => {
      const hot = new HotSwappableHandler(createTrackingHandler())

      expect(hot.getReloadCount()).toBe(0)

      hot.swap(createTrackingHandler())
      expect(hot.getReloadCount()).toBe(1)

      hot.swap(createTrackingHandler())
      expect(hot.getReloadCount()).toBe(2)

      hot.swap(createTrackingHandler())
      expect(hot.getReloadCount()).toBe(3)
    })

    it("swap 应更新 lastSwapTime", () => {
      const hot = new HotSwappableHandler(createTrackingHandler())

      expect(hot.getLastSwapTime()).toBeNull()

      const before = Date.now()
      hot.swap(createTrackingHandler())
      const after = Date.now()

      const swapTime = hot.getLastSwapTime()
      expect(swapTime).not.toBeNull()
      expect(swapTime!).toBeGreaterThanOrEqual(before)
      expect(swapTime!).toBeLessThanOrEqual(after)
    })

    it("多次 swap 后 lastSwapTime 应为最近一次的时间", () => {
      const hot = new HotSwappableHandler(createTrackingHandler())

      hot.swap(createTrackingHandler())
      const firstSwapTime = hot.getLastSwapTime()

      // 确保时间推进
      const waitUntilTimeDiffers = () => {
        while (Date.now() === firstSwapTime) {
          // spin
        }
      }
      waitUntilTimeDiffers()

      hot.swap(createTrackingHandler())
      const secondSwapTime = hot.getLastSwapTime()

      expect(secondSwapTime!).toBeGreaterThanOrEqual(firstSwapTime!)
    })

    it("swap 应更新 getCurrentHandler 的返回值", () => {
      const handlerA = createTrackingHandler("A")
      const handlerB = createTrackingHandler("B")
      const hot = new HotSwappableHandler(handlerA)

      expect(hot.getCurrentHandler()).toBe(handlerA)

      hot.swap(handlerB)
      expect(hot.getCurrentHandler()).toBe(handlerB)
    })
  })

  // ── 失败回退机制 ───────────────────────────────────────

  describe("失败回退机制", () => {
    it("不调用 swap 时，旧 handler 持续服务（模拟 reload 失败场景）", () => {
      const handler = createTrackingHandler("stable")
      const hot = new HotSwappableHandler(handler)

      // 模拟多次请求，中间没有 swap（reload 失败了）
      for (let i = 0; i < 10; i++) {
        hot.handle(createMockReq(), createMockRes())
      }

      expect(handler.calls).toHaveLength(10)
      expect(hot.getReloadCount()).toBe(0)
    })

    it("swap 失败后继续使用旧 handler 的模拟场景", () => {
      const stableHandler = createTrackingHandler("stable")
      const hot = new HotSwappableHandler(stableHandler)

      // 正常请求
      hot.handle(createMockReq(), createMockRes())
      expect(stableHandler.calls).toHaveLength(1)

      // 模拟 reload 流程中出错 → 不调用 swap
      // （编译失败、require 失败等）
      try {
        throw new Error("simulated reload failure")
      } catch {
        // reload 失败，不调用 swap
      }

      // 旧 handler 仍然正常服务
      hot.handle(createMockReq(), createMockRes())
      hot.handle(createMockReq(), createMockRes())

      expect(stableHandler.calls).toHaveLength(3)
      expect(hot.getReloadCount()).toBe(0)
    })
  })

  // ── 闭包安全性 ────────────────────────────────────────

  describe("闭包安全性", () => {
    it("swap 后旧 handler 的闭包引用仍然有效", () => {
      // 模拟旧 handler 闭包持有模块引用
      const sharedState = { value: 42 }
      const oldHandler: RequestHandler = (_req, res: any) => {
        res.data = sharedState.value
      }

      const hot = new HotSwappableHandler(oldHandler)

      // 获取旧 handler 的引用（模拟请求在 swap 前读取到的 handler）
      const capturedHandler = hot.getCurrentHandler()

      // swap 到新 handler
      hot.swap(createTrackingHandler("new"))

      // 旧 handler 通过闭包仍然可以访问 sharedState
      const res = createMockRes()
      capturedHandler(createMockReq(), res)
      expect(res.data).toBe(42)
    })

    it("handler 抛出异常不影响 HotSwappableHandler 状态", () => {
      const errorHandler: RequestHandler = () => {
        throw new Error("handler error")
      }
      const hot = new HotSwappableHandler(errorHandler)

      expect(() => hot.handle(createMockReq(), createMockRes())).toThrow(
        "handler error",
      )

      // 状态未被破坏
      expect(hot.getReloadCount()).toBe(0)
      expect(hot.getCurrentHandler()).toBe(errorHandler)

      // swap 后恢复正常
      const goodHandler = createTrackingHandler()
      hot.swap(goodHandler)

      expect(() =>
        hot.handle(createMockReq(), createMockRes()),
      ).not.toThrow()
      expect(goodHandler.calls).toHaveLength(1)
    })
  })

  // ── 异步 handler ──────────────────────────────────────

  describe("异步 handler", () => {
    it("支持返回 Promise 的 handler（async handler）", async () => {
      const results: string[] = []
      const asyncHandler: RequestHandler = ((_req, _res) => {
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            results.push("async-done")
            resolve()
          }, 10)
        })
      }) as unknown as RequestHandler

      const hot = new HotSwappableHandler(asyncHandler)
      const promise = hot.handle(createMockReq(), createMockRes()) as unknown as Promise<void>

      // handle 本身是 void 返回类型，但底层 handler 返回 Promise
      // HotSwappableHandler 不关心返回值，只负责转发
      if (promise && typeof promise.then === "function") {
        await promise
      }

      // 等待异步完成
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(results).toContain("async-done")
    })
  })

  // ── 边界情况 ──────────────────────────────────────────

  describe("边界情况", () => {
    it("swap 为同一个 handler 不应出错", () => {
      const handler = createTrackingHandler()
      const hot = new HotSwappableHandler(handler)

      hot.swap(handler)

      expect(hot.getReloadCount()).toBe(1)
      expect(hot.getCurrentHandler()).toBe(handler)

      hot.handle(createMockReq(), createMockRes())
      expect(handler.calls).toHaveLength(1)
    })

    it("高频 swap 不应出错", () => {
      const hot = new HotSwappableHandler(createTrackingHandler())

      for (let i = 0; i < 1000; i++) {
        hot.swap(createTrackingHandler(`handler-${i}`))
      }

      expect(hot.getReloadCount()).toBe(1000)
    })

    it("handle 和 swap 交替调用的正确性", () => {
      const handlers: Array<
        RequestHandler & { calls: Array<{ req: any; res: any; id: string }> }
      > = []

      const hot = new HotSwappableHandler(createTrackingHandler("initial"))

      for (let i = 0; i < 10; i++) {
        const h = createTrackingHandler(`h-${i}`)
        handlers.push(h)
        hot.swap(h)

        // 每次 swap 后发一个请求
        hot.handle(createMockReq(), createMockRes())
      }

      // 每个 handler 应恰好收到 1 个请求
      for (const h of handlers) {
        expect(h.calls).toHaveLength(1)
      }

      expect(hot.getReloadCount()).toBe(10)
    })

    it("no-op handler 可正常工作", () => {
      const noopHandler: RequestHandler = () => {
        // 什么也不做
      }
      const hot = new HotSwappableHandler(noopHandler)

      expect(() =>
        hot.handle(createMockReq(), createMockRes()),
      ).not.toThrow()
    })
  })

  // ── getReloadCount ────────────────────────────────────

  describe("getReloadCount", () => {
    it("初始值为 0", () => {
      const hot = new HotSwappableHandler(createTrackingHandler())
      expect(hot.getReloadCount()).toBe(0)
    })

    it("每次 swap 精确递增 1", () => {
      const hot = new HotSwappableHandler(createTrackingHandler())

      for (let i = 1; i <= 100; i++) {
        hot.swap(createTrackingHandler())
        expect(hot.getReloadCount()).toBe(i)
      }
    })

    it("handle 调用不影响 reloadCount", () => {
      const hot = new HotSwappableHandler(createTrackingHandler())

      for (let i = 0; i < 50; i++) {
        hot.handle(createMockReq(), createMockRes())
      }

      expect(hot.getReloadCount()).toBe(0)
    })
  })

  // ── getLastSwapTime ───────────────────────────────────

  describe("getLastSwapTime", () => {
    it("初始值为 null", () => {
      const hot = new HotSwappableHandler(createTrackingHandler())
      expect(hot.getLastSwapTime()).toBeNull()
    })

    it("swap 后返回有效的时间戳", () => {
      const hot = new HotSwappableHandler(createTrackingHandler())
      const before = Date.now()

      hot.swap(createTrackingHandler())

      const after = Date.now()
      const swapTime = hot.getLastSwapTime()!

      expect(swapTime).toBeGreaterThanOrEqual(before)
      expect(swapTime).toBeLessThanOrEqual(after)
    })
  })

  // ── getCurrentHandler ─────────────────────────────────

  describe("getCurrentHandler", () => {
    it("返回构造时传入的初始 handler", () => {
      const handler = createTrackingHandler()
      const hot = new HotSwappableHandler(handler)

      expect(hot.getCurrentHandler()).toBe(handler)
    })

    it("swap 后返回新 handler", () => {
      const old = createTrackingHandler()
      const updated = createTrackingHandler()
      const hot = new HotSwappableHandler(old)

      hot.swap(updated)
      expect(hot.getCurrentHandler()).toBe(updated)
    })

    it("返回的是同一个函数引用（非副本）", () => {
      const handler = createTrackingHandler()
      const hot = new HotSwappableHandler(handler)

      const ref1 = hot.getCurrentHandler()
      const ref2 = hot.getCurrentHandler()
      expect(ref1).toBe(ref2)
      expect(ref1).toBe(handler)
    })
  })
})
