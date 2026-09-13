import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type {
  VextJobClaimOptions,
  VextJobListRunsOptions,
  VextJobRunRecord,
  VextJobStore,
} from "../types.js";

interface FileJobStoreState {
  schedulerLease?: {
    ownerId: string;
    expiresAt: string;
  };
  workers: Record<string, string>;
  runs: VextJobRunRecord[];
}

export interface CreateFileJobStoreOptions {
  rootDir: string;
  dir?: string;
  now?: () => Date;
}

const EMPTY_STATE: FileJobStoreState = {
  workers: {},
  runs: [],
};
const LOCK_STALE_MS = 30_000;

export function createFileJobStore(
  options: CreateFileJobStoreOptions,
): VextJobStore {
  const now = options.now ?? (() => new Date());
  const storeDir = path.resolve(options.rootDir, options.dir ?? ".vext/jobs");
  const stateFile = path.join(storeDir, "state.json");
  const lockDir = path.join(storeDir, ".lock");

  return {
    type: "file",
    async init() {
      await mkdir(storeDir, { recursive: true });
      await withLock(lockDir, async () => {
        const state = await readState(stateFile);
        await writeState(stateFile, state);
      });
    },
    async close() {
      return undefined;
    },
    async acquireSchedulerLease(ownerId, ttl, at = now()) {
      return withLock(lockDir, async () => {
        const state = await readState(stateFile);
        const current = state.schedulerLease;
        if (
          !current ||
          new Date(current.expiresAt).getTime() <= at.getTime() ||
          current.ownerId === ownerId
        ) {
          state.schedulerLease = {
            ownerId,
            expiresAt: new Date(at.getTime() + ttl).toISOString(),
          };
          await writeState(stateFile, state);
          return true;
        }
        return false;
      });
    },
    async renewSchedulerLease(ownerId, ttl, at = now()) {
      return withLock(lockDir, async () => {
        const state = await readState(stateFile);
        if (state.schedulerLease?.ownerId !== ownerId) return false;
        state.schedulerLease = {
          ownerId,
          expiresAt: new Date(at.getTime() + ttl).toISOString(),
        };
        await writeState(stateFile, state);
        return true;
      });
    },
    async releaseSchedulerLease(ownerId) {
      await withLock(lockDir, async () => {
        const state = await readState(stateFile);
        if (state.schedulerLease?.ownerId === ownerId) {
          state.schedulerLease = undefined;
          await writeState(stateFile, state);
        }
      });
    },
    async enqueueRun(input) {
      return withLock(lockDir, async () => {
        const state = await readState(stateFile);
        const existing = input.id
          ? state.runs.find((run) => run.id === input.id)
          : undefined;
        if (existing) return clone(existing);
        if (input.idempotencyKey) {
          const duplicate = state.runs.find(
            (run) =>
              run.idempotencyKey === input.idempotencyKey &&
              run.jobName === input.jobName &&
              run.status !== "failed" &&
              run.status !== "cancelled",
          );
          if (duplicate) return clone(duplicate);
        }
        const at = now().toISOString();
        const record: VextJobRunRecord = {
          id: input.id ?? randomUUID(),
          jobName: input.jobName,
          status: "queued",
          trigger: input.trigger,
          payload: input.payload,
          runAt: toIso(input.runAt ?? at),
          createdAt: at,
          updatedAt: at,
          scheduledAt: input.scheduledAt ? toIso(input.scheduledAt) : undefined,
          attempts: 0,
          priority: input.priority,
          idempotencyKey: input.idempotencyKey,
          source: input.source,
        };
        state.runs.push(record);
        await writeState(stateFile, state);
        return clone(record);
      });
    },
    async claimNextRun(options) {
      return withLock(lockDir, async () => {
        const state = await readState(stateFile);
        const at = options.now ?? now();
        const record = state.runs
          .filter((run) => canClaim(run, options, at))
          .sort(compareRunPriority)[0];
        if (!record) return undefined;
        record.status = "running";
        record.startedAt ??= at.toISOString();
        record.updatedAt = at.toISOString();
        record.leaseOwner = options.ownerId;
        record.leaseUntil = new Date(
          at.getTime() + (options.leaseTtl ?? 30000),
        ).toISOString();
        await writeState(stateFile, state);
        return clone(record);
      });
    },
    async claimRun(runId, options) {
      const at = options.now ?? now();
      return withLock(lockDir, async () => {
        const state = await readState(stateFile);
        const record = state.runs.find((run) => run.id === runId);
        if (
          !record ||
          !canClaim(record, { ...options, jobNames: undefined }, at)
        ) {
          return undefined;
        }
        record.status = "running";
        record.startedAt ??= at.toISOString();
        record.updatedAt = at.toISOString();
        record.leaseOwner = options.ownerId;
        record.leaseUntil = new Date(
          at.getTime() + (options.leaseTtl ?? 30000),
        ).toISOString();
        await writeState(stateFile, state);
        return clone(record);
      });
    },
    async renewRunLease(runId, ownerId, leaseTtl, at = now()) {
      return withLock(lockDir, async () => {
        const state = await readState(stateFile);
        const record = state.runs.find((run) => run.id === runId);
        if (
          !record ||
          record.status !== "running" ||
          record.leaseOwner !== ownerId
        ) {
          return false;
        }
        record.leaseUntil = new Date(at.getTime() + leaseTtl).toISOString();
        record.updatedAt = at.toISOString();
        await writeState(stateFile, state);
        return true;
      });
    },
    async completeRun(runId, patch, options) {
      return withLock(lockDir, async () => {
        const state = await readState(stateFile);
        const record = state.runs.find((run) => run.id === runId);
        if (!record) return false;
        if (record.leaseOwner && record.leaseOwner !== options?.ownerId)
          return false;
        Object.assign(record, patch);
        record.leaseOwner = undefined;
        record.leaseUntil = undefined;
        record.updatedAt = patch.updatedAt ?? now().toISOString();
        await writeState(stateFile, state);
        return true;
      });
    },
    async getRun(runId) {
      const state = await readState(stateFile);
      const record = state.runs.find((run) => run.id === runId);
      return record ? clone(record) : undefined;
    },
    async listRuns(options = {}) {
      const state = await readState(stateFile);
      return state.runs
        .filter((run) => matchesRunFilter(run, options))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, options.limit ?? 50)
        .map(clone);
    },
    async heartbeatWorker(ownerId, at = now()) {
      await withLock(lockDir, async () => {
        const state = await readState(stateFile);
        state.workers[ownerId] = at.toISOString();
        await writeState(stateFile, state);
      });
    },
  };
}

async function withLock<T>(lockDir: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(path.dirname(lockDir), { recursive: true });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await mkdir(lockDir);
      try {
        return await fn();
      } finally {
        await rm(lockDir, { recursive: true, force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await removeStaleLock(lockDir);
      await delay(10);
    }
  }
  throw new Error("[vextjs] Timed out waiting for job store lock.");
}

async function removeStaleLock(lockDir: string): Promise<void> {
  try {
    const metadata = await stat(lockDir);
    if (Date.now() - metadata.mtimeMs > LOCK_STALE_MS) {
      await rm(lockDir, { recursive: true, force: true });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function readState(stateFile: string): Promise<FileJobStoreState> {
  try {
    const parsed = JSON.parse(
      await readFile(stateFile, "utf8"),
    ) as Partial<FileJobStoreState>;
    return {
      schedulerLease: parsed.schedulerLease,
      workers: parsed.workers ?? {},
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return clone(EMPTY_STATE);
    throw error;
  }
}

async function writeState(
  stateFile: string,
  state: FileJobStoreState,
): Promise<void> {
  await mkdir(path.dirname(stateFile), { recursive: true });
  const tmp = `${stateFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tmp, stateFile);
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
    new Date(run.leaseUntil).getTime() <= now.getTime()
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

function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
