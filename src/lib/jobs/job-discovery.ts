import path from "node:path";
import micromatch from "micromatch";
import fg from "../safe-glob.js";
import { resolveProjectRolePath } from "../project/layout.js";

/** Shared policy for runtime loading and static consumers. Globs match real files. */
export const JOB_INCLUDE = ["**/*.{ts,js,mjs,cjs,mts,cts}"];
export const JOB_IGNORE = [
  "**/_*.{ts,js,mjs,cjs,mts,cts}",
  "**/*.d.{ts,mts,cts}",
  "**/*.test.{ts,js,mjs,cjs,mts,cts}",
  "**/*.spec.{ts,js,mjs,cjs,mts,cts}",
];
export interface JobFileSelection {
  dir?: string;
  include?: string[];
  exclude?: string[];
}

export function isJobSourceFile(
  file: string,
  config: JobFileSelection = {},
): boolean {
  return (
    micromatch.isMatch(file, config.include ?? JOB_INCLUDE) &&
    !micromatch.isMatch(file, [...JOB_IGNORE, ...(config.exclude ?? [])])
  );
}

export async function scanJobFiles(
  directory: string,
  config: JobFileSelection = {},
): Promise<string[]> {
  const files = await fg(config.include ?? JOB_INCLUDE, {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: [...JOB_IGNORE, ...(config.exclude ?? [])],
  });
  return files
    .filter((file) =>
      isJobSourceFile(
        path.relative(directory, file).split(path.sep).join("/"),
        config,
      ),
    )
    .sort((a, b) => a.localeCompare(b));
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
