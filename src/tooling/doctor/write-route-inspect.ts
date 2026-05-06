import { join } from "node:path";
import type { GeneratedFileResult } from "../typegen/write-generated-file.js";
import { writeGeneratedFile } from "../typegen/write-generated-file.js";

export interface RouteInspectPayload {
  schemaVersion: 1;
  target: "routes";
  routeFileCount: number;
  routeCount: number;
  summary: {
    errors: number;
    warnings: number;
    infos: number;
    blocking: number;
    byCode: Record<string, number>;
    byGroup: Record<string, number>;
  };
  diagnostics: unknown[];
  routes: unknown[];
}

export async function writeRouteInspectFile(
  rootDir: string,
  payload: RouteInspectPayload,
): Promise<GeneratedFileResult> {
  const filePath = join(rootDir, ".vext", "inspect", "routes.json");
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  return writeGeneratedFile(filePath, content);
}

