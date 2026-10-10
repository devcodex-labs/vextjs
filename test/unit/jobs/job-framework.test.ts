import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defineJob,
  isVextJobDefinition,
} from "../../../src/lib/jobs/define-job.js";
import { createScheduledJobs } from "../../../src/lib/jobs/runtime.js";
import { nextJobTime } from "../../../src/lib/jobs/schedule.js";
import { createApp, DEFAULT_CONFIG } from "../../../src/lib/app.js";
import { _validateConfig } from "../../../src/lib/config-loader.js";
import { createTestJobScheduler } from "../../../src/testing/index.js";
import type {
  VextJobDefinition,
  VextJobDefinitionInput,
  VextLoadedJob,
} from "../../../src/lib/jobs/types.js";

const loaded = (
  definition: VextJobDefinition,
  name = definition.name ?? "sample",
): VextLoadedJob => ({
  name,
  definition,
  sourceFile: `${name}.ts`,
  sourcePath: `${name}.ts`,
  exportName: "default",
});
const at = (ms: number) => new Date(ms);
const options = {
  services: false,
  middlewares: false,
  config: { logger: { level: "silent" as const } },
};
afterEach(() => vi.useRealTimers());

describe("scheduled job definition", () => {
  it("requires a handler and exactly one schedule", () => {
    expect(() => defineJob({ handler() {} })).toThrow("exactly one");
    expect(() =>
      defineJob({ cron: "* * * * *", interval: 1000, handler() {} }),
    ).toThrow("exactly one");
    expect(() =>
      defineJob({ interval: 1000 } as VextJobDefinitionInput),
    ).toThrow("handler");
    expect(
      isVextJobDefinition(defineJob({ interval: 1000, handler() {} })),
    ).toBe(true);
    expect(isVextJobDefinition({ handler() {} })).toBe(false);
  });
  it.each([
    "payload",
    "queue",
    "schedule",
    "retry",
    "timeout",
    "concurrency",
    "idempotencyKey",
  ])("rejects obsolete %s options", (key) => {
    expect(() =>
      defineJob({
        interval: 1000,
        handler() {},
        [key]: {},
      } as VextJobDefinitionInput),
    ).toThrow(`does not support "${key}"`);
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects interval %s",
    (interval) => {
      expect(() => defineJob({ interval, handler() {} })).toThrow(
        "positive safe integer",
      );
    },
  );
  it("validates cron and timezone before startup", () => {
    expect(() => defineJob({ cron: "bad cron", handler() {} })).toThrow(
      "invalid cron",
    );
    expect(() =>
      defineJob({ cron: "* * * * *", timezone: "Invalid/Zone", handler() {} }),
    ).toThrow("timezone");
    expect(() =>
      defineJob({ interval: 1000, timezone: "UTC", handler() {} }),
    ).toThrow("only supported with cron");
  });
  it.each(["runner", "store", "scheduler", "worker", "defaults"])(
    "rejects obsolete config.jobs.%s",
    (key) => {
      expect(() => _validateConfig({ jobs: { [key]: {} } })).toThrow(
        "not supported",
      );
    },
  );
  it("validates Redis lease and global timezone", () => {
    expect(() =>
      _validateConfig({ jobs: { redis: { leaseTtl: 999 } } }),
    ).toThrow("1000");
    expect(() =>
      _validateConfig({ jobs: { timezone: "Invalid/Zone" } }),
    ).toThrow("timezone");
    expect(() =>
      _validateConfig({
        jobs: { redis: { url: "redis://localhost", leaseTtl: 1000 } },
      }),
    ).not.toThrow();
  });
});

describe("time calculation", () => {
  it("aligns intervals across replicas and never executes immediately", () => {
    expect(nextJobTime({ interval: 5000 }, at(1001))).toEqual(at(5000));
    expect(nextJobTime({ interval: 5000 }, at(4999))).toEqual(at(5000));
    expect(nextJobTime({ interval: 5000 }, at(5000))).toEqual(at(10000));
  });
  it("rejects schedules without a representable future point", async () => {
    expect(
      nextJobTime({ interval: Number.MAX_SAFE_INTEGER }, at(0)),
    ).toBeNull();
    await expect(
      createTestJobScheduler({
        ...options,
        jobs: [defineJob({ interval: Number.MAX_SAFE_INTEGER, handler() {} })],
      }),
    ).rejects.toThrow("no representable future");
  });
  it("uses future cron boundaries and IANA timezone", () => {
    expect(nextJobTime({ cron: "* * * * * *" }, at(1000))).toEqual(at(2000));
    expect(
      nextJobTime(
        { cron: "0 9 * * *", timezone: "Asia/Shanghai" },
        new Date("2026-01-01T00:00:00Z"),
      ),
    ).toEqual(new Date("2026-01-01T01:00:00Z"));
    expect(
      nextJobTime(
        { cron: "0 9 * * *" },
        new Date("2026-01-01T00:00:00Z"),
        "Asia/Shanghai",
      ),
    ).toEqual(new Date("2026-01-01T01:00:00Z"));
  });
  it("handles the spring DST gap with the cron parser", () => {
    const next = nextJobTime(
      { cron: "30 2 * * *", timezone: "America/New_York" },
      new Date("2026-03-08T06:59:59Z"),
    );
    expect(next).toEqual(new Date("2026-03-08T07:30:00Z"));
  });
});

describe("controlled scheduler", () => {
  it("runs only at future points, passes the ready app, and deduplicates repeated ticks", async () => {
    const calls: number[] = [];
    const test = await createTestJobScheduler({
      ...options,
      now: at(0),
      jobs: {
        sample: defineJob({
          interval: 1000,
          handler(ctx) {
            expect(ctx.app).toBe(test.app);
            expect(ctx.name).toBe("sample");
            calls.push(ctx.scheduledAt.getTime());
          },
        }),
      },
    });
    try {
      await test.tick(at(0));
      await test.tick(at(999));
      expect(calls).toEqual([]);
      await test.tick(at(1000));
      await test.tick(at(1000));
      await test.tick(at(2000));
      expect(calls).toEqual([1000, 2000]);
    } finally {
      await test.close();
    }
    await test.tick(at(3000));
    expect(calls).toEqual([1000, 2000]);
  });
  it("skips missed periods and continues with future points", async () => {
    const calls: number[] = [];
    const test = await createTestJobScheduler({
      ...options,
      now: at(0),
      jobs: [
        defineJob({
          interval: 1000,
          handler(ctx) {
            calls.push(ctx.scheduledAt.getTime());
          },
        }),
      ],
    });
    try {
      await test.tick(at(5000));
      expect(calls).toEqual([]);
      await test.tick(at(6000));
      expect(calls).toEqual([6000]);
    } finally {
      await test.close();
    }
  });
  it("does not retry failures and runs the next period", async () => {
    let calls = 0;
    const test = await createTestJobScheduler({
      ...options,
      now: at(0),
      jobs: [
        defineJob({
          interval: 1000,
          handler() {
            calls++;
            throw new Error("business failure");
          },
        }),
      ],
    });
    try {
      await test.tick(at(1000));
      expect(calls).toBe(1);
      await test.tick(at(2000));
      expect(calls).toBe(2);
    } finally {
      await test.close();
    }
  });
  it("skips overlaps of the same job while other jobs run", async () => {
    let finish!: () => void;
    let slow = 0;
    let fast = 0;
    const test = await createTestJobScheduler({
      ...options,
      now: at(0),
      jobs: {
        slow: defineJob({
          interval: 1000,
          handler: () => {
            slow++;
            return new Promise<void>((resolve) => {
              finish = resolve;
            });
          },
        }),
        fast: defineJob({
          interval: 1000,
          handler() {
            fast++;
          },
        }),
      },
    });
    const first = test.tick(at(1000));
    await new Promise((resolve) => setImmediate(resolve));
    await test.tick(at(2000));
    expect(slow).toBe(1);
    expect(fast).toBe(2);
    finish();
    await first;
    await test.close();
  });
  it("supports global and per-job disabling", async () => {
    const handler = vi.fn();
    for (const globallyDisabled of [false, true]) {
      const test = await createTestJobScheduler({
        ...options,
        config: { ...options.config, jobs: { enabled: !globallyDisabled } },
        now: at(0),
        jobs: [defineJob({ enabled: false, interval: 1000, handler })],
      });
      await test.tick(at(1000));
      await test.close();
    }
    expect(handler).not.toHaveBeenCalled();
  });
  it("fails startup for active Cluster jobs without Redis, but allows empty/disabled jobs", async () => {
    const { app } = createApp({
      ...DEFAULT_CONFIG,
      logger: { level: "silent" },
      cluster: { enabled: true },
    });
    const definition = defineJob({ interval: 1000, handler() {} });
    await expect(
      createScheduledJobs(app, [loaded(definition)], {
        rootDir: process.cwd(),
        timers: false,
      }),
    ).rejects.toThrow("require config.jobs.redis");
    const empty = await createScheduledJobs(app, [], {
      rootDir: process.cwd(),
      timers: false,
    });
    await empty.close();
    const disabled = await createScheduledJobs(
      app,
      [loaded(defineJob({ interval: 1000, enabled: false, handler() {} }))],
      { rootDir: process.cwd(), timers: false },
    );
    await disabled.close();
  });
  it("rejects duplicate names and invalid clocks", async () => {
    const definition = defineJob({
      name: "same",
      interval: 1000,
      handler() {},
    });
    await expect(
      createTestJobScheduler({ ...options, jobs: [definition, definition] }),
    ).rejects.toThrow("Duplicate job name");
    const test = await createTestJobScheduler({
      ...options,
      now: at(0),
      jobs: [definition],
    });
    await expect(test.tick(at(NaN))).rejects.toThrow("valid Date");
    await test.close();
  });
});

describe("application lifecycle", () => {
  it("rearms long intervals beyond Node's maximum timer delay", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { app, internals } = createApp({
      ...DEFAULT_CONFIG,
      logger: { level: "silent" },
    });
    const handler = vi.fn();
    const interval = 2147483647 + 1000;
    internals.setScheduledJobs(
      await createScheduledJobs(
        app,
        [loaded(defineJob({ interval, handler }))],
        { rootDir: process.cwd(), timers: true },
      ),
    );
    await internals.runReady();
    await vi.advanceTimersByTimeAsync(2147483647);
    expect(handler).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![0].scheduledAt).toEqual(at(interval));
    await internals.shutdown(undefined, { skipExit: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start a handler if shutdown occurs while Redis admission is pending", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let grant!: (value: number) => void;
    let released = false;
    const client = {
      ping: async () => "PONG",
      eval(script: string) {
        if (script.includes("local clock"))
          return new Promise<number>((resolve) => {
            grant = resolve;
          });
        if (script.includes("DEL")) released = true;
        return Promise.resolve(1);
      },
    };
    const handler = vi.fn();
    const scheduler = await createTestJobScheduler({
      ...options,
      config: {
        ...options.config,
        jobs: { redis: { client, leaseTtl: 1000 } },
      },
      now: at(0),
      jobs: [defineJob({ interval: 100, handler })],
    });
    vi.setSystemTime(100);
    const work = scheduler.tick(at(100));
    const close = scheduler.close();
    grant(1);
    await Promise.all([work, close]);
    expect(handler).not.toHaveBeenCalled();
    expect(released).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("skips a trigger when Redis responds after its next scheduled point", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let grant!: (value: number) => void;
    let delayed = true;
    const client = {
      ping: async () => "PONG",
      eval(script: string) {
        if (script.includes("local clock") && delayed) {
          delayed = false;
          return new Promise<number>((resolve) => {
            grant = resolve;
          });
        }
        return Promise.resolve(1);
      },
    };
    const handler = vi.fn();
    const scheduler = await createTestJobScheduler({
      ...options,
      config: {
        ...options.config,
        jobs: { redis: { client, leaseTtl: 1000 } },
      },
      now: at(0),
      jobs: [defineJob({ interval: 100, handler })],
    });
    try {
      vi.setSystemTime(100);
      const work = scheduler.tick(at(100));
      await vi.advanceTimersByTimeAsync(100);
      grant(1);
      await work;
      expect(handler).not.toHaveBeenCalled();
      await scheduler.tick(at(200));
      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0]![0].scheduledAt).toEqual(at(200));
    } finally {
      await scheduler.close();
    }
  });

  it("starts timers after readiness and closes tasks before plugin dependencies", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { app, internals } = createApp({
      ...DEFAULT_CONFIG,
      logger: { level: "silent" },
    });
    const events: string[] = [];
    let signal: AbortSignal | undefined;
    app.onReady(async () => {
      events.push("ready");
      await vi.advanceTimersByTimeAsync(2000);
    });
    app.onClose(() => {
      events.push("dependency closed");
    });
    const scheduler = await createScheduledJobs(
      app,
      [
        loaded(
          defineJob({
            interval: 1000,
            async handler(ctx) {
              events.push("task");
              signal = ctx.signal;
              await new Promise<void>((resolve) =>
                ctx.signal.addEventListener(
                  "abort",
                  () => {
                    events.push("task drained");
                    resolve();
                  },
                  { once: true },
                ),
              );
            },
          }),
        ),
      ],
      { rootDir: process.cwd(), timers: true },
    );
    internals.setScheduledJobs(scheduler);
    await internals.runReady();
    expect(events).toEqual(["ready"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toEqual(["ready", "task"]);
    await internals.shutdown(undefined, { skipExit: true });
    expect(signal!.aborted).toBe(true);
    expect(events).toEqual([
      "ready",
      "task",
      "task drained",
      "dependency closed",
    ]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(events.filter((event) => event === "task")).toHaveLength(1);
  });
  it("requests cancellation when a running Redis lease is lost", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const client = {
      ping: async () => "PONG",
      eval: async (script: string) => (script.includes("PEXPIRE") ? 0 : 1),
    };
    const { app, internals } = createApp({
      ...DEFAULT_CONFIG,
      logger: { level: "silent" },
      jobs: { redis: { client, leaseTtl: 1000 } },
    });
    let signal: AbortSignal | undefined;
    internals.setScheduledJobs(
      await createScheduledJobs(
        app,
        [
          loaded(
            defineJob({
              interval: 1000,
              async handler(ctx) {
                signal = ctx.signal;
                await new Promise<void>((resolve) =>
                  ctx.signal.addEventListener("abort", () => resolve(), {
                    once: true,
                  }),
                );
              },
            }),
          ),
        ],
        { rootDir: process.cwd(), timers: true },
      ),
    );
    await internals.runReady();
    await vi.advanceTimersByTimeAsync(1000);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(334);
    expect(signal?.aborted).toBe(true);
    await internals.shutdown(undefined, { skipExit: true });
  });
  it("bounds shutdown when a handler ignores cancellation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { app, internals } = createApp({
      ...DEFAULT_CONFIG,
      logger: { level: "silent" },
      shutdown: { timeout: 0.02 },
    });
    let finish!: () => void;
    let signal: AbortSignal | undefined;
    const dependencyClosed = vi.fn();
    app.onClose(dependencyClosed);
    internals.setScheduledJobs(
      await createScheduledJobs(
        app,
        [
          loaded(
            defineJob({
              interval: 1000,
              handler(ctx) {
                signal = ctx.signal;
                return new Promise<void>((resolve) => {
                  finish = resolve;
                });
              },
            }),
          ),
        ],
        { rootDir: process.cwd(), timers: true },
      ),
    );
    await internals.runReady();
    await vi.advanceTimersByTimeAsync(1000);
    const close = internals.shutdown(undefined, { skipExit: true });
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(20);
    await close;
    expect(dependencyClosed).toHaveBeenCalledOnce();
    finish();
  });
  it("does not leave timers when shutdown wins the readiness race", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { app, internals } = createApp({
      ...DEFAULT_CONFIG,
      logger: { level: "silent" },
    });
    const handler = vi.fn();
    let ready!: () => void;
    app.onReady(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        }),
    );
    internals.setScheduledJobs(
      await createScheduledJobs(
        app,
        [loaded(defineJob({ interval: 1000, handler }))],
        { rootDir: process.cwd(), timers: true },
      ),
    );
    const starting = internals.runReady();
    await Promise.resolve();
    await Promise.resolve();
    await internals.shutdown(undefined, { skipExit: true });
    ready();
    await starting;
    await vi.advanceTimersByTimeAsync(5000);
    expect(handler).not.toHaveBeenCalled();
  });
});
