/**
 * scalar-assets.test.ts — registerScalarAssets 单元测试
 *
 * 覆盖所有决策分支（9 个场景）：
 *   场景 1: 包已安装，dist/browser/standalone.js 存在 → 返回本地路由，不安装
 *   场景 2: dist/browser/standalone.js 不存在，dist/index.js 作为 fallback
 *   场景 3: 包未安装，自动安装成功 → execSync 调用一次，返回本地路由
 *   场景 4: 包未安装，安装失败 → throw Error 含所有包管理器命令（含 bun）
 *   场景 5: 用户配置了 cdnUrl → 立即返回 null，不触发任何检测或安装
 *   场景 6: readFileSync 读取失败 → throw Error 含文件路径
 *   场景 7: npm 项目（无 lockfile）→ 使用 npm install --no-save
 *   场景 8: pnpm 项目（有 pnpm-lock.yaml）→ 使用 pnpm add
 *   场景 9: exports 字段阻止 ./package.json 解析（ERR_PACKAGE_PATH_NOT_EXPORTED）
 *           → 策略 2：resolve 主入口 + 向上遍历 findPackageRoot → 返回本地路由
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── 模块 mock（vitest 会自动提升到文件顶部）────────────────────

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("node:module", () => ({
  createRequire: vi.fn(),
}));

import { registerScalarAssets } from "../../../src/lib/openapi/scalar-assets.js";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { VextApp } from "../../../src/types/app.js";

// ── Mock 类型引用 ─────────────────────────────────────────────

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockCreateRequire = vi.mocked(createRequire);

// ── 辅助：创建最小化 VextApp mock ────────────────────────────

function createMockApp(): VextApp {
  return {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    },
    adapter: {
      registerRoute: vi.fn(),
    },
  } as unknown as VextApp;
}

/**
 * 设置 createRequire mock：resolve() 返回指定 pkgJsonPath
 */
function setupRequireResolves(pkgJsonPath: string) {
  const requireFn = { resolve: vi.fn().mockReturnValue(pkgJsonPath) };
  mockCreateRequire.mockReturnValue(requireFn as unknown as NodeRequire);
  return requireFn;
}

/**
 * 设置 createRequire mock：策略 2 场景
 *
 * 模拟 @scalar/api-reference 的 exports 字段阻止 ./package.json 解析：
 *   - 第一次调用 resolve('@scalar/api-reference/package.json')
 *     → 抛出 ERR_PACKAGE_PATH_NOT_EXPORTED
 *   - 第二次调用 resolve('@scalar/api-reference')
 *     → 返回主入口路径（如 .../dist/index.js）
 *
 * 调用方通过 existsSync 控制 findPackageRoot 的向上遍历结果：
 *   - 对 package.json 路径返回 true 表示找到包根目录
 *   - 对 standalone.js 候选路径返回 true 表示文件存在
 */
function setupRequireStrategy2(mainEntryPath: string) {
  let callCount = 0;
  const requireFn = {
    resolve: vi.fn().mockImplementation((specifier: string) => {
      callCount++;
      if (specifier.endsWith("/package.json")) {
        // 策略 1 失败：exports 字段屏蔽了 ./package.json
        const err = new Error(
          "Package subpath './package.json' is not defined by \"exports\" in " +
            "/fake/node_modules/@scalar/api-reference/package.json",
        );
        (err as NodeJS.ErrnoException).code = "ERR_PACKAGE_PATH_NOT_EXPORTED";
        throw err;
      }
      // 策略 2：resolve 主入口成功
      return mainEntryPath;
    }),
  };
  mockCreateRequire.mockReturnValue(requireFn as unknown as NodeRequire);
  return requireFn;
}

/**
 * 设置 createRequire mock：resolve() 始终抛出 MODULE_NOT_FOUND
 */
function setupRequireNotFound() {
  const requireFn = {
    resolve: vi.fn().mockImplementation(() => {
      const err = new Error(
        "Cannot find module '@scalar/api-reference/package.json'",
      );
      (err as NodeJS.ErrnoException).code = "MODULE_NOT_FOUND";
      throw err;
    }),
  };
  mockCreateRequire.mockReturnValue(requireFn as unknown as NodeRequire);
  return requireFn;
}

/**
 * 设置 createRequire mock：第一次 resolve() 失败，之后成功返回 pkgJsonPath
 * 模拟"包未安装 → 自动安装成功 → 再次 resolve 成功"场景
 */
function setupRequireFailThenSucceed(pkgJsonPath: string) {
  let callCount = 0;
  const requireFn = {
    resolve: vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        const err = new Error(
          "Cannot find module '@scalar/api-reference/package.json'",
        );
        (err as NodeJS.ErrnoException).code = "MODULE_NOT_FOUND";
        throw err;
      }
      return pkgJsonPath;
    }),
  };
  mockCreateRequire.mockReturnValue(requireFn as unknown as NodeRequire);
  return requireFn;
}

// ═════════════════════════════════════════════════════════════
// registerScalarAssets 单元测试
// ═════════════════════════════════════════════════════════════

describe("registerScalarAssets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 场景 1：包已安装，dist/browser/standalone.js 存在 ──────
  describe("场景 1: 包已安装，dist/browser/standalone.js 存在", () => {
    it("返回 /_vext/scalar.js，不调用 execSync", () => {
      const app = createMockApp();
      const fakePkgDir = "/fake/node_modules/@scalar/api-reference";

      setupRequireResolves(`${fakePkgDir}/package.json`);
      // existsSync: 无 lockfile（默认 npm），standalone.js 存在
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("standalone.js"),
      );
      mockReadFileSync.mockReturnValue("window.Scalar = {}");

      const result = registerScalarAssets(app);

      expect(result).toBe("/_vext/scalar.js");
      expect(mockExecSync).not.toHaveBeenCalled();
      expect(app.adapter.registerRoute).toHaveBeenCalledWith(
        "GET",
        "/_vext/scalar.js",
        expect.any(Array),
      );
    });

    it("注册的路由 handler 正确设置 Content-Type / Cache-Control 并返回文件内容", async () => {
      const app = createMockApp();
      const fakePkgDir = "/fake/node_modules/@scalar/api-reference";
      const fakeContent = "window.Scalar = {}; /* standalone test */";

      setupRequireResolves(`${fakePkgDir}/package.json`);
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("standalone.js"),
      );
      mockReadFileSync.mockReturnValue(fakeContent);

      registerScalarAssets(app);

      // 取出注册的路由 chain 并调用 handler
      const registerRouteMock = app.adapter
        .registerRoute as unknown as ReturnType<typeof vi.fn>;
      const chain: Array<(...args: unknown[]) => unknown> =
        registerRouteMock.mock.calls[0][2];
      const handler = chain[0];

      const mockRes = {
        setHeader: vi.fn().mockReturnThis(),
        text: vi.fn(),
      };

      await handler({}, mockRes, async () => {});

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "application/javascript; charset=utf-8",
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        "Cache-Control",
        "public, max-age=3600",
      );
      expect(mockRes.text).toHaveBeenCalledWith(fakeContent);
    });
  });

  // ── 场景 2：fallback 路径 dist/index.js ──────────────────────
  describe("场景 2: dist/browser/standalone.js 不存在，fallback dist/index.js", () => {
    it("使用 dist/index.js 且正常返回 /_vext/scalar.js", () => {
      const app = createMockApp();
      const fakePkgDir = "/fake/node_modules/@scalar/api-reference";

      setupRequireResolves(`${fakePkgDir}/package.json`);
      // standalone.js 不存在，index.js 存在
      mockExistsSync.mockImplementation((p) => {
        const s = String(p);
        if (s.endsWith("standalone.js")) return false;
        if (s.endsWith("index.js")) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue("window.Scalar = {}; /* index */");

      const result = registerScalarAssets(app);

      expect(result).toBe("/_vext/scalar.js");
      expect(mockExecSync).not.toHaveBeenCalled();

      // readFileSync 读取的应是 index.js 路径，而非 standalone.js
      const readPath = String(mockReadFileSync.mock.calls[0][0]);
      expect(readPath).toContain("index.js");
      expect(readPath).not.toContain("standalone.js");
    });
  });

  // ── 场景 3：包未安装，自动安装成功 ──────────────────────────
  describe("场景 3: 包未安装，自动安装成功", () => {
    it('调用 execSync 一次，最终返回 /_vext/scalar.js，日志含"安装成功"', () => {
      const app = createMockApp();
      const fakePkgDir = "/fake/node_modules/@scalar/api-reference";

      setupRequireFailThenSucceed(`${fakePkgDir}/package.json`);
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("standalone.js"),
      );
      mockReadFileSync.mockReturnValue("window.Scalar = {}");
      // execSync 的返回值在测试中无关紧要；返回空字符串满足 string | NonSharedBuffer 类型
      mockExecSync.mockReturnValue("");

      const result = registerScalarAssets(app);

      expect(result).toBe("/_vext/scalar.js");
      expect(mockExecSync).toHaveBeenCalledTimes(1);
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining("@scalar/api-reference"),
        expect.objectContaining({ stdio: "inherit" }),
      );

      const loggerInfo = app.logger.info as unknown as ReturnType<typeof vi.fn>;
      const infoMessages: string[] = loggerInfo.mock.calls.map((c: unknown[]) =>
        String(c[0]),
      );
      expect(infoMessages.some((m) => m.includes("安装成功"))).toBe(true);
    });
  });

  // ── 场景 4：包未安装，安装失败 ──────────────────────────────
  describe("场景 4: 包未安装，安装失败", () => {
    it("throw Error，错误信息包含 npm/pnpm/yarn/bun 全部 4 个手动安装命令", () => {
      const app = createMockApp();

      setupRequireNotFound();
      mockExistsSync.mockReturnValue(false);
      mockExecSync.mockImplementation(() => {
        throw new Error("npm ERR! network timeout");
      });

      let caughtError: Error | undefined;
      try {
        registerScalarAssets(app);
      } catch (err) {
        caughtError = err as Error;
      }

      expect(caughtError).toBeDefined();
      const msg = caughtError!.message;

      expect(msg).toContain("自动安装");
      expect(msg).toContain("npm install @scalar/api-reference");
      expect(msg).toContain("pnpm add @scalar/api-reference");
      expect(msg).toContain("yarn add @scalar/api-reference");
      expect(msg).toContain("bun add @scalar/api-reference");
    });
  });

  // ── 场景 5：用户配置了 cdnUrl ────────────────────────────────
  describe("场景 5: 用户配置了 scalar.cdnUrl", () => {
    it("立即返回 null，不调用 createRequire、execSync，不注册路由", () => {
      const app = createMockApp();

      const result = registerScalarAssets(
        app,
        "https://cdn.example.com/scalar.js",
      );

      expect(result).toBeNull();
      expect(mockCreateRequire).not.toHaveBeenCalled();
      expect(mockExecSync).not.toHaveBeenCalled();
      expect(app.adapter.registerRoute).not.toHaveBeenCalled();
    });

    it("空字符串 cdnUrl 视为未配置（继续本地化流程）", () => {
      const app = createMockApp();
      const fakePkgDir = "/fake/node_modules/@scalar/api-reference";

      setupRequireResolves(`${fakePkgDir}/package.json`);
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("standalone.js"),
      );
      mockReadFileSync.mockReturnValue("window.Scalar = {}");

      // 空字符串是 falsy，registerScalarAssets 应继续本地化流程
      const result = registerScalarAssets(app, "");

      expect(result).toBe("/_vext/scalar.js");
    });
  });

  // ── 场景 6：readFileSync 读取失败 ────────────────────────────
  describe("场景 6: readFileSync 读取文件失败", () => {
    it("throw Error，错误信息包含失败原因、文件路径、手动安装建议", () => {
      const app = createMockApp();
      const fakePkgDir = "/fake/node_modules/@scalar/api-reference";

      setupRequireResolves(`${fakePkgDir}/package.json`);
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith("standalone.js"),
      );
      mockReadFileSync.mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });

      let caughtError: Error | undefined;
      try {
        registerScalarAssets(app);
      } catch (err) {
        caughtError = err as Error;
      }

      expect(caughtError).toBeDefined();
      // 统一路径分隔符（Windows 用 \，POSIX 用 /），使测试平台无关
      const msg = caughtError!.message.replace(/\\/g, "/");

      expect(msg).toContain("读取 @scalar/api-reference 文件失败");
      expect(msg).toContain("EACCES: permission denied");
      // 检查路径包含包名 + 文件名（平台无关）
      expect(msg).toContain("@scalar/api-reference");
      expect(msg).toContain("standalone.js");
      expect(msg).toContain("npm install @scalar/api-reference");
    });
  });

  // ── 场景 7：npm 项目（无任何 lockfile）──────────────────────
  describe("场景 7: npm 项目（无任何 lockfile）", () => {
    it("安装命令使用 npm install --no-save", () => {
      const app = createMockApp();
      const fakePkgDir = "/fake/node_modules/@scalar/api-reference";

      setupRequireFailThenSucceed(`${fakePkgDir}/package.json`);

      // 无任何 lockfile，standalone.js 安装后存在
      mockExistsSync.mockImplementation((p) => {
        const s = String(p);
        if (
          s.endsWith("pnpm-lock.yaml") ||
          s.endsWith("yarn.lock") ||
          s.endsWith("bun.lockb")
        ) {
          return false;
        }
        return s.endsWith("standalone.js");
      });

      mockReadFileSync.mockReturnValue("window.Scalar = {}");
      mockExecSync.mockReturnValue("");

      registerScalarAssets(app);

      expect(mockExecSync).toHaveBeenCalledWith(
        "npm install @scalar/api-reference --no-save",
        expect.objectContaining({
          stdio: "inherit",
          cwd: expect.any(String),
        }),
      );
    });
  });

  // ── 场景 8：pnpm 项目（有 pnpm-lock.yaml）────────────────────
  describe("场景 8: pnpm 项目（有 pnpm-lock.yaml）", () => {
    it("安装命令使用 pnpm add（不含 --no-save）", () => {
      const app = createMockApp();
      const fakePkgDir = "/fake/node_modules/@scalar/api-reference";

      setupRequireFailThenSucceed(`${fakePkgDir}/package.json`);

      // pnpm-lock.yaml 存在，standalone.js 安装后存在
      mockExistsSync.mockImplementation((p) => {
        const s = String(p);
        if (s.endsWith("pnpm-lock.yaml")) return true;
        return s.endsWith("standalone.js");
      });

      mockReadFileSync.mockReturnValue("window.Scalar = {}");
      mockExecSync.mockReturnValue("");

      registerScalarAssets(app);

      expect(mockExecSync).toHaveBeenCalledWith(
        "pnpm add @scalar/api-reference",
        expect.objectContaining({ stdio: "inherit" }),
      );

      const actualCmd = String(mockExecSync.mock.calls[0][0]);
      expect(actualCmd).not.toContain("--no-save");
    });
  });

  // ── 场景 9：exports 字段阻止 ./package.json → 策略 2 ─────────
  describe("场景 9: @scalar exports 阻止 ./package.json（ERR_PACKAGE_PATH_NOT_EXPORTED）", () => {
    it("策略 2：resolve 主入口 + findPackageRoot 向上遍历 → 返回 /_vext/scalar.js", () => {
      const app = createMockApp();
      // 模拟 @scalar/api-reference 主入口路径（dist/index.js）
      const fakeMainEntry =
        "/fake/node_modules/@scalar/api-reference/dist/index.js";
      const fakePkgDir = "/fake/node_modules/@scalar/api-reference";

      // 策略 1 失败（ERR_PACKAGE_PATH_NOT_EXPORTED），策略 2 返回主入口
      setupRequireStrategy2(fakeMainEntry);

      // existsSync 模拟：
      //   - fakePkgDir/package.json → true（findPackageRoot 命中包根）
      //   - fakePkgDir/dist/browser/standalone.js → true（候选文件存在）
      //   - 其他（lockfile 等）→ false
      mockExistsSync.mockImplementation((p) => {
        const s = String(p).replace(/\\/g, "/");
        if (s === `${fakePkgDir}/package.json`) return true;
        if (s.endsWith("standalone.js")) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue("window.Scalar = { strategy2: true }");

      const result = registerScalarAssets(app);

      // 断言：最终使用本地路由
      expect(result).toBe("/_vext/scalar.js");
      // 策略 2 不触发安装（包已存在）
      expect(mockExecSync).not.toHaveBeenCalled();
      // 路由已注册
      expect(app.adapter.registerRoute).toHaveBeenCalledWith(
        "GET",
        "/_vext/scalar.js",
        expect.any(Array),
      );
    });

    it("策略 2 找到包根后，fallback dist/index.js 作为 standalone 候选", () => {
      const app = createMockApp();
      const fakeMainEntry =
        "/fake/node_modules/@scalar/api-reference/dist/index.js";
      const fakePkgDir = "/fake/node_modules/@scalar/api-reference";

      setupRequireStrategy2(fakeMainEntry);

      // standalone.js 不存在，index.js 存在
      mockExistsSync.mockImplementation((p) => {
        const s = String(p).replace(/\\/g, "/");
        if (s === `${fakePkgDir}/package.json`) return true;
        if (s.endsWith("standalone.js")) return false;
        if (s.endsWith("index.js")) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue("window.Scalar = { fallback: true }");

      const result = registerScalarAssets(app);

      expect(result).toBe("/_vext/scalar.js");
      // readFileSync 读取的应是 index.js 路径
      const readPath = String(mockReadFileSync.mock.calls[0][0]).replace(
        /\\/g,
        "/",
      );
      expect(readPath).toContain("index.js");
      expect(readPath).not.toContain("standalone.js");
    });
  });
});
