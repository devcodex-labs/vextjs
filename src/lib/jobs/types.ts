import type { VextApp } from "../../types/app.js";

export const VEXT_JOB_SYMBOL = Symbol.for("vextjs.job.definition");

export type VextJobRetryStrategy =
  | false
  | {
      attempts?: number;
      delay?: number | ((attempt: number, error: unknown) => number);
      backoff?: "fixed" | "exponential";
    };

export type VextJobMisfirePolicy = "skip" | "fire-once" | "catch-up";

export interface VextJobScheduleConfig {
  enabled?: boolean;
  cron?: string;
  interval?: number;
  timezone?: string;
  startAt?: string | Date;
  endAt?: string | Date;
  misfirePolicy?: VextJobMisfirePolicy;
  maxCatchUp?: number;
  jitter?: number;
  singleton?: boolean;
}

export interface VextJobQueueConfig {
  enabled?: boolean;
  priority?: number;
}

export type VextJobIdempotencyKeyFactory<TPayload = unknown> = (ctx: {
  payload: TPayload;
  jobName: string;
}) => string | undefined | null;

export interface VextJobDocsConfig {
  summary?: string;
  description?: string;
  tags?: string[];
}

export interface VextJobContext<TPayload = unknown> {
  app: VextApp;
  job: VextJobDefinition<TPayload, unknown>;
  payload: TPayload;
  signal: AbortSignal;
  attempt: number;
  runId: string;
  logger: VextApp["logger"];
}

export type VextJobHandler<TPayload = unknown, TResult = unknown> = (
  ctx: VextJobContext<TPayload>,
) => TResult | Promise<TResult>;

export interface VextJobDefinition<TPayload = unknown, TResult = unknown> {
  readonly [VEXT_JOB_SYMBOL]: true;
  name?: string;
  description?: string;
  tags?: string[];
  docs?: VextJobDocsConfig;
  payload?: Record<string, unknown>;
  schedule?: VextJobScheduleConfig;
  queue?: VextJobQueueConfig;
  timeout?: number;
  retry?: VextJobRetryStrategy;
  concurrency?: number;
  idempotencyKey?: string | VextJobIdempotencyKeyFactory<TPayload>;
  handler: VextJobHandler<TPayload, TResult>;
}

export interface VextJobDefinitionInput<
  TPayload = unknown,
  TResult = unknown,
> extends Omit<VextJobDefinition<TPayload, TResult>, typeof VEXT_JOB_SYMBOL> {}

export interface VextJobsConfig {
  enabled?: boolean;
  dir?: string;
  include?: string[];
  exclude?: string[];
  runner?: "inline" | "memory" | "file" | string;
  store?:
    | "memory"
    | "file"
    | {
        type?: "memory" | "file" | string;
        dir?: string;
      };
  scheduler?: {
    enabled?: boolean;
    mode?: "inline" | "enqueue";
    tickInterval?: number;
    timezone?: string;
    misfirePolicy?: VextJobMisfirePolicy;
    maxCatchUp?: number;
    jitter?: number;
    lease?: {
      enabled?: boolean;
      ttl?: number;
      renewInterval?: number;
    };
  };
  worker?: {
    enabled?: boolean;
    concurrency?: number;
    shutdownTimeout?: number;
    pollInterval?: number;
    heartbeatInterval?: number;
    lease?: {
      ttl?: number;
    };
  };
  defaults?: {
    timeout?: number;
    retry?: VextJobRetryStrategy;
    concurrency?: number;
  };
}

export interface VextLoadedJob<TPayload = unknown, TResult = unknown> {
  name: string;
  definition: VextJobDefinition<TPayload, TResult>;
  sourceFile: string;
  sourcePath: string;
  exportName: string;
}

export type VextJobStatus = "success" | "failed" | "cancelled" | "timeout";

export type VextJobRunRecordStatus = "queued" | "running" | VextJobStatus;

export type VextJobTriggerType = "manual" | "schedule" | "enqueue";

export interface VextJobRunRecord {
  id: string;
  jobName: string;
  status: VextJobRunRecordStatus;
  trigger: VextJobTriggerType;
  payload?: unknown;
  runAt: string;
  createdAt: string;
  updatedAt: string;
  scheduledAt?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  attempts: number;
  priority?: number;
  result?: unknown;
  error?: string;
  leaseOwner?: string;
  leaseUntil?: string;
  idempotencyKey?: string;
  source?: string;
}

export interface VextJobRunOptions {
  payload?: unknown;
  signal?: AbortSignal;
  runId?: string;
  trigger?: VextJobTriggerType;
  scheduledAt?: Date | string;
  idempotencyKey?: string;
  store?: VextJobStore;
}

export interface VextJobRunResult<TResult = unknown> {
  jobName: string;
  runId: string;
  status: VextJobStatus;
  attempts: number;
  durationMs: number;
  result?: TResult;
  error?: unknown;
}

export interface VextJobRunnerAdapter {
  name: string;
  start(runtime: VextJobWorkerRuntime): Promise<void> | void;
  stop?(): Promise<void> | void;
  enqueue?(
    jobName: string,
    payload: unknown,
    options?: VextJobRunOptions,
  ): Promise<VextJobRunResult> | VextJobRunResult;
}

export interface VextJobWorkerRuntime {
  app: VextApp;
  registry: VextJobRegistry;
  store: VextJobStore;
  run(jobName: string, options?: VextJobRunOptions): Promise<VextJobRunResult>;
  close(): Promise<void>;
  signal: AbortSignal;
}

export interface VextJobStoreEnqueueInput {
  id?: string;
  jobName: string;
  payload?: unknown;
  trigger: VextJobTriggerType;
  runAt?: Date | string;
  scheduledAt?: Date | string;
  priority?: number;
  idempotencyKey?: string;
  source?: string;
}

export interface VextJobClaimOptions {
  ownerId: string;
  now?: Date;
  leaseTtl?: number;
  jobNames?: string[];
}

export interface VextJobListRunsOptions {
  jobName?: string;
  status?: VextJobRunRecordStatus;
  limit?: number;
}

export interface VextJobStore {
  readonly type: string;
  init?(): Promise<void> | void;
  close?(): Promise<void> | void;
  acquireSchedulerLease(
    ownerId: string,
    ttl: number,
    now?: Date,
  ): Promise<boolean>;
  renewSchedulerLease(
    ownerId: string,
    ttl: number,
    now?: Date,
  ): Promise<boolean>;
  releaseSchedulerLease(ownerId: string): Promise<void>;
  enqueueRun(input: VextJobStoreEnqueueInput): Promise<VextJobRunRecord>;
  claimNextRun(
    options: VextJobClaimOptions,
  ): Promise<VextJobRunRecord | undefined>;
  completeRun(
    runId: string,
    patch: Partial<
      Pick<
        VextJobRunRecord,
        | "status"
        | "attempts"
        | "durationMs"
        | "finishedAt"
        | "result"
        | "error"
        | "updatedAt"
      >
    >,
  ): Promise<void>;
  getRun(runId: string): Promise<VextJobRunRecord | undefined>;
  listRuns(options?: VextJobListRunsOptions): Promise<VextJobRunRecord[]>;
  heartbeatWorker(ownerId: string, now?: Date): Promise<void>;
}

export interface VextJobRegistry {
  list(): VextLoadedJob[];
  get(name: string): VextLoadedJob | undefined;
  has(name: string): boolean;
  toJSON(): Array<{
    name: string;
    sourceFile: string;
    exportName: string;
    description?: string;
    tags?: string[];
    timeout?: number;
    retry?: VextJobRetryStrategy;
    concurrency?: number;
    schedule?: VextJobScheduleConfig;
    queue?: VextJobQueueConfig;
    docs?: VextJobDocsConfig;
    hasPayloadSchema: boolean;
  }>;
}
