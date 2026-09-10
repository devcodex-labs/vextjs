import { statSync } from "node:fs";
import { extname, isAbsolute, join, relative, sep } from "node:path";
import { publishGeneratedFiles } from "../project/generated-files.js";
import { inferOperationId } from "../openapi/operation-id.js";
import type { RouteMetadata, VextOpenAPIDocsKind } from "../openapi/types.js";
import {
  createRouteFreshnessIdentity,
  createRouteId,
  createUnresolvedLayoutIdentity,
  projectRouteSchemaContract,
} from "../../frontend/contract/schema-ir.js";
import type {
  VextRouteFreshnessIdentity,
  VextRouteLayoutIdentity,
  VextRouteSchemaContractV1,
} from "../../frontend/contract/types.js";

export interface DevRouteManifestPayload {
  schemaVersion: 1;
  kind: "routes-manifest";
  target: "routes";
  source: "runtime-collector";
  routeFileCount: number;
  routeCount: number;
  summary: {
    publicRoutes: number;
    hiddenRoutes: number;
    explicitOperationIds: number;
    inferredOperationIds: number;
    missingDocsSummary: number;
    missingTags: number;
    duplicateRoutes: number;
  };
  routes: Array<{
    fileRelativePath: string;
    source: string;
    docsKind: VextOpenAPIDocsKind;
    prefix: string;
    method: string;
    path: string;
    docsSummary: string | null;
    summary: string | null;
    routeId: string;
    operationId: string;
    operationIdSource: "explicit" | "inferred";
    tags: string[];
    hidden: boolean;
    schema: VextRouteSchemaContractV1;
    freshness: VextRouteFreshnessIdentity;
    layout: VextRouteLayoutIdentity;
  }>;
}

interface DevRouteSourceLayout {
  srcDir: string;
  outDir: string;
}

export async function writeDevRouteManifest(
  rootDir: string,
  routes: RouteMetadata[],
  layout: DevRouteSourceLayout,
): Promise<void> {
  const filePath = join(rootDir, ".vext", "manifest", "routes.json");
  await publishGeneratedFiles(rootDir, [
    {
      filePath,
      content: `${JSON.stringify(buildDevRouteManifestPayload(rootDir, routes, layout), null, 2)}\n`,
      producer: "route-manifest",
    },
  ]);
}

export function buildDevRouteManifestPayload(
  rootDir: string,
  routes: RouteMetadata[],
  layout: DevRouteSourceLayout,
): DevRouteManifestPayload {
  const records = routes.map((route) => {
    const docs = route.options.docs;
    const operationId =
      docs?.operationId ?? inferOperationId(route.method, route.path);
    const fileRelativePath = toSourceRelativePath(
      rootDir,
      route.sourceFile,
      layout,
    );
    const docsSummary = docs?.summary ?? null;
    return {
      fileRelativePath,
      source: fileRelativePath,
      docsKind: route.docsKind ?? "backend-api",
      prefix: "",
      method: route.method,
      path: route.path,
      docsSummary,
      summary: docsSummary,
      routeId: createRouteId(route.method, route.path),
      operationId,
      operationIdSource: docs?.operationId
        ? ("explicit" as const)
        : ("inferred" as const),
      tags: docs?.tags ?? [],
      hidden: false,
      schema: projectRouteSchemaContract(route.options, route.method),
      freshness: createRouteFreshnessIdentity(route.options),
      layout: createUnresolvedLayoutIdentity(),
    };
  });

  return {
    schemaVersion: 1,
    kind: "routes-manifest",
    target: "routes",
    source: "runtime-collector",
    routeFileCount: new Set(records.map((route) => route.fileRelativePath))
      .size,
    routeCount: records.length,
    summary: {
      publicRoutes: records.length,
      hiddenRoutes: 0,
      explicitOperationIds: records.filter(
        (route) => route.operationIdSource === "explicit",
      ).length,
      inferredOperationIds: records.filter(
        (route) => route.operationIdSource === "inferred",
      ).length,
      missingDocsSummary: records.filter((route) => !route.docsSummary?.trim())
        .length,
      missingTags: records.filter((route) => route.tags.length === 0).length,
      duplicateRoutes: countDuplicateRoutes(records),
    },
    routes: records,
  };
}

function countDuplicateRoutes(
  routes: Array<{ method: string; path: string }>,
): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) {
      duplicates++;
    }
    seen.add(key);
  }
  return duplicates;
}

function toPortableRelativePath(rootDir: string, filePath: string): string {
  return relative(rootDir, filePath).split(sep).join("/");
}

function toSourceRelativePath(
  rootDir: string,
  filePath: string,
  layout: DevRouteSourceLayout,
): string {
  const devRelative = relative(layout.outDir, filePath);
  if (
    devRelative === ".." ||
    devRelative.startsWith(`..${sep}`) ||
    isAbsolute(devRelative) ||
    devRelative === "" ||
    extname(devRelative) !== ".js"
  ) {
    return toPortableRelativePath(rootDir, filePath);
  }

  const withoutExt = devRelative.slice(0, -".js".length);
  const matches: string[] = [];
  for (const ext of [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"]) {
    const sourcePath = join(layout.srcDir, `${withoutExt}${ext}`);
    try {
      if (!statSync(sourcePath).isFile()) {
        throw new Error(`[vextjs] Route source is not a file: ${sourcePath}`);
      }
      matches.push(sourcePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (matches.length > 1) {
    throw new Error(
      `[vextjs] Ambiguous compiled route source for ${filePath}: ${matches.join(", ")}`,
    );
  }
  return toPortableRelativePath(rootDir, matches[0] ?? filePath);
}
