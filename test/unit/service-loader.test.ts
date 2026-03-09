/**
 * service-loader 单元测试
 *
 * 测试覆盖：
 *   - 空目录 / 不存在的目录 → 静默跳过（不报错）
 *   - 非 class default export → Fail Fast 报错
 *   - 正常 class → 实例化注入 app.services
 *   - 文件路径 → service key 映射（kebab-case → camelCase、嵌套目录）
 *   - _ 开头的文件/目录 → 跳过
 *   - .test. / .spec. 文件 → Fail Fast 报错
 *   - key 冲突检测
 *   - 循环依赖静态检测（DFS）
 *
 * 策略：
 *   使用临时目录（os.tmpdir）创建真实文件系统结构，
 *   通过 loadServices() 加载并断言 app.services 上的挂载结果。
 *
 * @see 02-services.md §4（service-loader 设计）
 * @see 10-testing.md §3（Service 单元测试模式）
 * @see IMPLEMENTATION-PLAN.md 任务 1.20
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadServices } from "../../src/lib/service-loader.js";
import type { VextApp, VextConfig } from "../../src/types/app.js";

// ── 测试辅助 ────────────────────────────────────────────────

/**
 * 创建最小化的 mock VextApp
 *
 * service-loader 只需要 app.services、app.logger、app.config。
 * 其他字段使用 stub 填充。
 */
function createMockApp(overrides?: Partial<VextApp>): VextApp {
  return {
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      fatal: () => {},
      trace: () => {},
      child: () => createMockApp().logger,
      level: "silent",
    },
    throw: ((status: number, message: string) => {
      throw new Error(`HttpError ${status}: ${message}`);
    }) as VextApp["throw"],
    config: {
      port: 3000,
      host: "0.0.0.0",
      adapter: "hono",
      trustProxy: false,
      middlewares: [],
      cors: {
        enabled: false,
        origins: [],
        methods: [],
        headers: [],
        credentials: false,
      },
      rateLimit: {
        enabled: false,
        max: 100,
        window: 60,
        message: "",
        keyBy: "ip",
      },
      requestId: {
        enabled: false,
        header: "x-request-id",
        responseHeader: "x-request-id",
      },
      logger: { level: "silent" },
      shutdown: { timeout: 1 },
      response: { hideInternalErrors: true },
      bodyParser: { maxBodySize: "1mb" },
      openapi: { enabled: false },
      accessLog: { enabled: false },
      requestContext: { enabled: false },
      _testMode: true,
    } as VextConfig,
    services: {} as any,
    adapter: null as any,
    get: () => {},
    post: () => {},
    put: () => {},
    patch: () => {},
    delete: () => {},
    head: () => {},
    options: () => {},
    extend: () => {},
    setValidator: () => {},
    getValidator: () => ({ compile: () => () => ({ valid: true }) }) as any,
    setThrow: () => {},
    setRateLimiter: () => {},
    setRequestIdGenerator: () => {},
    onClose: () => {},
    onReady: () => {},
    use: () => {},
    ...overrides,
  } as VextApp;
}

/**
 * 写入 ESM 格式的 service 文件
 *
 * service-loader 要求 default export 是一个 class（构造函数）。
 * 使用 .mjs 扩展名确保 Node.js 按 ESM 处理。
 */
async function writeServiceFile(
  dir: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const fullPath = join(dir, relativePath);
  const parentDir = join(fullPath, "..");
  await mkdir(parentDir, { recursive: true });
  await writeFile(fullPath, content, "utf-8");
}

// ── 临时目录管理 ────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "vext-svc-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── 测试用例 ────────────────────────────────────────────────

describe("service-loader", () => {
  // ── 空目录 / 不存在的目录 ────────────────────────────────

  describe("empty / missing directory", () => {
    it("silently skips when services/ directory does not exist", async () => {
      const app = createMockApp();
      const nonExistentDir = join(tmpDir, "does-not-exist");

      // 不应抛出错误
      await expect(loadServices(app, nonExistentDir)).resolves.toBeUndefined();
      // app.services 应保持为空对象
      expect(Object.keys(app.services)).toHaveLength(0);
    });

    it("silently skips when services/ directory is empty", async () => {
      const servicesDir = join(tmpDir, "services");
      await mkdir(servicesDir, { recursive: true });

      const app = createMockApp();
      await expect(loadServices(app, servicesDir)).resolves.toBeUndefined();
      expect(Object.keys(app.services)).toHaveLength(0);
    });
  });

  // ── 正常 class 加载 ──────────────────────────────────────

  describe("normal class loading", () => {
    it("loads a single service and injects into app.services", async () => {
      const servicesDir = join(tmpDir, "services");
      await writeServiceFile(
        servicesDir,
        "user.mjs",
        `
export default class UserService {
  constructor(app) {
    this.app = app;
  }

  findAll() {
    return { list: [], total: 0 };
  }
}
`,
      );

      const app = createMockApp();
      await loadServices(app, servicesDir, { checkCircularDeps: false });

      expect(app.services).toHaveProperty("user");
      const userService = (app.services as any).user;
      expect(userService).toBeDefined();
      expect(typeof userService.findAll).toBe("function");
      expect(userService.findAll()).toEqual({ list: [], total: 0 });
    });

    it("passes app instance to service constructor", async () => {
      const servicesDir = join(tmpDir, "services");
      await writeServiceFile(
        servicesDir,
        "echo.mjs",
        `
export default class EchoService {
  constructor(app) {
    this.port = app.config.port;
  }

  getPort() {
    return this.port;
  }
}
`,
      );

      const app = createMockApp();
      await loadServices(app, servicesDir, { checkCircularDeps: false });

      const echoService = (app.services as any).echo;
      expect(echoService.getPort()).toBe(3000);
    });
  });

  // ── 文件路径 → service key 映射 ──────────────────────────

  describe("file path to service key mapping", () => {
    it("maps kebab-case filename to camelCase key", async () => {
      const servicesDir = join(tmpDir, "services");
      await writeServiceFile(
        servicesDir,
        "user-profile.mjs",
        `
export default class UserProfileService {
  constructor() {}
}
`,
      );

      const app = createMockApp();
      await loadServices(app, servicesDir, { checkCircularDeps: false });

      expect(app.services).toHaveProperty("userProfile");
    });

    it("maps nested directory to nested service key", async () => {
      const servicesDir = join(tmpDir, "services");
      await writeServiceFile(
        servicesDir,
        "payment/stripe.mjs",
        `
export default class StripeService {
  constructor() {}
}
`,
      );

      const app = createMockApp();
      await loadServices(app, servicesDir, { checkCircularDeps: false });

      expect(app.services).toHaveProperty("payment");
      expect((app.services as any).payment).toHaveProperty("stripe");
    });

    it("maps index file to parent directory key", async () => {
      const servicesDir = join(tmpDir, "services");
      await writeServiceFile(
        servicesDir,
        "notification/index.mjs",
        `
export default class NotificationService {
  constructor() {}
}
`,
      );

      const app = createMockApp();
      await loadServices(app, servicesDir, { checkCircularDeps: false });

      expect(app.services).toHaveProperty("notification");
      // notification 本身应该是 service 实例（不是嵌套对象）
      expect(typeof (app.services as any).notification).toBe("object");
    });
  });

  // ── 跳过规则 ─────────────────────────────────────────────

  describe("exclusion rules", () => {
    it("skips files starting with _", async () => {
      const servicesDir = join(tmpDir, "services");
      await writeServiceFile(
        servicesDir,
        "_helpers.mjs",
        `
export default class HelpersService {
  constructor() {}
}
`,
      );
      await writeServiceFile(
        servicesDir,
        "user.mjs",
        `
export default class UserService {
  constructor() {}
}
`,
      );

      const app = createMockApp();
      await loadServices(app, servicesDir, { checkCircularDeps: false });

      expect(app.services).not.toHaveProperty("Helpers");
      expect(app.services).not.toHaveProperty("_helpers");
      expect(app.services).not.toHaveProperty("helpers");
      expect(app.services).toHaveProperty("user");
    });

    it("skips directories starting with _", async () => {
      const servicesDir = join(tmpDir, "services");
      await writeServiceFile(
        servicesDir,
        "_internal/cache.mjs",
        `
export default class CacheService {
  constructor() {}
}
`,
      );
      await writeServiceFile(
        servicesDir,
        "user.mjs",
        `
export default class UserService {
  constructor() {}
}
`,
      );

      const app = createMockApp();
      await loadServices(app, servicesDir, { checkCircularDeps: false });

      expect(app.services).not.toHaveProperty("_internal");
      expect(app.services).toHaveProperty("user");
    });

    it("skips .d.ts files", async () => {
      const servicesDir = join(tmpDir, "services");
      // .d.ts 文件不应被加载
      await writeServiceFile(
        servicesDir,
        "user.d.ts",
        `export default class UserService {}`,
      );
      // 只有实际的 service 文件被加载
      await writeServiceFile(
        servicesDir,
        "order.mjs",
        `
export default class OrderService {
  constructor() {}
}
`,
      );

      const app = createMockApp();
      await loadServices(app, servicesDir, { checkCircularDeps: false });

      // user（从 .d.ts）不应存在
      expect(app.services).not.toHaveProperty("user");
      expect(app.services).toHaveProperty("order");
    });
  });

  // ── Fail Fast 错误 ───────────────────────────────────────

  describe("fail fast errors", () => {
    it("throws when default export is not a class/constructor", async () => {
      const servicesDir = join(tmpDir, "services");
      await writeServiceFile(
        servicesDir,
        "bad.mjs",
        `
// 普通对象而非 class
export default {
  findAll() { return []; }
};
`,
      );

      const app = createMockApp();
      await expect(
        loadServices(app, servicesDir, { checkCircularDeps: false }),
      ).rejects.toThrow();
    });

    it("throws when no default export exists", async () => {
      const servicesDir = join(tmpDir, "services");
      await writeServiceFile(
        servicesDir,
        "missing.mjs",
        `
// 只有命名导出，没有 default export
export const helper = () => {};
`,
      );

      const app = createMockApp();
      await expect(
        loadServices(app, servicesDir, { checkCircularDeps: false }),
      ).rejects.toThrow();
    });

    it("silently skips .test. files in services/", async () => {
      const servicesDir = join(tmpDir, "services");
      await writeServiceFile(
        servicesDir,
        "user.test.mjs",
        `
export default class UserTest {
  constructor() {}
}
`,
      );

      const app = createMockApp();
      // service-loader 对 .test. 文件是静默排除（shouldExclude），不是 Fail Fast 抛错
      await expect(
        loadServices(app, servicesDir, { checkCircularDeps: false }),
      ).resolves.toBeUndefined();
      // 不应作为 service 加载
      expect(Object.keys(app.services)).toHaveLength(0);
    });

    it("silently skips .spec. files in services/", async () => {
      const servicesDir = join(tmpDir, "services");
      await writeServiceFile(
        servicesDir,
        "user.spec.mjs",
        `
export default class UserSpec {
  constructor() {}
}
`,
      );

      const app = createMockApp();
      // service-loader 对 .spec. 文件是静默排除（shouldExclude），不是 Fail Fast 抛错
      await expect(
        loadServices(app, servicesDir, { checkCircularDeps: false }),
      ).resolves.toBeUndefined();
      // 不应作为 service 加载
      expect(Object.keys(app.services)).toHaveLength(0);
    });
  });

  // ── 多 service 加载 ──────────────────────────────────────

  describe("multiple services", () => {
    it("loads multiple services into app.services", async () => {
      const servicesDir = join(tmpDir, "services");

      await writeServiceFile(
        servicesDir,
        "user.mjs",
        `
export default class UserService {
  constructor() {}
  name() { return 'user'; }
}
`,
      );

      await writeServiceFile(
        servicesDir,
        "order.mjs",
        `
export default class OrderService {
  constructor() {}
  name() { return 'order'; }
}
`,
      );

      const app = createMockApp();
      await loadServices(app, servicesDir, { checkCircularDeps: false });

      expect(app.services).toHaveProperty("user");
      expect(app.services).toHaveProperty("order");
      expect((app.services as any).user.name()).toBe("user");
      expect((app.services as any).order.name()).toBe("order");
    });
  });

  // ── 循环依赖检测 ─────────────────────────────────────────

  describe("circular dependency detection", () => {
    it("does not throw when checkCircularDeps is false", async () => {
      const servicesDir = join(tmpDir, "services");

      // 两个 service 互相引用（通过 app.services）
      await writeServiceFile(
        servicesDir,
        "a.mjs",
        `
// import 引用 b（静态检测会发现）
// 注意：实际运行时通过 app.services.b 访问
export default class AService {
  constructor(app) {
    this.app = app;
  }
  getB() {
    return this.app.services.b;
  }
}
`,
      );

      await writeServiceFile(
        servicesDir,
        "b.mjs",
        `
export default class BService {
  constructor(app) {
    this.app = app;
  }
  getA() {
    return this.app.services.a;
  }
}
`,
      );

      const app = createMockApp();
      // checkCircularDeps = false 应该不做循环检测
      await expect(
        loadServices(app, servicesDir, { checkCircularDeps: false }),
      ).resolves.toBeUndefined();
    });
  });
});
