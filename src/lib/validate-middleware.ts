import type { VextMiddleware } from "../types/middleware.js";
import type { VextRequest } from "../types/request.js";
import type {
  VextInternalHooks,
  VextRouteHookInfo,
  VextValidationLocationResult,
} from "../types/hooks.js";
import { VextValidationError } from "../types/errors.js";

/**
 * validate-middleware.ts — 路由级参数校验中间件
 *
 * 由 router-loader 在路由注册阶段调用 buildValidateMiddleware()，
 * 将 RouteOptions.validate 配置编译为中间件并插入路由执行链。
 *
 * 核心流程：
 *   1. 启动时预编译（buildValidateMiddleware 调用时）：
 *      对 validate 配置的每个位置（query/body/param/header/cookie）调用
 *      schemaAdapter.compile() 将 DSL 定义编译为 JSON Schema。
 *      这只在路由注册时执行一次，而非每次请求都编译，性能最优。
 *
 *   2. 请求时校验（中间件被调用时）：
 *      按 param → query → header → cookie → body 顺序依次校验。
 *      - 全部通过 → 将校验后的数据写入 req._validated_<location>，调用 next()
 *      - 校验失败 → 抛出 VextValidationError；param 为 400，其余为 422
 *
 * 校验顺序说明：
 *   param → query → header → cookie → body
 *   路径参数最简单（通常只校验格式），body 最复杂。
 *   按复杂度递增排列，越简单的越先检测，快速失败。
 *   第一个失败的位置立即抛出，后续位置不再校验。
 *
 * 与 req.valid() 的关系：
 *   校验通过的数据存储在 req._validated_query / req._validated_body 等内部属性上。
 *   req.valid('query') 读取 req._validated_query 返回校验后的类型化数据。
 *   schema-dsl 在校验过程中会自动做类型转换（如 query 中的数字字符串 → number）。
 *
 * 与 VextValidator 的关系：
 *   本模块使用 app.getValidator() 获取当前校验引擎（默认 schema-dsl）。
 *   如果插件通过 app.setValidator() 替换为 Zod 等，
 *   validate 配置中的 schema 就是 Zod schema，compile/execute 走替换后的逻辑。
 *   本模块与具体校验库解耦。
 *
 * @module lib/validate-middleware
 * @see IMPLEMENTATION-PLAN.md 任务 1.13
 * @see 01a-validate.md §4（框架内部处理流程）
 * @see 01a-validate.md §7（框架内部实现参考）
 */

/**
 * 校验位置定义
 *
 * 按校验执行顺序排列：param → query → header → body
 */
const VALIDATE_LOCATIONS = [
  "param",
  "query",
  "header",
  "cookie",
  "body",
] as const;

type ValidateLocation = (typeof VALIDATE_LOCATIONS)[number];

/**
 * 路由 validate 配置类型
 *
 * 与 RouteOptions.validate 对齐。
 * 每个位置的值是 DSL 定义对象（schema-dsl 场景）或任意 schema（Zod 等场景）。
 */
export interface ValidateConfig {
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  param?: Record<string, unknown>;
  header?: Record<string, unknown>;
  cookie?: Record<string, unknown>;
}

/**
 * 编译后的校验函数类型
 *
 * compile() 返回的校验函数，接收原始数据，返回校验结果。
 */
type CompiledValidator = (data: unknown) => {
  valid: boolean;
  data?: unknown;
  errors?: Array<{ field: string; message: string }>;
};

/**
 * buildValidateMiddleware — 构建路由级校验中间件
 *
 * 在路由注册阶段（启动时）由 router-loader 调用，非每次请求时调用。
 * 将 RouteOptions.validate 配置预编译为中间件。
 *
 * @param validateConfig  路由的 validate 配置（来自 RouteOptions.validate）
 * @param getValidator    获取当前校验引擎的 getter（支持插件替换）
 * @returns VextMiddleware 或 null（无 validate 配置时返回 null，不插入中间件链）
 *
 * @example
 * ```typescript
 * // router-loader 内部
 * const validateMw = buildValidateMiddleware(route.options.validate, () => app.getValidator())
 * if (validateMw) {
 *   chain.push(validateMw)
 * }
 * ```
 */
export function buildValidateMiddleware(
  validateConfig: ValidateConfig | undefined,
  getValidator: () => {
    compile(schema: Record<string, unknown>): CompiledValidator;
  },
  hooks?: VextInternalHooks,
  route?: VextRouteHookInfo,
): VextMiddleware | null {
  // 无 validate 配置 → 跳过校验，不插入中间件
  if (!validateConfig) return null;

  // 检查是否有任何位置需要校验
  const hasAnySchema = VALIDATE_LOCATIONS.some(
    (loc) => validateConfig[loc] != null,
  );
  if (!hasAnySchema) return null;

  // ── 启动时预编译（只执行一次）─────────────────────────────
  //
  // 对每个有 schema 的位置调用 validator.compile()，
  // 将 DSL 定义编译为校验函数。编译结果缓存在闭包中，
  // 后续每次请求直接调用编译后的函数，无需重复编译。
  //
  const validator = getValidator();

  const compiled: Partial<Record<ValidateLocation, CompiledValidator>> = {};

  for (const loc of VALIDATE_LOCATIONS) {
    const schema = validateConfig[loc];
    if (schema != null) {
      compiled[loc] = validator.compile(schema);
    }
  }

  // ── 返回中间件函数（每次请求执行）─────────────────────────
  return async (req, _res, next) => {
    const locationResults: VextValidationLocationResult[] = [];

    for (const loc of VALIDATE_LOCATIONS) {
      const validate = compiled[loc];
      if (!validate) continue;

      // ── 获取该位置的原始数据 ───────────────────────────
      const rawData = getRawData(req, loc);

      // ── 执行校验 ──────────────────────────────────────
      const result = validate(rawData);

      if (!result.valid) {
        // ── 校验失败 → 抛出 VextValidationError ─────────
        //
        // 第一个失败的位置立即抛出，后续位置不再校验。
        // VextValidationError 被全局 error-handler 捕获，
        // param 失败格式化为 400；其他位置保持 422。
        //
        const errors = (result.errors ?? []).map((e) => ({
          field: e.field ?? "",
          message: e.message ?? "Validation failed",
        }));

        if (hooks && route) {
          await hooks.emitSafe("validation:error", {
            req,
            route,
            errors,
            requestId: req.requestId,
          });
        }

        throw new VextValidationError(
          errors,
          "Validation failed",
          loc === "param" ? 400 : 422,
        );
      }

      // ── 校验通过 → 存储校验后的数据 ───────────────────
      //
      // 写入 req._validated_<location>，
      // req.valid('query') 等方法从这些属性读取。
      // schema-dsl 校验后的数据可能经过类型转换
      // （如 query 中 '123' → 123），所以存储 result.data 而非原始数据。
      //
      // Headers: project declared keys only with stable lowercase order so
      // Node vs Web Headers host bags do not break adapter parity.
      let storedData = result.data;
      if (
        loc === "header" &&
        storedData &&
        typeof storedData === "object" &&
        !Array.isArray(storedData) &&
        validateConfig.header &&
        typeof validateConfig.header === "object"
      ) {
        const source = storedData as Record<string, unknown>;
        const projected: Record<string, unknown> = {};
        for (const key of Object.keys(validateConfig.header).sort((a, b) =>
          a.toLowerCase().localeCompare(b.toLowerCase()),
        )) {
          const lower = key.toLowerCase();
          if (Object.prototype.hasOwnProperty.call(source, lower)) {
            projected[lower] = source[lower];
          } else if (Object.prototype.hasOwnProperty.call(source, key)) {
            projected[lower] = source[key];
          }
        }
        storedData = projected;
      }

      (req as Record<string, unknown>)[`_validated_${loc}`] = storedData;
      locationResults.push({
        location: loc,
        data: storedData,
      });
    }

    if (hooks && route) {
      await hooks.emit("validation:success", {
        req,
        route,
        locationResults,
        requestId: req.requestId,
      });
    }

    await next();
  };
}

/**
 * getRawData — 根据校验位置获取对应的原始请求数据
 *
 * location 与数据源映射：
 *   'query'  → req.query   （URL 查询参数）
 *   'body'   → req.body    （请求体，由 body-parser 中间件填充）
 *   'param'  → req.params  （路径动态参数，如 /:id）
 *   'header' → req.headers （请求头）
 *   'cookie' → req.cookies （Cookie 参数）
 *
 * 注意：location 使用单数 'param'（与 validate 配置的 key 一致），
 * 但底层数据源是复数 req.params。框架内部已正确映射。
 *
 * @param req VextRequest 实例
 * @param loc 校验位置
 * @returns 对应位置的原始数据
 */
function getRawData(req: VextRequest, loc: ValidateLocation): unknown {
  switch (loc) {
    case "query":
      return req.query;
    case "body":
      return req.body;
    case "param":
      return req.params;
    case "header":
      return req.headers;
    case "cookie":
      return req.cookies;
  }
}
