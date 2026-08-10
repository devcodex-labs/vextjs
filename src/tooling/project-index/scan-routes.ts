import { existsSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import fg from "fast-glob";
import {
  ROUTE_IGNORE_PATTERNS,
  ROUTE_SOURCE_PATTERNS,
  shouldIncludeRouteFilePath,
} from "../../lib/route-file-policy.js";
import { detectRouteSourceDocsKind } from "../../lib/openapi/route-docs-kind.js";
import { SchemaConverter } from "../../lib/openapi/schema-converter.js";
import type { VextOpenAPIDocsKind } from "../../lib/openapi/types.js";
import {
  createDigest,
  createRouteFreshnessIdentity,
} from "../../frontend/contract/schema-ir.js";
import type {
  VextRouteFreshnessIdentity,
  VextRouteResponseSchemaV1,
  VextRouteSchemaContractV1,
  VextSchemaIRV1,
} from "../../frontend/contract/types.js";
import type { VextRouteFrontendOptions } from "../../types/app.js";
const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
];

const schemaConverter = new SchemaConverter();

interface StaticRouteResponseDefinition {
  status: string;
  contentType: string;
  schema?: Record<string, unknown> | string;
}

export interface RouteIndexEntry {
  filePath: string;
  fileRelativePath: string;
  prefix: string;
  method: string;
  path: string;
  docsSummary: string | null;
  hasDocsSummary: boolean;
  operationId: string | null;
  tags: string[];
  hidden: boolean;
  docsKind: VextOpenAPIDocsKind;
  schema: VextRouteSchemaContractV1;
  freshness: VextRouteFreshnessIdentity;
}

export async function buildRouteIndex(
  rootDir: string,
): Promise<RouteIndexEntry[]> {
  const routesDir = join(rootDir, "src", "routes");
  if (!existsSync(routesDir)) {
    return [];
  }

  const routeFiles = await fg(ROUTE_SOURCE_PATTERNS, {
    cwd: routesDir,
    absolute: true,
    onlyFiles: true,
    ignore: ROUTE_IGNORE_PATTERNS,
  });

  return routeFiles
    .filter((filePath) => shouldIncludeRouteFilePath(filePath, routesDir))
    .flatMap((filePath) => scanRouteEntries(filePath, rootDir, routesDir))
    .sort((a, b) =>
      `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`),
    );
}

function scanRouteEntries(
  filePath: string,
  rootDir: string,
  routesDir: string,
): RouteIndexEntry[] {
  const source = readFileSync(filePath, "utf-8");
  const prefix = filePathToRoutePrefix(filePath, routesDir);
  const fileRelativePath = relative(rootDir, filePath).split(sep).join("/");
  const entries: RouteIndexEntry[] = [];

  for (const block of findDefineRoutesBlocks(source)) {
    const methodPattern = new RegExp(
      `${escapeRegExp(block.paramName)}\\.(${HTTP_METHODS.join("|")})\\s*\\(`,
      "gu",
    );

    for (const match of block.body.matchAll(methodPattern)) {
      const openParen = block.body.indexOf("(", match.index);
      const callBody = readBalanced(block.body, openParen, "(", ")");
      if (!callBody) continue;

      const args = splitTopLevelArgs(callBody.slice(1, -1));
      const routePath = readStringLiteral(args[0] ?? "");
      if (!routePath) continue;

      const docs = readRouteDocs(args[1]);
      const frontend = readRouteFrontend(args[1]);
      const handler = args.length >= 3 ? args[2] : args[1];
      const method = match[1]!.toUpperCase();

      entries.push({
        filePath,
        fileRelativePath,
        prefix,
        method,
        path: normalizeRoutePath(prefix, routePath),
        docsSummary: docs.docsSummary,
        hasDocsSummary: docs.hasDocsSummary,
        operationId: docs.operationId,
        tags: docs.tags,
        hidden: docs.hidden,
        docsKind: detectRouteSourceDocsKind(handler),
        schema: createRouteSchemaContract(docs.responses),
        freshness: createRouteFreshnessIdentity({ frontend }),
      });
    }
  }

  return entries;
}

/**
 * Statically projects the literal subset of RouteOptions.frontend used by the
 * build pipeline. Dynamic expressions remain runtime-owned and therefore
 * retain the legacy dynamic identity until the route is loaded.
 */
function readRouteFrontend(
  optionsArg: string | undefined,
): VextRouteFrontendOptions | undefined {
  const options = optionsArg?.trim();
  if (!options?.startsWith("{")) return undefined;

  const frontendObject = readObjectProperty(options, "frontend");
  if (!frontendObject) return undefined;

  const mode = readStringProperty(frontendObject, "mode");
  const revalidate = readNumberProperty(frontendObject, "revalidate");
  const staticParams = readObjectArrayProperty(frontendObject, "staticParams");
  const clientOnly = readOptionalBooleanProperty(frontendObject, "clientOnly");
  const tags = readStringArrayProperty(frontendObject, "tags");
  const page = readStringProperty(frontendObject, "page");
  const staticBudgetObject = readObjectProperty(frontendObject, "staticBudget");
  const staticBudget = staticBudgetObject
    ? compactObject({
        maxParams:
          readNumberProperty(staticBudgetObject, "maxParams") ?? undefined,
        maxDurationMs:
          readNumberProperty(staticBudgetObject, "maxDurationMs") ?? undefined,
        maxBytes:
          readNumberProperty(staticBudgetObject, "maxBytes") ?? undefined,
      })
    : undefined;

  return compactObject({
    mode: mode ?? undefined,
    revalidate: revalidate ?? undefined,
    staticParams: staticParams ?? undefined,
    clientOnly,
    tags: tags.length > 0 ? tags : undefined,
    page: page ?? undefined,
    staticBudget:
      staticBudget && Object.keys(staticBudget).length > 0
        ? staticBudget
        : undefined,
  }) as VextRouteFrontendOptions;
}

function findDefineRoutesBlocks(
  source: string,
): Array<{ paramName: string; body: string }> {
  const blocks: Array<{ paramName: string; body: string }> = [];
  const pattern =
    /defineRoutes\s*\(\s*(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)[^)=]*\)?\s*=>\s*\{/gu;

  for (const match of source.matchAll(pattern)) {
    const openBrace = source.indexOf("{", match.index);
    const body = readBalanced(source, openBrace, "{", "}");
    const paramName = match[1];
    if (body && paramName) {
      blocks.push({ paramName, body: body.slice(1, -1) });
    }
  }

  return blocks;
}

function readRouteDocs(optionsArg: string | undefined): {
  docsSummary: string | null;
  hasDocsSummary: boolean;
  operationId: string | null;
  tags: string[];
  hidden: boolean;
  responses: StaticRouteResponseDefinition[];
} {
  const empty = {
    docsSummary: null,
    hasDocsSummary: false,
    operationId: null,
    tags: [],
    hidden: false,
    responses: [],
  };

  const options = optionsArg?.trim();
  if (!options?.startsWith("{")) {
    return empty;
  }

  const docsMatch = /\bdocs\s*:/u.exec(options);
  if (!docsMatch) {
    return empty;
  }

  const docsOpen = options.indexOf("{", docsMatch.index);
  const docsObject = readBalanced(options, docsOpen, "{", "}");
  if (!docsObject) {
    return empty;
  }

  const summary = readStringProperty(docsObject, "summary");
  const operationId = readStringProperty(docsObject, "operationId");

  return {
    docsSummary: summary,
    hasDocsSummary: Boolean(summary?.trim()),
    operationId,
    tags: readStringArrayProperty(docsObject, "tags"),
    hidden: readBooleanProperty(docsObject, "hidden"),
    responses: readRouteResponseDefinitions(docsObject),
  };
}

function createRouteSchemaContract(
  responses: readonly StaticRouteResponseDefinition[],
): VextRouteSchemaContractV1 {
  return {
    schemaVersion: 1,
    request: {},
    responses: responses
      .map((response) => {
        const schema = response.schema
          ? createStaticResponseSchema(response.status, response.schema)
          : undefined;
        return {
          status: response.status,
          contentType: response.contentType,
          ...(schema ? { schema } : {}),
        } satisfies VextRouteResponseSchemaV1;
      })
      .sort((left, right) => compareResponseStatus(left.status, right.status)),
  };
}

function createStaticResponseSchema(
  status: string,
  responseSchema: Record<string, unknown> | string,
): VextSchemaIRV1 | undefined {
  try {
    const schema = schemaConverter.convertResponseSchema(responseSchema);
    const ref = typeof schema.$ref === "string" ? schema.$ref : undefined;
    return {
      schemaVersion: 1,
      kind: "vext-schema-ir",
      source: "docs.responses",
      sourcePath: `docs.responses.${status}.schema`,
      schema,
      digest: createDigest(schema),
      ...(ref ? { ref } : {}),
    };
  } catch {
    // Static indexing deliberately fails closed for dynamic or unsupported
    // expressions. Runtime OpenAPI validation still owns those declarations.
    return undefined;
  }
}

function readRouteResponseDefinitions(
  docsObject: string,
): StaticRouteResponseDefinition[] {
  const responsesObject = readObjectProperty(docsObject, "responses");
  if (!responsesObject) return [];

  return readObjectEntries(responsesObject)
    .map(({ key, value }) => {
      const status = readObjectEntryKey(key);
      const responseObject = value.trim();
      if (!status || !responseObject.startsWith("{")) return null;

      const contentType =
        readStringLiteral(
          readObjectEntryValue(responseObject, "contentType") ?? "",
        ) ?? "application/json";
      const schema = parseStaticResponseSchema(
        readObjectEntryValue(responseObject, "schema"),
      );
      return { status, contentType, ...(schema ? { schema } : {}) };
    })
    .filter(
      (response): response is StaticRouteResponseDefinition =>
        response !== null,
    )
    .sort((left, right) => compareResponseStatus(left.status, right.status));
}

function parseStaticResponseSchema(
  value: string | undefined,
): Record<string, unknown> | string | undefined {
  const parsed = parseStaticSchemaValue(value);
  return typeof parsed === "string" || isStaticSchemaObject(parsed)
    ? parsed
    : undefined;
}

function parseStaticSchemaValue(value: string | undefined): unknown {
  if (!value) return undefined;
  const string = readStringLiteral(value);
  if (string !== null) return string;

  const trimmed = value.trim();
  if (trimmed.startsWith("{")) {
    return parseStaticSchemaObject(trimmed);
  }
  if (trimmed.startsWith("[")) {
    return parseStaticSchemaArray(trimmed);
  }
  return undefined;
}

function parseStaticSchemaObject(
  source: string,
): Record<string, unknown> | undefined {
  const object = readBalanced(source, 0, "{", "}");
  if (!object || object.length !== source.trim().length) return undefined;

  const result: Record<string, unknown> = {};
  for (const { key, value } of readObjectEntries(object)) {
    const property = readObjectEntryKey(key);
    const parsed = parseStaticSchemaValue(value);
    if (!property || parsed === undefined) return undefined;
    result[property] = parsed;
  }
  return result;
}

function parseStaticSchemaArray(source: string): unknown[] | undefined {
  const array = readBalanced(source, 0, "[", "]");
  if (!array || array.length !== source.trim().length) return undefined;
  const members = splitTopLevelArgs(array.slice(1, -1));
  if (members.length === 1 && !members[0]) return [];

  const values: unknown[] = [];
  for (const member of members) {
    const parsed = parseStaticSchemaValue(member);
    if (parsed === undefined) return undefined;
    values.push(parsed);
  }
  return values;
}

function isStaticSchemaObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readObjectEntries(
  objectLiteral: string,
): Array<{ key: string; value: string }> {
  const object = objectLiteral.trim();
  if (!object.startsWith("{") || !object.endsWith("}")) return [];

  const entries: Array<{ key: string; value: string }> = [];
  for (const member of splitTopLevelArgs(object.slice(1, -1))) {
    if (!member) continue;
    const separator = findTopLevelPropertySeparator(member);
    if (separator < 1) continue;
    entries.push({
      key: member.slice(0, separator).trim(),
      value: member.slice(separator + 1).trim(),
    });
  }
  return entries;
}

function readObjectEntryValue(
  objectLiteral: string,
  expectedKey: string,
): string | undefined {
  return readObjectEntries(objectLiteral).find(
    ({ key }) => readObjectEntryKey(key) === expectedKey,
  )?.value;
}

function readObjectEntryKey(value: string): string | null {
  const string = readStringLiteral(value);
  if (string !== null) return string;
  return /^[A-Za-z_$][\w$]*$/u.test(value) || /^\d+$/u.test(value)
    ? value
    : null;
}

function findTopLevelPropertySeparator(source: string): number {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === "{" || char === "(" || char === "[") {
      depth++;
    } else if (char === "}" || char === ")" || char === "]") {
      depth--;
    } else if (char === ":" && depth === 0) {
      return index;
    }
  }
  return -1;
}

function compareResponseStatus(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
}

function readStringProperty(objectLiteral: string, key: string): string | null {
  const pattern = new RegExp(
    `\\b${escapeRegExp(key)}\\s*:\\s*([\"'\`])([\\s\\S]*?)\\1`,
    "u",
  );
  return pattern.exec(objectLiteral)?.[2] ?? null;
}

function readNumberProperty(objectLiteral: string, key: string): number | null {
  const pattern = new RegExp(
    `\\b${escapeRegExp(key)}\\s*:\\s*(-?(?:\\d+\\.?\\d*|\\.\\d+))\\b`,
    "u",
  );
  const match = pattern.exec(objectLiteral);
  return match ? Number(match[1]) : null;
}

function readOptionalBooleanProperty(
  objectLiteral: string,
  key: string,
): boolean | undefined {
  const pattern = new RegExp(
    `\\b${escapeRegExp(key)}\\s*:\\s*(true|false)\\b`,
    "u",
  );
  const value = pattern.exec(objectLiteral)?.[1];
  return value === "true" ? true : value === "false" ? false : undefined;
}

function readObjectProperty(objectLiteral: string, key: string): string | null {
  const pattern = new RegExp(`\\b${escapeRegExp(key)}\\s*:\\s*\\{`, "u");
  const match = pattern.exec(objectLiteral);
  if (!match) return null;
  return readBalanced(
    objectLiteral,
    objectLiteral.indexOf("{", match.index),
    "{",
    "}",
  );
}

function readObjectArrayProperty(
  objectLiteral: string,
  key: string,
): Array<Record<string, string | number | boolean>> | undefined {
  const pattern = new RegExp(`\\b${escapeRegExp(key)}\\s*:\\s*\\[`, "u");
  const match = pattern.exec(objectLiteral);
  if (!match) return undefined;
  const arrayText = readBalanced(
    objectLiteral,
    objectLiteral.indexOf("[", match.index),
    "[",
    "]",
  );
  if (!arrayText) return undefined;

  const members = splitTopLevelArgs(arrayText.slice(1, -1));
  if (members.length === 1 && !members[0]) return [];
  const entries: Array<Record<string, string | number | boolean>> = [];
  for (const member of members) {
    if (!member.startsWith("{") || !member.endsWith("}")) return undefined;
    const values: Record<string, string | number | boolean> = {};
    const properties = splitTopLevelArgs(member.slice(1, -1));
    if (properties.length === 1 && !properties[0]) {
      entries.push(values);
      continue;
    }
    for (const property of properties) {
      const separator = property.indexOf(":");
      if (separator < 1) return undefined;
      const rawKey = property.slice(0, separator).trim();
      const key = readStringLiteral(rawKey) ?? rawKey;
      const rawValue = property.slice(separator + 1).trim();
      const value = readLiteralScalar(rawValue);
      if (!key || value === undefined) return undefined;
      values[key] = value;
    }
    entries.push(values);
  }
  return entries;
}

function readLiteralScalar(
  value: string,
): string | number | boolean | undefined {
  const string = readStringLiteral(value);
  if (string !== null) return string;
  if (value === "true") return true;
  if (value === "false") return false;
  const number = Number(value);
  return Number.isFinite(number) && value.trim() !== "" ? number : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function readStringArrayProperty(objectLiteral: string, key: string): string[] {
  const pattern = new RegExp(`\\b${escapeRegExp(key)}\\s*:\\s*\\[`, "u");
  const match = pattern.exec(objectLiteral);
  if (!match) return [];

  const openBracket = objectLiteral.indexOf("[", match.index);
  const arrayText = readBalanced(objectLiteral, openBracket, "[", "]");
  if (!arrayText) return [];

  return [...arrayText.matchAll(/(["'`])([\s\S]*?)\1/gu)]
    .map((item) => item[2])
    .filter((item): item is string => Boolean(item));
}

function readBooleanProperty(objectLiteral: string, key: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegExp(key)}\\s*:\\s*true\\b`, "u");
  return pattern.test(objectLiteral);
}

function splitTopLevelArgs(argsText: string): string[] {
  const args: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let i = 0; i < argsText.length; i++) {
    const char = argsText[i]!;

    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "{" || char === "(" || char === "[") depth++;
    else if (char === "}" || char === ")" || char === "]") depth--;
    else if (char === "," && depth === 0) {
      args.push(argsText.slice(start, i).trim());
      start = i + 1;
    }
  }

  args.push(argsText.slice(start).trim());
  return args;
}

function readStringLiteral(value: string): string | null {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'" && quote !== "`") {
    return null;
  }
  const end = trimmed.indexOf(quote, 1);
  if (end < 0) {
    return null;
  }
  return trimmed.slice(1, end);
}

function readBalanced(
  source: string,
  openIndex: number,
  openChar: "{" | "(" | "[",
  closeChar: "}" | ")" | "]",
): string | null {
  if (openIndex < 0 || source[openIndex] !== openChar) return null;

  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let i = openIndex; i < source.length; i++) {
    const char = source[i]!;

    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === openChar) depth++;
    else if (char === closeChar) {
      depth--;
      if (depth === 0) {
        return source.slice(openIndex, i + 1);
      }
    }
  }

  return null;
}

function filePathToRoutePrefix(filePath: string, routesDir: string): string {
  let rel = relative(routesDir, filePath);
  rel = rel.split(sep).join("/");

  const ext = extname(rel);
  rel = rel.slice(0, -ext.length);

  if (rel === "index") {
    rel = "";
  } else if (rel.endsWith("/index")) {
    rel = rel.slice(0, -"/index".length);
  }

  rel = rel.replace(/\[([^]]+)]/g, ":$1");

  if (!rel.startsWith("/")) {
    rel = `/${rel}`;
  }

  if (rel.length > 1 && rel.endsWith("/")) {
    rel = rel.slice(0, -1);
  }

  return rel;
}

function normalizeRoutePath(prefix: string, subPath: string): string {
  const cleanPrefix =
    prefix.endsWith("/") && prefix.length > 1 ? prefix.slice(0, -1) : prefix;
  const cleanSubPath = subPath.startsWith("/") ? subPath.slice(1) : subPath;

  if (!cleanSubPath) {
    return cleanPrefix || "/";
  }

  if (cleanPrefix === "/") {
    return `/${cleanSubPath}`;
  }

  const fullPath = `${cleanPrefix}/${cleanSubPath}`;
  if (fullPath.length > 1 && fullPath.endsWith("/")) {
    return fullPath.slice(0, -1);
  }

  return fullPath;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
