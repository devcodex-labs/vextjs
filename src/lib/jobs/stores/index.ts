import type { VextJobsConfig, VextJobStore } from "../types.js";
import { createFileJobStore } from "./file-store.js";
import { createMemoryJobStore } from "./memory-store.js";
import { createRedisJobStore } from "./redis-store.js";
import { assertRedisTarget } from "../../redis/index.js";

export interface CreateJobStoreOptions {
  rootDir: string;
  config?: VextJobsConfig;
  configProfile?: string;
  runtimeMode?: string;
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
  if (type === "redis" || type === "auto") {
    const redisOptions = typeof store === "object" ? store : {};
    if (type === "auto") assertRedisTarget(redisOptions, "config.jobs.store");
    return createRedisJobStore({
      ...redisOptions,
      rootDir: options.rootDir,
      configProfile: options.configProfile,
      runtimeMode: options.runtimeMode,
    });
  }
  throw new Error(
    `[vextjs] Unsupported jobs.store.type "${type}". Use "memory", "file", "redis", "auto", or provide a custom store through the programmatic runtime API.`,
  );
}

export { createFileJobStore } from "./file-store.js";
export { createMemoryJobStore } from "./memory-store.js";
export {
  createRedisJobStore,
  type CreateRedisJobStoreOptions,
} from "./redis-store.js";
