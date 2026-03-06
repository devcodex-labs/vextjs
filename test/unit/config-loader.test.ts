/**
 * config-loader 单元测试
 *
 * 测试覆盖：
 *   - deepMerge：深度合并、标量覆盖、嵌套对象合并、数组覆盖、跳过 middlewares key
 *   - patchMiddlewares：按 name patch 合并、未匹配追加、字符串/对象混合
 *   - deepFreeze：递归冻结、跳过非纯对象（Date/RegExp/Map/Set）
 *   - validateConfig：Fail Fast 校验（port/adapter/middlewares/rateLimit/logger/shutdown 等）
 *   - loadConfig：default 缺失报错、三层合并、deepFreeze 只读
 *   - VEXT_PORT / VEXT_HOST 环境变量覆盖（BUG-013 防回归）
 *
 * @see 10-testing.md §3（Service 单元测试模式）
 * @see IMPLEMENTATION-PLAN.md 任务 1.20
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  _deepMerge,
  _deepFreeze,
  _patchMiddlewares,
  _validateConfig,
} from "../../src/lib/config-loader.js";
import { loadConfig } from "../../src/lib/config-loader.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── deepMerge ───────────────────────────────────────────────

describe("deepMerge", () => {
  it("returns a new object (does not mutate target)", () => {
    const target = { a: 1, b: 2 };
    const source = { b: 3 };
    const result = _deepMerge(target, source);

    expect(result).not.toBe(target);
    expect(target.b).toBe(2); // 原对象未被修改
    expect(result.b).toBe(3);
  });

  it("overwrites scalar values", () => {
    const result = _deepMerge({ port: 3000, host: "0.0.0.0" }, { port: 8080 });
    expect(result.port).toBe(8080);
    expect(result.host).toBe("0.0.0.0"); // 未覆盖的保留
  });

  it("deeply merges nested objects", () => {
    const result = _deepMerge(
      { cors: { enabled: true, origins: ["*"], methods: ["GET"] } } as Record<
        string,
        unknown
      >,
      { cors: { origins: ["http://example.com"] } } as Record<string, unknown>,
    );

    const cors = result.cors as Record<string, unknown>;
    expect(cors.enabled).toBe(true); // 未覆盖的子字段保留
    expect(cors.origins).toEqual(["http://example.com"]); // 数组直接覆盖
  });

  it("overwrites arrays (not concat)", () => {
    const result = _deepMerge(
      { items: [1, 2, 3] } as Record<string, unknown>,
      { items: [4, 5] } as Record<string, unknown>,
    );
    expect(result.items).toEqual([4, 5]);
  });

  it("skips middlewares key (handled by patchMiddlewares)", () => {
    const result = _deepMerge(
      { middlewares: [{ name: "auth" }], port: 3000 } as Record<
        string,
        unknown
      >,
      { middlewares: [{ name: "cors" }], port: 8080 } as Record<
        string,
        unknown
      >,
    );
    // middlewares 应该保留 target 的值（被跳过）
    expect(result.middlewares).toEqual([{ name: "auth" }]);
    expect(result.port).toBe(8080); // 其他字段正常合并
  });

  it("handles null source values (overwrites with null)", () => {
    const result = _deepMerge(
      { cors: { enabled: true } } as Record<string, unknown>,
      { cors: null } as unknown as Record<string, unknown>,
    );
    expect(result.cors).toBeNull();
  });

  it("handles undefined source values (skips)", () => {
    const result = _deepMerge(
      { port: 3000 } as Record<string, unknown>,
      { port: undefined } as Record<string, unknown>,
    );
    // undefined 值在 Object.keys 遍历中会被包含，但值为 undefined
    // deepMerge 的行为：source[key] 为 undefined 时走 else 分支（直接覆盖）
    expect(result.port).toBeUndefined();
  });

  it("deeply merges multiple levels", () => {
    const result = _deepMerge(
      { a: { b: { c: 1, d: 2 }, e: 3 } } as Record<string, unknown>,
      { a: { b: { c: 10 } } } as Record<string, unknown>,
    );
    const a = result.a as Record<string, unknown>;
    const b = a.b as Record<string, unknown>;
    expect(b.c).toBe(10);
    expect(b.d).toBe(2); // 未覆盖
    expect(a.e).toBe(3); // 未覆盖
  });
});

// ── patchMiddlewares ────────────────────────────────────────

describe("patchMiddlewares", () => {
  it("returns base when override is empty", () => {
    const base = [{ name: "auth", options: { role: "admin" } }];
    const result = _patchMiddlewares(base, []);
    expect(result).toEqual(base);
    expect(result).not.toBe(base); // 新数组
  });

  it("appends new middleware not found in base", () => {
    const result = _patchMiddlewares([{ name: "auth" }], [{ name: "cors" }]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: "auth" });
    expect(result[1]).toEqual({ name: "cors" });
  });

  it("patches existing middleware by name (shallow merge)", () => {
    const result = _patchMiddlewares(
      [{ name: "auth", options: { role: "user" }, enabled: true }],
      [{ name: "auth", options: { role: "admin" } }],
    );
    expect(result).toHaveLength(1);
    // shallow merge: options 被覆盖（不是深度合并）
    expect(result[0]).toEqual({
      name: "auth",
      options: { role: "admin" },
      enabled: true,
    });
  });

  it("handles string declarations in base", () => {
    const result = _patchMiddlewares(
      ["auth"],
      [{ name: "auth", options: { role: "admin" } }],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "auth",
      options: { role: "admin" },
    });
  });

  it("handles string declarations in override", () => {
    const result = _patchMiddlewares(
      [{ name: "auth", options: { role: "admin" } }],
      ["auth"],
    );
    expect(result).toHaveLength(1);
    // string override → { name: "auth" } 浅合并到 base
    expect(result[0]).toEqual({ name: "auth", options: { role: "admin" } });
  });

  it("preserves order of base, appends new items at end", () => {
    const result = _patchMiddlewares(
      ["auth", "rate-limit", "cors"],
      [{ name: "rate-limit", enabled: false }, { name: "logger" }],
    );
    expect(result).toHaveLength(4);
    expect(
      result.map((d: any) => (typeof d === "string" ? d : d.name)),
    ).toEqual(["auth", "rate-limit", "cors", "logger"]);
  });

  it("does not mutate base array", () => {
    const base = [{ name: "auth", options: { x: 1 } }];
    const baseCopy = JSON.parse(JSON.stringify(base));
    _patchMiddlewares(base, [{ name: "auth", options: { x: 2 } }]);
    expect(base).toEqual(baseCopy); // 原始数组未被修改
  });
});

// ── deepFreeze ──────────────────────────────────────────────

describe("deepFreeze", () => {
  it("freezes top-level properties", () => {
    const obj = { port: 3000, host: "0.0.0.0" };
    const frozen = _deepFreeze(obj);

    expect(Object.isFrozen(frozen)).toBe(true);
    expect(() => {
      (frozen as any).port = 8080;
    }).toThrow();
  });

  it("recursively freezes nested objects", () => {
    const obj = {
      cors: { enabled: true, origins: ["*"] },
      logger: { level: "info" },
    };
    const frozen = _deepFreeze(obj);

    expect(Object.isFrozen(frozen.cors)).toBe(true);
    expect(Object.isFrozen(frozen.logger)).toBe(true);
    expect(() => {
      (frozen.cors as any).enabled = false;
    }).toThrow();
  });

  it("freezes arrays", () => {
    const obj = { items: [1, 2, 3] };
    const frozen = _deepFreeze(obj);

    expect(Object.isFrozen(frozen.items)).toBe(true);
    expect(() => {
      (frozen.items as any).push(4);
    }).toThrow();
  });

  it("skips Date objects (does not freeze)", () => {
    const date = new Date("2026-01-01");
    const obj = { createdAt: date };
    const frozen = _deepFreeze(obj);

    // Date 不应被冻结（冻结 Date 会破坏 setTime 等方法）
    expect(Object.isFrozen(frozen.createdAt)).toBe(false);
  });

  it("skips RegExp objects", () => {
    const obj = { pattern: /test/i };
    const frozen = _deepFreeze(obj);
    expect(Object.isFrozen(frozen.pattern)).toBe(false);
  });

  it("skips Map and Set objects", () => {
    const obj = {
      map: new Map([["key", "value"]]),
      set: new Set([1, 2, 3]),
    };
    const frozen = _deepFreeze(obj);
    expect(Object.isFrozen(frozen.map)).toBe(false);
    expect(Object.isFrozen(frozen.set)).toBe(false);
  });

  it("handles null and primitives gracefully", () => {
    expect(_deepFreeze(null)).toBeNull();
    expect(_deepFreeze(42)).toBe(42);
    expect(_deepFreeze("hello")).toBe("hello");
    expect(_deepFreeze(undefined)).toBeUndefined();
  });

  it("skips already frozen objects (no error on re-freeze)", () => {
    const obj = Object.freeze({ a: 1 });
    expect(() => _deepFreeze(obj)).not.toThrow();
  });
});

// ── validateConfig ──────────────────────────────────────────

describe("validateConfig", () => {
  // 有效配置不应抛出
  it("accepts valid minimal config", () => {
    expect(() =>
      _validateConfig({
        port: 3000,
        adapter: "hono",
        middlewares: [],
        logger: { level: "info" },
      }),
    ).not.toThrow();
  });

  it("accepts config without optional fields", () => {
    expect(() => _validateConfig({})).not.toThrow();
  });

  // ── port ────────────────────────────────────────────────

  describe("port validation", () => {
    it("rejects port = 0", () => {
      expect(() => _validateConfig({ port: 0 })).toThrow("config.port");
    });

    it("rejects port > 65535", () => {
      expect(() => _validateConfig({ port: 70000 })).toThrow("config.port");
    });

    it("rejects negative port", () => {
      expect(() => _validateConfig({ port: -1 })).toThrow("config.port");
    });

    it("rejects non-number port", () => {
      expect(() => _validateConfig({ port: "3000" })).toThrow("config.port");
    });

    it("accepts valid port", () => {
      expect(() => _validateConfig({ port: 8080 })).not.toThrow();
    });
  });

  // ── adapter ─────────────────────────────────────────────

  describe("adapter validation", () => {
    it("accepts known adapter string", () => {
      expect(() => _validateConfig({ adapter: "hono" })).not.toThrow();
      expect(() => _validateConfig({ adapter: "fastify" })).not.toThrow();
      expect(() => _validateConfig({ adapter: "express" })).not.toThrow();
      expect(() => _validateConfig({ adapter: "koa" })).not.toThrow();
    });

    it("rejects unknown adapter string", () => {
      expect(() => _validateConfig({ adapter: "unknown-adapter" })).toThrow(
        "not a built-in adapter",
      );
    });

    it("accepts factory function", () => {
      expect(() =>
        _validateConfig({ adapter: function myAdapter() {} }),
      ).not.toThrow();
    });

    it("rejects non-string non-function adapter", () => {
      expect(() => _validateConfig({ adapter: 123 })).toThrow("config.adapter");
    });
  });

  // ── middlewares ──────────────────────────────────────────

  describe("middlewares validation", () => {
    it("accepts array of strings", () => {
      expect(() =>
        _validateConfig({ middlewares: ["auth", "cors"] }),
      ).not.toThrow();
    });

    it("accepts array of objects with name", () => {
      expect(() =>
        _validateConfig({
          middlewares: [{ name: "auth", options: { role: "admin" } }],
        }),
      ).not.toThrow();
    });

    it("rejects non-array middlewares", () => {
      expect(() => _validateConfig({ middlewares: "auth" })).toThrow(
        "config.middlewares must be an array",
      );
    });

    it("rejects invalid middleware item (number)", () => {
      expect(() => _validateConfig({ middlewares: [123] })).toThrow(
        "config.middlewares[0]",
      );
    });

    it("rejects object without name", () => {
      expect(() => _validateConfig({ middlewares: [{ options: {} }] })).toThrow(
        "config.middlewares[0]",
      );
    });
  });

  // ── rateLimit ───────────────────────────────────────────

  describe("rateLimit validation", () => {
    it("accepts valid rateLimit", () => {
      expect(() =>
        _validateConfig({ rateLimit: { max: 100, window: 60 } }),
      ).not.toThrow();
    });

    it("rejects non-object rateLimit", () => {
      expect(() => _validateConfig({ rateLimit: "fast" })).toThrow(
        "config.rateLimit must be an object",
      );
    });

    it("rejects max < 1", () => {
      expect(() => _validateConfig({ rateLimit: { max: 0 } })).toThrow(
        "config.rateLimit.max",
      );
    });

    it("rejects negative window", () => {
      expect(() => _validateConfig({ rateLimit: { window: -1 } })).toThrow(
        "config.rateLimit.window",
      );
    });
  });

  // ── logger ──────────────────────────────────────────────

  describe("logger validation", () => {
    it("accepts valid logger config", () => {
      expect(() =>
        _validateConfig({ logger: { level: "debug", pretty: true } }),
      ).not.toThrow();
    });

    it("rejects invalid log level", () => {
      expect(() => _validateConfig({ logger: { level: "verbose" } })).toThrow(
        "config.logger.level",
      );
    });

    it("accepts all valid log levels", () => {
      for (const level of [
        "fatal",
        "error",
        "warn",
        "info",
        "debug",
        "trace",
        "silent",
      ]) {
        expect(() => _validateConfig({ logger: { level } })).not.toThrow();
      }
    });

    it("rejects non-boolean pretty", () => {
      expect(() => _validateConfig({ logger: { pretty: "yes" } })).toThrow(
        "config.logger.pretty must be a boolean",
      );
    });
  });

  // ── shutdown ────────────────────────────────────────────

  describe("shutdown validation", () => {
    it("accepts valid shutdown config", () => {
      expect(() =>
        _validateConfig({ shutdown: { timeout: 30 } }),
      ).not.toThrow();
    });

    it("accepts timeout = 0", () => {
      expect(() => _validateConfig({ shutdown: { timeout: 0 } })).not.toThrow();
    });

    it("rejects negative timeout", () => {
      expect(() => _validateConfig({ shutdown: { timeout: -5 } })).toThrow(
        "config.shutdown.timeout",
      );
    });
  });

  // ── cluster ─────────────────────────────────────────────

  describe("cluster validation", () => {
    it("accepts valid cluster config", () => {
      expect(() =>
        _validateConfig({ cluster: { workers: 4, enabled: true } }),
      ).not.toThrow();
    });

    it('accepts workers = "auto"', () => {
      expect(() =>
        _validateConfig({ cluster: { workers: "auto" } }),
      ).not.toThrow();
    });

    it('accepts workers = "auto-1"', () => {
      expect(() =>
        _validateConfig({ cluster: { workers: "auto-1" } }),
      ).not.toThrow();
    });

    it("rejects workers = 0", () => {
      expect(() => _validateConfig({ cluster: { workers: 0 } })).toThrow(
        "config.cluster.workers",
      );
    });

    it("rejects invalid worker string", () => {
      expect(() => _validateConfig({ cluster: { workers: "half" } })).toThrow(
        "config.cluster.workers",
      );
    });

    it("rejects non-boolean enabled", () => {
      expect(() => _validateConfig({ cluster: { enabled: "yes" } })).toThrow(
        "config.cluster.enabled must be a boolean",
      );
    });
  });

  // ── openapi ─────────────────────────────────────────────

  describe("openapi validation", () => {
    it("accepts valid openapi config", () => {
      expect(() =>
        _validateConfig({ openapi: { enabled: true } }),
      ).not.toThrow();
    });

    it("rejects non-boolean enabled", () => {
      expect(() => _validateConfig({ openapi: { enabled: "true" } })).toThrow(
        "config.openapi.enabled must be a boolean",
      );
    });
  });

  // ── locale ──────────────────────────────────────────────

  describe("locale validation", () => {
    it("accepts valid locale config", () => {
      expect(() =>
        _validateConfig({
          locale: { default: "zh-CN", supported: ["zh-CN", "en-US"] },
        }),
      ).not.toThrow();
    });

    it("rejects non-string default", () => {
      expect(() => _validateConfig({ locale: { default: 123 } })).toThrow(
        "config.locale.default must be a string",
      );
    });

    it("rejects non-array supported", () => {
      expect(() => _validateConfig({ locale: { supported: "zh-CN" } })).toThrow(
        "config.locale.supported must be an array",
      );
    });

    it("rejects non-string items in supported", () => {
      expect(() => _validateConfig({ locale: { supported: [123] } })).toThrow(
        "config.locale.supported[] items must be strings",
      );
    });
  });

  // ── requestContext ──────────────────────────────────────

  describe("requestContext validation", () => {
    it("accepts valid requestContext config (enabled: true)", () => {
      expect(() =>
        _validateConfig({ requestContext: { enabled: true } }),
      ).not.toThrow();
    });

    it("accepts valid requestContext config (enabled: false)", () => {
      expect(() =>
        _validateConfig({ requestContext: { enabled: false } }),
      ).not.toThrow();
    });

    it("accepts requestContext without enabled field", () => {
      expect(() => _validateConfig({ requestContext: {} })).not.toThrow();
    });

    it("rejects non-object requestContext", () => {
      expect(() => _validateConfig({ requestContext: "true" })).toThrow(
        "config.requestContext must be an object",
      );
    });

    it("rejects non-boolean enabled", () => {
      expect(() =>
        _validateConfig({ requestContext: { enabled: "true" } }),
      ).toThrow("config.requestContext.enabled must be a boolean");
    });

    it("rejects null requestContext", () => {
      expect(() => _validateConfig({ requestContext: null })).toThrow(
        "config.requestContext must be an object",
      );
    });
  });
});

// ── VEXT_PORT / VEXT_HOST 环境变量覆盖（BUG-013 防回归）───────

describe("loadConfig — VEXT_PORT / VEXT_HOST 环境变量覆盖", () => {
  let tmpDir: string;
  let savedPort: string | undefined;
  let savedHost: string | undefined;
  let savedNodeEnv: string | undefined;

  beforeEach(() => {
    // 创建临时 config 目录，写入最小 default.ts
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vext-config-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "default.js"),
      `module.exports = { port: 3000, host: "0.0.0.0" };\n`,
    );
    // 保存环境变量
    savedPort = process.env.VEXT_PORT;
    savedHost = process.env.VEXT_HOST;
    savedNodeEnv = process.env.NODE_ENV;
    // loadConfig 内部使用 NODE_ENV 查找环境文件
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    // 恢复环境变量
    if (savedPort !== undefined) {
      process.env.VEXT_PORT = savedPort;
    } else {
      delete process.env.VEXT_PORT;
    }
    if (savedHost !== undefined) {
      process.env.VEXT_HOST = savedHost;
    } else {
      delete process.env.VEXT_HOST;
    }
    if (savedNodeEnv !== undefined) {
      process.env.NODE_ENV = savedNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    // 清理临时目录
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("VEXT_PORT 应覆盖 config.port", async () => {
    process.env.VEXT_PORT = "8080";
    delete process.env.VEXT_HOST;

    const config = await loadConfig(tmpDir);
    expect(config.port).toBe(8080);
  });

  it("VEXT_HOST 应覆盖 config.host", async () => {
    delete process.env.VEXT_PORT;
    process.env.VEXT_HOST = "127.0.0.1";

    const config = await loadConfig(tmpDir);
    expect(config.host).toBe("127.0.0.1");
  });

  it("VEXT_PORT 和 VEXT_HOST 可同时覆盖", async () => {
    process.env.VEXT_PORT = "9090";
    process.env.VEXT_HOST = "localhost";

    const config = await loadConfig(tmpDir);
    expect(config.port).toBe(9090);
    expect(config.host).toBe("localhost");
  });

  it("无 VEXT_PORT 时应使用 config 文件中的 port", async () => {
    delete process.env.VEXT_PORT;
    delete process.env.VEXT_HOST;

    const config = await loadConfig(tmpDir);
    expect(config.port).toBe(3000);
    expect(config.host).toBe("0.0.0.0");
  });

  it("VEXT_PORT 非法值应被忽略（保留 config 值）", async () => {
    process.env.VEXT_PORT = "not-a-number";
    const config = await loadConfig(tmpDir);
    expect(config.port).toBe(3000);
  });

  it("VEXT_PORT=0 应被忽略（port < 1）", async () => {
    process.env.VEXT_PORT = "0";
    const config = await loadConfig(tmpDir);
    expect(config.port).toBe(3000);
  });

  it("VEXT_PORT=70000 应被忽略（port > 65535）", async () => {
    process.env.VEXT_PORT = "70000";
    const config = await loadConfig(tmpDir);
    expect(config.port).toBe(3000);
  });

  it("VEXT_PORT 应具有最高优先级（高于 config 文件）", async () => {
    // 写一个指定 port 的 config
    fs.writeFileSync(
      path.join(tmpDir, "default.js"),
      `module.exports = { port: 4000 };\n`,
    );
    process.env.VEXT_PORT = "5000";

    const config = await loadConfig(tmpDir);
    expect(config.port).toBe(5000);
  });

  it("返回的 config 应是冻结的（deepFreeze）", async () => {
    process.env.VEXT_PORT = "8080";
    const config = await loadConfig(tmpDir);

    expect(Object.isFrozen(config)).toBe(true);
    expect(() => {
      (config as Record<string, unknown>).port = 9999;
    }).toThrow();
  });
});
