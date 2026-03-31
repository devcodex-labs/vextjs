/**
 * service-reloader 单元测试
 *
 * 测试覆盖：
 *   - filePathToServiceKeys：文件路径 → 嵌套 key 映射
 *     - 简单文件名（user.js → ["user"]）
 *     - kebab-case → camelCase（user-profile.js → ["userProfile"]）
 *     - 嵌套目录（payment/stripe.js → ["payment", "stripe"]）
 *     - 深层嵌套（a/b/c.js → ["a", "b", "c"]）
 *     - 多级 kebab-case（payment/ali-pay.js → ["payment", "aliPay"]）
 *   - getNestedValue / setNestedValue：嵌套对象读写
 *   - scanServiceDirectory：目录扫描
 *   - reloadServices：选择性重载
 *     - 仅重载 invalidation set 中的 service
 *     - 未变更 service 保持不变
 *     - 嵌套 service 重载
 *     - dispose() 调用
 *     - dispose() 失败时继续（不中断）
 *     - require/实例化失败时回滚
 *     - 空目录 → 静默跳过
 *     - services 目录不存在 → 静默跳过
 *     - 无 service 被影响 → 跳过
 *
 * 策略：
 *   使用临时目录（os.tmpdir）创建真实文件系统结构，
 *   通过 reloadServices() 加载并断言 app.services 上的挂载结果。
 *   使用 require.cache 注入模拟模块条目以模拟 invalidation set 匹配。
 *
 * @see 11b-soft-reload.md §4（服务实例重载）
 * @see 11e-edge-cases.md §1（Reload 失败回退）
 * @see IMPLEMENTATION-PLAN.md 任务 2.2b
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  filePathToServiceKeys,
  getNestedValue,
  setNestedValue,
  scanServiceDirectory,
  reloadServices,
  type ServiceReloaderApp,
} from "../../src/lib/dev/service-reloader.js";

// ── 测试辅助 ────────────────────────────────────────────────

/**
 * 创建最小化的 mock ServiceReloaderApp
 */
function createMockApp(
  overrides?: Partial<ServiceReloaderApp>,
): ServiceReloaderApp {
  return {
    services: {},
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    },
    ...overrides,
  };
}

/**
 * 创建临时目录
 */
async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "vext-service-reloader-test-"));
}

/**
 * 清理 require.cache 中匹配前缀的条目
 */
function cleanupRequireCache(prefix: string): void {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(prefix)) {
      delete require.cache[key];
    }
  }
}

// ── filePathToServiceKeys ────────────────────────────────────

describe("filePathToServiceKeys", () => {
  it("应将简单文件名转为单元素数组", () => {
    expect(filePathToServiceKeys("user.js")).toEqual(["user"]);
  });

  it("应将 kebab-case 转为 camelCase", () => {
    expect(filePathToServiceKeys("user-profile.js")).toEqual(["userProfile"]);
  });

  it("应处理嵌套目录路径", () => {
    expect(filePathToServiceKeys("payment/stripe.js")).toEqual([
      "payment",
      "stripe",
    ]);
  });

  it("应处理深层嵌套目录路径", () => {
    expect(filePathToServiceKeys("a/b/c.js")).toEqual(["a", "b", "c"]);
  });

  it("应处理嵌套目录中的 kebab-case", () => {
    expect(filePathToServiceKeys("payment/ali-pay.js")).toEqual([
      "payment",
      "aliPay",
    ]);
  });

  it("应处理 Windows 路径分隔符", () => {
    expect(filePathToServiceKeys("payment\\stripe.js")).toEqual([
      "payment",
      "stripe",
    ]);
  });

  it("应处理 .cjs 扩展名", () => {
    expect(filePathToServiceKeys("user.cjs")).toEqual(["user"]);
  });

  it("应处理 .mjs 扩展名", () => {
    expect(filePathToServiceKeys("user.mjs")).toEqual(["user"]);
  });

  it("应处理多段 kebab-case 文件名", () => {
    expect(filePathToServiceKeys("my-data-service.js")).toEqual([
      "myDataService",
    ]);
  });

  it("应处理单字母目录名", () => {
    expect(filePathToServiceKeys("a/b.js")).toEqual(["a", "b"]);
  });

  it("应过滤空路径段", () => {
    expect(filePathToServiceKeys("payment//stripe.js")).toEqual([
      "payment",
      "stripe",
    ]);
  });
});

// ── getNestedValue ──────────────────────────────────────────

describe("getNestedValue", () => {
  it("应从单层对象中读取值", () => {
    const obj = { user: "hello" };
    expect(getNestedValue(obj, ["user"])).toBe("hello");
  });

  it("应从嵌套对象中读取值", () => {
    const obj = { payment: { stripe: { key: "sk_test" } } };
    expect(getNestedValue(obj, ["payment", "stripe"])).toEqual({
      key: "sk_test",
    });
  });

  it("应在路径不存在时返回 undefined", () => {
    const obj = { user: "hello" };
    expect(getNestedValue(obj, ["nonexistent"])).toBeUndefined();
  });

  it("应在中间路径为 null 时返回 undefined", () => {
    const obj = { payment: null } as Record<string, unknown>;
    expect(getNestedValue(obj, ["payment", "stripe"])).toBeUndefined();
  });

  it("应在中间路径为 undefined 时返回 undefined", () => {
    const obj = {} as Record<string, unknown>;
    expect(getNestedValue(obj, ["payment", "stripe"])).toBeUndefined();
  });

  it("应在中间路径为原始类型时返回 undefined", () => {
    const obj = { payment: 42 } as Record<string, unknown>;
    expect(getNestedValue(obj, ["payment", "stripe"])).toBeUndefined();
  });

  it("应处理空 key 数组", () => {
    const obj = { user: "hello" };
    expect(getNestedValue(obj, [])).toEqual(obj);
  });

  it("应读取深层嵌套值", () => {
    const obj = { a: { b: { c: { d: "deep" } } } };
    expect(getNestedValue(obj, ["a", "b", "c", "d"])).toBe("deep");
  });
});

// ── setNestedValue ──────────────────────────────────────────

describe("setNestedValue", () => {
  it("应在单层对象中设置值", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, ["user"], "instance");
    expect(obj.user).toBe("instance");
  });

  it("应在嵌套路径中设置值并自动创建中间对象", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, ["payment", "stripe"], "stripeInstance");
    expect((obj.payment as Record<string, unknown>).stripe).toBe(
      "stripeInstance",
    );
  });

  it("应覆盖已存在的值", () => {
    const obj: Record<string, unknown> = { user: "old" };
    setNestedValue(obj, ["user"], "new");
    expect(obj.user).toBe("new");
  });

  it("应覆盖嵌套路径中已存在的值", () => {
    const obj: Record<string, unknown> = {
      payment: { stripe: "old" },
    };
    setNestedValue(obj, ["payment", "stripe"], "new");
    expect((obj.payment as Record<string, unknown>).stripe).toBe("new");
  });

  it("应在中间路径为原始类型时覆盖为对象", () => {
    const obj: Record<string, unknown> = { payment: 42 };
    setNestedValue(obj, ["payment", "stripe"], "value");
    expect((obj.payment as Record<string, unknown>).stripe).toBe("value");
  });

  it("应处理空 key 数组（不做任何操作）", () => {
    const obj: Record<string, unknown> = { user: "hello" };
    setNestedValue(obj, [], "value");
    expect(obj).toEqual({ user: "hello" });
  });

  it("应设置深层嵌套值", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, ["a", "b", "c", "d"], "deep");
    expect(
      (
        ((obj.a as Record<string, unknown>).b as Record<string, unknown>)
          .c as Record<string, unknown>
      ).d,
    ).toBe("deep");
  });

  it("应保留同级已存在的 key", () => {
    const obj: Record<string, unknown> = {
      payment: { alipay: "alipayInstance" },
    };
    setNestedValue(obj, ["payment", "stripe"], "stripeInstance");
    expect((obj.payment as Record<string, unknown>).alipay).toBe(
      "alipayInstance",
    );
    expect((obj.payment as Record<string, unknown>).stripe).toBe(
      "stripeInstance",
    );
  });
});

// ── scanServiceDirectory ────────────────────────────────────

describe("scanServiceDirectory", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("应返回空数组当目录不存在时", async () => {
    const files = await scanServiceDirectory(join(tempDir, "nonexistent"));
    expect(files).toEqual([]);
  });

  it("应返回空数组当目录为空时", async () => {
    await mkdir(join(tempDir, "services"), { recursive: true });
    const files = await scanServiceDirectory(join(tempDir, "services"));
    expect(files).toEqual([]);
  });

  it("应扫描 .js 文件", async () => {
    const servicesDir = join(tempDir, "services");
    await mkdir(servicesDir, { recursive: true });
    await writeFile(join(servicesDir, "user.js"), "module.exports = {}");

    const files = await scanServiceDirectory(servicesDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("user.js");
  });

  it("应递归扫描子目录", async () => {
    const servicesDir = join(tempDir, "services");
    await mkdir(join(servicesDir, "payment"), { recursive: true });
    await writeFile(join(servicesDir, "user.js"), "module.exports = {}");
    await writeFile(
      join(servicesDir, "payment", "stripe.js"),
      "module.exports = {}",
    );

    const files = await scanServiceDirectory(servicesDir);
    expect(files).toHaveLength(2);
    expect(files.some((f) => f.includes("user.js"))).toBe(true);
    expect(files.some((f) => f.includes("stripe.js"))).toBe(true);
  });

  it("应忽略非 .js 文件", async () => {
    const servicesDir = join(tempDir, "services");
    await mkdir(servicesDir, { recursive: true });
    await writeFile(join(servicesDir, "user.js"), "module.exports = {}");
    await writeFile(join(servicesDir, "readme.md"), "# readme");
    await writeFile(join(servicesDir, "types.d.ts"), "export type X = string");

    const files = await scanServiceDirectory(servicesDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("user.js");
  });

  it("应跳过 _ 开头的文件", async () => {
    const servicesDir = join(tempDir, "services");
    await mkdir(servicesDir, { recursive: true });
    await writeFile(join(servicesDir, "user.js"), "module.exports = {}");
    await writeFile(join(servicesDir, "_helper.js"), "module.exports = {}");

    const files = await scanServiceDirectory(servicesDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("user.js");
  });

  it("应跳过 _ 开头的目录", async () => {
    const servicesDir = join(tempDir, "services");
    await mkdir(join(servicesDir, "_internal"), { recursive: true });
    await writeFile(
      join(servicesDir, "_internal", "helper.js"),
      "module.exports = {}",
    );
    await writeFile(join(servicesDir, "user.js"), "module.exports = {}");

    const files = await scanServiceDirectory(servicesDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("user.js");
  });

  it("应跳过 . 开头的目录", async () => {
    const servicesDir = join(tempDir, "services");
    await mkdir(join(servicesDir, ".hidden"), { recursive: true });
    await writeFile(
      join(servicesDir, ".hidden", "secret.js"),
      "module.exports = {}",
    );
    await writeFile(join(servicesDir, "user.js"), "module.exports = {}");

    const files = await scanServiceDirectory(servicesDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("user.js");
  });
});

// ── reloadServices ──────────────────────────────────────────

describe("reloadServices", () => {
  let tempDir: string;
  let outDir: string;
  let servicesDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    outDir = join(tempDir, ".vext", "dev");
    servicesDir = join(outDir, "services");
    await mkdir(servicesDir, { recursive: true });
  });

  afterEach(async () => {
    cleanupRequireCache(tempDir);
    await rm(tempDir, { recursive: true, force: true });
  });

  // ── 基础行为 ──────────────────────────────────────────

  describe("基础行为", () => {
    it("应在 services 目录不存在时静默跳过", async () => {
      const emptyOutDir = join(tempDir, "empty-out");
      await mkdir(emptyOutDir, { recursive: true });

      const app = createMockApp();
      const result = await reloadServices(app, emptyOutDir, new Set());

      expect(result.reloaded).toBe(0);
      expect(result.unchanged).toBe(0);
      expect(result.reloadedKeys).toEqual([]);
    });

    it("应在 services 目录为空时静默跳过", async () => {
      const app = createMockApp();
      const result = await reloadServices(app, outDir, new Set());

      expect(result.reloaded).toBe(0);
      expect(result.unchanged).toBe(0);
      expect(result.reloadedKeys).toEqual([]);
    });

    it("应在无 service 被影响时跳过", async () => {
      await writeFile(
        join(servicesDir, "user.js"),
        "module.exports = { default: class UserService { constructor() {} } }",
      );

      const app = createMockApp({ services: { user: "oldInstance" } });
      // invalidation set 为空 — 没有 service 被影响
      const result = await reloadServices(app, outDir, new Set());

      expect(result.reloaded).toBe(0);
      expect(result.unchanged).toBe(1);
      expect(result.reloadedKeys).toEqual([]);
      // 旧实例应保持不变
      expect(app.services.user).toBe("oldInstance");
    });
  });

  // ── 选择性重载 ────────────────────────────────────────

  describe("选择性重载", () => {
    it("应仅重载 invalidation set 中的 service", async () => {
      // 创建两个 service 文件
      await writeFile(
        join(servicesDir, "user.js"),
        "module.exports = { default: { name: 'newUser' } }",
      );
      await writeFile(
        join(servicesDir, "order.js"),
        "module.exports = { default: { name: 'newOrder' } }",
      );

      const userFilePath = join(servicesDir, "user.js");
      const orderFilePath = join(servicesDir, "order.js");

      const app = createMockApp({
        services: {
          user: { name: "oldUser" },
          order: { name: "oldOrder" },
        },
      });

      // 只有 user.js 在 invalidation set 中
      const invalidated = new Set([userFilePath]);
      const result = await reloadServices(app, outDir, invalidated);

      expect(result.reloaded).toBe(1);
      expect(result.unchanged).toBe(1);
      expect(result.reloadedKeys).toEqual(["user"]);
      // user 应被重载为新值
      expect((app.services.user as { name: string }).name).toBe("newUser");
      // order 应保持不变
      expect((app.services.order as { name: string }).name).toBe("oldOrder");
    });

    it("应重载多个受影响的 service", async () => {
      await writeFile(
        join(servicesDir, "user.js"),
        "module.exports = { default: { name: 'newUser' } }",
      );
      await writeFile(
        join(servicesDir, "order.js"),
        "module.exports = { default: { name: 'newOrder' } }",
      );

      const app = createMockApp({
        services: {
          user: { name: "oldUser" },
          order: { name: "oldOrder" },
        },
      });

      const invalidated = new Set([
        join(servicesDir, "user.js"),
        join(servicesDir, "order.js"),
      ]);
      const result = await reloadServices(app, outDir, invalidated);

      expect(result.reloaded).toBe(2);
      expect(result.unchanged).toBe(0);
      expect(result.reloadedKeys).toHaveLength(2);
      expect(result.reloadedKeys).toContain("user");
      expect(result.reloadedKeys).toContain("order");
    });

    it("应处理无 default export 的模块（直接使用 module.exports）", async () => {
      await writeFile(
        join(servicesDir, "simple.js"),
        "module.exports = { name: 'simpleService' }",
      );

      const app = createMockApp();
      const invalidated = new Set([join(servicesDir, "simple.js")]);
      const result = await reloadServices(app, outDir, invalidated);

      expect(result.reloaded).toBe(1);
      expect((app.services.simple as { name: string }).name).toBe(
        "simpleService",
      );
    });
  });

  // ── 嵌套 Service ──────────────────────────────────────

  describe("嵌套 Service", () => {
    it("应正确处理嵌套目录结构（payment/stripe.js → app.services.payment.stripe）", async () => {
      await mkdir(join(servicesDir, "payment"), { recursive: true });
      await writeFile(
        join(servicesDir, "payment", "stripe.js"),
        "module.exports = { default: { provider: 'stripe-v2' } }",
      );

      const app = createMockApp({
        services: {
          payment: { stripe: { provider: "stripe-v1" } },
        },
      });

      const invalidated = new Set([join(servicesDir, "payment", "stripe.js")]);
      const result = await reloadServices(app, outDir, invalidated);

      expect(result.reloaded).toBe(1);
      expect(result.reloadedKeys).toEqual(["payment.stripe"]);
      expect(
        (
          (app.services.payment as Record<string, unknown>).stripe as {
            provider: string;
          }
        ).provider,
      ).toBe("stripe-v2");
    });

    it("应保留同级未变更的嵌套 service", async () => {
      await mkdir(join(servicesDir, "payment"), { recursive: true });
      await writeFile(
        join(servicesDir, "payment", "stripe.js"),
        "module.exports = { default: { provider: 'stripe-v2' } }",
      );
      await writeFile(
        join(servicesDir, "payment", "alipay.js"),
        "module.exports = { default: { provider: 'alipay-v1' } }",
      );

      const app = createMockApp({
        services: {
          payment: {
            stripe: { provider: "stripe-v1" },
            alipay: { provider: "alipay-v1" },
          },
        },
      });

      // 只有 stripe 在 invalidation set 中
      const invalidated = new Set([join(servicesDir, "payment", "stripe.js")]);
      const result = await reloadServices(app, outDir, invalidated);

      expect(result.reloaded).toBe(1);
      expect(result.unchanged).toBe(1);
      // stripe 应被重载
      expect(
        (
          (app.services.payment as Record<string, unknown>).stripe as {
            provider: string;
          }
        ).provider,
      ).toBe("stripe-v2");
      // alipay 应保持不变
      expect(
        (
          (app.services.payment as Record<string, unknown>).alipay as {
            provider: string;
          }
        ).provider,
      ).toBe("alipay-v1");
    });

    it("应自动创建中间层级对象（首次加载嵌套 service）", async () => {
      await mkdir(join(servicesDir, "payment"), { recursive: true });
      await writeFile(
        join(servicesDir, "payment", "stripe.js"),
        "module.exports = { default: { provider: 'stripe' } }",
      );

      // app.services 是空的（没有 payment 对象）
      const app = createMockApp();
      const invalidated = new Set([join(servicesDir, "payment", "stripe.js")]);
      const result = await reloadServices(app, outDir, invalidated);

      expect(result.reloaded).toBe(1);
      expect(
        (
          (app.services.payment as Record<string, unknown>).stripe as {
            provider: string;
          }
        ).provider,
      ).toBe("stripe");
    });

    it("应处理 kebab-case 目录名（payment/ali-pay.js → payment.aliPay）", async () => {
      await mkdir(join(servicesDir, "payment"), { recursive: true });
      await writeFile(
        join(servicesDir, "payment", "ali-pay.js"),
        "module.exports = { default: { provider: 'alipay' } }",
      );

      const app = createMockApp();
      const invalidated = new Set([join(servicesDir, "payment", "ali-pay.js")]);
      const result = await reloadServices(app, outDir, invalidated);

      expect(result.reloaded).toBe(1);
      expect(result.reloadedKeys).toEqual(["payment.aliPay"]);
      expect(
        (
          (app.services.payment as Record<string, unknown>).aliPay as {
            provider: string;
          }
        ).provider,
      ).toBe("alipay");
    });
  });

  // ── dispose() 调用 ────────────────────────────────────

  describe("dispose() 调用", () => {
    it("应在重载前调用旧实例的 dispose()", async () => {
      const disposeFn = vi.fn();
      await writeFile(
        join(servicesDir, "scheduler.js"),
        "module.exports = { default: { name: 'newScheduler' } }",
      );

      const app = createMockApp({
        services: {
          scheduler: { name: "oldScheduler", dispose: disposeFn },
        },
      });

      const invalidated = new Set([join(servicesDir, "scheduler.js")]);
      await reloadServices(app, outDir, invalidated);

      expect(disposeFn).toHaveBeenCalledOnce();
    });

    it("应在 async dispose() 时正确等待", async () => {
      let disposeCompleted = false;
      const disposeFn = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        disposeCompleted = true;
      });

      await writeFile(
        join(servicesDir, "timer.js"),
        "module.exports = { default: { name: 'newTimer' } }",
      );

      const app = createMockApp({
        services: {
          timer: { name: "oldTimer", dispose: disposeFn },
        },
      });

      const invalidated = new Set([join(servicesDir, "timer.js")]);
      await reloadServices(app, outDir, invalidated);

      expect(disposeCompleted).toBe(true);
    });

    it("应在 dispose() 失败时打印警告但继续重载", async () => {
      const disposeFn = vi.fn(() => {
        throw new Error("dispose failed!");
      });

      await writeFile(
        join(servicesDir, "broken.js"),
        "module.exports = { default: { name: 'newBroken' } }",
      );

      const app = createMockApp({
        services: {
          broken: { name: "oldBroken", dispose: disposeFn },
        },
      });

      const invalidated = new Set([join(servicesDir, "broken.js")]);
      const result = await reloadServices(app, outDir, invalidated);

      // dispose 失败不应阻止重载
      expect(result.reloaded).toBe(1);
      expect((app.services.broken as { name: string }).name).toBe("newBroken");
      // 应有警告日志
      expect(app.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("dispose() failed"),
      );
    });

    it("应不调用 dispose() 如果旧实例没有该方法", async () => {
      await writeFile(
        join(servicesDir, "plain.js"),
        "module.exports = { default: { name: 'newPlain' } }",
      );

      const app = createMockApp({
        services: {
          plain: { name: "oldPlain" },
        },
      });

      const invalidated = new Set([join(servicesDir, "plain.js")]);
      // 不应抛出错误
      const result = await reloadServices(app, outDir, invalidated);
      expect(result.reloaded).toBe(1);
    });

    it("应不调用 dispose() 如果旧实例为 undefined", async () => {
      await writeFile(
        join(servicesDir, "newservice.js"),
        "module.exports = { default: { name: 'brand-new' } }",
      );

      const app = createMockApp();
      const invalidated = new Set([join(servicesDir, "newservice.js")]);
      // 不应抛出错误
      const result = await reloadServices(app, outDir, invalidated);
      expect(result.reloaded).toBe(1);
    });

    it("应不调用 dispose() 如果 dispose 不是函数", async () => {
      await writeFile(
        join(servicesDir, "weird.js"),
        "module.exports = { default: { name: 'newWeird' } }",
      );

      const app = createMockApp({
        services: {
          weird: { name: "oldWeird", dispose: "not-a-function" },
        },
      });

      const invalidated = new Set([join(servicesDir, "weird.js")]);
      // 不应抛出错误
      const result = await reloadServices(app, outDir, invalidated);
      expect(result.reloaded).toBe(1);
    });
  });

  // ── Class 实例化 ──────────────────────────────────────

  describe("Class 实例化", () => {
    it("应正确实例化 class export", async () => {
      await writeFile(
        join(servicesDir, "counter.js"),
        `
class CounterService {
  constructor(app) {
    this.count = 0;
    this.appRef = app;
  }
}
module.exports = { default: CounterService };
`,
      );

      const app = createMockApp();
      const invalidated = new Set([join(servicesDir, "counter.js")]);
      await reloadServices(app, outDir, invalidated);

      const counter = app.services.counter as {
        count: number;
        appRef: unknown;
      };
      expect(counter).toBeDefined();
      expect(counter.count).toBe(0);
      expect(counter.appRef).toBe(app);
    });

    it("应正确处理非 class 函数 export（不自动调用）", async () => {
      await writeFile(
        join(servicesDir, "factory.js"),
        `
function createService() { return { created: true }; }
module.exports = { default: createService };
`,
      );

      const app = createMockApp();
      const invalidated = new Set([join(servicesDir, "factory.js")]);
      await reloadServices(app, outDir, invalidated);

      // 非 class 函数应直接赋值（不调用）
      expect(typeof app.services.factory).toBe("function");
    });

    it("应正确处理对象 export", async () => {
      await writeFile(
        join(servicesDir, "config.js"),
        `
module.exports = { default: { setting: 'value' } };
`,
      );

      const app = createMockApp();
      const invalidated = new Set([join(servicesDir, "config.js")]);
      await reloadServices(app, outDir, invalidated);

      expect((app.services.config as { setting: string }).setting).toBe(
        "value",
      );
    });
  });

  // ── 回滚机制 ──────────────────────────────────────────

  describe("回滚机制", () => {
    it("应在 require 失败时回滚到旧实例", async () => {
      // 创建一个有效的 service 和一个语法错误的 service
      await writeFile(
        join(servicesDir, "good.js"),
        "module.exports = { default: { name: 'newGood' } }",
      );
      await writeFile(
        join(servicesDir, "bad.js"),
        // 这里使用一个不存在的模块引用来触发 require 错误
        "const x = require('__nonexistent_module_12345__'); module.exports = { default: x }",
      );

      const oldGoodInstance = { name: "oldGood" };
      const oldBadInstance = { name: "oldBad" };
      const app = createMockApp({
        services: {
          good: oldGoodInstance,
          bad: oldBadInstance,
        },
      });

      // 两个都在 invalidation set 中
      const invalidated = new Set([
        join(servicesDir, "bad.js"),
        join(servicesDir, "good.js"),
      ]);

      // 应抛出错误
      await expect(reloadServices(app, outDir, invalidated)).rejects.toThrow();

      // 回滚后旧实例应恢复
      // 注意：由于执行顺序，bad 会先于 good（字母排序），
      // bad 失败时 good 可能还没被处理。
      // 但回滚会恢复所有 previousServices 中记录的旧值。
      expect(app.services.bad).toBe(oldBadInstance);
    });

    it("应在回滚时记录错误日志", async () => {
      await writeFile(
        join(servicesDir, "failing.js"),
        "throw new Error('module load error');",
      );

      const app = createMockApp({
        services: {
          failing: { name: "oldFailing" },
        },
      });

      const invalidated = new Set([join(servicesDir, "failing.js")]);

      await expect(reloadServices(app, outDir, invalidated)).rejects.toThrow();

      expect(app.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("rolling back"),
      );
    });
  });

  // ── require.cache 匹配逻辑 ────────────────────────────

  describe("require.cache 匹配逻辑", () => {
    it("应通过 require.resolve 匹配 invalidation set 中的路径", async () => {
      await writeFile(
        join(servicesDir, "resolv.js"),
        "module.exports = { default: { name: 'resolved' } }",
      );

      const app = createMockApp({
        services: { resolv: { name: "old" } },
      });

      // 使用 require.resolve 后的路径放入 invalidation set
      const resolvedPath = require.resolve(join(servicesDir, "resolv.js"));
      const invalidated = new Set([resolvedPath]);

      const result = await reloadServices(app, outDir, invalidated);
      expect(result.reloaded).toBe(1);
    });
  });

  // ── 结果统计 ──────────────────────────────────────────

  describe("结果统计", () => {
    it("应正确统计 reloaded 和 unchanged 数量", async () => {
      await writeFile(
        join(servicesDir, "a.js"),
        "module.exports = { default: { name: 'a' } }",
      );
      await writeFile(
        join(servicesDir, "b.js"),
        "module.exports = { default: { name: 'b' } }",
      );
      await writeFile(
        join(servicesDir, "c.js"),
        "module.exports = { default: { name: 'c' } }",
      );

      const app = createMockApp({
        services: {
          a: { name: "oldA" },
          b: { name: "oldB" },
          c: { name: "oldC" },
        },
      });

      // 只有 a 和 c 在 invalidation set 中
      const invalidated = new Set([
        join(servicesDir, "a.js"),
        join(servicesDir, "c.js"),
      ]);

      const result = await reloadServices(app, outDir, invalidated);

      expect(result.reloaded).toBe(2);
      expect(result.unchanged).toBe(1);
      expect(result.reloadedKeys).toContain("a");
      expect(result.reloadedKeys).toContain("c");
      expect(result.reloadedKeys).not.toContain("b");
    });

    it("应在日志中输出重载统计信息", async () => {
      await writeFile(
        join(servicesDir, "x.js"),
        "module.exports = { default: { name: 'x' } }",
      );
      await writeFile(
        join(servicesDir, "y.js"),
        "module.exports = { default: { name: 'y' } }",
      );

      const app = createMockApp();

      const invalidated = new Set([join(servicesDir, "x.js")]);
      await reloadServices(app, outDir, invalidated);

      expect(app.logger.info).toHaveBeenCalledWith(
        expect.stringContaining("1 changed"),
      );
      expect(app.logger.info).toHaveBeenCalledWith(
        expect.stringContaining("1 unchanged"),
      );
    });
  });

  // ── 边界情况 ──────────────────────────────────────────

  describe("边界情况", () => {
    it("应处理 invalidation set 中有不存在的文件路径", async () => {
      await writeFile(
        join(servicesDir, "existing.js"),
        "module.exports = { default: { name: 'exists' } }",
      );

      const app = createMockApp();

      // invalidation set 中包含一个不存在的文件路径
      const invalidated = new Set([
        join(servicesDir, "existing.js"),
        join(servicesDir, "ghost.js"), // 不存在
      ]);

      // ghost.js 不在 allServiceFiles 中，所以不会被处理
      const result = await reloadServices(app, outDir, invalidated);
      expect(result.reloaded).toBe(1);
      expect(result.reloadedKeys).toEqual(["existing"]);
    });

    it("应处理 service 文件导出 null", async () => {
      await writeFile(
        join(servicesDir, "nullsvc.js"),
        "module.exports = { default: null }",
      );

      const app = createMockApp();
      const invalidated = new Set([join(servicesDir, "nullsvc.js")]);
      const result = await reloadServices(app, outDir, invalidated);

      expect(result.reloaded).toBe(1);
      expect(app.services.nullsvc).toBeNull();
    });

    it("应处理 service 文件导出数值", async () => {
      await writeFile(
        join(servicesDir, "num.js"),
        "module.exports = { default: 42 }",
      );

      const app = createMockApp();
      const invalidated = new Set([join(servicesDir, "num.js")]);
      const result = await reloadServices(app, outDir, invalidated);

      expect(result.reloaded).toBe(1);
      expect(app.services.num).toBe(42);
    });

    it("应处理 service 文件导出字符串", async () => {
      await writeFile(
        join(servicesDir, "str.js"),
        "module.exports = { default: 'hello' }",
      );

      const app = createMockApp();
      const invalidated = new Set([join(servicesDir, "str.js")]);
      const result = await reloadServices(app, outDir, invalidated);

      expect(result.reloaded).toBe(1);
      expect(app.services.str).toBe("hello");
    });

    it("应处理首次加载（旧实例为 undefined）", async () => {
      await writeFile(
        join(servicesDir, "fresh.js"),
        "module.exports = { default: { name: 'fresh' } }",
      );

      const app = createMockApp();
      const invalidated = new Set([join(servicesDir, "fresh.js")]);
      const result = await reloadServices(app, outDir, invalidated);

      expect(result.reloaded).toBe(1);
      expect((app.services.fresh as { name: string }).name).toBe("fresh");
    });
  });
});
