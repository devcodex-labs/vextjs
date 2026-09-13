import path from "node:path";
import fg from "fast-glob";
import { importUserModule } from "../user-module-loader.js";
import { resolveModuleDefault } from "../interop.js";
import { resolveProjectRolePath } from "../project/layout.js";
import { isVextJobDefinition } from "./define-job.js";
import { VextJobDefinitionError } from "./job-errors.js";
import type { VextJobsConfig, VextLoadedJob } from "./types.js";

export interface LoadJobsOptions {
  rootDir: string;
  srcDir: string;
  config?: VextJobsConfig;
}

export function resolveJobsDirectory(
  sourceBase: string,
  directory = "jobs",
  projectRoot?: string,
): string {
  if (!projectRoot) return path.resolve(sourceBase, directory);
  const source = path.join(projectRoot, "src");
  const configured = resolveProjectRolePath(
    projectRoot,
    source,
    directory,
    "jobs.dir",
    true,
  );
  return path.resolve(sourceBase, path.relative(source, configured));
}

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
          `         Export default defineJob({ handler }) or a named defineJob() value.`,
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

async function scanJobFiles(
  jobsDir: string,
  config: VextJobsConfig | undefined,
): Promise<string[]> {
  const include = config?.include ?? ["**/*.{ts,js,mjs,cjs,mts,cts}"];
  return (
    await fg(include, {
      cwd: jobsDir,
      absolute: true,
      onlyFiles: true,
      ignore: [
        "**/_*.{ts,js,mjs,cjs,mts,cts}",
        "**/*.d.ts",
        "**/*.test.{ts,js,mjs,cjs,mts,cts}",
        "**/*.spec.{ts,js,mjs,cjs,mts,cts}",
        ...(config?.exclude ?? []),
      ],
    })
  ).sort((a, b) => a.localeCompare(b));
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
    if (isVextJobDefinition(value)) {
      jobs.push({ exportName, definition: value });
    }
  }
  return jobs;
}

function inferJobName(sourcePath: string, exportName: string): string {
  const withoutExt = sourcePath.replace(/\.(?:ts|js|mjs|cjs|mts|cts)$/iu, "");
  const normalized = withoutExt.endsWith("/index")
    ? withoutExt.slice(0, -"/index".length)
    : withoutExt;
  const fileName = normalized.replaceAll("/", ".").replace(/\.+/gu, ".");
  if (exportName === "default") return fileName;
  return `${fileName}.${exportName}`;
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}
