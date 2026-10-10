import cluster from "node:cluster";
import type { VextApp } from "../../types/app.js";
import { assertUniqueJobNames } from "./job-registry.js";
import { loadJobs } from "./job-loader.js";
import { validateJobTimezone } from "./define-job.js";
import { VextJobDefinitionError } from "./job-errors.js";
import {
  createJobCoordinator,
  type JobCoordinator,
  type JobLease,
} from "./redis-coordinator.js";
import { nextJobTime } from "./schedule.js";
import type { VextLoadedJob } from "./types.js";

export interface ScheduledJobs {
  start(now?: Date): void;
  /** Controlled clock entry point used by the test helper; never enables timers. */
  tick(now: Date): Promise<void>;
  close(): Promise<void>;
}

export async function prepareScheduledJobs(
  app: VextApp,
  rootDir: string,
  srcDir: string,
): Promise<ScheduledJobs> {
  const jobs = await loadJobs({ rootDir, srcDir, config: app.config.jobs });
  return createScheduledJobs(app, jobs, {
    rootDir,
    timers: process.env.NODE_ENV !== "test",
  });
}

export async function createScheduledJobs(
  app: VextApp,
  definitions: VextLoadedJob[],
  options: { rootDir: string; timers: boolean },
): Promise<ScheduledJobs> {
  assertUniqueJobNames(definitions);
  const config = app.config.jobs;
  validateJobTimezone(config?.timezone, "config.jobs.timezone");
  const jobs =
    config?.enabled === false
      ? []
      : definitions.filter((job) => job.definition.enabled !== false);
  for (const job of jobs) {
    if (!nextJobTime(job.definition, new Date(), config?.timezone ?? "UTC"))
      throw new VextJobDefinitionError(
        `[vextjs] Job "${job.name}" has no representable future scheduled point.`,
      );
  }
  if (
    jobs.length &&
    (cluster.isWorker || app.config.cluster?.enabled) &&
    !config?.redis
  )
    throw new Error(
      "[vextjs] Active scheduled jobs in Cluster require config.jobs.redis. Configure shared Redis or disable jobs.",
    );
  let coordinator: JobCoordinator | undefined;
  if (jobs.length && config?.redis)
    coordinator = await createJobCoordinator(config.redis, options.rootDir);
  const next = new Map<string, Date>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const active = new Map<string, AbortController>();
  const pending = new Set<Promise<void>>();
  let started = false;
  let stopped = false;
  let closing: Promise<void> | undefined;
  const timezone = config?.timezone ?? "UTC";

  function arm(job: VextLoadedJob): void {
    const due = next.get(job.name);
    if (stopped || !options.timers || !due) return;
    const delay = Math.min(2147483647, Math.max(0, due.getTime() - Date.now()));
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (stopped) return;
      if (Date.now() < due.getTime()) {
        arm(job);
        return;
      }
      const now = new Date();
      const work = advance(job, now);
      arm(job);
      if (work) void work;
    }, delay);
    timer.unref();
    timers.add(timer);
  }

  function advance(job: VextLoadedJob, now: Date): Promise<void> | undefined {
    const due = next.get(job.name);
    if (!due || due > now || stopped) return;
    const following = nextJobTime(job.definition, due, timezone);
    const future = nextJobTime(job.definition, now, timezone);
    if (future) next.set(job.name, future);
    else next.delete(job.name);
    // An event loop pause can miss periods, but must never replay a backlog.
    if (following && now >= following) return;
    const work = execute(job, due, following ?? new Date(8640000000000000));
    pending.add(work);
    void work.finally(() => pending.delete(work));
    return work;
  }

  async function execute(
    job: VextLoadedJob,
    scheduledAt: Date,
    expiresAt: Date,
  ): Promise<void> {
    const fields = { job: job.name, scheduledAt: scheduledAt.toISOString() };
    const existing = active.has(job.name);
    const controller = new AbortController();
    if (!existing) active.set(job.name, controller);
    let lease: JobLease | null | undefined;
    let renewal: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const startedAt = Date.now();
    try {
      lease = await coordinator?.claim(
        job.name,
        scheduledAt,
        expiresAt,
        existing,
      );
      if (
        stopped ||
        existing ||
        (coordinator && !lease) ||
        ((coordinator || options.timers) && Date.now() >= expiresAt.getTime())
      ) {
        app.logger.debug(fields, "[vextjs] scheduled job skipped");
        return;
      }
      const renew = () => {
        renewal = setTimeout(
          async () => {
            try {
              const renewed = await lease!.renew();
              if (finished) return;
              if (!renewed) throw new Error("running lease lost");
              if (!finished) renew();
            } catch {
              if (finished) return;
              controller.abort(
                new Error("Scheduled job Redis lease unavailable"),
              );
              app.logger.error(
                fields,
                "[vextjs] scheduled job lease unavailable; cancellation requested",
              );
            }
          },
          Math.min(2147483647, Math.floor(coordinator!.ttl / 3)),
        );
        renewal.unref();
      };
      if (lease) renew();
      app.logger.info(fields, "[vextjs] scheduled job started");
      await job.definition.handler({
        app,
        name: job.name,
        scheduledAt: new Date(scheduledAt),
        signal: controller.signal,
        logger: app.logger,
      });
      app.logger.info(
        { ...fields, durationMs: Date.now() - startedAt },
        "[vextjs] scheduled job completed",
      );
    } catch (error) {
      // Redis errors fail closed; handler failures never stop future periods.
      app.logger.error(
        {
          ...fields,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        },
        "[vextjs] scheduled job failed",
      );
    } finally {
      finished = true;
      clearTimeout(renewal);
      try {
        await lease?.release();
      } catch {
        app.logger.error(fields, "[vextjs] scheduled job lease release failed");
      }
      if (!existing) active.delete(job.name);
    }
  }

  return {
    start(now = new Date()) {
      if (started || stopped) return;
      if (!Number.isFinite(now.getTime()))
        throw new Error("[vextjs] Job start requires a valid Date.");
      started = true;
      for (const job of jobs) {
        const due = nextJobTime(job.definition, now, timezone);
        if (due) next.set(job.name, due);
        arm(job);
      }
    },
    async tick(now) {
      if (!Number.isFinite(now.getTime()))
        throw new Error("[vextjs] Job tick requires a valid Date.");
      if (!started || stopped) return;
      await Promise.all(jobs.map((job) => advance(job, now)));
    },
    close() {
      if (closing) return closing;
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const controller of active.values())
        controller.abort(new Error("Application shutting down"));
      closing = (async () => {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            Promise.allSettled([...pending]),
            new Promise<void>((resolve) => {
              timeout = setTimeout(
                resolve,
                (app.config.shutdown?.timeout ?? 10) * 1000,
              );
              timeout.unref();
            }),
          ]);
        } finally {
          clearTimeout(timeout);
          coordinator?.close();
        }
      })();
      return closing;
    },
  };
}
