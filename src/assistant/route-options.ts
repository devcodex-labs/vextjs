import { RecipeContext, RecipeInputError } from "./recipe-context.js";

export type JsonSafeRouteValue =
  | string
  | number
  | boolean
  | null
  | JsonSafeRouteValue[]
  | { [key: string]: JsonSafeRouteValue };

export interface RouteOptionsInput {
  summary: string;
  responses?: unknown;
  sourceKey?: string;
  includeTopLevel?: boolean;
}

export interface NormalizedRouteOptions {
  options: Record<string, JsonSafeRouteValue>;
  validate: Record<string, JsonSafeRouteValue>;
  hasResponses: boolean;
  hasValidateBody: boolean;
}

const ROUTE_OPTION_KEYS = [
  "validate",
  "responses",
  "auth",
  "middlewares",
  "cache",
] as const;
const DOC_OPTION_KEYS = [
  "description",
  "operationId",
  "security",
  "access",
] as const;
const ROUTE_OPTION_KEY_SET = new Set<string>([...ROUTE_OPTION_KEYS, "docs"]);
const DOC_OPTION_KEY_SET = new Set<string>(["summary", ...DOC_OPTION_KEYS]);
const VALIDATE_LOCATION_SET = new Set<string>([
  "query",
  "body",
  "param",
  "header",
  "cookie",
]);

/** 先归一化再校验，保证 Recipe 的前置判断、渲染和诊断读取同一份 RouteOptions。 */
export function normalizeRouteOptions(
  ctx: RecipeContext,
  input: RouteOptionsInput,
): NormalizedRouteOptions {
  const options = buildRouteOptions(ctx, input);
  const validate = Object.hasOwn(options, "validate")
    ? ensureJsonSafeRecord(options.validate, "validate")
    : {};
  return {
    options,
    validate,
    hasResponses: Object.hasOwn(options, "responses"),
    hasValidateBody: Object.hasOwn(validate, "body"),
  };
}

/** 路由 Recipe 只接收 JSON-safe RouteOptions；函数鉴权或运行时对象必须由宿主代码接入。 */
export function buildRouteOptions(
  ctx: RecipeContext,
  input: RouteOptionsInput,
): Record<string, JsonSafeRouteValue> {
  const sourceKey = input.sourceKey ?? "routeOptions";
  const includeTopLevel = input.includeTopLevel ?? true;
  const source = ctx.option<Record<string, unknown>>(sourceKey, {});
  const options = ensureJsonSafeRecord(source, sourceKey);
  assertSupportedRouteOptions(options, sourceKey);

  if (includeTopLevel) {
    for (const key of ROUTE_OPTION_KEYS) {
      if (ctx.has(key))
        mergeRouteOption(
          options,
          key,
          ensureJsonSafe(ctx.options[key], key),
          sourceKey,
        );
    }
    if (!Object.hasOwn(options, "responses") && input.responses !== undefined) {
      options.responses = ensureJsonSafe(input.responses, "responses");
    }
  } else if (
    input.responses !== undefined &&
    !Object.hasOwn(options, "responses")
  ) {
    options.responses = ensureJsonSafe(input.responses, "responses");
  }

  const docs = Object.hasOwn(options, "docs")
    ? ensureJsonSafeRecord(options.docs, `${sourceKey}.docs`)
    : {};
  assertSupportedDocsOptions(docs, `${sourceKey}.docs`);
  if (includeTopLevel) {
    if (ctx.has("docs"))
      mergeDocsOptions(
        docs,
        ensureJsonSafeRecord(ctx.options.docs, "docs"),
        `${sourceKey}.docs`,
        "docs",
      );
    if (ctx.has("description")) {
      mergeRouteOption(
        docs,
        "description",
        ensureJsonSafe(ctx.options.description, "description"),
        `${sourceKey}.docs`,
      );
      if (!Object.hasOwn(docs, "summary")) {
        docs.summary = ensureJsonSafe(ctx.options.description, "description");
      }
    }
    for (const key of DOC_OPTION_KEYS) {
      if (ctx.has(key))
        mergeRouteOption(
          docs,
          key,
          ensureJsonSafe(ctx.options[key], key),
          `${sourceKey}.docs`,
        );
    }
  }
  if (!Object.hasOwn(docs, "summary")) docs.summary = input.summary;
  options.docs = docs;
  assertSupportedRouteOptions(options, sourceKey);

  return options;
}

export function renderTypePropertyKey(
  key: string,
  quote: (value: string) => string,
): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key) ? key : quote(key);
}

/** 生成 TypeScript/JavaScript 对象字面量，避免把合法标识符渲染成 JSON 字符串键。 */
export function renderCodeValue(
  ctx: RecipeContext,
  value: unknown,
  spaces = 0,
): string {
  const safe = ensureJsonSafe(value, "value");
  return renderJsonSafeCodeValue(ctx, safe, spaces);
}

function renderJsonSafeCodeValue(
  ctx: RecipeContext,
  value: JsonSafeRouteValue,
  spaces = 0,
): string {
  const pad = " ".repeat(spaces);
  const childPad = " ".repeat(spaces + 2);
  if (value === null) return "null";
  if (typeof value === "string") return ctx.quote(value);
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return `[\n${value
      .map(
        (item) =>
          `${childPad}${renderJsonSafeCodeValue(ctx, item, spaces + 2)},`,
      )
      .join("\n")}\n${pad}]`;
  }
  const entries = Object.entries(value);
  if (!entries.length) return "{}";
  return `{\n${entries
    .map(
      ([key, item]) =>
        `${childPad}${renderTypePropertyKey(key, (text) => ctx.quote(text))}: ${renderJsonSafeCodeValue(ctx, item, spaces + 2)},`,
    )
    .join("\n")}\n${pad}}`;
}

function ensureJsonSafeRecord(
  value: unknown,
  label: string,
): Record<string, JsonSafeRouteValue> {
  const safe = ensureJsonSafe(value, label);
  if (!safe || typeof safe !== "object" || Array.isArray(safe)) {
    throw new RecipeInputError(`${label} must be a JSON object.`);
  }
  return { ...safe };
}

function ensureJsonSafe(value: unknown, label: string): JsonSafeRouteValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      ensureJsonSafe(item, `${label}[${index}]`),
    );
  }
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        ensureJsonSafe(item, `${label}.${key}`),
      ]),
    );
  }
  throw new RecipeInputError(
    `${label} must be finite JSON data. Functions, undefined values and runtime objects must be wired by host code after MCP validation.`,
    "unsupported",
  );
}

function mergeRouteOption(
  target: Record<string, JsonSafeRouteValue>,
  key: string,
  value: JsonSafeRouteValue,
  sourceKey: string,
): void {
  const existing = target[key];
  if (existing !== undefined && !sameJsonValue(existing, value)) {
    throw new RecipeInputError(
      `${key} is declared in both ${sourceKey} and the top-level Recipe options with different values. Use one source of truth for each RouteOptions field.`,
      "invalid",
    );
  }
  target[key] = value;
}

function mergeDocsOptions(
  target: Record<string, JsonSafeRouteValue>,
  value: Record<string, JsonSafeRouteValue>,
  targetLabel: string,
  sourceLabel: string,
): void {
  assertSupportedDocsOptions(value, sourceLabel);
  for (const [key, item] of Object.entries(value)) {
    if (!DOC_OPTION_KEY_SET.has(key)) {
      throw new RecipeInputError(
        `${sourceLabel}.${key} is outside the MCP-supported RouteOptions.docs subset. Use runtime project code for this field after host validation.`,
        "unsupported",
      );
    }
    mergeRouteOption(target, key, item, targetLabel);
  }
}

function sameJsonValue(
  left: JsonSafeRouteValue,
  right: JsonSafeRouteValue,
): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameJsonValue(item, right[index]!))
    );
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftEntries = Object.entries(left);
    const rightKeys = new Set(Object.keys(right));
    return (
      leftEntries.length === rightKeys.size &&
      leftEntries.every(([key, item]) =>
        Object.hasOwn(right, key)
          ? sameJsonValue(
              item,
              (right as Record<string, JsonSafeRouteValue>)[key]!,
            )
          : false,
      )
    );
  }
  return false;
}

function assertSupportedRouteOptions(
  value: Record<string, JsonSafeRouteValue>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!ROUTE_OPTION_KEY_SET.has(key)) {
      throw new RecipeInputError(
        `${label}.${key} is outside the MCP-supported RouteOptions subset. Supported fields are validate, responses, auth, middlewares, cache and docs.`,
        "unsupported",
      );
    }
  }
  const validate = value.validate;
  if (validate !== undefined)
    assertValidateOptions(validate, `${label}.validate`);
  const responses = value.responses;
  if (responses !== undefined)
    ensureJsonSafeRecord(responses, `${label}.responses`);
  const auth = value.auth;
  if (auth !== undefined) assertAuthOptions(auth, `${label}.auth`);
  const middlewares = value.middlewares;
  if (middlewares !== undefined)
    assertMiddlewareOptions(middlewares, `${label}.middlewares`);
  const cache = value.cache;
  if (cache !== undefined) assertCacheOptions(cache, `${label}.cache`);
  const docsValue = value.docs;
  if (docsValue !== undefined) {
    const docs = ensureJsonSafeRecord(docsValue, `${label}.docs`);
    assertSupportedDocsOptions(docs, `${label}.docs`);
  }
}

function assertValidateOptions(value: JsonSafeRouteValue, label: string): void {
  const record = ensureJsonSafeRecord(value, label);
  for (const [key, item] of Object.entries(record)) {
    if (!VALIDATE_LOCATION_SET.has(key)) {
      throw new RecipeInputError(
        `${label}.${key} is not a supported request validation location. Use query, body, param, header or cookie.`,
        "unsupported",
      );
    }
    ensureJsonSafeRecord(item, `${label}.${key}`);
  }
}

function assertAuthOptions(value: JsonSafeRouteValue, label: string): void {
  if (typeof value === "boolean") return;
  ensureJsonSafeRecord(value, label);
}

function assertMiddlewareOptions(
  value: JsonSafeRouteValue,
  label: string,
): void {
  if (!Array.isArray(value)) {
    throw new RecipeInputError(`${label} must be an array.`, "invalid");
  }
  value.forEach((item, index) => {
    if (typeof item === "string") return;
    const record = ensureJsonSafeRecord(item, `${label}[${index}]`);
    if (typeof record.name !== "string" || !record.name.trim()) {
      throw new RecipeInputError(
        `${label}[${index}].name must be a non-empty middleware name.`,
        "invalid",
      );
    }
    for (const key of Object.keys(record)) {
      if (key !== "name" && key !== "options") {
        throw new RecipeInputError(
          `${label}[${index}].${key} is outside the supported middleware reference shape.`,
          "unsupported",
        );
      }
    }
  });
}

function assertCacheOptions(value: JsonSafeRouteValue, label: string): void {
  if (value === false) return;
  if (typeof value === "number" && value > 0) return;
  if (value && typeof value === "object" && !Array.isArray(value)) return;
  throw new RecipeInputError(
    `${label} must be false, a positive TTL number, or a RouteCacheOptions object.`,
    "invalid",
  );
}

function assertSupportedDocsOptions(
  value: Record<string, JsonSafeRouteValue>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!DOC_OPTION_KEY_SET.has(key)) {
      throw new RecipeInputError(
        `${label}.${key} is outside the MCP-supported docs subset. Use summary, description, operationId, security or access.`,
        "unsupported",
      );
    }
  }
  if (Object.hasOwn(value, "summary") && typeof value.summary !== "string")
    throw new RecipeInputError(`${label}.summary must be a string.`, "invalid");
  if (
    Object.hasOwn(value, "description") &&
    typeof value.description !== "string"
  )
    throw new RecipeInputError(
      `${label}.description must be a string.`,
      "invalid",
    );
  if (
    Object.hasOwn(value, "operationId") &&
    typeof value.operationId !== "string"
  )
    throw new RecipeInputError(
      `${label}.operationId must be a string.`,
      "invalid",
    );
  if (Object.hasOwn(value, "security") && !Array.isArray(value.security))
    throw new RecipeInputError(
      `${label}.security must be an array.`,
      "invalid",
    );
  if (
    Object.hasOwn(value, "access") &&
    typeof value.access !== "string" &&
    !(
      value.access &&
      typeof value.access === "object" &&
      !Array.isArray(value.access)
    )
  )
    throw new RecipeInputError(
      `${label}.access must be a string or docs access object.`,
      "invalid",
    );
}
