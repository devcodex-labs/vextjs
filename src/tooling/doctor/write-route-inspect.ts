import { join } from "node:path";
import type { GeneratedFileDraft } from "../../lib/project/generated-files.js";

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

export function createRouteInspectFile(
  rootDir: string,
  payload: RouteInspectPayload,
): GeneratedFileDraft {
  const filePath = join(rootDir, ".vext", "inspect", "routes.json");
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  return { filePath, content, producer: "route-inspect" };
}
