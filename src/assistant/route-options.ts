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

/** 路由 Recipe 只接收 JSON-safe RouteOptions；函数鉴权或运行时对象必须由宿主代码接入。 */
export function buildRouteOptions(
  ctx: RecipeContext,
  input: RouteOptionsInput,
): Record<string, JsonSafeRouteValue> {
  const sourceKey = input.sourceKey ?? "routeOptions";
  const includeTopLevel = input.includeTopLevel ?? true;
  const source = ctx.option<Record<string, unknown>>(sourceKey, {});
  const options = ensureJsonSafeRecord(source, sourceKey);

  if (includeTopLevel) {
    for (const key of ROUTE_OPTION_KEYS) {
      if (ctx.has(key)) options[key] = ensureJsonSafe(ctx.options[key], key);
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
  if (includeTopLevel) {
    if (ctx.has("docs"))
      Object.assign(docs, ensureJsonSafeRecord(ctx.options.docs, "docs"));
    if (ctx.has("description")) {
      docs.description = ensureJsonSafe(ctx.options.description, "description");
      if (!Object.hasOwn(docs, "summary")) {
        docs.summary = ensureJsonSafe(ctx.options.description, "description");
      }
    }
    for (const key of DOC_OPTION_KEYS) {
      if (ctx.has(key)) docs[key] = ensureJsonSafe(ctx.options[key], key);
    }
  }
  if (!Object.hasOwn(docs, "summary")) docs.summary = input.summary;
  options.docs = docs;

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
