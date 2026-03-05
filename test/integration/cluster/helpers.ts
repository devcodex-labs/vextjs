/**
 * helpers.ts — Cluster 集成测试辅助函数
 *
 * 提供子进程管理、日志等待、输出解析等工具，
 * 用于 cluster-integration.test.ts 中的端到端验证。
 *
 * @module test/integration/cluster/helpers
 */

import { fork, type ChildProcess } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, unlinkSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** 项目根目录 */
export const PROJECT_ROOT = join(__dirname, "..", "..", "..");

/** stub-worker.mjs 路径 */
export const STUB_WORKER_PATH = join(__dirname, "stub-worker.mjs");

/** 编译后的 ClusterMaster 模块路径 */
export const CLUSTER_MODULE_PATH = join(
  PROJECT_ROOT,
  "dist",
  "lib",
  "cluster",
  "index.js",
);

// ── 类型定义 ────────────────────────────────────────────────

/** 子进程执行结果 */
export interface ProcessResult {
  /** 退出码 */
  exitCode: number | null;
  /** 退出信号 */
  signal: string | null;
  /** 标准输出行 */
  stdoutLines: string[];
  /** 标准错误行 */
  stderrLines: string[];
  /** 所有输出行（stdout + stderr 按时间顺序） */
  allLines: string[];
}

/** 子进程句柄（可发送信号、等待输出等） */
export interface ManagedProcess {
  /** 底层 ChildProcess */
  child: ChildProcess;
  /** 所有收集到的输出行 */
  lines: string[];
  /** stdout 行 */
  stdoutLines: string[];
  /** stderr 行 */
  stderrLines: string[];
  /** 等待输出中出现匹配内容 */
  waitForOutput: (
    pattern: string | RegExp,
    timeoutMs?: number,
  ) => Promise<string>;
  /** 等待指定数量的匹配行出现 */
  waitForOutputCount: (
    pattern: string | RegExp,
    count: number,
    timeoutMs?: number,
  ) => Promise<string[]>;
  /** 等待进程退出 */
  waitForExit: (timeoutMs?: number) => Promise<ProcessResult>;
  /** 发送信号 */
  sendSignal: (signal: NodeJS.Signals) => void;
  /** 强制杀掉进程 */
  kill: () => void;
  /** 进程是否已退出 */
  exited: boolean;
  /** 退出码 */
  exitCode: number | null;
  /** 退出信号 */
  exitSignal: string | null;
}

// ── 子进程管理 ──────────────────────────────────────────────

/**
 * spawnMasterProcess — 启动一个执行 stub-master 脚本的子进程
 *
 * 通过 fork 启动指定脚本，自动收集输出，
 * 返回 ManagedProcess 提供等待和控制方法。
 *
 * @param scriptPath 要执行的脚本路径
 * @param env 额外的环境变量
 * @param execArgv Node.js 启动参数
 */
export function spawnProcess(
  scriptPath: string,
  env: Record<string, string> = {},
  execArgv: string[] = [],
): ManagedProcess {
  const lines: string[] = [];
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  // 用于通知 waitForOutput 的回调队列
  const outputWaiters: Array<{
    pattern: string | RegExp;
    resolve: (line: string) => void;
  }> = [];

  const child = fork(scriptPath, [], {
    env: {
      ...process.env,
      ...env,
      // 确保子进程不会继承测试框架的一些干扰变量
      NODE_ENV: "test",
    },
    execArgv,
    stdio: ["pipe", "pipe", "pipe", "ipc"],
    // 不继承父进程的 stdio（避免 vitest 输出混乱）
    silent: true,
  });

  const managed: ManagedProcess = {
    child,
    lines,
    stdoutLines,
    stderrLines,
    exited: false,
    exitCode: null,
    exitSignal: null,
    waitForOutput: (pattern, timeoutMs = 10_000) =>
      waitForOutputImpl(managed, outputWaiters, pattern, timeoutMs),
    waitForOutputCount: (pattern, count, timeoutMs = 15_000) =>
      waitForOutputCountImpl(managed, outputWaiters, pattern, count, timeoutMs),
    waitForExit: (timeoutMs = 15_000) => waitForExitImpl(managed, timeoutMs),
    sendSignal: (signal) => {
      if (!managed.exited && child.pid) {
        process.kill(child.pid, signal);
      }
    },
    kill: () => {
      if (!managed.exited) {
        child.kill("SIGKILL");
      }
    },
  };

  // 收集 stdout
  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    const newLines = text.split("\n").filter((l) => l.trim() !== "");
    for (const line of newLines) {
      lines.push(line);
      stdoutLines.push(line);
      // 通知等待者
      notifyWaiters(outputWaiters, line);
    }
  });

  // 收集 stderr
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    const newLines = text.split("\n").filter((l) => l.trim() !== "");
    for (const line of newLines) {
      lines.push(line);
      stderrLines.push(line);
      notifyWaiters(outputWaiters, line);
    }
  });

  // 监听退出
  child.on("exit", (code, signal) => {
    managed.exited = true;
    managed.exitCode = code;
    managed.exitSignal = signal;
  });

  return managed;
}

// ── 等待逻辑 ────────────────────────────────────────────────

function notifyWaiters(
  waiters: Array<{
    pattern: string | RegExp;
    resolve: (line: string) => void;
  }>,
  line: string,
): void {
  // 倒序遍历以安全地在循环中删除
  for (let i = waiters.length - 1; i >= 0; i--) {
    const waiter = waiters[i];
    const matches =
      typeof waiter.pattern === "string"
        ? line.includes(waiter.pattern)
        : waiter.pattern.test(line);
    if (matches) {
      waiter.resolve(line);
      waiters.splice(i, 1);
    }
  }
}

function waitForOutputImpl(
  managed: ManagedProcess,
  waiters: Array<{
    pattern: string | RegExp;
    resolve: (line: string) => void;
  }>,
  pattern: string | RegExp,
  timeoutMs: number,
): Promise<string> {
  // 先检查已有输出
  for (const line of managed.lines) {
    const matches =
      typeof pattern === "string"
        ? line.includes(pattern)
        : pattern.test(line);
    if (matches) return Promise.resolve(line);
  }

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      // 从 waiters 中移除
      const idx = waiters.findIndex((w) => w.resolve === resolve);
      if (idx !== -1) waiters.splice(idx, 1);
      reject(
        new Error(
          `Timeout waiting for output matching "${pattern}" after ${timeoutMs}ms.\n` +
            `Collected output (${managed.lines.length} lines):\n` +
            managed.lines.map((l, i) => `  ${i + 1}: ${l}`).join("\n"),
        ),
      );
    }, timeoutMs);

    const wrappedResolve = (line: string) => {
      clearTimeout(timer);
      resolve(line);
    };

    waiters.push({ pattern, resolve: wrappedResolve });

    // 如果进程已退出，立即失败
    if (managed.exited) {
      clearTimeout(timer);
      const idx = waiters.findIndex((w) => w.resolve === wrappedResolve);
      if (idx !== -1) waiters.splice(idx, 1);
      reject(
        new Error(
          `Process exited (code=${managed.exitCode}, signal=${managed.exitSignal}) ` +
            `before output matching "${pattern}" was found.\n` +
            `Collected output (${managed.lines.length} lines):\n` +
            managed.lines.map((l, i) => `  ${i + 1}: ${l}`).join("\n"),
        ),
      );
    }
  });
}

function waitForOutputCountImpl(
  managed: ManagedProcess,
  waiters: Array<{
    pattern: string | RegExp;
    resolve: (line: string) => void;
  }>,
  pattern: string | RegExp,
  count: number,
  timeoutMs: number,
): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    const matched: string[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          `Timeout waiting for ${count} outputs matching "${pattern}" ` +
            `(found ${matched.length}) after ${timeoutMs}ms.\n` +
            `Collected output (${managed.lines.length} lines):\n` +
            managed.lines.map((l, i) => `  ${i + 1}: ${l}`).join("\n"),
        ),
      );
    }, timeoutMs);

    // 检查已有输出
    for (const line of managed.lines) {
      const matches =
        typeof pattern === "string"
          ? line.includes(pattern)
          : pattern.test(line);
      if (matches) {
        matched.push(line);
        if (matched.length >= count) {
          clearTimeout(timer);
          settled = true;
          resolve(matched);
          return;
        }
      }
    }

    // 注册后续行的监听
    const lineHandler = (line: string) => {
      if (settled) return;
      const matches =
        typeof pattern === "string"
          ? line.includes(pattern)
          : pattern.test(line);
      if (matches) {
        matched.push(line);
        if (matched.length >= count) {
          settled = true;
          clearTimeout(timer);
          resolve(matched);
        }
      }
    };

    // 监听新行
    const origPush = managed.lines.push.bind(managed.lines);
    managed.lines.push = (...items: string[]) => {
      const result = origPush(...items);
      for (const item of items) {
        lineHandler(item);
      }
      return result;
    };

    // 如果进程已退出且未满足
    if (managed.exited && !settled) {
      clearTimeout(timer);
      settled = true;
      reject(
        new Error(
          `Process exited (code=${managed.exitCode}) before ${count} outputs ` +
            `matching "${pattern}" were found (got ${matched.length}).\n` +
            `Collected output (${managed.lines.length} lines):\n` +
            managed.lines.map((l, i) => `  ${i + 1}: ${l}`).join("\n"),
        ),
      );
    }
  });
}

function waitForExitImpl(
  managed: ManagedProcess,
  timeoutMs: number,
): Promise<ProcessResult> {
  if (managed.exited) {
    return Promise.resolve({
      exitCode: managed.exitCode,
      signal: managed.exitSignal,
      stdoutLines: [...managed.stdoutLines],
      stderrLines: [...managed.stderrLines],
      allLines: [...managed.lines],
    });
  }

  return new Promise<ProcessResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      managed.kill();
      reject(
        new Error(
          `Process did not exit within ${timeoutMs}ms. Force killed.\n` +
            `Collected output (${managed.lines.length} lines):\n` +
            managed.lines.map((l, i) => `  ${i + 1}: ${l}`).join("\n"),
        ),
      );
    }, timeoutMs);

    managed.child.on("exit", () => {
      clearTimeout(timer);
      // 短暂延迟确保所有 stdout/stderr 数据已处理
      setTimeout(() => {
        resolve({
          exitCode: managed.exitCode,
          signal: managed.exitSignal,
          stdoutLines: [...managed.stdoutLines],
          stderrLines: [...managed.stderrLines],
          allLines: [...managed.lines],
        });
      }, 100);
    });
  });
}

// ── PID 文件工具 ────────────────────────────────────────────

/**
 * 检查 PID 文件是否存在
 */
export function pidFileExists(pidFilePath: string): boolean {
  return existsSync(pidFilePath);
}

/**
 * 读取 PID 文件内容
 */
export function readPidFileContent(pidFilePath: string): number | null {
  try {
    const content = readFileSync(pidFilePath, "utf-8").trim();
    const pid = parseInt(content, 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * 安全删除 PID 文件（如果存在）
 */
export function cleanupPidFile(pidFilePath: string): void {
  try {
    if (existsSync(pidFilePath)) {
      unlinkSync(pidFilePath);
    }
  } catch {
    // 忽略删除失败
  }
}

// ── 日志解析工具 ────────────────────────────────────────────

/**
 * 从输出行中提取 Worker 数量
 *
 * 匹配格式：`[cluster] ✅ N/M workers ready`
 *
 * @returns [readyCount, totalCount] 或 null
 */
export function parseWorkersReadyLine(
  lines: string[],
): [number, number] | null {
  for (const line of lines) {
    const match = line.match(/(\d+)\/(\d+) workers ready/);
    if (match) {
      return [parseInt(match[1], 10), parseInt(match[2], 10)];
    }
  }
  return null;
}

/**
 * 从输出行中统计特定模式出现的次数
 */
export function countMatchingLines(
  lines: string[],
  pattern: string | RegExp,
): number {
  let count = 0;
  for (const line of lines) {
    const matches =
      typeof pattern === "string"
        ? line.includes(pattern)
        : pattern.test(line);
    if (matches) count++;
  }
  return count;
}

/**
 * 从输出行中提取所有 Worker PID
 *
 * 匹配格式：`[stub-worker:N] ready` 或 `[stub-worker:N] starting (pid: XXXX)`
 */
export function extractWorkerPids(lines: string[]): number[] {
  const pids: number[] = [];
  for (const line of lines) {
    const match = line.match(/\[stub-worker:\d+\] starting \(pid: (\d+)\)/);
    if (match) {
      pids.push(parseInt(match[1], 10));
    }
  }
  return pids;
}

/**
 * 短暂延迟
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
