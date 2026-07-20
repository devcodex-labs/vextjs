import { randomUUID } from "node:crypto";
import { requestContext } from "../request-context.js";
import type { VextMiddleware } from "../../types/middleware.js";
import type { VextRequestIdConfig } from "../../types/app.js";
import type { VextLocaleConfig } from "../../types/app.js";

/**
 * createRequestIdMiddleware — 请求 ID 中间件工厂
 *
 * 内置中间件 #1（执行顺序最靠前），职责：
 *   1. 从请求头透传 requestId（网关注入场景），不存在则生成 UUID v4
 *   2. 挂载到 req.requestId
 *   3. 写入 AsyncLocalStorage（requestContext）— logger / app.throw / app.fetch 等依赖此数据
 *   4. 写入响应头（默认 x-request-id）
 *   5. 从入站请求中捕获 propagateHeaders 列表中的头，写入 store.propagatedHeaders
 *      供 app.fetch 在出站请求时自动透传（分布式追踪头、多租户头等）
 *
 * 配置项（config.requestId）：
 *   - enabled:        是否启用（默认 true）；false 时 req.requestId = ''，不写入 store
 *   - header:         从哪个请求头读取（默认 'x-request-id'）
 *   - responseHeader: 将 requestId 写入响应头（默认 'x-request-id'）
 *   - generate:       自定义生成函数（默认 crypto.randomUUID）；
 *                     插件可通过 app.setRequestIdGenerator() 覆盖
 *
 * 与 requestContext 的关系：
 *   adapter 在 registerRoute 中已调用 requestContext.run({ requestId: '', locale: undefined }, ...)
 *   创建了请求作用域。本中间件在链最前端执行，将真实 requestId 写入已有的 store 中。
 *   后续代码通过 requestContext.getStore()?.requestId 读取（logger mixin / defaultThrow / app.fetch）。
 *
 * propagatedHeaders 写入机制：
 *   从入站请求头中提取 propagateHeaderNames 列表中指定的头（小写匹配），
 *   存入 store.propagatedHeaders（Record<string, string>），键名统一小写。
 *   app.fetch 在构建出站请求时从此字段读取并注入，实现"入站头 → store → 出站头"完整链路。
 *
 * @param config               requestId 配置（从 VextConfig.requestId 提取）
 * @param getGenerator         获取当前 ID 生成函数的 getter（支持 app.setRequestIdGenerator() 运行时替换）
 * @param propagateHeaderNames 需要从入站请求捕获并透传到下游的头名称列表（来自 config.fetch.propagateHeaders）
 * @param localeConfig         i18n locale 配置（从 VextConfig.locale 提取），用于解析 Accept-Language 并写入 store.locale
 * @returns VextMiddleware
 */
export function createRequestIdMiddleware(
  config: VextRequestIdConfig,
  getGenerator: () => (() => string) | null,
  propagateHeaderNames: string[] = [],
  localeConfig?: VextLocaleConfig,
): VextMiddleware {
  const enabled = config.enabled ?? true;
  const headerName = (config.header ?? "x-request-id").toLowerCase();
  const responseHeader = config.responseHeader ?? "x-request-id";

  // 预计算小写头名称列表，避免每次请求重复 toLowerCase()
  const normalizedPropagateHeaders = propagateHeaderNames.map((h) =>
    h.toLowerCase(),
  );

  // i18n locale 配置
  const defaultLocale = localeConfig?.default ?? "en-US";
  const supportedLocales = localeConfig?.supported ?? [];
  // 预计算小写 → 原始格式映射，避免每次请求重复处理
  const supportedLocaleMap = new Map<string, string>();
  for (const loc of supportedLocales) {
    supportedLocaleMap.set(loc.toLowerCase(), loc);
  }

  return async (req, res, next) => {
    if (!enabled) {
      // 禁用模式：req.requestId 保持空字符串（adapter 初始化时已设为 ''）
      req.requestId = "";
      await next();
      return;
    }

    // ── 步骤 1：获取或生成 requestId ──────────────────────
    // 优先从请求头透传（网关注入），不存在则调用 generate()
    const fromHeader = firstHeaderValue(req.headers[headerName]);
    const generate = getGenerator() ?? config.generate ?? randomUUID;
    const generated = fromHeader || generate();
    const requestId = assertValidRequestId(generated);

    // ── 步骤 2：挂载到 req.requestId ─────────────────────
    req.requestId = requestId;

    // ── 步骤 3：写入 AsyncLocalStorage store ─────────────
    // adapter 已 run() 了 requestContext，这里更新已有 store
    const store = requestContext.getStore();
    if (store) {
      store.requestId = requestId;

      // ── 步骤 3a：解析 Accept-Language → store.locale ───
      //
      // 从 Accept-Language 请求头解析用户偏好语言，
      // 与 config.locale.supported 列表匹配，写入 store.locale。
      // app.throw 内部的 I18nError.create() 通过此字段获取 locale，
      // 确保每个请求独立翻译，不受并发请求干扰。
      //
      // 匹配策略：
      //   1. 精确匹配（如 zh-CN → zh-CN）
      //   2. 前缀匹配（如 zh → zh-CN，en → en-US）
      //   3. 无匹配 → 使用 config.locale.default
      //
      if (supportedLocales.length > 0) {
        const acceptLang = req.headers["accept-language"];
        if (acceptLang) {
          store.locale = parseAcceptLanguage(
            acceptLang,
            supportedLocaleMap,
            defaultLocale,
          );
        } else {
          store.locale = defaultLocale;
        }
      }

      // ── 步骤 3b：捕获 propagatedHeaders ────────────────
      // 从入站请求头中提取需要透传到下游的头，写入 store.propagatedHeaders
      // app.fetch 会在出站请求时从 store 中读取并注入这些头
      if (normalizedPropagateHeaders.length > 0) {
        const captured: Record<string, string> = {};
        for (const headerKey of normalizedPropagateHeaders) {
          const value = req.headers[headerKey];
          if (value) {
            // req.headers 的值可能是 string | string[]（多值头），取第一个
            captured[headerKey] = Array.isArray(value) ? value[0] : value;
          }
        }
        // 仅当有实际捕获到的头时才赋值，避免空对象污染 store
        if (Object.keys(captured).length > 0) {
          store.propagatedHeaders = captured;
        }
      }
    }

    // ── 步骤 4：写入响应头 ───────────────────────────────
    res.setHeader(responseHeader, requestId);

    await next();
  };
}

/**
 * parseAcceptLanguage — 解析 Accept-Language 头并匹配支持的 locale
 *
 * 按 quality factor 排序，依次尝试精确匹配和前缀匹配。
 * Accept-Language 格式示例：
 *   "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7"
 *
 * @param header         Accept-Language 请求头原始值
 * @param supportedMap   小写 locale → 原始格式的映射（如 'zh-cn' → 'zh-CN'）
 * @param defaultLocale  默认 locale（无匹配时回退）
 * @returns 匹配到的 locale 字符串
 *
 * @internal
 */
function parseAcceptLanguage(
  header: string,
  supportedMap: Map<string, string>,
  defaultLocale: string,
): string {
  // 解析为 { locale, quality } 数组并按 quality 降序排列
  const parts = header
    .split(",")
    .map((part) => {
      const segments = part.trim().split(";");
      const localeStr = segments[0]?.trim().toLowerCase() ?? "";
      const qParam = segments.slice(1).find((p) => p.trim().startsWith("q="));
      const quality = qParam ? parseFloat(qParam.trim().slice(2)) : 1.0;
      return { locale: localeStr, quality };
    })
    .filter((p) => p.quality > 0 && p.locale !== "*")
    .sort((a, b) => b.quality - a.quality);

  // 1. 精确匹配
  for (const { locale } of parts) {
    const match = supportedMap.get(locale);
    if (match) return match;
  }

  // 2. 前缀匹配（如 "zh" 匹配 "zh-CN"）
  for (const { locale } of parts) {
    const prefix = locale.split("-")[0] ?? locale;
    for (const [key, value] of supportedMap) {
      if (key.startsWith(prefix)) return value;
    }
  }

  // 3. 无匹配 → 默认值
  return defaultLocale;
}

function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function assertValidRequestId(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("[vextjs] requestId must be a string.");
  }
  if (value.length === 0 || value.length > 512) {
    throw new Error(
      "[vextjs] requestId must be a non-empty string up to 512 characters.",
    );
  }
  if (/[\u0000-\u001F\u007F]/u.test(value)) {
    throw new Error("[vextjs] requestId must not contain control characters.");
  }
  return value;
}
