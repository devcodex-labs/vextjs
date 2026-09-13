import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { VextJobRuntime } from "./job-runtime.js";

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

  while (!options.signal?.aborted) {
    await runtime.store.heartbeatWorker(ownerId);
    while (running.size < concurrency) {
      const record = await runtime.store.claimNextRun({
        ownerId,
        leaseTtl,
      });
      if (!record) break;
      const promise = executeClaimedRun(
        runtime,
        record.id,
        record.jobName,
      ).finally(() => running.delete(promise));
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
