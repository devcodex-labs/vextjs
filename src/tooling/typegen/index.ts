import type {
  GeneratedFileResult,
  GeneratedFileDraft,
} from "../../lib/project/generated-files.js";
import { publishGeneratedFiles } from "../../lib/project/generated-files.js";
import {
  buildProjectIndex,
  type ProjectIndex,
} from "../project-index/index.js";
import {
  analyzeIndexedServiceDependencies,
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
import type { ProjectSourceOptions } from "../project-index/source-input.js";

export interface RunTypegenOptions {
  rootDir: string;
  generateServices: boolean;
  generateAppExtensions: boolean;
  generateShim?: boolean;
  checkOnly?: boolean;
  writeManifest?: boolean;
  sourceOptions?: ProjectSourceOptions;
}

export interface TypegenResult {
  ok: boolean;
  complete: boolean;
  files: GeneratedFileResult[];
  diagnostics: ServiceDependencyDiagnostic[];
  warnings: string[];
  manifest?: GeneratedFileResult;
}

export type TypegenGenerationOptions = Pick<
  RunTypegenOptions,
  | "generateServices"
  | "generateAppExtensions"
  | "generateShim"
  | "writeManifest"
>;

export interface TypegenDraftResult {
  complete: boolean;
  files: GeneratedFileDraft[];
  diagnostics: ServiceDependencyDiagnostic[];
  warnings: string[];
  manifest?: GeneratedFileDraft;
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

/** 只返回本代候选和诊断；所有磁盘比较、owner 与提交由运行入口负责。 */
export function createTypegenDrafts(
  index: ProjectIndex,
  options: TypegenGenerationOptions,
): TypegenDraftResult {
  const {
    generateServices,
    generateAppExtensions,
    generateShim = true,
    writeManifest = false,
  } = options;

  const rootDir = index.source.rootDir;
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

  const serviceDeps = analyzeIndexedServiceDependencies(index);
  const incomplete = [
    ...serviceDeps.incompleteFiles,
    ...(index.appExtensionIncompleteFiles ?? []),
  ];
  for (const file of incomplete)
    warnings.push(`Static projection is incomplete: ${file}`);
  const complete = incomplete.length === 0 && warnings.length === 0;
  const manifestDraft = writeManifest
    ? createServiceManifestFile(
        rootDir,
        index.serviceEntries,
        index.appExtensions,
        serviceDeps,
        {
          sourceRevision: index.source.view.revision,
          complete,
          incompleteFiles: incomplete,
        },
      )
    : undefined;

  return {
    complete,
    files: drafts,
    warnings,
    diagnostics: serviceDeps.diagnostics,
    manifest: manifestDraft,
  };
}

async function runTypegenOwned(
  options: RunTypegenOptions,
): Promise<TypegenResult> {
  const { rootDir, checkOnly = false } = options;
  const index = await buildProjectIndex(rootDir, options.sourceOptions);
  const {
    complete,
    files: drafts,
    warnings,
    diagnostics,
    manifest: manifestDraft,
  } = createTypegenDrafts(index, options);
  const blocked = diagnostics.some(
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
    complete,
    files,
    diagnostics,
    warnings,
    manifest,
  };
}
