import type { FastifyRequest } from "fastify";

/**
 * 解析客户端 IP 地址
 *
 * Fastify 内置 trustProxy 支持（通过 Fastify 配置项 trustProxy），
 * 但 vext 有自己的 trustProxy 逻辑（config.trustProxy）。
 * 为保持 Adapter 间行为一致，此处自行解析，与 Hono Adapter 逻辑对齐。
 *
 * trustProxy = true 时，从 X-Forwarded-For 请求头读取第一个 IP（代理链的原始客户端 IP）。
 * trustProxy = false 时，从底层 socket 的 remoteAddress 读取。
 *
 * @param request    Fastify Request 对象
 * @param trustProxy 是否信任代理（来自 VextConfig.trustProxy）
 * @returns 客户端 IP 地址
 */
export function resolveIp(
  request: FastifyRequest,
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const xff = request.headers["x-forwarded-for"];

    if (typeof xff === "string") {
      const firstIp = xff.split(",")[0];
      if (firstIp) return firstIp.trim();
    }

    // Node.js headers 中 x-forwarded-for 也可能是 string[]（多值头）
    if (Array.isArray(xff) && xff.length > 0) {
      const firstEntry = xff[0];
      if (firstEntry) {
        const firstIp = firstEntry.split(",")[0];
        if (firstIp) return firstIp.trim();
      }
    }
  }

  // 直接从底层 socket 获取（不依赖 Fastify 的 request.ip，
  // 因为 Fastify request.ip 受 Fastify 自身 trustProxy 配置影响，
  // 而 vext 有独立的 trustProxy 逻辑，需要行为一致性）
  return request.raw.socket.remoteAddress ?? "127.0.0.1";
}

/**
 * 解析请求协议
 *
 * trustProxy = true 时，从 X-Forwarded-Proto 请求头读取。
 * trustProxy = false 时，检查 socket 是否为 TLS 加密连接。
 *
 * @param request    Fastify Request 对象
 * @param trustProxy 是否信任代理（来自 VextConfig.trustProxy）
 * @returns 请求协议 'http' | 'https'
 */
export function resolveProtocol(
  request: FastifyRequest,
  trustProxy: boolean,
): "http" | "https" {
  if (trustProxy) {
    const proto = request.headers["x-forwarded-proto"];
    if (proto === "https") return "https";
  }

  // 检查 socket 是否为 TLS（https）连接
  // TLSSocket 有 encrypted 属性（值为 true）
  const encrypted = (request.raw.socket as unknown as Record<string, unknown>)
    ?.encrypted;
  return encrypted ? "https" : "http";
}
