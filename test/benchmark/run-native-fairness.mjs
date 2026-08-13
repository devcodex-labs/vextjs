/**
 * Canonical Raw Native / Raw Fastify / Vext Native fairness benchmark.
 *
 * The runner deliberately separates a private Vext Native Core harness from
 * Normal bootstrap + router-loader. It rejects output when IPC telemetry says
 * the expected chain composition is absent.
 */

import { execFileSync, fork, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPOSITORY_ROOT = resolve(__dirname, "../..");
const AUTOCANNON_VERSION = "8.0.0";
const GENERATED_REPORT_PATHSPEC = ":(exclude)test/benchmark/RESULTS.md";
const AUTOCANNON_COMMAND = process.platform === "win32" ? "cmd.exe" : "npm";

const SCENARIOS = [
  { name: "json", title: "JSON 响应", path: "/json" },
  { name: "params", title: "路由参数", path: "/users/42" },
  { name: "chain", title: "处理器业务链", path: "/chain" },
  {
    name: "middleware-chain",
    title: "真实中间件链",
    path: "/middleware-chain",
    core: false,
  },
];

const TARGETS = [
  { id: "raw-native", title: "Raw Native" },
  { id: "raw-fastify", title: "Raw Fastify" },
  { id: "vext-native-core", title: "Vext Native Core", mode: "core" },
  { id: "vext-native-normal", title: "Vext Native Normal", mode: "normal" },
];

function parseArgs() {
  const options = {
    duration: 10,
    connections: 50,
    pipelining: 10,
    warmup: 5,
    rounds: 5,
    scenario: "all",
    output: join(__dirname, "RESULTS.md"),
    resultsJson: undefined,
  };
  const args = process.argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    const next = () => args[++index];
    switch (args[index]) {
      case "--duration":
        options.duration = Number.parseInt(next(), 10);
        break;
      case "--connections":
        options.connections = Number.parseInt(next(), 10);
        break;
      case "--pipelining":
        options.pipelining = Number.parseInt(next(), 10);
        break;
      case "--warmup":
        options.warmup = Number.parseInt(next(), 10);
        break;
      case "--rounds":
        options.rounds = Math.max(1, Number.parseInt(next(), 10));
        break;
      case "--scenario":
        options.scenario = next();
        break;
      case "--output":
        options.output = next();
        break;
      case "--results-json":
        options.resultsJson = next();
        break;
      default:
        throw new Error(`Unknown option: ${args[index]}`);
    }
  }

  for (const key of [
    "duration",
    "connections",
    "pipelining",
    "warmup",
    "rounds",
  ]) {
    if (!Number.isFinite(options[key]) || options[key] < 0) {
      throw new Error(`Invalid --${key}: ${options[key]}`);
    }
  }
  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatNumber(value) {
  return typeof value === "number"
    ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "—";
}

function formatPercent(value) {
  return typeof value === "number" ? `${value.toFixed(2)}%` : "—";
}

function stddev(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function metricsFromAutocannon(result) {
  const errors = result.errors ?? 0;
  const timeouts = result.timeouts ?? 0;
  const non2xx = result.non2xx ?? 0;
  if (errors > 0 || timeouts > 0 || non2xx > 0) {
    throw new Error(
      `Autocannon reported errors=${errors}, timeouts=${timeouts}, non2xx=${non2xx}`,
    );
  }
  return {
    rps: result.requests?.average ?? 0,
    latencyP50: result.latency?.p50 ?? 0,
    latencyP99: result.latency?.p99 ?? 0,
    latencyAvg: result.latency?.average ?? 0,
    throughput: result.throughput?.average ?? 0,
    totalRequests: result.requests?.total ?? 0,
    errors,
    timeouts,
    non2xx,
  };
}

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
      cwd: REPOSITORY_ROOT,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`autocannon failed (${code}): ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim().split(/\r?\n/).at(-1)));
      } catch (error) {
        reject(
          new Error(
            `Unable to parse autocannon JSON: ${error instanceof Error ? error.message : error}\n${stdout}\n${stderr}`,
          ),
        );
      }
    });
  });
}

async function runRounds(port, scenario, options) {
  const samples = [];
  for (let round = 1; round <= options.rounds; round += 1) {
    if (round > 1) {
      await sleep(2000);
      global.gc?.();
    }
    console.log(`      round ${round}/${options.rounds}`);
    samples.push(
      metricsFromAutocannon(
        await runAutocannon({
          port,
          path: scenario.path,
          duration: options.duration,
          connections: options.connections,
          pipelining: options.pipelining,
        }),
      ),
    );
  }
  const ordered = [...samples].sort((left, right) => left.rps - right.rps);
  const median = { ...ordered[Math.floor(ordered.length / 2)] };
  const rps = samples.map((sample) => sample.rps);
  const mean = rps.reduce((sum, value) => sum + value, 0) / rps.length;
  median.stats = {
    samples: rps,
    min: ordered[0].rps,
    max: ordered.at(-1).rps,
    mean,
    median: median.rps,
    stddev: stddev(rps),
    cv: mean === 0 ? 0 : (stddev(rps) / mean) * 100,
  };
  return median;
}

async function waitForHealthy(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {
      // Retry until the explicit deadline.
    }
    await sleep(150);
  }
  throw new Error(`Server on ${port} did not become healthy in ${timeoutMs}ms`);
}

async function assertScenarioContract(port, scenario) {
  const response = await fetch(`http://127.0.0.1:${port}${scenario.path}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok)
    throw new Error(`${scenario.name} returned ${response.status}`);
  const body = await response.json();
  if (scenario.name === "json" && body?.message !== "Hello World") {
    throw new Error("json contract body mismatch");
  }
  if (
    scenario.name === "params" &&
    (body?.id !== "42" || body?.name !== "User 42")
  ) {
    throw new Error("params contract body mismatch");
  }
  if (
    scenario.name === "chain" &&
    (body?.message !== "Chain complete" ||
      !response.headers.get("x-response-time") ||
      !response.headers.get("x-bench-request-id"))
  ) {
    throw new Error("chain contract mismatch");
  }
  if (
    scenario.name === "middleware-chain" &&
    (body?.message !== "Middleware chain complete" ||
      !response.headers.get("x-response-time") ||
      !response.headers.get("x-bench-request-id"))
  ) {
    throw new Error("middleware-chain contract mismatch");
  }
}

function stopServer(server) {
  if (!server?.process) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        server.process.kill("SIGKILL");
      } catch {
        // The runner only owns this child process.
      }
      resolve();
    }, 3000);
    server.process.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    server.process.kill("SIGTERM");
  });
}

function startTarget(target, port) {
  const serverFile = target.id.startsWith("raw-")
    ? join(__dirname, "servers", `${target.id}.mjs`)
    : join(__dirname, "servers", "vext-start.mjs");
  const env = { ...process.env, PORT: String(port) };
  if (target.mode) {
    env.BENCH_ADAPTER = "native";
    env.VEXT_BENCH_MODE = target.mode;
  }

  return new Promise((resolve, reject) => {
    const child = fork(serverFile, [], {
      env,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${target.title} startup timed out: ${stderr}`));
    }, 15000);
    child.on("message", (message) => {
      if (message?.type === "ready") {
        clearTimeout(timer);
        resolve({
          process: child,
          port: message.port || port,
          telemetry: message.telemetry,
        });
      }
      if (message?.type === "error") {
        clearTimeout(timer);
        reject(new Error(`${target.title} startup failed: ${message.message}`));
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      if (code && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`${target.title} exited ${code}: ${stderr}`));
      }
    });
  });
}

function routeKeyForScenario(scenario) {
  return scenario.name === "params" ? "GET /users/:id" : `GET ${scenario.path}`;
}

function assertVextTelemetry(target, scenario, telemetry) {
  if (!telemetry || telemetry.mode !== target.mode) {
    throw new Error(`${target.title} did not return valid telemetry`);
  }
  const routeLength =
    telemetry.routeChainLengths?.[routeKeyForScenario(scenario)];
  if (target.mode === "core") {
    if (telemetry.globalMiddlewareCount !== 0 || routeLength !== 1) {
      throw new Error(
        `Core telemetry mismatch: globals=${telemetry.globalMiddlewareCount}, route=${routeLength}`,
      );
    }
    return;
  }
  const expectedRouteLength = scenario.name === "middleware-chain" ? 5 : 2;
  if (
    telemetry.globalMiddlewareCount !== 2 ||
    routeLength !== expectedRouteLength
  ) {
    throw new Error(
      `Normal telemetry mismatch: globals=${telemetry.globalMiddlewareCount}, route=${routeLength}, expected=${expectedRouteLength}`,
    );
  }
}

function readGitValue(args) {
  try {
    return execFileSync("git", args, {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unavailable";
  }
}

function candidatePatchSha256() {
  const status = readGitValue(["status", "--porcelain=v1"]);
  if (!status || status === "unavailable") return null;
  const hash = createHash("sha256");
  const tracked = execFileSync(
    "git",
    ["diff", "--binary", "HEAD", "--", ".", GENERATED_REPORT_PATHSPEC],
    { cwd: REPOSITORY_ROOT, encoding: "buffer" },
  );
  hash.update(tracked);
  const untracked = execFileSync(
    "git",
    [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ".",
      GENERATED_REPORT_PATHSPEC,
    ],
    { cwd: REPOSITORY_ROOT, encoding: "buffer" },
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort();
  for (const file of untracked) {
    hash.update(file);
    hash.update(readFileSync(resolve(REPOSITORY_ROOT, file)));
  }
  return hash.digest("hex");
}

function generateReport(results, options, provenance) {
  const now = new Date().toISOString();
  let markdown = "# Vext Native 基准公平性报告\n\n";
  markdown += `> UTC: ${now}\n`;
  markdown += `> 源码: ${provenance.branch}@${provenance.commit} (${provenance.worktree})\n`;
  markdown += `> 候选差异 SHA-256: ${provenance.candidate ?? "clean"}\n`;
  markdown += `> Runner: \`test/benchmark/run-native-fairness.mjs\`\n`;
  markdown += `> 参数: duration=${options.duration}s, connections=${options.connections}, pipelining=${options.pipelining}, warmup=${options.warmup}s, rounds=${options.rounds}\n\n`;
  markdown += "## 口径\n\n";
  markdown +=
    "- Raw Native 与 Raw Fastify 对齐为同步 handler、预序列化 JSON body 与 route-only middleware-chain。\n";
  markdown +=
    "- Vext Native Core 是 benchmark 私有 direct harness：无 bootstrap global middleware，参测 route registration chain 必须为 1。\n";
  markdown +=
    "- Vext Native Normal 使用正式 bootstrap + router-loader；frontend disabled 后保留的两个 global 生命周期节点是 authContext 与 requestHook。普通 route registration chain=2（routeMatched + handler），middleware-chain=5（routeMatched + 3 route middleware + handler）。\n";
  markdown +=
    "- Core 不测试 middleware-chain，避免将 route middleware 成本混入最短路径。\n\n";
  markdown += "## 汇总\n\n";
  markdown +=
    "| 场景 | Raw Native RPS | Raw Fastify RPS | Vext Core RPS | Vext Normal RPS | Core vs Raw Native | Normal vs Raw Native |\n";
  markdown += "|---|---:|---:|---:|---:|---:|---:|\n";
  for (const scenario of SCENARIOS) {
    const row = results.find((result) => result.scenario === scenario.name);
    const native = row?.targets["raw-native"]?.rps;
    const fastify = row?.targets["raw-fastify"]?.rps;
    const core = row?.targets["vext-native-core"]?.rps;
    const normal = row?.targets["vext-native-normal"]?.rps;
    const delta = (value) =>
      native && value ? ((value - native) / native) * 100 : undefined;
    markdown += `| ${scenario.title} | ${formatNumber(native)} | ${formatNumber(fastify)} | ${formatNumber(core)} | ${formatNumber(normal)} | ${formatPercent(delta(core))} | ${formatPercent(delta(normal))} |\n`;
  }
  markdown += "\n## 多轮样本\n\n";
  markdown +=
    "| 场景 | 目标 | RPS samples | Median | Mean | CV | P50 | P99 |\n";
  markdown += "|---|---|---|---:|---:|---:|---:|---:|\n";
  for (const row of results) {
    for (const target of TARGETS) {
      const metrics = row.targets[target.id];
      if (!metrics) {
        markdown += `| ${row.scenario} | ${target.title} | N/A | N/A | N/A | N/A | N/A | N/A |\n`;
        continue;
      }
      markdown += `| ${row.scenario} | ${target.title} | ${metrics.stats.samples.map(formatNumber).join(", ")} | ${formatNumber(metrics.stats.median)} | ${formatNumber(metrics.stats.mean)} | ${metrics.stats.cv.toFixed(1)}% | ${metrics.latencyP50}ms | ${metrics.latencyP99}ms |\n`;
    }
  }
  markdown += "\n## Chain telemetry\n\n";
  markdown +=
    "| 场景 | 模式 | global middleware | route registration chain | 状态 |\n";
  markdown += "|---|---|---:|---:|---|\n";
  for (const row of results) {
    for (const target of TARGETS.filter((candidate) => candidate.mode)) {
      const telemetry = row.telemetry[target.id];
      if (!telemetry) continue;
      markdown += `| ${row.scenario} | ${target.mode} | ${telemetry.globalMiddlewareCount} | ${telemetry.routeChainLengths?.[routeKeyForScenario({ name: row.scenario, path: row.path })]} | asserted |\n`;
    }
  }
  markdown += "\n## 环境\n\n";
  markdown += `- Node.js: ${process.version}\n- Platform: ${process.platform} ${process.arch}\n- CPU: ${os.cpus()[0]?.model ?? "unknown"}\n- Memory: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GiB\n`;
  return markdown;
}

async function main() {
  const options = parseArgs();
  const activeScenarios =
    options.scenario === "all"
      ? SCENARIOS
      : SCENARIOS.filter((scenario) => scenario.name === options.scenario);
  if (activeScenarios.length === 0) {
    throw new Error(`Unknown scenario: ${options.scenario}`);
  }
  const provenance = {
    branch: readGitValue(["branch", "--show-current"]),
    commit: readGitValue(["rev-parse", "HEAD"]),
    worktree: readGitValue(["status", "--porcelain=v1"]) ? "dirty" : "clean",
    candidate: candidatePatchSha256(),
  };
  const results = [];
  let port = 19400;

  for (const scenario of activeScenarios) {
    console.log(`\n== ${scenario.title} (${scenario.path}) ==`);
    const row = {
      scenario: scenario.name,
      path: scenario.path,
      targets: {},
      telemetry: {},
    };
    for (const target of TARGETS) {
      if (target.mode === "core" && scenario.core === false) {
        console.log(`  ${target.title}: N/A by design`);
        continue;
      }
      const targetPort = port++;
      let server;
      try {
        console.log(`  start ${target.title} on ${targetPort}`);
        server = await startTarget(target, targetPort);
        await waitForHealthy(server.port);
        await assertScenarioContract(server.port, scenario);
        if (target.mode) {
          assertVextTelemetry(target, scenario, server.telemetry);
          row.telemetry[target.id] = server.telemetry;
        }
        if (options.warmup > 0) {
          await runAutocannon({
            port: server.port,
            path: scenario.path,
            duration: options.warmup,
            connections: 10,
            pipelining: 1,
          });
        }
        row.targets[target.id] = await runRounds(
          server.port,
          scenario,
          options,
        );
        console.log(
          `  ${target.title}: ${formatNumber(row.targets[target.id].rps)} RPS`,
        );
      } finally {
        await stopServer(server);
        await sleep(250);
      }
    }
    results.push(row);
  }

  const report = generateReport(results, options, provenance);
  await writeFile(options.output, report, "utf8");
  if (options.resultsJson) {
    await writeFile(
      options.resultsJson,
      `${JSON.stringify({ schemaVersion: 1, provenance, options, results }, null, 2)}\n`,
      "utf8",
    );
  }
  console.log(`\nReport written: ${options.output}`);
}

main().catch((error) => {
  console.error(
    `Benchmark failed: ${error instanceof Error ? error.stack : error}`,
  );
  process.exit(1);
});
