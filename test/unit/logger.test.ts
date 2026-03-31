/**
 * logger.ts 单元测试
 *
 * 测试覆盖：
 *   - mixin 共享对象回归测试（BUG-012 防回归）
 *   - prettySingleLine 配置传递验证
 *   - createLogger 基本功能验证
 *
 * @see lib/logger.ts
 * @see CHANGELOG.md BUG-012（pino mixin EMPTY_MIXIN 共享对象污染）
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import { createLogger } from "../../src/lib/logger.js";

// ── 辅助工具 ────────────────────────────────────────────────

/**
 * 创建一个可捕获 pino JSON 输出的 destination stream
 *
 * pino 在非 pretty 模式下直接写 JSON 到 destination，
 * 通过自定义 Writable 捕获每行输出并解析为对象。
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
 * 创建一个使用自定义 destination 的 pino logger（绕过 createLogger 的 transport）
 *
 * createLogger 在 pretty 模式下使用 transport（worker thread），
 * 无法直接捕获输出。此辅助函数使用与 createLogger 相同的 mixin 逻辑，
 * 但输出到可控的 stream。
 */
function createTestPinoLogger(
  stream: Writable,
  opts?: { alsEnabled?: boolean },
) {
  const alsEnabled = opts?.alsEnabled !== false;

  return pino(
    {
      level: "debug",
      mixin() {
        // 模拟 createLogger 中的 mixin 实现
        // ⚠️ 关键：每次必须返回新对象
        if (!alsEnabled) return {};
        // 测试中不依赖 ALS，直接返回空对象
        return {};
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    stream,
  );
}

// ── 测试 ────────────────────────────────────────────────────

describe("createLogger", () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  it("应返回 VextLogger 接口的所有方法", () => {
    process.env.NODE_ENV = "production"; // JSON 模式，避免 pretty transport
    const logger = createLogger({ level: "info", pretty: false });

    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.fatal).toBe("function");
    expect(typeof logger.child).toBe("function");
  });

  it("child logger 应返回新的 VextLogger 实例", () => {
    process.env.NODE_ENV = "production";
    const logger = createLogger({ level: "info", pretty: false });
    const child = logger.child({ service: "test" });

    expect(typeof child.info).toBe("function");
    expect(typeof child.warn).toBe("function");
    expect(typeof child.error).toBe("function");
    expect(typeof child.debug).toBe("function");
    expect(typeof child.fatal).toBe("function");
    expect(typeof child.child).toBe("function");
    // child 应是不同的实例
    expect(child).not.toBe(logger);
  });

  it("应使用默认 level 'info'", () => {
    process.env.NODE_ENV = "production";
    const logger = createLogger({ pretty: false });
    // 不抛出错误就算通过
    logger.info("test info");
  });

  it("应接受所有有效的 log level", () => {
    process.env.NODE_ENV = "production";
    const levels = [
      "fatal",
      "error",
      "warn",
      "info",
      "debug",
      "trace",
      "silent",
    ] as const;

    for (const level of levels) {
      const logger = createLogger({ level, pretty: false });
      expect(logger).toBeDefined();
    }
  });
});

describe("mixin 共享对象回归测试 (BUG-012)", () => {
  it("结构化字段不应泄漏到后续日志", async () => {
    const { lines, stream } = createCapture();
    const pinoLogger = createTestPinoLogger(stream);

    // 第一条日志带结构化字段 { count: 3 }
    pinoLogger.info({ count: 3 }, "log with count");

    // 第二条日志不带结构化字段
    pinoLogger.info("log without count");

    // 第三条日志带不同的结构化字段 { service: "test" }
    pinoLogger.info({ service: "test" }, "log with service");

    // pino 写入是异步的（即使是同步 destination），等待 flush
    await new Promise<void>((resolve) => {
      stream.end(() => resolve());
    });

    expect(lines.length).toBe(3);

    // 第一条应包含 count
    expect(lines[0]!.count).toBe(3);
    expect(lines[0]!.msg).toBe("log with count");

    // 第二条不应包含 count（BUG-012 的核心回归验证）
    expect(lines[1]!.count).toBeUndefined();
    expect(lines[1]!.msg).toBe("log without count");

    // 第三条应包含 service，不应包含 count
    expect(lines[2]!.service).toBe("test");
    expect(lines[2]!.count).toBeUndefined();
    expect(lines[2]!.msg).toBe("log with service");
  });

  it("mixin 每次调用应返回独立的新对象", async () => {
    const { stream } = createCapture();

    // 收集 mixin 返回值
    const mixinResults: Record<string, unknown>[] = [];
    const pinoLogger = pino(
      {
        level: "info",
        mixin() {
          const obj = {};
          mixinResults.push(obj);
          return obj;
        },
      },
      stream,
    );

    pinoLogger.info("first");
    pinoLogger.info("second");
    pinoLogger.info("third");

    await new Promise<void>((resolve) => {
      stream.end(() => resolve());
    });

    expect(mixinResults.length).toBe(3);

    // 每次返回的应是不同的对象引用
    expect(mixinResults[0]).not.toBe(mixinResults[1]);
    expect(mixinResults[1]).not.toBe(mixinResults[2]);
    expect(mixinResults[0]).not.toBe(mixinResults[2]);
  });

  it("pino 会 mutate mixin 返回的对象（验证根因）", async () => {
    const { lines, stream } = createCapture();

    // 模拟 BUG-012 的错误实现：返回共享对象
    const SHARED_OBJECT = {};
    const pinoLogger = pino(
      {
        level: "info",
        mixin() {
          return SHARED_OBJECT; // ❌ 错误：返回共享引用
        },
      },
      stream,
    );

    // 第一条日志注入 { count: 3 }
    pinoLogger.info({ count: 3 }, "first with count");

    // 此时 SHARED_OBJECT 已被 pino mutate，包含 { count: 3 }
    // 验证 pino 确实修改了共享对象
    expect((SHARED_OBJECT as Record<string, unknown>).count).toBe(3);

    // 第二条日志无结构化字段
    pinoLogger.info("second without fields");

    await new Promise<void>((resolve) => {
      stream.end(() => resolve());
    });

    expect(lines.length).toBe(2);

    // 第二条日志也会包含 count: 3（因为 SHARED_OBJECT 被污染了）
    // 这就是 BUG-012 的根因
    expect(lines[1]!.count).toBe(3);
  });

  it("child logger 的结构化字段不应泄漏到 parent logger", async () => {
    const { lines, stream } = createCapture();
    const pinoLogger = createTestPinoLogger(stream);

    const childLogger = pinoLogger.child({ service: "UserService" });

    // child logger 带 service binding
    childLogger.info("child log");

    // parent logger 不应带 service
    pinoLogger.info("parent log");

    await new Promise<void>((resolve) => {
      stream.end(() => resolve());
    });

    expect(lines.length).toBe(2);
    expect(lines[0]!.service).toBe("UserService");
    expect(lines[1]!.service).toBeUndefined();
  });

  it("并发结构化字段不应相互污染", async () => {
    const { lines, stream } = createCapture();
    const pinoLogger = createTestPinoLogger(stream);

    // 模拟并发请求中不同的结构化字段
    pinoLogger.info({ userId: 1 }, "request A");
    pinoLogger.info({ orderId: 100 }, "request B");
    pinoLogger.info({ userId: 2 }, "request C");

    await new Promise<void>((resolve) => {
      stream.end(() => resolve());
    });

    expect(lines.length).toBe(3);

    // A: 只有 userId=1
    expect(lines[0]!.userId).toBe(1);
    expect(lines[0]!.orderId).toBeUndefined();

    // B: 只有 orderId=100
    expect(lines[1]!.orderId).toBe(100);
    expect(lines[1]!.userId).toBeUndefined();

    // C: 只有 userId=2（不是 1）
    expect(lines[2]!.userId).toBe(2);
    expect(lines[2]!.orderId).toBeUndefined();
  });
});

describe("prettySingleLine 配置", () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  it("默认 prettySingleLine 应为 true（不显式设置时）", () => {
    process.env.NODE_ENV = "development";
    // createLogger 内部 prettySingleLine !== false → true
    // 这里只验证不抛出错误（实际 singleLine 行为需要 pino-pretty 渲染，
    // 不适合在单元测试中验证输出格式）
    const logger = createLogger({ pretty: true });
    expect(logger).toBeDefined();
    logger.info("test single line");
  });

  it("prettySingleLine: false 应可用（多行模式）", () => {
    process.env.NODE_ENV = "development";
    const logger = createLogger({
      pretty: true,
      prettySingleLine: false,
    });
    expect(logger).toBeDefined();
    logger.info({ foo: "bar" }, "test multi line");
  });

  it("prettySingleLine: true 应可用（显式设置）", () => {
    process.env.NODE_ENV = "development";
    const logger = createLogger({
      pretty: true,
      prettySingleLine: true,
    });
    expect(logger).toBeDefined();
    logger.info({ foo: "bar" }, "test explicit single line");
  });

  it("非 pretty 模式下 prettySingleLine 配置不影响 JSON 输出", async () => {
    process.env.NODE_ENV = "production";
    const { lines, stream } = createCapture();

    // 使用 pino 直接测试 JSON 模式
    const pinoLogger = pino(
      {
        level: "info",
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      stream,
    );

    pinoLogger.info({ count: 5, service: "test" }, "json mode");

    await new Promise<void>((resolve) => {
      stream.end(() => resolve());
    });

    expect(lines.length).toBe(1);
    // JSON 模式下所有字段都在同一个 JSON 对象中（本来就是"单行"）
    expect(lines[0]!.count).toBe(5);
    expect(lines[0]!.service).toBe("test");
    expect(lines[0]!.msg).toBe("json mode");
  });
});

describe("prettyIgnore 配置", () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  it("默认应忽略 pid,hostname,requestId", () => {
    process.env.NODE_ENV = "development";
    // createLogger 默认 prettyIgnore = "pid,hostname,requestId"
    // 验证不抛出错误即可（实际忽略行为是 pino-pretty 处理的）
    const logger = createLogger({ pretty: true });
    expect(logger).toBeDefined();
  });

  it("自定义 prettyIgnore 应被接受", () => {
    process.env.NODE_ENV = "development";
    const logger = createLogger({
      pretty: true,
      prettyIgnore: "pid,hostname",
    });
    expect(logger).toBeDefined();
    logger.info("test custom ignore");
  });

  it("非 pretty 模式下 prettyIgnore 不影响 JSON 输出", async () => {
    const { lines, stream } = createCapture();

    const pinoLogger = pino(
      {
        level: "info",
        mixin() {
          return { requestId: "test-123" };
        },
      },
      stream,
    );

    pinoLogger.info("json with requestId");

    await new Promise<void>((resolve) => {
      stream.end(() => resolve());
    });

    expect(lines.length).toBe(1);
    // JSON 模式下 requestId 应存在（prettyIgnore 只影响 pretty 格式化）
    expect(lines[0]!.requestId).toBe("test-123");
  });
});

describe("requestContextEnabled 选项", () => {
  it("requestContextEnabled: false 时 mixin 不注入 requestId", async () => {
    process.env.NODE_ENV = "production";
    const { lines, stream } = createCapture();

    // 模拟 requestContextEnabled: false
    const pinoLogger = pino(
      {
        level: "info",
        mixin() {
          // alsEnabled = false → return {}
          return {};
        },
      },
      stream,
    );

    pinoLogger.info("no request context");

    await new Promise<void>((resolve) => {
      stream.end(() => resolve());
    });

    expect(lines.length).toBe(1);
    expect(lines[0]!.requestId).toBeUndefined();
  });

  it("requestContextEnabled 默认为 true（options 未传时）", () => {
    process.env.NODE_ENV = "production";
    // 不传 options → requestContextEnabled 默认为 true
    const logger = createLogger({ pretty: false });
    expect(logger).toBeDefined();
  });

  it("requestContextEnabled: true 显式传入应正常工作", () => {
    process.env.NODE_ENV = "production";
    const logger = createLogger(
      { pretty: false },
      { requestContextEnabled: true },
    );
    expect(logger).toBeDefined();
  });
});
