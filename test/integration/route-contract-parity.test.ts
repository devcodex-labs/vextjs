import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHookManager } from "../../src/lib/hooks.js";
import { RouteMetadataCollector } from "../../src/lib/openapi/collector.js";
import { loadRoutes } from "../../src/lib/router-loader.js";
import {
  normalizeRegisteredRoutePath,
  projectRouteFilePrefix,
} from "../../src/lib/route-contract.js";
import {
  createDigest,
  createRouteFreshnessIdentity,
  projectRouteSchemaContract,
} from "../../src/frontend/contract/schema-ir.js";
import type {
  VextRouteFreshnessIdentity,
  VextRouteSchemaContractV1,
} from "../../src/frontend/contract/types.js";
import { detectRouteDocsKind } from "../../src/lib/openapi/route-docs-kind.js";
import type { VextOpenAPIDocsKind } from "../../src/lib/openapi/types.js";
import type { VextApp } from "../../src/types/app.js";
import type { RouteDefinition, RouteRecord } from "../../src/types/route.js";
import {
  runDoctor,
  type DoctorRouteRecord,
} from "../../src/tooling/doctor/index.js";
import {
  buildRouteIndex,
  type RouteIndexEntry,
} from "../../src/tooling/project-index/scan-routes.js";

vi.mock("vextjs", async () => {
  const { defineRoutes } = await import("../../src/lib/define-routes.js");
  return { defineRoutes };
});

interface CanonicalRouteInput {
  fileRelativePath: string;
  prefix: string;
  method: string;
  subPath: string;
  path: string;
  docs: {
    summary: string | null;
    operationId: string | null;
    tags: string[];
    hidden: boolean;
    kind: VextOpenAPIDocsKind;
  };
  schema: VextRouteSchemaContractV1;
  freshness: VextRouteFreshnessIdentity;
}

interface CanonicalRoute extends CanonicalRouteInput {
  semanticDigest: string;
}

interface ParityRoute extends CanonicalRouteInput {
  diagnosticCodes: string[];
}

interface ParityContract {
  schemaVersion: number;
  allowedDifferences: Record<string, string | string[]>;
  routes: ParityRoute[];
}

const fixtureRoot = dirname(
  fileURLToPath(
    new URL("../fixtures/route-contract-parity/contract.json", import.meta.url),
  ),
);

const expectedAllowedDifferences = {
  absoluteFilePath:
    "Static index and Doctor expose a host-specific absolute filePath; parity uses fileRelativePath as the portable source location.",
  runtimeOnly: ["handler", "options"],
  doctorOnly: [
    "effectiveOperationId",
    "operationIdSource",
    "diagnostic.message",
    "diagnostic.suggestedValue",
  ],
};

async function readContract(): Promise<ParityContract> {
  return JSON.parse(
    await readFile(join(fixtureRoot, "contract.json"), "utf8"),
  ) as ParityContract;
}

function canonicalRoute(input: CanonicalRouteInput): CanonicalRoute {
  return { ...input, semanticDigest: createDigest(input) };
}

function sortCanonicalRoutes(routes: CanonicalRoute[]): CanonicalRoute[] {
  return [...routes].sort((left, right) =>
    [left.fileRelativePath, left.method, left.path, left.subPath]
      .join("\0")
      .localeCompare(
        [right.fileRelativePath, right.method, right.path, right.subPath].join(
          "\0",
        ),
      ),
  );
}

function contractRouteProjection(route: ParityRoute): CanonicalRoute {
  const { diagnosticCodes: _diagnosticCodes, ...input } = route;
  return canonicalRoute(input);
}

function staticRouteProjection(route: RouteIndexEntry): CanonicalRoute {
  return canonicalRoute({
    fileRelativePath: route.fileRelativePath,
    prefix: route.prefix,
    method: route.method,
    subPath: route.subPath,
    path: route.path,
    docs: {
      summary: route.docsSummary,
      operationId: route.operationId,
      tags: route.tags,
      hidden: route.hidden,
      kind: route.docsKind,
    },
    schema: route.schema,
    freshness: route.freshness,
  });
}

function doctorRouteProjection(route: DoctorRouteRecord): CanonicalRoute {
  return canonicalRoute({
    fileRelativePath: route.fileRelativePath,
    prefix: route.prefix,
    method: route.method,
    subPath: route.subPath,
    path: route.path,
    docs: {
      summary: route.docsSummary,
      operationId: route.operationId,
      tags: route.tags,
      hidden: route.hidden,
      kind: route.docsKind,
    },
    schema: route.schema,
    freshness: route.freshness,
  });
}

function runtimeRouteProjection(
  route: RouteRecord,
  fileRelativePath: string,
  prefix: string,
  registeredPath: string,
): CanonicalRoute {
  const summary = route.options.docs?.summary?.trim() || null;
  const operationId = route.options.docs?.operationId?.trim() || null;
  const tags = (route.options.docs?.tags ?? [])
    .map((tag) => tag.trim())
    .filter(Boolean);
  return canonicalRoute({
    fileRelativePath,
    prefix,
    method: route.method,
    subPath: route.path,
    path: registeredPath,
    docs: {
      summary,
      operationId,
      tags,
      hidden: route.options.docs?.hidden === true,
      kind:
        route.options.frontend !== undefined
          ? "frontend-route"
          : detectRouteDocsKind(route.handler),
    },
    schema: projectRouteSchemaContract(route.options, route.method),
    freshness: createRouteFreshnessIdentity(route.options),
  });
}

function createRuntimeApp(): VextApp {
  const app = {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      child: () => app.logger,
      level: "silent",
    },
    config: {
      port: 3000,
      host: "127.0.0.1",
      adapter: "hono",
      trustProxy: false,
      middlewares: [],
      cors: { enabled: false, origins: [], methods: [], headers: [] },
      rateLimit: { enabled: false },
      requestId: { enabled: false },
      logger: { level: "silent" },
      shutdown: { timeout: 1 },
      response: { hideInternalErrors: true },
      bodyParser: { maxBodySize: "1mb" },
      openapi: { enabled: false },
      accessLog: { enabled: false },
      requestContext: { enabled: false },
      _testMode: true,
    },
    services: {},
    hooks: createHookManager(),
    adapter: { registerRoute: vi.fn() },
    getValidator: () => ({ compile: () => () => ({ valid: true }) }),
  };
  return app as unknown as VextApp;
}

async function loadRuntimeRoutes(): Promise<CanonicalRoute[]> {
  const routesDir = join(fixtureRoot, "src", "routes");
  const collector = new RouteMetadataCollector();
  await loadRoutes(
    createRuntimeApp(),
    routesDir,
    {
      middlewareDefs: new Map(),
      globalMiddlewares: [],
      rootDir: fixtureRoot,
    },
    collector,
  );

  const metadata = collector.getRoutes();
  const definitions = new Map<string, RouteDefinition>();
  for (const sourceFile of new Set(metadata.map((route) => route.sourceFile))) {
    const module = (await import(pathToFileURL(sourceFile).href)) as {
      default: RouteDefinition;
    };
    definitions.set(sourceFile, module.default);
  }

  return metadata.map((registered) => {
    const definition = definitions.get(registered.sourceFile);
    expect(definition).toBeDefined();
    const prefix = projectRouteFilePrefix(registered.sourceFile, routesDir);
    const route = definition!.routes.find(
      (candidate) =>
        candidate.method === registered.method &&
        normalizeRegisteredRoutePath(prefix, candidate.path) ===
          registered.path,
    );
    expect(route).toBeDefined();
    return runtimeRouteProjection(
      route!,
      relative(fixtureRoot, registered.sourceFile).split(sep).join("/"),
      prefix,
      registered.path,
    );
  });
}

describe("Route Contract producer parity", () => {
  it("keeps static, runtime, and Doctor identities equal outside the allowlist", async () => {
    const contract = await readContract();
    expect(contract.schemaVersion).toBe(1);
    expect(contract.allowedDifferences).toEqual(expectedAllowedDifferences);

    const expectedRoutes = sortCanonicalRoutes(
      contract.routes.map(contractRouteProjection),
    );
    const staticRoutes = sortCanonicalRoutes(
      (await buildRouteIndex(fixtureRoot)).map(staticRouteProjection),
    );

    const runtimeRoutes = sortCanonicalRoutes(await loadRuntimeRoutes());

    const doctor = await runDoctor({
      rootDir: fixtureRoot,
      target: "routes",
      refresh: true,
    });
    const doctorRoutes = sortCanonicalRoutes(
      doctor.routes.map(doctorRouteProjection),
    );

    expect(staticRoutes).toEqual(expectedRoutes);
    expect(runtimeRoutes).toEqual(expectedRoutes);
    expect(doctorRoutes).toEqual(expectedRoutes);
  });

  it("changes the semantic digest when nested docs or schema contract changes", async () => {
    const contract = await readContract();
    const baseline = contractRouteProjection(contract.routes[0]!);
    const { semanticDigest: _baselineDigest, ...baselineInput } = baseline;
    const changedDocs = canonicalRoute({
      ...baselineInput,
      docs: {
        ...baseline.docs,
        tags: [...baseline.docs.tags, "digest-regression"],
      },
    });
    const changedSchema = canonicalRoute({
      ...baselineInput,
      schema: {
        ...baseline.schema,
        responses: [
          ...baseline.schema.responses,
          { status: "599", contentType: "application/json" },
        ],
      },
    });

    expect(changedDocs.semanticDigest).not.toBe(baseline.semanticDigest);
    expect(changedSchema.semanticDigest).not.toBe(baseline.semanticDigest);
  });

  it("keeps Doctor diagnostic identities and portable source locations exact", async () => {
    const contract = await readContract();
    const doctor = await runDoctor({
      rootDir: fixtureRoot,
      target: "routes",
      refresh: true,
    });
    const expectedDiagnostics = contract.routes
      .flatMap((route) =>
        route.diagnosticCodes.map((code) => ({
          code,
          fileRelativePath: route.fileRelativePath,
          method: route.method,
          path: route.path,
        })),
      )
      .sort((left, right) =>
        `${left.fileRelativePath}:${left.code}`.localeCompare(
          `${right.fileRelativePath}:${right.code}`,
        ),
      );
    const actualDiagnostics = doctor.diagnostics
      .filter((diagnostic) => diagnostic.fileRelativePath)
      .map((diagnostic) => ({
        code: diagnostic.code,
        fileRelativePath: diagnostic.fileRelativePath!,
        method: diagnostic.method!,
        path: diagnostic.path!,
      }))
      .sort((left, right) =>
        `${left.fileRelativePath}:${left.code}`.localeCompare(
          `${right.fileRelativePath}:${right.code}`,
        ),
      );

    expect(actualDiagnostics).toEqual(expectedDiagnostics);
    expect(doctor.ok).toBe(true);
    expect(doctor.summary.blocking).toBe(0);
  });
});
