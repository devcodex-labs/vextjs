import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";

// ── Mock 模块 ──────────────────────────────────────────────
//
// 必须在 import 被测模块之前声明 vi.mock()。
// mock 掉 pid-file 模块（避免真实文件系统操作）和 process.kill / process.exit。
//

vi.mock("../../../src/lib/cluster/pid-file.js", () => ({
  readPidFile: vi.fn(),
  isProcessAlive: vi.fn(),
  removePidFile: vi.fn(),
  DEFAULT_PID_FILE: ".vext.pid",
}));

import {
  readPidFile,
  isProcessAlive,
  removePidFile,
} from "../../../src/lib/cluster/pid-file.js";
import type { PidFileResult } from "../../../src/lib/cluster/pid-file.js";

import { stopCommand } from "../../../src/cli/stop.js";
import { reloadCommand } from "../../../src/cli/reload.js";
import { statusCommand } from "../../../src/cli/status.js";

// ── 类型化 mock ────────────────────────────────────────────

const mockReadPidFile = readPidFile as ReturnType<typeof vi.fn>;
const mockIsProcessAlive = isProcessAlive as ReturnType<typeof vi.fn>;
const mockRemovePidFile = removePidFile as ReturnType<typeof vi.fn>;

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

// ── 全局 Spy ───────────────────────────────────────────────

let consoleLogSpy: MockInstance<(...args: unknown[]) => void>;
let consoleErrorSpy: MockInstance<(...args: unknown[]) => void>;
let processExitSpy: MockInstance<(code?: string | number | null) => never>;
let processKillSpy: MockInstance<
  (pid: number, signal?: string | number) => true
>;

// 保存原始 platform
const originalPlatform = process.platform;

/**
 * 辅助：设置 process.platform（只读属性，需要 Object.defineProperty）
 */
function setPlatform(value: string): void {
  Object.defineProperty(process, "platform", {
    value,
    writable: true,
    configurable: true,
  });
}

/**
 * 辅助：构建成功的 PidFileResult
 */
function okPidResult(pid: number, path = ".vext.pid"): PidFileResult {
  return { ok: true, pid, path };
}

/**
 * 辅助：构建失败的 PidFileResult
 */
function failPidResult(
  error: string,
  path = ".vext.pid",
  pid?: number,
): PidFileResult {
  return { ok: false, error, path, pid };
}

function getConsoleLogMessages(): string[] {
  return consoleLogSpy.mock.calls.map((call) => String(call[0]));
}

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

// ════════════════════════════════════════════════════════════
//  Setup / Teardown
// ════════════════════════════════════════════════════════════

beforeEach(() => {
  vi.clearAllMocks();

  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  // mock process.exit 抛出以中断执行流（模拟真实 process.exit 行为）
  processExitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit(${code})`);
    });

  // mock process.kill 默认不做任何事
  processKillSpy = vi
    .spyOn(process, "kill")
    .mockImplementation((() => true) as typeof process.kill);

  // 确保 platform 恢复
  setPlatform(originalPlatform);
});

afterEach(() => {
  vi.restoreAllMocks();
  setPlatform(originalPlatform);
});

// ════════════════════════════════════════════════════════════
//  vext stop
// ════════════════════════════════════════════════════════════

describe("vext stop (stopCommand)", () => {
  // ── PID 文件不存在 ─────────────────────────────────────

  it("should exit(1) when PID file not found", async () => {
    mockReadPidFile.mockReturnValue(
      failPidResult('PID file ".vext.pid" not found. Is the server running?'),
    );

    await expect(stopCommand([])).rejects.toThrow("process.exit(1)");

    expect(mockReadPidFile).toHaveBeenCalledWith(".vext.pid", false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("not found"),
    );
  });

  // ── PID 文件存在但进程已死 ─────────────────────────────

  it("should exit(1) and clean stale PID file when process is dead", async () => {
    mockReadPidFile.mockReturnValue(okPidResult(12345));
    mockIsProcessAlive.mockReturnValue(false);
    mockRemovePidFile.mockReturnValue({ ok: true, path: ".vext.pid" });

    await expect(stopCommand([])).rejects.toThrow("process.exit(1)");

    expect(mockIsProcessAlive).toHaveBeenCalledWith(12345);
    expect(mockRemovePidFile).toHaveBeenCalledWith(".vext.pid", 12345);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("not running"),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Stale PID file removed"),
    );
  });

  // ── 发送 SIGTERM 成功 + 进程快速退出 ──────────────────

  it("should send SIGTERM and wait for exit", async () => {
    mockReadPidFile.mockReturnValue(okPidResult(12345));
    mockIsProcessAlive
      .mockReturnValueOnce(true) // 初始检查：存活
      .mockReturnValueOnce(false); // 轮询第一次：已退出
    mockRemovePidFile.mockReturnValue({ ok: true, path: ".vext.pid" });

    await stopCommand([]);

    // 验证 SIGTERM 发送（process.kill 被 spy 了，第一次调用是 SIGTERM）
    expect(processKillSpy).toHaveBeenCalledWith(12345, "SIGTERM");
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("SIGTERM sent"),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("stopped successfully"),
    );
  });

  // ── 发送 SIGTERM 权限不足 ─────────────────────────────

  it("should exit(1) when SIGTERM fails with EPERM", async () => {
    mockReadPidFile.mockReturnValue(okPidResult(12345));
    mockIsProcessAlive.mockReturnValue(true);

    const epermError = new Error("EPERM") as NodeJS.ErrnoException;
    epermError.code = "EPERM";
    processKillSpy.mockImplementation(
      (_pid: number, signal?: string | number) => {
        if (signal === "SIGTERM") throw epermError;
        return true;
      },
    );

    await expect(stopCommand([])).rejects.toThrow("process.exit(1)");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Permission denied"),
    );
  });

  // ── --pid-file 参数 ───────────────────────────────────

  it("should use custom --pid-file path", async () => {
    mockReadPidFile.mockReturnValue(okPidResult(99999, "/tmp/custom.pid"));
    mockIsProcessAlive.mockReturnValueOnce(true).mockReturnValueOnce(false);
    mockRemovePidFile.mockReturnValue({
      ok: true,
      path: "/tmp/custom.pid",
    });

    await stopCommand(["--pid-file", "/tmp/custom.pid"]);

    expect(mockReadPidFile).toHaveBeenCalledWith("/tmp/custom.pid", false);
    expect(processKillSpy).toHaveBeenCalledWith(99999, "SIGTERM");
  });

  // ── --help 参数 ───────────────────────────────────────

  it("should print help and exit(0) with --help", async () => {
    await expect(stopCommand(["--help"])).rejects.toThrow("process.exit(0)");

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("vext stop"),
    );
  });

  // ── 未知参数 ──────────────────────────────────────────

  it("should exit(1) with unknown option", async () => {
    await expect(stopCommand(["--unknown"])).rejects.toThrow("process.exit(1)");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown option: "--unknown"'),
    );
  });

  it("should exit(1) with unknown positional argument", async () => {
    await expect(stopCommand(["extra"])).rejects.toThrow("process.exit(1)");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown argument: "extra"'),
    );
    expect(mockReadPidFile).not.toHaveBeenCalled();
  });

  it("should reject --pid-file when the next token is another flag", async () => {
    await expect(stopCommand(["--pid-file", "--help"])).rejects.toThrow(
      "process.exit(1)",
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[vextjs] Option "--pid-file" requires a value: <path>; received option-like value "--help"',
    );
    expect(mockReadPidFile).not.toHaveBeenCalled();
  });

  // ── readPidFile 返回 ok 但 pid 为 undefined（边界情况） ─

  it("should exit(1) on invalid PID content without probing or signaling parsed prefixes", async () => {
    mockReadPidFile.mockReturnValue({
      ok: false,
      path: ".vext.pid",
      error: 'PID file ".vext.pid" contains invalid content: "123 extra\\n"',
    });

    await expect(stopCommand([])).rejects.toThrow("process.exit(1)");

    expect(mockIsProcessAlive).not.toHaveBeenCalled();
    expect(processKillSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("123 extra"),
    );
  });
});

// ════════════════════════════════════════════════════════════
//  vext reload
// ════════════════════════════════════════════════════════════

describe("vext reload (reloadCommand)", () => {
  // ── Windows 不支持 ────────────────────────────────────

  it("should exit(1) on Windows with unsupported message", async () => {
    setPlatform("win32");

    await expect(reloadCommand([])).rejects.toThrow("process.exit(1)");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("not supported on Windows"),
    );
    // 不应尝试读取 PID 文件
    expect(mockReadPidFile).not.toHaveBeenCalled();
  });

  // ── PID 文件不存在（非 Windows） ──────────────────────

  it("should exit(1) when PID file not found", async () => {
    setPlatform("linux");
    mockReadPidFile.mockReturnValue(
      failPidResult("PID file not found. Is the server running?"),
    );

    await expect(reloadCommand([])).rejects.toThrow("process.exit(1)");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("not found"),
    );
  });

  it("should exit(1) on invalid PID content without probing or signaling parsed prefixes", async () => {
    setPlatform("linux");
    mockReadPidFile.mockReturnValue(
      failPidResult(
        'PID file ".vext.pid" contains invalid content: "123.99\\n"',
      ),
    );

    await expect(reloadCommand([])).rejects.toThrow("process.exit(1)");

    expect(mockIsProcessAlive).not.toHaveBeenCalled();
    expect(processKillSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("123.99"),
    );
  });

  // ── PID 文件存在但进程已死 ─────────────────────────────

  it("should exit(1) and clean stale PID file when process is dead", async () => {
    setPlatform("linux");
    mockReadPidFile.mockReturnValue(okPidResult(54321));
    mockIsProcessAlive.mockReturnValue(false);
    mockRemovePidFile.mockReturnValue({ ok: true, path: ".vext.pid" });

    await expect(reloadCommand([])).rejects.toThrow("process.exit(1)");

    expect(mockIsProcessAlive).toHaveBeenCalledWith(54321);
    expect(mockRemovePidFile).toHaveBeenCalledWith(".vext.pid", 54321);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("not running"),
    );
  });

  // ── 发送 SIGHUP 成功 ──────────────────────────────────

  it("should send SIGHUP to alive process on Linux", async () => {
    setPlatform("linux");
    mockReadPidFile.mockReturnValue(okPidResult(54321));
    mockIsProcessAlive.mockReturnValue(true);

    await reloadCommand([]);

    expect(processKillSpy).toHaveBeenCalledWith(54321, "SIGHUP");
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Reload signal (SIGHUP) sent"),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Rolling restart in progress"),
    );
  });

  // ── macOS 上也应正常工作 ──────────────────────────────

  it("should send SIGHUP on macOS (darwin)", async () => {
    setPlatform("darwin");
    mockReadPidFile.mockReturnValue(okPidResult(11111));
    mockIsProcessAlive.mockReturnValue(true);

    await reloadCommand([]);

    expect(processKillSpy).toHaveBeenCalledWith(11111, "SIGHUP");
  });

  // ── 发送 SIGHUP 权限不足 ─────────────────────────────

  it("should exit(1) when SIGHUP fails with EPERM", async () => {
    setPlatform("linux");
    mockReadPidFile.mockReturnValue(okPidResult(54321));
    mockIsProcessAlive.mockReturnValue(true);

    const epermError = new Error("EPERM") as NodeJS.ErrnoException;
    epermError.code = "EPERM";
    processKillSpy.mockImplementation(
      (_pid: number, signal?: string | number) => {
        if (signal === "SIGHUP") throw epermError;
        return true;
      },
    );

    await expect(reloadCommand([])).rejects.toThrow("process.exit(1)");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Permission denied"),
    );
  });

  // ── --pid-file 参数 ───────────────────────────────────

  it("should use custom --pid-file path", async () => {
    setPlatform("linux");
    mockReadPidFile.mockReturnValue(okPidResult(77777, "/run/app.pid"));
    mockIsProcessAlive.mockReturnValue(true);

    await reloadCommand(["--pid-file", "/run/app.pid"]);

    expect(mockReadPidFile).toHaveBeenCalledWith("/run/app.pid", false);
    expect(processKillSpy).toHaveBeenCalledWith(77777, "SIGHUP");
  });

  // ── --help 参数 ───────────────────────────────────────

  it("should print help and exit(0) with --help", async () => {
    // --help 应在 Windows 检测之前生效？不 — 实际代码先检查 Windows。
    // 在非 Windows 上验证 --help。
    setPlatform("linux");

    await expect(reloadCommand(["--help"])).rejects.toThrow("process.exit(0)");

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("vext reload"),
    );
  });

  // ── 未知参数 ──────────────────────────────────────────

  it("should exit(1) with unknown option", async () => {
    setPlatform("linux");

    await expect(reloadCommand(["--foo"])).rejects.toThrow("process.exit(1)");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown option: "--foo"'),
    );
  });

  it("should exit(1) with unknown positional argument", async () => {
    setPlatform("linux");

    await expect(reloadCommand(["extra"])).rejects.toThrow("process.exit(1)");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown argument: "extra"'),
    );
    expect(mockReadPidFile).not.toHaveBeenCalled();
  });

  it("should reject --pid-file when the next token is another flag", async () => {
    setPlatform("linux");

    await expect(reloadCommand(["--pid-file", "--help"])).rejects.toThrow(
      "process.exit(1)",
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[vextjs] Option "--pid-file" requires a value: <path>; received option-like value "--help"',
    );
    expect(mockReadPidFile).not.toHaveBeenCalled();
  });

  // ── 发送 SIGHUP 失败（非 EPERM 错误） ────────────────

  it("should exit(1) when SIGHUP fails with generic error", async () => {
    setPlatform("linux");
    mockReadPidFile.mockReturnValue(okPidResult(54321));
    mockIsProcessAlive.mockReturnValue(true);

    const genericError = new Error("Unknown error") as NodeJS.ErrnoException;
    genericError.code = "ESRCH";
    processKillSpy.mockImplementation(
      (_pid: number, signal?: string | number) => {
        if (signal === "SIGHUP") throw genericError;
        return true;
      },
    );

    await expect(reloadCommand([])).rejects.toThrow("process.exit(1)");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to send SIGHUP"),
    );
  });
});

// ════════════════════════════════════════════════════════════
//  vext status
// ════════════════════════════════════════════════════════════

describe("vext status (statusCommand)", () => {
  // ── PID 文件不存在 → ⚪ not running ───────────────────

  it("should show 'not running' when PID file not found", async () => {
    mockReadPidFile.mockReturnValue(
      failPidResult("PID file not found", "/abs/.vext.pid"),
    );

    await statusCommand([]);

    expect(getConsoleLogMessages()).toEqual([
      "Status: ⚪ not running",
      "  PID file: /abs/.vext.pid (not found)",
    ]);
    expect(consoleLogSpy).toHaveBeenCalledWith("Status: ⚪ not running");
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("not found"),
    );
    // 不应调用 process.exit
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it("should show invalid PID file diagnostics without probing parsed prefixes", async () => {
    mockReadPidFile.mockReturnValue(
      failPidResult(
        'PID file "/abs/.vext.pid" contains invalid content: "123 extra\\n"',
        "/abs/.vext.pid",
      ),
    );

    await statusCommand([]);

    expect(getConsoleLogMessages()).toEqual([
      "Status: ⚠️ invalid PID file",
      "  PID file: /abs/.vext.pid",
      '  Error:    PID file "/abs/.vext.pid" contains invalid content: "123 extra\\n"',
    ]);
    expect(mockIsProcessAlive).not.toHaveBeenCalled();
    expect(processKillSpy).not.toHaveBeenCalled();
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  // ── PID 文件存在但进程已死 → 🔴 stale ────────────────

  it("should show 'stale' when process is dead", async () => {
    mockReadPidFile.mockReturnValue(okPidResult(23456, "/abs/.vext.pid"));
    mockIsProcessAlive.mockReturnValue(false);

    await statusCommand([]);

    expect(getConsoleLogMessages()).toEqual([
      "Status: 🔴 stale (PID file exists but process is dead)",
      "  PID file: /abs/.vext.pid",
      "  PID:      23456 (not running)",
      "",
      '  Tip: Run "vext stop" to clean up the stale PID file.',
    ]);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("🔴 stale"),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("23456"),
    );
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  // ── 进程存活 → 🟢 running（health 不可达） ───────────

  it("should show 'running' when process is alive, health unreachable", async () => {
    mockReadPidFile.mockReturnValue(okPidResult(23456, "/abs/.vext.pid"));
    mockIsProcessAlive.mockReturnValue(true);

    // mock fetch 失败（endpoint unreachable）
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    try {
      await statusCommand([]);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(getConsoleLogMessages()).toEqual([
      "Status: 🟢 running",
      "  Master PID: 23456",
      "  PID file:   /abs/.vext.pid",
      "  Health:     (endpoint unreachable at http://127.0.0.1:3000/health)",
    ]);
    expect(consoleLogSpy).toHaveBeenCalledWith("Status: 🟢 running");
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Master PID: 23456"),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("unreachable"),
    );
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  // ── 进程存活 + health 成功 ────────────────────────────

  it("should display health details when /health responds", async () => {
    mockReadPidFile.mockReturnValue(okPidResult(23456));
    mockIsProcessAlive.mockReturnValue(true);

    const healthData = {
      pid: 12346,
      uptime: 9312, // 2h 35m 12s
      memory: {
        heapUsed: 67_108_864, // 64 MB
        rss: 134_217_728, // 128 MB
      },
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(healthData),
    });

    try {
      await statusCommand([]);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const expectedOutput = [
      "Status: 🟢 running",
      "  Master PID: 23456",
      "  PID file:   .vext.pid",
      "  Worker PID: 12346",
      "  Uptime:     2h 35m 12s",
      "  Heap Used:  64.0 MB",
      "  RSS:        128.0 MB",
    ];
    const expectedDocsOutput = [
      "Status: 🟢 running",
      "  Master PID: 12345",
      "  PID file:   .vext.pid",
      "  Worker PID: 12346",
      "  Uptime:     2h 35m 12s",
      "  Heap Used:  64.0 MB",
      "  RSS:        128.0 MB",
    ];

    expect(getConsoleLogMessages()).toEqual(expectedOutput);
    expect(readRepoFile("website/docs/zh/guide/cluster.md")).toContain(
      expectedDocsOutput.join("\n"),
    );
    expect(readRepoFile("website/docs/en/guide/cluster.md")).toContain(
      expectedDocsOutput.join("\n"),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith("Status: 🟢 running");
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Worker PID: 12346"),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Uptime:"),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Heap Used:"),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("RSS:"));
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  // ── health 返回非 200 ─────────────────────────────────

  it("should handle non-ok health response gracefully", async () => {
    mockReadPidFile.mockReturnValue(okPidResult(23456));
    mockIsProcessAlive.mockReturnValue(true);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });

    try {
      await statusCommand([]);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(consoleLogSpy).toHaveBeenCalledWith("Status: 🟢 running");
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("returned 503"),
    );
  });

  // ── --pid-file 参数 ───────────────────────────────────

  it("should use custom --pid-file path", async () => {
    mockReadPidFile.mockReturnValue(
      failPidResult("PID file not found", "/custom/path.pid"),
    );

    await statusCommand(["--pid-file", "/custom/path.pid"]);

    expect(mockReadPidFile).toHaveBeenCalledWith("/custom/path.pid", false);
  });

  // ── --port 参数 ───────────────────────────────────────

  it("should use custom --port for health probe", async () => {
    mockReadPidFile.mockReturnValue(okPidResult(11111));
    mockIsProcessAlive.mockReturnValue(true);

    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    globalThis.fetch = fetchSpy;

    try {
      await statusCommand(["--port", "8080"]);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/health",
      expect.any(Object),
    );
  });

  // ── --host 参数 ───────────────────────────────────────

  it("should use custom --host for health probe", async () => {
    mockReadPidFile.mockReturnValue(okPidResult(11111));
    mockIsProcessAlive.mockReturnValue(true);

    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    globalThis.fetch = fetchSpy;

    try {
      await statusCommand(["--host", "0.0.0.0", "--port", "9000"]);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://0.0.0.0:9000/health",
      expect.any(Object),
    );
  });

  // ── 无效 --port 参数 ──────────────────────────────────

  it("should exit(1) with invalid port number", async () => {
    await expect(statusCommand(["--port", "abc"])).rejects.toThrow(
      "process.exit(1)",
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid port number: "abc"'),
    );
  });

  // ── --help 参数 ───────────────────────────────────────

  it("should print help and exit(0) with --help", async () => {
    await expect(statusCommand(["--help"])).rejects.toThrow("process.exit(0)");

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("vext status"),
    );
  });

  // ── 未知参数 ──────────────────────────────────────────

  it("should exit(1) with unknown option", async () => {
    await expect(statusCommand(["--verbose"])).rejects.toThrow(
      "process.exit(1)",
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown option: "--verbose"'),
    );
  });

  it("should exit(1) with unknown positional argument", async () => {
    await expect(statusCommand(["extra"])).rejects.toThrow("process.exit(1)");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown argument: "extra"'),
    );
    expect(mockReadPidFile).not.toHaveBeenCalled();
  });

  it("should reject --pid-file when the next token is another flag", async () => {
    await expect(
      statusCommand(["--pid-file", "--port", "8080"]),
    ).rejects.toThrow("process.exit(1)");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[vextjs] Option "--pid-file" requires a value: <path>; received option-like value "--port"',
    );
    expect(mockReadPidFile).not.toHaveBeenCalled();
  });

  it("should reject --host when the next token is another flag", async () => {
    await expect(statusCommand(["--host", "--port", "8080"])).rejects.toThrow(
      "process.exit(1)",
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[vextjs] Option "--host" requires a value: <string>; received option-like value "--port"',
    );
    expect(mockReadPidFile).not.toHaveBeenCalled();
  });

  // ── health 部分字段缺失（仅有 pid） ──────────────────

  it("should handle partial health response (only pid)", async () => {
    mockReadPidFile.mockReturnValue(okPidResult(23456));
    mockIsProcessAlive.mockReturnValue(true);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ pid: 23457 }),
    });

    try {
      await statusCommand([]);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Worker PID: 23457"),
    );
    // 不应输出 Uptime / Heap / RSS
    const logCalls = consoleLogSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(logCalls).not.toContain("Uptime:");
    expect(logCalls).not.toContain("Heap Used:");
    expect(logCalls).not.toContain("RSS:");
  });

  // ── health 返回空对象 ─────────────────────────────────

  it("should handle empty health response gracefully", async () => {
    mockReadPidFile.mockReturnValue(okPidResult(23456));
    mockIsProcessAlive.mockReturnValue(true);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    try {
      await statusCommand([]);
    } finally {
      globalThis.fetch = originalFetch;
    }

    // 仅应输出 running 状态，无 Worker 详情
    expect(consoleLogSpy).toHaveBeenCalledWith("Status: 🟢 running");
  });

  it("should keep Cluster docs aligned with simplified status output", () => {
    const zhDocs = readRepoFile("website/docs/zh/guide/cluster.md");
    const enDocs = readRepoFile("website/docs/en/guide/cluster.md");

    for (const doc of [zhDocs, enDocs]) {
      expect(doc).not.toContain("Cluster Status\n");
      expect(doc).not.toMatch(/Workers:\s+\d/u);
      expect(doc).not.toMatch(/Worker\s+PID\s+Status\s+Uptime\s+Requests/u);
      expect(doc).not.toContain("45,230");
    }

    expect(zhDocs).toContain("当前命令不会输出 worker 表或请求数");
    expect(enDocs).toContain(
      "The current command does not print a worker table",
    );
  });
});

// ════════════════════════════════════════════════════════════
//  CLI 命令注册（cli/index.ts）
// ════════════════════════════════════════════════════════════

describe("CLI command registration", () => {
  it("should export stopCommand function", async () => {
    const mod = await import("../../../src/cli/stop.js");
    expect(typeof mod.stopCommand).toBe("function");
  });

  it("should export reloadCommand function", async () => {
    const mod = await import("../../../src/cli/reload.js");
    expect(typeof mod.reloadCommand).toBe("function");
  });

  it("should export statusCommand function", async () => {
    const mod = await import("../../../src/cli/status.js");
    expect(typeof mod.statusCommand).toBe("function");
  });
});

// ════════════════════════════════════════════════════════════
//  边界场景
// ════════════════════════════════════════════════════════════

describe("edge cases", () => {
  // ── stop: process.kill 发送 SIGTERM 抛出 ESRCH ────────

  it("stop: should exit(1) when process.kill throws ESRCH", async () => {
    mockReadPidFile.mockReturnValue(okPidResult(99999));
    mockIsProcessAlive.mockReturnValue(true);

    const esrchError = new Error("ESRCH") as NodeJS.ErrnoException;
    esrchError.code = "ESRCH";
    processKillSpy.mockImplementation(
      (_pid: number, signal?: string | number) => {
        if (signal === "SIGTERM") throw esrchError;
        return true;
      },
    );

    await expect(stopCommand([])).rejects.toThrow("process.exit(1)");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to send SIGTERM"),
    );
  });

  // ── stop: 空参数列表 ─────────────────────────────────

  it("stop: should use default PID file with no arguments", async () => {
    mockReadPidFile.mockReturnValue(okPidResult(11111));
    mockIsProcessAlive.mockReturnValueOnce(true).mockReturnValueOnce(false);
    mockRemovePidFile.mockReturnValue({ ok: true, path: ".vext.pid" });

    await stopCommand();

    expect(mockReadPidFile).toHaveBeenCalledWith(".vext.pid", false);
  });

  // ── reload: 空参数列表（非 Windows） ─────────────────

  it("reload: should use default PID file with no arguments on Linux", async () => {
    setPlatform("linux");
    mockReadPidFile.mockReturnValue(okPidResult(22222));
    mockIsProcessAlive.mockReturnValue(true);

    await reloadCommand();

    expect(mockReadPidFile).toHaveBeenCalledWith(".vext.pid", false);
    expect(processKillSpy).toHaveBeenCalledWith(22222, "SIGHUP");
  });

  // ── status: uptime 格式化边界值 ──────────────────────

  it("status: should format uptime correctly for various durations", async () => {
    mockReadPidFile.mockReturnValue(okPidResult(33333));
    mockIsProcessAlive.mockReturnValue(true);

    // 测试 90061 秒 = 1d 1h 1m 1s
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          uptime: 90061,
        }),
    });

    try {
      await statusCommand([]);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("1d 1h 1m 1s"),
    );
  });

  // ── status: uptime 小于 60 秒 ─────────────────────────

  it("status: should format uptime as seconds for values under 60", async () => {
    mockReadPidFile.mockReturnValue(okPidResult(33333));
    mockIsProcessAlive.mockReturnValue(true);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ uptime: 42 }),
    });

    try {
      await statusCommand([]);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("42s"));
  });

  // ── status: 内存格式化 — KB 级别 ─────────────────────

  it("status: should format memory in KB for small values", async () => {
    mockReadPidFile.mockReturnValue(okPidResult(33333));
    mockIsProcessAlive.mockReturnValue(true);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          memory: { heapUsed: 512_000 }, // ~500 KB
        }),
    });

    try {
      await statusCommand([]);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("KB"));
  });
});
