import {
  readPidFile,
  isProcessAlive,
  DEFAULT_PID_FILE,
} from "../lib/cluster/pid-file.js";

/**
 * status.ts — vext status CLI 命令
 *
 * 读取 PID 文件，检查 Master 进程存活状态，
 * 并可选地探测 /health 端点获取 Worker 运行信息。
 *
 * 流程：
 *   1. 解析 --pid-file / --port 参数（可选）
 *   2. readPidFile() 读取 PID
 *   3. 根据 PID 文件存在性和进程存活性输出状态：
 *      - ⚪ not running（PID 文件不存在）
 *      - 🔴 stale（PID 文件存在但进程已死）
 *      - 🟢 running（进程存活）
 *   4. 如果进程存活，尝试探测 /health 端点获取 Worker 详情
 *
 * 退出码：
 *   0 — 无论状态如何都正常退出（status 是查询命令，不应失败）
 *
 * @module cli/status
 * @see 09-cli.md §10.3（vext status）
 */

// ── 常量 ────────────────────────────────────────────────────

/** 默认健康检查端口 */
const DEFAULT_PORT = 3000;

/** 健康探测超时（毫秒） */
const HEALTH_PROBE_TIMEOUT = 3_000;

// ── 类型定义 ────────────────────────────────────────────────

interface StatusOptions {
  /** PID 文件路径（覆盖默认值） */
  pidFile: string;
  /** 健康探测端口 */
  port: number;
  /** 健康探测主机 */
  host: string;
}

/**
 * /health 端点响应的预期结构（宽松类型）
 */
interface HealthResponse {
  pid?: number;
  uptime?: number;
  memory?: {
    heapUsed?: number;
    heapTotal?: number;
    rss?: number;
  };
  [key: string]: unknown;
}

// ── 主函数 ──────────────────────────────────────────────────

/**
 * statusCommand — vext status CLI 命令入口
 *
 * 解析命令行参数，读取 PID 文件，输出服务器运行状态。
 *
 * @param args 命令行参数（如 ['--port', '8080']）
 */
export async function statusCommand(args: string[] = []): Promise<void> {
  // ── 解析命令行参数 ────────────────────────────────────────
  const options = parseStatusArgs(args);

  // ── 读取 PID 文件 ─────────────────────────────────────────
  const result = readPidFile(options.pidFile, false);

  if (!result.ok || result.pid === undefined) {
    // PID 文件不存在或无法读取
    console.log("Status: ⚪ not running");
    console.log(`  PID file: ${result.path} (not found)`);
    return;
  }

  const pid = result.pid;

  // ── 检查进程存活 ──────────────────────────────────────────
  if (!isProcessAlive(pid)) {
    console.log("Status: 🔴 stale (PID file exists but process is dead)");
    console.log(`  PID file: ${result.path}`);
    console.log(`  PID:      ${pid} (not running)`);
    console.log("");
    console.log('  Tip: Run "vext stop" to clean up the stale PID file.');
    return;
  }

  // ── 进程存活 ──────────────────────────────────────────────
  console.log(`Status: 🟢 running`);
  console.log(`  Master PID: ${pid}`);
  console.log(`  PID file:   ${result.path}`);

  // ── 探测 /health 端点 ─────────────────────────────────────
  //
  // 尝试请求 Worker 的健康端点获取运行时信息。
  // 探测失败不报错（Master 可能不暴露 HTTP，或端口不同）。
  //
  await probeHealth(options.host, options.port);
}

/**
 * probeHealth — 探测 /health 端点
 *
 * 使用 fetch 请求 http://<host>:<port>/health，
 * 解析返回的 JSON 并输出 Worker 运行时信息。
 *
 * 探测失败时静默处理（仅输出一行提示）。
 *
 * @param host 目标主机
 * @param port 目标端口
 */
async function probeHealth(host: string, port: number): Promise<void> {
  const url = `http://${host}:${port}/health`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT);

    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!resp.ok) {
      console.log(`  Health:     (endpoint returned ${resp.status})`);
      return;
    }

    const data = (await resp.json()) as HealthResponse;

    // ── 输出 Worker 信息 ──────────────────────────────────
    if (data.pid !== undefined) {
      console.log(`  Worker PID: ${data.pid}`);
    }
    if (data.uptime !== undefined) {
      console.log(`  Uptime:     ${formatUptime(data.uptime)}`);
    }
    if (data.memory) {
      if (data.memory.heapUsed !== undefined) {
        console.log(`  Heap Used:  ${formatBytes(data.memory.heapUsed)}`);
      }
      if (data.memory.rss !== undefined) {
        console.log(`  RSS:        ${formatBytes(data.memory.rss)}`);
      }
    }
  } catch {
    console.log(`  Health:     (endpoint unreachable at ${url})`);
  }
}

// ── 格式化辅助 ──────────────────────────────────────────────

/**
 * formatUptime — 将秒数格式化为可读的时间字符串
 *
 * @param seconds 运行时间（秒）
 * @returns 格式化字符串（如 "2h 15m 30s"）
 */
function formatUptime(seconds: number): string {
  const s = Math.round(seconds);

  if (s < 60) {
    return `${s}s`;
  }

  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(" ");
}

/**
 * formatBytes — 将字节数格式化为可读的大小字符串
 *
 * @param bytes 字节数
 * @returns 格式化字符串（如 "128.5 MB"）
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ── 参数解析 ────────────────────────────────────────────────

/**
 * parseStatusArgs — 解析 vext status 的命令行参数
 *
 * 支持的参数：
 *   --pid-file <path>   覆盖 PID 文件路径（默认 .vext.pid）
 *   --port <number>     健康探测端口（默认 3000）
 *   --host <string>     健康探测主机（默认 127.0.0.1）
 *   -h, --help          显示帮助
 *
 * @param args process.argv.slice(2) 的子集（已去除 'status' 命令本身）
 * @returns 解析后的选项
 */
function parseStatusArgs(args: string[]): StatusOptions {
  const options: StatusOptions = {
    pidFile: DEFAULT_PID_FILE,
    port: DEFAULT_PORT,
    host: "127.0.0.1",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--pid-file" && i + 1 < args.length) {
      options.pidFile = args[++i]!;
    } else if (arg === "--port" && i + 1 < args.length) {
      const portStr = args[++i]!;
      const port = parseInt(portStr, 10);
      if (Number.isNaN(port) || port < 0 || port > 65535) {
        console.error(`[vextjs] Invalid port number: "${portStr}"`);
        process.exit(1);
      }
      options.port = port;
    } else if (arg === "--host" && i + 1 < args.length) {
      options.host = args[++i]!;
    } else if (arg === "--help" || arg === "-h") {
      printStatusHelp();
      process.exit(0);
    } else if (arg?.startsWith("--")) {
      console.error(`[vextjs] Unknown option: "${arg}"\n`);
      printStatusHelp();
      process.exit(1);
    }
  }

  return options;
}

/**
 * 打印 vext status 的帮助信息
 */
function printStatusHelp(): void {
  console.log(`
  Usage: vext status [options]

  Show the status of the running vext server (cluster mode).

  Reads the PID file to check if the master process is alive,
  and optionally probes the /health endpoint for worker details.

  Options:
    --pid-file <path>   Path to the PID file (default: .vext.pid)
    --port <number>     Health probe port (default: 3000)
    --host <string>     Health probe host (default: 127.0.0.1)
    -h, --help          Show this help message

  Status indicators:
    ⚪ not running      No PID file found
    🔴 stale            PID file exists but process is dead
    🟢 running          Master process is alive

  Examples:
    $ vext status
    $ vext status --pid-file /var/run/myapp.pid
    $ vext status --port 8080
`);
}
