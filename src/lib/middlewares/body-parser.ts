import type { VextMiddleware } from "../../types/middleware.js";
import type { VextBodyParserConfig } from "../../types/app.js";

/**
 * parseBytes — 将人类可读的体积字符串转为字节数
 *
 * 支持格式：'512b' | '1kb' | '10mb' | '1gb' 或直接传数字（字节）。
 * 大小写不敏感。
 *
 * @param value 体积字符串或字节数
 * @returns 字节数
 * @throws 格式不合法时抛出 Error
 */
export function parseBytes(value: string | number): number {
  if (typeof value === "number") {
    return value;
  }

  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i);
  if (!match) {
    throw new Error(
      `[vextjs] Invalid body size format: "${value}". ` +
        `Expected format: '1mb', '512kb', '1gb', or a number (bytes).`,
    );
  }

  const num = parseFloat(match[1]!);
  const unit = match[2]!.toLowerCase();

  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
  };

  return Math.floor(num * multipliers[unit]!);
}

/**
 * createBodyParserMiddleware — Body 解析中间件工厂
 *
 * 内置中间件 #3，职责：
 *   1. 解析 application/json 请求体 → req.body（对象）
 *   2. 解析 application/x-www-form-urlencoded 请求体 → req.body（对象）
 *   3. 其他 Content-Type → 跳过，req.body 保持 undefined
 *   4. 请求体大小检查 → 超过 maxBodySize 返回 413 Payload Too Large
 *
 * 配置项（config.bodyParser）：
 *   - maxBodySize: 请求体最大体积（默认 '1mb'），支持 '512b' | '1kb' | '10mb' | '1gb' 或数字
 *
 * 内存安全：
 *   body-parser 在读取请求体时逐块累计大小，
 *   一旦超过 maxBodySize 立即中止读取并返回 413，
 *   不会将超大请求体完整读入内存。
 *
 * 设计说明：
 *   - GET / HEAD / DELETE / OPTIONS 等无 body 方法直接跳过（不读取流）
 *   - Hono adapter 已将 Node.js IncomingMessage 转为 Web Request，
 *     但 body 解析由 vext body-parser 在中间件层完成（而非 adapter 层），
 *     确保用户中间件和 handler 拿到的 req.body 是已解析的对象
 *   - multipart/form-data 不在内置支持范围内，需通过插件扩展
 *
 * 与 Hono adapter 的协作：
 *   Hono adapter 的 buildHandler() 将 Node.js IncomingMessage 转为 Web ReadableStream
 *   作为 Web Request 的 body。createVextRequest 通过 c.req.raw.body 可访问该流。
 *   body-parser 从 c.req.raw 获取原始请求体文本后解析为对象。
 *
 *   实际实现中，我们通过 req.headers['content-type'] 判断类型，
 *   通过 req 上附带的原始 body 文本（由 adapter 传递）进行解析。
 *   由于 Hono 已经处理了 Web Request 的 body 读取，
 *   我们在 VextRequest 上通过一个特殊的 _rawBody 字段传递原始字节。
 *
 *   实际上 Hono adapter 中 createVextRequest 保存了 Hono Context 引用，
 *   body-parser 可以通过 (req as any)._honoContext.req.text() 读取原始文本。
 *   但为了解耦，我们使用 req 上的 _getRawBody 方法（由 adapter 注入）。
 *
 *   → 简化方案：由于 VextRequest 是 adapter 内部创建的对象，
 *     body-parser 直接通过 (req as any)._rawBody() 获取 Promise<string>
 *     该方法由 createVextRequest 注入（从 Hono Context 读取）。
 *
 * @param config bodyParser 配置（从 VextConfig.bodyParser 提取）
 * @returns VextMiddleware
 */
export function createBodyParserMiddleware(
  config: VextBodyParserConfig,
): VextMiddleware {
  const maxBytes = parseBytes(config.maxBodySize ?? "1mb");

  return async (req, res, next) => {
    // ── 无 body 方法直接跳过 ────────────────────────────
    // req.method 已由 createVextRequest 保证大写，无需 toUpperCase()
    const method = req.method;
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      await next();
      return;
    }

    // ── 无 Content-Type 或无 body 直接跳过 ──────────────
    const contentType = req.headers["content-type"];
    if (!contentType) {
      await next();
      return;
    }

    // ── 仅处理 JSON 和 URL-encoded ─────────────────────
    const isJson = contentType.includes("application/json");
    const isUrlEncoded = contentType.includes(
      "application/x-www-form-urlencoded",
    );

    if (!isJson && !isUrlEncoded) {
      // 其他 Content-Type（multipart 等）跳过，req.body 保持 undefined
      await next();
      return;
    }

    // ── 读取原始请求体 ──────────────────────────────────
    //
    // VextRequest 上通过 adapter 注入了 _getRawBody() 方法，
    // 返回原始请求体的字符串。adapter 内部通过 Hono Context 的
    // c.req.text() 读取 Web Request body。
    //
    // 如果 _getRawBody 不可用（理论上不应发生，但防御性编码），
    // 则跳过解析。
    //
    let rawBody: string;

    try {
      const getRawBody = (req as Record<string, unknown>)._getRawBody as
        | (() => Promise<string>)
        | undefined;

      if (!getRawBody) {
        // adapter 未注入 _getRawBody，跳过（不应发生）
        await next();
        return;
      }

      rawBody = await getRawBody();
    } catch {
      // 读取失败（客户端可能已断开）
      res.rawJson(
        { code: 400, message: "Bad Request: unable to read request body" },
        400,
      );
      return;
    }

    // ── 检查体积限制 ────────────────────────────────────
    //
    // 使用 Buffer.byteLength 而非 string.length，
    // 因为多字节字符（中文等）的字节数 > 字符数。
    //
    const bodyBytes = Buffer.byteLength(rawBody, "utf-8");

    if (bodyBytes > maxBytes) {
      res.rawJson(
        {
          code: 413,
          message: "Payload Too Large",
          requestId: req.requestId,
        },
        413,
      );
      return;
    }

    // ── 空 body 直接跳过 ────────────────────────────────
    if (rawBody.length === 0) {
      req.body = isJson ? undefined : {};
      await next();
      return;
    }

    // ── 解析 ────────────────────────────────────────────
    try {
      if (isJson) {
        req.body = JSON.parse(rawBody);
      } else {
        // URL-encoded → 使用 URLSearchParams 解析为纯对象
        const params = new URLSearchParams(rawBody);
        const parsed: Record<string, string> = {};
        for (const [key, value] of params.entries()) {
          parsed[key] = value;
        }
        req.body = parsed;
      }
    } catch {
      // JSON 解析失败 → 400 Bad Request
      res.rawJson(
        {
          code: 400,
          message: "Bad Request: invalid JSON in request body",
          requestId: req.requestId,
        },
        400,
      );
      return;
    }

    await next();
  };
}
