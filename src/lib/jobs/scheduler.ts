import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { VextJobRuntime } from "./job-runtime.js";
import { resolveJobDueTimes } from "./schedule.js";
import type { VextLoadedJob } from "./types.js";

export interface StartJobSchedulerOptions {
  ownerId?: string;
  signal?: AbortSignal;
  once?: boolean;
}

export async function startJobScheduler(
  runtime: VextJobRuntime,
  options: StartJobSchedulerOptions = {},
): Promise<void> {
  const ownerId = options.ownerId ?? `scheduler-${process.pid}-${randomUUID()}`;
  const config = runtime.config.jobs?.scheduler;
  const tickInterval = config?.tickInterval ?? 1000;
  const lease = config?.lease;
  const leaseEnabled = lease?.enabled !== false;
  const leaseTtl = lease?.ttl ?? 30000;
  const leaseRenewInterval = Math.min(
    lease?.renewInterval ?? Math.max(1000, Math.floor(leaseTtl / 2)),
    leaseTtl,
  );
  let hasLease = !leaseEnabled;
  let lastLeaseRenewedAt = 0;
  let previousTick = new Date(Date.now() - tickInterval);

  while (!options.signal?.aborted) {
    const now = new Date();
    if (leaseEnabled) {
      if (!hasLease) {
        hasLease = await runtime.store.acquireSchedulerLease(
          ownerId,
          leaseTtl,
          now,
        );
        if (hasLease) lastLeaseRenewedAt = now.getTime();
      } else if (now.getTime() - lastLeaseRenewedAt >= leaseRenewInterval) {
        hasLease = await runtime.store.renewSchedulerLease(
          ownerId,
          leaseTtl,
          now,
        );
        if (!hasLease) {
          hasLease = await runtime.store.acquireSchedulerLease(
            ownerId,
            leaseTtl,
            now,
          );
        }
        if (hasLease) lastLeaseRenewedAt = now.getTime();
      }
    }
    const allowed = !leaseEnabled || hasLease;
    if (allowed) {
      await tickJobScheduler(runtime, {
        ownerId,
        now,
        previousTick,
      });
      previousTick = now;
    }
    if (options.once) break;
    await delay(tickInterval, undefined, { signal: options.signal }).catch(
      () => undefined,
    );
  }
  if (leaseEnabled && hasLease)
    await runtime.store.releaseSchedulerLease(ownerId);
}

export interface TickJobSchedulerOptions {
  ownerId?: string;
  now?: Date;
  previousTick?: Date;
}

export async function tickJobScheduler(
  runtime: VextJobRuntime,
  options: TickJobSchedulerOptions = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const scheduler = runtime.config.jobs?.scheduler;
  const scheduledJobs = runtime.registry
    .list()
    .filter((job) => job.definition.schedule?.enabled !== false)
    .filter(
      (job) =>
        job.definition.schedule?.cron || job.definition.schedule?.interval,
    );
  let created = 0;
  for (const job of scheduledJobs) {
    const dueTimes = resolveJobDueTimes({
      schedule: job.definition.schedule!,
      now,
      previousTick: options.previousTick,
      defaultTimezone: scheduler?.timezone,
      defaultMisfirePolicy: scheduler?.misfirePolicy,
      defaultMaxCatchUp: scheduler?.maxCatchUp,
    });
    for (const dueTime of dueTimes) {
      await enqueueScheduledRun(runtime, job, dueTime, options.ownerId);
      created += 1;
    }
  }
  return created;
}

async function enqueueScheduledRun(
  runtime: VextJobRuntime,
  job: VextLoadedJob,
  dueTime: Date,
  ownerId: string | undefined,
): Promise<void> {
  const jitter =
    job.definition.schedule?.jitter ??
    runtime.config.jobs?.scheduler?.jitter ??
    0;
  const runAt =
    jitter > 0
      ? new Date(dueTime.getTime() + Math.floor(Math.random() * jitter))
      : dueTime;
  const runId = `schedule:${job.name}:${dueTime.toISOString()}`;
  const idempotencyKey = job.definition.schedule?.singleton
    ? `schedule:${job.name}:${dueTime.toISOString()}`
    : undefined;
  const record = await runtime.store.enqueueRun({
    id: runId,
    jobName: job.name,
    trigger: "schedule",
    runAt,
    scheduledAt: dueTime,
    idempotencyKey,
    priority: job.definition.queue?.priority,
    source: ownerId,
  });
  if ((runtime.config.jobs?.scheduler?.mode ?? "inline") === "inline") {
    await runtime.run(job.name, {
      runId: record.id,
      trigger: "schedule",
      scheduledAt: dueTime,
    });
  }
}
