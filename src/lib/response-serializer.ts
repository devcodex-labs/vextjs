import fastJsonStringify from "fast-json-stringify";
import type {
  RouteDocsConfig,
  RouteOptions,
  VextResponseSchemaConfig,
  VextResponseSchemaDefinition,
} from "../types/app.js";
import { schemaAdapter } from "./schema-adapter.js";
import type { DslDefinition, JSONSchema } from "./schema-adapter.js";

type Serializer = (value: unknown) => string;
type DocumentedResponseConfig = NonNullable<
  RouteDocsConfig["responses"]
>[string];

export interface RouteResponseSerializerContext {
  method: string;
  path: string;
  sourceFile: string;
}

export interface ResolvedRouteResponseContract {
  selector: string;
  runtime?: VextResponseSchemaConfig;
  docs?: DocumentedResponseConfig;
}

interface CompiledResponseEntry {
  selector: string;
  data: Serializer;
  wrapped: Serializer;
}

export interface CompiledRouteResponseSerializers {
  method: string;
  exact: ReadonlyMap<number, CompiledResponseEntry>;
  family: ReadonlyMap<number, CompiledResponseEntry>;
  default?: CompiledResponseEntry;
}

export interface ResponseSerializerDiagnostics {
  routeOptionsCompiled: number;
  serializerFunctionsCompiled: number;
}

let serializerCache = new WeakMap<
  RouteOptions,
  Map<string, CompiledRouteResponseSerializers | undefined>
>();
let routeOptionsCompiled = 0;
let serializerFunctionsCompiled = 0;

/**
 * Compile a route's runtime response schemas before the adapter registration
 * plan is committed. Reusing the same RouteOptions object for the same HTTP
 * method is cache-only. The method is part of the cache identity because HEAD
 * deliberately skips body serializer compilation.
 */
export function prepareRouteResponseSerializers(
  options: RouteOptions,
  context: RouteResponseSerializerContext,
): CompiledRouteResponseSerializers | undefined {
  const method = context.method.toUpperCase();
  const cachedByMethod = serializerCache.get(options);
  if (cachedByMethod?.has(method)) {
    return cachedByMethod.get(method);
  }

  const contracts = collectRouteResponseContracts(options);
  const runtimeContracts = contracts.filter((entry) => entry.runtime);
  if (runtimeContracts.length === 0) {
    cachePreparedSerializer(options, method, undefined);
    return undefined;
  }

  const exact = new Map<number, CompiledResponseEntry>();
  const family = new Map<number, CompiledResponseEntry>();
  let defaultEntry: CompiledResponseEntry | undefined;
  for (const contract of runtimeContracts) {
    const runtime = contract.runtime!;
    if (contract.docs?.schema !== undefined) {
      throw responseContractError(
        context,
        contract.selector,
        "declares schema in both RouteOptions.responses and docs.responses; keep runtime schema only in RouteOptions.responses",
      );
    }
    if (
      contract.docs?.contentType !== undefined &&
      contract.docs.contentType.toLowerCase() !== "application/json"
    ) {
      throw responseContractError(
        context,
        contract.selector,
        `uses docs.responses.contentType=${JSON.stringify(contract.docs.contentType)} but runtime response serialization only supports application/json`,
      );
    }

    // HEAD and 204 never emit a JSON body. Keep contract validation and
    // projections, but do not spend registration time compiling serializers
    // that the response implementations must bypass.
    if (method === "HEAD" || contract.selector === "204") {
      continue;
    }

    const compiled = compileResponseEntry(
      contract.selector,
      runtime.schema,
      context,
    );
    if (contract.selector === "default") {
      defaultEntry = compiled;
    } else if (contract.selector.endsWith("xx")) {
      family.set(Number(contract.selector[0]), compiled);
    } else {
      exact.set(Number(contract.selector), compiled);
    }
  }

  if (exact.size === 0 && family.size === 0 && !defaultEntry) {
    cachePreparedSerializer(options, method, undefined);
    return undefined;
  }

  const prepared: CompiledRouteResponseSerializers = {
    method,
    exact,
    family,
    ...(defaultEntry ? { default: defaultEntry } : {}),
  };
  routeOptionsCompiled += 1;
  cachePreparedSerializer(options, method, prepared);
  return prepared;
}

/** Retrieve a registration-time result without compiling on the request path. */
export function getPreparedRouteResponseSerializers(
  options: RouteOptions | undefined,
  method: string | undefined,
): CompiledRouteResponseSerializers | undefined {
  return options && method
    ? serializerCache.get(options)?.get(method.toUpperCase())
    : undefined;
}

function cachePreparedSerializer(
  options: RouteOptions,
  method: string,
  prepared: CompiledRouteResponseSerializers | undefined,
): void {
  const cachedByMethod = serializerCache.get(options);
  if (cachedByMethod) {
    cachedByMethod.set(method, prepared);
    return;
  }
  serializerCache.set(options, new Map([[method, prepared]]));
}

/**
 * Serialize the final post-hook wire value. Routes without a matching runtime
 * schema preserve the previous JSON.stringify byte behavior.
 */
export function stringifyRouteResponse(
  serializers: CompiledRouteResponseSerializers | undefined,
  status: number,
  value: unknown,
  wrapped: boolean,
): string {
  if (!serializers || serializers.method === "HEAD") {
    return JSON.stringify(value) ?? "";
  }
  const entry =
    serializers.exact.get(status) ??
    serializers.family.get(Math.floor(status / 100)) ??
    serializers.default;
  if (!entry) {
    return JSON.stringify(value) ?? "";
  }
  return (wrapped ? entry.wrapped : entry.data)(value);
}

/**
 * Merge runtime schemas with docs-only metadata using normalized selectors.
 * This does not compile and is shared by OpenAPI/frontend projections.
 */
export function collectRouteResponseContracts(
  options: Pick<RouteOptions, "responses" | "docs">,
): ResolvedRouteResponseContract[] {
  const entries = new Map<string, ResolvedRouteResponseContract>();

  for (const [rawSelector, runtime] of Object.entries(
    options.responses ?? {},
  )) {
    const selector = normalizeRuntimeResponseSelector(rawSelector);
    if (entries.has(selector)) {
      throw new Error(
        `[vextjs] Duplicate RouteOptions.responses selector after normalization: ${JSON.stringify(selector)}.`,
      );
    }
    if (!isRecord(runtime) || !("schema" in runtime)) {
      throw new Error(
        `[vextjs] RouteOptions.responses.${rawSelector} must be an object with a schema field.`,
      );
    }
    entries.set(selector, { selector, runtime });
  }

  for (const [rawSelector, docs] of Object.entries(
    options.docs?.responses ?? {},
  )) {
    const selector = normalizeDocumentedResponseSelector(rawSelector);
    const current = entries.get(selector);
    if (current?.docs) {
      throw new Error(
        `[vextjs] Duplicate docs.responses selector after normalization: ${JSON.stringify(selector)}.`,
      );
    }
    entries.set(selector, current ? { ...current, docs } : { selector, docs });
  }

  return [...entries.values()].sort((left, right) =>
    compareResponseSelectors(left.selector, right.selector),
  );
}

export function normalizeRuntimeResponseSelector(selector: string): string {
  const normalized = selector.trim().toLowerCase();
  if (normalized === "default") return normalized;
  if (/^[1-5]xx$/.test(normalized)) return normalized;
  if (/^[1-5]\d{2}$/.test(normalized)) return normalized;
  throw new Error(
    `[vextjs] Invalid RouteOptions.responses selector ${JSON.stringify(selector)}; expected 100..599, 1xx..5xx, or default.`,
  );
}

export function toOpenApiResponseSelector(selector: string): string {
  return /^[1-5]xx$/.test(selector) ? `${selector[0]}XX` : selector;
}

/**
 * Resolve the runtime schema into the exact closed JSON Schema used by the
 * registration-time serializers. OpenAPI and frontend contracts consume this
 * projection so the wire serializer remains the single runtime truth source.
 */
export function resolveRouteResponseJsonSchema(
  definition: VextResponseSchemaDefinition,
): Record<string, unknown> {
  return closeObjectSchemas(toJsonSchema(definition));
}

export function getResponseSerializerDiagnostics(): ResponseSerializerDiagnostics {
  return { routeOptionsCompiled, serializerFunctionsCompiled };
}

/** @internal test helper */
export function resetResponseSerializerStateForTesting(): void {
  serializerCache = new WeakMap();
  routeOptionsCompiled = 0;
  serializerFunctionsCompiled = 0;
}

function compileResponseEntry(
  selector: string,
  definition: VextResponseSchemaDefinition,
  context: RouteResponseSerializerContext,
): CompiledResponseEntry {
  try {
    const dataSchema = resolveRouteResponseJsonSchema(definition);
    const wrappedSchema = closeObjectSchemas({
      type: "object",
      properties: {
        code: { type: "integer" },
        data: dataSchema,
        requestId: { type: "string" },
      },
      required: ["code", "data", "requestId"],
    });
    const data = buildSerializer(dataSchema);
    const wrapped = buildSerializer(wrappedSchema);
    serializerFunctionsCompiled += 2;
    return { selector, data, wrapped };
  } catch (error) {
    throw responseContractError(
      context,
      selector,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function buildSerializer(schema: Record<string, unknown>): Serializer {
  const serializer = fastJsonStringify(
    schema as unknown as Parameters<typeof fastJsonStringify>[0],
  );
  return (value) => serializer(value as never);
}

function toJsonSchema(
  definition: VextResponseSchemaDefinition,
): Record<string, unknown> {
  if (typeof definition === "string") {
    return { $ref: definition };
  }
  if (!isRecord(definition)) {
    throw new Error(
      "response schema must be a schema-dsl object or $ref string",
    );
  }
  if (isRawJsonSchema(definition)) {
    return cloneJsonSchema(definition);
  }
  const normalized = normalizeDslObject(definition);
  return schemaAdapter.compile(
    normalized as unknown as DslDefinition,
  ) as JSONSchema;
}

function normalizeDslObject(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, normalizeDslValue(item)]),
  );
}

function normalizeDslValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length === 1) {
      return {
        type: "array",
        items: normalizeDslArrayItem(value[0]),
      };
    }
    return { type: "array" };
  }
  if (isRecord(value)) {
    if (schemaAdapter.isDslBuilder(value) || isRawJsonSchema(value)) {
      return value;
    }
    return normalizeDslObject(value);
  }
  return value;
}

function normalizeDslArrayItem(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    return schemaAdapter.toJsonSchema(schemaAdapter.compileField(value));
  }
  if (Array.isArray(value)) {
    return value.length === 1
      ? { type: "array", items: normalizeDslArrayItem(value[0]) }
      : { type: "array" };
  }
  if (isRecord(value)) {
    if (schemaAdapter.isDslBuilder(value)) {
      return schemaAdapter.toJsonSchema(value);
    }
    if (isRawJsonSchema(value)) {
      return cloneJsonSchema(value);
    }
    return schemaAdapter.compile(
      normalizeDslObject(value) as unknown as DslDefinition,
    );
  }
  throw new Error(
    "single-item response array shorthand requires a DSL string, schema builder, object definition, or JSON Schema",
  );
}

function closeObjectSchemas(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("compiled response schema must be a JSON Schema object");
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)) {
      result[key] = item.map((entry) =>
        isRecord(entry) ? closeObjectSchemas(entry) : entry,
      );
    } else if (isRecord(item)) {
      result[key] = isSchemaMapKey(key)
        ? Object.fromEntries(
            Object.entries(item).map(([name, schema]) => [
              name,
              isRecord(schema) ? closeObjectSchemas(schema) : schema,
            ]),
          )
        : closeObjectSchemas(item);
    } else {
      result[key] = item;
    }
  }
  if (result.type === "object" || isRecord(result.properties)) {
    result.additionalProperties = false;
  }
  return result;
}

function isSchemaMapKey(key: string): boolean {
  return (
    key === "properties" ||
    key === "patternProperties" ||
    key === "$defs" ||
    key === "definitions"
  );
}

function cloneJsonSchema(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return structuredClone(value);
}

function isRawJsonSchema(value: Record<string, unknown>): boolean {
  if (typeof value.$ref === "string") return true;
  if (isJsonSchemaType(value.type)) return true;
  return [
    "properties",
    "items",
    "oneOf",
    "anyOf",
    "allOf",
    "$defs",
    "definitions",
    "enum",
    "const",
  ].some((key) => key in value);
}

function isJsonSchemaType(value: unknown): boolean {
  const allowed = new Set([
    "string",
    "number",
    "integer",
    "boolean",
    "object",
    "array",
    "null",
  ]);
  return typeof value === "string"
    ? allowed.has(value)
    : Array.isArray(value) && value.every((item) => allowed.has(item));
}

export function normalizeDocumentedResponseSelector(selector: string): string {
  const normalized = selector.trim().toLowerCase();
  return normalized === "default" || /^[1-5]xx$/.test(normalized)
    ? normalized
    : selector.trim();
}

function compareResponseSelectors(left: string, right: string): number {
  const rank = (selector: string): number => {
    if (/^[1-5]\d{2}$/.test(selector)) return Number(selector);
    if (/^[1-5]xx$/.test(selector)) return Number(selector[0]) * 100 + 99;
    if (selector === "default") return 1000;
    return 2000;
  };
  return rank(left) - rank(right) || left.localeCompare(right);
}

function responseContractError(
  context: RouteResponseSerializerContext,
  selector: string,
  message: string,
): Error {
  const source = context.sourceFile || "(unknown source)";
  return new Error(
    `[vextjs] Failed to compile response schema for ${context.method.toUpperCase()} ${context.path} selector ${selector} (${source}): ${message}`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
