import type { Context } from "hono";
import type { VextRequest } from "../../types/request.js";
import type { VextApp } from "../../types/app.js";

/**
 * HonoContext → VextRequest 转换
 *
 * 将 Hono 的 Context 对象转换为 vext 框架的统一请求接口。
 * 所有底层框架特有的 API 在此处适配，后续代码只与 VextRequest 交互。
 *
 * 转换要点：
 *   - query: 从 URL searchParams 解析
 *   - body: 由 body-parser 中间件后续填充（初始 undefined）
 *   - params: 从 Hono 路由参数提取
 *   - headers: 从原始请求头提取（key 全小写）
 *   - requestId: 由 requestId 中间件后续填充（初始空字符串）
 *   - ip: 根据 trustProxy 配置决定从 X-Forwarded-For 或 socket 读取
 *   - protocol: 根据 trustProxy 配置决定从 X-Forwarded-Proto 或默认值读取
 *   - onClose: 注册请求关闭钩子，连接断开时触发
 *   - valid: 获取 validate 中间件校验后的数据
 *
 * @param c           Hono Context 对象
 * @param app         VextApp 实例
 * @returns VextRequest 实例
 */
export function createVextRequest(c: Context, app: VextApp): VextRequest {
  const trustProxy = app.config.trustProxy ?? false;
  const closeHandlers: Array<() => void> = [];

  // ── 解析 query 参数 ──────────────────────────────────────
  // Hono 的 c.req.url 是完整 URL，从中提取 searchParams
  let queryRecord: Record<string, string>;
  try {
    const url = new URL(c.req.url);
    queryRecord = Object.fromEntries(url.searchParams);
  } catch {
    // URL 解析失败时降级为空对象（防御性处理）
    queryRecord = {};
  }

  // ── 解析 headers ─────────────────────────────────────────
  // Hono 的 c.req.raw.headers 是 Headers 对象，转为 Record
  const headersRecord: Record<string, string | undefined> = {};
  c.req.raw.headers.forEach((value, key) => {
    headersRecord[key] = value;
  });

  // ── 解析路由参数 ─────────────────────────────────────────
  // c.req.param() 在某些 Hono 版本中，当路由无动态段时可能抛出异常
  // 使用 try-catch 防御，降级为空对象
  let paramsRecord: Record<string, string>;
  try {
    paramsRecord = (c.req.param() ?? {}) as Record<string, string>;
  } catch {
    paramsRecord = {};
  }

  // ── 缓存原始请求体（body-parser 用）───────────────────────
  // _getRawBody 从 Hono Context 读取原始请求体文本（c.req.text()）。
  // 使用缓存确保多次调用只读取一次流（ReadableStream 只能消费一次）。
  let _rawBodyCache: string | undefined;

  async function getRawBody(): Promise<string> {
    if (_rawBodyCache !== undefined) return _rawBodyCache;
    _rawBodyCache = await c.req.text();
    return _rawBodyCache;
  }

  const req: VextRequest = {
    // ── 原始数据
    query: queryRecord,
    body: undefined, // body-parser 中间件负责填充
    params: paramsRecord,
    headers: headersRecord,
    method: c.req.method.toUpperCase(),
    url: c.req.url,
    path: c.req.path,

    // ── 元信息
    app,
    requestId: "", // requestId 中间件负责填充
    ip: resolveIp(c, trustProxy),
    protocol: resolveProtocol(c, trustProxy),

    // ── 生命周期
    onClose(handler: () => void) {
      closeHandlers.push(handler);
    },

    // ── 校验数据
    valid<T = Record<string, any>>(
      location: "query" | "body" | "param" | "header",
    ): T {
      // validate 中间件将校验后的数据存储在 req._validated_<location> 上
      return (req as Record<string, any>)[`_validated_${location}`] as T;
    },

    // ── 内部方法（body-parser 中间件使用）───────────────────
    // 通过 (req as any)._getRawBody() 访问，不暴露在 VextRequest 公共类型中。
    // 从 Hono Context 读取原始请求体文本，带缓存（流只能消费一次）。
    _getRawBody: getRawBody,
  };

  // ── 请求结束时执行 onClose hooks ─────────────────────────
  // 通过 AbortSignal 监听请求中断（客户端断开连接）
  // 内存安全：执行后清空 handlers 数组，防止闭包泄漏
  try {
    const signal = c.req.raw.signal;
    if (signal) {
      const onAbort = () => {
        for (const h of closeHandlers) {
          try {
            h();
          } catch {
            // onClose handler 异常不应影响其他 handler
          }
        }
        closeHandlers.length = 0;
      };

      if (signal.aborted) {
        // 信号已触发，立即执行
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }
  } catch {
    // 某些环境下 signal 可能不可用，静默忽略
  }

  return req;
}

/**
 * 解析客户端 IP 地址
 *
 * trustProxy = true 时，从 X-Forwarded-For 请求头读取第一个 IP（代理链的原始客户端 IP）。
 * trustProxy = false 时，从底层 socket 的 remoteAddress 读取。
 *
 * @param c          Hono Context
 * @param trustProxy 是否信任代理
 * @returns 客户端 IP 地址
 */
function resolveIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = c.req.header("x-forwarded-for");
    if (xff) {
      const firstIp = xff.split(",")[0];
      if (firstIp) return firstIp.trim();
    }
  }

  // Hono node-server 通过 c.env.incoming 暴露原始 IncomingMessage
  // 从其 socket.remoteAddress 获取客户端 IP
  try {
    const env = c.env as Record<string, any> | undefined;
    const incoming = env?.incoming as
      | { socket?: { remoteAddress?: string } }
      | undefined;
    if (incoming?.socket?.remoteAddress) {
      return incoming.socket.remoteAddress;
    }
  } catch {
    // 环境不支持时降级
  }

  return "127.0.0.1";
}

/**
 * 解析请求协议
 *
 * trustProxy = true 时，从 X-Forwarded-Proto 请求头读取。
 * trustProxy = false 时，默认为 'http'。
 *
 * @param c          Hono Context
 * @param trustProxy 是否信任代理
 * @returns 请求协议 'http' | 'https'
 */
function resolveProtocol(c: Context, trustProxy: boolean): "http" | "https" {
  if (trustProxy) {
    const proto = c.req.header("x-forwarded-proto");
    if (proto === "https") return "https";
  }
  return "http";
}
