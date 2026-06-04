import { Readable } from "node:stream";
import { requestContext } from "./request-context.js";
import type { VextLogger } from "../types/app.js";
import type { VextRequest } from "../types/request.js";
import type { VextResponse } from "../types/response.js";

/**
 * fetch.ts — app.fetch 内置 HTTP 客户端
 *
 * 封装 Node.js 18+ 内置 fetch，提供：
 *   1. 自动传播 requestId（从 requestContext AsyncLocalStorage 读取）
 *   2. 结构化日志记录（出站请求 method/url/status/duration）
 *   3. 超时控制（AbortController + setTimeout）
 *   4. 快捷方法（get/post/put/patch/delete）
 *   5. create() 工厂（baseURL + 默认配置）
 *   6. proxy() / proxy.<target>() 请求代理能力（仅根 app.fetch 暴露）
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
 *   - proxy:            上游代理目标列表（仅根 app.fetch.proxy 使用）
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

  /** 默认重试间隔（毫秒）或指数退避函数 */
  retryDelay?: number | ((attempt: number) => number);
}

/**
 * 可写入代理上游的请求头值。
 */
type ProxyHeaderValue = string | number | boolean | null | undefined;
type ProxyRequestBody =
  | Exclude<RequestInit["body"], null | undefined>
  | Buffer
  | Uint8Array;

/**
 * 代理动态注入 headers 的上下文。
 */
export interface VextFetchProxyHeaderContext {
  req: VextRequest;
  target?: VextFetchProxyTargetConfig;
  options: VextFetchProxyOptions;
}

/**
 * 代理 headers 配置。
 */
export type VextFetchProxyHeaders =
  | Record<string, ProxyHeaderValue>
  | ((
      ctx: VextFetchProxyHeaderContext,
    ) =>
      | Record<string, ProxyHeaderValue>
      | Promise<Record<string, ProxyHeaderValue>>);

/**
 * config.fetch.proxy[] 的单个代理目标配置。
 */
export interface VextFetchProxyTargetConfig {
  /** 目标名称，对应 app.fetch.proxy.<name>() */
  name: string;

  /** 上游基础地址，会与调用时 options.path 拼接 */
  baseURL: string;

  /** 目标级固定 headers，优先级最低 */
  headers?: Record<string, string>;

  /** 从当前 req.headers 白名单透传的 header 名称 */
  forwardHeaders?: string[];

  /** 目标级动态注入 headers，覆盖 headers / forwardHeaders */
  defaultInjectHeaders?: VextFetchProxyHeaders;

  /** 是否允许从当前请求透传原始 Authorization header */
  allowAuthorizationForward?: boolean;

  /** 目标级超时（毫秒） */
  timeout?: number;

  /** 目标级重试次数，表示额外尝试次数 */
  retry?: number;

  /** 目标级重试间隔（毫秒）或指数退避函数 */
  retryDelay?: number | ((attempt: number) => number);
}

/**
 * app.fetch.proxy 调用选项。
 */
export interface VextFetchProxyOptions {
  /** 命名目标模式下必传：拼接到 target.baseURL 的路径 */
  path?: string;

  /** 直接 URL 模式下必传：app.fetch.proxy(req, res, { url }) */
  url?: string;

  /** 默认使用当前 req.method */
  method?: string;

  /** 默认透传当前 req.query；同名 key 由 options.query 覆盖 */
  query?: Record<string, ProxyHeaderValue>;

  /** 显式请求体；未传时非 GET/HEAD 会读取当前 req 原始 body Buffer */
  body?: ProxyRequestBody;

  /** 读取当前 req 原始 body 的最大字节数 */
  maxBodySize?: number;

  /** 调用级固定 headers，覆盖目标级配置和透传 headers */
  headers?: Record<string, string>;

  /** 调用级追加 header 透传白名单 */
  forwardHeaders?: string[];

  /** 调用级动态注入 headers，优先级最高 */
  injectHeaders?: VextFetchProxyHeaders;

  /** 调用级是否允许透传原始 Authorization header */
  allowAuthorizationForward?: boolean;

  /** 调用级超时（毫秒） */
  timeout?: number;

  /** 调用级重试次数，表示额外尝试次数 */
  retry?: number;

  /** 调用级重试间隔（毫秒）或指数退避函数 */
  retryDelay?: number | ((attempt: number) => number);
}

/**
 * 命名目标代理处理函数。
 */
export type VextFetchProxyHandler = (
  req: VextRequest,
  res: VextResponse,
  options: VextFetchProxyOptions,
) => Promise<void>;

/**
 * app.fetch.proxy 接口。
 *
 * - app.fetch.proxy(req, res, { url })：直接 URL 代理
 * - app.fetch.proxy.<target>(req, res, { path })：config.fetch.proxy[] 目标代理
 */
export type VextFetchProxy = {
  (
    req: VextRequest,
    res: VextResponse,
    options: VextFetchProxyOptions,
  ): Promise<void>;
} & Record<string, VextFetchProxyHandler>;

/**
 * app.fetch.create() 返回的纯出站 HTTP 客户端。
 *
 * 子客户端不暴露 proxy，避免 app.fetch.create().proxy 带来额外心智负担。
 */
export interface VextFetchClient {
  (input: string | URL | Request, init?: VextFetchInit): Promise<Response>;
  get(url: string, init?: VextFetchInit): Promise<Response>;
  post(url: string, body?: unknown, init?: VextFetchInit): Promise<Response>;
  put(url: string, body?: unknown, init?: VextFetchInit): Promise<Response>;
  patch(url: string, body?: unknown, init?: VextFetchInit): Promise<Response>;
  delete(url: string, init?: VextFetchInit): Promise<Response>;
  create(options: VextFetchClientOptions): VextFetchClient;
}

/**
 * 根 VextFetch 接口
 *
 * 既是可调用的函数（与原生 fetch 签名一致），
 * 又挂载了快捷方法（get/post/put/patch/delete）、create() 工厂和 proxy。
 */
export interface VextFetch extends VextFetchClient {
  proxy: VextFetchProxy;
  create(options: VextFetchClientOptions): VextFetchClient;
}

/**
 * fetch 模块配置（从 VextConfig 中提取）
 */
export interface VextFetchConfig {
  timeout?: number;
  retry?: number;
  retryDelay?: number | ((attempt: number) => number);
  propagateHeaders?: string[];
  proxy?: VextFetchProxyTargetConfig[];
}

type FetchConfig = VextFetchConfig;

// ── 幂等方法集合（用于判断是否可重试）─────────────────────────

const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);

const AUTHORIZATION_HEADER = "authorization";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const BODYLESS_STATUS = new Set([204, 304]);

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
  const proxyTargets = fetchConfig.proxy ?? [];

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

  vextFetch.create = (options: VextFetchClientOptions): VextFetchClient => {
    const childFetchConfig: FetchConfig = {
      timeout: options.timeout ?? globalTimeout,
      retry: options.retry ?? globalRetry,
      retryDelay: options.retryDelay ?? globalRetryDelay,
      propagateHeaders: globalPropagateHeaders,
    };

    // 创建子 VextFetch（递归使用 createVextFetch）
    const child = createVextFetch(logger, childFetchConfig, requestIdHeader);

    // 包装：自动拼接 baseURL + 合并默认 headers
    const baseURL = options.baseURL.replace(/\/+$/, "");
    const defaultHeaders = options.headers ?? {};

    const wrappedFetch: VextFetchClient = ((
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
    }) as VextFetchClient;

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

  vextFetch.proxy = createFetchProxy({
    logger,
    targets: proxyTargets,
    timeout: globalTimeout,
    retry: globalRetry,
    retryDelay: globalRetryDelay,
  });

  return vextFetch as VextFetch;
}

// ── proxy 实现 ──────────────────────────────────────────────

interface FetchProxyRuntime {
  logger: VextLogger;
  targets: VextFetchProxyTargetConfig[];
  timeout: number;
  retry: number;
  retryDelay: number | ((attempt: number) => number);
}

interface ResolvedProxyRequest {
  target?: VextFetchProxyTargetConfig;
  targetName: string;
  url: string;
  method: string;
  headers: Headers;
  body?: ProxyRequestBody;
  timeout: number;
  retry: number;
  retryDelay: number | ((attempt: number) => number);
  replayableBody: boolean;
}

class ProxyLocalError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProxyLocalError";
  }
}

class ProxyTimeoutError extends Error {
  constructor(
    message: string,
    readonly timeout: number,
  ) {
    super(message);
    this.name = "ProxyTimeoutError";
  }
}

class ProxyClientAbortError extends Error {
  constructor() {
    super("Client aborted proxy request");
    this.name = "ProxyClientAbortError";
  }
}

function createFetchProxy(runtime: FetchProxyRuntime): VextFetchProxy {
  const targetMap = new Map<string, VextFetchProxyTargetConfig>();
  for (const target of runtime.targets) {
    targetMap.set(target.name, target);
  }

  const directProxy = (async (
    req: VextRequest,
    res: VextResponse,
    options: VextFetchProxyOptions,
  ) => {
    await handleProxyRequest(runtime, req, res, undefined, options);
  }) as VextFetchProxy;

  return new Proxy(directProxy, {
    get(target, prop, receiver) {
      if (typeof prop !== "string") {
        return Reflect.get(target, prop, receiver);
      }
      if (prop === "then") {
        return undefined;
      }
      const configuredTarget = targetMap.get(prop);
      if (configuredTarget) {
        return async (
          req: VextRequest,
          res: VextResponse,
          options: VextFetchProxyOptions,
        ) => {
          await handleProxyRequest(
            runtime,
            req,
            res,
            configuredTarget,
            options,
          );
        };
      }
      if (Reflect.has(target, prop)) {
        return Reflect.get(target, prop, receiver);
      }
      return async (req: VextRequest, res: VextResponse) => {
        writeProxyLocalError(
          req,
          res,
          500,
          "FETCH_PROXY_TARGET_NOT_FOUND",
          `[app.fetch.proxy] target "${prop}" is not configured.`,
        );
      };
    },
  });
}

async function handleProxyRequest(
  runtime: FetchProxyRuntime,
  req: VextRequest,
  res: VextResponse,
  target: VextFetchProxyTargetConfig | undefined,
  options: VextFetchProxyOptions | undefined,
): Promise<void> {
  try {
    const resolved = await resolveProxyRequest(runtime, req, target, options);
    const response = await fetchProxyWithRetry(runtime, req, resolved);
    await writeProxyResponse(response, res);
  } catch (err) {
    if (err instanceof ProxyClientAbortError) {
      runtime.logger.debug(
        {
          type: "proxy",
          requestId: req.requestId,
          event: "client_abort",
        },
        "[app.fetch.proxy] client aborted request",
      );
      return;
    }

    if (err instanceof ProxyLocalError) {
      writeProxyLocalError(req, res, err.status, err.code, err.message);
      return;
    }

    if (err instanceof ProxyTimeoutError) {
      writeProxyLocalError(req, res, 504, "FETCH_PROXY_TIMEOUT", err.message);
      return;
    }

    const error = err instanceof Error ? err : new Error(String(err));
    runtime.logger.error(
      {
        type: "proxy",
        requestId: req.requestId,
        error: error.message,
      },
      `[app.fetch.proxy] upstream request failed: ${error.message}`,
    );
    writeProxyLocalError(
      req,
      res,
      502,
      "FETCH_PROXY_UPSTREAM_ERROR",
      "Upstream request failed.",
    );
  }
}

async function resolveProxyRequest(
  runtime: FetchProxyRuntime,
  req: VextRequest,
  target: VextFetchProxyTargetConfig | undefined,
  options: VextFetchProxyOptions | undefined,
): Promise<ResolvedProxyRequest> {
  const proxyOptions = options ?? {};
  const method = (proxyOptions.method ?? req.method ?? "GET").toUpperCase();
  const url = resolveProxyUrl(target, proxyOptions);
  applyProxyQuery(url, req.query, proxyOptions.query);

  const headers = await resolveProxyHeaders(req, target, proxyOptions);
  const body = await resolveProxyBody(req, method, proxyOptions);
  const retry = normalizeProxyRetry(
    proxyOptions.retry ?? target?.retry ?? runtime.retry,
    "retry",
  );
  const replayableBody = isReplayableProxyBody(body);

  return {
    target,
    targetName: target?.name ?? "direct",
    url: url.href,
    method,
    headers,
    body,
    timeout: normalizeProxyTimeout(
      proxyOptions.timeout ?? target?.timeout ?? runtime.timeout,
      "timeout",
    ),
    retry,
    retryDelay: normalizeProxyRetryDelay(
      proxyOptions.retryDelay ?? target?.retryDelay ?? runtime.retryDelay,
      "retryDelay",
    ),
    replayableBody,
  };
}

function resolveProxyUrl(
  target: VextFetchProxyTargetConfig | undefined,
  options: VextFetchProxyOptions,
): URL {
  if (!target) {
    if (!options.url) {
      throw new ProxyLocalError(
        400,
        "FETCH_PROXY_URL_REQUIRED",
        "[app.fetch.proxy] options.url is required for direct proxy calls.",
      );
    }
    try {
      return new URL(options.url);
    } catch {
      throw new ProxyLocalError(
        400,
        "FETCH_PROXY_INVALID_URL",
        "[app.fetch.proxy] options.url must be a valid absolute URL.",
      );
    }
  }

  if (!options.path) {
    throw new ProxyLocalError(
      400,
      "FETCH_PROXY_PATH_REQUIRED",
      `[app.fetch.proxy.${target.name}] options.path is required.`,
    );
  }

  const baseURL = target.baseURL.replace(/\/+$/, "");
  const path = options.path.replace(/^\/+/, "");
  return new URL(`${baseURL}/${path}`);
}

function applyProxyQuery(
  url: URL,
  reqQuery: Record<string, string>,
  optionQuery?: Record<string, ProxyHeaderValue>,
): void {
  for (const [key, value] of Object.entries(reqQuery)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  if (!optionQuery) return;

  for (const [key, value] of Object.entries(optionQuery)) {
    if (value === undefined || value === null) {
      url.searchParams.delete(key);
      continue;
    }
    url.searchParams.set(key, String(value));
  }
}

async function resolveProxyHeaders(
  req: VextRequest,
  target: VextFetchProxyTargetConfig | undefined,
  options: VextFetchProxyOptions,
): Promise<Headers> {
  const headers = new Headers();
  const headerContext: VextFetchProxyHeaderContext = { req, target, options };

  applyStaticHeaders(headers, target?.headers);

  const forwardHeaders = mergeHeaderNames(
    target?.forwardHeaders,
    options.forwardHeaders,
  );
  const allowAuthorization =
    target?.allowAuthorizationForward === true ||
    options.allowAuthorizationForward === true;

  if (forwardHeaders.includes(AUTHORIZATION_HEADER) && !allowAuthorization) {
    throw new ProxyLocalError(
      400,
      "FETCH_PROXY_AUTHORIZATION_FORWARD_FORBIDDEN",
      "[app.fetch.proxy] forwarding authorization requires allowAuthorizationForward: true.",
    );
  }

  for (const headerName of forwardHeaders) {
    const value = req.headers[headerName];
    if (value !== undefined) {
      headers.set(headerName, value);
    }
  }

  await applyProxyHeaders(headers, target?.defaultInjectHeaders, headerContext);
  applyStaticHeaders(headers, options.headers);
  await applyProxyHeaders(headers, options.injectHeaders, headerContext);

  return headers;
}

function mergeHeaderNames(...groups: Array<string[] | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const group of groups) {
    for (const name of group ?? []) {
      const normalized = name.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}

function applyStaticHeaders(
  headers: Headers,
  source?: Record<string, ProxyHeaderValue>,
): void {
  if (!source) return;

  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== null) {
      headers.set(key, String(value));
    }
  }
}

async function applyProxyHeaders(
  headers: Headers,
  source: VextFetchProxyHeaders | undefined,
  ctx: VextFetchProxyHeaderContext,
): Promise<void> {
  if (!source) return;

  const resolved = typeof source === "function" ? await source(ctx) : source;
  applyStaticHeaders(headers, resolved);
}

async function resolveProxyBody(
  req: VextRequest,
  method: string,
  options: VextFetchProxyOptions,
): Promise<ProxyRequestBody | undefined> {
  if (method === "GET" || method === "HEAD") {
    return undefined;
  }
  if (options.body !== undefined) {
    return options.body;
  }
  return req._getRawBodyBuffer(options.maxBodySize);
}

function normalizeProxyTimeout(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ProxyLocalError(
      400,
      "FETCH_PROXY_INVALID_TIMEOUT",
      `[app.fetch.proxy] ${name} must be a positive number.`,
    );
  }
  return value;
}

function normalizeProxyRetry(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ProxyLocalError(
      400,
      "FETCH_PROXY_INVALID_RETRY",
      `[app.fetch.proxy] ${name} must be a non-negative integer.`,
    );
  }
  return value;
}

function normalizeProxyRetryDelay(
  value: unknown,
  name: string,
): number | ((attempt: number) => number) {
  if (typeof value === "function") {
    return value as (attempt: number) => number;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ProxyLocalError(
      400,
      "FETCH_PROXY_INVALID_RETRY_DELAY",
      `[app.fetch.proxy] ${name} must be a non-negative number or function.`,
    );
  }
  return value;
}

function isReplayableProxyBody(body: ProxyRequestBody | undefined): boolean {
  if (body === undefined || body === null) return true;
  if (typeof body === "string") return true;
  if (body instanceof Uint8Array) return true;
  if (body instanceof URLSearchParams) return true;
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return true;
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return true;
  }
  return false;
}

async function fetchProxyWithRetry(
  runtime: FetchProxyRuntime,
  req: VextRequest,
  resolved: ResolvedProxyRequest,
): Promise<Response> {
  const retryableMethod = IDEMPOTENT_METHODS.has(resolved.method);
  const maxRetries =
    retryableMethod && resolved.replayableBody ? resolved.retry : 0;
  let clientAborted = false;
  let currentController: AbortController | null = null;

  req.onClose(() => {
    clientAborted = true;
    currentController?.abort();
  });

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      if (clientAborted) {
        throw new ProxyClientAbortError();
      }
      const delay =
        typeof resolved.retryDelay === "function"
          ? resolved.retryDelay(attempt)
          : resolved.retryDelay;
      await sleep(delay);
      if (clientAborted) {
        throw new ProxyClientAbortError();
      }
      runtime.logger.debug(
        {
          type: "proxy",
          target: resolved.targetName,
          method: resolved.method,
          url: resolved.url,
          attempt,
          maxRetries,
          requestId: req.requestId,
        },
        `[app.fetch.proxy] retry ${attempt}/${maxRetries}: ${resolved.method} ${resolved.url}`,
      );
    }

    if (clientAborted) {
      throw new ProxyClientAbortError();
    }

    let timedOut = false;
    const controller = new AbortController();
    currentController = controller;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, resolved.timeout);

    const startTime = performance.now();

    try {
      const response = await fetch(resolved.url, {
        method: resolved.method,
        headers: resolved.headers,
        body: resolved.body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      const duration = Math.round(performance.now() - startTime);
      const level = response.ok
        ? "debug"
        : response.status >= 500
          ? "error"
          : "warn";
      runtime.logger[level](
        {
          type: "proxy",
          target: resolved.targetName,
          method: resolved.method,
          url: resolved.url,
          status: response.status,
          duration,
          requestId: req.requestId,
        },
        `[app.fetch.proxy] ${resolved.method} ${resolved.url} ${response.status} ${duration}ms`,
      );

      if (
        response.status >= 500 &&
        retryableMethod &&
        resolved.replayableBody &&
        attempt < maxRetries
      ) {
        try {
          await response.body?.cancel();
        } catch {
          // best-effort cleanup only
        }
        if (currentController === controller) {
          currentController = null;
        }
        continue;
      }

      // Keep the controller attached after headers arrive so req.onClose()
      // can still abort an in-flight streamed response body.
      return response;
    } catch (err) {
      clearTimeout(timer);
      if (currentController === controller) {
        currentController = null;
      }

      const error = err instanceof Error ? err : new Error(String(err));
      if (isAbortError(error)) {
        if (clientAborted) {
          throw new ProxyClientAbortError();
        }
        if (timedOut) {
          throw new ProxyTimeoutError(
            `[app.fetch.proxy] ${resolved.method} ${resolved.url} timed out after ${resolved.timeout}ms.`,
            resolved.timeout,
          );
        }
      }

      runtime.logger.error(
        {
          type: "proxy",
          target: resolved.targetName,
          method: resolved.method,
          url: resolved.url,
          error: error.message,
          requestId: req.requestId,
        },
        `[app.fetch.proxy] ${resolved.method} ${resolved.url} ERROR: ${error.message}`,
      );

      if (retryableMethod && resolved.replayableBody && attempt < maxRetries) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    `[app.fetch.proxy] ${resolved.method} ${resolved.url} failed.`,
  );
}

async function writeProxyResponse(
  response: Response,
  res: VextResponse,
): Promise<void> {
  const contentType = response.headers.get("content-type") ?? undefined;
  const isJson =
    contentType?.includes("application/json") === true ||
    contentType?.includes("+json") === true;
  const isText = contentType?.startsWith("text/") === true;

  res.status(response.status);

  if (BODYLESS_STATUS.has(response.status)) {
    copyProxyResponseHeaders(response, res, false);
    res.text("", response.status);
    return;
  }

  if (isJson || isText || !response.body) {
    const body = await response.text();
    copyProxyResponseHeaders(response, res, false);
    res.text(body, response.status);
    return;
  }

  copyProxyResponseHeaders(response, res, true);
  const stream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
  res.stream(stream, contentType ?? "application/octet-stream");
}

function copyProxyResponseHeaders(
  response: Response,
  res: VextResponse,
  keepContentEncoding: boolean,
): void {
  response.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) return;
    if (lower === "content-length") return;
    if (!keepContentEncoding && lower === "content-encoding") return;
    res.setHeader(key, value);
  });
}

function writeProxyLocalError(
  req: VextRequest,
  res: VextResponse,
  status: number,
  code: string,
  message: string,
): void {
  res.rawJson(
    {
      code,
      message,
      requestId: req.requestId,
    },
    status,
  );
}

function isAbortError(error: Error): boolean {
  return error.name === "AbortError";
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
