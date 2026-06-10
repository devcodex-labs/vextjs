import { describe, expect, it } from "vitest";
import {
  createStartupProfiler,
  formatStartupProfile,
  formatStartupSummary,
  mergeStartupProfiles,
} from "../../src/lib/startup-profiler.js";

describe("startup-profiler", () => {
  it("records additive phase metadata and startedAtMs", async () => {
    let now = 100;
    const profiler = createStartupProfiler({
      enabled: true,
      now: () => now,
      wallClockNow: () => 1_700_000_000_000,
    });

    await profiler.time(
      "main.preflight.initial",
      async () => {
        now += 12;
      },
      { phase: "main/preflight", detail: { reason: "initial" } },
    );

    const snapshot = profiler.toJSON();
    expect(snapshot.startedAtMs).toBe(1_700_000_000_000);
    expect(snapshot.events[0]).toMatchObject({
      name: "main.preflight.initial",
      phase: "main/preflight",
      kind: "event",
      detail: { reason: "initial" },
    });
  });

  it("aligns worker events on wall-clock time and inserts visible gaps", async () => {
    let mainNow = 0;
    const main = createStartupProfiler({
      enabled: true,
      now: () => mainNow,
      wallClockNow: () => 10_000,
    });

    await main.time("main.preflight.initial", async () => {
      mainNow += 20;
    });
    await main.time("main.preloads.resolve.initial", async () => {
      mainNow += 10;
    });
    await main.time("main.worker.ready", async () => {
      mainNow += 600;
    });

    let workerNow = 0;
    const worker = createStartupProfiler({
      enabled: true,
      now: () => workerNow,
      wallClockNow: () => 10_260,
    });
    await worker.time("worker.compile", async () => {
      workerNow += 40;
    });
    workerNow += 260;
    await worker.time("worker.routes", async () => {
      workerNow += 25;
    });

    const merged = mergeStartupProfiles(main.toJSON(), worker.toJSON(), {
      gapThresholdMs: 100,
    });

    expect(merged.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "worker.compile",
          startMs: 260,
          phase: "compile",
        }),
        expect.objectContaining({
          name: "gap.pre-worker-bootstrap",
          kind: "gap",
          phase: "pre-worker-bootstrap",
        }),
        expect.objectContaining({
          name: "gap.routes.2",
          kind: "gap",
          phase: "gap",
        }),
      ]),
    );
    expect(merged.elapsedMs).toBe(630);
  });

  it("formats a concise summary and keeps detailed profile output separate", async () => {
    const merged = {
      enabled: true,
      startedAt: "2026-06-10T00:00:00.000Z",
      startedAtMs: 10_000,
      elapsedMs: 630,
      events: [
        {
          name: "main.worker.ready",
          startMs: 30,
          durationMs: 600,
          phase: "main/worker",
          kind: "event" as const,
        },
        {
          name: "worker.compile",
          startMs: 260,
          durationMs: 40,
          phase: "compile",
          kind: "event" as const,
        },
        {
          name: "gap.pre-worker-bootstrap",
          startMs: 30,
          durationMs: 230,
          phase: "pre-worker-bootstrap",
          kind: "gap" as const,
        },
      ],
    };

    const summary = formatStartupSummary(merged);
    expect(summary).toContain("startup summary total=630ms");
    expect(summary).toContain("pre-worker-bootstrap");
    expect(summary).toContain("compile");
    expect(summary).not.toContain("main/worker");

    const details = formatStartupProfile(merged);
    expect(details).toContain("startup profile details");
    expect(details).toContain("main.worker.ready");
    expect(details).toContain("[main/worker]");
  });
});
