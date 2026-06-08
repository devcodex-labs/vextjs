import { describe, it, expect } from "vitest";

import { createLogger } from "../../../src/lib/logger.js";
import { createMemoryLogSink } from "../../../src/lib/logger/sinks/memory.js";
import { requestContext } from "../../../src/lib/request-context.js";
import type { VextLoggerConfig } from "../../../src/types/app.js";

function createCapturedLogger(
  config: VextLoggerConfig = {},
  options: { requestContextEnabled?: boolean } = {},
) {
  const sink = createMemoryLogSink();
  const logger = createLogger(
    { ...config, pretty: false },
    { sink, requestContextEnabled: options.requestContextEnabled },
  );
  return {
    logger,
    records: () =>
      sink.lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe("logger mixin", () => {
  it("injects user mixin fields into every log record", () => {
    let calls = 0;
    const { logger, records } = createCapturedLogger({
      mixin() {
        calls++;
        return { call: calls, env: "test" };
      },
    });

    logger.info("first");
    logger.info("second");

    expect(calls).toBe(2);
    expect(records()[0]).toMatchObject({ call: 1, env: "test" });
    expect(records()[1]).toMatchObject({ call: 2, env: "test" });
  });

  it("does not leak structured fields between log records", () => {
    const { logger, records } = createCapturedLogger({
      mixin() {
        return { dynamic_field: "value" };
      },
    });

    logger.info({ structured: 42 }, "first");
    logger.info("second");

    expect(records()[0]!.structured).toBe(42);
    expect(records()[1]!.structured).toBeUndefined();
    expect(records()[1]!.dynamic_field).toBe("value");
  });

  it("protects requestId while allowing user trace fields to override ALS trace fields", async () => {
    const { logger, records } = createCapturedLogger({
      mixin() {
        return {
          requestId: "fake",
          trace_id: "user-trace",
          custom_key: "custom",
        };
      },
    });

    await requestContext.run(
      { requestId: "req-1", traceId: "als-trace", spanId: "als-span" },
      async () => {
        logger.info("request log");
      },
    );

    expect(records()[0]).toMatchObject({
      requestId: "req-1",
      trace_id: "user-trace",
      span_id: "als-span",
      custom_key: "custom",
    });
  });

  it("injects ALS trace_id and span_id when user mixin does not override them", async () => {
    const { logger, records } = createCapturedLogger();

    await requestContext.run(
      { requestId: "req-2", traceId: "trace-2", spanId: "span-2" },
      async () => {
        logger.info("traced request");
      },
    );

    expect(records()[0]).toMatchObject({
      requestId: "req-2",
      trace_id: "trace-2",
      span_id: "span-2",
    });
    expect(records()[0]!.traceId).toBeUndefined();
    expect(records()[0]!.spanId).toBeUndefined();
  });

  it("omits request context fields outside ALS", () => {
    const { logger, records } = createCapturedLogger();

    logger.info("startup");

    expect(records()[0]!.requestId).toBeUndefined();
    expect(records()[0]!.trace_id).toBeUndefined();
    expect(records()[0]!.span_id).toBeUndefined();
  });

  it("keeps user mixin when requestContextEnabled is false", async () => {
    const { logger, records } = createCapturedLogger(
      {
        mixin() {
          return { env_tag: "staging" };
        },
      },
      { requestContextEnabled: false },
    );

    await requestContext.run({ requestId: "ignored" }, async () => {
      logger.info("als disabled");
    });

    expect(records()[0]).toMatchObject({
      env_tag: "staging",
      msg: "als disabled",
    });
    expect(records()[0]!.requestId).toBeUndefined();
  });

  it("downgrades throwing mixins and emits one warning", () => {
    let throwCount = 0;
    const { logger, records } = createCapturedLogger({
      mixin() {
        throwCount++;
        throw new Error(`mixin error ${throwCount}`);
      },
    });

    logger.info("first");
    logger.info("second");

    const warnRecords = records().filter((record) => record.level === 40);
    const infoRecords = records().filter((record) => record.level === 30);

    expect(throwCount).toBeGreaterThanOrEqual(2);
    expect(warnRecords).toHaveLength(1);
    expect(String(warnRecords[0]!.msg)).toContain("mixin 抛出异常");
    expect(warnRecords[0]!.err).toMatchObject({ message: "mixin error 1" });
    expect(infoRecords.map((record) => record.msg)).toEqual([
      "first",
      "second",
    ]);
  });

  it("downgrades async mixins and emits one warning", () => {
    const { logger, records } = createCapturedLogger({
      mixin: (async () => ({ trace_id: "async" })) as never,
    });

    logger.info("first");
    logger.info("second");

    const warnRecords = records().filter((record) => record.level === 40);
    const infoRecords = records().filter((record) => record.level === 30);

    expect(warnRecords).toHaveLength(1);
    expect(String(warnRecords[0]!.msg)).toContain("Promise");
    expect(infoRecords[0]!.trace_id).toBeUndefined();
    expect(infoRecords[1]!.trace_id).toBeUndefined();
  });

  it("does not call mixin during logger initialization", () => {
    let called = false;
    const { logger } = createCapturedLogger({
      mixin() {
        called = true;
        return {};
      },
    });

    expect(called).toBe(false);
    logger.info("trigger");
    expect(called).toBe(true);
  });
});
