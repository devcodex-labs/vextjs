/**
 * Public Vext Adapter Matrix benchmark.
 *
 * This runner answers the user-facing selection question: with one identical
 * Vext Normal application, how do the supported HTTP adapters behave? Raw
 * framework and Core harness measurements remain separate maintainer
 * diagnostics in run-benchmark.mjs and run-native-fairness.mjs.
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
  { name: "json", title: "JSON response", path: "/json" },
  { name: "params", title: "Route parameters", path: "/users/42" },
  { name: "chain", title: "Handler business chain", path: "/chain" },
  {
    name: "middleware-chain",
    title: "Route middleware chain",
    path: "/middleware-chain",
  },
];

const TARGETS = [
  { id: "native", title: "Native" },
  { id: "hono", title: "Hono" },
  { id: "fastify", title: "Fastify" },
  { id: "express", title: "Express" },
  { id: "koa", title: "Koa" },
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
    maxCv: 20,
    processPriority: 0,
    targetScheduling: "round-interleaved-rotating",
    output: join(__dirname, "RESULTS.md"),
    resultsJson: undefined,
    fromResultsJson: [],
    requireCompleteMatrix: false,
  };
  const args = process.argv.slice(2);
  const next = (index) => args[index + 1];

  for (let index = 0; index < args.length; index += 1) {
    switch (args[index]) {
      case "--duration":
        options.duration = Number(next(index));
        index += 1;
        break;
      case "--connections":
        options.connections = Number(next(index));
        index += 1;
        break;
      case "--pipelining":
        options.pipelining = Number(next(index));
        index += 1;
        break;
      case "--warmup":
        options.warmup = Number(next(index));
        index += 1;
        break;
      case "--rounds":
        options.rounds = Number(next(index));
        index += 1;
        break;
      case "--scenario":
        options.scenario = next(index);
        index += 1;
        break;
      case "--handler-mode":
        options.handlerMode = next(index);
        index += 1;
        break;
      case "--max-cv":
        options.maxCv = Number(next(index));
        index += 1;
        break;
      case "--process-priority":
        options.processPriority = Number(next(index));
        index += 1;
        break;
      case "--output":
        options.output = next(index);
        index += 1;
        break;
      case "--results-json":
        options.resultsJson = next(index);
        index += 1;
        break;
      case "--from-results-json":
        options.fromResultsJson = next(index)
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        index += 1;
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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatNumber(value) {
  return typeof value === "number"
    ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "N/A";
}

function stddev(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
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
  return autocannon({ url, duration, connections, pipelining });
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

function expectedBody(scenario) {
  if (scenario.name === "params") return { id: "42", name: "User 42" };
  if (scenario.name === "json") return { message: "Hello World" };
  return {
    message:
      scenario.name === "chain"
        ? "Chain complete"
        : "Middleware chain complete",
    authenticated: true,
  };
}

async function readScenarioContract(port, scenario) {
  const response = await fetch(`http://127.0.0.1:${port}${scenario.path}`, {
    signal: AbortSignal.timeout(5000),
  });
  const contentType = response.headers.get("content-type");
  const body = await response.json();
  const headers = {
    responseTime: Boolean(response.headers.get("x-response-time")),
    requestId: Boolean(response.headers.get("x-bench-request-id")),
  };
  const needsBenchmarkHeaders = ["chain", "middleware-chain"].includes(
    scenario.name,
  );
  const hasExpectedBody =
    body?.message === expectedBody(scenario).message &&
    (scenario.name !== "chain" || typeof body.requestId === "string") &&
    (scenario.name !== "chain" || body.requestId.length > 0) &&
    (scenario.name === "chain" ||
      JSON.stringify(body) === JSON.stringify(expectedBody(scenario)));
  if (
    !response.ok ||
    !contentType?.includes("application/json") ||
    !hasExpectedBody ||
    (needsBenchmarkHeaders && (!headers.responseTime || !headers.requestId))
  ) {
    throw new Error(
      `Scenario contract failed for ${scenario.name}: status=${response.status}, content-type=${contentType}, body=${JSON.stringify(body)}`,
    );
  }
  return {
    status: response.status,
    contentType: "application/json",
    body: expectedBody(scenario),
    headers,
  };
}

function assertSameContract(expected, actual, scenario, target) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(
      `${target.title} does not match the shared ${scenario.name} contract`,
    );
  }
}

function routeKeyForScenario(scenario) {
  return scenario.name === "params" ? "GET /users/:id" : `GET ${scenario.path}`;
}

function assertNormalTelemetry(target, scenario, telemetry, handlerMode) {
  const routeLength =
    telemetry?.routeChainLengths?.[routeKeyForScenario(scenario)];
  const expectedRouteLength = scenario.name === "middleware-chain" ? 5 : 2;
  if (
    telemetry?.mode !== "normal" ||
    telemetry?.adapter !== target.id ||
    telemetry?.handlerMode !== handlerMode ||
    telemetry?.globalMiddlewareCount !== 1 ||
    routeLength !== expectedRouteLength
  ) {
    throw new Error(
      `${target.title} Normal telemetry mismatch: ${JSON.stringify({ telemetry, expectedRouteLength })}`,
    );
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

function startTarget(target, port, handlerMode, processPriority) {
  return new Promise((resolve, reject) => {
    const child = fork(join(__dirname, "servers", "vext-start.mjs"), [], {
      env: {
        ...process.env,
        PORT: String(port),
        BENCH_ADAPTER: target.id,
        VEXT_BENCH_MODE: "normal",
        VEXT_BENCH_HANDLER_MODE: handlerMode,
      },
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
      } else if (message?.type === "error") {
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
  hash.update(
    execFileSync(
      "git",
      ["diff", "--binary", "HEAD", "--", ".", ...exclusions],
      {
        cwd: REPOSITORY_ROOT,
        encoding: "buffer",
      },
    ),
  );
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

function getLockedVersion(packageName) {
  return (
    PACKAGE_LOCK.packages?.[`node_modules/${packageName}`]?.version ??
    "unavailable"
  );
}

function getFrameworkVersions() {
  return {
    vextjs: PACKAGE_METADATA.version,
    native: process.version,
    hono: getLockedVersion("hono"),
    fastify: getLockedVersion("fastify"),
    express: getLockedVersion("express"),
    koa: getLockedVersion("koa"),
    koaRouter: getLockedVersion("@koa/router"),
    autocannon: AUTOCANNON_VERSION,
  };
}

function getEnvironment() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    totalMemoryBytes: os.totalmem(),
    processPriority: os.getPriority(),
  };
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

function hasValidResult(row) {
  return (
    SCENARIOS.some((scenario) => scenario.name === row?.scenario) &&
    TARGETS.every((target) => hasValidMetrics(row.targets?.[target.id])) &&
    TARGETS.every((target) => Boolean(row.telemetry?.[target.id]))
  );
}

function sameProtocol(left, right) {
  return [
    "duration",
    "connections",
    "pipelining",
    "warmup",
    "rounds",
    "handlerMode",
    "maxCv",
    "processPriority",
    "targetScheduling",
  ].every((key) => left[key] === right[key]);
}

function sameEnvironment(left, right) {
  return [
    "node",
    "platform",
    "arch",
    "cpuModel",
    "totalMemoryBytes",
    "processPriority",
  ].every((key) => left[key] === right[key]);
}

function sameProvenance(left, right) {
  return (
    left.commit === right.commit &&
    left.worktree === right.worktree &&
    left.candidate === right.candidate &&
    JSON.stringify(left.versions) === JSON.stringify(right.versions)
  );
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
    first?.schemaVersion !== 1 ||
    first?.suite !== "vext-adapter-matrix" ||
    !first.complete ||
    !Array.isArray(first.results)
  ) {
    throw new Error(
      `Invalid or incomplete benchmark artifact: ${artifacts[0].path}`,
    );
  }
  const currentProvenance = {
    commit: readGitValue(["rev-parse", "HEAD"]),
    ...candidateSourceState([output, ...paths]),
    versions: getFrameworkVersions(),
  };
  if (!sameProvenance(first.provenance, currentProvenance)) {
    throw new Error(
      `Benchmark artifact source provenance does not match the current worktree: ${artifacts[0].path}`,
    );
  }
  const seen = new Set();
  const results = [];
  for (const { path, value } of artifacts) {
    if (
      value?.schemaVersion !== 1 ||
      value?.suite !== "vext-adapter-matrix" ||
      !value.complete ||
      value.stability?.unstable?.length !== 0 ||
      !sameProtocol(first.options, value.options) ||
      !sameEnvironment(first.environment, value.environment) ||
      !sameProvenance(first.provenance, value.provenance)
    ) {
      throw new Error(`Incompatible adapter-matrix artifact: ${path}`);
    }
    for (const row of value.results) {
      if (!hasValidResult(row))
        throw new Error(`Invalid benchmark result in artifact: ${path}`);
      if (seen.has(row.scenario))
        throw new Error(`Duplicate benchmark scenario: ${row.scenario}`);
      seen.add(row.scenario);
      results.push(row);
    }
  }
  if (requireCompleteMatrix) {
    const missing = SCENARIOS.map((scenario) => scenario.name).filter(
      (scenario) => !seen.has(scenario),
    );
    if (missing.length > 0) {
      throw new Error(
        `Incomplete Vext adapter matrix: missing=${missing.join(",")}`,
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

function findUnstableMeasurements(results, maxCv, rounds) {
  if (rounds <= 1) return [];
  return results.flatMap((row) =>
    TARGETS.filter((target) => row.targets[target.id].stats.cv > maxCv).map(
      (target) => ({
        scenario: row.scenario,
        target: target.id,
        cv: row.targets[target.id].stats.cv,
      }),
    ),
  );
}

function generateReport(results, options, provenance, environment) {
  let markdown = "# Vext Adapter Matrix Benchmark\n\n";
  markdown +=
    "> **Audience**: Vext users choosing an HTTP adapter for the same application.\n";
  markdown += `> **UTC**: ${new Date().toISOString()}\n`;
  markdown += `> **Source**: ${provenance.branch}@${provenance.commit} (${provenance.worktree})\n`;
  markdown += `> **Candidate SHA-256**: ${provenance.candidate ?? "clean"}\n`;
  markdown +=
    "> **Candidate scope**: excludes this report and JSON artifacts; includes all other tracked and untracked source changes.\n";
  markdown += "> **Runner**: `test/benchmark/run-adapter-matrix.mjs`\n";
  markdown += `> **Protocol**: duration=${options.duration}s, connections=${options.connections}, pipelining=${options.pipelining}, warmup=${options.warmup}s, rounds=${options.rounds}, handler=${options.handlerMode}\n`;
  markdown += `> **Scheduling**: ${options.targetScheduling}; max CV=${options.maxCv}%\n\n`;
  markdown += "## Why this comparison\n\n";
  markdown +=
    "The measured decision is **which Vext adapter to use while the Vext application stays the same**. Every target uses the same routes, Normal configuration, middleware fixture, handler mode, HTTP contract, process priority, and load protocol. Only the adapter changes. Raw framework and Vext Core measurements answer maintainer diagnostics and are intentionally not used for this user-facing table.\n\n";
  markdown += "## Results\n\n";
  markdown +=
    "| Scenario | Native RPS | Hono RPS | Fastify RPS | Express RPS | Koa RPS |\n";
  markdown += "|---|---:|---:|---:|---:|---:|\n";
  for (const row of results) {
    const scenario = SCENARIOS.find(
      (candidate) => candidate.name === row.scenario,
    );
    markdown += `| ${scenario?.title ?? row.scenario} | ${TARGETS.map((target) => formatNumber(row.targets[target.id]?.rps)).join(" | ")} |\n`;
  }
  markdown += "\n## Per-scenario statistics\n\n";
  markdown +=
    "| Scenario | Adapter | RPS samples | Median | P50 | P99 | Errors | CV |\n";
  markdown += "|---|---|---|---:|---:|---:|---:|---:|\n";
  for (const row of results) {
    for (const target of TARGETS) {
      const metrics = row.targets[target.id];
      markdown += `| ${row.scenario} | ${target.title} | ${metrics.stats.samples.map(formatNumber).join(", ")} | ${formatNumber(metrics.rps)} | ${metrics.latencyP50}ms | ${metrics.latencyP99}ms | ${metrics.errors + metrics.timeouts + metrics.non2xx} | ${metrics.stats.cv.toFixed(1)}% |\n`;
    }
  }
  markdown += "\n## Normal chain telemetry\n\n";
  markdown +=
    "| Scenario | Adapter | Global middleware | Route registration chain | Status |\n";
  markdown += "|---|---|---:|---:|---|\n";
  for (const row of results) {
    const scenario = SCENARIOS.find(
      (candidate) => candidate.name === row.scenario,
    );
    for (const target of TARGETS) {
      const telemetry = row.telemetry[target.id];
      markdown += `| ${row.scenario} | ${target.title} | ${telemetry.globalMiddlewareCount} | ${telemetry.routeChainLengths[routeKeyForScenario(scenario)]} | asserted |\n`;
    }
  }
  markdown += "\n## Validity and limits\n\n";
  markdown +=
    "- All five targets are alive before a scenario is measured. Each round rotates its first target; the median is reported and a CV over the declared threshold rejects the artifact.\n";
  markdown +=
    "- The fixture explicitly disables optional request features not used by these GET scenarios. This is a light Normal Vext workload, not an all-features production workload or a database/I/O benchmark.\n";
  markdown +=
    "- Results rank no overall winner across different scenarios. Use the numbers with your required integrations, migration constraints, P95/P99, and a representative production workload.\n";
  markdown +=
    "- Latest dependency versions are verified against the npm registry before the run; the exact locked versions and source identity are recorded below.\n\n";
  markdown += "## Environment\n\n";
  markdown += `- Node.js: ${environment.node}\n- Platform: ${environment.platform} ${environment.arch}\n- CPU: ${environment.cpuModel}\n- Memory: ${Math.round(environment.totalMemoryBytes / 1024 / 1024 / 1024)} GiB\n- Process priority: ${environment.processPriority}\n`;
  markdown += `- Dependencies: Vext ${provenance.versions.vextjs}; Hono ${provenance.versions.hono}; Fastify ${provenance.versions.fastify}; Express ${provenance.versions.express}; Koa ${provenance.versions.koa}; @koa/router ${provenance.versions.koaRouter}; Autocannon ${provenance.versions.autocannon}\n`;
  markdown += `- npm latest verification: ${provenance.latestDependencies.checkedAt} against ${provenance.latestDependencies.registryUrl}\n`;
  return markdown;
}

async function main() {
  const options = parseArgs();
  applyProcessPriority(options.processPriority);
  const latestDependencies = await verifyLatestBenchmarkDependencies({
    repositoryRoot: REPOSITORY_ROOT,
  });
  const environment = getEnvironment();
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
    await writeFile(
      options.output,
      generateReport(
        merged.results,
        merged.options,
        merged.provenance,
        merged.environment,
      ),
      "utf8",
    );
    console.log(`Merged report written: ${options.output}`);
    return;
  }

  const activeScenarios =
    options.scenario === "all"
      ? SCENARIOS
      : SCENARIOS.filter((scenario) => scenario.name === options.scenario);
  if (activeScenarios.length === 0)
    throw new Error(`Unknown scenario: ${options.scenario}`);

  const source = candidateSourceState([options.output, options.resultsJson]);
  const commit = readGitValue(["rev-parse", "HEAD"]);
  if (commit === "unavailable")
    throw new Error("Unable to read benchmark source commit");
  const provenance = {
    branch: readGitValue(["branch", "--show-current"]) || "detached",
    commit,
    ...source,
    versions: getFrameworkVersions(),
    latestDependencies: {
      checkedAt: latestDependencies.checkedAt,
      registryUrl: latestDependencies.registryUrl,
      versions: latestDependencies.versions,
    },
  };
  const results = [];
  let port = 19500;

  for (
    let scenarioIndex = 0;
    scenarioIndex < activeScenarios.length;
    scenarioIndex += 1
  ) {
    const scenario = activeScenarios[scenarioIndex];
    const row = {
      scenario: scenario.name,
      path: scenario.path,
      targets: {},
      telemetry: {},
    };
    const runningTargets = [];
    const samples = Object.fromEntries(
      TARGETS.map((target) => [target.id, []]),
    );
    try {
      let contract = null;
      for (const target of TARGETS) {
        const server = await startTarget(
          target,
          port++,
          options.handlerMode,
          options.processPriority,
        );
        runningTargets.push({ target, server });
        await waitForHealthy(server.port);
        const actualContract = await readScenarioContract(
          server.port,
          scenario,
        );
        if (contract)
          assertSameContract(contract, actualContract, scenario, target);
        else contract = actualContract;
        assertNormalTelemetry(
          target,
          scenario,
          server.telemetry,
          options.handlerMode,
        );
        row.telemetry[target.id] = server.telemetry;
        if (options.warmup > 0) {
          metricsFromAutocannon(
            await runAutocannon({
              port: server.port,
              path: scenario.path,
              duration: options.warmup,
              connections: 10,
              pipelining: 1,
            }),
          );
        }
      }
      let measurementIndex = 0;
      for (let round = 0; round < options.rounds; round += 1) {
        const order = rotateTargets(runningTargets, round + scenarioIndex);
        console.log(
          `round ${round + 1}/${options.rounds}: ${order.map(({ target }) => target.title).join(" -> ")}`,
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
          console.log(`${target.title}: ${formatNumber(metrics.rps)} RPS`);
        }
      }
      for (const target of TARGETS)
        row.targets[target.id] = summarizeSamples(samples[target.id]);
      results.push(row);
    } finally {
      for (const { server } of [...runningTargets].reverse())
        await stopServer(server);
      await sleep(250);
    }
  }

  const unstable = findUnstableMeasurements(
    results,
    options.maxCv,
    options.rounds,
  );
  const artifact = {
    schemaVersion: 1,
    suite: "vext-adapter-matrix",
    complete: unstable.length === 0,
    provenance,
    environment,
    options,
    stability: { maxCv: options.maxCv, unstable },
    results,
  };
  if (options.resultsJson)
    await writeFile(
      options.resultsJson,
      `${JSON.stringify(artifact, null, 2)}\n`,
      "utf8",
    );
  if (unstable.length > 0) {
    throw new Error(
      `Benchmark CV gate failed (max ${options.maxCv}%): ${unstable.map(({ scenario, target, cv }) => `${scenario}/${target}=${cv.toFixed(1)}%`).join(", ")}`,
    );
  }
  await writeFile(
    options.output,
    generateReport(results, options, provenance, environment),
    "utf8",
  );
  console.log(`Report written: ${options.output}`);
}

main().catch((error) => {
  console.error(
    `Benchmark failed: ${error instanceof Error ? error.stack : error}`,
  );
  process.exit(1);
});
