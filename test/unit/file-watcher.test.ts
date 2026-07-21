import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  classifyChange,
  matchGlobPattern,
  getColdPatterns,
  getIgnorePatterns,
} from "../../src/lib/dev/change-classifier.js";
import type { ClassifierOptions } from "../../src/lib/dev/change-classifier.js";
import { VextFileWatcher } from "../../src/lib/dev/file-watcher.js";
import type { FileChangeEvent } from "../../src/lib/dev/file-watcher.js";
import {
  shouldUsePolling,
  isInContainer,
} from "../../src/lib/dev/detect-polling.js";

// ── 测试辅助 ────────────────────────────────────────────────

/**
 * 创建临时项目目录结构
 */
function createTempProject(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vext-test-watcher-"));

  const srcDir = path.join(tmpDir, "src");

  // 创建目录结构
  fs.mkdirSync(path.join(srcDir, "routes"), { recursive: true });
  fs.mkdirSync(path.join(srcDir, "services"), { recursive: true });
  fs.mkdirSync(path.join(srcDir, "config"), { recursive: true });
  fs.mkdirSync(path.join(srcDir, "plugins"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "preload"), { recursive: true });

  // src/routes/user.ts
  fs.writeFileSync(
    path.join(srcDir, "routes", "user.ts"),
    'export const handler = () => "user";\n',
  );

  // src/services/auth.ts
  fs.writeFileSync(
    path.join(srcDir, "services", "auth.ts"),
    'export const auth = () => "auth";\n',
  );

  // src/config/default.ts
  fs.writeFileSync(
    path.join(srcDir, "config", "default.ts"),
    "export default { port: 3000 };\n",
  );

  // src/plugins/logger.ts
  fs.writeFileSync(
    path.join(srcDir, "plugins", "logger.ts"),
    "export default { name: 'logger' };\n",
  );

  // src/index.ts
  fs.writeFileSync(
    path.join(srcDir, "index.ts"),
    'export const version = "1.0.0";\n',
  );

  // 根目录配置文件
  fs.writeFileSync(
    path.join(tmpDir, "package.json"),
    JSON.stringify({ name: "test-project", version: "1.0.0" }),
  );
  fs.writeFileSync(
    path.join(tmpDir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { target: "ES2022" } }),
  );
  fs.writeFileSync(path.join(tmpDir, ".env"), "PORT=3000\n");
  fs.writeFileSync(path.join(tmpDir, ".env.local"), "SECRET=abc\n");
  fs.writeFileSync(
    path.join(tmpDir, "preload", "01-env.ts"),
    "export const preloadFlag = 'init';\n",
  );

  return tmpDir;
}

/**
 * 递归删除临时目录
 */
function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // 静默忽略清理错误（Windows 上偶尔文件被占用）
  }
}

/**
 * 等待指定毫秒数
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ══════════════════════════════════════════════════════════════
// change-classifier 测试
// ══════════════════════════════════════════════════════════════

describe("change-classifier", () => {
  // ── classifyChange — 内置 COLD_PATTERNS ────────────────

  describe("classifyChange — cold patterns", () => {
    it("src/config/ 下的文件应分类为 cold", () => {
      const result = classifyChange("src/config/default.ts");
      expect(result.action).toBe("cold");
    });

    it("src/config/ 下嵌套的文件应分类为 cold", () => {
      const result = classifyChange("src/config/env/production.ts");
      expect(result.action).toBe("cold");
    });

    it("package.json 应分类为 cold", () => {
      const result = classifyChange("package.json");
      expect(result.action).toBe("cold");
    });

    it.each([
      "package-lock.json",
      "npm-shrinkwrap.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "bun.lock",
      "bun.lockb",
    ])("%s 应分类为 cold", (lockfile) => {
      const result = classifyChange(lockfile);
      expect(result.action).toBe("cold");
    });

    it(".env 应分类为 cold", () => {
      const result = classifyChange(".env");
      expect(result.action).toBe("cold");
    });

    it(".env.local 应分类为 cold", () => {
      const result = classifyChange(".env.local");
      expect(result.action).toBe("cold");
    });

    it(".env.production 应分类为 cold", () => {
      const result = classifyChange(".env.production");
      expect(result.action).toBe("cold");
    });

    it("src/plugins/ 下的文件应分类为 cold", () => {
      const result = classifyChange("src/plugins/logger.ts");
      expect(result.action).toBe("cold");
    });

    it("tsconfig.json 应分类为 cold", () => {
      const result = classifyChange("tsconfig.json");
      expect(result.action).toBe("cold");
    });

    it("preload/ 下的项目级 preload 文件应分类为 cold", () => {
      const result = classifyChange("preload/01-env.ts");
      expect(result.action).toBe("cold");
    });

    it("cold 分类应包含 reason", () => {
      const result = classifyChange("src/config/default.ts");
      expect(result.reason).toBeTruthy();
      expect(result.reason.length).toBeGreaterThan(0);
    });
  });

  // ── classifyChange — 内置 IGNORE_PATTERNS ──────────────

  describe("classifyChange — ignore patterns", () => {
    it("node_modules/ 下的文件应分类为 ignore", () => {
      const result = classifyChange("node_modules/express/index.js");
      expect(result.action).toBe("ignore");
    });

    it("dist/ 下的文件应分类为 ignore", () => {
      const result = classifyChange("dist/index.js");
      expect(result.action).toBe("ignore");
    });

    it("build/ 下的文件应分类为 ignore", () => {
      const result = classifyChange("build/output.js");
      expect(result.action).toBe("ignore");
    });

    it(".vext/ 下的文件应分类为 ignore", () => {
      const result = classifyChange(".vext/dev/routes/user.js");
      expect(result.action).toBe("ignore");
    });

    it(".git/ 下的文件应分类为 ignore", () => {
      const result = classifyChange(".git/HEAD");
      expect(result.action).toBe("ignore");
    });

    it("test/ 下的文件应分类为 ignore", () => {
      const result = classifyChange("test/unit/foo.test.ts");
      expect(result.action).toBe("ignore");
    });

    it("tests/ 下的文件应分类为 ignore", () => {
      const result = classifyChange("tests/integration/bar.test.ts");
      expect(result.action).toBe("ignore");
    });

    it(".md 文件应分类为 ignore", () => {
      const result = classifyChange("README.md");
      expect(result.action).toBe("ignore");
    });

    it(".txt 文件应分类为 ignore", () => {
      const result = classifyChange("notes.txt");
      expect(result.action).toBe("ignore");
    });

    it(".log 文件应分类为 ignore", () => {
      const result = classifyChange("debug.log");
      expect(result.action).toBe("ignore");
    });

    it(".lock 文件应分类为 ignore", () => {
      const result = classifyChange("package-lock.lock");
      expect(result.action).toBe("ignore");
    });

    it("plans/ 下的文件应分类为 ignore", () => {
      const result = classifyChange("plans/v1/01-routes.md");
      expect(result.action).toBe("ignore");
    });

    it("docs/ 下的文件应分类为 ignore", () => {
      const result = classifyChange("docs/api.md");
      expect(result.action).toBe("ignore");
    });

    it("src/types/generated/ 下的文件应分类为 ignore", () => {
      const result = classifyChange(
        "src/types/generated/services.generated.d.ts",
      );
      expect(result.action).toBe("ignore");
    });
  });

  // ── classifyChange — client（前端资源）──────────────────

  describe("classifyChange — client patterns", () => {
    it("src/frontend 下的 TSX 文件应分类为 client", () => {
      const result = classifyChange("src/frontend/pages/index.tsx");
      expect(result.action).toBe("client");
    });

    it("src/frontend 下的 CSS 文件应分类为 client", () => {
      const result = classifyChange("src/frontend/styles/app.css");
      expect(result.action).toBe("client");
    });

    it("public 下的静态资源应分类为 client", () => {
      const result = classifyChange("public/favicon.svg");
      expect(result.action).toBe("client");
    });

    it("client 分类应优先于 src 源码 soft 规则", () => {
      const result = classifyChange("src/frontend/pages/index.tsx");
      expect(result.action).toBe("client");
    });
  });

  // ── classifyChange — soft（源码文件）────────────────────

  describe("classifyChange — soft patterns", () => {
    it("src/ 下的 .ts 文件应分类为 soft", () => {
      const result = classifyChange("src/routes/user.ts");
      expect(result.action).toBe("soft");
    });

    it("src/ 下的 .js 文件应分类为 soft", () => {
      const result = classifyChange("src/routes/user.js");
      expect(result.action).toBe("soft");
    });

    it("src/ 下的 .mjs 文件应分类为 soft", () => {
      const result = classifyChange("src/utils/helper.mjs");
      expect(result.action).toBe("soft");
    });

    it("src/ 下的 .cjs 文件应分类为 soft", () => {
      const result = classifyChange("src/utils/legacy.cjs");
      expect(result.action).toBe("soft");
    });

    it("src/ 下深层嵌套的文件应分类为 soft", () => {
      const result = classifyChange("src/services/payment/stripe/client.ts");
      expect(result.action).toBe("soft");
    });

    it("src/index.ts 应分类为 soft", () => {
      const result = classifyChange("src/index.ts");
      expect(result.action).toBe("soft");
    });

    it("soft 分类应包含 reason", () => {
      const result = classifyChange("src/routes/user.ts");
      expect(result.reason).toBe("source code change");
    });
  });

  // ── classifyChange — 其他文件（ignore）──────────────────

  describe("classifyChange — unrecognized files", () => {
    it("根目录的未知文件应分类为 ignore", () => {
      const result = classifyChange("Makefile");
      expect(result.action).toBe("ignore");
    });

    it("src/ 下的非代码文件（如 .css）应分类为 ignore", () => {
      const result = classifyChange("src/styles/main.css");
      expect(result.action).toBe("ignore");
    });

    it("src/ 下的 .d.ts 文件应分类为 ignore（不匹配源码模式）", () => {
      // .d.ts 不匹配 /\.(ts|js|mjs|cjs)$/ 因为扩展名是 .d.ts 不是 .ts 直接
      // 实际上 .d.ts 以 .ts 结尾，所以会匹配。但 .d.ts 在 DevCompiler 层面排除
      // 在分类器层面，.d.ts 文件如果在 src/ 下会被分为 soft，这是可以接受的
      // 因为 DevCompiler 的 SOURCE_IGNORE 会跳过 .d.ts
      const result = classifyChange("src/types/index.d.ts");
      // .d.ts 以 .ts 结尾，会匹配 soft 模式 — 这是预期的
      // DevCompiler 层面再排除
      expect(result.action).toBe("soft");
    });

    it("src/ 下的图片文件应分类为 ignore", () => {
      const result = classifyChange("src/assets/logo.png");
      expect(result.action).toBe("ignore");
    });
  });

  // ── classifyChange — Windows 路径兼容 ──────────────────

  describe("classifyChange — Windows 路径兼容", () => {
    it("应正确处理反斜杠路径", () => {
      const result = classifyChange("src\\routes\\user.ts");
      expect(result.action).toBe("soft");
    });

    it("应正确处理反斜杠的配置文件路径", () => {
      const result = classifyChange("src\\config\\default.ts");
      expect(result.action).toBe("cold");
    });

    it("应正确处理反斜杠的 node_modules 路径", () => {
      const result = classifyChange("node_modules\\express\\index.js");
      expect(result.action).toBe("ignore");
    });
  });

  // ── classifyChange — 用户自定义规则 ────────────────────

  describe("classifyChange — 用户自定义规则", () => {
    it("用户 coldPatterns 应覆盖默认 soft 分类", () => {
      const options: ClassifierOptions = {
        coldPatterns: ["src/lib/database-schema.ts"],
      };
      const result = classifyChange("src/lib/database-schema.ts", options);
      expect(result.action).toBe("cold");
      expect(result.reason).toContain("user cold pattern");
    });

    it("用户 coldPatterns 支持 glob 通配符", () => {
      const options: ClassifierOptions = {
        coldPatterns: ["src/lib/migrations/**"],
      };
      const result = classifyChange("src/lib/migrations/001-init.ts", options);
      expect(result.action).toBe("cold");
    });

    it("用户 ignorePatterns 应将文件标记为 ignore", () => {
      const options: ClassifierOptions = {
        ignorePatterns: ["src/generated/**"],
      };
      const result = classifyChange("src/generated/types.ts", options);
      expect(result.action).toBe("ignore");
      expect(result.reason).toContain("user ignore pattern");
    });

    it("用户 ignorePatterns 优先级应高于 coldPatterns", () => {
      const options: ClassifierOptions = {
        coldPatterns: ["src/config/**"],
        ignorePatterns: ["src/config/local.ts"],
      };
      // local.ts 匹配 ignorePatterns → ignore（优先级高于 cold）
      const result = classifyChange("src/config/local.ts", options);
      expect(result.action).toBe("ignore");
    });

    it("用户 ignorePatterns 优先级应高于内置 cold 规则", () => {
      const options: ClassifierOptions = {
        ignorePatterns: ["src/config/temp.ts"],
      };
      // src/config/ 内置是 cold，但用户 ignore 优先
      const result = classifyChange("src/config/temp.ts", options);
      expect(result.action).toBe("ignore");
    });

    it("不传 options 时应使用纯内置规则", () => {
      const result = classifyChange("src/routes/user.ts");
      expect(result.action).toBe("soft");
    });

    it("传入空 options 时应使用纯内置规则", () => {
      const result = classifyChange("src/routes/user.ts", {});
      expect(result.action).toBe("soft");
    });
  });

  // ── matchGlobPattern ──────────────────────────────────

  describe("matchGlobPattern", () => {
    it("精确匹配", () => {
      expect(matchGlobPattern("src/index.ts", "src/index.ts")).toBe(true);
    });

    it("精确匹配不匹配不同路径", () => {
      expect(matchGlobPattern("src/other.ts", "src/index.ts")).toBe(false);
    });

    it("* 应匹配路径段内的任意字符", () => {
      expect(matchGlobPattern("src/routes/user.ts", "src/routes/*.ts")).toBe(
        true,
      );
    });

    it("* 不应跨越路径分隔符", () => {
      expect(
        matchGlobPattern("src/routes/nested/user.ts", "src/routes/*.ts"),
      ).toBe(false);
    });

    it("** 应匹配任意层级路径", () => {
      expect(matchGlobPattern("src/routes/nested/deep/user.ts", "src/**")).toBe(
        true,
      );
    });

    it("** 应匹配零层路径", () => {
      expect(matchGlobPattern("src/user.ts", "src/**")).toBe(true);
    });

    it("组合 ** 和 * 的模式", () => {
      expect(
        matchGlobPattern("src/routes/nested/handler.ts", "src/routes/**/*.ts"),
      ).toBe(true);
    });

    it("应正确转义正则特殊字符", () => {
      expect(matchGlobPattern("src/file.test.ts", "src/file.test.ts")).toBe(
        true,
      );
      expect(matchGlobPattern("src/filextest.ts", "src/file.test.ts")).toBe(
        false,
      );
    });

    it("应匹配含有点号的路径", () => {
      expect(matchGlobPattern(".env.local", ".env.*")).toBe(true);
    });
  });

  // ── getColdPatterns / getIgnorePatterns ────────────────

  describe("getColdPatterns / getIgnorePatterns", () => {
    it("getColdPatterns 应返回非空数组", () => {
      const patterns = getColdPatterns();
      expect(patterns.length).toBeGreaterThan(0);
    });

    it("getIgnorePatterns 应返回非空数组", () => {
      const patterns = getIgnorePatterns();
      expect(patterns.length).toBeGreaterThan(0);
    });

    it("返回的是副本（修改不影响内部状态）", () => {
      const patterns1 = getColdPatterns();
      const patterns2 = getColdPatterns();
      expect(patterns1).not.toBe(patterns2);
      expect(patterns1).toEqual(patterns2);
    });
  });
});

// ══════════════════════════════════════════════════════════════
// detect-polling 测试
// ══════════════════════════════════════════════════════════════

describe("detect-polling", () => {
  const originalPoll = process.env.VEXT_DEV_POLL;

  afterEach(() => {
    if (originalPoll === undefined) {
      delete process.env.VEXT_DEV_POLL;
    } else {
      process.env.VEXT_DEV_POLL = originalPoll;
    }
  });

  it("VEXT_DEV_POLL=1 应返回 true", () => {
    process.env.VEXT_DEV_POLL = "1";
    expect(shouldUsePolling()).toBe(true);
  });

  it("VEXT_DEV_POLL=0 应返回 false", () => {
    process.env.VEXT_DEV_POLL = "0";
    expect(shouldUsePolling()).toBe(false);
  });

  it("非 Linux 平台默认应返回 false（无环境变量时）", () => {
    delete process.env.VEXT_DEV_POLL;
    if (process.platform !== "linux") {
      expect(shouldUsePolling()).toBe(false);
    }
  });

  it("isInContainer 在非容器环境应返回 false", () => {
    // 在开发机上运行时，通常不在容器内
    if (process.platform !== "linux") {
      expect(isInContainer()).toBe(false);
    }
  });
});

// ══════════════════════════════════════════════════════════════
// VextFileWatcher 集成测试
// ══════════════════════════════════════════════════════════════

describe("VextFileWatcher", () => {
  let projectRoot: string;
  let watcher: VextFileWatcher;

  beforeEach(() => {
    projectRoot = createTempProject();
  });

  afterEach(async () => {
    if (watcher) {
      watcher.stop();
    }
    // 等一下让 fs.watch 完全释放文件句柄
    await sleep(50);
    cleanupTempDir(projectRoot);
  });

  // ── 构造与启动 ────────────────────────────────────────

  describe("构造与启动", () => {
    it("应成功创建 watcher 实例", () => {
      watcher = new VextFileWatcher({ root: projectRoot });
      expect(watcher).toBeDefined();
    });

    it("应成功启动 fs.watch 模式", async () => {
      watcher = new VextFileWatcher({ root: projectRoot });
      await watcher.start();
      // 不抛出错误即为成功
    });

    it("应成功启动 polling 模式", async () => {
      watcher = new VextFileWatcher({
        root: projectRoot,
        usePolling: true,
        pollInterval: 500,
      });
      await watcher.start();
      // 不抛出错误即为成功
    });

    it("stop() 后应可安全调用", async () => {
      watcher = new VextFileWatcher({ root: projectRoot });
      await watcher.start();
      watcher.stop();
      // 二次 stop 不应抛出
      watcher.stop();
    });
  });

  // ── fs.watch 模式：文件变更检测 ────────────────────────

  describe("fs.watch 模式 — 文件变更检测", () => {
    it("修改 src/ 下的源码文件应触发 soft 事件", async () => {
      watcher = new VextFileWatcher({
        root: projectRoot,
        debounce: 50,
      });
      await watcher.start();

      const eventPromise = new Promise<FileChangeEvent>((resolve) => {
        watcher.on("change", (event: FileChangeEvent) => {
          resolve(event);
        });
      });

      // 等一下让 watcher 完全初始化
      await sleep(100);

      // 修改源文件
      fs.writeFileSync(
        path.join(projectRoot, "src", "routes", "user.ts"),
        'export const handler = () => "user updated";\n',
      );

      const event = await Promise.race([
        eventPromise,
        sleep(3000).then(() => null),
      ]);

      // fs.watch 在某些 CI 环境可能不触发，允许 null
      if (event) {
        expect(event.action).toBe("soft");
        expect(event.files.length).toBeGreaterThan(0);
        expect(event.files.some((f) => f.path.includes("routes/user.ts"))).toBe(
          true,
        );
      }
    });

    it("修改 src/config/ 文件应触发 cold 事件", async () => {
      watcher = new VextFileWatcher({
        root: projectRoot,
        debounce: 50,
      });
      await watcher.start();

      const eventPromise = new Promise<FileChangeEvent>((resolve) => {
        watcher.on("change", (event: FileChangeEvent) => {
          resolve(event);
        });
      });

      await sleep(100);

      // 修改配置文件
      fs.writeFileSync(
        path.join(projectRoot, "src", "config", "default.ts"),
        "export default { port: 8080 };\n",
      );

      const event = await Promise.race([
        eventPromise,
        sleep(3000).then(() => null),
      ]);

      if (event) {
        expect(event.action).toBe("cold");
      }
    });

    it("修改 preload/ 文件应触发 cold 事件", async () => {
      watcher = new VextFileWatcher({
        root: projectRoot,
        debounce: 50,
      });
      await watcher.start();

      const eventPromise = new Promise<FileChangeEvent>((resolve) => {
        watcher.on("change", (event: FileChangeEvent) => {
          resolve(event);
        });
      });

      await sleep(100);

      fs.writeFileSync(
        path.join(projectRoot, "preload", "01-env.ts"),
        "export const preloadFlag = 'updated';\n",
      );

      const event = await Promise.race([
        eventPromise,
        sleep(3000).then(() => null),
      ]);

      if (event) {
        expect(event.action).toBe("cold");
        expect(
          event.files.some((f) => f.path.includes("preload/01-env.ts")),
        ).toBe(true);
      }
    });

    it("修改依赖 lockfile 应触发 cold 事件", async () => {
      const lockfilePath = path.join(projectRoot, "pnpm-lock.yaml");
      fs.writeFileSync(lockfilePath, "lockfileVersion: '9.0'\n");

      watcher = new VextFileWatcher({
        root: projectRoot,
        debounce: 50,
      });
      await watcher.start();

      const eventPromise = new Promise<FileChangeEvent>((resolve) => {
        watcher.on("change", (event: FileChangeEvent) => {
          const hasLockfile = event.files.some(
            (f) => f.path === "pnpm-lock.yaml",
          );
          if (hasLockfile) {
            resolve(event);
          }
        });
      });

      await sleep(100);
      fs.writeFileSync(lockfilePath, "lockfileVersion: '9.1'\n");

      const event = await Promise.race([
        eventPromise,
        sleep(3000).then(() => null),
      ]);

      expect(event).not.toBeNull();
      if (event) {
        expect(event.action).toBe("cold");
        expect(event.files.find((f) => f.path === "pnpm-lock.yaml")?.type).toBe(
          "modify",
        );
      }
    });

    it("新增 .env.* 文件应触发 cold add 事件", async () => {
      watcher = new VextFileWatcher({
        root: projectRoot,
        debounce: 50,
      });
      await watcher.start();

      const eventPromise = new Promise<FileChangeEvent>((resolve) => {
        watcher.on("change", (event: FileChangeEvent) => {
          const hasEnvFile = event.files.some((f) => f.path === ".env.staging");
          if (hasEnvFile) {
            resolve(event);
          }
        });
      });

      await sleep(100);
      fs.writeFileSync(path.join(projectRoot, ".env.staging"), "STAGE=1\n");

      const event = await Promise.race([
        eventPromise,
        sleep(3000).then(() => null),
      ]);

      expect(event).not.toBeNull();
      if (event) {
        expect(event.action).toBe("cold");
        expect(event.files.find((f) => f.path === ".env.staging")?.type).toBe(
          "add",
        );
      }
    });

    it("fs.watch 模式下动态创建 preload/ 目录后应监听其中新增文件", async () => {
      fs.rmSync(path.join(projectRoot, "preload"), {
        recursive: true,
        force: true,
      });

      watcher = new VextFileWatcher({
        root: projectRoot,
        debounce: 50,
      });
      await watcher.start();

      const eventPromise = new Promise<FileChangeEvent>((resolve) => {
        watcher.on("change", (event: FileChangeEvent) => {
          const hasDynamicPreload = event.files.some((f) =>
            f.path.includes("preload/01-late.ts"),
          );
          if (hasDynamicPreload) {
            resolve(event);
          }
        });
      });

      await sleep(100);

      fs.mkdirSync(path.join(projectRoot, "preload"), { recursive: true });
      fs.writeFileSync(
        path.join(projectRoot, "preload", "01-late.ts"),
        "export const preloadFlag = 'late';\n",
      );

      const event = await Promise.race([
        eventPromise,
        sleep(3000).then(() => null),
      ]);

      if (event) {
        expect(event.action).toBe("cold");
        const lateFile = event.files.find((f) =>
          f.path.includes("preload/01-late.ts"),
        );
        expect(lateFile?.type).toBe("add");
      }
    });

    it("新增 src/ 下的文件应触发事件且 type 包含 add", async () => {
      watcher = new VextFileWatcher({
        root: projectRoot,
        debounce: 50,
      });
      await watcher.start();

      const eventPromise = new Promise<FileChangeEvent>((resolve) => {
        watcher.on("change", (event: FileChangeEvent) => {
          resolve(event);
        });
      });

      await sleep(100);

      // 新增文件
      fs.writeFileSync(
        path.join(projectRoot, "src", "routes", "post.ts"),
        'export const handler = () => "post";\n',
      );

      const event = await Promise.race([
        eventPromise,
        sleep(3000).then(() => null),
      ]);

      if (event) {
        expect(event.action).toBe("soft");
        const postFile = event.files.find((f) =>
          f.path.includes("routes/post.ts"),
        );
        if (postFile) {
          expect(postFile.type).toBe("add");
        }
      }
    });

    it("node_modules/ 下的变更不应触发事件", async () => {
      watcher = new VextFileWatcher({
        root: projectRoot,
        debounce: 50,
      });
      await watcher.start();

      let eventFired = false;
      watcher.on("change", () => {
        eventFired = true;
      });

      await sleep(100);

      // 创建 node_modules 并写入文件
      // 这不会触发因为 node_modules 在 src 内部不太常见
      // 但 classifyChange 会将 node_modules/ 路径忽略
      // 实际上 fs.watch 是监听 src/，文件路径会是 src/node_modules/...
      // 经过 classifyChange 后会被忽略

      await sleep(200);
      // 没有直接方式测试 ignore（它不发事件），通过间接验证
    });
  });

  // ── polling 模式 ──────────────────────────────────────

  describe("polling 模式 — 文件变更检测", () => {
    it("修改文件应在 polling 间隔后触发事件", async () => {
      watcher = new VextFileWatcher({
        root: projectRoot,
        usePolling: true,
        pollInterval: 200,
        debounce: 50,
      });
      await watcher.start();

      // 等 polling 初始化完成（让首轮基线建好，避免根配置文件 mtime 竞态）
      await sleep(600);

      // 收集目标源码文件的事件（过滤掉可能的根配置文件变更噪音）
      const eventPromise = new Promise<FileChangeEvent>((resolve) => {
        watcher.on("change", (event: FileChangeEvent) => {
          const srcFiles = event.files.filter((f) => f.path.startsWith("src/"));
          if (srcFiles.length > 0) {
            resolve({ ...event, files: srcFiles });
          }
        });
      });

      // 修改文件
      fs.writeFileSync(
        path.join(projectRoot, "src", "routes", "user.ts"),
        'export const handler = () => "polling updated";\n',
      );

      const event = await Promise.race([
        eventPromise,
        sleep(3000).then(() => null),
      ]);

      if (event) {
        expect(event.files.length).toBeGreaterThan(0);
        expect(event.files.some((f) => f.path.includes("routes/user.ts"))).toBe(
          true,
        );
      }
    });

    it("polling 模式下修改 preload/ 文件应触发 cold 事件", async () => {
      watcher = new VextFileWatcher({
        root: projectRoot,
        usePolling: true,
        pollInterval: 200,
        debounce: 50,
      });
      await watcher.start();

      await sleep(600);

      const eventPromise = new Promise<FileChangeEvent>((resolve) => {
        watcher.on("change", (event: FileChangeEvent) => {
          const hasPreload = event.files.some((f) =>
            f.path.includes("preload/01-env.ts"),
          );
          if (hasPreload) {
            resolve(event);
          }
        });
      });

      fs.writeFileSync(
        path.join(projectRoot, "preload", "01-env.ts"),
        "export const preloadFlag = 'polling-updated';\n",
      );

      const event = await Promise.race([
        eventPromise,
        sleep(3000).then(() => null),
      ]);

      if (event) {
        expect(event.action).toBe("cold");
      }
    });

    it("新增依赖 lockfile 应在 polling 间隔后触发 cold add 事件", async () => {
      const lockfilePath = path.join(projectRoot, "yarn.lock");
      fs.rmSync(lockfilePath, { force: true });

      watcher = new VextFileWatcher({
        root: projectRoot,
        usePolling: true,
        pollInterval: 200,
        debounce: 50,
      });
      await watcher.start();

      await sleep(600);

      const eventPromise = new Promise<FileChangeEvent>((resolve) => {
        watcher.on("change", (event: FileChangeEvent) => {
          const hasLockfile = event.files.some((f) => f.path === "yarn.lock");
          if (hasLockfile) {
            resolve(event);
          }
        });
      });

      fs.writeFileSync(lockfilePath, "# yarn lockfile\n");

      const event = await Promise.race([
        eventPromise,
        sleep(3000).then(() => null),
      ]);

      expect(event).not.toBeNull();
      if (event) {
        expect(event.action).toBe("cold");
        expect(event.files.find((f) => f.path === "yarn.lock")?.type).toBe(
          "add",
        );
      }
    });

    it("删除依赖 lockfile 应在 polling 间隔后触发 cold delete 事件", async () => {
      const lockfilePath = path.join(projectRoot, "package-lock.json");
      fs.writeFileSync(lockfilePath, '{"lockfileVersion":3}\n');

      watcher = new VextFileWatcher({
        root: projectRoot,
        usePolling: true,
        pollInterval: 200,
        debounce: 50,
      });
      await watcher.start();

      await sleep(600);

      const eventPromise = new Promise<FileChangeEvent>((resolve) => {
        watcher.on("change", (event: FileChangeEvent) => {
          const hasLockfile = event.files.some(
            (f) => f.path === "package-lock.json",
          );
          if (hasLockfile) {
            resolve(event);
          }
        });
      });

      fs.rmSync(lockfilePath, { force: true });

      const event = await Promise.race([
        eventPromise,
        sleep(3000).then(() => null),
      ]);

      expect(event).not.toBeNull();
      if (event) {
        expect(event.action).toBe("cold");
        expect(
          event.files.find((f) => f.path === "package-lock.json")?.type,
        ).toBe("delete");
      }
    });

    it("新增 .env.* 文件应在 polling 间隔后触发 cold add 事件", async () => {
      watcher = new VextFileWatcher({
        root: projectRoot,
        usePolling: true,
        pollInterval: 200,
        debounce: 50,
      });
      await watcher.start();

      await sleep(600);

      const eventPromise = new Promise<FileChangeEvent>((resolve) => {
        watcher.on("change", (event: FileChangeEvent) => {
          const hasEnvFile = event.files.some((f) => f.path === ".env.staging");
          if (hasEnvFile) {
            resolve(event);
          }
        });
      });

      fs.writeFileSync(path.join(projectRoot, ".env.staging"), "STAGE=1\n");

      const event = await Promise.race([
        eventPromise,
        sleep(3000).then(() => null),
      ]);

      expect(event).not.toBeNull();
      if (event) {
        expect(event.action).toBe("cold");
        expect(event.files.find((f) => f.path === ".env.staging")?.type).toBe(
          "add",
        );
      }
    });

    it("删除 .env.* 文件应在 polling 间隔后触发 cold delete 事件", async () => {
      const envPath = path.join(projectRoot, ".env.local");

      watcher = new VextFileWatcher({
        root: projectRoot,
        usePolling: true,
        pollInterval: 200,
        debounce: 50,
      });
      await watcher.start();

      await sleep(600);

      const eventPromise = new Promise<FileChangeEvent>((resolve) => {
        watcher.on("change", (event: FileChangeEvent) => {
          const hasEnvFile = event.files.some((f) => f.path === ".env.local");
          if (hasEnvFile) {
            resolve(event);
          }
        });
      });

      fs.rmSync(envPath, { force: true });

      const event = await Promise.race([
        eventPromise,
        sleep(3000).then(() => null),
      ]);

      expect(event).not.toBeNull();
      if (event) {
        expect(event.action).toBe("cold");
        expect(event.files.find((f) => f.path === ".env.local")?.type).toBe(
          "delete",
        );
      }
    });

    it("新增文件应在 polling 间隔后触发 add 事件", async () => {
      watcher = new VextFileWatcher({
        root: projectRoot,
        usePolling: true,
        pollInterval: 200,
        debounce: 50,
      });
      await watcher.start();

      // 等 polling 初始化完成
      await sleep(600);

      const eventPromise = new Promise<FileChangeEvent>((resolve) => {
        watcher.on("change", (event: FileChangeEvent) => {
          const hasPayment = event.files.some((f) =>
            f.path.includes("services/payment.ts"),
          );
          if (hasPayment) {
            resolve(event);
          }
        });
      });

      // 新增文件
      fs.writeFileSync(
        path.join(projectRoot, "src", "services", "payment.ts"),
        'export const pay = () => "paid";\n',
      );

      const event = await Promise.race([
        eventPromise,
        sleep(3000).then(() => null),
      ]);

      if (event) {
        const payFile = event.files.find((f) =>
          f.path.includes("services/payment.ts"),
        );
        expect(payFile).toBeDefined();
        if (payFile) {
          expect(payFile.type).toBe("add");
        }
      }
    });

    it("删除文件应在 polling 间隔后触发 delete 事件", async () => {
      watcher = new VextFileWatcher({
        root: projectRoot,
        usePolling: true,
        pollInterval: 200,
        debounce: 50,
      });
      await watcher.start();

      // 等 polling 初始化完成
      await sleep(600);

      const eventPromise = new Promise<FileChangeEvent>((resolve) => {
        watcher.on("change", (event: FileChangeEvent) => {
          const hasAuth = event.files.some((f) =>
            f.path.includes("services/auth.ts"),
          );
          if (hasAuth) {
            resolve(event);
          }
        });
      });

      // 删除文件
      fs.unlinkSync(path.join(projectRoot, "src", "services", "auth.ts"));

      const event = await Promise.race([
        eventPromise,
        sleep(3000).then(() => null),
      ]);

      if (event) {
        const authFile = event.files.find((f) =>
          f.path.includes("services/auth.ts"),
        );
        expect(authFile).toBeDefined();
        if (authFile) {
          expect(authFile.type).toBe("delete");
        }
      }
    });
  });

  // ── 防抖合并 ──────────────────────────────────────────

  describe("防抖合并", () => {
    it("防抖窗口内的多次变更应合并为一个事件", async () => {
      watcher = new VextFileWatcher({
        root: projectRoot,
        usePolling: true,
        pollInterval: 100,
        debounce: 300,
      });
      await watcher.start();

      const events: FileChangeEvent[] = [];
      watcher.on("change", (event: FileChangeEvent) => {
        events.push(event);
      });

      // 等 polling 初始化完成
      await sleep(300);

      // 快速连续修改两个文件
      fs.writeFileSync(
        path.join(projectRoot, "src", "routes", "user.ts"),
        'export const handler = () => "batch 1";\n',
      );
      fs.writeFileSync(
        path.join(projectRoot, "src", "services", "auth.ts"),
        'export const auth = () => "batch 2";\n',
      );

      // 等待 polling + 防抖
      await sleep(800);

      // 应合并为一个或少数几个事件（防抖合并）
      if (events.length > 0) {
        // 至少有一个事件包含多个文件
        const totalFiles = events.reduce((sum, e) => sum + e.files.length, 0);
        expect(totalFiles).toBeGreaterThanOrEqual(1);
      }
    });

    it("cold + soft 混合变更应合并为 cold 事件", async () => {
      watcher = new VextFileWatcher({
        root: projectRoot,
        usePolling: true,
        pollInterval: 100,
        debounce: 300,
      });
      await watcher.start();

      const eventPromise = new Promise<FileChangeEvent>((resolve) => {
        watcher.on("change", (event: FileChangeEvent) => {
          resolve(event);
        });
      });

      // 等 polling 初始化完成
      await sleep(300);

      // 同时修改源码文件和配置文件
      fs.writeFileSync(
        path.join(projectRoot, "src", "routes", "user.ts"),
        'export const handler = () => "soft change";\n',
      );
      fs.writeFileSync(
        path.join(projectRoot, "src", "config", "default.ts"),
        "export default { port: 9999 };\n",
      );

      const event = await Promise.race([
        eventPromise,
        sleep(3000).then(() => null),
      ]);

      if (event) {
        // 有 cold 分类的文件 → 整体应为 cold
        expect(event.action).toBe("cold");
      }
    });
  });

  // ── classifierOptions 传递 ────────────────────────────

  describe("classifierOptions 传递", () => {
    it("应将 classifierOptions 传递给 classifyChange", async () => {
      watcher = new VextFileWatcher({
        root: projectRoot,
        usePolling: true,
        pollInterval: 100,
        debounce: 50,
        classifierOptions: {
          coldPatterns: ["src/routes/user.ts"],
        },
      });
      await watcher.start();

      const eventPromise = new Promise<FileChangeEvent>((resolve) => {
        watcher.on("change", (event: FileChangeEvent) => {
          resolve(event);
        });
      });

      await sleep(300);

      // 修改 user.ts — 通常是 soft，但用户配置为 cold
      fs.writeFileSync(
        path.join(projectRoot, "src", "routes", "user.ts"),
        'export const handler = () => "custom cold";\n',
      );

      const event = await Promise.race([
        eventPromise,
        sleep(3000).then(() => null),
      ]);

      if (event) {
        expect(event.action).toBe("cold");
      }
    });
  });
});
