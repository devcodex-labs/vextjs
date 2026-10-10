import { VextJobDuplicateNameError } from "./job-errors.js";
import type { VextLoadedJob } from "./types.js";

/** Validate every discovered definition, including disabled ones. */
export function assertUniqueJobNames(jobs: VextLoadedJob[]): void {
  const names = new Map<string, VextLoadedJob>();
  for (const job of jobs) {
    const previous = names.get(job.name);
    if (previous)
      throw new VextJobDuplicateNameError(
        `[vextjs] Duplicate job name "${job.name}": ${previous.sourceFile}#${previous.exportName} and ${job.sourceFile}#${job.exportName}.`,
      );
    names.set(job.name, job);
  }
}
