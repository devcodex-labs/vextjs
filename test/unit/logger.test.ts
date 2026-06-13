import { describe, it, expect, vi } from "vitest";

import {
  createLogger,
  getLoggerLifecycle,
  normalizeVextLogger,
} from "../../src/lib/logger.js";
import { createLoggerCore } from "../../src/lib/logger/core.js";
import { formatPrettyRecord } from "../../src/lib/logger/pretty.js";
import {
  compileRedactionOptions,
  redactRecord,
} from "../../src/lib/logger/redaction.js";
import { createMemoryLogSink } from "../../src/lib/logger/sinks/memory.js";
import {
  normalizeLogArgs,
  serializeJsonRecord,
} from "../../src/lib/logger/serializer.js";
import {
  appendTimestampString,
  formatPrettyTime,
} from "../../src/lib/logger/timestamp.js";
import type { LogSink } from "../../src/lib/logger/types.js";
import {
  appendRecordString,
  quote,
  serializeValue,
  toJsonRecord,
} from "../../src/lib/logger/utils-json.js";
import { requestContext } from "../../src/lib/request-context.js";
import type { VextLoggerConfig } from "../../src/types/app.js";

type LoggerEnvKey = "NO_COLOR" | "FORCE_COLOR" | "TERM";

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

function withLoggerEnv(
  nextEnv: Partial<Record<LoggerEnvKey, string | undefined>>,
  run: () => void,
): void {
  const previous: Record<LoggerEnvKey, string | undefined> = {
    NO_COLOR: process.env.NO_COLOR,
    FORCE_COLOR: process.env.FORCE_COLOR,
    TERM: process.env.TERM,
  };
  try {
    for (const key of Object.keys(nextEnv) as LoggerEnvKey[]) {
      const value = nextEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    run();
  } finally {
    for (const key of Object.keys(previous) as LoggerEnvKey[]) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("createLogger", () => {
  it("returns the public VextLogger method set", () => {
    const { logger } = createCapturedLogger();

    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.trace).toBe("function");
    expect(typeof logger.fatal).toBe("function");
    expect(typeof logger.getLevel).toBe("function");
    expect(typeof logger.setLevel).toBe("function");
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

  it("supports runtime level changes for parent and child loggers", () => {
    const { logger, records } = createCapturedLogger({ level: "info" });
    const child = logger.child({ service: "child" });

    expect(logger.getLevel()).toBe("info");
    logger.trace("hidden trace");
    logger.setLevel("trace");
    child.trace("visible trace");
    child.setLevel("warn");
    logger.info("hidden info");
    logger.warn("visible warn");

    expect(logger.getLevel()).toBe("warn");
    expect(child.getLevel()).toBe("warn");
    expect(records().map((record) => record.msg)).toEqual([
      "visible trace",
      "visible warn",
    ]);
    expect(records()[0]).toMatchObject({ service: "child", level: 10 });
    expect(records()[1]).toMatchObject({ level: 40 });
  });

  it("normalizes partial logger wrappers while preserving lifecycle and children", () => {
    const { logger, records } = createCapturedLogger({ level: "info" });
    const info = vi.fn();

    const normalized = normalizeVextLogger(logger, { info });

    expect(getLoggerLifecycle(normalized)).toBe(getLoggerLifecycle(logger));
    normalized.info("wrapped info");
    expect(info).toHaveBeenCalledWith("wrapped info");

    expect(normalized.getLevel()).toBe("info");
    normalized.setLevel("trace");
    expect(logger.getLevel()).toBe("trace");

    const child = normalized.child({ service: "child" });
    child.trace("child trace");

    expect(records()[0]).toMatchObject({
      service: "child",
      level: 10,
      msg: "child trace",
    });
  });

  it("rejects invalid runtime levels", () => {
    const { logger } = createCapturedLogger();

    expect(() => logger.setLevel("verbose" as never)).toThrow(
      "logger level must be one of",
    );
    expect(() => logger.setLevel(undefined as never)).toThrow(
      "logger level must be one of",
    );
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

  it("redacts exact keys and paths without mutating input objects", () => {
    const { logger, records } = createCapturedLogger({
      redactKeys: ["password"],
      redactPaths: ["user.token", "users.0.secret"],
      redactValue: "***",
    });
    const payload = {
      password: "top-secret",
      user: {
        token: "token-1",
        password: "nested-password",
      },
      users: [{ secret: "array-secret-1" }, { secret: "array-secret-2" }],
    };

    logger.info(payload, "login");

    expect(records()[0]).toMatchObject({
      password: "***",
      user: { token: "***", password: "***" },
      users: [{ secret: "***" }, { secret: "array-secret-2" }],
      msg: "login",
    });
    expect(payload).toEqual({
      password: "top-secret",
      user: {
        token: "token-1",
        password: "nested-password",
      },
      users: [{ secret: "array-secret-1" }, { secret: "array-secret-2" }],
    });
  });

  it("does not redact the reserved top-level level field", () => {
    const { logger, records } = createCapturedLogger({
      redactKeys: ["level"],
      redactPaths: ["level"],
    });

    logger.info({ level: "private" }, "reserved");

    expect(records()[0]!.level).toBe(30);
    expect(records()[0]).not.toHaveProperty("level", "[Redacted]");
  });

  it("keeps JSON output valid when redacting protocol fields", () => {
    const { logger, records } = createCapturedLogger({
      redactKeys: ["pid"],
      redactPaths: ["msg"],
      redactValue: "[Hidden]",
    });

    logger.info("startup");

    expect(records()[0]).toMatchObject({
      level: 30,
      pid: "[Hidden]",
      msg: "[Hidden]",
    });
  });

  it("redacts serialized error fields", () => {
    const { logger, records } = createCapturedLogger({
      redactPaths: ["err.message", "err.stack"],
    });

    logger.error(new Error("database password leaked"), "failed");

    expect(records()[0]!.err).toMatchObject({
      message: "[Redacted]",
      stack: "[Redacted]",
    });
  });

  it("redacts whole array items", () => {
    const { logger, records } = createCapturedLogger({
      redactPaths: ["items.0"],
      redactKeys: ["secret"],
    });

    logger.info(
      {
        items: [{ token: "first" }, { token: "second" }],
        nested: { secret: "value" },
      },
      "redaction edges",
    );

    expect(records()[0]).toMatchObject({
      items: ["[Redacted]", { token: "second" }],
      nested: {
        secret: "[Redacted]",
      },
      msg: "redaction edges",
    });
  });

  it("preserves circular references inside direct redaction records", () => {
    const circular: Record<string, unknown> = { name: "root", secret: "value" };
    circular.self = circular;

    const redacted = redactRecord(
      { level: 30, circular },
      compileRedactionOptions({ keys: ["secret"] }),
    );

    expect(redacted.circular).toMatchObject({
      name: "root",
      secret: "[Redacted]",
    });
    expect((redacted.circular as Record<string, unknown>).self).toBe(
      redacted.circular,
    );
  });

  it("normalizes edge log argument shapes and serializes omitted protocol fields", () => {
    expect(normalizeLogArgs([])).toEqual({});
    expect(normalizeLogArgs(["hello"])).toEqual({ message: "hello" });
    expect(normalizeLogArgs(["hello", undefined])).toEqual({
      message: "hello",
    });
    expect(normalizeLogArgs(["hello %s", "Ada"])).toEqual({
      message: "hello Ada",
    });
    expect(normalizeLogArgs([new Error("boom")])).toMatchObject({
      message: "boom",
    });
    expect(normalizeLogArgs([{ ok: true }])).toEqual({
      record: { ok: true },
      message: undefined,
    });
    expect(normalizeLogArgs([new Date("2026-01-02T03:04:05.000Z")])).toEqual({
      message: "2026-01-02T03:04:05.000Z",
    });
    expect(normalizeLogArgs([42])).toEqual({ message: "42" });

    expect(JSON.parse(serializeJsonRecord({ level: 30 }))).toEqual({
      level: 30,
    });
  });

  it("normalizes redaction option lists defensively", () => {
    const inactive = compileRedactionOptions(undefined);
    expect(inactive.active).toBe(false);

    const compiled = compileRedactionOptions({
      keys: [" password ", 123 as never, ""],
      paths: ["user..token", " items.0 ", ""],
    });
    expect(compiled.active).toBe(true);
    expect(compiled.keys.has("password")).toBe(true);
  });

  it("covers timestamp and pretty formatter edge modes", () => {
    expect(appendTimestampString('"level":30', "none")).toBe('"level":30');
    expect(appendTimestampString('"level":30', "iso")).toMatch(
      /^"level":30,"time":"\d{4}-\d{2}-\d{2}T/,
    );
    expect(appendTimestampString('"level":30', "epoch")).toMatch(
      /^"level":30,"time":\d+$/,
    );
    expect(formatPrettyTime("not-a-date")).toMatch(/^\d{4}-\d{2}-\d{2} /);
    expect(formatPrettyTime({})).toMatch(/^\d{4}-\d{2}-\d{2} /);

    expect(
      formatPrettyRecord(
        {
          level: 30,
          time: "2026-01-02T03:04:05.000Z",
          msg: "plain",
        },
        "info",
        undefined,
      ),
    ).toBe("[2026-01-02 03:04:05.000] INFO: plain\n");
    expect(
      formatPrettyRecord(
        {
          level: 30,
          time: "2026-01-02T03:04:05.000Z",
          msg: 123 as never,
        },
        "info",
        undefined,
      ),
    ).toBe("[2026-01-02 03:04:05.000] INFO: \n");

    const pretty = formatPrettyRecord(
      {
        level: 20,
        time: "2026-01-02T03:04:05.000Z",
        msg: "custom ignore",
        keep: 1,
        hidden: 2,
      },
      "debug",
      { ignore: " hidden , , " },
    );
    expect(pretty).toContain('"keep":1');
    expect(pretty).not.toContain("hidden");
  });

  it("serializes JSON utility edge values and clears the shape cache", () => {
    expect(quote("line\nbreak")).toBe(JSON.stringify("line\nbreak"));
    expect(appendRecordString('"level":30', undefined)).toBe('"level":30');
    expect(appendRecordString('"level":30', { skip: undefined })).toBe(
      '"level":30',
    );
    expect(serializeValue(Number.NaN)).toBe("null");
    expect(serializeValue(true)).toBe("true");
    expect(serializeValue(false)).toBe("false");
    expect(serializeValue(10n)).toBe('"10"');
    expect(serializeValue(undefined)).toBeUndefined();
    expect(serializeValue(() => undefined)).toBeUndefined();
    expect(serializeValue(Symbol("s"))).toBeUndefined();
    expect(serializeValue(null)).toBe("null");
    expect(serializeValue(new Date("2026-01-02T03:04:05.000Z"))).toBe(
      '"2026-01-02T03:04:05.000Z"',
    );
    expect(JSON.parse(serializeValue(new TypeError("bad"))!)).toMatchObject({
      type: "TypeError",
      message: "bad",
    });

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const bareError = new Error("bare");
    bareError.name = "";
    bareError.stack = "";
    expect(serializeValue(circular)).toBe('{"self":"[Circular]"}');
    expect(serializeValue([undefined, () => undefined, Symbol("s")])).toBe(
      "[null,null,null]",
    );
    expect(toJsonRecord({ label: "value" })).toEqual({ label: "value" });
    expect(
      JSON.parse(
        serializeValue({
          text: "value",
          number: 2,
          nan: Number.NaN,
          enabled: true,
          disabled: false,
          amount: 4n,
          none: null,
          at: new Date("2026-01-02T03:04:05.000Z"),
          err: new TypeError("nested"),
          skip: undefined,
        })!,
      ),
    ).toMatchObject({
      text: "value",
      number: 2,
      nan: null,
      enabled: true,
      disabled: false,
      amount: "4",
      none: null,
      at: "2026-01-02T03:04:05.000Z",
      err: { type: "TypeError", message: "nested" },
    });
    expect(
      JSON.parse(
        serializeValue([
          "value",
          2,
          Number.NaN,
          true,
          false,
          4n,
          null,
          new Date("2026-01-02T03:04:05.000Z"),
          new TypeError("nested"),
        ])!,
      ),
    ).toMatchObject([
      "value",
      2,
      null,
      true,
      false,
      "4",
      null,
      "2026-01-02T03:04:05.000Z",
      { type: "TypeError", message: "nested" },
    ]);

    const normalized = toJsonRecord({
      level: "reserved",
      time: "reserved",
      msg: "reserved",
      label: "value",
      count: 2,
      enabled: true,
      none: null,
      amount: 3n,
      at: new Date("2026-01-02T03:04:05.000Z"),
      err: new Error("boom"),
      bareError,
      circular,
      list: [undefined, () => undefined, Symbol("s"), 1],
    });
    expect(normalized).toMatchObject({
      label: "value",
      count: 2,
      enabled: true,
      none: null,
      amount: "3",
      at: "2026-01-02T03:04:05.000Z",
      err: { type: "Error", message: "boom" },
      bareError: { type: "Error", message: "bare" },
      circular: { self: "[Circular]" },
      list: [null, null, null, 1],
    });
    expect(normalized).not.toHaveProperty("level");

    for (let index = 0; index < 130; index++) {
      appendRecordString('"level":30', { [`k${index}`]: index });
    }
    expect(appendRecordString('"level":30', { final: "ok" })).toBe(
      '"level":30,"final":"ok"',
    );
  });

  it("keeps core providers defensive and close idempotent", async () => {
    const sink = createMemoryLogSink();
    const core = createLoggerCore({
      sink,
      bindings: { service: "core" },
      timestamp: "none",
      format: "json",
      pid: 7,
      hostname: "test-host",
      contextProvider() {
        throw new Error("context failed");
      },
      mixin() {
        return Promise.resolve({ ignored: true }) as never;
      },
    });

    expect(core.level).toBe("info");
    expect(core.getLevel()).toBe("info");
    expect(core.isLevelEnabled("info")).toBe(true);
    expect(core.isLevelEnabled("debug")).toBe(false);

    core.info("core safe");
    await core.flush();
    await core.close();
    await core.close();
    core.error("after close");

    expect(JSON.parse(sink.lines[0]!)).toMatchObject({
      level: 30,
      msg: "core safe",
      service: "core",
      pid: 7,
      hostname: "test-host",
    });
    expect(JSON.parse(sink.lines[0]!)).not.toHaveProperty("ignored");
    expect(sink.lines).toHaveLength(1);

    const defaultSink = createMemoryLogSink();
    const defaultCore = createLoggerCore({ sink: defaultSink });
    defaultCore.info("default options");
    expect(JSON.parse(defaultSink.lines[0]!)).toMatchObject({
      level: 30,
      msg: "default options",
    });
  });

  it("covers createLogger default branches without emitting logs", () => {
    const defaultLogger = createLogger();
    expect(getLoggerLifecycle(defaultLogger)).toBeDefined();

    const previousNodeEnv = process.env.NODE_ENV;
    const sink = createMemoryLogSink();
    try {
      process.env.NODE_ENV = "production";
      const logger = createLogger({}, { sink });
      logger.info("production default");
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }

    expect(JSON.parse(sink.lines[0]!)).toMatchObject({
      level: 30,
      msg: "production default",
    });
  });

  it("warns once when user logger mixin is async or throws", () => {
    const asyncSink = createMemoryLogSink();
    const asyncLogger = createLogger(
      {
        pretty: false,
        mixin() {
          return Promise.resolve({ ignored: true }) as never;
        },
      },
      { sink: asyncSink },
    );

    asyncLogger.info("first");
    asyncLogger.info("second");

    const asyncRecords = asyncSink.lines.map(
      (line) => JSON.parse(line) as Record<string, unknown>,
    );
    expect(asyncRecords.map((record) => record.msg)).toEqual([
      "[vextjs] config.logger.mixin 返回了 Promise，mixin 必须是同步函数，已降级为 {}",
      "first",
      "second",
    ]);

    const thrown = new Error("mixin failed");
    const throwSink = createMemoryLogSink();
    const throwLogger = createLogger(
      {
        pretty: false,
        mixin() {
          throw thrown;
        },
      },
      { sink: throwSink },
    );

    throwLogger.info("first");
    throwLogger.info("second");

    const throwRecords = throwSink.lines.map(
      (line) => JSON.parse(line) as Record<string, unknown>,
    );
    expect(throwRecords).toHaveLength(3);
    expect(throwRecords[0]).toMatchObject({
      level: 40,
      msg: "[vextjs] config.logger.mixin 抛出异常，已降级为 {}",
      err: { message: "mixin failed" },
    });
    expect(throwRecords.slice(1).map((record) => record.msg)).toEqual([
      "first",
      "second",
    ]);

    const nullMixinSink = createMemoryLogSink();
    const nullMixinLogger = createLogger(
      {
        pretty: false,
        mixin() {
          return null as never;
        },
      },
      { sink: nullMixinSink },
    );
    nullMixinLogger.info("null mixin");
    expect(JSON.parse(nullMixinSink.lines[0]!)).toMatchObject({
      msg: "null mixin",
    });
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

  it("colors only the pretty level label when prettyColor is always", () => {
    const sink = createMemoryLogSink();
    const logger = createLogger(
      { pretty: true, prettyColor: "always" },
      { sink },
    );

    logger.info({ url: "/health" }, "pretty color");

    expect(sink.lines[0]).toContain("\x1b[32mINFO\x1b[0m: pretty color");
    expect(sink.lines[0]).toContain('"url":"/health"');
    expect(sink.lines[0]).not.toContain("\x1b[32m/health");
  });

  it("keeps JSON output uncolored even when prettyColor is always", () => {
    const sink = createMemoryLogSink();
    const logger = createLogger(
      { pretty: false, prettyColor: "always" },
      { sink },
    );

    logger.info("json plain");

    expect(sink.lines[0]).not.toContain("\x1b[");
    expect(JSON.parse(sink.lines[0]!)).toMatchObject({
      level: 30,
      msg: "json plain",
    });
  });

  it("resolves prettyColor auto from sink TTY and env overrides", () => {
    withLoggerEnv(
      { NO_COLOR: undefined, FORCE_COLOR: undefined, TERM: "xterm-256color" },
      () => {
        const ttySink = { ...createMemoryLogSink(), isTTY: true };
        createLogger({ pretty: true }, { sink: ttySink }).warn("tty auto");
        expect(ttySink.lines[0]).toContain("\x1b[33mWARN\x1b[0m");

        const nonTtySink = createMemoryLogSink();
        createLogger({ pretty: true }, { sink: nonTtySink }).warn("no tty");
        expect(nonTtySink.lines[0]).not.toContain("\x1b[");
      },
    );

    withLoggerEnv({ FORCE_COLOR: "1", NO_COLOR: undefined }, () => {
      const sink = createMemoryLogSink();
      createLogger({ pretty: true }, { sink }).info("forced");
      expect(sink.lines[0]).toContain("\x1b[32mINFO\x1b[0m");
    });

    withLoggerEnv({ FORCE_COLOR: "1", NO_COLOR: "1" }, () => {
      const sink = { ...createMemoryLogSink(), isTTY: true };
      createLogger({ pretty: true }, { sink }).error("forced over no color");
      expect(sink.lines[0]).toContain("\x1b[31mERROR\x1b[0m");
    });

    withLoggerEnv({ FORCE_COLOR: "0", NO_COLOR: undefined }, () => {
      const sink = { ...createMemoryLogSink(), isTTY: true };
      createLogger({ pretty: true }, { sink }).info("force disabled");
      expect(sink.lines[0]).not.toContain("\x1b[");
    });

    withLoggerEnv(
      { NO_COLOR: undefined, FORCE_COLOR: undefined, TERM: "dumb" },
      () => {
        const sink = { ...createMemoryLogSink(), isTTY: true };
        createLogger({ pretty: true }, { sink }).info("dumb terminal");
        expect(sink.lines[0]).not.toContain("\x1b[");
      },
    );
  });

  it("disables pretty colors when prettyColor is never", () => {
    const sink = { ...createMemoryLogSink(), isTTY: true };
    const logger = createLogger(
      { pretty: true, prettyColor: "never" },
      { sink },
    );

    logger.fatal("plain fatal");

    expect(sink.lines[0]).toContain("FATAL: plain fatal");
    expect(sink.lines[0]).not.toContain("\x1b[");
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

  it("applies redaction before pretty formatting", () => {
    const sink = createMemoryLogSink();
    const logger = createLogger(
      { pretty: true, prettyColor: "always", redactKeys: ["password"] },
      { sink },
    );

    logger.info({ password: "secret" }, "pretty redaction");

    expect(sink.lines[0]).toContain("\x1b[32mINFO\x1b[0m");
    expect(sink.lines[0]).toContain("[Redacted]");
    expect(sink.lines[0]).not.toContain("secret");
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
