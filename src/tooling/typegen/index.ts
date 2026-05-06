import type { GeneratedFileResult } from "./write-generated-file.js";
import { buildProjectIndex } from "../project-index/index.js";
import {
  analyzeServiceDependencies,
  type ServiceDependencyDiagnostic,
} from "../diagnostics/service-deps.js";
import { generateServicesDts } from "./generate-services-dts.js";
import {
  generateAppExtensionsDts,
  type AppExtensionsGenerationResult,
} from "./generate-app-extensions-dts.js";

export interface RunTypegenOptions {
  rootDir: string;
  generateServices: boolean;
  generateAppExtensions: boolean;
  checkOnly?: boolean;
}

export interface TypegenResult {
  ok: boolean;
  files: GeneratedFileResult[];
  diagnostics: ServiceDependencyDiagnostic[];
  warnings: string[];
}

export async function runTypegen(
  options: RunTypegenOptions,
): Promise<TypegenResult> {
  const {
    rootDir,
    generateServices,
    generateAppExtensions,
    checkOnly = false,
  } = options;

  const index = await buildProjectIndex(rootDir);
  const files: GeneratedFileResult[] = [];
  const warnings: string[] = [];

  if (generateServices) {
    files.push(await generateServicesDts(rootDir, index.serviceEntries, { checkOnly }));
  }

  if (generateAppExtensions) {
    const appExtensionsResult: AppExtensionsGenerationResult =
      await generateAppExtensionsDts(rootDir, index.appExtensions, { checkOnly });
    files.push(appExtensionsResult.file);
    warnings.push(...appExtensionsResult.warnings);
  }

  const serviceDeps = await analyzeServiceDependencies(rootDir);
  const staleFiles = files.filter((file) => file.status === "stale");
  const hasErrors =
    staleFiles.length > 0 ||
    serviceDeps.diagnostics.some((diagnostic) => diagnostic.level === "error");

  for (const staleFile of staleFiles) {
    warnings.push(`Generated file is stale: ${staleFile.filePath}`);
  }

  return {
    ok: !hasErrors,
    files,
    diagnostics: serviceDeps.diagnostics,
    warnings,
  };
}

