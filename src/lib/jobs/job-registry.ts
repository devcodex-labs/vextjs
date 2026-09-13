import { VextJobDuplicateNameError } from "./job-errors.js";
import type { VextJobRegistry, VextLoadedJob } from "./types.js";

export function createJobRegistry(jobs: VextLoadedJob[]): VextJobRegistry {
  const byName = new Map<string, VextLoadedJob>();
  for (const job of jobs) {
    const previous = byName.get(job.name);
    if (previous) {
      throw new VextJobDuplicateNameError(
        `[vextjs] Duplicate job name "${job.name}".\n` +
          `         First: ${previous.sourceFile}#${previous.exportName}\n` +
          `         Second: ${job.sourceFile}#${job.exportName}\n` +
          `         Job names must be unique within one service root.`,
      );
    }
    byName.set(job.name, job);
  }
  const ordered = [...byName.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return {
    list() {
      return [...ordered];
    },
    get(name: string) {
      return byName.get(name);
    },
    has(name: string) {
      return byName.has(name);
    },
    toJSON() {
      return ordered.map((job) => ({
        name: job.name,
        sourceFile: job.sourcePath,
        exportName: job.exportName,
        description: job.definition.description,
        tags: job.definition.tags,
        timeout: job.definition.timeout,
        retry: job.definition.retry,
        concurrency: job.definition.concurrency,
        schedule: job.definition.schedule,
        queue: job.definition.queue,
        docs: job.definition.docs,
        hasPayloadSchema: !!job.definition.payload,
      }));
    },
  };
}
