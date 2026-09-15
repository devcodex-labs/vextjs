import { basename, join, relative, sep } from "node:path";
import {
  isUnsupportedCommonJsRouteFileName,
  shouldIncludeRouteFilePath,
} from "../../lib/route-file-policy.js";
import { assertPathInside } from "../../lib/path-boundary.js";
import { type SourceView, SourceViewError } from "../source-view/types.js";
import {
  collectProjectSources,
  projectSourceDirectory,
  PROJECT_SOURCE_ROOT_ID,
  type ProjectSourceOptions,
} from "./source-input.js";
import {
  createCanonicalRouteIdentity,
  normalizeRegisteredRoutePath,
  projectRouteFilePrefix,
} from "../../lib/route-contract.js";
import { detectRouteSourceDocsKind } from "../../lib/openapi/route-docs-kind.js";
import { SchemaConverter } from "../../lib/openapi/schema-converter.js";
import type { VextOpenAPIDocsKind } from "../../lib/openapi/types.js";
import {
  collectRouteFactoryRegistrations,
  isVextRouteMethod,
} from "../../lib/route-factory-contract.js";
import {
  StaticModuleGraph,
  type StaticExpression,
  type StaticModule,
  type StaticSourceLocation,
  unwrapStaticNode,
} from "./static-module-graph.js";
import { projectSchemaFields } from "./schema-field-projection.js";
import {
  createDigest,
  createRouteFreshnessIdentity,
  projectRouteSchemaContract,
} from "../../frontend/contract/schema-ir.js";
import {
  normalizeDocumentedResponseSelector,
  normalizeRuntimeResponseSelector,
  resolveRouteResponseJsonSchema,
} from "../../lib/response-serializer.js";
import type {
  VextRouteFreshnessIdentity,
  VextRouteResponseSchemaV1,
  VextRouteSchemaContractV1,
  VextSchemaIRV1,
} from "../../frontend/contract/types.js";
import type {
  RouteOptions,
  VextRouteFrontendOptions,
} from "../../types/app.js";

const schemaConverter = new SchemaConverter();

interface StaticRouteResponseDefinition {
  status: string;
  contentType: string;
  source: "responses" | "docs.responses";
  schema?: Record<string, unknown> | string;
}

type StaticObject = Map<string, StaticExpression>;

interface StaticScanContext {
  graph: StaticModuleGraph;
  module: StaticModule;
  origins: Map<string, StaticSourceLocation>;
}

interface RouteProjectionContext {
  fileRelativePath: string;
  method: string;
  routePath?: string;
}

export interface RouteIndexEntry {
  filePath: string;
  fileRelativePath: string;
  prefix: string;
  method: string;
  subPath: string;
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

export interface RouteSourceSnapshot {
  fingerprint: string;
  files: string[];
}

export async function createRouteSourceSnapshot(
  rootDir: string,
  options: ProjectSourceOptions = {},
): Promise<RouteSourceSnapshot> {
  return projectRouteSourceSnapshot(
    await collectProjectSources(rootDir, ["route"], options),
    options,
  );
}

export function projectRouteSourceSnapshot(
  view: SourceView,
  options: ProjectSourceOptions = {},
): RouteSourceSnapshot {
  const sources = view
    // sourceRevision属于完整封存范围；文件证据不能省略all profile中的额外输入。
    .list()
    .map((record) => ({
      file:
        record.rootId === (options.rootId ?? PROJECT_SOURCE_ROOT_ID)
          ? record.path
          : `@shared/${record.rootId}/${record.path}`,
      sha256: record.sha256,
    }));
  return {
    fingerprint: createDigest({
      schemaVersion: 4,
      sourceRevision: view.revision,
      sourcePolicy: "vext-route-ast-graph-v1",
      directory: projectSourceDirectory("route", options),
      sources,
    }),
    files: sources.map((source) => source.file),
  };
}

export async function buildRouteIndex(
  rootDir: string,
  options: ProjectSourceOptions = {},
): Promise<RouteIndexEntry[]> {
  return buildRouteIndexFromSourceView(
    rootDir,
    await collectProjectSources(rootDir, ["route"], options),
    options,
  );
}

export function buildRouteIndexFromSourceView(
  rootDir: string,
  view: SourceView,
  options: ProjectSourceOptions = {},
): RouteIndexEntry[] {
  const routesDir = join(rootDir, projectSourceDirectory("route", options));
  const rootId = options.rootId ?? PROJECT_SOURCE_ROOT_ID;
  const routeFiles = view.list({ rootId, roles: ["route"] }).map((record) => {
    const filePath = join(rootDir, record.path);
    assertPathInside(routesDir, filePath, "route source");
    return filePath;
  });
  const commonJsRoute = routeFiles.find((filePath) =>
    isUnsupportedCommonJsRouteFileName(basename(filePath)),
  );
  if (commonJsRoute) {
    throw routeModuleError(
      relative(rootDir, commonJsRoute).split(sep).join("/"),
      "uses unsupported CommonJS route source; convert it to TypeScript or an ESM .js/.mjs module",
    );
  }

  const includedFiles = routeFiles
    .filter((filePath) => shouldIncludeRouteFilePath(filePath, routesDir))
    .sort((left, right) => left.localeCompare(right));
  assertUniqueRouteFilePrefixes(includedFiles, rootDir, routesDir);
  const graph = new StaticModuleGraph(view);
  const entries = includedFiles
    .flatMap((filePath) => {
      const source = view.read(
        rootId,
        relative(rootDir, filePath).split(sep).join("/"),
      );
      if (source === undefined)
        throw new SourceViewError(
          "VEXT_SOURCE_UNVERIFIED",
          "Route source was not sealed: " + filePath + ".",
        );
      return scanRouteEntries(
        filePath,
        rootDir,
        routesDir,
        graph,
        graph.module(rootId, relative(rootDir, filePath).split(sep).join("/")),
      );
    })
    .sort((a, b) =>
      `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`),
    );
  assertUniqueRouteEntries(entries);
  return entries;
}

function scanRouteEntries(
  filePath: string,
  rootDir: string,
  routesDir: string,
  graph: StaticModuleGraph,
  module: StaticModule,
): RouteIndexEntry[] {
  const prefix = projectRouteFilePrefix(filePath, routesDir);
  const fileRelativePath = relative(rootDir, filePath).split(sep).join("/");
  const staticContext: StaticScanContext = {
    graph,
    module,
    origins: new Map(),
  };
  const calls = findDefaultExportedDefineRoutesCalls(
    staticContext,
    fileRelativePath,
  );
  return calls.map((call) => {
    if (
      call.callee.type !== "MemberExpression" ||
      call.callee.property.type !== "Identifier" ||
      !isVextRouteMethod(call.callee.property.name)
    )
      throw routeModuleError(fileRelativePath, "invalid canonical registrar");
    const method = call.callee.property.name.toUpperCase();
    const baseContext: RouteProjectionContext = { fileRelativePath, method };
    const args = call.arguments.map((node) =>
      graph.expression(staticContext.module, node),
    );
    const routePath = readStaticStringExpression(
      args[0],
      staticContext,
      baseContext,
      "route path expression must be statically resolvable",
    );
    const normalizedPath = normalizeRegisteredRoutePath(prefix, routePath);
    const context: RouteProjectionContext = {
      ...baseContext,
      routePath: normalizedPath,
    };
    staticContext.origins = new Map();
    const optionsObject =
      args.length === 3
        ? readStaticObjectExpression(
            args[1],
            staticContext,
            context,
            "route options",
          )
        : undefined;
    const docs = readRouteDocs(optionsObject, staticContext, context);
    const responses = mergeRouteResponseDefinitions(
      readRouteResponseDefinitions(
        optionsObject,
        "responses",
        staticContext,
        context,
      ),
      docs.responses,
    );
    const frontend = optionsObject
      ? readRouteFrontend(optionsObject, staticContext, context)
      : undefined;
    const handler = args.at(-1)!;
    const schema = createRouteSchemaContract(
      optionsObject,
      responses,
      method,
      staticContext,
      context,
    );
    for (const ir of [
      ...Object.values(schema.request),
      ...schema.responses.flatMap((response) =>
        response.schema ? [response.schema] : [],
      ),
    ]) {
      const label = `${formatProjectionContext(context)} ${ir.source === "validate" ? "RouteOptions." : ""}${ir.sourcePath}`;
      ir.projection = {
        completeness: "complete",
        validator: "default-schema-dsl",
        sources: Object.fromEntries(
          [...staticContext.origins]
            .filter(
              ([key]) =>
                key === label ||
                key.startsWith(label + ".") ||
                key.startsWith(label + "["),
            )
            .map(([key, value]) => [key.slice(label.length) || ".", value]),
        ),
        fields: projectSchemaFields(ir.schema, ir.source === "validate"),
      };
    }
    return {
      filePath,
      fileRelativePath,
      prefix,
      method,
      subPath: routePath,
      path: normalizedPath,
      docsSummary: docs.docsSummary,
      hasDocsSummary: docs.hasDocsSummary,
      operationId: docs.operationId,
      tags: docs.tags,
      hidden: docs.hidden,
      docsKind:
        frontend !== undefined
          ? "frontend-route"
          : detectRouteSourceDocsKind(graph.text(handler)),
      schema,
      freshness: createRouteFreshnessIdentity({ frontend }),
    };
  });
}

function assertUniqueRouteFilePrefixes(
  routeFiles: readonly string[],
  rootDir: string,
  routesDir: string,
): void {
  const owners = new Map<string, string>();
  for (const filePath of routeFiles) {
    const prefix = projectRouteFilePrefix(filePath, routesDir);
    const identity = prefix.toLocaleLowerCase("en-US");
    const existing = owners.get(identity);
    if (existing) {
      throw new Error(
        `[vextjs] Route prefix conflict detected for "${prefix}": ${relative(rootDir, existing).split(sep).join("/")} and ${relative(rootDir, filePath).split(sep).join("/")} map to the same route ownership boundary.`,
      );
    }
    owners.set(identity, filePath);
  }
}

function assertUniqueRouteEntries(entries: readonly RouteIndexEntry[]): void {
  const owners = new Map<string, RouteIndexEntry>();
  for (const entry of entries) {
    const identity = createCanonicalRouteIdentity(entry.method, entry.path);
    const existing = owners.get(identity);
    if (existing) {
      throw new Error(
        `[vextjs] Duplicate route identity ${entry.method.toUpperCase()} ${entry.path}: ${existing.fileRelativePath} conflicts with ${entry.fileRelativePath}. Route paths are compared without trailing slashes and without case differences for cross-adapter safety.`,
      );
    }
    owners.set(identity, entry);
  }
}

/** Statically projects the finite RouteOptions.frontend grammar. */
function readRouteFrontend(
  optionsObject: StaticObject,
  staticContext: StaticScanContext,
  context: RouteProjectionContext,
): VextRouteFrontendOptions | undefined {
  const frontendValue = readObjectEntryValue(optionsObject, "frontend");
  if (frontendValue === undefined) return undefined;
  const parsed = parseStaticSchemaValue(
    frontendValue,
    staticContext,
    `${formatProjectionContext(context)} RouteOptions.frontend`,
  );
  if (!isStaticSchemaObject(parsed)) {
    throw projectionError(
      context,
      "RouteOptions.frontend must be statically resolvable to an object literal",
    );
  }
  return parsed as VextRouteFrontendOptions;
}

function findDefaultExportedDefineRoutesCalls(
  context: StaticScanContext,
  file: string,
) {
  const { graph, module } = context;
  if (!module.exports.has("default"))
    throw routeModuleError(
      file,
      "must default-export its defineRoutes(...) result",
    );
  const exported = graph.exported(module.rootId, module.path);
  // 路径身份属于 Loader 入口；契约字段属于实际定义模块，不能混用两个词法上下文。
  context.module = exported.module;
  const call = exported.node;
  if (
    call.type !== "CallExpression" ||
    call.callee.type !== "Identifier" ||
    !graph.frameworkBinding(
      graph.expression(exported.module, call.callee),
      "defineRoutes",
    )
  )
    throw routeModuleError(
      file,
      "default export must resolve to a proven defineRoutes(...) call",
    );
  if (call.arguments.length !== 1)
    throw routeModuleError(
      file,
      "defineRoutes(...) requires exactly one inline synchronous factory",
    );
  const resolvedFactory = graph.resolve(
    graph.expression(exported.module, call.arguments[0]!),
  );
  context.module = resolvedFactory.module;
  const factory = unwrapStaticNode(resolvedFactory.node);
  if (
    factory.type !== "ArrowFunctionExpression" &&
    factory.type !== "FunctionExpression"
  )
    throw routeModuleError(
      file,
      "defineRoutes(...) requires a statically resolved arrow or function expression with one app parameter",
    );
  if (factory.async)
    throw routeModuleError(file, "defineRoutes factory must be synchronous");
  return collectRouteFactoryRegistrations(factory, file);
}

function routeModuleError(fileRelativePath: string, message: string): Error {
  return new Error(`[vextjs] ${fileRelativePath} ${message}.`);
}

function readRouteDocs(
  optionsObject: StaticObject | undefined,
  staticContext: StaticScanContext,
  context: RouteProjectionContext,
): {
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

  if (!optionsObject) {
    return empty;
  }

  const docsValue = readObjectEntryValue(optionsObject, "docs");
  if (docsValue === undefined) return empty;
  const docsObject = readStaticObjectExpression(
    docsValue,
    staticContext,
    context,
    "RouteOptions.docs",
  );
  const summary = readOptionalStaticStringProperty(
    docsObject,
    "summary",
    staticContext,
    context,
    "RouteOptions.docs.summary",
  );
  const operationId = readOptionalStaticStringProperty(
    docsObject,
    "operationId",
    staticContext,
    context,
    "RouteOptions.docs.operationId",
  );

  return {
    docsSummary: summary,
    hasDocsSummary: Boolean(summary?.trim()),
    operationId,
    tags: readStaticStringArrayProperty(
      docsObject,
      "tags",
      staticContext,
      context,
      "RouteOptions.docs.tags",
    ),
    hidden: readStaticBooleanProperty(
      docsObject,
      "hidden",
      staticContext,
      context,
      "RouteOptions.docs.hidden",
      false,
    ),
    responses: readRouteResponseDefinitions(
      docsObject,
      "docs.responses",
      staticContext,
      context,
    ),
  };
}

function createRouteSchemaContract(
  optionsObject: StaticObject | undefined,
  responses: readonly StaticRouteResponseDefinition[],
  method: string,
  staticContext: StaticScanContext,
  context: RouteProjectionContext,
): VextRouteSchemaContractV1 {
  let request: VextRouteSchemaContractV1["request"] = {};
  const validateValue = optionsObject
    ? readObjectEntryValue(optionsObject, "validate")
    : undefined;
  if (validateValue !== undefined) {
    const validate = parseStaticSchemaValue(
      validateValue,
      staticContext,
      `${formatProjectionContext(context)} RouteOptions.validate`,
    );
    if (!isStaticSchemaObject(validate)) {
      throw projectionError(
        context,
        "RouteOptions.validate must be statically resolvable to an object literal",
      );
    }
    try {
      request = projectRouteSchemaContract(
        { validate } as unknown as RouteOptions,
        method,
      ).request;
    } catch (error) {
      throw projectionError(
        context,
        `RouteOptions.validate projection failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    schemaVersion: 1,
    request,
    responses: responses
      .map((response) => {
        const schema = response.schema
          ? createStaticResponseSchema(response, method, context)
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
  response: StaticRouteResponseDefinition,
  method: string,
  context: RouteProjectionContext,
): VextSchemaIRV1 | undefined {
  try {
    if (
      response.source === "responses" &&
      (method === "HEAD" || response.status === "204")
    ) {
      return undefined;
    }
    const schema =
      response.source === "responses"
        ? resolveRouteResponseJsonSchema(response.schema!)
        : schemaConverter.convertResponseSchema(response.schema!);
    const ref = typeof schema.$ref === "string" ? schema.$ref : undefined;
    return {
      schemaVersion: 1,
      kind: "vext-schema-ir",
      source: response.source,
      sourcePath: `${response.source}.${response.status}.schema`,
      schema,
      digest: createDigest(schema),
      ...(ref ? { ref } : {}),
    };
  } catch (error) {
    throw projectionError(
      context,
      `${response.source}.${response.status}.schema could not be projected: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readRouteResponseDefinitions(
  containerObject: StaticObject | undefined,
  source: "responses" | "docs.responses",
  staticContext: StaticScanContext,
  context: RouteProjectionContext,
): StaticRouteResponseDefinition[] {
  if (!containerObject) return [];
  const responsesValue = readObjectEntryValue(containerObject, "responses");
  if (responsesValue === undefined) return [];
  const responsesObject = readStaticObjectExpression(
    responsesValue,
    staticContext,
    context,
    source,
  );

  const definitions = [...responsesObject].map(([rawStatus, value]) => {
    if (!rawStatus) {
      throw projectionError(
        context,
        `${source} contains a response selector that is not statically resolvable`,
      );
    }
    const responseObject = readStaticObjectExpression(
      value,
      staticContext,
      context,
      `${source}.${rawStatus}`,
    );
    const status =
      source === "responses"
        ? normalizeRuntimeResponseSelector(rawStatus)
        : normalizeDocumentedResponseSelector(rawStatus);

    const contentTypeValue = readObjectEntryValue(
      responseObject,
      "contentType",
    );
    const contentType =
      contentTypeValue === undefined
        ? "application/json"
        : readStaticStringExpression(
            contentTypeValue,
            staticContext,
            context,
            `${source}.${status}.contentType must be statically resolvable`,
          );
    const schemaValue = readObjectEntryValue(responseObject, "schema");
    const schema = parseStaticResponseSchema(
      schemaValue,
      staticContext,
      context,
      `${source}.${status}.schema`,
    );
    return { status, contentType, source, ...(schema ? { schema } : {}) };
  });

  const selectors = new Set<string>();
  for (const definition of definitions) {
    if (selectors.has(definition.status)) {
      throw new Error(
        `[vextjs] Duplicate ${source} selector after normalization: ${JSON.stringify(definition.status)}.`,
      );
    }
    selectors.add(definition.status);
  }

  return definitions.sort((left, right) =>
    compareResponseStatus(left.status, right.status),
  );
}

function mergeRouteResponseDefinitions(
  runtimeResponses: readonly StaticRouteResponseDefinition[],
  documentedResponses: readonly StaticRouteResponseDefinition[],
): StaticRouteResponseDefinition[] {
  const merged = new Map(
    runtimeResponses.map((response) => [response.status, response] as const),
  );

  for (const documented of documentedResponses) {
    const runtime = merged.get(documented.status);
    if (!runtime) {
      merged.set(documented.status, documented);
      continue;
    }
    if (documented.schema !== undefined) {
      throw new Error(
        `[vextjs] Route response selector ${documented.status} declares schema in both RouteOptions.responses and docs.responses.`,
      );
    }
    merged.set(documented.status, {
      ...runtime,
      contentType: documented.contentType,
    });
  }

  return [...merged.values()].sort((left, right) =>
    compareResponseStatus(left.status, right.status),
  );
}

function parseStaticResponseSchema(
  value: StaticExpression | undefined,
  staticContext: StaticScanContext,
  context: RouteProjectionContext,
  label: string,
): Record<string, unknown> | string | undefined {
  if (value === undefined) return undefined;
  const parsed = parseStaticSchemaValue(
    value,
    staticContext,
    `${formatProjectionContext(context)} ${label}`,
  );
  if (typeof parsed === "string" || isStaticSchemaObject(parsed)) {
    return parsed;
  }
  throw projectionError(
    context,
    `${label} must be statically resolvable to a supported schema`,
  );
}

function parseStaticSchemaValue(
  value: StaticExpression | undefined,
  staticContext: StaticScanContext,
  label: string,
): unknown {
  return value === undefined
    ? undefined
    : staticContext.graph.value(value, label, staticContext.origins);
}

function isStaticSchemaObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStaticObjectExpression(
  value: StaticExpression | undefined,
  staticContext: StaticScanContext,
  context: RouteProjectionContext,
  label: string,
): StaticObject {
  if (value === undefined)
    throw projectionError(context, `${label} is missing`);
  try {
    return staticContext.graph.object(value, label);
  } catch (error) {
    throw projectionError(
      context,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function readStaticStringExpression(
  value: StaticExpression | undefined,
  staticContext: StaticScanContext,
  context: RouteProjectionContext,
  failureMessage: string,
): string {
  try {
    if (value) {
      const parsed = staticContext.graph.value(value, failureMessage);
      if (typeof parsed === "string") return parsed;
    }
  } catch (error) {
    throw projectionError(
      context,
      `${failureMessage}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  throw projectionError(context, failureMessage);
}

function readOptionalStaticStringProperty(
  objectLiteral: StaticObject,
  key: string,
  staticContext: StaticScanContext,
  context: RouteProjectionContext,
  label: string,
): string | null {
  const value = readObjectEntryValue(objectLiteral, key);
  return value === undefined
    ? null
    : readStaticStringExpression(
        value,
        staticContext,
        context,
        `${label} must be statically resolvable`,
      );
}

function readStaticStringArrayProperty(
  objectLiteral: StaticObject,
  key: string,
  staticContext: StaticScanContext,
  context: RouteProjectionContext,
  label: string,
): string[] {
  const value = readObjectEntryValue(objectLiteral, key);
  if (value === undefined) return [];
  const parsed = parseStaticSchemaValue(
    value,
    staticContext,
    `${formatProjectionContext(context)} ${label}`,
  );
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== "string")
  ) {
    throw projectionError(
      context,
      `${label} must be statically resolvable to a string array`,
    );
  }
  return parsed as string[];
}

function readStaticBooleanProperty(
  objectLiteral: StaticObject,
  key: string,
  staticContext: StaticScanContext,
  context: RouteProjectionContext,
  label: string,
  fallback: boolean,
): boolean {
  const value = readObjectEntryValue(objectLiteral, key);
  if (value === undefined) return fallback;
  const parsed = parseStaticSchemaValue(
    value,
    staticContext,
    `${formatProjectionContext(context)} ${label}`,
  );
  if (typeof parsed !== "boolean") {
    throw projectionError(
      context,
      `${label} must be statically resolvable to a boolean`,
    );
  }
  return parsed;
}

function formatProjectionContext(context: RouteProjectionContext): string {
  return `${context.fileRelativePath} ${context.method}${context.routePath ? ` ${context.routePath}` : ""}`;
}

function projectionError(
  context: RouteProjectionContext,
  message: string,
): Error {
  return new Error(`[vextjs] ${formatProjectionContext(context)} ${message}.`);
}

function readObjectEntryValue(
  object: StaticObject,
  key: string,
): StaticExpression | undefined {
  return object.get(key);
}

function compareResponseStatus(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
}
