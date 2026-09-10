import { join } from "node:path";
import type {
  VextRouteFreshnessIdentity,
  VextRouteLayoutIdentity,
  VextRouteSchemaContractV1,
} from "../../frontend/contract/types.js";
import type { VextOpenAPIDocsKind } from "../../lib/openapi/types.js";
import type { GeneratedFileDraft } from "../../lib/project/generated-files.js";

export interface RouteManifestPayload {
  schemaVersion: 1;
  kind: "routes-manifest";
  target: "routes";
  sourceFingerprint: string;
  sourceFiles: string[];
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
    prefix: string;
    method: string;
    subPath: string;
    path: string;
    docsKind: VextOpenAPIDocsKind;
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

export function createRouteManifestFile(
  rootDir: string,
  payload: RouteManifestPayload,
): GeneratedFileDraft {
  const filePath = join(rootDir, ".vext", "manifest", "routes.json");
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  return { filePath, content, producer: "route-manifest" };
}
