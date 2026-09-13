import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { defineJob } from "../../../src/lib/jobs/define-job.js";
import { loadJobs } from "../../../src/lib/jobs/job-loader.js";
import { createJobRegistry } from "../../../src/lib/jobs/job-registry.js";
import { VextJobDuplicateNameError } from "../../../src/lib/jobs/job-errors.js";
import { resolveJobDueTimes } from "../../../src/lib/jobs/schedule.js";
import { tickJobScheduler } from "../../../src/lib/jobs/scheduler.js";
import { createMemoryJobStore } from "../../../src/lib/jobs/stores/index.js";
import { startJobWorker } from "../../../src/lib/jobs/worker.js";
import type { VextJobRuntime } from "../../../src/lib/jobs/job-runtime.js";
import type {
  VextJobRunOptions,
  VextJobRunResult,
  VextJobStore,
} from "../../../src/lib/jobs/types.js";
import { createTestJobRunner } from "../../../src/testing/index.js";

let rootDir: string | undefined;

afterEach(async () => {
  if (rootDir) await rm(rootDir, { recursive: true, force: true });
  rootDir = undefined;
});

describe("Job framework", () => {
  it("runs a defined job through the testing helper", async () => {
    const runner = await createTestJobRunner({
      services: false,
      jobs: {
        "math.add": defineJob<{ a: number; b: number }, number>({
          handler: ({ payload }) => payload.a + payload.b,
        }),
      },
    });

    try {
      const result = await runner.run("math.add", { payload: { a: 2, b: 3 } });
      expect(result.status).toBe("success");
      expect(result.result).toBe(5);
    } finally {
      await runner.close();
    }
  });

  it("loads job files without affecting HTTP bootstrap", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "vext-jobs-"));
    const srcDir = join(rootDir, "src");
    await mkdir(join(srcDir, "jobs", "billing"), { recursive: true });
    const defineJobImport = pathToFileURL(
      join(process.cwd(), "src", "lib", "jobs", "define-job.ts"),
    ).href;
    await writeFile(
      join(srcDir, "jobs", "billing", "close.ts"),
      `import { defineJob } from ${JSON.stringify(defineJobImport)}; export default defineJob({ description: "Close invoices", handler: async () => "ok" });`,
    );

    const jobs = await loadJobs({ rootDir, srcDir });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      name: "billing.close",
      sourcePath: "billing/close.ts",
      exportName: "default",
    });
  });

  it("fails fast on duplicate job names", () => {
    const job = defineJob({ name: "dup", handler: () => undefined });
    expect(() =>
      createJobRegistry([
        {
          name: "dup",
          definition: job,
          sourceFile: "a.ts",
          sourcePath: "a.ts",
          exportName: "default",
        },
        {
          name: "dup",
          definition: job,
          sourceFile: "b.ts",
          sourcePath: "b.ts",
          exportName: "default",
        },
      ]),
    ).toThrow(VextJobDuplicateNameError);
  });

  it("exposes schedule and queue metadata in the registry", () => {
    const job = defineJob({
      name: "billing.closeOverdue",
      schedule: {
        cron: "0 */5 * * * *",
        timezone: "Asia/Shanghai",
        singleton: true,
      },
      queue: { priority: 10 },
      handler: () => undefined,
    });
    const registry = createJobRegistry([
      {
        name: "billing.closeOverdue",
        definition: job,
        sourceFile: "billing.ts",
        sourcePath: "billing.ts",
        exportName: "default",
      },
    ]);

    expect(registry.toJSON()[0]).toMatchObject({
      schedule: {
        cron: "0 */5 * * * *",
        timezone: "Asia/Shanghai",
        singleton: true,
      },
      queue: { priority: 10 },
    });
  });

  it("calculates interval due times inside the scheduler tick window", () => {
    const due = resolveJobDueTimes({
      schedule: { interval: 1000, misfirePolicy: "catch-up" },
      previousTick: new Date("2026-09-13T00:00:00.000Z"),
      now: new Date("2026-09-13T00:00:03.000Z"),
    });

    expect(due.map((item) => item.toISOString())).toEqual([
      "2026-09-13T00:00:01.000Z",
      "2026-09-13T00:00:02.000Z",
      "2026-09-13T00:00:03.000Z",
    ]);
  });

  it("uses store leases so only one scheduler owner can create due runs", async () => {
    const store = createMemoryJobStore();
    expect(await store.acquireSchedulerLease("a", 30_000)).toBe(true);
    expect(await store.acquireSchedulerLease("b", 30_000)).toBe(false);
    await store.releaseSchedulerLease("a");
    expect(await store.acquireSchedulerLease("b", 30_000)).toBe(true);
  });

  it("ticks scheduled jobs into the shared store", async () => {
    const job = defineJob({
      name: "billing.closeOverdue",
      schedule: { interval: 1000, misfirePolicy: "catch-up" },
      handler: () => "ok",
    });
    const runtime = await createRuntime({
      jobs: { "billing.closeOverdue": job },
      schedulerMode: "enqueue",
    });

    try {
      const created = await tickJobScheduler(runtime, {
        ownerId: "scheduler-a",
        previousTick: new Date("2026-09-13T00:00:00.000Z"),
        now: new Date("2026-09-13T00:00:01.000Z"),
      });
      const runs = await runtime.listRuns();
      expect(created).toBe(1);
      expect(runs[0]).toMatchObject({
        jobName: "billing.closeOverdue",
        status: "queued",
        trigger: "schedule",
      });
    } finally {
      await runtime.close();
    }
  });

  it("lets a worker claim and complete one queued run", async () => {
    const runtime = await createRuntime({
      jobs: {
        "math.add": defineJob<{ a: number; b: number }, number>({
          handler: ({ payload }) => payload.a + payload.b,
        }),
      },
    });

    try {
      const run = await runtime.enqueue("math.add", {
        payload: { a: 4, b: 6 },
      });
      await startJobWorker(runtime, { ownerId: "worker-a", once: true });
      await expect(runtime.getRun(run.id)).resolves.toMatchObject({
        status: "success",
        result: 10,
      });
    } finally {
      await runtime.close();
    }
  });

  it("honors per-job concurrency while claiming queued runs", async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const runtime = await createRuntime({
      workerConcurrency: 2,
      jobs: {
        "billing.sync": defineJob({
          concurrency: 1,
          handler: async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise<void>((resolve) => releases.push(resolve));
            active -= 1;
            return "ok";
          },
        }),
      },
    });

    try {
      const first = await runtime.enqueue("billing.sync");
      const second = await runtime.enqueue("billing.sync");
      const worker = startJobWorker(runtime, {
        ownerId: "worker-a",
        once: true,
      });
      await waitUntil(() => releases.length === 1);
      await expect(runtime.getRun(first.id)).resolves.toMatchObject({
        status: "running",
      });
      await expect(runtime.getRun(second.id)).resolves.toMatchObject({
        status: "queued",
      });
      releases[0]?.();
      await worker;
      expect(maxActive).toBe(1);
      await expect(runtime.getRun(first.id)).resolves.toMatchObject({
        status: "success",
      });
      await expect(runtime.getRun(second.id)).resolves.toMatchObject({
        status: "queued",
      });
    } finally {
      releases.splice(0).forEach((release) => release());
      await runtime.close();
    }
  });

  it("protects claimed runs from completion by a different owner", async () => {
    const store = createMemoryJobStore();
    const run = await store.enqueueRun({
      jobName: "billing.sync",
      trigger: "enqueue",
      runAt: new Date("2026-09-13T00:00:00.000Z"),
    });
    const claimed = await store.claimRun(run.id, {
      ownerId: "worker-a",
      leaseTtl: 30_000,
      now: new Date("2026-09-13T00:00:00.000Z"),
    });

    expect(claimed).toMatchObject({
      status: "running",
      leaseOwner: "worker-a",
    });
    await expect(
      store.completeRun(
        run.id,
        { status: "success", attempts: 1, durationMs: 1 },
        { ownerId: "worker-b" },
      ),
    ).resolves.toBe(false);
    await expect(store.getRun(run.id)).resolves.toMatchObject({
      status: "running",
      leaseOwner: "worker-a",
    });
    await expect(
      store.completeRun(
        run.id,
        { status: "success", attempts: 1, durationMs: 1 },
        { ownerId: "worker-a" },
      ),
    ).resolves.toBe(true);
    const completed = await store.getRun(run.id);
    expect(completed).toMatchObject({ status: "success" });
    expect(completed).not.toHaveProperty("leaseOwner");
  });

  it("renews a claimed run lease before it expires", async () => {
    const store = createMemoryJobStore();
    const run = await store.enqueueRun({
      jobName: "billing.sync",
      trigger: "enqueue",
      runAt: new Date("2026-09-13T00:00:00.000Z"),
    });
    await store.claimRun(run.id, {
      ownerId: "worker-a",
      leaseTtl: 1_000,
      now: new Date("2026-09-13T00:00:00.000Z"),
    });

    await expect(
      store.renewRunLease(
        run.id,
        "worker-a",
        2_000,
        new Date("2026-09-13T00:00:00.500Z"),
      ),
    ).resolves.toBe(true);
    await expect(store.getRun(run.id)).resolves.toMatchObject({
      leaseOwner: "worker-a",
      leaseUntil: "2026-09-13T00:00:02.500Z",
    });
  });
});

async function createRuntime(options: {
  jobs: Parameters<typeof createTestJobRunner>[0]["jobs"];
  schedulerMode?: "inline" | "enqueue";
  workerConcurrency?: number;
}): Promise<VextJobRuntime> {
  const runner = await createTestJobRunner({
    services: false,
    config: {
      jobs: {
        store: "memory",
        scheduler: { mode: options.schedulerMode ?? "inline" },
        worker:
          options.workerConcurrency === undefined
            ? undefined
            : { concurrency: options.workerConcurrency },
      },
    },
    jobs: options.jobs,
  });
  const store = createMemoryJobStore();
  return {
    app: runner.app,
    config: runner.app.config,
    registry: runner.registry,
    store,
    enqueue: async (jobName, runOptions = {}) =>
      store.enqueueRun({
        id: runOptions.runId,
        jobName,
        payload: runOptions.payload,
        trigger: runOptions.trigger ?? "enqueue",
      }),
    run: async (jobName, runOptions = {}) =>
      runAndRecord(runner.run, store, jobName, runOptions),
    listRuns: (filter) => store.listRuns(filter),
    getRun: (runId) => store.getRun(runId),
    close: runner.close,
  };
}

async function runAndRecord(
  run: (
    jobName: string,
    options?: VextJobRunOptions,
  ) => Promise<VextJobRunResult>,
  store: VextJobStore,
  jobName: string,
  options: VextJobRunOptions,
): Promise<VextJobRunResult> {
  const record =
    (options.runId ? await store.getRun(options.runId) : undefined) ??
    (await store.enqueueRun({
      id: options.runId,
      jobName,
      payload: options.payload,
      trigger: options.trigger ?? "manual",
    }));
  const ownerId = options.ownerId ?? "test-runtime";
  await store.claimRun(record.id, { ownerId, leaseTtl: 30_000 });
  const result = await run(jobName, {
    ...options,
    ownerId,
    runId: record.id,
    payload: options.payload ?? record.payload,
  });
  await store.completeRun(
    record.id,
    {
      status: result.status,
      attempts: result.attempts,
      durationMs: result.durationMs,
      finishedAt: new Date().toISOString(),
      result: result.result,
      error: result.error ? String(result.error) : undefined,
    },
    { ownerId },
  );
  return result;
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 1000) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
