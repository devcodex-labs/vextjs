import { randomUUID } from "node:crypto";
import type {
  VextJobClaimOptions,
  VextJobListRunsOptions,
  VextJobRunRecord,
  VextJobStore,
  VextJobStoreEnqueueInput,
} from "../types.js";

interface LeaseState {
  ownerId: string;
  expiresAt: string;
}

export interface CreateMemoryJobStoreOptions {
  now?: () => Date;
}

export function createMemoryJobStore(
  options: CreateMemoryJobStoreOptions = {},
): VextJobStore {
  const now = options.now ?? (() => new Date());
  const runs = new Map<string, VextJobRunRecord>();
  const workers = new Map<string, string>();
  let schedulerLease: LeaseState | undefined;

  return {
    type: "memory",
    async acquireSchedulerLease(ownerId, ttl, at = now()) {
      if (!schedulerLease || isExpired(schedulerLease.expiresAt, at)) {
        schedulerLease = lease(ownerId, ttl, at);
        return true;
      }
      if (schedulerLease.ownerId === ownerId) {
        schedulerLease = lease(ownerId, ttl, at);
        return true;
      }
      return false;
    },
    async renewSchedulerLease(ownerId, ttl, at = now()) {
      if (!schedulerLease || schedulerLease.ownerId !== ownerId) return false;
      schedulerLease = lease(ownerId, ttl, at);
      return true;
    },
    async releaseSchedulerLease(ownerId) {
      if (schedulerLease?.ownerId === ownerId) schedulerLease = undefined;
    },
    async enqueueRun(input) {
      const at = now().toISOString();
      const runAt = toIso(input.runAt ?? at);
      const existing = input.id ? runs.get(input.id) : undefined;
      if (existing) return existing;
      if (input.idempotencyKey) {
        const duplicate = [...runs.values()].find(
          (run) =>
            run.idempotencyKey === input.idempotencyKey &&
            run.jobName === input.jobName &&
            run.status !== "failed" &&
            run.status !== "cancelled",
        );
        if (duplicate) return duplicate;
      }
      const record: VextJobRunRecord = {
        id: input.id ?? randomUUID(),
        jobName: input.jobName,
        status: "queued",
        trigger: input.trigger,
        payload: input.payload,
        runAt,
        createdAt: at,
        updatedAt: at,
        scheduledAt: input.scheduledAt ? toIso(input.scheduledAt) : undefined,
        attempts: 0,
        priority: input.priority,
        idempotencyKey: input.idempotencyKey,
        source: input.source,
      };
      runs.set(record.id, record);
      return clone(record);
    },
    async claimNextRun(options) {
      const at = options.now ?? now();
      const record = [...runs.values()]
        .filter((run) => canClaim(run, options, at))
        .sort(compareRunPriority)[0];
      if (!record) return undefined;
      const updated = {
        ...record,
        status: "running" as const,
        startedAt: record.startedAt ?? at.toISOString(),
        updatedAt: at.toISOString(),
        leaseOwner: options.ownerId,
        leaseUntil: new Date(
          at.getTime() + (options.leaseTtl ?? 30000),
        ).toISOString(),
      };
      runs.set(updated.id, updated);
      return clone(updated);
    },
    async completeRun(runId, patch) {
      const previous = runs.get(runId);
      if (!previous) return;
      runs.set(runId, {
        ...previous,
        ...patch,
        leaseOwner: undefined,
        leaseUntil: undefined,
        updatedAt: patch.updatedAt ?? now().toISOString(),
      });
    },
    async getRun(runId) {
      const record = runs.get(runId);
      return record ? clone(record) : undefined;
    },
    async listRuns(options = {}) {
      return [...runs.values()]
        .filter((run) => matchesRunFilter(run, options))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, options.limit ?? 50)
        .map(clone);
    },
    async heartbeatWorker(ownerId, at = now()) {
      workers.set(ownerId, at.toISOString());
    },
  };
}

function lease(ownerId: string, ttl: number, now: Date): LeaseState {
  return {
    ownerId,
    expiresAt: new Date(now.getTime() + ttl).toISOString(),
  };
}

function canClaim(
  run: VextJobRunRecord,
  options: VextJobClaimOptions,
  now: Date,
): boolean {
  if (options.jobNames?.length && !options.jobNames.includes(run.jobName))
    return false;
  if (new Date(run.runAt).getTime() > now.getTime()) return false;
  if (run.status === "queued") return true;
  return (
    run.status === "running" &&
    run.leaseUntil !== undefined &&
    isExpired(run.leaseUntil, now)
  );
}

function compareRunPriority(a: VextJobRunRecord, b: VextJobRunRecord): number {
  return (
    (b.priority ?? 0) - (a.priority ?? 0) ||
    a.runAt.localeCompare(b.runAt) ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

function matchesRunFilter(
  run: VextJobRunRecord,
  options: VextJobListRunsOptions,
): boolean {
  if (options.jobName && run.jobName !== options.jobName) return false;
  if (options.status && run.status !== options.status) return false;
  return true;
}

function isExpired(expiresAt: string, now: Date): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
}

function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
