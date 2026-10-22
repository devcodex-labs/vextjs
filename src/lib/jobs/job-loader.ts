import { inferJobName } from "./job-name.js";
import path from "node:path";
import { resolveJobsDirectory } from "./job-discovery.js";
import { importUserModule } from "../user-module-loader.js";
import { defineJob } from "./define-job.js";
import { collectJobSourceSnapshot } from "./job-source.js";
import { readCjsJobProjection } from "./job-cjs-projection.js";
import { parseSourceSyntax } from "../source-syntax.js";
import { createSourceBindings } from "../source-bindings.js";
import { types as nodeTypes } from "node:util";
import { VEXT_JOB_SYMBOL } from "./types.js";
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
  const snapshot = await collectJobSourceSnapshot(
    options.rootDir,
    options.srcDir,
    options.config,
  );
  const files = snapshot.files;
  const jobs: VextLoadedJob[] = [];
  for (const file of files) {
    const relative = path
      .relative(options.srcDir, file)
      .split(path.sep)
      .join("/");
    const projectionTables = [
      ...(snapshot.projectionTables.get(relative) ?? []),
    ];
    const module = await importJobModule(
      file,
      options.rootDir,
      (filename, source) => {
        if (!filename.endsWith(".cts")) return;
        const program = parseSourceSyntax(filename + ".cjs", source);
        const projection = readCjsJobProjection(
          program,
          createSourceBindings(program),
        );
        if (projection)
          projectionTables.unshift([
            "__esModule",
            ...projection.exports.keys(),
          ]);
      },
    );
    const exports = collectJobExports(
      module,
      projectionTables,
      /\.[cm]?[jt]s$/u.test(file) &&
        snapshot.declarations.get(relative)?.format !== "esm",
    );
    if (exports.length === 0) {
      throw new VextJobDefinitionError(
        `[vextjs] Job file has no defineJob() export.\n` +
          `         File: ${file}\n` +
          `         Export default defineJob({ cron, handler }); one Job per selected file.`,
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
  await snapshot.verify();
  return jobs;
}

async function importJobModule(
  file: string,
  rootDir: string,
  onCompiled: (file: string, source: string) => void,
): Promise<Record<string, unknown>> {
  try {
    return await importUserModule(file, rootDir, { cache: false, onCompiled });
  } catch (error) {
    throw new VextJobDefinitionError(
      `[vextjs] Failed to load job file.\n` +
        `         File: ${file}\n` +
        `         ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function collectJobExports(
  module: Record<string, unknown>,
  projectionTables: string[][],
  commonJs: boolean,
) {
  const jobs: Array<{
    exportName: string;
    definition: VextLoadedJob["definition"];
  }> = [];
  const outer = Object.getOwnPropertyDescriptors(module);
  if (!outer.default || !("value" in outer.default))
    throw new VextJobDefinitionError(
      "[vextjs] Job default must be a stable module value.",
    );
  const outerContainer = outer.default.value;
  let container = outerContainer;
  assertNotProxy(container);
  // Only the proven transport may expose compiler-created accessors. Each
  // effective export is read once; arbitrary user getters are never probed.
  const remaining = [...projectionTables];
  while (
    !isStableJobValue(container) &&
    remaining.length &&
    container &&
    typeof container === "object"
  ) {
    assertNotProxy(container);
    const descriptors = Object.getOwnPropertyDescriptors(container);
    const keys = Reflect.ownKeys(descriptors);
    const match = remaining.findIndex(
      (table) =>
        keys.length === table.length &&
        keys.every((key) => typeof key === "string" && table.includes(key)),
    );
    if (match < 0 || !descriptors.default)
      throw new VextJobDefinitionError(
        "[vextjs] Job projection export table differs from its proven source.",
      );
    remaining.splice(match, 1);
    for (const [name, descriptor] of Object.entries(descriptors)) {
      if (name === "default") continue;
      const value =
        "value" in descriptor ? descriptor.value : Reflect.get(container, name);
      if (name === "__esModule" && value === true && "value" in descriptor)
        continue;
      if (isStableJobValue(value))
        throw new VextJobDefinitionError(
          `[vextjs] Job-valued named export ${name} is unsupported.`,
        );
    }
    container =
      "value" in descriptors.default
        ? descriptors.default.value
        : Reflect.get(container, "default");
  }
  const defaultExport = container;
  if (isStableJobValue(defaultExport)) {
    jobs.push({ exportName: "default", definition: defineJob(defaultExport) });
  }
  for (const [exportName, descriptor] of Object.entries(outer)) {
    if (exportName === "default") continue;
    const value = "value" in descriptor ? descriptor.value : undefined;
    if (!("value" in descriptor))
      throw new VextJobDefinitionError(
        `[vextjs] Job export ${exportName} is an unsupported accessor.`,
      );
    // Node >=23 exposes this synthetic alias for native CommonJS namespaces.
    if (commonJs && exportName === "module.exports" && value === outerContainer)
      continue;
    if (
      commonJs &&
      projectionTables.length &&
      exportName === "__esModule" &&
      value === true
    )
      continue;
    if (isStableJobValue(value)) {
      throw new VextJobDefinitionError(
        `[vextjs] Job-valued named export ${exportName} is unsupported.`,
      );
    }
  }
  return jobs;
}

function assertNotProxy(value: unknown): void {
  if (nodeTypes.isProxy(value))
    throw new VextJobDefinitionError(
      "[vextjs] User Proxy Job exports are unsupported.",
    );
}
function isStableJobValue(
  value: unknown,
): value is VextLoadedJob["definition"] {
  assertNotProxy(value);
  if (!value || (typeof value !== "object" && typeof value !== "function"))
    return false;
  const brand = Object.getOwnPropertyDescriptor(value, VEXT_JOB_SYMBOL);
  if (brand && !("value" in brand))
    throw new VextJobDefinitionError(
      "[vextjs] User accessor Job exports are unsupported.",
    );
  return (
    brand?.value === true &&
    typeof Object.getOwnPropertyDescriptor(value, "handler")?.value ===
      "function"
  );
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}
