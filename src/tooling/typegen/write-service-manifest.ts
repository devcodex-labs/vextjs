import { relative } from "node:path";
import type {
  AppExtensionIndexEntry,
  ServiceIndexEntry,
} from "../project-index/index.js";
import type { ServiceDependencyReport } from "../diagnostics/service-deps.js";
import type { GeneratedFileResult } from "./write-generated-file.js";
import { writeGeneratedFile } from "./write-generated-file.js";
import { mergeAppExtensions } from "./merge-app-extensions.js";
import { getTypegenGeneratedPaths } from "./generated-paths.js";

export interface ServiceManifestPayload {
  schemaVersion: 1;
  kind: "services-manifest";
  target: "services";
  serviceCount: number;
  appExtensionCount: number;
  summary: {
    topLevelServices: number;
    nestedServices: number;
    dependencyEdges: number;
    dependencyCycles: number;
    conflictingAppExtensions: number;
    lowConfidenceAppExtensions: number;
  };
  services: Array<{
    serviceKey: string;
    keySegments: string[];
    fileRelativePath: string;
    importPath: string;
  }>;
  appExtensions: Array<{
    propertyKey: string;
    inferredTypeText: string;
    pluginRelativePaths: string[];
    sourceKinds: string[];
    confidence: "high" | "medium" | "low";
    conflict: boolean;
  }>;
  dependencies: {
    edges: Array<{
      from: string;
      to: string;
    }>;
    cycles: string[][];
  };
}

export async function writeServiceManifestFile(
  rootDir: string,
  entries: ServiceIndexEntry[],
  appExtensions: AppExtensionIndexEntry[],
  dependencyReport: ServiceDependencyReport,
  options: { checkOnly?: boolean } = {},
): Promise<GeneratedFileResult> {
  const filePath = getTypegenGeneratedPaths(rootDir).serviceManifest;
  const content = `${JSON.stringify(
    buildServiceManifestPayload(
      rootDir,
      entries,
      appExtensions,
      dependencyReport,
    ),
    null,
    2,
  )}\n`;
  return writeGeneratedFile(filePath, content, options);
}

export function buildServiceManifestPayload(
  rootDir: string,
  entries: ServiceIndexEntry[],
  appExtensions: AppExtensionIndexEntry[],
  dependencyReport: ServiceDependencyReport,
): ServiceManifestPayload {
  const mergedAppExtensions = mergeAppExtensions(appExtensions).entries;
  const dependencyEdges = [...dependencyReport.graph.entries()]
    .flatMap(([from, targets]) =>
      [...targets]
        .sort((a, b) => a.localeCompare(b))
        .map((to) => ({ from, to })),
    )
    .sort((a, b) => {
      const fromCompare = a.from.localeCompare(b.from);
      return fromCompare !== 0 ? fromCompare : a.to.localeCompare(b.to);
    });
  const cycles = dependencyReport.diagnostics
    .map((diagnostic) => diagnostic.relatedKeys)
    .filter(
      (value): value is string[] => Array.isArray(value) && value.length > 0,
    )
    .map((cycle) => [...cycle])
    .sort((a, b) => a.join(".").localeCompare(b.join(".")));

  const services = entries.map((entry) => ({
    serviceKey: entry.serviceKey,
    keySegments: [...entry.keySegments],
    fileRelativePath: toPortableRelativePath(rootDir, entry.filePath),
    importPath: entry.importPath,
  }));

  return {
    schemaVersion: 1,
    kind: "services-manifest",
    target: "services",
    serviceCount: services.length,
    appExtensionCount: mergedAppExtensions.length,
    summary: {
      topLevelServices: new Set(
        entries.map((entry) => entry.keySegments[0]).filter(Boolean),
      ).size,
      nestedServices: entries.filter((entry) => entry.keySegments.length > 1)
        .length,
      dependencyEdges: dependencyEdges.length,
      dependencyCycles: cycles.length,
      conflictingAppExtensions: mergedAppExtensions.filter(
        (entry) => entry.conflict,
      ).length,
      lowConfidenceAppExtensions: mergedAppExtensions.filter(
        (entry) => entry.confidence !== "high",
      ).length,
    },
    services,
    appExtensions: mergedAppExtensions.map((entry) => ({
      propertyKey: entry.propertyKey,
      inferredTypeText: entry.inferredTypeText,
      pluginRelativePaths: entry.pluginFiles.map((filePath) =>
        toPortableRelativePath(rootDir, filePath),
      ),
      sourceKinds: [...entry.sourceKinds],
      confidence: entry.confidence,
      conflict: entry.conflict,
    })),
    dependencies: {
      edges: dependencyEdges,
      cycles,
    },
  } satisfies ServiceManifestPayload;
}

function toPortableRelativePath(rootDir: string, filePath: string): string {
  return relative(rootDir, filePath).replace(/\\/gu, "/");
}
