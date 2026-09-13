import type { VextJobsConfig, VextJobStore } from "../types.js";
import { createFileJobStore } from "./file-store.js";
import { createMemoryJobStore } from "./memory-store.js";

export interface CreateJobStoreOptions {
  rootDir: string;
  config?: VextJobsConfig;
}

export function createJobStore(options: CreateJobStoreOptions): VextJobStore {
  const store = options.config?.store;
  const type = typeof store === "string" ? store : (store?.type ?? "file");
  if (type === "memory") return createMemoryJobStore();
  if (type === "file") {
    return createFileJobStore({
      rootDir: options.rootDir,
      dir: typeof store === "object" ? store.dir : undefined,
    });
  }
  throw new Error(
    `[vextjs] Unsupported jobs.store.type "${type}". Use "memory", "file", or provide a custom store through the programmatic runtime API.`,
  );
}

export { createFileJobStore } from "./file-store.js";
export { createMemoryJobStore } from "./memory-store.js";
