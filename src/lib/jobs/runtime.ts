import { performance } from "node:perf_hooks";
import type { VextApp } from "../../types/app.js";
import { assertUniqueJobNames } from "./job-registry.js";
import { loadJobs } from "./job-loader.js";
import { defineJob, validateJobTimezone } from "./define-job.js";
import { VextJobDefinitionError } from "./job-errors.js";
import {
  createJobCoordinator,
  type JobCoordinator,
  type JobLease,
} from "./redis-coordinator.js";
import { nextJobTime } from "./schedule.js";
import type { VextLoadedJob } from "./types.js";
import { createJobsManifest, type JobsManifest } from "./cluster-protocol.js";
import {
  getBuiltinJobsWorker,
  type JobsWorkerChannel,
} from "./cluster-worker.js";

export interface ScheduledJobs {
  readonly hasEnabledJobs: boolean;
  readonly manifest: JobsManifest;
  start(now?: Date): void;
  /** Controlled clock entry point used by the test helper; never enables timers. */
  tick(now: Date): Promise<void>;
  close(deadlineAt?: number): Promise<void>;
}

export async function prepareScheduledJobs(
  app: VextApp,
  rootDir: string,
  srcDir: string,
  onFailure?: (error: Error) => void,
): Promise<ScheduledJobs> {
  const jobs = await loadJobs({ rootDir, srcDir, config: app.config.jobs });
  return createScheduledJobs(app, jobs, {
    rootDir,
    timers: process.env.NODE_ENV !== "test",
    onFailure,
  });
}

export async function createScheduledJobs(
  app: VextApp,
  definitions: VextLoadedJob[],
  options: {
    rootDir: string;
    timers: boolean;
    now?: () => Date;
    worker?: JobsWorkerChannel;
    onFailure?: (error: Error) => void;
  },
): Promise<ScheduledJobs> {
  definitions = definitions.map((job) => ({
    ...job,
    definition: defineJob(job.definition),
  }));
  assertUniqueJobNames(definitions);
  const config = app.config.jobs;
  const clock = options.now ?? (() => new Date());
  const worker = options.worker ?? getBuiltinJobsWorker();
  const manifest = createJobsManifest(
    definitions,
    config,
    options.rootDir,
    !!worker,
  );
  validateJobTimezone(config?.timezone, "config.jobs.timezone");
  const jobs =
    config?.enabled === false
      ? []
      : definitions.filter((job) => job.definition.enabled !== false);
  for (const job of jobs) {
    if (!nextJobTime(job.definition, clock(), config?.timezone ?? "UTC"))
      throw new VextJobDefinitionError(
        `[vextjs] Job "${job.name}" has no representable future scheduled point.`,
      );
  }
  let coordinator: JobCoordinator | undefined;
  let lastSkewWarning = -Infinity;
  if (jobs.length && config?.redis)
    coordinator = await createJobCoordinator(
      config.redis,
      options.rootDir,
      (event) => {
        if (
          (event.offsetMinMs >= 1000 || event.offsetMaxMs <= -1000) &&
          performance.now() - lastSkewWarning >= 60000
        ) {
          lastSkewWarning = performance.now();
          app.logger.warn(
            event,
            "[vextjs] scheduled job clock-skew; Redis TIME remains authoritative",
          );
        }
        if (event.reason !== "granted")
          app.logger.debug(
            event,
            "[vextjs] scheduled job Redis admission skipped",
          );
      },
    );
  else if (jobs.length && worker) coordinator = worker;
  const next = new Map<string, Date>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const active = new Map<string, AbortController>();
  const pending = new Set<Promise<void>>();
  const held = new Set<JobLease>();
  const renewalTimers = new Set<ReturnType<typeof setTimeout>>();
  let coordinatorClosed = false;
  let started = false;
  let stopped = false;
  let appReady = false;
  let admissionEpoch = 0;
  let quarantined = false;
  let closing: Promise<void> | undefined;
  const timezone = config?.timezone ?? "UTC";

  function arm(job: VextLoadedJob): void {
    const due = next.get(job.name);
    if (stopped || !options.timers || !due) return;
    const delay = Math.min(
      2147483647,
      Math.max(0, due.getTime() - clock().getTime()),
    );
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (stopped) return;
      if (clock().getTime() < due.getTime()) {
        arm(job);
        return;
      }
      const now = clock();
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
    if (following && now >= following) {
      app.logger.debug(
        {
          job: job.name,
          name: job.name,
          scheduledAt: due.toISOString(),
          status: "skipped",
          skipReason: "missed-window",
          nextRunAt: future?.toISOString() ?? null,
        },
        "[vextjs] scheduled job skipped",
      );
      return;
    }
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
    const fields = {
      job: job.name,
      name: job.name,
      scheduledAt: scheduledAt.toISOString(),
      pid: process.pid,
      worker: process.env.VEXT_WORKER_ID ?? null,
      ...worker?.diagnostics(),
      mode: manifest.mode,
      nextRunAt: next.get(job.name)?.toISOString() ?? null,
    };
    const existing = active.has(job.name);
    const admittedEpoch = admissionEpoch;
    const controller = new AbortController();
    if (!existing) active.set(job.name, controller);
    let lease: JobLease | null | undefined;
    let renewal: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const claimStartedAt = Date.now();
    let startedAt: number | undefined;
    try {
      lease = await coordinator?.claim(
        job.name,
        scheduledAt,
        expiresAt,
        existing,
        job.definition.leaseTtl,
      );
      // Any known Held expiry invalidates the entire Worker admission epoch,
      // even when its overdue renewal timer has not run yet.
      for (const owner of held)
        if (owner.renew && !owner.valid()) {
          quarantine(
            new Error(
              "[vextjs] Scheduled job Redis LeaseLost: conservative deadline exhausted",
            ),
          );
          break;
        }
      if (
        stopped ||
        quarantined ||
        admittedEpoch !== admissionEpoch ||
        existing ||
        (coordinator && !lease) ||
        (lease && !lease.valid()) ||
        clock().getTime() >= expiresAt.getTime()
      ) {
        app.logger.debug(
          {
            ...fields,
            status: "skipped",
            skipReason:
              stopped || quarantined
                ? "admission-closed"
                : existing
                  ? "busy"
                  : lease && !lease.valid()
                    ? "permit-expired"
                    : "not-granted-or-window-expired",
          },
          "[vextjs] scheduled job skipped",
        );
        return;
      }
      const renew = (
        target = performance.now() + Math.floor(lease!.ttl! / 3),
      ) => {
        if (finished || coordinatorClosed) return;
        renewal = setTimeout(
          async () => {
            renewalTimers.delete(renewal!);
            if (finished || coordinatorClosed) return;
            try {
              if (
                Math.floor(lease!.ttl! / 3) > 2147483647 &&
                performance.now() < target
              ) {
                renew(target);
                return;
              }
              const renewed = await lease!.renew!();
              if (finished || coordinatorClosed) return;
              if (!renewed) throw new Error("running lease lost");
              if (!finished) renew();
            } catch {
              if (finished) return;
              quarantine(new Error("[vextjs] Scheduled job Redis LeaseLost"));
              app.logger.error(
                fields,
                "[vextjs] scheduled job lease unavailable; cancellation requested",
              );
            }
          },
          Math.min(2147483647, Math.max(0, target - performance.now())),
        );
        renewal.unref();
        renewalTimers.add(renewal);
      };
      // There must be no await between the last gate, permit consumption and handler entry.
      if (lease?.start && !lease.start()) return;
      if (lease?.signal) {
        const abort = () => controller.abort(lease!.signal!.reason);
        if (lease.signal.aborted) abort();
        else
          lease.signal.addEventListener("abort", abort, {
            once: true,
            signal: controller.signal,
          });
      }
      if (controller.signal.aborted) return;
      if (lease?.renew) renew();
      if (lease) held.add(lease);
      startedAt = Date.now();
      app.logger.info(
        {
          ...fields,
          startedAt: new Date(startedAt).toISOString(),
          claimDurationMs: startedAt - claimStartedAt,
          status: "started",
        },
        "[vextjs] scheduled job started",
      );
      await job.definition.handler({
        app,
        name: job.name,
        scheduledAt: new Date(scheduledAt),
        signal: controller.signal,
        logger: app.logger,
      });
      app.logger.info(
        {
          ...fields,
          startedAt: new Date(startedAt).toISOString(),
          durationMs: Date.now() - startedAt,
          status: "completed",
        },
        "[vextjs] scheduled job completed",
      );
    } catch (error) {
      // Redis errors fail closed; handler failures never stop future periods.
      app.logger.error(
        {
          ...fields,
          durationMs: startedAt === undefined ? 0 : Date.now() - startedAt,
          claimDurationMs: (startedAt ?? Date.now()) - claimStartedAt,
          phase: startedAt === undefined ? "admission" : "handler",
          error: error instanceof Error ? error.message : String(error),
          status: "failed",
        },
        "[vextjs] scheduled job failed",
      );
    } finally {
      finished = true;
      clearTimeout(renewal);
      if (renewal) renewalTimers.delete(renewal);
      if (lease) held.delete(lease);
      try {
        await lease?.release();
      } catch {
        app.logger.error(fields, "[vextjs] scheduled job lease release failed");
      }
      if (!existing) active.delete(job.name);
    }
  }

  function drain(reason: Error): void {
    if (stopped) return;
    stopped = true;
    admissionEpoch++;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const controller of active.values()) controller.abort(reason);
  }
  function quarantine(reason: Error): void {
    if (quarantined) return;
    quarantined = true;
    drain(reason);
    options.onFailure?.(reason);
    if (!options.onFailure)
      app.logger.error(
        { error: reason.message },
        "[vextjs] Jobs admissions quarantined; restart the application",
      );
  }
  function activate(now: Date): void {
    if (started || stopped) return;
    if (!Number.isFinite(now.getTime()))
      throw new Error("[vextjs] Job start requires a valid Date.");
    // Revalidate every enabled schedule at actual activation before creating any timer.
    const points = jobs.map((job) => {
      const due = nextJobTime(job.definition, now, timezone);
      if (!due)
        throw new Error(
          `[vextjs] Job "${job.name}" has no future point at activation.`,
        );
      return [job.name, due] as const;
    });
    started = true;
    for (const [name, due] of points) next.set(name, due);
    for (const job of jobs) arm(job);
    app.logger.info(
      {
        discovered: definitions.length,
        enabled: jobs.length,
        disabled: definitions.length - jobs.length,
        mode: manifest.mode,
        manifestDigest: manifest.digest,
        activationState: "active",
        pid: process.pid,
      },
      "[vextjs] scheduled jobs activated",
    );
  }
  if (worker) {
    try {
      await worker.bind(manifest, {
        activate() {
          if (!appReady)
            throw new Error("[vextjs] Jobs activation preceded appReady");
          activate(clock());
        },
        drain,
        fail: quarantine,
      });
    } catch (error) {
      coordinator?.close();
      throw error;
    }
  }

  return {
    hasEnabledJobs: jobs.length > 0,
    manifest,
    start(now = clock()) {
      appReady = true;
      if (!worker) activate(now);
    },
    async tick(now) {
      if (!Number.isFinite(now.getTime()))
        throw new Error("[vextjs] Job tick requires a valid Date.");
      if (!started || stopped) return;
      await Promise.all(jobs.map((job) => advance(job, now)));
    },
    close(
      deadlineAt = Date.now() + (app.config.shutdown?.timeout ?? 10) * 1000,
    ) {
      if (closing) return closing;
      drain(new Error("Application shutting down"));
      closing = (async () => {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            Promise.allSettled([...pending]),
            new Promise<void>((resolve) => {
              timeout = setTimeout(
                resolve,
                Math.max(0, deadlineAt - Date.now()),
              );
              timeout.unref();
            }),
          ]);
        } finally {
          clearTimeout(timeout);
          coordinatorClosed = true;
          for (const timer of renewalTimers) clearTimeout(timer);
          renewalTimers.clear();
          coordinator?.close();
        }
      })();
      return closing;
    },
  };
}
