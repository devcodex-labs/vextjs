import { requestContext } from "./request-context.js";
import type { VextLogger } from "../types/app.js";

/**
 * fetch.ts — app.fetch 内置 HTTP 客户端
 *
 * 封装 Node.js 18+ 内置 fetch，提供：
 *   1. 自动传播 requestId（从 requestContext AsyncLocalStorage 读取）
 *   2. 结构化日志记录（出站请求 method/url/status/duration）
 *   3. 超时控制（AbortController + setTimeout）
 *   4. 快捷方法（get/post/put/patch/delete）
 *   5. create() 工厂（baseURL + 默认配置）
 *
 * 挂载位置：app.fetch（与 app.logger / app.throw 同级）
 *
 * 与 requestContext 的关系：
 *   requestId 中间件在请求进入时将 requestId 写入 requestContext store。
 *   app.fetch 在发送出站请求时从 requestContext.getStore() 读取 requestId，
 *   自动注入到出站请求的 x-request-id 头，实现跨服务请求追踪。
 *
 * 配置项（config.fetch）：
 *   - timeout:          全局默认请求超时（毫秒，默认 10000）
 *   - retry:            默认重试次数（仅幂等方法，默认 0）
 *   - retryDelay:       默认重试间隔（毫秒，默认 1000）
 *   - propagateHeaders: 除 x-request-id 外还需自动传播的请求头
 *
 * 超时配置优先级：
 *   单次请求 init.timeout > create() 的 options.timeout > config.fetch.timeout
 *
 * 当前版本未暴露 app.setFetch() 公共 API；自定义实现需在框架内部注入。
 *
 * @module lib/fetch
 * @see IMPLEMENTATION-PLAN.md 任务 1.8b
 * @see 06d-fetch.md §1~§4
 */

// ── 类型定义 ────────────────────────────────────────────────

/**
 * 扩展的 fetch 初始化选项
 *
 * 在标准 RequestInit 基础上增加 vext 特有的配置项：
 *   - timeout:             请求超时（毫秒）
 *   - retry:               重试次数（仅幂等方法）
 *   - retryDelay:          重试间隔（毫秒）或指数退避函数
 *   - propagateRequestId:  是否自动注入 requestId 头
 *   - propagateHeaders:    额外需要传播的请求头
 */
export interface VextFetchInit extends RequestInit {
  /** 请求超时（毫秒），默认使用全局配置 config.fetch.timeout */
  timeout?: number;

  /** 重试次数（仅对幂等方法 GET/HEAD/OPTIONS/PUT/DELETE 生效），默认 0 */
  retry?: number;

  /** 重试间隔（毫秒），默认 1000；支持函数形式实现指数退避 */
  retryDelay?: number | ((attempt: number) => number);

  /**
   * 是否自动注入 requestId 头
   * 默认 true；设为 false 可禁用（如调用不支持此头的外部 API）
   */
  propagateRequestId?: boolean;

  /**
   * 自定义传播头（除 requestId 外还要传播的请求头）
   * 例如 ['x-trace-id', 'x-tenant-id']
   */
  propagateHeaders?: string[];
}

/**
 * create() 工厂选项
 */
export interface VextFetchClientOptions {
  /** 基础 URL，所有请求自动拼接 */
  baseURL: string;

  /** 默认请求头 */
  headers?: Record<string, string>;

  /** 默认超时 */
  timeout?: number;

  /** 默认重试 */
  retry?: number;
}

/**
 * VextFetch 接口
 *
 * 既是可调用的函数（与原生 fetch 签名一致），
 * 又挂载了快捷方法（get/post/put/patch/delete）和 create() 工厂。
 */
export interface VextFetch {
  (input: string | URL | Request, init?: VextFetchInit): Promise<Response>;
  get(url: string, init?: VextFetchInit): Promise<Response>;
  post(url: string, body?: unknown, init?: VextFetchInit): Promise<Response>;
  put(url: string, body?: unknown, init?: VextFetchInit): Promise<Response>;
  patch(url: string, body?: unknown, init?: VextFetchInit): Promise<Response>;
  delete(url: string, init?: VextFetchInit): Promise<Response>;
  create(options: VextFetchClientOptions): VextFetch;
}

/**
 * fetch 模块配置（从 VextConfig 中提取）
 */
interface FetchConfig {
  timeout?: number;
  retry?: number;
  retryDelay?: number | ((attempt: number) => number);
  propagateHeaders?: string[];
}

// ── 幂等方法集合（用于判断是否可重试）─────────────────────────

const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);

// ── 核心实现 ────────────────────────────────────────────────

/**
 * createVextFetch — 创建 app.fetch 内置 HTTP 客户端
 *
 * 在 bootstrap 阶段调用，将返回的 VextFetch 挂载到 app.fetch。
 *
 * @param logger          app.logger 实例（用于结构化日志）
 * @param fetchConfig     config.fetch 配置
 * @param requestIdHeader requestId 传播使用的头名称（默认 'x-request-id'）
 * @returns VextFetch 实例
 */
export function createVextFetch(
  logger: VextLogger,
  fetchConfig: FetchConfig = {},
  requestIdHeader: string = "x-request-id",
): VextFetch {
  const globalTimeout = fetchConfig.timeout ?? 10_000;
  const globalRetry = fetchConfig.retry ?? 0;
  const globalRetryDelay = fetchConfig.retryDelay ?? 1000;
  const globalPropagateHeaders = fetchConfig.propagateHeaders ?? [];

  /**
   * 核心 fetch 函数
   */
  async function vextFetch(
    input: string | URL | Request,
    init?: VextFetchInit,
  ): Promise<Response> {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const timeout = init?.timeout ?? globalTimeout;
    const propagate = init?.propagateRequestId !== false;

    // ── 1. 构建请求头（注入追踪头）────────────────────────
    const headers = new Headers(init?.headers);

    const store = requestContext.getStore();

    // ── 1a. 注入 requestId（受 propagateRequestId 控制）──
    if (propagate && store?.requestId && !headers.has(requestIdHeader)) {
      headers.set(requestIdHeader, store.requestId);
    }

    // ── 1b. 透传 propagatedHeaders（始终生效，不受 propagateRequestId 控制）──
    // store.propagatedHeaders 由 request-id 中间件在入站请求阶段
    // 从原始请求头中捕获并写入（根据 config.fetch.propagateHeaders 列表）。
    // 此处从 store 中读取并注入到出站请求头，实现"入站头 → 出站头"完整透传链路。
    //
    // 优先级：init.headers 手动设置 > store.propagatedHeaders（不覆盖用户显式设置的头）
    //
    // 单次请求可通过 init.propagateHeaders 指定额外透传头（已在入站阶段写入 store，
    // 但仅当 request-id 中间件的 propagateHeaderNames 包含该头时才有值）。
    // 如需透传未在全局配置中声明的头，直接在 init.headers 中手动设置即可。
    if (store?.propagatedHeaders) {
      for (const [key, value] of Object.entries(store.propagatedHeaders)) {
        if (!headers.has(key)) {
          headers.set(key, value);
        }
      }
    }

    // ── 2. 确定重试配置 ──────────────────────────────────
    const maxRetries = IDEMPOTENT_METHODS.has(method)
      ? (init?.retry ?? globalRetry)
      : 0;
    const retryDelay = init?.retryDelay ?? globalRetryDelay;

    // ── 3. 执行请求（含重试循环）────────────────────────
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // 重试等待（首次请求不等待）
      if (attempt > 0) {
        const delay =
          typeof retryDelay === "function" ? retryDelay(attempt) : retryDelay;
        await sleep(delay);

        logger.debug(
          {
            type: "outbound",
            method,
            url,
            attempt,
            maxRetries,
          },
          `→ ${method} ${url} RETRY attempt ${attempt}/${maxRetries}`,
        );
      }

      // ── 超时控制 ──────────────────────────────────────
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      // 合并用户 signal 和超时 signal
      const signal = mergeSignals(init?.signal ?? null, controller.signal);

      const startTime = performance.now();

      try {
        const response = await fetch(input, {
          ...init,
          method,
          headers,
          signal,
        });

        clearTimeout(timer);

        const duration = Math.round(performance.now() - startTime);

        // ── 日志记录 ────────────────────────────────────
        const level = response.ok
          ? "debug"
          : response.status >= 500
            ? "error"
            : "warn";

        logger[level](
          {
            type: "outbound",
            method,
            url,
            status: response.status,
            duration,
            requestId: requestContext.getStore()?.requestId,
          },
          `→ ${method} ${url} ${response.status} ${duration}ms`,
        );

        // 非幂等方法 或 非服务端错误 → 不重试，直接返回
        if (!IDEMPOTENT_METHODS.has(method) || response.status < 500) {
          return response;
        }

        // 幂等方法 + 5xx → 如果还有重试机会则继续
        if (attempt < maxRetries) {
          lastError = new Error(
            `[app.fetch] ${method} ${url} returned ${response.status}`,
          );
          continue;
        }

        // 最后一次重试也失败了，返回响应（让调用方处理）
        return response;
      } catch (err: unknown) {
        clearTimeout(timer);

        const duration = Math.round(performance.now() - startTime);
        const error = err instanceof Error ? err : new Error(String(err));

        if (error.name === "AbortError") {
          logger.error(
            {
              type: "outbound",
              method,
              url,
              error: "timeout",
              duration,
              timeout,
              requestId: requestContext.getStore()?.requestId,
            },
            `→ ${method} ${url} TIMEOUT ${duration}ms (limit: ${timeout}ms)`,
          );

          // 超时不重试
          throw new Error(
            `[app.fetch] ${method} ${url} timed out after ${timeout}ms`,
          );
        }

        logger.error(
          {
            type: "outbound",
            method,
            url,
            error: error.message,
            duration,
            requestId: requestContext.getStore()?.requestId,
          },
          `→ ${method} ${url} ERROR ${duration}ms: ${error.message}`,
        );

        lastError = error;

        // 还有重试机会且是幂等方法 → 继续
        if (attempt < maxRetries && IDEMPOTENT_METHODS.has(method)) {
          continue;
        }

        throw error;
      }
    }

    // 理论上不应到达此处，但作为防御性编码
    throw lastError ?? new Error(`[app.fetch] ${method} ${url} failed`);
  }

  // ── 快捷方法 ──────────────────────────────────────────────

  vextFetch.get = (url: string, init?: VextFetchInit) =>
    vextFetch(url, { ...init, method: "GET" });

  vextFetch.post = (url: string, body?: unknown, init?: VextFetchInit) =>
    vextFetch(url, {
      ...init,
      method: "POST",
      body: body != null ? JSON.stringify(body) : undefined,
      headers: {
        ...(body != null ? { "content-type": "application/json" } : {}),
        ...(init?.headers as Record<string, string> | undefined),
      },
    });

  vextFetch.put = (url: string, body?: unknown, init?: VextFetchInit) =>
    vextFetch(url, {
      ...init,
      method: "PUT",
      body: body != null ? JSON.stringify(body) : undefined,
      headers: {
        ...(body != null ? { "content-type": "application/json" } : {}),
        ...(init?.headers as Record<string, string> | undefined),
      },
    });

  vextFetch.patch = (url: string, body?: unknown, init?: VextFetchInit) =>
    vextFetch(url, {
      ...init,
      method: "PATCH",
      body: body != null ? JSON.stringify(body) : undefined,
      headers: {
        ...(body != null ? { "content-type": "application/json" } : {}),
        ...(init?.headers as Record<string, string> | undefined),
      },
    });

  vextFetch.delete = (url: string, init?: VextFetchInit) =>
    vextFetch(url, { ...init, method: "DELETE" });

  // ── create() 工厂 ────────────────────────────────────────

  vextFetch.create = (options: VextFetchClientOptions): VextFetch => {
    const childFetchConfig: FetchConfig = {
      timeout: options.timeout ?? globalTimeout,
      retry: options.retry ?? globalRetry,
      retryDelay: globalRetryDelay,
      propagateHeaders: globalPropagateHeaders,
    };

    // 创建子 VextFetch（递归使用 createVextFetch）
    const child = createVextFetch(logger, childFetchConfig, requestIdHeader);

    // 包装：自动拼接 baseURL + 合并默认 headers
    const baseURL = options.baseURL.replace(/\/+$/, "");
    const defaultHeaders = options.headers ?? {};

    const wrappedFetch: VextFetch = ((
      input: string | URL | Request,
      init?: VextFetchInit,
    ) => {
      const resolvedInput =
        typeof input === "string"
          ? `${baseURL}${input.startsWith("/") ? "" : "/"}${input}`
          : input;

      return child(resolvedInput, {
        ...init,
        headers: {
          ...defaultHeaders,
          ...(init?.headers as Record<string, string> | undefined),
        },
      });
    }) as VextFetch;

    // 快捷方法也拼接 baseURL
    wrappedFetch.get = (url: string, init?: VextFetchInit) =>
      wrappedFetch(url, { ...init, method: "GET" });

    wrappedFetch.post = (url: string, body?: unknown, init?: VextFetchInit) =>
      wrappedFetch(url, {
        ...init,
        method: "POST",
        body: body != null ? JSON.stringify(body) : undefined,
        headers: {
          ...(body != null ? { "content-type": "application/json" } : {}),
          ...(init?.headers as Record<string, string> | undefined),
        },
      });

    wrappedFetch.put = (url: string, body?: unknown, init?: VextFetchInit) =>
      wrappedFetch(url, {
        ...init,
        method: "PUT",
        body: body != null ? JSON.stringify(body) : undefined,
        headers: {
          ...(body != null ? { "content-type": "application/json" } : {}),
          ...(init?.headers as Record<string, string> | undefined),
        },
      });

    wrappedFetch.patch = (url: string, body?: unknown, init?: VextFetchInit) =>
      wrappedFetch(url, {
        ...init,
        method: "PATCH",
        body: body != null ? JSON.stringify(body) : undefined,
        headers: {
          ...(body != null ? { "content-type": "application/json" } : {}),
          ...(init?.headers as Record<string, string> | undefined),
        },
      });

    wrappedFetch.delete = (url: string, init?: VextFetchInit) =>
      wrappedFetch(url, { ...init, method: "DELETE" });

    // create() 也可以在子实例上再调用
    wrappedFetch.create = vextFetch.create;

    return wrappedFetch;
  };

  return vextFetch as VextFetch;
}

// ── 辅助函数 ────────────────────────────────────────────────

/**
 * 合并两个 AbortSignal
 *
 * 任意一个 signal 触发 abort 时，返回的 signal 也触发 abort。
 * 如果 userSignal 为 null，直接返回 timeoutSignal。
 *
 * Node.js 20+ 支持 AbortSignal.any()，但为兼容 Node 18 手动实现。
 *
 * @param userSignal    用户传入的 signal（可为 null）
 * @param timeoutSignal 超时控制的 signal
 * @returns 合并后的 AbortSignal
 */
function mergeSignals(
  userSignal: AbortSignal | null,
  timeoutSignal: AbortSignal,
): AbortSignal {
  if (!userSignal) return timeoutSignal;

  // 尝试使用原生 AbortSignal.any()（Node.js 20+）
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([userSignal, timeoutSignal]);
  }

  // Node.js 18 手动实现
  const controller = new AbortController();

  const onAbort = () => {
    controller.abort();
  };

  if (userSignal.aborted || timeoutSignal.aborted) {
    controller.abort();
    return controller.signal;
  }

  userSignal.addEventListener("abort", onAbort, { once: true });
  timeoutSignal.addEventListener("abort", onAbort, { once: true });

  return controller.signal;
}

/**
 * sleep — 延迟指定毫秒
 *
 * @param ms 毫秒数
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
