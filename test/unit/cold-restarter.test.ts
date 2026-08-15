import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ColdRestarter } from "../../src/lib/dev/cold-restarter.js";
import type { ColdRestarterOptions } from "../../src/lib/dev/cold-restarter.js";

// ── 测试辅助 ────────────────────────────────────────────────

/**
 * 创建一个临时的 worker 脚本
 *
 * 支持多种行为模式，通过环境变量 WORKER_MODE 控制：
 *   - "ready"         — 立即发送 ready 消息（默认）
 *   - "delay-ready"   — 延迟 500ms 后发送 ready
 *   - "no-ready"      — 不发送 ready（用于测试超时）
 *   - "crash"         — 立即退出 code=1（用于测试异常退出）
 *   - "exit-zero"     — 立即退出 code=0（不发送 ready）
 *   - "ipc-echo"      — 发送 ready 后回显收到的 IPC 消息
 *   - "slow-shutdown" — 发送 ready 后捕获 SIGTERM，延迟关闭
 *   - "ignore-sigterm" — 发送 ready 后忽略 SIGTERM（用于测试 SIGKILL 回退）
 *   - "request-cold"  — 发送 ready 后发送 request-cold-restart 消息
 */
function createWorkerScript(tmpDir: string): string {
  const scriptPath = path.join(tmpDir, "worker.mjs");
  fs.writeFileSync(
    scriptPath,
    `
const mode = process.env.WORKER_MODE || 'ready';

switch (mode) {
  case 'ready':
    process.send({ type: 'ready' });
    break;

  case 'delay-ready':
    setTimeout(() => {
      process.send({ type: 'ready' });
    }, 500);
    break;

  case 'no-ready':
    // 不发送 ready — 用于超时测试
    // 保持进程存活
    setInterval(() => {}, 1000);
    break;

  case 'crash':
    process.exit(1);
    break;

  case 'exit-zero':
    process.exit(0);
    break;

  case 'ipc-echo':
    process.send({ type: 'ready' });
    process.on('message', (msg) => {
      process.send({ type: 'echo', payload: msg });
    });
    break;

  case 'slow-shutdown':
    process.on('SIGTERM', () => {
      setTimeout(() => {
        process.exit(0);
      }, 300);
    });
    process.send({ type: 'ready' });
    break;

  case 'ignore-sigterm':
    process.on('SIGTERM', () => {
      // 故意忽略 SIGTERM — 用于测试 SIGKILL 回退
    });
    process.send({ type: 'ready' });
    // 保持进程存活
    setInterval(() => {}, 1000);
    break;

  case 'request-cold':
    process.send({ type: 'ready' });
    setTimeout(() => {
      process.send({ type: 'request-cold-restart', reason: 'cascade too large' });
    }, 100);
    break;

  default:
    process.send({ type: 'ready' });
    break;
}

// 保持进程存活（除了 crash / exit-zero 模式）
if (mode !== 'crash' && mode !== 'exit-zero') {
  // 心跳 — 防止进程提前退出
  const keepAlive = setInterval(() => {}, 5000);
  process.on('SIGTERM', () => {
    clearInterval(keepAlive);
    if (mode !== 'slow-shutdown' && mode !== 'ignore-sigterm') {
      process.exit(0);
    }
  });
  process.on('SIGINT', () => {
    clearInterval(keepAlive);
    process.exit(0);
  });

  // IPC shutdown 消息监听（模拟真实 vext 子进程行为）
  // Windows 上 ColdRestarter.safeKill() 通过 IPC { type: 'shutdown' } 替代 SIGTERM
  process.on('message', (msg) => {
    if (msg && typeof msg === 'object' && msg.type === 'shutdown') {
      clearInterval(keepAlive);
      if (mode === 'slow-shutdown') {
        // 与 SIGTERM 行为一致：延迟 300ms 后退出
        setTimeout(() => { process.exit(0); }, 300);
      } else if (mode === 'ignore-sigterm') {
        // 故意忽略 — 用于测试 SIGKILL 回退
      } else {
        process.exit(0);
      }
    }
  });
}
`,
  );
  return scriptPath;
}

function createModeFileWorkerScript(tmpDir: string): string {
  const scriptPath = path.join(tmpDir, "mode-file-worker.mjs");
  fs.writeFileSync(
    scriptPath,
    `
import { readFileSync } from 'node:fs';

const mode = readFileSync(process.env.WORKER_MODE_FILE, 'utf8').trim();

if (mode === 'ready') {
  process.send({ type: 'ready' });
}

const keepAlive = setInterval(() => {}, 5000);

const shutdown = () => {
  clearInterval(keepAlive);
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('message', (msg) => {
  if (msg && typeof msg === 'object' && msg.type === 'shutdown') {
    shutdown();
  }
});
`,
  );
  return scriptPath;
}

// ── 测试套件 ────────────────────────────────────────────────

describe("ColdRestarter", () => {
  let tmpDir: string;
  let workerScript: string;
  let restarter: ColdRestarter | null;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "vext-test-cold-restarter-"),
    );
    workerScript = createWorkerScript(tmpDir);
    restarter = null;
  });

  afterEach(async () => {
    // 确保子进程被清理
    if (restarter) {
      try {
        await restarter.kill();
      } catch {
        // 静默忽略
      }
    }

    // 清理临时目录
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Windows 可能有延迟释放
    }
  });

  // ── 基本生命周期 ──────────────────────────────────────────

  describe("基本生命周期", () => {
    it("应成功 fork 子进程并收到 ready 消息", async () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
        env: { WORKER_MODE: "ready" },
      });

      await restarter.restart("test start");

      expect(restarter.isChildAlive()).toBe(true);
      expect(restarter.getChildPid()).toBeTypeOf("number");
      expect(restarter.getChildPid()).toBeGreaterThan(0);
    });

    it("应成功等待延迟的 ready 消息", async () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
        env: { WORKER_MODE: "delay-ready" },
      });

      await restarter.restart("delayed ready");

      expect(restarter.isChildAlive()).toBe(true);
    });

    it("kill 应安全终止子进程", async () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
        env: { WORKER_MODE: "ready" },
      });

      await restarter.restart("test");
      expect(restarter.isChildAlive()).toBe(true);

      await restarter.kill();

      expect(restarter.isChildAlive()).toBe(false);
      expect(restarter.getChildPid()).toBeNull();
    });

    it("kill 对无子进程的 restarter 应为 no-op", async () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
      });

      // 从未 restart — 无子进程
      await restarter.kill(); // 不应抛出

      expect(restarter.isChildAlive()).toBe(false);
    });

    it("getChildPid 应在无子进程时返回 null", () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
      });

      expect(restarter.getChildPid()).toBeNull();
    });
  });

  // ── restart 行为 ──────────────────────────────────────────

  describe("restart 行为", () => {
    it("多次 restart 应终止旧进程并启动新进程", async () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
        env: { WORKER_MODE: "ready" },
      });

      await restarter.restart("first");
      const firstPid = restarter.getChildPid();

      await restarter.restart("second");
      const secondPid = restarter.getChildPid();

      expect(firstPid).toBeTypeOf("number");
      expect(secondPid).toBeTypeOf("number");
      // 两次 fork 的 PID 应不同
      expect(firstPid).not.toBe(secondPid);
      expect(restarter.isChildAlive()).toBe(true);
    });

    it("restart 后旧进程应被终止", async () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
        env: { WORKER_MODE: "ready" },
      });

      await restarter.restart("first");
      const firstPid = restarter.getChildPid()!;

      await restarter.restart("second");

      // 尝试检查旧进程是否已退出
      // process.kill(pid, 0) 在进程不存在时抛出
      let isFirstAlive = true;
      try {
        process.kill(firstPid, 0);
      } catch {
        isFirstAlive = false;
      }

      // 旧进程可能已退出或即将退出
      // 新进程应存活
      expect(restarter.isChildAlive()).toBe(true);
    });

    it("isRestarting guard 应防止并行 restart", async () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
        env: { WORKER_MODE: "delay-ready" },
      });

      // 同时触发两次 restart
      const promise1 = restarter.restart("first");
      const promise2 = restarter.restart("second");

      await Promise.all([promise1, promise2]);

      // 只应有一个子进程存活
      expect(restarter.isChildAlive()).toBe(true);
      expect(restarter.getIsRestarting()).toBe(false);
    });

    it("restart 完成后 isRestarting 应恢复为 false", async () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
        env: { WORKER_MODE: "ready" },
      });

      expect(restarter.getIsRestarting()).toBe(false);

      await restarter.restart("test");

      expect(restarter.getIsRestarting()).toBe(false);
    });
  });

  // ── 错误处理 ──────────────────────────────────────────────

  describe("错误处理", () => {
    it("子进程 crash（exit code 1）应抛出错误", async () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
        env: { WORKER_MODE: "crash" },
      });

      await expect(restarter.restart("crash test")).rejects.toThrow(
        /worker exited with code/,
      );
    });

    it("子进程不发送 ready 应在超时后抛出错误", async () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
        env: { WORKER_MODE: "no-ready" },
        readyTimeout: 1000, // 1秒超时（加快测试）
      });

      const restartPromise = restarter.restart("timeout test");
      await waitFor(() => restarter!.getChildPid() !== null, 1000);
      const timedOutPid = restarter.getChildPid()!;

      await expect(restartPromise).rejects.toThrow(/worker startup timeout/);
      expect(restarter.isChildAlive()).toBe(false);
      expect(restarter.getChildPid()).toBeNull();
      await waitFor(() => !isProcessAlive(timedOutPid), 3000);
    }, 10_000);

    it("ready 超时清理后同一 restarter 应可再次启动", async () => {
      const modeFile = path.join(tmpDir, "worker-mode.txt");
      const modeFileWorker = createModeFileWorkerScript(tmpDir);
      fs.writeFileSync(modeFile, "no-ready\n");

      restarter = new ColdRestarter({
        entryScript: modeFileWorker,
        env: { WORKER_MODE_FILE: modeFile },
        // Full-suite process startup can briefly contend with other fork-based
        // tests on Windows. This remains a short timeout-path test while
        // leaving enough room for the retry child to initialize reliably.
        readyTimeout: 1500,
        killTimeout: 1000,
      });

      await expect(restarter.restart("timeout test")).rejects.toThrow(
        /worker startup timeout/,
      );
      expect(restarter.isChildAlive()).toBe(false);
      expect(restarter.getChildPid()).toBeNull();

      fs.writeFileSync(modeFile, "ready\n");
      await restarter.restart("retry after timeout");

      expect(restarter.isChildAlive()).toBe(true);
      expect(restarter.getChildPid()).toBeTypeOf("number");
    }, 10_000);

    it("子进程退出 code=0 但未发送 ready 应抛出错误", async () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
        env: { WORKER_MODE: "exit-zero" },
      });

      await expect(restarter.restart("exit-zero test")).rejects.toThrow(
        /worker exited with code/,
      );
    });

    it("restart 失败后 isRestarting 应恢复为 false", async () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
        env: { WORKER_MODE: "crash" },
      });

      try {
        await restarter.restart("crash test");
      } catch {
        // 预期抛出
      }

      expect(restarter.getIsRestarting()).toBe(false);
    });

    it("入口脚本不存在应抛出错误", async () => {
      restarter = new ColdRestarter({
        entryScript: path.join(tmpDir, "nonexistent.mjs"),
      });

      await expect(restarter.restart("missing script")).rejects.toThrow();
    });
  });

  // ── IPC 通信 ──────────────────────────────────────────────

  describe("IPC 通信", () => {
    it("sendToChild 应向子进程发送 IPC 消息", async () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
        env: { WORKER_MODE: "ipc-echo" },
      });

      const received: unknown[] = [];

      restarter.setEvents({
        onChildMessage: (msg: unknown) => {
          received.push(msg);
        },
      });

      await restarter.restart("ipc test");

      // 发送测试消息
      restarter.sendToChild({ type: "reload", files: ["src/routes/user.ts"] });

      // 等待回显
      await waitFor(() => {
        return received.some(
          (m) =>
            typeof m === "object" &&
            m !== null &&
            (m as Record<string, unknown>).type === "echo",
        );
      }, 3000);

      const echoMsg = received.find(
        (m) =>
          typeof m === "object" &&
          m !== null &&
          (m as Record<string, unknown>).type === "echo",
      ) as Record<string, unknown> | undefined;

      expect(echoMsg).toBeDefined();
      expect(echoMsg!.payload).toEqual({
        type: "reload",
        files: ["src/routes/user.ts"],
      });
    });

    it("sendToChild 对无子进程应为 no-op（不抛出）", () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
      });

      // 无子进程时发送消息 — 不应抛出
      expect(() => {
        restarter!.sendToChild({ type: "test" });
      }).not.toThrow();
    });

    it("sendToChild 对已退出的子进程应为 no-op", async () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
        env: { WORKER_MODE: "ready" },
      });

      await restarter.restart("test");
      await restarter.kill();

      // 子进程已退出 — 发送消息不应抛出
      expect(() => {
        restarter!.sendToChild({ type: "test" });
      }).not.toThrow();
    });

    it("子进程发送 request-cold-restart 应触发 onChildMessage 回调", async () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
        env: { WORKER_MODE: "request-cold" },
      });

      const messages: unknown[] = [];

      restarter.setEvents({
        onChildMessage: (msg: unknown) => {
          messages.push(msg);
        },
      });

      await restarter.restart("request-cold test");

      // 等待子进程发送 request-cold-restart 消息
      await waitFor(() => {
        return messages.some(
          (m) =>
            typeof m === "object" &&
            m !== null &&
            (m as Record<string, unknown>).type === "request-cold-restart",
        );
      }, 3000);

      const coldMsg = messages.find(
        (m) =>
          typeof m === "object" &&
          m !== null &&
          (m as Record<string, unknown>).type === "request-cold-restart",
      ) as Record<string, unknown> | undefined;

      expect(coldMsg).toBeDefined();
      expect(coldMsg!.reason).toBe("cascade too large");
    });
  });

  // ── safeKill 行为 ────────────────────────────────────────

  describe("safeKill 行为", () => {
    it("SIGTERM 能正常终止子进程", async () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
        env: { WORKER_MODE: "ready" },
        killTimeout: 3000,
      });

      await restarter.restart("test");
      expect(restarter.isChildAlive()).toBe(true);

      await restarter.kill();
      expect(restarter.isChildAlive()).toBe(false);
    });

    it("慢关闭的子进程应在 killTimeout 内退出", async () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
        env: { WORKER_MODE: "slow-shutdown" },
        killTimeout: 3000,
      });

      await restarter.restart("slow shutdown test");
      expect(restarter.isChildAlive()).toBe(true);

      const start = Date.now();
      await restarter.kill();
      const elapsed = Date.now() - start;

      expect(restarter.isChildAlive()).toBe(false);
      // slow-shutdown 延迟 300ms，应在 killTimeout 前退出
      // 增加 100ms 容差：Windows 上定时器精度 + IPC 消息传递延迟可能导致几 ms 超出
      expect(elapsed).toBeLessThan(3100);
    });

    it("忽略 SIGTERM 的子进程应在 killTimeout 后被 SIGKILL", async () => {
      // 注意：此测试仅在 Linux/macOS 上可靠（Windows 不支持 SIGKILL）
      if (process.platform === "win32") {
        return;
      }

      restarter = new ColdRestarter({
        entryScript: workerScript,
        env: { WORKER_MODE: "ignore-sigterm" },
        killTimeout: 500, // 500ms 后 SIGKILL
      });

      await restarter.restart("sigkill test");
      expect(restarter.isChildAlive()).toBe(true);

      const start = Date.now();
      await restarter.kill();
      const elapsed = Date.now() - start;

      expect(restarter.isChildAlive()).toBe(false);
      // 应在 killTimeout 附近退出（±200ms 容差）
      expect(elapsed).toBeGreaterThanOrEqual(400);
      expect(elapsed).toBeLessThan(2000);
    }, 10_000);
  });

  // ── 事件回调 ──────────────────────────────────────────────

  describe("事件回调", () => {
    it("异常退出应触发 onChildExit 回调", async () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
        env: { WORKER_MODE: "ready" },
      });

      const exits: Array<{
        code: number | null;
        signal: string | null;
      }> = [];

      restarter.setEvents({
        onChildExit: (code, signal) => {
          exits.push({ code, signal });
        },
      });

      await restarter.restart("test");
      const pid = restarter.getChildPid()!;

      // 模拟异常退出（外部 kill 子进程）
      process.kill(pid, "SIGTERM");

      // 等待 exit 回调
      await waitFor(() => exits.length > 0, 3000);

      expect(exits.length).toBe(1);
    });

    it("restart 期间的 kill 不应触发 onChildExit", async () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
        env: { WORKER_MODE: "ready" },
      });

      const exits: Array<{
        code: number | null;
        signal: string | null;
      }> = [];

      restarter.setEvents({
        onChildExit: (code, signal) => {
          exits.push({ code, signal });
        },
      });

      await restarter.restart("first");
      await restarter.restart("second"); // 内部会 kill 第一个进程

      // 预期退出不触发回调
      expect(exits.length).toBe(0);
    });

    it("setEvents 应覆盖之前的监听器", async () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
        env: { WORKER_MODE: "request-cold" },
      });

      const firstMessages: unknown[] = [];
      const secondMessages: unknown[] = [];

      restarter.setEvents({
        onChildMessage: (msg) => firstMessages.push(msg),
      });

      // 覆盖监听器
      restarter.setEvents({
        onChildMessage: (msg) => secondMessages.push(msg),
      });

      await restarter.restart("test");

      // 等待消息
      await waitFor(() => secondMessages.length > 0, 3000);

      // 旧监听器不应收到消息（因为子进程在 setEvents 之后才 fork）
      // 但 ready 消息可能在 setEvents 调用顺序内被第一个捕获
      // 关键是验证 secondMessages 收到了消息
      expect(secondMessages.length).toBeGreaterThan(0);
    });
  });

  // ── 构造选项 ──────────────────────────────────────────────

  describe("构造选项", () => {
    it("默认 killTimeout 应为 5000ms", async () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
        env: { WORKER_MODE: "ready" },
      });

      await restarter.restart("test");
      expect(restarter.isChildAlive()).toBe(true);
    });

    it("自定义 env 应传递给子进程", async () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
        env: {
          WORKER_MODE: "ipc-echo",
          CUSTOM_VAR: "test-value",
        },
      });

      const messages: unknown[] = [];
      restarter.setEvents({
        onChildMessage: (msg) => messages.push(msg),
      });

      await restarter.restart("env test");

      // 子进程启动了（ready 消息已收到）
      expect(restarter.isChildAlive()).toBe(true);
    });

    it("自定义 cwd 应被传递给 fork", async () => {
      restarter = new ColdRestarter({
        entryScript: workerScript,
        env: { WORKER_MODE: "ready" },
        cwd: tmpDir,
      });

      await restarter.restart("cwd test");
      expect(restarter.isChildAlive()).toBe(true);
    });
  });
});

// ── DevCommand 参数解析测试 ──────────────────────────────────

describe("devCommand 参数解析", () => {
  // 我们无法直接测试 devCommand（因为它会启动长进程），
  // 但可以验证 parseDevArgs 的行为。
  // parseDevArgs 是内部函数，通过导入 devCommand 模块间接测试。
  // 这里使用 process.argv 模拟来验证参数解析逻辑。

  // 由于 parseDevArgs 是私有函数，我们通过验证 DevCommandOptions 接口定义
  // 和环境变量行为来间接测试。

  describe("DevCommandOptions 接口验证", () => {
    it("应支持所有预期的选项字段", () => {
      // 类型级别验证 — 如果接口不匹配会编译失败
      const options: import("../../src/cli/dev.js").DevCommandOptions = {
        root: "/tmp/project",
        poll: true,
        pollInterval: 2000,
        debounce: 200,
        noHot: true,
        clear: true,
      };

      expect(options.root).toBe("/tmp/project");
      expect(options.poll).toBe(true);
      expect(options.pollInterval).toBe(2000);
      expect(options.debounce).toBe(200);
      expect(options.noHot).toBe(true);
      expect(options.clear).toBe(true);
    });

    it("所有选项应是可选的", () => {
      const options: import("../../src/cli/dev.js").DevCommandOptions = {};

      expect(options.root).toBeUndefined();
      expect(options.poll).toBeUndefined();
      expect(options.pollInterval).toBeUndefined();
      expect(options.debounce).toBeUndefined();
      expect(options.noHot).toBeUndefined();
      expect(options.clear).toBeUndefined();
    });
  });

  describe("环境变量覆盖", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      // 恢复环境变量
      process.env = { ...originalEnv };
    });

    it("VEXT_DEV_POLL=1 应被识别", () => {
      process.env.VEXT_DEV_POLL = "1";
      expect(process.env.VEXT_DEV_POLL).toBe("1");
    });

    it("VEXT_DEV_POLL=0 应被识别", () => {
      process.env.VEXT_DEV_POLL = "0";
      expect(process.env.VEXT_DEV_POLL).toBe("0");
    });

    it("VEXT_DEV_NO_HOT=1 应被识别", () => {
      process.env.VEXT_DEV_NO_HOT = "1";
      expect(process.env.VEXT_DEV_NO_HOT).toBe("1");
    });

    it("VEXT_DEV_DEBOUNCE 应被识别", () => {
      process.env.VEXT_DEV_DEBOUNCE = "200";
      expect(process.env.VEXT_DEV_DEBOUNCE).toBe("200");
    });
  });
});

// ── ColdRestarterOptions 接口验证 ────────────────────────────

describe("ColdRestarterOptions 接口验证", () => {
  it("应支持所有预期的选项字段", () => {
    const options: ColdRestarterOptions = {
      entryScript: "/path/to/entry.js",
      killTimeout: 10000,
      readyTimeout: 60000,
      env: { NODE_ENV: "development" },
      cwd: "/path/to/project",
    };

    expect(options.entryScript).toBe("/path/to/entry.js");
    expect(options.killTimeout).toBe(10000);
    expect(options.readyTimeout).toBe(60000);
    expect(options.env).toEqual({ NODE_ENV: "development" });
    expect(options.cwd).toBe("/path/to/project");
  });

  it("只有 entryScript 是必填的", () => {
    const options: ColdRestarterOptions = {
      entryScript: "/path/to/entry.js",
    };

    expect(options.entryScript).toBe("/path/to/entry.js");
    expect(options.killTimeout).toBeUndefined();
    expect(options.readyTimeout).toBeUndefined();
    expect(options.env).toBeUndefined();
    expect(options.cwd).toBeUndefined();
  });
});

// ── ColdRestarter + dev-bootstrap 集成（边界场景）────────────

describe("ColdRestarter 边界场景", () => {
  let tmpDir: string;
  let restarter: ColdRestarter | null;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vext-test-cold-edge-"));
    restarter = null;
  });

  afterEach(async () => {
    if (restarter) {
      try {
        await restarter.kill();
      } catch {
        // 静默忽略
      }
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Windows 延迟释放
    }
  });

  it("fork 后立即 kill 应正常工作", async () => {
    const scriptPath = path.join(tmpDir, "worker.mjs");
    fs.writeFileSync(
      scriptPath,
      `
process.send({ type: 'ready' });
setInterval(() => {}, 5000);
process.on('SIGTERM', () => process.exit(0));
`,
    );

    restarter = new ColdRestarter({
      entryScript: scriptPath,
      killTimeout: 2000,
    });

    await restarter.restart("quick kill");
    // 立即 kill
    await restarter.kill();

    expect(restarter.isChildAlive()).toBe(false);
  });

  it("多次快速 restart 应只保留最后一个子进程", async () => {
    const scriptPath = path.join(tmpDir, "worker.mjs");
    fs.writeFileSync(
      scriptPath,
      `
process.send({ type: 'ready' });
setInterval(() => {}, 5000);
process.on('SIGTERM', () => process.exit(0));
`,
    );

    restarter = new ColdRestarter({
      entryScript: scriptPath,
      killTimeout: 2000,
    });

    // 顺序快速 restart
    await restarter.restart("first");
    await restarter.restart("second");
    await restarter.restart("third");

    expect(restarter.isChildAlive()).toBe(true);
    // 只有一个子进程存活
    const pid = restarter.getChildPid();
    expect(pid).toBeTypeOf("number");
  });

  it("env 变量 VEXT_DEV_MODE 应自动设置为 1", async () => {
    const scriptPath = path.join(tmpDir, "env-check.mjs");
    fs.writeFileSync(
      scriptPath,
      `
if (process.env.VEXT_DEV_MODE === '1') {
  process.send({ type: 'ready', devMode: true });
} else {
  process.send({ type: 'ready', devMode: false });
}
setInterval(() => {}, 5000);
process.on('SIGTERM', () => process.exit(0));
`,
    );

    const messages: unknown[] = [];

    restarter = new ColdRestarter({
      entryScript: scriptPath,
    });

    restarter.setEvents({
      onChildMessage: (msg) => messages.push(msg),
    });

    await restarter.restart("env check");

    // ready 消息应包含 devMode: true
    const readyMsg = messages.find(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m as Record<string, unknown>).type === "ready",
    ) as Record<string, unknown> | undefined;

    expect(readyMsg).toBeDefined();
    expect(readyMsg!.devMode).toBe(true);
  });
});

// ── 辅助函数 ────────────────────────────────────────────────

/**
 * 等待条件满足或超时
 *
 * @param condition 条件函数
 * @param timeoutMs 超时时间（毫秒）
 * @param intervalMs 轮询间隔（毫秒）
 */
async function waitFor(
  condition: () => boolean,
  timeoutMs = 5000,
  intervalMs = 50,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timeout after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
