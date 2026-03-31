import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * hot-swappable-handler.ts — 请求处理函数原子替换（Phase 2B）
 *
 * 这是实现"零中断"热重载的关键。Server socket 绑定的是一个**间接引用**，
 * soft reload 时只需替换引用即可让新请求走新逻辑。
 *
 * 安全性保证（JS 单线程）：
 *
 * | 场景                       | 行为                                           |
 * |----------------------------|------------------------------------------------|
 * | 请求在 reload 之前到达     | 进入旧 handler 的调用栈，使用旧闭包，正常完成   |
 * | 请求在 swap() 之后到达     | 读取到新 handler 引用，走新代码路径              |
 * | 请求在 swap() 同时到达     | JS 单线程，不存在"同时"；要么读到旧的，要么新的  |
 * | 旧 handler 闭包中的模块引用 | 闭包持有的是对象引用（非 require.cache 条目），   |
 * |                            | GC 前一直有效                                    |
 *
 * 使用方式：
 *
 * ```ts
 * // dev-bootstrap.ts 中创建
 * const handler = adapter.buildHandler();
 * const hotHandler = new HotSwappableHandler(handler);
 * const server = createServer(hotHandler.handle);
 *
 * // soft reload 时原子替换
 * const newHandler = freshAdapter.buildHandler();
 * hotHandler.swap(newHandler);
 * ```
 *
 * @module lib/dev/hot-swappable-handler
 * @see 11b-soft-reload.md §3（requestHandler 原子替换）
 * @see 11e-edge-cases.md §1（Reload 失败回退 — 不调用 swap 即保留旧版本）
 * @see IMPLEMENTATION-PLAN.md 任务 2.2a
 */

// ── 类型定义 ────────────────────────────────────────────────

/**
 * Node.js HTTP 请求处理函数类型
 *
 * 与 http.createServer() 的回调签名一致。
 * adapter.buildHandler() 返回此类型。
 */
export type RequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void;

// ── HotSwappableHandler ─────────────────────────────────────

/**
 * HotSwappableHandler — 请求处理函数的可热替换包装器
 *
 * Server socket 始终调用 `this.handle()`，
 * soft reload 时只需替换 `this.currentHandler`。
 *
 * 正在处理中的请求使用的是旧闭包（已经在调用栈中），不受影响。
 * 新请求调用时获取的是新 handler。
 *
 * 设计约束：
 *   - `handle` 是箭头函数属性（而非方法），确保传递给 createServer 时
 *     `this` 绑定正确。
 *   - `swap()` 是同步操作，JS 单线程保证赋值的原子性。
 *   - 不需要锁或 CAS 机制。
 */
export class HotSwappableHandler {
  /**
   * 当前活跃的请求处理函数
   *
   * soft reload 成功时通过 swap() 替换为新的 handler。
   * soft reload 失败时保持不变，旧 handler 通过闭包继续服务。
   */
  private currentHandler: RequestHandler;

  /**
   * 累计 reload 次数（swap 调用次数）
   *
   * 用于日志、调试和性能统计。
   * 初始值为 0（表示尚未执行过热替换）。
   */
  private reloadCount = 0;

  /**
   * 最近一次成功 swap 的时间戳（毫秒）
   *
   * 用于日志输出和调试（如显示"距上次 reload 过去了多久"）。
   * 初始为 null，表示尚未执行过 swap。
   */
  private lastSwapTime: number | null = null;

  /**
   * @param initialHandler 初始请求处理函数（来自首次 adapter.buildHandler()）
   */
  constructor(initialHandler: RequestHandler) {
    this.currentHandler = initialHandler;
  }

  /**
   * handle — Server socket 绑定的入口函数
   *
   * 每次请求都读取 currentHandler 的最新引用。
   * 箭头函数确保 `this` 绑定正确（即使作为回调传递）。
   *
   * 安全性：
   *   - `const handler = this.currentHandler` 读取引用是原子操作
   *   - JS 单线程保证不会读到"半替换"的状态
   *   - handler 函数内部通过闭包引用的模块在 GC 前一直有效
   *
   * @param req Node.js 原始请求对象
   * @param res Node.js 原始响应对象
   */
  handle = (req: IncomingMessage, res: ServerResponse): void => {
    // 读取当前 handler 引用（原子操作，JS 单线程保证安全）
    const handler = this.currentHandler;
    handler(req, res);
  };

  /**
   * swap — 原子替换 handler
   *
   * 由 soft reload 流程在所有准备工作（编译、cache 清除、服务重载、
   * 路由重载、新 adapter 构建）全部成功后调用。
   *
   * 如果 soft reload 的任何步骤失败，**不调用 swap**，
   * 旧 handler 通过闭包继续服务（失败回退机制，见 11e §1）。
   *
   * 由于 JS 是单线程的，赋值操作天然是原子的。
   * 不需要锁，不需要 CAS。
   *
   * @param newHandler 新的请求处理函数（来自 freshAdapter.buildHandler()）
   */
  swap(newHandler: RequestHandler): void {
    this.currentHandler = newHandler;
    this.reloadCount++;
    this.lastSwapTime = Date.now();
  }

  /**
   * 获取当前累计 reload 次数
   *
   * 用途：
   *   - 日志输出（如 `[hot-reload] ✅ reload #5 completed in 23ms`）
   *   - 性能统计（reload 次数 vs 内存增长趋势）
   *   - 测试断言
   *
   * @returns 累计 swap 调用次数
   */
  getReloadCount(): number {
    return this.reloadCount;
  }

  /**
   * 获取最近一次 swap 的时间戳
   *
   * @returns Unix 毫秒时间戳，如果从未 swap 过则返回 null
   */
  getLastSwapTime(): number | null {
    return this.lastSwapTime;
  }

  /**
   * 获取当前活跃的 handler 引用
   *
   * 主要用于测试和调试，生产运行时不应直接访问。
   *
   * @returns 当前 handler 函数引用
   */
  getCurrentHandler(): RequestHandler {
    return this.currentHandler;
  }
}
