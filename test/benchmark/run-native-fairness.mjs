/**
 * Canonical Raw Native / Raw Fastify / Vext Native fairness benchmark.
 *
 * The runner deliberately separates a private Vext Native Core harness from
 * Normal bootstrap + router-loader. It rejects output when IPC telemetry says
 * the expected chain composition is absent.
 */

import { execFileSync, fork } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import autocannon from "autocannon";
import {
  AUTOCANNON_VERSION,
  verifyLatestBenchmarkDependencies,
} from "./dependency-versions.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPOSITORY_ROOT = resolve(__dirname, "../..");
const GENERATED_REPORT_PATHSPEC = ":(exclude)test/benchmark/RESULTS.md";
const PACKAGE_METADATA = JSON.parse(
  readFileSync(join(REPOSITORY_ROOT, "package.json"), "utf8"),
);
const PACKAGE_LOCK = JSON.parse(
  readFileSync(join(REPOSITORY_ROOT, "package-lock.json"), "utf8"),
);

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
    handlerMode: "sync",
    maxCv: 15,
    processPriority: 0,
    targetScheduling: "round-interleaved-rotating",
    output: join(__dirname, "RESULTS.md"),
    resultsJson: undefined,
    fromResultsJson: [],
    requireCompleteMatrix: false,
  };
  const args = process.argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    const next = () => args[++index];
    switch (args[index]) {
      case "--duration":
        options.duration = Number(next());
        break;
      case "--connections":
        options.connections = Number(next());
        break;
      case "--pipelining":
        options.pipelining = Number(next());
        break;
      case "--warmup":
        options.warmup = Number(next());
        break;
      case "--rounds":
        options.rounds = Number(next());
        break;
      case "--scenario":
        options.scenario = next();
        break;
      case "--handler-mode":
        options.handlerMode = next();
        break;
      case "--max-cv":
        options.maxCv = Number(next());
        break;
      case "--process-priority":
        options.processPriority = Number(next());
        break;
      case "--output":
        options.output = next();
        break;
      case "--results-json":
        options.resultsJson = next();
        break;
      case "--from-results-json":
        options.fromResultsJson = next()
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        break;
      case "--require-complete-matrix":
        options.requireCompleteMatrix = true;
        break;
      default:
        throw new Error(`Unknown option: ${args[index]}`);
    }
  }

  for (const key of ["duration", "connections", "pipelining", "rounds"]) {
    if (!Number.isInteger(options[key]) || options[key] <= 0) {
      throw new Error(`Invalid --${key}: ${options[key]}`);
    }
  }
  for (const key of ["warmup", "maxCv"]) {
    if (!Number.isFinite(options[key]) || options[key] < 0) {
      throw new Error(`Invalid --${key}: ${options[key]}`);
    }
  }
  if (!["sync", "async"].includes(options.handlerMode)) {
    throw new Error(`Invalid --handler-mode: ${options.handlerMode}`);
  }
  if (
    !Number.isInteger(options.processPriority) ||
    options.processPriority < -20 ||
    options.processPriority > 19
  ) {
    throw new Error(`Invalid --process-priority: ${options.processPriority}`);
  }
  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatNumber(value) {
  return typeof value === "number"
    ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "N/A";
}

function formatPercent(value) {
  return typeof value === "number" ? `${value.toFixed(2)}%` : "N/A";
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

async function runAutocannon({
  port,
  path,
  duration,
  connections,
  pipelining,
}) {
  const url = `http://127.0.0.1:${port}${path}`;
  const result = await autocannon({
    url,
    duration,
    connections,
    pipelining,
  });
  const errors = result.errors ?? 0;
  const timeouts = result.timeouts ?? 0;
  const non2xx = result.non2xx ?? 0;
  if (errors > 0 || timeouts > 0 || non2xx > 0) {
    throw new Error(
      `Autocannon reported errors=${errors}, timeouts=${timeouts}, non2xx=${non2xx} for ${url}`,
    );
  }
  return result;
}

function summarizeSamples(samples) {
  if (samples.length === 0) {
    throw new Error("Cannot summarize an empty benchmark sample set");
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

function rotateTargets(targets, offset) {
  const normalized = offset % targets.length;
  return [...targets.slice(normalized), ...targets.slice(0, normalized)];
}

function findUnstableMeasurements(results, maxCv, rounds) {
  if (rounds <= 1) return [];
  return results.flatMap((row) =>
    Object.entries(row.targets)
      .filter(([, metrics]) => metrics.stats.cv > maxCv)
      .map(([target, metrics]) => ({
        scenario: row.scenario,
        target,
        cv: metrics.stats.cv,
      })),
  );
}

function getBenchmarkEnvironment() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    totalMemoryBytes: os.totalmem(),
    processPriority: getProcessPriority(),
  };
}

function getProcessPriority() {
  try {
    return os.getPriority();
  } catch {
    return "unavailable";
  }
}

function applyProcessPriority(priority, pid = 0, label = "benchmark runner") {
  try {
    os.setPriority(pid, priority);
    const actual = os.getPriority(pid);
    if (actual !== priority) {
      throw new Error(`requested ${priority}, got ${actual}`);
    }
  } catch (error) {
    throw new Error(
      `Unable to set ${label} process priority to ${priority}: ${error instanceof Error ? error.message : error}`,
    );
  }
}

function hasSameProtocol(left, right) {
  return (
    left.duration === right.duration &&
    left.connections === right.connections &&
    left.pipelining === right.pipelining &&
    left.warmup === right.warmup &&
    left.rounds === right.rounds &&
    left.handlerMode === right.handlerMode &&
    left.maxCv === right.maxCv &&
    left.processPriority === right.processPriority &&
    left.targetScheduling === right.targetScheduling
  );
}

function hasSameEnvironment(left, right) {
  return (
    left.node === right.node &&
    left.platform === right.platform &&
    left.arch === right.arch &&
    left.cpuModel === right.cpuModel &&
    left.totalMemoryBytes === right.totalMemoryBytes &&
    left.processPriority === right.processPriority
  );
}

function hasSameProvenance(left, right) {
  return (
    left.commit === right.commit &&
    left.worktree === right.worktree &&
    left.candidate === right.candidate &&
    JSON.stringify(left.versions) === JSON.stringify(right.versions)
  );
}

function hasValidMetrics(metrics) {
  return Boolean(
    metrics &&
    metrics.rps > 0 &&
    metrics.totalRequests > 0 &&
    metrics.errors === 0 &&
    metrics.timeouts === 0 &&
    metrics.non2xx === 0 &&
    metrics.stats?.samples?.length > 0,
  );
}

function hasValidResultRow(row) {
  const scenario = SCENARIOS.find(
    (candidate) => candidate.name === row.scenario,
  );
  if (!scenario) return false;
  return TARGETS.every((target) => {
    if (target.mode === "core" && scenario.core === false) {
      return row.targets[target.id] == null;
    }
    return hasValidMetrics(row.targets[target.id]);
  });
}

async function loadMergedResults(paths, output, requireCompleteMatrix) {
  if (paths.length === 0) {
    throw new Error("--from-results-json requires at least one JSON artifact");
  }
  const artifacts = await Promise.all(
    paths.map(async (path) => ({
      path,
      value: JSON.parse(await readFile(path, "utf8")),
    })),
  );
  const first = artifacts[0].value;
  if (
    first?.schemaVersion !== 2 ||
    !first.complete ||
    !first.provenance?.latestDependencies ||
    !first.environment ||
    !first.options ||
    !Array.isArray(first.results)
  ) {
    throw new Error(
      `Invalid or incomplete benchmark artifact: ${artifacts[0].path}`,
    );
  }
  const currentVersions = getFrameworkVersions();
  if (
    JSON.stringify(first.provenance.versions) !==
    JSON.stringify(currentVersions)
  ) {
    throw new Error(
      `Benchmark artifact dependency versions do not match the current lockfile: ${artifacts[0].path}`,
    );
  }
  const currentSource = candidateSourceState([output, ...paths]);
  const currentCommit = readGitValue(["rev-parse", "HEAD"]);
  if (currentCommit === "unavailable") {
    throw new Error("Unable to read benchmark source commit");
  }
  const currentProvenance = {
    commit: currentCommit,
    worktree: currentSource.worktree,
    candidate: currentSource.candidate,
    versions: currentVersions,
  };
  if (!hasSameProvenance(first.provenance, currentProvenance)) {
    throw new Error(
      `Benchmark artifact source provenance does not match the current worktree: ${artifacts[0].path}`,
    );
  }

  const seen = new Set();
  const results = [];
  for (const { path, value } of artifacts) {
    if (
      value?.schemaVersion !== 2 ||
      !value.complete ||
      value.stability?.unstable?.length !== 0 ||
      !value.provenance?.latestDependencies ||
      !value.environment ||
      !value.options ||
      !Array.isArray(value.results)
    ) {
      throw new Error(`Invalid or incomplete benchmark artifact: ${path}`);
    }
    if (!hasSameProtocol(first.options, value.options)) {
      throw new Error(`Benchmark protocol mismatch in artifact: ${path}`);
    }
    if (!hasSameEnvironment(first.environment, value.environment)) {
      throw new Error(`Benchmark environment mismatch in artifact: ${path}`);
    }
    if (!hasSameProvenance(first.provenance, value.provenance)) {
      throw new Error(
        `Benchmark source provenance mismatch in artifact: ${path}`,
      );
    }
    for (const row of value.results) {
      if (!hasValidResultRow(row)) {
        throw new Error(`Invalid benchmark result in artifact: ${path}`);
      }
      if (seen.has(row.scenario)) {
        throw new Error(
          `Duplicate benchmark scenario while merging: ${row.scenario}`,
        );
      }
      seen.add(row.scenario);
      results.push(row);
    }
  }

  if (requireCompleteMatrix) {
    const expected = SCENARIOS.map((scenario) => scenario.name);
    const missing = expected.filter((scenario) => !seen.has(scenario));
    const unexpected = [...seen].filter(
      (scenario) => !expected.includes(scenario),
    );
    if (missing.length > 0 || unexpected.length > 0) {
      throw new Error(
        `Incomplete Native fairness matrix: missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}`,
      );
    }
  }

  results.sort(
    (left, right) =>
      SCENARIOS.findIndex((scenario) => scenario.name === left.scenario) -
      SCENARIOS.findIndex((scenario) => scenario.name === right.scenario),
  );
  return {
    results,
    options: { ...first.options, scenario: "all", output },
    provenance: first.provenance,
    environment: first.environment,
  };
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

function startTarget(target, port, handlerMode, processPriority) {
  const serverFile = target.id.startsWith("raw-")
    ? join(__dirname, "servers", `${target.id}.mjs`)
    : join(__dirname, "servers", "vext-start.mjs");
  const env = {
    ...process.env,
    PORT: String(port),
    VEXT_BENCH_HANDLER_MODE: handlerMode,
  };
  if (target.mode) {
    env.BENCH_ADAPTER = "native";
    env.VEXT_BENCH_MODE = target.mode;
  }

  return new Promise((resolve, reject) => {
    const child = fork(serverFile, [], {
      env,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    try {
      applyProcessPriority(processPriority, child.pid, `${target.title} child`);
    } catch (error) {
      child.kill("SIGTERM");
      reject(error);
      return;
    }
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

function assertVextTelemetry(target, scenario, telemetry, handlerMode) {
  if (
    !telemetry ||
    telemetry.mode !== target.mode ||
    telemetry.handlerMode !== handlerMode
  ) {
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
    telemetry.globalMiddlewareCount !== 1 ||
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

function getLockedVersion(packageName) {
  return (
    PACKAGE_LOCK.packages?.[`node_modules/${packageName}`]?.version ??
    "unavailable"
  );
}

function getFrameworkVersions() {
  return {
    vextjs: PACKAGE_METADATA.version,
    fastify: getLockedVersion("fastify"),
    hono: getLockedVersion("hono"),
    honoNodeServer: getLockedVersion("@hono/node-server"),
    express: getLockedVersion("express"),
    koa: getLockedVersion("koa"),
    koaRouter: getLockedVersion("@koa/router"),
    routeCore: getLockedVersion("route-core"),
    autocannon: AUTOCANNON_VERSION,
  };
}

function generatedArtifactPathspecs(paths) {
  const pathspecs = new Set();
  for (const path of paths.filter(Boolean)) {
    const relativePath = relative(REPOSITORY_ROOT, resolve(path));
    if (
      !relativePath ||
      relativePath === ".." ||
      relativePath.startsWith(
        `..${process.platform === "win32" ? "\\" : "/"}`,
      ) ||
      isAbsolute(relativePath)
    ) {
      continue;
    }
    pathspecs.add(`:(exclude)${relativePath.replaceAll("\\", "/")}`);
  }
  return [...pathspecs];
}

function candidateSourceState(excludedPaths = []) {
  const exclusions = [
    GENERATED_REPORT_PATHSPEC,
    ...generatedArtifactPathspecs(excludedPaths),
  ];
  const status = readGitValue([
    "status",
    "--porcelain=v1",
    "--",
    ".",
    ...exclusions,
  ]);
  if (status === "unavailable") {
    throw new Error("Unable to read benchmark git status");
  }
  if (!status) return { worktree: "clean", candidate: null };
  const hash = createHash("sha256");
  const tracked = execFileSync(
    "git",
    ["diff", "--binary", "HEAD", "--", ".", ...exclusions],
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
      ...exclusions,
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
  return { worktree: "dirty", candidate: hash.digest("hex") };
}

function generateReport(results, options, provenance, environment) {
  const now = new Date().toISOString();
  let markdown = "# Vext Native 基准公平性报告\n\n";
  markdown += `> UTC: ${now}\n`;
  markdown += `> 源码: ${provenance.branch}@${provenance.commit} (${provenance.worktree})\n`;
  markdown += `> 候选差异 SHA-256: ${provenance.candidate ?? "clean"}\n`;
  markdown += `> 候选摘要范围: 排除本次 report/JSON artifacts；包含其余已跟踪差异和未跟踪候选文件\n`;
  markdown += `> Runner: \`test/benchmark/run-native-fairness.mjs\`\n`;
  markdown += `> 参数: duration=${options.duration}s, connections=${options.connections}, pipelining=${options.pipelining}, warmup=${options.warmup}s, rounds=${options.rounds}\n\n`;
  markdown += `> 目标调度: ${options.targetScheduling}; max CV=${options.maxCv}%\n\n`;
  markdown += `> Handler mode: ${options.handlerMode}\n`;
  markdown += `> Requested process priority: ${options.processPriority}\n`;
  markdown += `> 锁定版本: Vext ${provenance.versions.vextjs}; Fastify ${provenance.versions.fastify}; Hono ${provenance.versions.hono}; @hono/node-server ${provenance.versions.honoNodeServer}; Express ${provenance.versions.express}; Koa ${provenance.versions.koa}; @koa/router ${provenance.versions.koaRouter}; route-core ${provenance.versions.routeCore}; Autocannon ${provenance.versions.autocannon}\n\n`;
  markdown += `> npm latest 校验: ${provenance.latestDependencies.checkedAt} against ${provenance.latestDependencies.registryUrl}\n\n`;
  markdown += "## 口径\n\n";
  markdown +=
    "- `/json`、`/params`、`/chain` 与 `/health` 的四个受测对象均使用上方声明的 handler mode；Raw Fastify 在 async mode 按其公开契约返回 `reply`。\n";
  markdown +=
    "- `/middleware-chain` 保留各框架真实的 route-level middleware 调度，不用于推断 direct handler mode 的差异。\n";
  markdown +=
    "- 每轮在 Raw Native、Raw Fastify、Vext Core、Vext Normal 之间轮转起始目标，避免同一目标连续跑完全部轮次造成时间漂移偏差。\n";
  markdown +=
    "- Vext Native Core 是 benchmark 私有 direct harness：无 bootstrap global middleware，参测 route registration chain 必须为 1。\n";
  markdown +=
    "- Vext Native Normal 使用正式 bootstrap + router-loader；在 `requestContext=false` 且 frontend disabled 时，authContext 不注册，唯一全局生命周期节点为 requestHook。普通 route registration chain=2（routeMatched + handler），middleware-chain=5（routeMatched + 3 route middleware + handler）。\n";
  markdown +=
    "- Core 不注册 route middleware chain，因此该场景显示 `N/A`；这表示不适用，不是漏测或零成本。\n\n";
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
  markdown += `- Node.js: ${environment.node}\n- Platform: ${environment.platform} ${environment.arch}\n- CPU: ${environment.cpuModel}\n- Memory: ${Math.round(environment.totalMemoryBytes / 1024 / 1024 / 1024)} GiB\n- Process priority: ${environment.processPriority}\n`;
  return markdown;
}

async function main() {
  const options = parseArgs();
  applyProcessPriority(options.processPriority);
  const latestDependencies = await verifyLatestBenchmarkDependencies({
    repositoryRoot: REPOSITORY_ROOT,
  });
  const environment = getBenchmarkEnvironment();
  if (options.fromResultsJson.length > 0) {
    const merged = await loadMergedResults(
      options.fromResultsJson,
      options.output,
      options.requireCompleteMatrix,
    );
    merged.provenance.latestDependencies = {
      checkedAt: latestDependencies.checkedAt,
      registryUrl: latestDependencies.registryUrl,
      versions: latestDependencies.versions,
    };
    const report = generateReport(
      merged.results,
      merged.options,
      merged.provenance,
      merged.environment,
    );
    await writeFile(options.output, report, "utf8");
    console.log(`Merged report written: ${options.output}`);
    return;
  }
  const activeScenarios =
    options.scenario === "all"
      ? SCENARIOS
      : SCENARIOS.filter((scenario) => scenario.name === options.scenario);
  if (activeScenarios.length === 0) {
    throw new Error(`Unknown scenario: ${options.scenario}`);
  }
  const source = candidateSourceState([options.output, options.resultsJson]);
  const commit = readGitValue(["rev-parse", "HEAD"]);
  if (commit === "unavailable") {
    throw new Error("Unable to read benchmark source commit");
  }
  const provenance = {
    branch: readGitValue(["branch", "--show-current"]) || "detached",
    commit,
    worktree: source.worktree,
    candidate: source.candidate,
    versions: getFrameworkVersions(),
    latestDependencies: {
      checkedAt: latestDependencies.checkedAt,
      registryUrl: latestDependencies.registryUrl,
      versions: latestDependencies.versions,
    },
  };
  const results = [];
  let port = 19400;

  for (
    let scenarioIndex = 0;
    scenarioIndex < activeScenarios.length;
    scenarioIndex += 1
  ) {
    const scenario = activeScenarios[scenarioIndex];
    console.log(`\n== ${scenario.title} (${scenario.path}) ==`);
    const row = {
      scenario: scenario.name,
      path: scenario.path,
      targets: {},
      telemetry: {},
    };
    const activeTargets = TARGETS.filter((target) => {
      const applicable = !(target.mode === "core" && scenario.core === false);
      if (!applicable) console.log(`  ${target.title}: N/A by design`);
      return applicable;
    });
    const runningTargets = [];
    const samples = Object.fromEntries(
      activeTargets.map((target) => [target.id, []]),
    );
    try {
      for (const target of activeTargets) {
        const targetPort = port++;
        console.log(`  start ${target.title} on ${targetPort}`);
        const server = await startTarget(
          target,
          targetPort,
          options.handlerMode,
          options.processPriority,
        );
        runningTargets.push({ target, server });
        console.log(
          `    ready pid=${server.process.pid}, priority=${os.getPriority(server.process.pid)}`,
        );
        await waitForHealthy(server.port);
        await assertScenarioContract(server.port, scenario);
        if (target.mode) {
          assertVextTelemetry(
            target,
            scenario,
            server.telemetry,
            options.handlerMode,
          );
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
      }

      let measurementIndex = 0;
      for (let round = 0; round < options.rounds; round += 1) {
        const order = rotateTargets(runningTargets, round + scenarioIndex);
        console.log(
          `  round ${round + 1}/${options.rounds}: ${order.map(({ target }) => target.title).join(" -> ")}`,
        );
        for (const { target, server } of order) {
          if (measurementIndex > 0) {
            await sleep(2000);
            global.gc?.();
          }
          const metrics = metricsFromAutocannon(
            await runAutocannon({
              port: server.port,
              path: scenario.path,
              duration: options.duration,
              connections: options.connections,
              pipelining: options.pipelining,
            }),
          );
          samples[target.id].push(metrics);
          measurementIndex += 1;
          console.log(`    ${target.title}: ${formatNumber(metrics.rps)} RPS`);
        }
      }

      for (const { target } of runningTargets) {
        row.targets[target.id] = summarizeSamples(samples[target.id]);
        console.log(
          `  ${target.title} median: ${formatNumber(row.targets[target.id].rps)} RPS (CV=${row.targets[target.id].stats.cv.toFixed(1)}%)`,
        );
      }
    } finally {
      for (const { server } of [...runningTargets].reverse()) {
        await stopServer(server);
      }
      await sleep(250);
    }
    results.push(row);
  }

  const unstable = findUnstableMeasurements(
    results,
    options.maxCv,
    options.rounds,
  );
  if (options.resultsJson) {
    await writeFile(
      options.resultsJson,
      `${JSON.stringify(
        {
          schemaVersion: 2,
          complete: unstable.length === 0,
          provenance,
          environment,
          options,
          stability: { maxCv: options.maxCv, unstable },
          results,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
  if (unstable.length > 0) {
    throw new Error(
      `Benchmark CV gate failed (max ${options.maxCv}%): ${unstable
        .map(
          ({ scenario, target, cv }) =>
            `${scenario}/${target}=${cv.toFixed(1)}%`,
        )
        .join(", ")}`,
    );
  }
  const report = generateReport(results, options, provenance, environment);
  await writeFile(options.output, report, "utf8");
  console.log(`\nReport written: ${options.output}`);
}

main().catch((error) => {
  console.error(
    `Benchmark failed: ${error instanceof Error ? error.stack : error}`,
  );
  process.exit(1);
});
