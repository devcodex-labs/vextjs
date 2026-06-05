/**
 * default-throw.ts — 默认错误抛出实现
 *
 * 基于 schema-adapter 防腐层的 I18nError 联动，实现 app.throw() 的默认行为。
 *
 * 核心流程：
 *   1. 智能参数识别（第三参数：number → 业务码，object → i18n 插值参数）
 *   2. 从 requestContext（AsyncLocalStorage）获取当前请求的 locale（并发安全）
 *   3. 调用 schemaAdapter.createI18nError() 完成 i18n 翻译 + 错误码查找
 *   4. 从 I18nError 实例提取翻译结果，构造 HttpError 并抛出
 *
 * 并发安全说明：
 *   defaultThrow 通过 requestContext.getStore()?.locale 获取当前请求的语言，
 *   **不依赖** Locale.currentLocale（全局静态变量，并发请求会互相覆盖）。
 *   请求级 locale 由框架内置中间件写入 AsyncLocalStorage（见 06b-error.md §1.7.1）。
 *
 * 业务错误码优先级：
 *   用户显式传入 code > locale 配置中的 code > 默认使用 status
 *
 * @module lib/default-throw
 * @see 06b-error.md §1.2（内置实现）
 * @see 06b-error.md §1.1.1（schema-dsl 与 vext 的依赖方向）
 * @see IMPLEMENTATION-PLAN.md 任务 1.8
 */

import { HttpError } from "../types/errors.js";
import type { HttpErrorOptions } from "../types/errors.js";
import { requestContext } from "./request-context.js";
import { schemaAdapter } from "./schema-adapter.js";

export interface VextThrowOptions {
  status: number;
  message: string;
  params?: Record<string, unknown>;
  code?: number | string;
  details?: unknown;
}

/**
 * VextThrowFn — app.throw 的函数签名
 *
 * 支持三种调用形式：
 *   - app.throw(messageKey)                          — i18n key 快捷方式（status 从 i18n 配置读取，默认 400）
 *   - app.throw(messageKey, params?)                 — i18n key + 插值参数（status 从 i18n 配置读取，默认 400）
 *   - app.throw(status, message, code?)              — 原始文本 + 可选业务码
 *   - app.throw(status, message, params?, code?)     — i18n key + 插值参数 + 可选业务码
 *   - app.throw(status, message, params?, details)   — 第四参 object/array 作为业务 details
 *   - app.throw({ status, message, params, code, details }) — 完整入口
 */
export type VextThrowFn = {
  (messageKey: string): never;
  (messageKey: string, params: Record<string, unknown>): never;
  (options: VextThrowOptions): never;
  (status: number, message: string, code?: number | string): never;
  (
    status: number,
    message: string,
    params?: Record<string, unknown> | number | string,
    codeOrDetails?: number | string | unknown[] | Record<string, unknown>,
  ): never;
};

/**
 * 创建默认的 app.throw 实现
 *
 * 返回一个闭包函数，内部通过 schema-adapter 防腐层访问 schema-dsl，
 * 完成 i18n 翻译后构造 HttpError 抛出。
 *
 * 之所以是工厂函数而非直接导出函数，是为了：
 *   1. 未来可能需要注入依赖（如 logger）
 *   2. 与 app.setThrow(wrapper) 的 wrapper 模式对齐
 *   3. 测试时可方便地创建独立实例
 *
 * @returns defaultThrow 函数
 *
 * @example
 * ```typescript
 * import { createDefaultThrow } from './default-throw.js'
 *
 * const defaultThrow = createDefaultThrow()
 *
 * // i18n key
 * defaultThrow(404, 'user.not_found')
 *
 * // 原始文本 + 业务码
 * defaultThrow(400, '邮箱已注册', 10001)
 *
 * // i18n key + 参数插值
 * defaultThrow(400, 'balance.insufficient', { balance: 50, required: 100 })
 *
 * // i18n key + 参数 + 业务码
 * defaultThrow(400, 'balance.insufficient', { balance: 50 }, 50001)
 * ```
 */
export function createDefaultThrow(): VextThrowFn {
  const defaultThrow = (
    statusOrKey: number | string | VextThrowOptions,
    messageOrParams?: string | Record<string, unknown>,
    paramsOrCode?: Record<string, unknown> | number | string,
    codeOrDetails?: number | string | unknown[] | Record<string, unknown>,
  ): never => {
    if (isThrowOptions(statusOrKey)) {
      const options = statusOrKey;
      throwTranslatedHttpError(
        options.status,
        options.message,
        options.params ?? {},
        options.code,
        options.details,
      );
    }

    // ── 快捷方式检测 ──────────────────────────────────────
    //
    //   第一参数为 string 时，视为 i18n key 快捷调用：
    //     app.throw('balance.insufficient')
    //     app.throw('balance.insufficient', { balance: 50 })
    //
    //   status 从 i18n 配置的 statusCode 读取，未配置则默认 400。
    //
    if (typeof statusOrKey === "string") {
      const messageKey = statusOrKey;
      const shorthandParams: Record<string, unknown> =
        typeof messageOrParams === "object" && messageOrParams !== null
          ? messageOrParams
          : {};

      // 从请求上下文获取 locale
      const store = requestContext.getStore();
      const locale = store?.locale;

      // 通过 schemaAdapter 查找 i18n 配置（可能包含 statusCode）
      const i18nErr = schemaAdapter.createI18nError(
        messageKey,
        shorthandParams,
        undefined, // statusCode 留空，让 i18n 配置决定
        locale,
      );

      // status 优先级：i18n 配置中的 statusCode > 默认 400
      const resolvedStatus = i18nErr.statusCode ?? 400;

      // 业务错误码：i18n 配置中的 code（如果与 originalKey 不同）
      const localeCode =
        i18nErr.code !== i18nErr.originalKey
          ? Number(i18nErr.code) || i18nErr.code || undefined
          : undefined;

      throw new HttpError(resolvedStatus, i18nErr.message ?? messageKey, {
        code: localeCode,
      });
    }

    // ── 标准调用（第一参数为 number）──────────────────────
    const status = statusOrKey as number;
    const message = messageOrParams as string;

    // ── 智能参数识别 ──────────────────────────────────────
    //
    //   第三参数 paramsOrCode 自动判断类型：
    //     - number → 业务错误码（code）
    //     - string → 业务错误码（code），如 'UNAUTHORIZED'
    //     - object → i18n 插值参数（params），第四参数为 code 或 details
    //     - undefined / null → 无额外参数
    //
    //   第四参 object/array 是新增 details 快捷入口；第四参 number/string
    //   保持旧 code 语义。需要同时传 code + details 时推荐对象式完整入口。
    //
    let params: Record<string, unknown> = {};
    let bizCodeArg: number | string | undefined;
    let details: unknown;

    if (typeof paramsOrCode === "number" || typeof paramsOrCode === "string") {
      bizCodeArg = paramsOrCode;
    } else if (typeof paramsOrCode === "object" && paramsOrCode !== null) {
      params = paramsOrCode;
      if (
        typeof codeOrDetails === "number" ||
        typeof codeOrDetails === "string"
      ) {
        bizCodeArg = codeOrDetails;
      } else if (codeOrDetails !== undefined) {
        details = codeOrDetails;
      }
    }

    throwTranslatedHttpError(status, message, params, bizCodeArg, details);
  };

  return defaultThrow as VextThrowFn;
}

function throwTranslatedHttpError(
  status: number,
  message: string,
  params: Record<string, unknown>,
  bizCodeArg: number | string | undefined,
  details: unknown,
): never {
  // ── 从请求上下文获取 locale（线程安全，避免全局竞态）──
  //
  //   ⚠️ 为什么不用 Locale.currentLocale？
  //   Locale.currentLocale 是全局静态变量，Node.js 并发请求时
  //   一个请求的 setLocale() 会覆盖另一个请求的值——这是竞态 Bug。
  //
  //   正确做法：从 AsyncLocalStorage（requestContext）读取当前请求的 locale，
  //   并将其显式传给 I18nError.create() 的第 4 个参数。
  //
  const store = requestContext.getStore();
  const locale = store?.locale; // 由请求级中间件写入（见 06b-error.md §1.7）

  // ── 核心流程 ──────────────────────────────────────────
  //
  //   1. 将 message 当作 i18n key + params 传给 schemaAdapter.createI18nError()
  //      - schema-dsl 在已注册的语言包中查找该 key
  //      - 找到 → 根据 locale 翻译为本地化文本，并提取 locale 配置中的 code
  //      - 未找到 → 原样保留（退化为原始文本，不报错）
  //
  //   2. 从 I18nError 实例提取翻译后的信息
  //
  //   3. 用户显式传入的 code（业务码）优先级最高：
  //      用户传入 code > locale 配置中的 code > 默认不传（HttpError 构造函数中 code 为 undefined）
  //
  //   4. 构造 HttpError 并抛出
  //

  // 使用 schemaAdapter 防腐层创建 I18nError（不抛出）
  // 第 4 参数显式传 locale → 每个请求独立，不依赖全局 Locale.currentLocale
  const i18nErr = schemaAdapter.createI18nError(
    message,
    params,
    status,
    locale,
  );

  // 业务错误码优先级：用户显式传入 > locale 配置中的 code > undefined
  //
  // 判断 locale 配置中是否定义了独立 code：
  //   - i18nErr.code !== i18nErr.originalKey → locale 配置中定义了 code（如 "40001"）
  //   - i18nErr.code === i18nErr.originalKey → 无独立 code 配置（code 等于 key 本身）
  const localeCode =
    i18nErr.code !== i18nErr.originalKey
      ? Number(i18nErr.code) || i18nErr.code || undefined // locale 配置中定义了 code（number 或 string）
      : undefined; // code 等于 key 本身，说明无独立 code 配置

  const finalCode = bizCodeArg ?? localeCode;
  const options: HttpErrorOptions = {
    code: finalCode,
    details,
  };

  throw new HttpError(
    i18nErr.statusCode ?? status,
    i18nErr.message ?? message,
    options,
  );
}

function isThrowOptions(value: unknown): value is VextThrowOptions {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as VextThrowOptions).status === "number" &&
    typeof (value as VextThrowOptions).message === "string"
  );
}
