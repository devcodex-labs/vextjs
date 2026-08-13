/**
 * vext 性能基准测试主脚本
 *
 * 启动裸跑服务器和 vext 封装服务器，使用 autocannon 进行压测，
 * 收集结果并生成 Markdown 报告。
 *
 * 用法：
 *   node test/benchmark/run-benchmark.mjs
 *   node test/benchmark/run-benchmark.mjs --duration 20 --connections 100
 *   node test/benchmark/run-benchmark.mjs --scenario json
 *   node test/benchmark/run-benchmark.mjs --framework hono,fastify
 *
 * 选项：
 *   --duration <seconds>     压测持续时间（默认 15）
 *   --connections <number>   并发连接数（默认 50）
 *   --pipelining <number>    HTTP 流水线（默认 10）
 *   --warmup <seconds>       预热时间（默认 5）
 *   --rounds <number>        每个模式的轮次数（默认 1；≥3 建议取中位数）
 *   --scenario <name>        仅运行指定场景（json / params / chain / middleware-chain / all）
 *   --framework <names>      仅运行指定框架，逗号分隔（native,hono,fastify,express,koa；egg 仅显式比较）
 *   --output <path>          报告输出路径（默认 stdout + test/benchmark/RESULTS.md）
 *   --results-json <path>    将完整原始样本写为 JSON，供分段正式 matrix 合并
 *   --from-results-json <paths> 读取逗号分隔的 complete JSON 样本并只生成合并报告
 *   --require-complete-matrix  合并时要求五 adapter × 四场景完整矩阵
 */

import { execFileSync, fork, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── 常量 ──────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPOSITORY_ROOT = resolve(__dirname, "../..");
const AUTOCANNON_COMMAND = process.platform === "win32" ? "cmd.exe" : "npm";
const AUTOCANNON_VERSION = "8.0.0";
const GENERATED_REPORT_PATHSPEC = ":(exclude)test/benchmark/RESULTS.md";

const FRAMEWORKS = ["hono", "fastify", "express", "koa", "native"];

// egg 是独立对比框架（基于 Koa 的企业级框架），不是 vext adapter
// egg 使用多进程模型（master + agent + worker），启动/停止方式与其他裸跑服务器不同
// 通过 --framework egg 或 --framework hono,fastify,egg 指定时才运行
const EGG_FRAMEWORK = "egg";

// 所有支持的框架（含 egg）
const ALL_FRAMEWORKS = [...FRAMEWORKS, EGG_FRAMEWORK];

const SCENARIOS = [
  {
    name: "json",
    title: "JSON 响应",
    description: 'GET /json → { message: "Hello World" }',
    path: "/json",
  },
  {
    name: "params",
    title: "路由参数",
    description: 'GET /users/42 → { id: "42", name: "User 42" }',
    path: "/users/42",
  },
  {
    name: "chain",
    title: "处理器业务链",
    description: "GET /chain → 3 层 handler 内联业务逻辑 + JSON 响应",
    path: "/chain",
  },
  {
    name: "middleware-chain",
    title: "真实中间件链",
    description:
      "GET /middleware-chain → 3 层 route-level middleware + JSON 响应",
    path: "/middleware-chain",
  },
];

// 端口分配：避免冲突
const BASE_PORT_RAW = 19100;
const BASE_PORT_VEXT = 19200;
const BASE_PORT_EGG = 19300;

// ── CLI 参数解析 ──────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    duration: 15,
    connections: 50,
    pipelining: 10,
    warmup: 5,
    rounds: 1,
    scenario: "all",
    // The standard matrix is the five Vext adapters. Egg remains an explicit
    // independent baseline because it has no Vext adapter counterpart.
    frameworks: [...FRAMEWORKS],
    output: join(__dirname, "RESULTS.md"),
    resultsJson: undefined,
    fromResultsJson: [],
    requireCompleteMatrix: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--duration":
        opts.duration = parseInt(args[++i], 10);
        break;
      case "--connections":
        opts.connections = parseInt(args[++i], 10);
        break;
      case "--pipelining":
        opts.pipelining = parseInt(args[++i], 10);
        break;
      case "--warmup":
        opts.warmup = parseInt(args[++i], 10);
        break;
      case "--scenario":
        opts.scenario = args[++i];
        break;
      case "--rounds":
        opts.rounds = Math.max(1, parseInt(args[++i], 10));
        break;
      case "--framework":
        opts.frameworks = args[++i].split(",").map((s) => s.trim());
        break;
      case "--output":
        opts.output = args[++i];
        break;
      case "--results-json":
        opts.resultsJson = args[++i];
        break;
      case "--from-results-json":
        opts.fromResultsJson = args[++i]
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        break;
      case "--require-complete-matrix":
        opts.requireCompleteMatrix = true;
        break;
    }
  }

  return opts;
}

// ── 服务器管理 ────────────────────────────────────────────────

/**
 * 启动裸跑服务器（子进程模式）
 *
 * @param {string} framework  框架名称
 * @param {number} port       端口号
 * @returns {Promise<{process: import('child_process').ChildProcess, port: number}>}
 */
function startRawServer(framework, port) {
  // egg 使用特殊的启动方式（startCluster 多进程模型）
  if (framework === EGG_FRAMEWORK) {
    return startEggServer(port);
  }

  return new Promise((resolve, reject) => {
    const serverFile = join(__dirname, "servers", `raw-${framework}.mjs`);
    const child = fork(serverFile, [], {
      env: { ...process.env, PORT: String(port) },
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`[raw-${framework}] startup timeout (10s)`));
    }, 10_000);

    child.on("message", (msg) => {
      if (msg && msg.type === "ready") {
        clearTimeout(timeout);
        resolve({ process: child, port: msg.port || port });
      }
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0 && code !== null) {
        reject(new Error(`[raw-${framework}] exited with code ${code}`));
      }
    });

    // 收集 stderr 用于调试
    let stderr = "";
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }
  });
}

/**
 * 启动 egg.js 服务器（多进程模型 — master + agent + worker）
 *
 * egg 使用 startCluster API 启动，内部会 fork agent worker 和 app worker。
 * 与其他裸跑服务器的 fork+IPC 模式不同，egg 的 master 进程负责管理子进程，
 * start.js 脚本通过 startCluster 的 callback 通知就绪状态。
 *
 * 停止时需要 kill 整个进程树（master + agent + worker），
 * 通过 SIGTERM 发给 master，master 会优雅关闭所有子进程。
 *
 * @param {number} port 端口号
 * @returns {Promise<{process: import('child_process').ChildProcess, port: number}>}
 */
function startEggServer(port) {
  return new Promise((resolve, reject) => {
    const startFile = join(__dirname, "servers", "raw-egg", "start.js");
    const child = fork(startFile, [], {
      env: { ...process.env, PORT: String(port) },
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    // egg 启动较慢（master + agent + worker），给更长的超时
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`[raw-egg] startup timeout (20s)`));
    }, 20_000);

    child.on("message", (msg) => {
      if (msg && msg.type === "ready") {
        clearTimeout(timeout);
        resolve({ process: child, port: msg.port || port });
      }
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0 && code !== null) {
        reject(new Error(`[raw-egg] exited with code ${code}`));
      }
    });

    // 收集 stderr 用于调试
    let stderr = "";
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }
  });
}

/**
 * 启动 vext 封装服务器（子进程模式）
 *
 * 每个 vext 服务器在独立子进程中启动，避免同一进程中多次调用 bootstrap
 * 导致的环境变量覆盖、模块缓存、全局状态冲突等问题。
 *
 * @param {string} framework  框架名称（adapter）
 * @param {number} port       端口号
 * @returns {Promise<{process: import('child_process').ChildProcess, port: number, close: () => Promise<void>}>}
 */
function startVextServer(framework, port) {
  return new Promise((resolve, reject) => {
    const serverFile = join(__dirname, "servers", "vext-start.mjs");
    const child = fork(serverFile, [], {
      env: {
        ...process.env,
        PORT: String(port),
        BENCH_ADAPTER: framework,
      },
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`[vext-${framework}] startup timeout (15s)`));
    }, 15_000);

    child.on("message", (msg) => {
      if (msg && msg.type === "ready") {
        clearTimeout(timeout);
        resolve({
          process: child,
          port: msg.port || port,
          close: () => stopRawServer({ process: child }),
        });
      } else if (msg && msg.type === "error") {
        clearTimeout(timeout);
        reject(new Error(`[vext-${framework}] ${msg.message}`));
      }
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0 && code !== null) {
        reject(new Error(`[vext-${framework}] exited with code ${code}`));
      }
    });

    // 收集 stderr 用于调试
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        // 静默收集，不输出（避免干扰 benchmark 输出）
      });
    }
  });
}

/**
 * 停止裸跑服务器
 */
async function stopRawServer(server) {
  if (!server || !server.process) return;
  return new Promise((resolve) => {
    server.process.on("exit", () => resolve());
    server.process.kill("SIGTERM");
    // 兜底：3 秒后强制 kill
    setTimeout(() => {
      try {
        server.process.kill("SIGKILL");
      } catch {
        // 已退出
      }
      resolve();
    }, 3000);
  });
}

// ── 健康检查 ──────────────────────────────────────────────────

async function waitForHealthy(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return true;
    } catch {
      // 继续重试
    }
    await sleep(200);
  }
  throw new Error(
    `Server on port ${port} did not become healthy in ${timeoutMs}ms`,
  );
}

async function assertScenarioContract(port, scenario) {
  const response = await fetch(`http://127.0.0.1:${port}${scenario.path}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(
      `Scenario contract failed for ${scenario.name}: HTTP ${response.status}`,
    );
  }

  const body = await response.json();
  const expectedMessage =
    scenario.name === "json"
      ? "Hello World"
      : scenario.name === "params"
        ? undefined
        : scenario.name === "chain"
          ? "Chain complete"
          : "Middleware chain complete";

  if (scenario.name === "params") {
    if (body?.id !== "42" || body?.name !== "User 42") {
      throw new Error(
        `Scenario contract failed for ${scenario.name}: invalid body`,
      );
    }
  } else if (body?.message !== expectedMessage) {
    throw new Error(
      `Scenario contract failed for ${scenario.name}: invalid body`,
    );
  }

  if (scenario.name === "chain" || scenario.name === "middleware-chain") {
    const responseTime = response.headers.get("x-response-time");
    const requestId = response.headers.get("x-bench-request-id");
    if (!responseTime || !requestId) {
      throw new Error(
        `Scenario contract failed for ${scenario.name}: missing benchmark headers`,
      );
    }
  }
}

// ── autocannon 包装 ───────────────────────────────────────────

/**
 * 运行 autocannon 基准测试
 *
 * @param {Object} options
 * @param {number} options.port
 * @param {string} options.path
 * @param {number} options.duration
 * @param {number} options.connections
 * @param {number} options.pipelining
 * @returns {Promise<Object>} autocannon 结果
 */
function runAutocannon({ port, path, duration, connections, pipelining }) {
  return new Promise((resolve, reject) => {
    const url = `http://127.0.0.1:${port}${path}`;
    const autocannonArgs = [
      "exec",
      "--yes",
      `--package=autocannon@${AUTOCANNON_VERSION}`,
      "--",
      "autocannon",
      "--json",
      "--no-progress",
      "--duration",
      String(duration),
      "--connections",
      String(connections),
      "--pipelining",
      String(pipelining),
      url,
    ];
    const args =
      process.platform === "win32"
        ? ["/d", "/s", "/c", "npm", ...autocannonArgs]
        : autocannonArgs;
    const child = spawn(AUTOCANNON_COMMAND, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `autocannon CLI failed with code ${code}: ${stderr || stdout}`,
          ),
        );
        return;
      }

      try {
        const line = stdout.trim().split(/\r?\n/).at(-1);
        const result = JSON.parse(line);
        assertSuccessfulAutocannon(result, url);
        resolve(result);
      } catch (error) {
        reject(
          new Error(
            `Unable to parse autocannon JSON output: ${
              error instanceof Error ? error.message : String(error)
            }\n${stdout}\n${stderr}`,
          ),
        );
      }
    });
  });
}

/**
 * 预热服务器
 */
async function warmup(port, path, durationSec) {
  if (durationSec <= 0) return;
  await runAutocannon({
    port,
    path,
    duration: durationSec,
    connections: 10,
    pipelining: 1,
  });
}

// ── 工具函数 ──────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatNumber(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return "N/A";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatBytes(bytes) {
  if (typeof bytes !== "number" || Number.isNaN(bytes)) return "N/A";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function calcOverhead(rawRps, vextRps) {
  if (!rawRps || rawRps === 0) return "N/A";
  const overhead = ((rawRps - vextRps) / rawRps) * 100;
  return `${overhead.toFixed(2)}%`;
}

function overheadEmoji(rawRps, vextRps) {
  if (!rawRps || rawRps === 0) return "⚪";
  const overhead = ((rawRps - vextRps) / rawRps) * 100;
  if (overhead <= 5) return "✅";
  if (overhead <= 15) return "⚠️";
  return "❌";
}

// ── 结果收集 ──────────────────────────────────────────────────

/**
 * 从 autocannon 结果中提取关键指标
 */
function extractMetrics(result) {
  return {
    rps: result.requests?.average ?? 0,
    latencyP50: result.latency?.p50 ?? 0,
    latencyP99: result.latency?.p99 ?? 0,
    latencyAvg: result.latency?.average ?? 0,
    throughput: result.throughput?.average ?? 0,
    totalRequests: result.requests?.total ?? 0,
    errors: result.errors ?? 0,
    timeouts: result.timeouts ?? 0,
    non2xx: result.non2xx ?? 0,
  };
}

function assertSuccessfulAutocannon(result, target) {
  const errors = result.errors ?? 0;
  const timeouts = result.timeouts ?? 0;
  const non2xx = result.non2xx ?? 0;

  if (errors > 0 || timeouts > 0 || non2xx > 0) {
    throw new Error(
      `Benchmark request failure for ${target}: errors=${errors}, timeouts=${timeouts}, non2xx=${non2xx}`,
    );
  }
}

function hasValidMetrics(metrics) {
  return Boolean(
    metrics &&
    metrics.rps > 0 &&
    metrics.totalRequests > 0 &&
    metrics.errors === 0 &&
    metrics.timeouts === 0 &&
    metrics.non2xx === 0,
  );
}

// ── 多轮测试 + 中位数选择 ─────────────────────────────────────

/**
 * 多轮运行 autocannon，取中位数结果
 *
 * @param {Object} opts          压测参数
 * @param {number} opts.port
 * @param {string} opts.path
 * @param {number} opts.duration
 * @param {number} opts.connections
 * @param {number} opts.pipelining
 * @param {number} rounds        轮次数（1 = 单轮，≥3 取中位数有意义）
 * @returns {Promise<Object>}    中位数 metrics（附带 _stats 统计信息）
 */
async function runMultiRound(
  { port, path, duration, connections, pipelining },
  rounds,
) {
  if (rounds <= 1) {
    // 单轮模式 — 向后兼容
    const result = await runAutocannon({
      port,
      path,
      duration,
      connections,
      pipelining,
    });
    return extractMetrics(result);
  }

  const allMetrics = [];

  for (let round = 1; round <= rounds; round++) {
    // 轮间冷却（第一轮不需要）
    if (round > 1) {
      console.log(`        💤 冷却 2s...`);
      await sleep(2000);
      // 尝试手动 GC（需 --expose-gc 启动参数）
      if (global.gc) {
        global.gc();
      }
    }

    console.log(`        🔄 轮次 ${round}/${rounds}...`);

    const result = await runAutocannon({
      port,
      path,
      duration,
      connections,
      pipelining,
    });

    const metrics = extractMetrics(result);
    allMetrics.push(metrics);

    console.log(
      `        📊 RPS: ${formatNumber(metrics.rps)} | P50: ${metrics.latencyP50}ms | P99: ${metrics.latencyP99}ms`,
    );
  }

  return selectMedian(allMetrics);
}

/**
 * 从多轮 metrics 中选择 RPS 中位数对应的那一轮完整结果
 *
 * 中位数比平均值更抗干扰：极端异常值（如 Windows 噪声导致的 29K）
 * 不会影响中位数，但会严重拉低平均值。
 *
 * @param {Array<Object>} metricsArray  多轮 extractMetrics 结果
 * @returns {Object}  中位数轮次的 metrics + _stats 附加统计
 */
function selectMedian(metricsArray) {
  const sorted = [...metricsArray].sort((a, b) => a.rps - b.rps);
  const mid = Math.floor(sorted.length / 2);
  // 奇数轮取正中间；偶数轮取中间偏上（乐观侧）
  const median = { ...sorted[mid] };

  const rpsValues = metricsArray.map((m) => m.rps);
  const mean = rpsValues.reduce((s, v) => s + v, 0) / rpsValues.length;
  const stddev = calcStdDev(rpsValues);
  const cv = mean > 0 ? (stddev / mean) * 100 : 0;

  median._stats = {
    rounds: metricsArray.length,
    allRps: rpsValues,
    min: sorted[0].rps,
    max: sorted[sorted.length - 1].rps,
    mean: Math.round(mean),
    median: median.rps,
    stddev: Math.round(stddev),
    cv: `${cv.toFixed(1)}%`,
  };

  // 多轮时输出统计摘要
  console.log(
    `        📈 统计: median=${formatNumber(median.rps)} | mean=${formatNumber(median._stats.mean)} | min=${formatNumber(median._stats.min)} | max=${formatNumber(median._stats.max)} | CV=${median._stats.cv}`,
  );
  if (cv > 15) {
    console.log(
      `        ⚠️  CV > 15%: 数据波动较大，建议排查系统干扰或增加轮次`,
    );
  }

  return median;
}

/**
 * 计算标准差
 * @param {number[]} values
 * @returns {number}
 */
function calcStdDev(values) {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ── 报告生成 ──────────────────────────────────────────────────

function readGitValue(args) {
  try {
    return execFileSync("git", args, {
      cwd: REPOSITORY_ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function readGitBuffer(args) {
  try {
    return execFileSync("git", args, {
      cwd: REPOSITORY_ROOT,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function getSourceProvenance() {
  const commit = readGitValue(["rev-parse", "HEAD"]);
  const branch = readGitValue(["branch", "--show-current"]);
  const status = readGitValue(["status", "--porcelain=v1"]);

  return {
    branch: branch || "detached",
    commit: commit || "unavailable",
    worktree: status ? "dirty" : "clean",
    dirtyPatchSha256: getCandidatePatchSha256(status),
  };
}

function getCandidatePatchSha256(status) {
  if (!status) return null;

  // RESULTS.md is generated by this runner. Excluding it prevents the report
  // timestamp/content from changing the identity of the candidate it records.
  const trackedPatch = readGitBuffer([
    "diff",
    "--binary",
    "HEAD",
    "--",
    ".",
    GENERATED_REPORT_PATHSPEC,
  ]);
  const untrackedFiles = readGitBuffer([
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ".",
    GENERATED_REPORT_PATHSPEC,
  ]);
  const hash = createHash("sha256");
  let hasCandidateDiff = false;

  if (trackedPatch && trackedPatch.length > 0) {
    hash.update("tracked-diff\0");
    hash.update(trackedPatch);
    hasCandidateDiff = true;
  }

  for (const file of (untrackedFiles ?? Buffer.alloc(0))
    .toString("utf-8")
    .split("\0")
    .filter(Boolean)
    .sort()) {
    try {
      hash.update(`untracked:${file}\0`);
      hash.update(readFileSync(resolve(REPOSITORY_ROOT, file)));
      hasCandidateDiff = true;
    } catch {
      // A concurrently removed untracked file must not make the runner claim
      // a complete artifact; the caller will retain the dirty worktree state.
      return null;
    }
  }

  return hasCandidateDiff ? hash.digest("hex") : null;
}

function formatCandidatePatchSha256(value) {
  return value ?? "无非生成候选差异";
}

function getBenchmarkEnvironment(os) {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: os.cpus()[0]?.model ?? "Unknown",
    totalMemoryBytes: os.totalmem(),
  };
}

function createResultArtifact(
  opts,
  provenance,
  environment,
  allResults,
  complete,
) {
  return {
    schemaVersion: 2,
    complete,
    provenance,
    environment,
    options: {
      duration: opts.duration,
      connections: opts.connections,
      pipelining: opts.pipelining,
      warmup: opts.warmup,
      rounds: opts.rounds,
      scenario: opts.scenario,
      frameworks: opts.frameworks,
    },
    allResults,
  };
}

function hasSameProtocol(left, right) {
  return (
    left.duration === right.duration &&
    left.connections === right.connections &&
    left.pipelining === right.pipelining &&
    left.warmup === right.warmup &&
    left.rounds === right.rounds
  );
}

function hasSameEnvironment(left, right) {
  return (
    left.node === right.node &&
    left.platform === right.platform &&
    left.arch === right.arch &&
    left.cpuModel === right.cpuModel
  );
}

function hasSameProvenance(left, right) {
  return (
    left.commit === right.commit &&
    left.worktree === right.worktree &&
    left.dirtyPatchSha256 === right.dirtyPatchSha256
  );
}

function hasValidArtifactResult(result) {
  if (!hasValidMetrics(result?.raw)) return false;
  if (result.framework === EGG_FRAMEWORK) return result.vext == null;
  return hasValidMetrics(result?.vext);
}

async function loadMergedResults(paths, output, requireCompleteMatrix) {
  if (paths.length === 0) {
    throw new Error("--from-results-json requires at least one JSON artifact.");
  }

  const artifacts = await Promise.all(
    paths.map(async (path) => {
      const raw = await readFile(path, "utf-8");
      return { path, value: JSON.parse(raw) };
    }),
  );
  const first = artifacts[0].value;
  if (
    first?.schemaVersion !== 2 ||
    !first.complete ||
    !first.options ||
    !first.provenance ||
    !first.environment ||
    !Array.isArray(first.allResults)
  ) {
    throw new Error(
      `Invalid or incomplete benchmark artifact: ${artifacts[0].path}`,
    );
  }

  const seen = new Set();
  const allResults = [];
  const frameworks = [];
  for (const { path, value } of artifacts) {
    if (
      value?.schemaVersion !== 2 ||
      !value.complete ||
      !value.options ||
      !value.provenance ||
      !value.environment ||
      !Array.isArray(value.allResults)
    ) {
      throw new Error(`Invalid or incomplete benchmark artifact: ${path}`);
    }
    if (!hasSameProtocol(first.options, value.options)) {
      throw new Error(`Benchmark protocol mismatch in artifact: ${path}`);
    }
    if (!hasSameProvenance(first.provenance, value.provenance)) {
      throw new Error(
        `Benchmark source provenance mismatch in artifact: ${path}`,
      );
    }
    if (!hasSameEnvironment(first.environment, value.environment)) {
      throw new Error(`Benchmark environment mismatch in artifact: ${path}`);
    }
    for (const framework of value.options.frameworks) {
      if (!frameworks.includes(framework)) frameworks.push(framework);
    }
    for (const result of value.allResults) {
      if (!hasValidArtifactResult(result)) {
        throw new Error(`Invalid benchmark metrics in artifact: ${path}`);
      }
      const key = `${result.framework}:${result.scenario}`;
      if (seen.has(key)) {
        throw new Error(`Duplicate benchmark result while merging: ${key}`);
      }
      seen.add(key);
      allResults.push(result);
    }
  }

  const mergedScenarios = [
    ...new Set(allResults.map((result) => result.scenario)),
  ];

  if (requireCompleteMatrix) {
    const expected = new Set(
      FRAMEWORKS.flatMap((framework) =>
        SCENARIOS.map((scenario) => `${framework}:${scenario.name}`),
      ),
    );
    const missing = [...expected].filter((key) => !seen.has(key));
    const unexpected = [...seen].filter((key) => !expected.has(key));

    if (missing.length > 0 || unexpected.length > 0) {
      throw new Error(
        `Incomplete benchmark matrix: missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}`,
      );
    }
  }

  return {
    allResults,
    opts: {
      ...first.options,
      frameworks,
      scenario: mergedScenarios.length === 1 ? mergedScenarios[0] : "all",
      output,
    },
    provenance: first.provenance,
    environment: first.environment,
  };
}

// ── 主流程 ────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const os = await import("node:os");
  const environment = getBenchmarkEnvironment(os);

  if (opts.fromResultsJson.length > 0) {
    const merged = await loadMergedResults(
      opts.fromResultsJson,
      opts.output,
      opts.requireCompleteMatrix,
    );
    const report = generateReport(
      merged.allResults,
      merged.opts,
      merged.environment,
      merged.provenance,
    );
    console.log(report);
    await writeFile(opts.output, report, "utf-8");
    console.log(`\n✅ 合并报告已保存到: ${opts.output}`);
    return;
  }

  const provenance = getSourceProvenance();

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║           vext 性能基准测试 (Benchmark Suite)           ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log();
  console.log(`  Node.js:      ${environment.node}`);
  console.log(`  平台:         ${environment.platform} ${environment.arch}`);
  console.log(`  CPU:          ${environment.cpuModel}`);
  console.log(
    `  源码:         ${provenance.branch}@${provenance.commit} (${provenance.worktree})`,
  );
  console.log(`  持续时间:     ${opts.duration}s`);
  console.log(`  并发连接:     ${opts.connections}`);
  console.log(`  流水线:       ${opts.pipelining}`);
  console.log(`  预热:         ${opts.warmup}s`);
  console.log(
    `  轮次:         ${opts.rounds}${opts.rounds > 1 ? " (取中位数)" : " (单轮)"}`,
  );
  console.log(`  框架:         ${opts.frameworks.join(", ")}`);
  console.log(
    `  场景:         ${opts.scenario === "all" ? SCENARIOS.map((s) => s.name).join(", ") : opts.scenario}`,
  );
  console.log();

  const activeScenarios =
    opts.scenario === "all"
      ? SCENARIOS
      : SCENARIOS.filter((s) => s.name === opts.scenario);

  if (activeScenarios.length === 0) {
    console.error(`❌ 未知场景: ${opts.scenario}`);
    console.error(`   可选值: ${SCENARIOS.map((s) => s.name).join(", ")}, all`);
    process.exit(1);
  }

  const allResults = [];
  let hadBenchmarkFailure = false;
  let portOffset = 0;

  for (const framework of opts.frameworks) {
    if (!ALL_FRAMEWORKS.includes(framework)) {
      console.warn(`⚠️ 跳过未知框架: ${framework}`);
      continue;
    }

    // egg 是独立对比项，没有 vext adapter，只跑裸跑测试
    const isEgg = framework === EGG_FRAMEWORK;

    console.log(`\n${"─".repeat(60)}`);
    console.log(`  框架: ${framework.toUpperCase()}`);
    console.log(`${"─".repeat(60)}`);

    for (const scenario of activeScenarios) {
      console.log(`\n  📋 场景: ${scenario.title} (${scenario.description})`);

      // ── 裸跑测试 ──────────────────────────────────────
      const rawPort = isEgg
        ? BASE_PORT_EGG + portOffset
        : BASE_PORT_RAW + portOffset;
      portOffset++;
      let rawServer = null;
      let rawMetrics = null;

      try {
        console.log(
          `     🔧 启动裸跑服务器 [raw-${framework}] 端口 ${rawPort}...`,
        );
        rawServer = await startRawServer(framework, rawPort);
        // egg 启动较慢（多进程模型），给更长的健康检查超时
        await waitForHealthy(rawPort, isEgg ? 15_000 : 5000);
        await assertScenarioContract(rawPort, scenario);
        console.log(`     ✅ 裸跑服务器就绪`);

        // 预热
        if (opts.warmup > 0) {
          console.log(`     🔥 预热中 (${opts.warmup}s)...`);
          await warmup(rawPort, scenario.path, opts.warmup);
        }

        // 压测（支持多轮取中位数）
        console.log(
          `     🚀 压测中 (${opts.duration}s × ${opts.rounds} 轮, ${opts.connections} connections)...`,
        );
        rawMetrics = await runMultiRound(
          {
            port: rawPort,
            path: scenario.path,
            duration: opts.duration,
            connections: opts.connections,
            pipelining: opts.pipelining,
          },
          opts.rounds,
        );
        console.log(
          `     📊 Raw RPS: ${formatNumber(rawMetrics.rps)} | P50: ${rawMetrics.latencyP50}ms | P99: ${rawMetrics.latencyP99}ms`,
        );
      } catch (err) {
        hadBenchmarkFailure = true;
        console.error(`     ❌ 裸跑测试失败: ${err.message}`);
      } finally {
        await stopRawServer(rawServer);
        await sleep(500); // 等待端口释放
      }

      // ── vext 封装测试（egg 跳过，因为没有 vext egg adapter）───
      let vextMetrics = null;

      if (!isEgg) {
        const vextPort = BASE_PORT_VEXT + portOffset;
        portOffset++;
        let vextServer = null;

        try {
          console.log(
            `     🔧 启动 vext 服务器 [vext-${framework}] 端口 ${vextPort}...`,
          );
          vextServer = await startVextServer(framework, vextPort);
          await waitForHealthy(vextServer.port, 10_000);
          await assertScenarioContract(vextServer.port, scenario);
          console.log(`     ✅ vext 服务器就绪`);

          // 预热
          if (opts.warmup > 0) {
            console.log(`     🔥 预热中 (${opts.warmup}s)...`);
            await warmup(vextServer.port, scenario.path, opts.warmup);
          }

          // 压测（支持多轮取中位数）
          console.log(
            `     🚀 压测中 (${opts.duration}s × ${opts.rounds} 轮, ${opts.connections} connections)...`,
          );
          vextMetrics = await runMultiRound(
            {
              port: vextServer.port,
              path: scenario.path,
              duration: opts.duration,
              connections: opts.connections,
              pipelining: opts.pipelining,
            },
            opts.rounds,
          );
          console.log(
            `     📊 Vext RPS: ${formatNumber(vextMetrics.rps)} | P50: ${vextMetrics.latencyP50}ms | P99: ${vextMetrics.latencyP99}ms`,
          );

          // Overhead 计算
          if (rawMetrics && rawMetrics.rps > 0) {
            const overhead =
              ((rawMetrics.rps - vextMetrics.rps) / rawMetrics.rps) * 100;
            const emoji = overhead <= 5 ? "✅" : overhead <= 15 ? "⚠️" : "❌";
            console.log(`     📈 Overhead: ${overhead.toFixed(2)}% ${emoji}`);
          }
        } catch (err) {
          hadBenchmarkFailure = true;
          console.error(`     ❌ vext 测试失败: ${err.message}`);
        } finally {
          await stopRawServer(vextServer);
          await sleep(500);
        }
      } else {
        console.log(`     ⏭️  跳过 vext 封装测试（egg 无 vext adapter）`);
      }

      // 收集结果
      allResults.push({
        framework,
        scenario: scenario.name,
        raw: rawMetrics,
        vext: vextMetrics,
      });
    }
  }

  // ── 生成报告 ────────────────────────────────────────────

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  📝 生成报告...`);
  console.log(`${"═".repeat(60)}\n`);

  const report = generateReport(allResults, opts, environment, provenance);

  // 输出到控制台
  console.log(report);

  // 写入文件
  try {
    await writeFile(opts.output, report, "utf-8");
    console.log(`\n✅ 报告已保存到: ${opts.output}`);
  } catch (err) {
    console.error(`\n⚠️ 报告保存失败: ${err.message}`);
  }

  if (opts.resultsJson) {
    const artifact = createResultArtifact(
      opts,
      provenance,
      environment,
      allResults,
      !hadBenchmarkFailure,
    );
    await writeFile(
      opts.resultsJson,
      `${JSON.stringify(artifact, null, 2)}\n`,
      "utf-8",
    );
    console.log(`✅ 原始样本已保存到: ${opts.resultsJson}`);
  }

  if (hadBenchmarkFailure) {
    throw new Error(
      "One or more benchmark runs failed; report contains partial results.",
    );
  }
}

/**
 * 生成 Markdown 报告
 */
function generateReport(allResults, opts, environment, provenance) {
  const { cpuModel, totalMemoryBytes } = environment;

  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const timeStr = now.toISOString().split("T")[1].substring(0, 8);

  let md = "";

  // ── 头部 ────────────────────────────────────────────────
  md += `# vext 性能基准测试报告\n\n`;
  md += `> **日期（UTC）**: ${dateStr} ${timeStr}\n`;
  md += `> **源码**: ${provenance.branch}@${provenance.commit}（worktree: ${provenance.worktree}）\n`;
  md += `> **候选差异 SHA-256**: ${formatCandidatePatchSha256(provenance.dirtyPatchSha256)}（不含自动生成的 \`RESULTS.md\`；包含未跟踪候选文件）\n`;
  md += `> **Runner**: \`test/benchmark/run-benchmark.mjs\`\n`;
  md += `> **Autocannon**: v${AUTOCANNON_VERSION}\n`;
  md += `> **Node.js**: ${environment.node}\n`;
  md += `> **平台**: ${environment.platform} ${environment.arch}\n`;
  md += `> **参数**: frameworks=${opts.frameworks.join(",")}, scenario=${opts.scenario}, duration=${opts.duration}s, connections=${opts.connections}, pipelining=${opts.pipelining}, warmup=${opts.warmup}s, rounds=${opts.rounds}${opts.rounds > 1 ? " (取中位数)" : ""}\n\n`;
  md += `---\n\n`;

  md += `## Benchmark 口径说明\n\n`;
  md += `- 当前 adapter matrix app 默认禁用 requestId、cors、bodyParser、rateLimit、accessLog、response wrapper 与 requestContext；它仍经过正式 bootstrap 的 authContext、requestHook 和标准路由生命周期，因此不是 Vext Native Core。\n`;
  md += `- 如需 Raw Native / Raw Fastify / Vext Native Core / Vext Native Normal 的可审计主对照，请运行 \`test/benchmark/run-native-fairness.mjs\`。\n`;
  md += `- \`chain\` 是历史兼容场景，表示 handler 内联业务逻辑链，不代表真实 vext middleware chain。\n`;
  md += `- \`middleware-chain\` 才表示 route-level middleware chain，会进入 adapter 的中间件链执行器。\n`;
  md += `- 本报告不等同于默认 runtime 配置性能；如需默认配置性能，应单独增加 default-runtime benchmark。\n`;
  md += `- **可比性限制**：只比较相同源码身份、Node.js、OS/CPU、参数、场景和缓存/系统负载条件下的报告。不同机器或不同协议的数值不能直接作为性能回归结论。\n\n`;

  // ── 总结表格 ────────────────────────────────────────────
  md += `## 📊 总结\n\n`;
  md += `| 框架 | 场景 | Raw RPS | Vext RPS | Overhead | 状态 |\n`;
  md += `|------|------|--------:|---------:|---------:|:----:|\n`;

  for (const r of allResults) {
    const rawRps = r.raw?.rps ?? 0;
    const vextRps = r.vext?.rps ?? 0;
    const isEggResult = r.framework === EGG_FRAMEWORK;
    const overhead = isEggResult ? "—" : calcOverhead(rawRps, vextRps);
    const emoji = isEggResult ? "🥚" : overheadEmoji(rawRps, vextRps);
    const vextRpsStr = isEggResult ? "—" : formatNumber(vextRps);
    md += `| ${r.framework} | ${r.scenario} | ${formatNumber(rawRps)} | ${vextRpsStr} | ${overhead} | ${emoji} |\n`;
  }

  md += `\n`;

  // ── 逐场景详细结果 ──────────────────────────────────────
  const scenarios = [...new Set(allResults.map((r) => r.scenario))];

  for (const scenario of scenarios) {
    const scenarioInfo = SCENARIOS.find((s) => s.name === scenario);
    const scenarioResults = allResults.filter((r) => r.scenario === scenario);

    md += `## ${scenarioInfo?.title ?? scenario}\n\n`;
    md += `> ${scenarioInfo?.description ?? ""}\n\n`;

    md += `| 框架 | 模式 | RPS | Latency P50 | Latency P99 | Latency Avg | Throughput/s | 总请求 | 错误 |\n`;
    md += `|------|------|----:|------------:|------------:|------------:|-------------:|-------:|-----:|\n`;

    for (const r of scenarioResults) {
      if (r.raw) {
        const mode = r.framework === EGG_FRAMEWORK ? "Egg" : "Raw";
        md += `| ${r.framework} | ${mode} | ${formatNumber(r.raw.rps)} | ${r.raw.latencyP50}ms | ${r.raw.latencyP99}ms | ${r.raw.latencyAvg}ms | ${formatBytes(r.raw.throughput)} | ${formatNumber(r.raw.totalRequests)} | ${r.raw.errors + r.raw.non2xx} |\n`;
      }
      if (r.vext) {
        md += `| ${r.framework} | Vext | ${formatNumber(r.vext.rps)} | ${r.vext.latencyP50}ms | ${r.vext.latencyP99}ms | ${r.vext.latencyAvg}ms | ${formatBytes(r.vext.throughput)} | ${formatNumber(r.vext.totalRequests)} | ${r.vext.errors + r.vext.non2xx} |\n`;
      }
    }

    md += `\n`;
  }

  // ── 框架间对比 ──────────────────────────────────────────
  md += `## 🏆 框架间对比（Raw RPS 排名）\n\n`;

  for (const scenario of scenarios) {
    const scenarioInfo = SCENARIOS.find((s) => s.name === scenario);
    const scenarioResults = allResults
      .filter((r) => r.scenario === scenario && r.raw)
      .sort((a, b) => (b.raw?.rps ?? 0) - (a.raw?.rps ?? 0));

    md += `### ${scenarioInfo?.title ?? scenario}\n\n`;
    md += `| 排名 | 框架 | Raw RPS | Vext RPS | Overhead |\n`;
    md += `|:----:|------|--------:|---------:|---------:|\n`;

    const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];
    scenarioResults.forEach((r, i) => {
      const rawRps = r.raw?.rps ?? 0;
      const vextRps = r.vext?.rps ?? 0;
      const isEggResult = r.framework === EGG_FRAMEWORK;
      const overhead = isEggResult ? "—" : calcOverhead(rawRps, vextRps);
      const vextRpsStr = isEggResult ? "—" : formatNumber(vextRps);
      md += `| ${medals[i] ?? i + 1} | ${r.framework} | ${formatNumber(rawRps)} | ${vextRpsStr} | ${overhead} |\n`;
    });

    md += `\n`;
  }

  // ── Overhead 分析 ───────────────────────────────────────
  md += `## 📈 Overhead 分析\n\n`;

  const overheads = allResults
    .filter((r) => r.raw && r.vext && r.framework !== EGG_FRAMEWORK)
    .map((r) => {
      const rawRps = r.raw.rps;
      const vextRps = r.vext.rps;
      return rawRps > 0 ? ((rawRps - vextRps) / rawRps) * 100 : 0;
    });

  if (overheads.length > 0) {
    const avgOverhead = overheads.reduce((a, b) => a + b, 0) / overheads.length;
    const maxOverhead = Math.max(...overheads);
    const minOverhead = Math.min(...overheads);

    md += `- **平均 Overhead**: ${avgOverhead.toFixed(2)}%\n`;
    md += `- **最大 Overhead**: ${maxOverhead.toFixed(2)}%\n`;
    md += `- **最小 Overhead**: ${minOverhead.toFixed(2)}%\n`;
    md += `- **目标**: < 5%\n`;
    md += `- **结论**: ${avgOverhead <= 5 ? "✅ 达标 — vext 框架开销在可接受范围内" : avgOverhead <= 15 ? "⚠️ 基本达标 — 部分场景需优化" : "❌ 未达标 — 需要性能优化"}\n`;

    // ── egg vs vext 对比（如果有 egg 数据）──────────────────
    const eggResults = allResults.filter(
      (r) => r.framework === EGG_FRAMEWORK && r.raw,
    );
    if (eggResults.length > 0) {
      md += `\n## 🥚 egg.js vs vext 对比\n\n`;
      md += `> egg.js 是基于 Koa 的企业级框架（多进程模型：master + agent + worker）\n`;
      md += `> 以下对比 egg 裸跑 RPS 与 vext 各 adapter 的 Vext RPS\n\n`;
      md += `| 场景 | egg RPS | vext-fastify RPS | vext-koa RPS | vext-hono RPS | vext-express RPS |\n`;
      md += `|------|--------:|-----------------:|-------------:|--------------:|-----------------:|\n`;

      const scenarios = [...new Set(eggResults.map((r) => r.scenario))];
      for (const scenario of scenarios) {
        const eggRps =
          eggResults.find((r) => r.scenario === scenario)?.raw?.rps ?? 0;

        const getVextRps = (fw) => {
          const r = allResults.find(
            (r) => r.framework === fw && r.scenario === scenario,
          );
          return r?.vext?.rps ?? 0;
        };

        md += `| ${scenario} | ${formatNumber(eggRps)} | ${formatNumber(getVextRps("fastify"))} | ${formatNumber(getVextRps("koa"))} | ${formatNumber(getVextRps("hono"))} | ${formatNumber(getVextRps("express"))} |\n`;
      }

      md += `\n`;
    }
  }

  md += `\n`;

  // ── 多轮统计详情（仅 rounds > 1 时生成）─────────────────
  if (opts.rounds > 1) {
    const hasStats = allResults.some((r) => r.raw?._stats || r.vext?._stats);
    if (hasStats) {
      md += `## 📈 多轮测试统计\n\n`;
      md += `> 每项测试运行 ${opts.rounds} 轮，取 RPS 中位数作为最终结果\n\n`;
      md += `| 框架 | 模式 | 场景 | 各轮 RPS | 中位数 | 平均值 | 最小值 | 最大值 | 标准差 | CV |\n`;
      md += `|------|------|------|----------|-------:|-------:|-------:|-------:|-------:|----:|\n`;

      for (const r of allResults) {
        if (r.raw?._stats) {
          const s = r.raw._stats;
          const mode = r.framework === EGG_FRAMEWORK ? "Egg" : "Raw";
          md += `| ${r.framework} | ${mode} | ${r.scenario} | ${s.allRps.map((v) => formatNumber(v)).join(", ")} | ${formatNumber(s.median)} | ${formatNumber(s.mean)} | ${formatNumber(s.min)} | ${formatNumber(s.max)} | ${formatNumber(s.stddev)} | ${s.cv} |\n`;
        }
        if (r.vext?._stats) {
          const s = r.vext._stats;
          md += `| ${r.framework} | Vext | ${r.scenario} | ${s.allRps.map((v) => formatNumber(v)).join(", ")} | ${formatNumber(s.median)} | ${formatNumber(s.mean)} | ${formatNumber(s.min)} | ${formatNumber(s.max)} | ${formatNumber(s.stddev)} | ${s.cv} |\n`;
        }
      }

      md += `\n`;

      // CV 告警
      const highCvItems = [];
      for (const r of allResults) {
        if (r.raw?._stats && parseFloat(r.raw._stats.cv) > 15) {
          highCvItems.push(
            `${r.framework} Raw ${r.scenario} (CV=${r.raw._stats.cv})`,
          );
        }
        if (r.vext?._stats && parseFloat(r.vext._stats.cv) > 15) {
          highCvItems.push(
            `${r.framework} Vext ${r.scenario} (CV=${r.vext._stats.cv})`,
          );
        }
      }
      if (highCvItems.length > 0) {
        md += `> ⚠️ **高波动警告** (CV > 15%): ${highCvItems.join(", ")}\n`;
        md += `> 建议：排查系统后台干扰（Windows Defender / Update / Search）或增加轮次\n\n`;
      }
    }
  }

  // ── 测试环境 ────────────────────────────────────────────
  md += `## 🖥️ 测试环境\n\n`;
  md += `| 项目 | 值 |\n`;
  md += `|------|----|\n`;
  md += `| 源码 | ${provenance.branch}@${provenance.commit} (${provenance.worktree}) |\n`;
  md += `| 候选差异 SHA-256 | ${formatCandidatePatchSha256(provenance.dirtyPatchSha256)}（不含自动生成的 \`RESULTS.md\`；包含未跟踪候选文件） |\n`;
  md += `| Runner | test/benchmark/run-benchmark.mjs |\n`;
  md += `| Node.js | ${environment.node} |\n`;
  md += `| 平台 | ${environment.platform} ${environment.arch} |\n`;
  md += `| CPU | ${cpuModel} |\n`;
  md += `| 内存 | ${formatBytes(totalMemoryBytes)} |\n`;
  md += `| 压测工具 | autocannon v${AUTOCANNON_VERSION} |\n`;
  md += `| 框架 | ${opts.frameworks.join(", ")} |\n`;
  md += `| 场景 | ${opts.scenario} |\n`;
  md += `| 持续时间 | ${opts.duration}s |\n`;
  md += `| 并发连接 | ${opts.connections} |\n`;
  md += `| 流水线 | ${opts.pipelining} |\n`;
  md += `| 预热时间 | ${opts.warmup}s |\n`;
  md += `| 轮次 | ${opts.rounds}${opts.rounds > 1 ? " (取中位数)" : ""} |\n`;

  md += `\n---\n\n`;
  md += `> 本报告由 \`test/benchmark/run-benchmark.mjs\` 自动生成\n`;

  return md;
}

// ── 入口 ──────────────────────────────────────────────────────
main().catch((err) => {
  console.error("❌ 基准测试失败:", err);
  process.exit(1);
});
