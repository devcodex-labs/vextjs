/**
 * schema-adapter.ts — schema-dsl 防腐层（Anti-Corruption Layer）
 *
 * 所有 vext 内部模块（validate 中间件、OpenAPI SchemaConverter、i18n-loader、
 * default-throw 等）统一通过此模块访问 schema-dsl，禁止直接 import schema-dsl。
 *
 * 设计目的：
 *   1. 隔离 schema-dsl 的 breaking change 风险 — 签名变更只需修改此文件
 *   2. 统一版本锁定 — package.json 锁定 schema-dsl 版本，此处封装 API 调用
 *   3. 集中类型适配 — schema-dsl 的类型在此处映射为 vext 内部类型
 *   4. 可测试性 — 测试时可 mock 此模块替换 schema-dsl 实现
 *
 * 使用规则：
 *   ✅ import { schemaAdapter } from './schema-adapter.js'
 *   ❌ import { dsl, validate, I18nError } from 'schema-dsl'  // 禁止直接引用
 *
 * @module lib/schema-adapter
 * @see IMPLEMENTATION-PLAN.md 任务 1.0
 * @see 06b-error.md §1.1.1（schema-dsl 与 vext 的依赖方向）
 */

import { createRequire } from "node:module";
import {
  dsl,
  validate as schemaDslValidate,
  I18nError,
  ObjectDslBuilder,
} from "schema-dsl";
import type {
  JSONSchema,
  ValidationResult,
  ValidateOptions,
  DslDefinition,
  IDslBuilder,
  SchemaIOOptions,
  DslConfigOptions,
  ErrorMessages,
} from "schema-dsl";

const requireFromHere = createRequire(import.meta.url);
let cjsSchemaDsl:
  | {
      dsl?: {
        config?: (options: Parameters<typeof dsl.config>[0]) => void;
      };
    }
  | null
  | undefined;

const COMPILED_SCHEMA_CACHE_MAX_SIZE = 256;
const DSL_BUILDER_CACHE_KEY = "__vextDslBuilder";
const compiledSchemaCache = new Map<string, JSONSchema>();

type CompileCacheValue =
  | null
  | string
  | number
  | boolean
  | CompileCacheValue[]
  | { [key: string]: CompileCacheValue };

function rememberCompiledSchema(
  cacheKey: string,
  schema: JSONSchema,
): JSONSchema {
  deepFreezeSchema(schema);
  compiledSchemaCache.set(cacheKey, schema);
  if (compiledSchemaCache.size > COMPILED_SCHEMA_CACHE_MAX_SIZE) {
    const oldestKey = compiledSchemaCache.keys().next().value;
    if (oldestKey !== undefined) {
      compiledSchemaCache.delete(oldestKey);
    }
  }
  return schema;
}

function getRememberedCompiledSchema(cacheKey: string): JSONSchema | undefined {
  const schema = compiledSchemaCache.get(cacheKey);
  if (!schema) {
    return undefined;
  }
  compiledSchemaCache.delete(cacheKey);
  compiledSchemaCache.set(cacheKey, schema);
  return schema;
}

function clearCompiledSchemaCache(): void {
  compiledSchemaCache.clear();
}

function getCompileCacheKey(
  definition: DslDefinition,
  options?: SchemaIOOptions,
): string | null {
  const normalizedDefinition = normalizeCompileCacheValue(
    definition,
    new WeakSet<object>(),
  );
  if (normalizedDefinition === undefined) {
    return null;
  }

  const normalizedOptions =
    options === undefined
      ? null
      : normalizeCompileCacheValue(options, new WeakSet<object>());
  if (normalizedOptions === undefined) {
    return null;
  }

  return JSON.stringify([normalizedDefinition, normalizedOptions]);
}

function normalizeCompileCacheValue(
  value: unknown,
  seen: WeakSet<object>,
): CompileCacheValue | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  ) {
    return undefined;
  }

  if (isDslBuilder(value)) {
    try {
      const normalizedSchema = normalizeCompileCacheValue(
        toJsonSchema(value),
        seen,
      );
      return normalizedSchema === undefined
        ? undefined
        : { [DSL_BUILDER_CACHE_KEY]: normalizedSchema };
    } catch {
      return undefined;
    }
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return undefined;
    }
    seen.add(value);
    const normalized: CompileCacheValue[] = [];
    for (const item of value) {
      const normalizedItem = normalizeCompileCacheValue(item, seen);
      if (normalizedItem === undefined) {
        seen.delete(value);
        return undefined;
      }
      normalized.push(normalizedItem);
    }
    seen.delete(value);
    return normalized;
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      Object.getOwnPropertySymbols(value).length > 0 ||
      seen.has(value)
    ) {
      return undefined;
    }

    seen.add(value);
    const source = value as Record<string, unknown>;
    const normalized: { [key: string]: CompileCacheValue } = {};
    for (const key of Object.keys(source)) {
      const normalizedItem = normalizeCompileCacheValue(source[key], seen);
      if (normalizedItem === undefined) {
        seen.delete(value);
        return undefined;
      }
      normalized[key] = normalizedItem;
    }
    seen.delete(value);
    return normalized;
  }

  return undefined;
}

function deepFreezeSchema<T extends object>(
  value: T,
  seen = new WeakSet<object>(),
): T {
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (child && typeof child === "object") {
      deepFreezeSchema(child as object, seen);
    }
  }
  return Object.freeze(value);
}

// ── 重导出类型（vext 内部模块可直接使用）────────────────────────

export type {
  JSONSchema,
  ValidationResult,
  ValidateOptions,
  DslDefinition,
  SchemaIOOptions,
  DslConfigOptions,
  ErrorMessages,
};

/** vext 对外保留的 builder 类型名，绑定 schema-dsl 公开结构接口而非实现类。 */
export type DslBuilder = IDslBuilder;

export { I18nError };

// ── 防腐层封装 ──────────────────────────────────────────────

/**
 * 编译 DSL 定义为 JSON Schema
 *
 * 封装 `dsl()` 主入口函数。
 *
 * @param definition 完整对象 DSL 定义
 * @param options    编译选项（可选）
 * @returns JSON Schema 对象
 *
 * @example
 * ```typescript
 * import { schemaAdapter } from './schema-adapter.js'
 *
 * // 对象定义 → JSON Schema
 * const schema = schemaAdapter.compile({
 *   username: 'string:3-32!',
 *   email: 'email!',
 * })
 *
 * // 字符串定义 → DslBuilder
 * const builder = schemaAdapter.compileField('email!')
 * ```
 */
function compile(
  definition: DslDefinition,
  options?: SchemaIOOptions,
): JSONSchema {
  const cacheKey = getCompileCacheKey(definition, options);
  if (cacheKey) {
    const cached = getRememberedCompiledSchema(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const internalSchema = dsl(definition, options);
  const compiled = new ObjectDslBuilder(internalSchema).toJsonSchema();
  return cacheKey ? rememberCompiledSchema(cacheKey, compiled) : compiled;
}

/**
 * 编译单个字段定义为 DslBuilder
 *
 * @param definition 字段 DSL 字符串（如 'string:3-32!'、'email!'）
 * @returns DslBuilder 实例
 */
function compileField(definition: string): DslBuilder {
  return dsl(definition);
}

/**
 * 判断值是否为 schema-dsl DslBuilder。
 *
 * OpenAPI 生成器需要识别 `compileField("string!").description("...")` 字段级 builder，
 * 但不应直接依赖 schema-dsl 的私有字段结构。
 */
function isDslBuilder(value: unknown): value is DslBuilder {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toJsonSchema?: unknown }).toJsonSchema === "function" &&
    typeof (value as { toSchema?: unknown }).toSchema === "function"
  );
}

/**
 * 将 DslBuilder 转为纯净 JSON Schema。
 */
function toJsonSchema(builder: DslBuilder): JSONSchema {
  return builder.toJsonSchema();
}

export interface VextSchemaValidationError {
  field: string;
  message: string;
}

/**
 * 将 schema-dsl canonical error 映射为 vext 的公开错误形状。
 *
 * 上游只依赖 path/message；field/type/expected 等兼容别名不会进入 vext 边界。
 */
function mapValidationErrors(
  errors: ReadonlyArray<{ path?: string; message?: string }> | null | undefined,
): VextSchemaValidationError[] {
  return (errors ?? []).map((error) => ({
    field: error.path ?? "",
    message: error.message ?? "Validation failed",
  }));
}

/**
 * 同步校验数据
 *
 * 封装 `validate()` 顶层函数。
 *
 * @param schema  JSON Schema 或 DslBuilder
 * @param data    待校验数据
 * @param options 校验选项（locale 等）
 * @returns 校验结果 { valid, data?, errors? }
 *
 * @example
 * ```typescript
 * const schema = schemaAdapter.compile({ email: 'email!' })
 * const result = schemaAdapter.validate(schema, { email: 'test@example.com' })
 *
 * if (!result.valid) {
 *   console.log(result.errors)
 * }
 * ```
 */
function validate<T = unknown>(
  schema: JSONSchema | DslBuilder,
  data: unknown,
  options?: ValidateOptions,
): ValidationResult<T> {
  return schemaDslValidate<T>(schema, data, options);
}

function getI18nParams(
  paramsOrLocale?: Record<string, unknown> | string,
): Record<string, unknown> | undefined {
  if (
    paramsOrLocale &&
    typeof paramsOrLocale === "object" &&
    !Array.isArray(paramsOrLocale)
  ) {
    return paramsOrLocale;
  }
  return undefined;
}

function getParamValue(params: Record<string, unknown>, path: string): unknown {
  let current: unknown = params;
  for (const segment of path.split(".")) {
    if (
      current &&
      typeof current === "object" &&
      segment in (current as Record<string, unknown>)
    ) {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }
    return undefined;
  }
  return current;
}

function renderLegacyMustacheParams(
  message: string,
  params: Record<string, unknown>,
): string {
  return message.replace(/{{\s*([A-Za-z_$][\w$.-]*)\s*}}/g, (match, key) => {
    const value = getParamValue(params, key);
    return value === undefined ? match : String(value);
  });
}

function getCjsSchemaDsl(): NonNullable<typeof cjsSchemaDsl> | null {
  if (cjsSchemaDsl !== undefined) {
    return cjsSchemaDsl;
  }

  try {
    cjsSchemaDsl = requireFromHere("schema-dsl") as NonNullable<
      typeof cjsSchemaDsl
    >;
  } catch {
    cjsSchemaDsl = null;
  }
  return cjsSchemaDsl;
}

function configureCjsSchemaDsl(
  options: Parameters<typeof dsl.config>[0],
): void {
  const cjs = getCjsSchemaDsl();
  if (!cjs) {
    return;
  }

  const cjsConfig = cjs?.dsl?.config;
  if (typeof cjsConfig === "function" && cjs.dsl !== dsl) {
    cjsConfig(options);
  }
}

/**
 * 创建 I18nError 实例（不抛出）
 *
 * 封装 `I18nError.create()` / `dsl.error.create()`。
 * vext 的 defaultThrow 通过此方法获取翻译后的错误信息，
 * 然后自行构造 HttpError 并抛出。
 *
 * @param code          错误代码（i18n key）
 * @param paramsOrLocale 插值参数对象 或 语言代码（智能识别）
 * @param statusCode    HTTP 状态码（默认 400）
 * @param locale        语言环境（当第二参数为对象时有效）
 * @returns I18nError 实例
 *
 * @example
 * ```typescript
 * // 简单用法
 * const err = schemaAdapter.createI18nError('user.not_found', 'zh-CN', 404)
 *
 * // 带参数插值
 * const err = schemaAdapter.createI18nError(
 *   'balance.insufficient',
 *   { balance: 50, required: 100 },
 *   400,
 *   'zh-CN',
 * )
 *
 * // 提取翻译结果
 * console.log(err.message)     // 已翻译的消息
 * console.log(err.code)        // 业务错误码
 * console.log(err.originalKey) // 原始 key
 * ```
 */
function createI18nError(
  code: string,
  paramsOrLocale?: Record<string, unknown> | string,
  statusCode?: number,
  locale?: string,
): I18nError {
  const error = I18nError.create(
    code,
    paramsOrLocale as Record<string, any> | string | undefined,
    statusCode,
    locale,
  );
  const params = getI18nParams(paramsOrLocale);
  if (params) {
    const renderedMessage = renderLegacyMustacheParams(error.message, params);
    if (renderedMessage !== error.message) {
      error.message = renderedMessage;
    }
  }
  return error;
}

/**
 * 配置 schema-dsl 全局设置
 *
 * 封装 `dsl.config()`。
 * i18n-loader 通过此方法注册语言包到 schema-dsl。
 *
 * @param options 配置选项（i18n / cache / patterns 等）
 *
 * @example
 * ```typescript
 * // 注册语言包
 * schemaAdapter.configure({
 *   i18n: {
 *     locales: {
 *       'zh-CN': { 'user.not_found': '用户不存在' },
 *       'en-US': { 'user.not_found': 'User not found' },
 *     },
 *   },
 * })
 * ```
 */
function configure(options: Parameters<typeof dsl.config>[0]): void {
  dsl.config(options);
  configureCjsSchemaDsl(options);
  clearCompiledSchemaCache();
}

// ── 统一导出 ────────────────────────────────────────────────

/**
 * schema-dsl 防腐层
 *
 * vext 内部所有模块通过此对象访问 schema-dsl 功能。
 * 集中管理 API 调用，隔离上游 breaking change。
 *
 * @example
 * ```typescript
 * import { schemaAdapter } from './schema-adapter.js'
 *
 * // 编译 schema
 * const schema = schemaAdapter.compile({ name: 'string:1-50!' })
 *
 * // 校验数据
 * const result = schemaAdapter.validate(schema, { name: 'test' })
 *
 * // 创建 i18n 错误
 * const err = schemaAdapter.createI18nError('user.not_found', 'zh-CN', 404)
 *
 * // 配置语言包
 * schemaAdapter.configure({ i18n: { locales: { 'zh-CN': {...} } } })
 * ```
 */
export const schemaAdapter = {
  /** 编译 DSL 对象定义为 JSON Schema */
  compile,

  /** 编译单个字段 DSL 字符串为 DslBuilder */
  compileField,

  /** 判断值是否为 schema-dsl DslBuilder */
  isDslBuilder,

  /** 将 DslBuilder 转为纯净 JSON Schema */
  toJsonSchema,

  /** 将 canonical path/message 映射为 vext field/message */
  mapValidationErrors,

  /** 同步校验数据 */
  validate,

  /** 创建 I18nError 实例（不抛出，由调用方决定抛出时机） */
  createI18nError,

  /** 配置 schema-dsl 全局设置（i18n 语言包 / 缓存 / 自定义规则） */
  configure,

  /**
   * 原始 dsl 函数引用（escape hatch）
   *
   * 仅在 schemaAdapter 封装不满足需求时使用。
   * 使用前请先考虑是否应该在防腐层增加新的封装方法。
   *
   * @internal
   */
  raw: {
    dsl,
    validate: schemaDslValidate,
    I18nError,
  },
} as const;
