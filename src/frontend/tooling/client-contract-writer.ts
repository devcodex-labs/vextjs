import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  VextClientContract,
  VextClientRouteContract,
  VextClientRouteMethod,
} from "../contract/types.js";

// Keep generated artifacts byte-stable for identical route manifests.
const STABLE_CLIENT_CONTRACT_GENERATED_AT = "1970-01-01T00:00:00.000Z";

interface RoutesManifestPayload {
  routes?: Array<{
    method?: string;
    path?: string;
    operationId?: string;
    docsSummary?: string | null;
    tags?: string[];
    hidden?: boolean;
  }>;
}

export interface WriteClientContractOptions {
  rootDir: string;
  outDir: string;
  routeManifestPath?: string;
}

export interface WriteClientContractResult {
  contractPath: string;
  modulePath: string;
  routeCount: number;
  warnings: string[];
}

export async function writeClientContractFromRouteManifest(
  options: WriteClientContractOptions,
): Promise<WriteClientContractResult> {
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
  const modulePath = path.join(options.outDir, "api.generated.ts");

  await mkdir(options.outDir, { recursive: true });
  await writeFile(
    contractPath,
    `${JSON.stringify(contract, null, 2)}\n`,
    "utf-8",
  );
  await writeFile(modulePath, renderApiModule(contract), "utf-8");

  return {
    contractPath,
    modulePath,
    routeCount: contract.routes.length,
    warnings: contract.warnings,
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
    routes.push({
      method,
      path: route.path,
      operationId: route.operationId,
      summary: route.docsSummary ?? null,
      tags: route.tags ?? [],
      input: {
        params: { type: "unknown" },
        query: { type: "unknown" },
        body: { type: "unknown" },
        headers: { type: "unknown" },
      },
      response: { type: "unknown" },
    });
  }

  return {
    schemaVersion: 1,
    kind: "client-contract",
    source: "routes-manifest",
    generatedAt: STABLE_CLIENT_CONTRACT_GENERATED_AT,
    routes,
    warnings,
  };
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

function renderApiModule(contract: VextClientContract): string {
  return (
    'import { createVextApiClient } from "vextjs/frontend";\n\n' +
    `export const contract = ${JSON.stringify(contract, null, 2)} as const;\n` +
    "export const api = createVextApiClient(contract);\n"
  );
}
