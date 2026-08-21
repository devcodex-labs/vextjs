import { createHash } from "node:crypto";
import { SchemaConverter } from "../../lib/openapi/schema-converter.js";
import type { JsonSchema } from "../../lib/openapi/types.js";
import {
  collectRouteResponseContracts,
  resolveRouteResponseJsonSchema,
} from "../../lib/response-serializer.js";
import type {
  RouteOptions,
  VextRouteFrontendOptions,
} from "../../types/app.js";
import type {
  VextRouteFreshnessIdentity,
  VextRouteFrontendSeoOptions,
  VextRouteLayoutIdentity,
  VextRouteResponseSchemaV1,
  VextRouteSchemaContractV1,
  VextSchemaIRV1,
} from "./types.js";

const schemaConverter = new SchemaConverter();

const requestSources = [
  ["params", "param"],
  ["query", "query"],
  ["headers", "header"],
  ["cookies", "cookie"],
  ["body", "body"],
] as const;

/**
 * Projects route validation and the canonical runtime/docs response contracts
 * into framework-owned IR. This consumes RouteOptions directly; it never
 * creates another user-authored schema format.
 */
export function projectRouteSchemaContract(
  options: RouteOptions,
  method?: string,
): VextRouteSchemaContractV1 {
  const request: VextRouteSchemaContractV1["request"] = {};
  for (const [target, source] of requestSources) {
    const schema = options.validate?.[source];
    if (schema) {
      request[target] = createSchemaIR(
        "validate",
        `validate.${source}`,
        schemaConverter.convertValidateObject(schema).schema,
      );
    }
  }

  const responses = collectRouteResponseContracts(options)
    .map((response) => {
      const contentType = response.docs?.contentType ?? "application/json";
      const runtimeHasNoBody =
        response.runtime !== undefined &&
        (method?.toUpperCase() === "HEAD" || response.selector === "204");
      const runtimeSchema =
        response.runtime && !runtimeHasNoBody
          ? resolveRouteResponseJsonSchema(response.runtime.schema)
          : undefined;
      const docsSchema = response.docs?.schema;
      return {
        status: response.selector,
        contentType,
        schema: runtimeSchema
          ? createSchemaIR(
              "responses",
              `responses.${response.selector}.schema`,
              runtimeSchema as JsonSchema,
            )
          : docsSchema
            ? createSchemaIR(
                "docs.responses",
                `docs.responses.${response.selector}.schema`,
                schemaConverter.convertResponseSchema(docsSchema),
              )
            : undefined,
      } satisfies VextRouteResponseSchemaV1;
    })
    .sort((left, right) => compareStatus(left.status, right.status));

  return { schemaVersion: 1, request, responses };
}

export function createRouteId(method: string, path: string): string {
  return `route_${createDigest({ method: method.toUpperCase(), path }).slice(0, 16)}`;
}

export function createRouteFreshnessIdentity(
  options?: Pick<RouteOptions, "frontend">,
): VextRouteFreshnessIdentity {
  const frontend = options?.frontend;
  if (frontend === undefined) {
    return { mode: "dynamic", source: "legacy-default" };
  }
  if (!isRecord(frontend)) {
    throw new Error("[vextjs] RouteOptions.frontend must be an object.");
  }
  const frontendOptions = frontend as VextRouteFrontendOptions;

  const declaredMode = frontendOptions.mode;
  if (
    declaredMode !== undefined &&
    declaredMode !== "dynamic" &&
    declaredMode !== "static" &&
    declaredMode !== "revalidate"
  ) {
    throw new Error(
      `[vextjs] RouteOptions.frontend.mode must be \"dynamic\", \"static\", or \"revalidate\"; received ${String(declaredMode)}.`,
    );
  }
  const hasRevalidate = frontendOptions.revalidate !== undefined;
  const mode = declaredMode ?? (hasRevalidate ? "revalidate" : "dynamic");
  const revalidate = normalizePositiveNumber(
    frontendOptions.revalidate,
    "RouteOptions.frontend.revalidate",
  );
  if (mode === "revalidate" && revalidate === undefined) {
    throw new Error(
      '[vextjs] RouteOptions.frontend.revalidate must be a positive number of seconds when mode is "revalidate".',
    );
  }
  if (mode !== "revalidate" && revalidate !== undefined) {
    throw new Error(
      '[vextjs] RouteOptions.frontend.revalidate is only valid with mode "revalidate".',
    );
  }
  if (frontendOptions.staticParams !== undefined && mode !== "static") {
    throw new Error(
      '[vextjs] RouteOptions.frontend.staticParams is only valid with mode "static".',
    );
  }
  const staticParams = normalizeStaticParams(frontendOptions.staticParams);
  const tags = normalizeTags(frontendOptions.tags);
  const staticBudget = normalizeStaticBudget(frontendOptions.staticBudget);
  if (
    frontendOptions.clientOnly !== undefined &&
    typeof frontendOptions.clientOnly !== "boolean"
  ) {
    throw new Error(
      "[vextjs] RouteOptions.frontend.clientOnly must be a boolean.",
    );
  }
  if (
    frontendOptions.hydration !== undefined &&
    frontendOptions.hydration !== "full" &&
    frontendOptions.hydration !== "none"
  ) {
    throw new Error(
      '[vextjs] RouteOptions.frontend.hydration must be "full" or "none".',
    );
  }
  if (
    frontendOptions.hydration === "none" &&
    frontendOptions.clientOnly === true
  ) {
    throw new Error(
      '[vextjs] RouteOptions.frontend.hydration="none" cannot be combined with clientOnly=true.',
    );
  }
  const seo = normalizeRouteSeoOptions(frontendOptions.seo);
  if (
    frontendOptions.page !== undefined &&
    (typeof frontendOptions.page !== "string" || !frontendOptions.page.trim())
  ) {
    throw new Error(
      "[vextjs] RouteOptions.frontend.page must be a non-empty page id.",
    );
  }

  return {
    mode,
    source: "route-options",
    ...(revalidate !== undefined ? { revalidate } : {}),
    ...(staticParams !== undefined ? { staticParams } : {}),
    ...(frontendOptions.clientOnly === true
      ? { clientOnly: true as const }
      : {}),
    ...(frontendOptions.hydration === "none"
      ? { hydration: "none" as const }
      : {}),
    ...(seo ? { seo } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(frontendOptions.page?.trim()
      ? { page: frontendOptions.page.trim() }
      : {}),
    ...(staticBudget ? { staticBudget } : {}),
  };
}

function normalizeRouteSeoOptions(
  value: unknown,
): VextRouteFrontendSeoOptions | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error("[vextjs] RouteOptions.frontend.seo must be an object.");
  }

  const title = optionalNonEmptyString(value.title, "seo.title");
  const description = optionalNonEmptyString(
    value.description,
    "seo.description",
  );
  const canonical = optionalPathname(value.canonical, "seo.canonical");
  const originKey = optionalNonEmptyString(value.originKey, "seo.originKey");
  const robots = normalizeRobotsDirective(value.robots);
  const openGraph = normalizeJsonRecord(value.openGraph, "seo.openGraph");
  const twitter = normalizeJsonRecord(value.twitter, "seo.twitter");
  const alternates = normalizeAlternates(value.alternates);
  const jsonLd = normalizeJsonValue(value.jsonLd, "seo.jsonLd");
  if (value.index !== undefined && typeof value.index !== "boolean") {
    throw new Error(
      "[vextjs] RouteOptions.frontend.seo.index must be a boolean.",
    );
  }

  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(robots ? { robots } : {}),
    ...(canonical ? { canonical } : {}),
    ...(openGraph ? { openGraph } : {}),
    ...(twitter ? { twitter } : {}),
    ...(alternates ? { alternates } : {}),
    ...(jsonLd !== undefined ? { jsonLd } : {}),
    ...(originKey ? { originKey } : {}),
    ...(value.index !== undefined ? { index: value.index } : {}),
  } as VextRouteFrontendSeoOptions;
}

function optionalNonEmptyString(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `[vextjs] RouteOptions.frontend.${label} must be a non-empty string.`,
    );
  }
  return value.trim();
}

function optionalPathname(value: unknown, label: string): string | undefined {
  const pathname = optionalNonEmptyString(value, label);
  if (pathname === undefined) return undefined;
  if (
    !pathname.startsWith("/") ||
    pathname.startsWith("//") ||
    pathname.includes("?") ||
    pathname.includes("#")
  ) {
    throw new Error(
      `[vextjs] RouteOptions.frontend.${label} must be an absolute pathname without query or hash.`,
    );
  }
  try {
    decodeURI(pathname);
  } catch {
    throw new Error(
      `[vextjs] RouteOptions.frontend.${label} contains invalid URL encoding.`,
    );
  }
  return pathname;
}

function normalizeRobotsDirective(
  value: unknown,
): string | readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "string" && entry.trim())
  ) {
    return value.map((entry) => entry.trim());
  }
  throw new Error(
    "[vextjs] RouteOptions.frontend.seo.robots must be a non-empty string or string array.",
  );
}

function normalizeJsonRecord(
  value: unknown,
  label: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isJsonSafe(value)) {
    throw new Error(
      `[vextjs] RouteOptions.frontend.${label} must be a JSON-safe object.`,
    );
  }
  return value;
}

function normalizeAlternates(
  value: unknown,
): Array<{ hrefLang: string; href: string }> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(
      "[vextjs] RouteOptions.frontend.seo.alternates must be an array.",
    );
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(
        `[vextjs] RouteOptions.frontend.seo.alternates[${index}] must be an object.`,
      );
    }
    const hrefLang = optionalNonEmptyString(
      entry.hrefLang,
      `seo.alternates[${index}].hrefLang`,
    );
    const href = optionalPathname(entry.href, `seo.alternates[${index}].href`);
    return { hrefLang: hrefLang!, href: href! };
  });
}

function normalizeJsonValue(value: unknown, label: string): unknown {
  if (value === undefined) return undefined;
  if (!isJsonSafe(value)) {
    throw new Error(
      `[vextjs] RouteOptions.frontend.${label} must contain only JSON-safe values.`,
    );
  }
  return value;
}

function isJsonSafe(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonSafe);
  if (isRecord(value)) return Object.values(value).every(isJsonSafe);
  return false;
}

export function createUnresolvedLayoutIdentity(): VextRouteLayoutIdentity {
  return { state: "unresolved", paths: [] };
}

export function createDigest(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizePositiveNumber(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`[vextjs] ${label} must be a positive finite number.`);
  }
  return value;
}

function normalizeStaticParams(
  value: VextRouteFrontendOptions["staticParams"],
): Array<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(
      "[vextjs] RouteOptions.frontend.staticParams must be an array.",
    );
  }
  return value.map((params, index) => {
    if (!isRecord(params)) {
      throw new Error(
        `[vextjs] RouteOptions.frontend.staticParams[${index}] must be an object.`,
      );
    }
    const normalized: Record<string, string> = {};
    for (const [key, item] of Object.entries(params)) {
      if (!key.trim()) {
        throw new Error(
          `[vextjs] RouteOptions.frontend.staticParams[${index}] contains an empty parameter name.`,
        );
      }
      if (
        typeof item !== "string" &&
        typeof item !== "number" &&
        typeof item !== "boolean"
      ) {
        throw new Error(
          `[vextjs] RouteOptions.frontend.staticParams[${index}].${key} must be a string, number, or boolean.`,
        );
      }
      normalized[key] = String(item);
    }
    return Object.fromEntries(
      Object.entries(normalized).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  });
}

function normalizeTags(value: unknown): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some((tag) => typeof tag !== "string" || !tag.trim())
  ) {
    throw new Error(
      "[vextjs] RouteOptions.frontend.tags must be an array of non-empty strings.",
    );
  }
  return [...new Set(value.map((tag) => tag.trim()))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function normalizeStaticBudget(
  value: unknown,
): VextRouteFreshnessIdentity["staticBudget"] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(
      "[vextjs] RouteOptions.frontend.staticBudget must be an object.",
    );
  }
  const limits = {
    maxParams: normalizePositiveNumber(
      value.maxParams,
      "RouteOptions.frontend.staticBudget.maxParams",
    ),
    maxDurationMs: normalizePositiveNumber(
      value.maxDurationMs,
      "RouteOptions.frontend.staticBudget.maxDurationMs",
    ),
    maxBytes: normalizePositiveNumber(
      value.maxBytes,
      "RouteOptions.frontend.staticBudget.maxBytes",
    ),
  };
  if (Object.values(limits).every((limit) => limit === undefined)) {
    throw new Error(
      "[vextjs] RouteOptions.frontend.staticBudget must declare at least one limit.",
    );
  }
  return limits;
}

function createSchemaIR(
  source: VextSchemaIRV1["source"],
  sourcePath: string,
  schema: JsonSchema,
): VextSchemaIRV1 {
  const ref = typeof schema.$ref === "string" ? schema.$ref : undefined;
  return {
    schemaVersion: 1,
    kind: "vext-schema-ir",
    source,
    sourcePath,
    schema,
    digest: createDigest(schema),
    ...(ref ? { ref } : {}),
  };
}

function compareStatus(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
}
