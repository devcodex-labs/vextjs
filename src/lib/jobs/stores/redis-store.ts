import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import type {
  VextJobClaimOptions,
  VextJobClaimRunOptions,
  VextJobListRunsOptions,
  VextJobRunRecord,
  VextJobStore,
  VextJobStoreEnqueueInput,
} from "../types.js";
import {
  assertRedisTarget,
  resolveRedisUrl,
  resolveVextRedisKeyPrefix,
  type VextRedisTargetConfig,
} from "../../redis/index.js";

interface RedisLike {
  ping(): Promise<string>;
  get(key: string): Promise<string | null>;
  set(...args: unknown[]): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<number>;
  hdel(key: string, field: string): Promise<number>;
  hvals(key: string): Promise<string[]>;
  zadd(key: string, score: number, member: string): Promise<number>;
  zrem(key: string, ...members: string[]): Promise<number>;
  zrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
    ...args: unknown[]
  ): Promise<string[]>;
  eval(script: string, numKeys: number, ...args: unknown[]): Promise<unknown>;
  quit?(): Promise<unknown>;
  disconnect?(): void;
}

export interface CreateRedisJobStoreOptions extends VextRedisTargetConfig {
  rootDir?: string;
  configProfile?: string;
  runtimeMode?: string;
  now?: () => Date;
}

const DEFAULT_LEASE_TTL = 30_000;
const CLAIM_SCAN_LIMIT = 200;

export function createRedisJobStore(
  options: CreateRedisJobStoreOptions = {},
): VextJobStore {
  const now = options.now ?? (() => new Date());
  const prefix = resolveVextRedisKeyPrefix({
    rootDir: options.rootDir,
    module: "job",
    namespace: options.namespace,
    keyPrefix: options.keyPrefix,
    configProfile: options.configProfile,
    runtimeMode: options.runtimeMode,
  });
  const redis =
    (options.client as RedisLike | undefined) ?? createOwnedClient(options);
  const ownsClient = !options.client;
  const keys = {
    schedulerLease: `${prefix}scheduler:lease`,
    workers: `${prefix}workers`,
    runs: `${prefix}runs`,
    queue: `${prefix}queue`,
    running: `${prefix}running`,
    idem: (jobName: string, idempotencyKey: string) =>
      `${prefix}idem:${encodePart(jobName)}:${encodePart(idempotencyKey)}`,
  };

  return {
    type: "redis",
    async init() {
      await redis.ping();
    },
    async close() {
      if (!ownsClient) return;
      if (redis.quit) {
        await redis.quit();
        return;
      }
      redis.disconnect?.();
    },
    async acquireSchedulerLease(ownerId, ttl, at = now()) {
      const result = await redis.eval(
        ACQUIRE_SCHEDULER_LEASE_SCRIPT,
        1,
        keys.schedulerLease,
        ownerId,
        at.toISOString(),
        JSON.stringify({
          ownerId,
          expiresAt: new Date(at.getTime() + ttl).toISOString(),
        }),
        ttl,
      );
      return result === 1;
    },
    async renewSchedulerLease(ownerId, ttl, at = now()) {
      const result = await redis.eval(
        RENEW_SCHEDULER_LEASE_SCRIPT,
        1,
        keys.schedulerLease,
        ownerId,
        JSON.stringify({
          ownerId,
          expiresAt: new Date(at.getTime() + ttl).toISOString(),
        }),
        ttl,
      );
      return result === 1;
    },
    async releaseSchedulerLease(ownerId) {
      await redis.eval(
        RELEASE_SCHEDULER_LEASE_SCRIPT,
        1,
        keys.schedulerLease,
        ownerId,
      );
    },
    async enqueueRun(input) {
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
      const idempotencyKey = input.idempotencyKey
        ? keys.idem(input.jobName, input.idempotencyKey)
        : undefined;
      const result = await redis.eval(
        ENQUEUE_RUN_SCRIPT,
        idempotencyKey ? 4 : 3,
        keys.runs,
        keys.queue,
        keys.running,
        ...(idempotencyKey ? [idempotencyKey] : []),
        record.id,
        JSON.stringify(record),
        new Date(record.runAt).getTime(),
        idempotencyKey ? "1" : "0",
      );
      return parseRun(result)!;
    },
    async claimNextRun(options) {
      const at = options.now ?? now();
      const result = await redis.eval(
        CLAIM_NEXT_RUN_SCRIPT,
        3,
        keys.queue,
        keys.running,
        keys.runs,
        at.getTime(),
        at.toISOString(),
        new Date(
          at.getTime() + (options.leaseTtl ?? DEFAULT_LEASE_TTL),
        ).toISOString(),
        options.ownerId,
        options.leaseTtl ?? DEFAULT_LEASE_TTL,
        JSON.stringify(options.jobNames ?? []),
        CLAIM_SCAN_LIMIT,
      );
      return parseRun(result);
    },
    async claimRun(runId, options) {
      const at = options.now ?? now();
      const result = await redis.eval(
        CLAIM_RUN_SCRIPT,
        3,
        keys.queue,
        keys.running,
        keys.runs,
        runId,
        at.getTime(),
        at.toISOString(),
        new Date(
          at.getTime() + (options.leaseTtl ?? DEFAULT_LEASE_TTL),
        ).toISOString(),
        options.ownerId,
        options.leaseTtl ?? DEFAULT_LEASE_TTL,
      );
      return parseRun(result);
    },
    async renewRunLease(runId, ownerId, leaseTtl, at = now()) {
      const result = await redis.eval(
        RENEW_RUN_LEASE_SCRIPT,
        2,
        keys.running,
        keys.runs,
        runId,
        ownerId,
        at.getTime(),
        at.toISOString(),
        new Date(at.getTime() + leaseTtl).toISOString(),
        leaseTtl,
      );
      return result === 1;
    },
    async completeRun(runId, patch, options) {
      const result = await redis.eval(
        COMPLETE_RUN_SCRIPT,
        3,
        keys.queue,
        keys.running,
        keys.runs,
        runId,
        options?.ownerId ?? "",
        JSON.stringify({
          ...patch,
          updatedAt: patch.updatedAt ?? now().toISOString(),
        }),
      );
      return result === 1;
    },
    async getRun(runId) {
      return getRun(redis, keys.runs, runId);
    },
    async listRuns(options = {}) {
      const values = await redis.hvals(keys.runs);
      return values
        .map((value) => JSON.parse(value) as VextJobRunRecord)
        .filter((run) => matchesRunFilter(run, options))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, options.limit ?? 50)
        .map(clone);
    },
    async heartbeatWorker(ownerId, at = now()) {
      await redis.hset(keys.workers, ownerId, at.toISOString());
    },
  };
}

function createOwnedClient(options: CreateRedisJobStoreOptions): RedisLike {
  assertRedisTarget(options, "config.jobs.store");
  return new Redis(resolveRedisUrl(options)!);
}

async function getRun(
  redis: RedisLike,
  runsKey: string,
  runId: string,
): Promise<VextJobRunRecord | undefined> {
  const value = await redis.hget(runsKey, runId);
  return value ? (JSON.parse(value) as VextJobRunRecord) : undefined;
}

function parseRun(value: unknown): VextJobRunRecord | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return JSON.parse(value) as VextJobRunRecord;
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

function encodePart(value: string): string {
  return encodeURIComponent(value);
}

const ACQUIRE_SCHEDULER_LEASE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if raw then
  local lease = cjson.decode(raw)
  if lease.ownerId ~= ARGV[1] and lease.expiresAt > ARGV[2] then return 0 end
end
redis.call('SET', KEYS[1], ARGV[3], 'PX', tonumber(ARGV[4]))
return 1
`;

const ENQUEUE_RUN_SCRIPT = `
local runsKey = KEYS[1]
local queueKey = KEYS[2]
local runningKey = KEYS[3]
local runId = ARGV[1]
local recordJson = ARGV[2]
local runAtMs = tonumber(ARGV[3])
local hasIdempotency = ARGV[4] == '1'
local existingById = redis.call('HGET', runsKey, runId)
if existingById then return existingById end
if hasIdempotency then
  local idempotencyKey = KEYS[4]
  local duplicateId = redis.call('GET', idempotencyKey)
  if duplicateId then
    local duplicate = redis.call('HGET', runsKey, duplicateId)
    if duplicate then
      local duplicateRecord = cjson.decode(duplicate)
      if duplicateRecord.status ~= 'failed' and duplicateRecord.status ~= 'cancelled' then
        return duplicate
      end
    end
  end
end
redis.call('HSET', runsKey, runId, recordJson)
redis.call('ZREM', runningKey, runId)
redis.call('ZADD', queueKey, runAtMs, runId)
if hasIdempotency then redis.call('SET', KEYS[4], runId) end
return recordJson
`;

const RELEASE_SCHEDULER_LEASE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local lease = cjson.decode(raw)
if lease.ownerId ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
return 1
`;

const RENEW_SCHEDULER_LEASE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local lease = cjson.decode(raw)
if lease.ownerId ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', tonumber(ARGV[3]))
return 1
`;

const CLAIM_NEXT_RUN_SCRIPT = `
local queueKey = KEYS[1]
local runningKey = KEYS[2]
local runsKey = KEYS[3]
local nowMs = tonumber(ARGV[1])
local nowIso = ARGV[2]
local leaseUntilIso = ARGV[3]
local ownerId = ARGV[4]
local leaseTtl = tonumber(ARGV[5])
local jobNames = cjson.decode(ARGV[6])
local limit = tonumber(ARGV[7])
local allowed = {}
for _, name in ipairs(jobNames) do allowed[name] = true end
local function allowedJob(name)
  return #jobNames == 0 or allowed[name] == true
end
local ids = redis.call('ZRANGEBYSCORE', queueKey, '-inf', nowMs, 'LIMIT', 0, limit)
local expired = redis.call('ZRANGEBYSCORE', runningKey, '-inf', nowMs, 'LIMIT', 0, limit)
for _, id in ipairs(expired) do table.insert(ids, id) end
local selected
local selectedRecord
for _, id in ipairs(ids) do
  local raw = redis.call('HGET', runsKey, id)
  if raw then
    local record = cjson.decode(raw)
    local isQueued = record.status == 'queued'
    local isExpired = record.status == 'running' and record.leaseUntil ~= nil and record.leaseUntil <= nowIso
    if allowedJob(record.jobName) and (isQueued or isExpired) then
      if not selectedRecord
        or (record.priority or 0) > (selectedRecord.priority or 0)
        or ((record.priority or 0) == (selectedRecord.priority or 0) and record.runAt < selectedRecord.runAt)
        or ((record.priority or 0) == (selectedRecord.priority or 0) and record.runAt == selectedRecord.runAt and record.createdAt < selectedRecord.createdAt) then
        selected = id
        selectedRecord = record
      end
    end
  end
end
if not selectedRecord then return '' end
selectedRecord.status = 'running'
if selectedRecord.startedAt == nil then selectedRecord.startedAt = nowIso end
selectedRecord.updatedAt = nowIso
selectedRecord.leaseOwner = ownerId
local leaseUntilMs = nowMs + leaseTtl
selectedRecord.leaseUntil = leaseUntilIso
redis.call('HSET', runsKey, selected, cjson.encode(selectedRecord))
redis.call('ZREM', queueKey, selected)
redis.call('ZADD', runningKey, leaseUntilMs, selected)
return cjson.encode(selectedRecord)
`;

const CLAIM_RUN_SCRIPT = `
local queueKey = KEYS[1]
local runningKey = KEYS[2]
local runsKey = KEYS[3]
local runId = ARGV[1]
local nowMs = tonumber(ARGV[2])
local nowIso = ARGV[3]
local leaseUntilIso = ARGV[4]
local ownerId = ARGV[5]
local leaseTtl = tonumber(ARGV[6])
local raw = redis.call('HGET', runsKey, runId)
if not raw then return '' end
local record = cjson.decode(raw)
local isQueued = record.status == 'queued'
local isOwnRunning = record.status == 'running' and record.leaseOwner == ownerId
local isExpired = record.status == 'running' and record.leaseUntil ~= nil and record.leaseUntil <= nowIso
if not (isQueued or isOwnRunning or isExpired) then return '' end
record.status = 'running'
if record.startedAt == nil then record.startedAt = nowIso end
record.updatedAt = nowIso
record.leaseOwner = ownerId
record.leaseUntil = leaseUntilIso
redis.call('HSET', runsKey, runId, cjson.encode(record))
redis.call('ZREM', queueKey, runId)
redis.call('ZADD', runningKey, nowMs + leaseTtl, runId)
return cjson.encode(record)
`;

const RENEW_RUN_LEASE_SCRIPT = `
local runningKey = KEYS[1]
local runsKey = KEYS[2]
local runId = ARGV[1]
local ownerId = ARGV[2]
local nowMs = tonumber(ARGV[3])
local nowIso = ARGV[4]
local leaseUntilIso = ARGV[5]
local leaseTtl = tonumber(ARGV[6])
local raw = redis.call('HGET', runsKey, runId)
if not raw then return 0 end
local record = cjson.decode(raw)
if record.status ~= 'running' or record.leaseOwner ~= ownerId then return 0 end
record.leaseUntil = leaseUntilIso
record.updatedAt = nowIso
redis.call('HSET', runsKey, runId, cjson.encode(record))
redis.call('ZADD', runningKey, nowMs + leaseTtl, runId)
return 1
`;

const COMPLETE_RUN_SCRIPT = `
local queueKey = KEYS[1]
local runningKey = KEYS[2]
local runsKey = KEYS[3]
local runId = ARGV[1]
local ownerId = ARGV[2]
local patch = cjson.decode(ARGV[3])
local raw = redis.call('HGET', runsKey, runId)
if not raw then return 0 end
local record = cjson.decode(raw)
if record.leaseOwner ~= nil and record.leaseOwner ~= ownerId then return 0 end
for key, value in pairs(patch) do
  if value ~= cjson.null then record[key] = value end
end
record.leaseOwner = nil
record.leaseUntil = nil
redis.call('HSET', runsKey, runId, cjson.encode(record))
redis.call('ZREM', queueKey, runId)
redis.call('ZREM', runningKey, runId)
return 1
`;
