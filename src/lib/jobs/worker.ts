import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { VextJobRuntime } from "./job-runtime.js";
import type { VextLoadedJob } from "./types.js";

export interface StartJobWorkerOptions {
  ownerId?: string;
  signal?: AbortSignal;
  once?: boolean;
}

export async function startJobWorker(
  runtime: VextJobRuntime,
  options: StartJobWorkerOptions = {},
): Promise<void> {
  const ownerId = options.ownerId ?? `worker-${process.pid}-${randomUUID()}`;
  const worker = runtime.config.jobs?.worker;
  const concurrency = worker?.concurrency ?? 4;
  const pollInterval = worker?.pollInterval ?? 1000;
  const leaseTtl = worker?.lease?.ttl ?? 30000;
  const running = new Set<Promise<void>>();
  const runningByJob = new Map<string, number>();

  while (!options.signal?.aborted) {
    await runtime.store.heartbeatWorker(ownerId);
    while (running.size < concurrency) {
      const availableJobNames = getAvailableJobNames(runtime, runningByJob);
      if (availableJobNames.length === 0) break;
      const record = await runtime.store.claimNextRun({
        ownerId,
        leaseTtl,
        jobNames: availableJobNames,
      });
      if (!record) break;
      incrementRunningJob(runningByJob, record.jobName);
      const promise = executeClaimedRun(
        runtime,
        record.id,
        record.jobName,
      ).finally(() => {
        decrementRunningJob(runningByJob, record.jobName);
        running.delete(promise);
      });
      running.add(promise);
    }
    if (options.once) break;
    await delay(pollInterval, undefined, { signal: options.signal }).catch(
      () => undefined,
    );
  }

  if (running.size > 0) {
    await Promise.race([
      Promise.allSettled([...running]),
      delay(worker?.shutdownTimeout ?? 10000),
    ]);
  }
}

async function executeClaimedRun(
  runtime: VextJobRuntime,
  runId: string,
  jobName: string,
): Promise<void> {
  const record = await runtime.store.getRun(runId);
  await runtime.run(jobName, {
    runId,
    payload: record?.payload,
    trigger: record?.trigger,
    scheduledAt: record?.scheduledAt,
  });
}

function getAvailableJobNames(
  runtime: VextJobRuntime,
  runningByJob: Map<string, number>,
): string[] {
  return runtime.registry
    .list()
    .filter((job) => {
      const limit = resolveJobConcurrency(runtime, job);
      return (runningByJob.get(job.name) ?? 0) < limit;
    })
    .map((job) => job.name);
}

function resolveJobConcurrency(
  runtime: VextJobRuntime,
  job: VextLoadedJob,
): number {
  return Math.max(
    1,
    job.definition.concurrency ??
      runtime.config.jobs?.defaults?.concurrency ??
      1,
  );
}

function incrementRunningJob(
  runningByJob: Map<string, number>,
  jobName: string,
): void {
  runningByJob.set(jobName, (runningByJob.get(jobName) ?? 0) + 1);
}

function decrementRunningJob(
  runningByJob: Map<string, number>,
  jobName: string,
): void {
  const next = (runningByJob.get(jobName) ?? 1) - 1;
  if (next <= 0) {
    runningByJob.delete(jobName);
    return;
  }
  runningByJob.set(jobName, next);
}
