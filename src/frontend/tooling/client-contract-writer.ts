import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactCandidate } from "../../lib/project/artifact-transaction.js";
import type {
  VextClientContract,
  VextClientResponseContract,
  VextClientRouteContract,
  VextClientRouteMethod,
  VextClientSchemaReference,
  VextRouteSchemaContractV1,
  VextSchemaIRV1,
} from "../contract/types.js";
import { STABLE_FRONTEND_GENERATED_AT } from "../contract/metadata.js";
import { createDigest, createRouteId } from "../contract/schema-ir.js";

export interface RoutesManifestPayload {
  routes?: Array<{
    method?: string;
    path?: string;
    routeId?: string;
    operationId?: string;
    source?: string;
    docsKind?: "backend-api" | "frontend-route";
    docsSummary?: string | null;
    tags?: string[];
    hidden?: boolean;
    schema?: VextRouteSchemaContractV1;
    freshness?: VextClientRouteContract["freshness"];
    layout?: VextClientRouteContract["layout"];
  }>;
}

export interface WriteClientContractOptions {
  rootDir: string;
  outDir: string;
  routeManifestPath?: string;
}

export interface WriteClientContractResult {
  contractPath: string;
  routeContractPath: string;
  modulePath: string;
  routeCount: number;
  warnings: readonly string[];
}

/** 只读取路由输入并生成候选，统一前端构建在其他阶段成功后提交这些字节。 */
export async function createClientContractArtifacts(
  options: WriteClientContractOptions,
): Promise<{
  result: WriteClientContractResult;
  files: ArtifactCandidate[];
  contract: VextClientContract;
}> {
  const routeManifestPath =
    options.routeManifestPath ??
    path.join(options.rootDir, ".vext", "manifest", "routes.json");
  const payload = existsSync(routeManifestPath)
    ? (JSON.parse(
        await readFile(routeManifestPath, "utf-8"),
      ) as RoutesManifestPayload)
    : ({ routes: [] } satisfies RoutesManifestPayload);
  const contract = buildClientContract(payload);
  const contractPath = path.join(options.outDir, "client-contract.json");
  const routeContractPath = path.join(options.outDir, "route-contract.json");
  const modulePath = path.join(options.outDir, "api.generated.ts");

  return {
    files: [
      {
        path: contractPath,
        contents: `${JSON.stringify(contract, null, 2)}\n`,
        source: routeManifestPath,
      },
      {
        path: routeContractPath,
        contents: `${JSON.stringify({ ...contract, kind: "route-contract" }, null, 2)}\n`,
        source: routeManifestPath,
      },
      {
        path: modulePath,
        contents: renderApiModule(contract),
        source: routeManifestPath,
      },
    ],
    contract,
    result: {
      contractPath,
      routeContractPath,
      modulePath,
      routeCount: contract.routes.length,
      warnings: contract.warnings,
    },
  };
}

export function buildClientContract(
  payload: RoutesManifestPayload,
): VextClientContract {
  const warnings: string[] = [];
  const routes: VextClientRouteContract[] = [];

  for (const route of payload.routes ?? []) {
    if (route.hidden) continue;
    const method = normalizeMethod(route.method);
    if (!method || !route.path || !route.operationId) {
      warnings.push(
        `Skipped route with incomplete metadata: ${route.method ?? "?"} ${route.path ?? "?"}`,
      );
      continue;
    }
    const routeId = route.routeId ?? createRouteId(method, route.path);
    const routeDescription = describeRouteForDiagnostic(route, routeId);
    const isFrontendDocument = route.docsKind === "frontend-route";
    const request = route.schema?.request;
    const input = {
      ...(request?.params ? { params: toSchemaReference(request.params) } : {}),
      ...(request?.query ? { query: toSchemaReference(request.query) } : {}),
      ...(request?.body ? { body: toSchemaReference(request.body) } : {}),
      ...(request?.headers
        ? { headers: toSchemaReference(request.headers) }
        : {}),
      ...(request?.cookies
        ? { cookies: toSchemaReference(request.cookies) }
        : {}),
    };
    const responses = buildResponseContracts(
      routeDescription,
      route.schema,
      warnings,
      !isFrontendDocument,
    );
    const response = selectSuccessResponse(
      routeDescription,
      responses,
      warnings,
      isFrontendDocument,
    );

    routes.push({
      routeId,
      method,
      path: route.path,
      operationId: route.operationId,
      summary: route.docsSummary ?? null,
      tags: route.tags ?? [],
      ...(Object.keys(input).length > 0 ? { input } : {}),
      response,
      responses,
      freshness: route.freshness ?? {
        mode: "dynamic",
        source: "legacy-default",
      },
      layout: route.layout ?? { state: "unresolved", paths: [] },
    });
  }

  const routeManifestDigest = createDigest({
    routes: (payload.routes ?? []).filter((route) => !route.hidden),
  });
  const base = {
    schemaVersion: 1,
    kind: "client-contract",
    source: "routes-manifest",
    generatedAt: STABLE_FRONTEND_GENERATED_AT,
    protocolVersion: 1,
    routeManifestDigest,
    routes,
    warnings,
  } as const;
  return { ...base, digest: createDigest(base) };
}

/**
 * Rejects a generated client contract when it no longer represents the route
 * manifest that produced it. This remains in the tooling layer deliberately:
 * browser clients consume the already-generated contract and must not pull in
 * Node's hashing implementation just to make a request.
 */
export function assertClientContractMatchesRouteManifest(
  contract: VextClientContract,
  payload: RoutesManifestPayload,
): void {
  const expected = buildClientContract(payload);
  if (contract.routeManifestDigest !== expected.routeManifestDigest) {
    throw new Error(
      "Client contract route manifest digest differs from the current route manifest.",
    );
  }
  if (contract.digest !== expected.digest) {
    throw new Error(
      "Client contract digest differs from the contract projected from the current route manifest.",
    );
  }
}

function normalizeMethod(
  value: string | undefined,
): VextClientRouteMethod | null {
  const method = value?.toUpperCase();
  if (
    method === "GET" ||
    method === "POST" ||
    method === "PUT" ||
    method === "PATCH" ||
    method === "DELETE" ||
    method === "HEAD" ||
    method === "OPTIONS"
  ) {
    return method;
  }
  return null;
}

function toSchemaReference(schema: VextSchemaIRV1): VextClientSchemaReference {
  return { type: "schema", schema };
}

function describeRouteForDiagnostic(
  route: NonNullable<RoutesManifestPayload["routes"]>[number],
  routeId: string,
): string {
  const source = route.source?.trim();
  return `${route.method?.toUpperCase() ?? "?"} ${route.path ?? "?"} (${source ? `${source}; ` : ""}${routeId})`;
}

function buildResponseContracts(
  routeDescription: string,
  schema: VextRouteSchemaContractV1 | undefined,
  warnings: string[],
  warnOnUnknown: boolean,
): VextClientResponseContract[] {
  return (schema?.responses ?? []).map((response) => {
    if (response.schema) {
      return {
        status: response.status,
        contentType: response.contentType,
        schema: toSchemaReference(response.schema),
      };
    }
    const diagnostic = `${routeDescription}:${response.status} has no runtime or documented response schema; emitted unknown.`;
    if (warnOnUnknown) {
      warnings.push(diagnostic);
    }
    return {
      status: response.status,
      contentType: response.contentType,
      schema: { type: "unknown", diagnostic },
    };
  });
}

function selectSuccessResponse(
  routeDescription: string,
  responses: readonly VextClientResponseContract[],
  warnings: string[],
  isFrontendDocument: boolean,
): VextClientSchemaReference {
  const successResponses = responses.filter((response) =>
    isSuccessResponseStatus(response.status),
  );
  if (successResponses.length === 1) return successResponses[0]!.schema;
  if (successResponses.length > 1) {
    const successSchemas = successResponses
      .map((response) => response.schema)
      .filter(
        (schema): schema is { type: "schema"; schema: VextSchemaIRV1 } =>
          schema.type === "schema",
      );
    if (successSchemas.length === 1) return successSchemas[0]!;
    if (successSchemas.length > 1) {
      const schema = {
        schemaVersion: 1,
        kind: "vext-schema-ir",
        source: "responses",
        sourcePath: "responses.success.schema",
        schema: {
          anyOf: successSchemas.map((schemaRef) => schemaRef.schema.schema),
        },
      } satisfies Omit<VextSchemaIRV1, "digest">;
      return {
        type: "schema",
        schema: { ...schema, digest: createDigest(schema) },
      };
    }
    const diagnostic = `${routeDescription} has multiple 2xx responses but none has a runtime or documented response schema; emitted unknown.`;
    if (!isFrontendDocument) {
      warnings.push(diagnostic);
    }
    return { type: "unknown", diagnostic };
  }
  const diagnostic = isFrontendDocument
    ? `${routeDescription} renders an HTML document; emitted unknown.`
    : `${routeDescription} has no runtime or documented 2xx response schema; emitted unknown.`;
  if (!isFrontendDocument) {
    warnings.push(diagnostic);
  }
  return { type: "unknown", diagnostic };
}

function isSuccessResponseStatus(status: string): boolean {
  return /^2(?:\d\d|xx)$/iu.test(status);
}

function renderApiModule(contract: VextClientContract): string {
  const routeTypes = contract.routes
    .map((route) => renderRouteType(route))
    .join("\n\n");
  return [
    'import { createVextApiClient, type VextApiRouteType } from "vextjs/frontend";',
    "",
    "export interface VextGeneratedRouteTypes {",
    routeTypes,
    "}",
    "",
    `export const contract = ${JSON.stringify(contract, null, 2)} as const;`,
    "export const api = createVextApiClient<typeof contract, VextGeneratedRouteTypes>(contract);",
    "",
  ].join("\n");
}

function renderRouteType(route: VextClientRouteContract): string {
  const routeId = route.routeId ?? createRouteId(route.method, route.path);
  const lines = [
    `  ${JSON.stringify(routeId)}: VextApiRouteType & {`,
    `    params: ${renderSchemaType(route.input?.params?.schema)};`,
    `    query: ${renderSchemaType(route.input?.query?.schema)};`,
    `    headers: ${renderSchemaType(route.input?.headers?.schema)};`,
    `    cookies: ${renderSchemaType(route.input?.cookies?.schema)};`,
    `    body: ${renderSchemaType(route.input?.body?.schema)};`,
    `    response: ${renderSchemaType(route.response?.schema)};`,
    "  };",
  ];
  return lines.join("\n");
}

function renderSchemaType(schema: VextSchemaIRV1 | undefined): string {
  return schema ? renderJsonSchemaType(schema.schema) : "unknown";
}

function renderJsonSchemaType(schema: Record<string, unknown>): string {
  if (typeof schema.$ref === "string") return "unknown";
  if (schema.const !== undefined) return renderLiteral(schema.const);
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.map(renderLiteral).join(" | ");
  }
  const unions = [schema.anyOf, schema.oneOf]
    .filter(Array.isArray)
    .flatMap((value) => value as unknown[])
    .filter(isRecord)
    .map(renderJsonSchemaType);
  if (unions.length > 0) return unions.join(" | ");

  const rawType = schema.type;
  if (Array.isArray(rawType)) {
    return rawType
      .filter((type): type is string => typeof type === "string")
      .map((type) => renderJsonSchemaType({ ...schema, type }))
      .join(" | ");
  }
  const type = typeof rawType === "string" ? rawType : undefined;
  const core =
    type === "string"
      ? "string"
      : type === "number" || type === "integer"
        ? "number"
        : type === "boolean"
          ? "boolean"
          : type === "null"
            ? "null"
            : type === "array"
              ? `${renderArrayItem(schema.items)}[]`
              : type === "object" || schema.properties
                ? renderObjectType(schema)
                : "unknown";
  return schema.nullable === true && core !== "null" ? `${core} | null` : core;
}

function renderArrayItem(value: unknown): string {
  const rendered = isRecord(value) ? renderJsonSchemaType(value) : "unknown";
  return rendered.includes(" | ") ? `(${rendered})` : rendered;
}

function renderObjectType(schema: Record<string, unknown>): string {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === "string")
      : [],
  );
  const entries = Object.entries(properties);
  if (entries.length === 0) {
    return schema.additionalProperties === true
      ? "Record<string, unknown>"
      : "{}";
  }
  return `{ ${entries
    .map(([key, value]) => {
      const optional = required.has(key) ? "" : "?";
      return `${JSON.stringify(key)}${optional}: ${
        isRecord(value) ? renderJsonSchemaType(value) : "unknown"
      }`;
    })
    .join("; ")} }`;
}

function renderLiteral(value: unknown): string {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
    ? JSON.stringify(value)
    : "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
