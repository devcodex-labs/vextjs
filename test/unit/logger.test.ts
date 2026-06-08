import { describe, it, expect, vi } from "vitest";

import { createLogger, getLoggerLifecycle } from "../../src/lib/logger.js";
import { createMemoryLogSink } from "../../src/lib/logger/sinks/memory.js";
import type { LogSink } from "../../src/lib/logger/types.js";
import { requestContext } from "../../src/lib/request-context.js";
import type { VextLoggerConfig } from "../../src/types/app.js";

function createCapturedLogger(
  config: VextLoggerConfig = {},
  options: { requestContextEnabled?: boolean } = {},
) {
  const sink = createMemoryLogSink();
  const logger = createLogger(
    { ...config, pretty: config.pretty ?? false },
    { sink, requestContextEnabled: options.requestContextEnabled },
  );
  return {
    logger,
    sink,
    records: () =>
      sink.lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe("createLogger", () => {
  it("returns the public VextLogger method set", () => {
    const { logger } = createCapturedLogger();

    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.fatal).toBe("function");
    expect(typeof logger.child).toBe("function");
  });

  it("writes numeric JSON records with ISO time", () => {
    const { logger, records } = createCapturedLogger();

    logger.info("service started");

    const [record] = records();
    expect(record).toMatchObject({
      level: 30,
      msg: "service started",
    });
    expect(typeof record!.pid).toBe("number");
    expect(typeof record!.hostname).toBe("string");
    expect(String(record!.time)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("honors the configured log level before serializing disabled records", () => {
    const { logger, records } = createCapturedLogger({ level: "warn" });

    logger.debug({
      get expensive() {
        throw new Error("should not serialize");
      },
    });
    logger.warn("visible");

    expect(records()).toHaveLength(1);
    expect(records()[0]!.msg).toBe("visible");
  });

  it("supports silent level", () => {
    const { logger, records } = createCapturedLogger({ level: "silent" });

    logger.fatal("hidden");

    expect(records()).toHaveLength(0);
  });

  it("preserves logger.info(message, meta) fields", () => {
    const { logger, records } = createCapturedLogger();

    logger.info("Generating greeting", { name: "Ada" });

    expect(records()[0]).toMatchObject({
      level: 30,
      msg: "Generating greeting",
      name: "Ada",
    });
  });

  it("preserves logger.info(object, message) fields", () => {
    const { logger, records } = createCapturedLogger();

    logger.info({ count: 3, service: "test" }, "done");

    expect(records()[0]).toMatchObject({
      count: 3,
      service: "test",
      msg: "done",
    });
  });

  it("serializes Error first-argument calls", () => {
    const { logger, records } = createCapturedLogger();
    const err = new Error("database down");

    (logger.error as (...args: unknown[]) => void)(err, "db failed");

    const record = records()[0]!;
    expect(record.level).toBe(50);
    expect(record.msg).toBe("db failed");
    expect(record.err).toMatchObject({
      type: "Error",
      message: "database down",
      name: "Error",
    });
  });

  it("serializes nested values, bigint, dates and circular references", () => {
    const { logger, records } = createCapturedLogger();
    const circular: Record<string, unknown> = { name: "root" };
    circular.self = circular;

    logger.info(
      {
        amount: 10n,
        at: new Date("2026-01-02T03:04:05.000Z"),
        circular,
      },
      "complex",
    );

    expect(records()[0]).toMatchObject({
      amount: "10",
      at: "2026-01-02T03:04:05.000Z",
      circular: { name: "root", self: "[Circular]" },
      msg: "complex",
    });
  });

  it("preserves repeated non-circular nested references", () => {
    const { logger, records } = createCapturedLogger();
    const shared = { id: "shared" };

    logger.info(
      {
        nested: { first: shared, second: shared },
        list: [shared, shared],
      },
      "shared refs",
    );

    expect(records()[0]).toMatchObject({
      nested: {
        first: { id: "shared" },
        second: { id: "shared" },
      },
      list: [{ id: "shared" }, { id: "shared" }],
      msg: "shared refs",
    });
  });

  it("does not leak child bindings to the parent logger", () => {
    const { logger, records } = createCapturedLogger();
    const child = logger.child({ service: "UserService" });

    child.info("child log");
    logger.info("parent log");

    expect(records()[0]!.service).toBe("UserService");
    expect(records()[1]!.service).toBeUndefined();
  });

  it("injects request context and protects requestId from user mixin override", async () => {
    const { logger, records } = createCapturedLogger({
      mixin() {
        return { requestId: "fake", trace_id: "user-trace" };
      },
    });

    await requestContext.run(
      { requestId: "req-1", traceId: "als-trace", spanId: "span-1" },
      async () => {
        logger.info("inside request");
      },
    );

    expect(records()[0]).toMatchObject({
      requestId: "req-1",
      trace_id: "user-trace",
      span_id: "span-1",
    });
  });

  it("removes user-provided requestId outside ALS context", () => {
    const { logger, records } = createCapturedLogger({
      mixin() {
        return { requestId: "fake", env: "test" };
      },
    });

    logger.info("startup");

    expect(records()[0]!.requestId).toBeUndefined();
    expect(records()[0]!.env).toBe("test");
  });

  it("skips ALS fields when requestContextEnabled is false", async () => {
    const { logger, records } = createCapturedLogger(
      {
        mixin() {
          return { env: "test" };
        },
      },
      { requestContextEnabled: false },
    );

    await requestContext.run({ requestId: "req-disabled" }, async () => {
      logger.info("without context");
    });

    expect(records()[0]).toMatchObject({ env: "test", msg: "without context" });
    expect(records()[0]!.requestId).toBeUndefined();
  });

  it("formats pretty output as compact single-line text by default", () => {
    const sink = createMemoryLogSink();
    const logger = createLogger({ pretty: true }, { sink });

    logger.info({ requestId: "req-1", count: 2 }, "pretty log");

    expect(sink.lines[0]).toContain("INFO: pretty log");
    expect(sink.lines[0]).toContain('"count":2');
    expect(sink.lines[0]).not.toContain("req-1");
  });

  it("formats pretty output in multiline mode", () => {
    const sink = createMemoryLogSink();
    const logger = createLogger(
      { pretty: true, prettySingleLine: false },
      { sink },
    );

    logger.info({ count: 2 }, "pretty log");

    expect(sink.lines[0]).toContain("INFO: pretty log");
    expect(sink.lines[0]).toContain("\n    count: 2\n");
  });

  it("exposes an internal lifecycle handle for default logger cleanup", async () => {
    const sink: LogSink = {
      write: vi.fn(),
      flush: vi.fn(),
      close: vi.fn(),
    };
    const logger = createLogger({ pretty: false }, { sink });

    await getLoggerLifecycle(logger)?.close();
    logger.info("after close");

    expect(sink.flush).toHaveBeenCalledOnce();
    expect(sink.close).toHaveBeenCalledOnce();
    expect(sink.write).not.toHaveBeenCalled();
  });
});
