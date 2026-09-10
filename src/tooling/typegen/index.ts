import type {
  GeneratedFileResult,
  GeneratedFileDraft,
} from "../../lib/project/generated-files.js";
import { publishGeneratedFiles } from "../../lib/project/generated-files.js";
import { buildProjectIndex } from "../project-index/index.js";
import {
  analyzeServiceDependencies,
  type ServiceDependencyDiagnostic,
} from "../diagnostics/service-deps.js";
import { createServicesDts } from "./generate-services-dts.js";
import {
  createAppExtensionsDts,
  type AppExtensionsGenerationResult,
} from "./generate-app-extensions-dts.js";
import { createServiceManifestFile } from "./write-service-manifest.js";
import { createTypegenShim } from "./generate-typegen-shim.js";
import { withProjectOwner } from "../../lib/project/owner.js";

export interface RunTypegenOptions {
  rootDir: string;
  generateServices: boolean;
  generateAppExtensions: boolean;
  generateShim?: boolean;
  checkOnly?: boolean;
  writeManifest?: boolean;
}

export interface TypegenResult {
  ok: boolean;
  files: GeneratedFileResult[];
  diagnostics: ServiceDependencyDiagnostic[];
  warnings: string[];
  manifest?: GeneratedFileResult;
}

export async function runTypegen(
  options: RunTypegenOptions,
): Promise<TypegenResult> {
  if (options.checkOnly) return runTypegenOwned(options);
  return withProjectOwner(
    options.rootDir,
    "typegen",
    [".vext", "src/types/generated"],
    () => runTypegenOwned(options),
  );
}

async function runTypegenOwned(
  options: RunTypegenOptions,
): Promise<TypegenResult> {
  const {
    rootDir,
    generateServices,
    generateAppExtensions,
    generateShim = true,
    checkOnly = false,
    writeManifest = false,
  } = options;

  const index = await buildProjectIndex(rootDir);
  const drafts: GeneratedFileDraft[] = [];
  const warnings: string[] = [];

  if (generateServices) {
    drafts.push(createServicesDts(rootDir, index.serviceEntries));
  }

  if (generateAppExtensions) {
    const appExtensionsResult: AppExtensionsGenerationResult =
      createAppExtensionsDts(rootDir, index.appExtensions);
    drafts.push(appExtensionsResult.file);
    warnings.push(...appExtensionsResult.warnings);
  }

  if (generateShim && drafts.length > 0) {
    drafts.push(
      createTypegenShim(
        rootDir,
        drafts.map((file) => file.filePath),
      ),
    );
  }

  const serviceDeps = await analyzeServiceDependencies(rootDir, { index });
  const manifestDraft = writeManifest
    ? createServiceManifestFile(
        rootDir,
        index.serviceEntries,
        index.appExtensions,
        serviceDeps,
      )
    : undefined;
  const blocked = serviceDeps.diagnostics.some(
    (diagnostic) => diagnostic.level === "error",
  );
  const results = await publishGeneratedFiles(
    rootDir,
    [...drafts, ...(manifestDraft ? [manifestDraft] : [])],
    { checkOnly: checkOnly || blocked },
  );
  const files = results.slice(0, drafts.length);
  const manifest = manifestDraft ? results[results.length - 1] : undefined;
  const staleFiles = files.filter((file) => file.status === "stale");
  const staleManifest = manifest?.status === "stale";
  const hasErrors = staleFiles.length > 0 || staleManifest || blocked;

  for (const staleFile of staleFiles) {
    warnings.push(`Generated file is stale: ${staleFile.filePath}`);
  }

  if (staleManifest && manifest) {
    warnings.push(`Generated file is stale: ${manifest.filePath}`);
  }

  return {
    ok: !hasErrors,
    files,
    diagnostics: serviceDeps.diagnostics,
    warnings,
    manifest,
  };
}
