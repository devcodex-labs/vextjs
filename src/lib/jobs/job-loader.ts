import { inferJobName } from "./job-name.js";
import path from "node:path";
import { scanJobFiles, resolveJobsDirectory } from "./job-discovery.js";
import { importUserModule } from "../user-module-loader.js";
import { resolveModuleDefault } from "../interop.js";
import { isVextJobDefinition } from "./define-job.js";
import { VextJobDefinitionError } from "./job-errors.js";
import type { VextJobsConfig, VextLoadedJob } from "./types.js";

export interface LoadJobsOptions {
  rootDir: string;
  srcDir: string;
  config?: VextJobsConfig;
}

export { resolveJobsDirectory } from "./job-discovery.js";

export async function loadJobs(
  options: LoadJobsOptions,
): Promise<VextLoadedJob[]> {
  if (options.config?.enabled === false) return [];
  const jobsDir = resolveJobsDirectory(
    options.srcDir,
    options.config?.dir ?? "jobs",
    options.rootDir,
  );
  const files = await scanJobFiles(jobsDir, options.config);
  const jobs: VextLoadedJob[] = [];
  for (const file of files) {
    const module = await importJobModule(file, options.rootDir);
    const exports = collectJobExports(module);
    if (exports.length === 0) {
      throw new VextJobDefinitionError(
        `[vextjs] Job file has no defineJob() export.\n` +
          `         File: ${file}\n` +
          `         Export default defineJob({ interval: 60000, handler }) or a named defineJob() value.`,
      );
    }
    for (const item of exports) {
      const sourcePath = toPosix(path.relative(jobsDir, file));
      const inferredName = inferJobName(sourcePath, item.exportName);
      const name = item.definition.name?.trim() || inferredName;
      jobs.push({
        name,
        definition: item.definition,
        sourceFile: file,
        sourcePath,
        exportName: item.exportName,
      });
    }
  }
  return jobs;
}

async function importJobModule(
  file: string,
  rootDir: string,
): Promise<Record<string, unknown>> {
  try {
    return await importUserModule(file, rootDir, { cache: false });
  } catch (error) {
    throw new VextJobDefinitionError(
      `[vextjs] Failed to load job file.\n` +
        `         File: ${file}\n` +
        `         ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function collectJobExports(module: Record<string, unknown>) {
  const jobs: Array<{
    exportName: string;
    definition: VextLoadedJob["definition"];
  }> = [];
  const defaultExport = resolveModuleDefault(module);
  if (isVextJobDefinition(defaultExport)) {
    jobs.push({ exportName: "default", definition: defaultExport });
  }
  for (const [exportName, value] of Object.entries(module)) {
    if (exportName === "default") continue;
    // Node >=23 exposes this synthetic alias for native CommonJS namespaces.
    if (exportName === "module.exports" && value === module.default) continue;
    if (isVextJobDefinition(value)) {
      jobs.push({ exportName, definition: value });
    }
  }
  return jobs;
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}
