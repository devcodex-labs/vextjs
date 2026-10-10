import type { VextApp } from "../../types/app.js";

export const VEXT_JOB_SYMBOL = Symbol.for("vextjs.job.definition");

export interface VextJobDocsConfig {
  summary?: string;
  description?: string;
  tags?: string[];
}

export interface VextJobContext {
  app: VextApp;
  name: string;
  /** The shared scheduled point, rather than the handler's actual start time. */
  scheduledAt: Date;
  signal: AbortSignal;
  logger: VextApp["logger"];
}

export type VextJobHandler = (
  ctx: VextJobContext,
) => unknown | Promise<unknown>;

interface JobDefinitionBase {
  name?: string;
  description?: string;
  tags?: string[];
  docs?: VextJobDocsConfig;
  enabled?: boolean;
  handler: VextJobHandler;
}

export type VextJobDefinitionInput = JobDefinitionBase &
  (
    | { cron: string; interval?: never; timezone?: string }
    | { interval: number; cron?: never; timezone?: never }
  );

export type VextJobDefinition = VextJobDefinitionInput & {
  readonly [VEXT_JOB_SYMBOL]: true;
};

export interface VextJobsConfig {
  enabled?: boolean;
  dir?: string;
  include?: string[];
  exclude?: string[];
  timezone?: string;
  /** Optional in one process; required for active tasks in built-in Cluster. */
  redis?: {
    url?: string;
    uri?: string;
    client?: unknown;
    /** Automatically generated from project name, profile and runtime mode. */
    namespace?: string;
    /** Optional full prefix override; takes precedence over namespace. */
    keyPrefix?: string;
    /** Running lease duration in milliseconds; minimum 1000, default 30000. */
    leaseTtl?: number;
  };
}

/** @internal Loader metadata; not a task queue or execution record. */
export interface VextLoadedJob {
  name: string;
  definition: VextJobDefinition;
  sourceFile: string;
  sourcePath: string;
  exportName: string;
}
