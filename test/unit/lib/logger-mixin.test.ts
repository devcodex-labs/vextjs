/**
 * logger-mixin.test.ts — F-02 / F-03 logger mixin 扩展验证
 *
 * 测试覆盖：
 *   F-02 — VextLoggerConfig.mixin 用户自定义字段扩展
 *     - 用户 mixin 返回的字段出现在日志输出中
 *     - 用户 mixin 尝试覆盖 requestId → 框架强制使用 ALS 值
 *     - 用户未配置 mixin → 行为与现有完全一致（零 overhead）
 *     - 用户 mixin 抛出异常 → 降级为 {} + warn 日志（防日志风暴，仅 warn 一次）
 *     - 用户 mixin 是 async 函数 → 降级为 {} + warn 日志
 *
 *   F-03 — RequestContextStore traceId / spanId 自动注入
 *     - ALS store 中存在 traceId → 日志含 trace_id 字段
 *     - ALS store 中存在 spanId  → 日志含 span_id 字段
 *     - ALS store 中无 traceId/spanId → 日志无对应字段（零污染）
 *
 *   合并优先级验证
 *     - 用户 mixin 字段优先于 ALS trace_id / span_id
 *     - requestId 始终使用框架 ALS 值（不可被用户 mixin 覆盖）
 *     - ALS 不存在时 result 对象中不含 requestId key（非 undefined）
 *
 *   ALS 禁用场景
 *     - requestContextEnabled: false 时内置字段跳过，用户 mixin 仍生效
 *
 * 测试方法：
 *   createLogger 的 mixin 逻辑与 pino 深度耦合，无法直接传入 destination。
 *   此处采用「可测 mixin 工厂」模式：
 *     1. buildMixin() — 复刻 createLogger 内部的 mixin 函数逻辑，
 *        接受相同的参数（config、alsEnabled、pinoInstance 引用），
 *        便于在受控的 pino 实例（自定义 destination）中验证输出。
 *     2. 对 createLogger 本身做冒烟测试，验证不抛出、返回正确接口。
 *
 * @see src/lib/logger.ts（被测实现）
 * @see src/types/app.ts VextLoggerConfig.mixin 字段
 * @see src/lib/request-context.ts RequestContextStore.traceId / spanId
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import type { Logger as PinoLogger } from "pino";
import { createLogger } from "../../../src/lib/logger.js";
import { requestContext } from "../../../src/lib/request-context.js";
import type { VextLoggerConfig } from "../../../src/types/app.js";

// ── 常量（与 logger.ts 保持一致）────────────────────────────
const EMPTY_MIXIN: Record<string, unknown> = {};

// ── 辅助工具 ─────────────────────────────────────────────────

/**
 * 创建可捕获 pino JSON 输出的 destination stream
 */
function createCapture(): {
  lines: Record<string, unknown>[];
  stream: Writable;
} {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      const str = chunk.toString().trim();
      if (str) {
        for (const line of str.split("\n")) {
          try {
            lines.push(JSON.parse(line));
          } catch {
            // 非 JSON 行忽略
          }
        }
      }
      callback();
    },
  });
  return { lines, stream };
}

/**
 * 复刻 createLogger 内部 mixin 函数的工厂
 *
 * 接受与 createLogger 相同的参数，返回与 createLogger 中相同逻辑的 mixin 函数。
 * 通过此工厂可将 mixin 接入受控的 pino 实例（自定义 destination），
 * 捕获日志输出进行断言。
 *
 * @param config     VextLoggerConfig（含可选 mixin 字段）
 * @param alsEnabled 是否启用 AsyncLocalStorage（对应 requestContextEnabled）
 * @param getPino    惰性获取 pinoInstance 的函数（对应 createLogger 中的前向引用）
 */
function buildMixin(
  config: VextLoggerConfig,
  alsEnabled: boolean,
  getPino: () => PinoLogger,
): () => Record<string, unknown> {
  let _mixinWarnEmitted = false;

  return function mixin(): Record<string, unknown> {
    // ── 层1：框架内置字段 ──────────────────────────────
    const builtIn: Record<string, unknown> = {};

    if (alsEnabled) {
      const store = requestContext.getStore();
      if (store?.requestId) builtIn.requestId = store.requestId;
      if (store?.traceId) builtIn.trace_id = store.traceId;
      if (store?.spanId) builtIn.span_id = store.spanId;
    }

    // ── 层2：用户自定义 mixin ──────────────────────────
    const userFields: Record<string, unknown> = (() => {
      if (!config.mixin) return EMPTY_MIXIN;
      try {
        const mixinResult = config.mixin();
        // 防御：async mixin 返回 Promise
        if (
          mixinResult !== null &&
          typeof mixinResult === "object" &&
          typeof (mixinResult as Record<string, unknown>)["then"] === "function"
        ) {
          if (!_mixinWarnEmitted) {
            _mixinWarnEmitted = true;
            getPino().warn(
              "[vextjs] config.logger.mixin 返回了 Promise，mixin 必须是同步函数，已降级为 {}",
            );
          }
          return EMPTY_MIXIN;
        }
        return mixinResult ?? EMPTY_MIXIN;
      } catch (err) {
        if (!_mixinWarnEmitted) {
          _mixinWarnEmitted = true;
          getPino().warn(
            { err },
            "[vextjs] config.logger.mixin 抛出异常，已降级为 {}",
          );
        }
        return EMPTY_MIXIN;
      }
    })();

    // ── 合并 + requestId 保护 ──────────────────────────
    const result: Record<string, unknown> = { ...builtIn, ...userFields };
    if (builtIn.requestId !== undefined) {
      result.requestId = builtIn.requestId;
    } else {
      delete result.requestId;
    }

    return result;
  };
}

/**
 * 创建用于测试的 pino 实例（非 pretty 模式，输出到自定义 stream）
 */
function createTestLogger(
  config: VextLoggerConfig,
  stream: Writable,
  opts?: { alsEnabled?: boolean },
): PinoLogger {
  const alsEnabled = opts?.alsEnabled !== false;
  let pinoInstance: PinoLogger;

  const mixinFn = buildMixin(config, alsEnabled, () => pinoInstance);

  pinoInstance = pino(
    {
      level: "debug",
      mixin: mixinFn,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    stream,
  );

  return pinoInstance;
}

/** 等待 pino stream flush */
function flush(stream: Writable): Promise<void> {
  return new Promise<void>((resolve) => stream.end(() => resolve()));
}

// ═══════════════════════════════════════════════════════════════
// F-02：用户 mixin 字段扩展
// ═══════════════════════════════════════════════════════════════

describe("F-02 — 用户 mixin 字段扩展", () => {
  // ── 基础功能 ──────────────────────────────────────────────

  it("用户 mixin 返回的字段应出现在日志输出中", async () => {
    const { lines, stream } = createCapture();
    const logger = createTestLogger(
      {
        mixin() {
          return { trace_id: "abc123", custom_field: "hello" };
        },
      },
      stream,
    );

    logger.info("test message");
    await flush(stream);

    expect(lines).toHaveLength(1);
    expect(lines[0]!.trace_id).toBe("abc123");
    expect(lines[0]!.custom_field).toBe("hello");
    expect(lines[0]!.msg).toBe("test message");
  });

  it("未配置 mixin 时，日志字段与现有行为完全一致（仅含 msg / level / time）", async () => {
    const { lines, stream } = createCapture();
    const logger = createTestLogger({}, stream);

    logger.info("no mixin");
    await flush(stream);

    expect(lines).toHaveLength(1);
    expect(lines[0]!.msg).toBe("no mixin");
    // 无 ALS 上下文时不含 requestId / trace_id / span_id
    expect(lines[0]!.requestId).toBeUndefined();
    expect(lines[0]!.trace_id).toBeUndefined();
    expect(lines[0]!.span_id).toBeUndefined();
  });

  it("mixin 在每条日志写入前都会调用", async () => {
    const { lines, stream } = createCapture();
    let callCount = 0;

    const logger = createTestLogger(
      {
        mixin() {
          callCount++;
          return { call: callCount };
        },
      },
      stream,
    );

    logger.info("first");
    logger.info("second");
    logger.info("third");
    await flush(stream);

    expect(lines).toHaveLength(3);
    expect(callCount).toBe(3);
    expect(lines[0]!.call).toBe(1);
    expect(lines[1]!.call).toBe(2);
    expect(lines[2]!.call).toBe(3);
  });

  // ── requestId 保护 ────────────────────────────────────────

  it("用户 mixin 尝试覆盖 requestId → 框架强制使用 ALS 值", async () => {
    const { lines, stream } = createCapture();
    const logger = createTestLogger(
      {
        mixin() {
          return { requestId: "user-injected-id" }; // 尝试注入
        },
      },
      stream,
    );

    // 在 ALS 上下文中运行（有 requestId）
    await requestContext.run({ requestId: "framework-req-id" }, async () => {
      logger.info("inside als");
      await flush(stream);
    });

    expect(lines).toHaveLength(1);
    // 框架 ALS 值优先，用户注入的值被覆盖
    expect(lines[0]!.requestId).toBe("framework-req-id");
  });

  it("无 ALS 上下文时，用户 mixin 注入的 requestId key 被删除（结果无此 key）", async () => {
    const { lines, stream } = createCapture();
    const logger = createTestLogger(
      {
        mixin() {
          return { requestId: "sneaky-id" }; // 尝试注入
        },
      },
      stream,
    );

    logger.info("outside als");
    await flush(stream);

    expect(lines).toHaveLength(1);
    // 不含 requestId key（而非 undefined 值）
    expect(Object.keys(lines[0]!)).not.toContain("requestId");
  });

  it("无 ALS 上下文时，用户 mixin 的其他字段正常注入", async () => {
    const { lines, stream } = createCapture();
    const logger = createTestLogger(
      {
        mixin() {
          return { env: "production", version: "1.2.3" };
        },
      },
      stream,
    );

    logger.info("startup");
    await flush(stream);

    expect(lines[0]!.env).toBe("production");
    expect(lines[0]!.version).toBe("1.2.3");
  });

  // ── 异常处理 ──────────────────────────────────────────────

  it("mixin 抛出异常 → 降级为 {}，业务日志正常写入", async () => {
    const { lines, stream } = createCapture();
    const logger = createTestLogger(
      {
        mixin() {
          throw new Error("mixin boom");
        },
      },
      stream,
    );

    // 应写入降级 warn + 业务 info
    logger.info("after mixin error");
    await flush(stream);

    // 业务日志仍写入（mixin 异常不阻断日志）
    const infoLine = lines.find((l) => l.msg === "after mixin error");
    expect(infoLine).toBeDefined();
    // 不含 mixin 字段（降级为 {}）
    expect(infoLine!.trace_id).toBeUndefined();
  });

  it("mixin 抛出异常 → warn 日志只输出一次（防日志风暴）", async () => {
    const { lines, stream } = createCapture();
    let throwCount = 0;

    const logger = createTestLogger(
      {
        mixin() {
          throwCount++;
          throw new Error(`error #${throwCount}`);
        },
      },
      stream,
    );

    // 连续写 5 条日志，mixin 每次都抛出
    for (let i = 0; i < 5; i++) {
      logger.info(`log ${i}`);
    }
    await flush(stream);

    // mixin 至少被调用了 5 次（对应 5 条业务日志）；
    // 第 1 次抛出时触发 pinoInstance.warn()，warn 自身也会触发一次 mixin（第 6 次），
    // 此时 _mixinWarnEmitted 已为 true，直接返回 EMPTY_MIXIN，不再递归。
    expect(throwCount).toBeGreaterThanOrEqual(5);

    // warn 日志只有 1 条（防日志风暴的核心断言）
    const warnLines = lines.filter(
      (l) =>
        l.level === 40 && // pino warn level = 40
        typeof l.msg === "string" &&
        (l.msg as string).includes("mixin"),
    );
    expect(warnLines).toHaveLength(1);
  });

  it("async mixin（返回 Promise）→ 降级为 {}，warn 日志只输出一次", async () => {
    const { lines, stream } = createCapture();

    const logger = createTestLogger(
      {
        // 用户误传 async 函数
        mixin: (async () => ({ trace_id: "should-not-appear" })) as any,
      },
      stream,
    );

    logger.info("first");
    logger.info("second");
    await flush(stream);

    // trace_id 不应出现（Promise 对象不是有效的 mixin 结果）
    expect(lines[0]!.trace_id).toBeUndefined();

    // warn 日志只有 1 条
    const warnLines = lines.filter(
      (l) =>
        l.level === 40 &&
        typeof l.msg === "string" &&
        (l.msg as string).includes("Promise"),
    );
    expect(warnLines).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// F-03：ALS traceId / spanId 自动注入
// ═══════════════════════════════════════════════════════════════

describe("F-03 — ALS trace context 自动注入", () => {
  it("ALS store 含 traceId → 日志含 trace_id 字段（OTEL 下划线命名）", async () => {
    const { lines, stream } = createCapture();
    const logger = createTestLogger({}, stream);

    await requestContext.run(
      { requestId: "req-1", traceId: "trace-abc-123" },
      async () => {
        logger.info("traced request");
        await flush(stream);
      },
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]!.trace_id).toBe("trace-abc-123");
    // ALS 字段名为驼峰（traceId），日志字段名为下划线（trace_id）
    expect(lines[0]!.traceId).toBeUndefined();
  });

  it("ALS store 含 spanId → 日志含 span_id 字段（OTEL 下划线命名）", async () => {
    const { lines, stream } = createCapture();
    const logger = createTestLogger({}, stream);

    await requestContext.run(
      { requestId: "req-2", spanId: "span-def-456" },
      async () => {
        logger.info("spanned request");
        await flush(stream);
      },
    );

    expect(lines[0]!.span_id).toBe("span-def-456");
    expect(lines[0]!.spanId).toBeUndefined();
  });

  it("ALS store 同时含 traceId + spanId → 日志同时含 trace_id + span_id", async () => {
    const { lines, stream } = createCapture();
    const logger = createTestLogger({}, stream);

    await requestContext.run(
      {
        requestId: "req-3",
        traceId: "full-trace-id",
        spanId: "full-span-id",
      },
      async () => {
        logger.info("full otel context");
        await flush(stream);
      },
    );

    expect(lines[0]!.trace_id).toBe("full-trace-id");
    expect(lines[0]!.span_id).toBe("full-span-id");
    expect(lines[0]!.requestId).toBe("req-3");
  });

  it("ALS store 无 traceId / spanId → 日志不含这两个字段（零污染）", async () => {
    const { lines, stream } = createCapture();
    const logger = createTestLogger({}, stream);

    await requestContext.run({ requestId: "req-4" }, async () => {
      logger.info("no trace");
      await flush(stream);
    });

    expect(lines[0]!.requestId).toBe("req-4");
    expect(lines[0]!.trace_id).toBeUndefined();
    expect(lines[0]!.span_id).toBeUndefined();
  });

  it("ALS 上下文外（启动日志等）→ 不含 requestId / trace_id / span_id", async () => {
    const { lines, stream } = createCapture();
    const logger = createTestLogger({}, stream);

    // 不在 requestContext.run() 内部调用
    logger.info("startup log");
    await flush(stream);

    expect(Object.keys(lines[0]!)).not.toContain("requestId");
    expect(lines[0]!.trace_id).toBeUndefined();
    expect(lines[0]!.span_id).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// 合并优先级验证
// ═══════════════════════════════════════════════════════════════

describe("合并优先级 — 用户 mixin vs ALS 内置字段", () => {
  it("用户 mixin 的 trace_id 优先于 ALS 注入的 trace_id", async () => {
    const { lines, stream } = createCapture();

    const logger = createTestLogger(
      {
        mixin() {
          // 用户通过 F-02 mixin 实时读取 active span（比 ALS 存储更新）
          return { trace_id: "user-mixin-trace" };
        },
      },
      stream,
    );

    await requestContext.run(
      { requestId: "req-5", traceId: "als-trace" },
      async () => {
        logger.info("priority test");
        await flush(stream);
      },
    );

    // 用户 mixin 优先
    expect(lines[0]!.trace_id).toBe("user-mixin-trace");
    // requestId 仍来自框架 ALS（不可被用户覆盖）
    expect(lines[0]!.requestId).toBe("req-5");
  });

  it("用户 mixin 与 ALS 字段无重叠时，两者都出现在日志中", async () => {
    const { lines, stream } = createCapture();

    const logger = createTestLogger(
      {
        mixin() {
          return { custom_key: "custom_val" };
        },
      },
      stream,
    );

    await requestContext.run(
      { requestId: "req-6", traceId: "als-trace-2" },
      async () => {
        logger.info("combined fields");
        await flush(stream);
      },
    );

    expect(lines[0]!.custom_key).toBe("custom_val");
    expect(lines[0]!.trace_id).toBe("als-trace-2");
    expect(lines[0]!.requestId).toBe("req-6");
  });

  it("BUG-012 防回归：mixin 返回值不会污染后续日志", async () => {
    const { lines, stream } = createCapture();

    const logger = createTestLogger(
      {
        mixin() {
          return { dynamic_field: "value" };
        },
      },
      stream,
    );

    logger.info({ structured: 42 }, "first log");
    logger.info("second log");
    await flush(stream);

    expect(lines).toHaveLength(2);
    // 第二条日志不应包含第一条的 structured 字段（pino mutation 防污染）
    expect(lines[1]!.structured).toBeUndefined();
    // 但 mixin 返回的 dynamic_field 每次都存在
    expect(lines[0]!.dynamic_field).toBe("value");
    expect(lines[1]!.dynamic_field).toBe("value");
  });
});

// ═══════════════════════════════════════════════════════════════
// ALS 禁用场景
// ═══════════════════════════════════════════════════════════════

describe("ALS 禁用（requestContextEnabled: false）", () => {
  it("ALS 禁用时内置字段（requestId / trace_id）跳过，用户 mixin 仍生效", async () => {
    const { lines, stream } = createCapture();

    // alsEnabled = false
    const logger = createTestLogger(
      {
        mixin() {
          return { env_tag: "staging" };
        },
      },
      stream,
      { alsEnabled: false },
    );

    // 即使在 ALS 上下文中，alsEnabled=false 时也不读取 store
    await requestContext.run(
      { requestId: "req-ignored", traceId: "trace-ignored" },
      async () => {
        logger.info("als disabled test");
        await flush(stream);
      },
    );

    // 用户 mixin 字段正常出现
    expect(lines[0]!.env_tag).toBe("staging");
    // ALS 字段不应注入（alsEnabled=false）
    expect(Object.keys(lines[0]!)).not.toContain("requestId");
    expect(lines[0]!.trace_id).toBeUndefined();
  });

  it("ALS 禁用 + 无用户 mixin → 日志无额外字段（完全零 overhead 路径）", async () => {
    const { lines, stream } = createCapture();

    const logger = createTestLogger({}, stream, { alsEnabled: false });

    await requestContext.run({ requestId: "should-not-appear" }, async () => {
      logger.info("minimal log");
      await flush(stream);
    });

    expect(Object.keys(lines[0]!)).not.toContain("requestId");
    expect(lines[0]!.trace_id).toBeUndefined();
    expect(lines[0]!.msg).toBe("minimal log");
  });
});

// ═══════════════════════════════════════════════════════════════
// createLogger 冒烟测试（验证实际导出函数不抛出）
// ═══════════════════════════════════════════════════════════════

describe("createLogger — 集成冒烟测试", () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production"; // 避免 pino-pretty transport
  });

  afterEach(() => {
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  it("配置了合法 mixin 时 createLogger 不抛出", () => {
    expect(() => {
      createLogger({
        pretty: false,
        mixin() {
          return { tag: "test" };
        },
      });
    }).not.toThrow();
  });

  it("mixin 会在写日志时调用（而非初始化时）", () => {
    let called = false;

    const logger = createLogger({
      pretty: false,
      mixin() {
        called = true;
        return {};
      },
    });

    // createLogger 调用完毕，mixin 尚未被调用
    expect(called).toBe(false);

    // 写日志后 mixin 被调用
    logger.info("trigger mixin");
    expect(called).toBe(true);
  });

  it("mixin 抛出异常时 createLogger 返回的 logger 仍可正常使用", () => {
    const logger = createLogger({
      pretty: false,
      mixin() {
        throw new Error("always throws");
      },
    });

    // 不抛出，日志正常写入
    expect(() => logger.info("should not throw")).not.toThrow();
    expect(() => logger.warn("warn ok")).not.toThrow();
    expect(() => logger.error("error ok")).not.toThrow();
  });

  it("未配置 mixin 时 createLogger 行为与原有完全一致", () => {
    const logger = createLogger({ pretty: false });

    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.fatal).toBe("function");
    expect(typeof logger.child).toBe("function");

    expect(() => logger.info("no mixin")).not.toThrow();
  });
});
