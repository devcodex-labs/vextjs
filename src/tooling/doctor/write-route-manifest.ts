import { join } from "node:path";
import type { GeneratedFileResult } from "../typegen/write-generated-file.js";
import { writeGeneratedFile } from "../typegen/write-generated-file.js";

export interface RouteManifestPayload {
  schemaVersion: 1;
  kind: "routes-manifest";
  target: "routes";
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
    prefix: string;
    method: string;
    path: string;
    docsSummary: string | null;
    operationId: string;
    operationIdSource: "explicit" | "inferred";
    tags: string[];
    hidden: boolean;
  }>;
}

export async function writeRouteManifestFile(
  rootDir: string,
  payload: RouteManifestPayload,
): Promise<GeneratedFileResult> {
  const filePath = join(rootDir, ".vext", "manifest", "routes.json");
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  return writeGeneratedFile(filePath, content);
}
