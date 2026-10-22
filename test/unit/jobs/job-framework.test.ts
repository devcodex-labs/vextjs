import { afterEach, describe, expect, it, vi } from "vitest";
import { performance } from "node:perf_hooks";
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
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("scheduled job definition", () => {
  it("requires a handler and an explicit Cron expression", () => {
    expect(() => defineJob({ handler() {} } as VextJobDefinitionInput)).toThrow(
      "cron",
    );
    expect(() =>
      defineJob({
        cron: "* * * * *",
        interval: 1000,
        handler() {},
      } as VextJobDefinitionInput),
    ).toThrow('does not support "interval"');
    expect(() =>
      defineJob({ cron: "* * * * *" } as VextJobDefinitionInput),
    ).toThrow("handler");
    expect(
      isVextJobDefinition(defineJob({ cron: "* * * * * *", handler() {} })),
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
        cron: "* * * * * *",
        handler() {},
        [key]: {},
      } as VextJobDefinitionInput),
    ).toThrow(`does not support "${key}"`);
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects leaseTtl %s",
    (leaseTtl) => {
      expect(() =>
        defineJob({ cron: "* * * * *", leaseTtl, handler() {} }),
      ).toThrow("1000");
    },
  );
  it("validates cron and timezone before startup", () => {
    expect(() => defineJob({ cron: "bad cron", handler() {} })).toThrow(
      "Cron expression",
    );
    expect(() =>
      defineJob({ cron: "* * * * *", timezone: "Invalid/Zone", handler() {} }),
    ).toThrow("timezone");
    expect(() =>
      defineJob({
        cron: "2030-01-01T00:00:00Z",
        timezone: "UTC",
        handler() {},
      }),
    ).toThrow("Cron expression");
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
  it.each([
    "@yearly",
    "@annually",
    "@monthly",
    "@weekly",
    "@daily",
    "@midnight",
    "@hourly",
  ])("accepts supported macro %s", (cron) => {
    const definition = defineJob({ cron, handler() {} });
    expect(
      nextJobTime(definition, new Date("2026-01-01T00:00:00Z"))!.getTime(),
    ).toBeGreaterThan(Date.parse("2026-01-01T00:00:00Z"));
  });
  it.each([
    ["0 0 L * *", "2026-01-01T00:00:00Z", "2026-01-31T00:00:00Z"],
    ["0 0 1W * *", "2026-03-01T00:00:00Z", "2026-03-02T00:00:00Z"],
    ["0 9 * * MON#2", "2026-01-01T00:00:00Z", "2026-01-12T09:00:00Z"],
    ["0 0 1 * MON", "2026-01-02T00:00:00Z", "2026-01-05T00:00:00Z"],
    ["0 0 1 * +MON", "2026-01-02T00:00:00Z", "2026-06-01T00:00:00Z"],
    ["0 0 0 1 2 * 2026", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"],
  ])("preserves locked Croner calendar semantics for %s", (cron, from, to) => {
    expect(
      nextJobTime(defineJob({ cron, handler() {} }), new Date(from)),
    ).toEqual(new Date(to));
  });
  it("revalidates a finite schedule after ready waits and naturally terminates after its final point", async () => {
    let clock = new Date("2026-01-01");
    const { app, internals } = createApp({
      ...DEFAULT_CONFIG,
      logger: { level: "silent" },
    });
    app.onReady(() => {
      clock = new Date("2026-03-01");
    });
    const definition = defineJob({ cron: "0 0 0 1 2 * 2026", handler() {} });
    internals.setScheduledJobs(
      await createScheduledJobs(app, [loaded(definition)], {
        rootDir: process.cwd(),
        timers: false,
        now: () => new Date(clock),
      }),
    );
    await expect(internals.runReady()).rejects.toThrow(
      "no future point at activation",
    );
    await internals.shutdown(undefined, { skipExit: true });
    const handler = vi.fn();
    const test = await createTestJobScheduler({
      ...options,
      now: new Date("2026-01-01"),
      jobs: [defineJob({ cron: definition.cron, handler })],
    });
    await test.tick(new Date("2026-02-01"));
    await test.tick(new Date("2026-03-01"));
    expect(handler).toHaveBeenCalledOnce();
    await test.close();
  });
  it("aligns Cron points across replicas and never executes immediately", () => {
    expect(nextJobTime({ cron: "*/5 * * * * *" }, at(1001))).toEqual(at(5000));
    expect(nextJobTime({ cron: "*/5 * * * * *" }, at(4999))).toEqual(at(5000));
    expect(nextJobTime({ cron: "*/5 * * * * *" }, at(5000))).toEqual(at(10000));
  });
  it("rejects schedules without a representable future point", async () => {
    expect(
      nextJobTime({ cron: "0 0 0 1 1 * 2020" }, new Date("2026-01-01")),
    ).toBeNull();
    await expect(
      createTestJobScheduler({
        ...options,
        jobs: [defineJob({ cron: "0 0 0 1 1 * 2020", handler() {} })],
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
          cron: "* * * * * *",
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
          cron: "* * * * * *",
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
          cron: "* * * * * *",
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
          cron: "* * * * * *",
          handler: () => {
            slow++;
            return new Promise<void>((resolve) => {
              finish = resolve;
            });
          },
        }),
        fast: defineJob({
          cron: "* * * * * *",
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
        jobs: [defineJob({ enabled: false, cron: "* * * * * *", handler })],
      });
      await test.tick(at(1000));
      await test.close();
    }
    expect(handler).not.toHaveBeenCalled();
  });
  it("does not infer trusted Cluster identity from configuration alone", async () => {
    const { app } = createApp({
      ...DEFAULT_CONFIG,
      logger: { level: "silent" },
      cluster: { enabled: true },
    });
    const definition = defineJob({ cron: "* * * * * *", handler() {} });
    const local = await createScheduledJobs(app, [loaded(definition)], {
      rootDir: process.cwd(),
      timers: false,
    });
    expect(local.manifest.mode).toBe("local");
    await local.close();
    const empty = await createScheduledJobs(app, [], {
      rootDir: process.cwd(),
      timers: false,
    });
    await empty.close();
    const disabled = await createScheduledJobs(
      app,
      [
        loaded(
          defineJob({ cron: "* * * * * *", enabled: false, handler() {} }),
        ),
      ],
      { rootDir: process.cwd(), timers: false },
    );
    await disabled.close();
  });
  it("rejects duplicate names and invalid clocks", async () => {
    const definition = defineJob({
      name: "same",
      cron: "* * * * * *",
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
  it("removes every renewal timer at the shared deadline even if a Redis handler ignores Abort", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const client = { ping: async () => "PONG", eval: vi.fn(async () => 1) };
    const { app, internals } = createApp({
      ...DEFAULT_CONFIG,
      logger: { level: "silent" },
      shutdown: { timeout: 0.02 },
      jobs: { redis: { client, leaseTtl: 30000 } },
    });
    let finish!: () => void;
    internals.setScheduledJobs(
      await createScheduledJobs(
        app,
        [
          loaded(
            defineJob({
              cron: "* * * * * *",
              handler() {
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
    expect(finish).toBeDefined();
    const closed = internals.shutdown(undefined, { skipExit: true });
    await vi.advanceTimersByTimeAsync(20);
    await closed;
    expect(vi.getTimerCount()).toBe(0);
    const commands = client.eval.mock.calls.length;
    await vi.advanceTimersByTimeAsync(40000);
    expect(client.eval.mock.calls.length).toBe(commands);
    finish();
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("measures handler start and duration separately from asynchronous claim wait", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let grant!: (value: number) => void;
    const client = {
      ping: async () => "PONG",
      eval(script: string) {
        return script.includes("local clock")
          ? new Promise<number>((resolve) => {
              grant = resolve;
            })
          : Promise.resolve(1);
      },
    };
    const { app } = createApp({
      ...DEFAULT_CONFIG,
      logger: { level: "silent" },
      jobs: { redis: { client, leaseTtl: 30000 } },
    });
    const info = vi.spyOn(app.logger, "info");
    const scheduler = await createScheduledJobs(
      app,
      [
        loaded(
          defineJob({
            cron: "* * * * * *",
            async handler() {
              await vi.advanceTimersByTimeAsync(10);
            },
          }),
        ),
      ],
      { rootDir: process.cwd(), timers: false, now: () => new Date(1000) },
    );
    scheduler.start(new Date(0));
    vi.setSystemTime(1000);
    const work = scheduler.tick(new Date(1000));
    vi.setSystemTime(1500);
    grant(1);
    await work;
    const started = info.mock.calls.find(
      (call) => call[1] === "[vextjs] scheduled job started",
    )![0];
    const completed = info.mock.calls.find(
      (call) => call[1] === "[vextjs] scheduled job completed",
    )![0];
    expect(started).toMatchObject({
      startedAt: new Date(1500).toISOString(),
      claimDurationMs: 500,
    });
    expect(completed).toMatchObject({
      startedAt: new Date(1500).toISOString(),
      durationMs: 10,
      status: "completed",
    });
    await scheduler.close();
  });
  it("rejects necessary onReady failure only when enabled Jobs are present", async () => {
    for (const enabled of [true, false]) {
      const { app, internals } = createApp({
        ...DEFAULT_CONFIG,
        logger: { level: "silent" },
      });
      const handler = vi.fn();
      const closed = vi.fn();
      app.onReady(() => {
        throw new Error("necessary initialization failed");
      });
      app.onClose(closed);
      internals.setScheduledJobs(
        await createScheduledJobs(
          app,
          [loaded(defineJob({ cron: "* * * * * *", enabled, handler }))],
          { rootDir: process.cwd(), timers: false },
        ),
      );
      if (enabled)
        await expect(internals.runReady()).rejects.toThrow(
          "necessary initialization failed",
        );
      else await expect(internals.runReady()).resolves.toBeUndefined();
      expect(handler).not.toHaveBeenCalled();
      await internals.shutdown(undefined, { skipExit: true });
      expect(closed).toHaveBeenCalledOnce();
    }
  });
  it("attaches the test scheduler before ready hooks and uses the same clock for future validation", async () => {
    await expect(
      createTestJobScheduler({
        ...options,
        now: new Date("2020-01-01"),
        setupPlugins(app) {
          app.onReady(() => {
            throw new Error("test ready failed");
          });
        },
        jobs: [defineJob({ cron: "0 0 0 1 2 * 2020", handler() {} })],
      }),
    ).rejects.toThrow("test ready failed");
    const test = await createTestJobScheduler({
      ...options,
      now: new Date("2020-01-01"),
      jobs: [defineJob({ cron: "0 0 0 1 2 * 2020", handler() {} })],
    });
    await test.close();
  });
  it("quarantines every new admission when another Held lease expired before its timer callback", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let mono = 0;
    vi.spyOn(performance, "now").mockImplementation(() => mono);
    const client = { ping: async () => "PONG", eval: async () => 1 };
    const { app, internals } = createApp({
      ...DEFAULT_CONFIG,
      logger: { level: "silent" },
      jobs: { redis: { client, leaseTtl: 1000 } },
    });
    let finish!: () => void;
    const second = vi.fn();
    const failed = vi.fn();
    let signal!: AbortSignal;
    const scheduler = await createScheduledJobs(
      app,
      [
        loaded(
          defineJob({ name: "b", cron: "*/2 * * * * *", handler: second }),
        ),
        loaded(
          defineJob({
            name: "a",
            cron: "* * * * * *",
            handler(ctx) {
              signal = ctx.signal;
              return new Promise<void>((resolve) => {
                finish = resolve;
              });
            },
          }),
        ),
      ],
      { rootDir: process.cwd(), timers: false, onFailure: failed },
    );
    internals.setScheduledJobs(scheduler);
    await internals.runReady();
    vi.setSystemTime(1000);
    const running = scheduler.tick(new Date(1000));
    for (let turn = 0; turn < 30 && !signal; turn++) await Promise.resolve();
    expect(signal).toBeDefined();
    // Advance the clock without dispatching any overdue renewal timer.
    mono = 1001;
    vi.setSystemTime(2000);
    await scheduler.tick(new Date(2000));
    expect(second).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledOnce();
    expect(signal.aborted).toBe(true);
    finish();
    await running;
    await internals.shutdown(undefined, { skipExit: true });
  });
  it("rearms distant Cron points beyond Node's maximum timer delay", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { app, internals } = createApp({
      ...DEFAULT_CONFIG,
      logger: { level: "silent" },
    });
    const handler = vi.fn();
    const due = Date.UTC(1970, 1, 1);
    internals.setScheduledJobs(
      await createScheduledJobs(
        app,
        [loaded(defineJob({ cron: "0 0 0 1 2 * 1970", handler }))],
        { rootDir: process.cwd(), timers: true },
      ),
    );
    await internals.runReady();
    await vi.advanceTimersByTimeAsync(2147483647);
    expect(handler).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(due - 2147483647);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![0].scheduledAt).toEqual(at(due));
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
      jobs: [defineJob({ cron: "* * * * * *", handler })],
    });
    vi.setSystemTime(1000);
    const work = scheduler.tick(at(1000));
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
      jobs: [defineJob({ cron: "* * * * * *", handler })],
    });
    try {
      vi.setSystemTime(1000);
      const work = scheduler.tick(at(1000));
      await vi.advanceTimersByTimeAsync(1000);
      grant(1);
      await work;
      expect(handler).not.toHaveBeenCalled();
      await scheduler.tick(at(2000));
      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0]![0].scheduledAt).toEqual(at(2000));
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
            cron: "* * * * * *",
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
              cron: "* * * * * *",
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
              cron: "* * * * * *",
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
        [loaded(defineJob({ cron: "* * * * * *", handler }))],
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
