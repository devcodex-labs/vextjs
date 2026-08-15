/**
 * Enterprise Workload Suite runner.
 *
 * This is deliberately separate from run-adapter-matrix.mjs. The Adapter
 * Matrix compares Vext adapters with one Vext application; this suite compares
 * equivalent production-shaped API semantics across three distinct stacks.
 */

import { execFileSync, fork, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import autocannon from "autocannon";
import {
  ENTERPRISE_BENCHMARK_PACKAGES,
  readLocalBenchmarkVersions,
  verifyLatestBenchmarkDependencies,
} from "../dependency-versions.mjs";
import { ENTERPRISE_ARCHITECTURE_MAPPING } from "./architecture-mapping.mjs";
import {
  ENTERPRISE_CONTROL_PREFIX,
  ENTERPRISE_SECURITY_HEADERS,
  ENTERPRISE_SUITE_ID,
  ENTERPRISE_SUITE_VERSION,
  ENTERPRISE_TARGETS,
  ENTERPRISE_WORKLOADS,
  createFailureRequest,
  createWorkloadRequest,
} from "./contract.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPOSITORY_ROOT = resolve(__dirname, "../../..");
const DEFAULT_PROTOCOL_PATH = join(__dirname, "protocols", "linux-x64-v1.json");
const DEFAULT_RESULTS_PATH = join(
  REPOSITORY_ROOT,
  "test",
  "benchmark",
  ".artifacts",
  "enterprise-latest.json",
);
const PACKAGE_METADATA = JSON.parse(
  readFileSync(join(REPOSITORY_ROOT, "package.json"), "utf8"),
);
const TARGETS = ENTERPRISE_TARGETS.map((target) => ({
  ...target,
  entry: join(__dirname, "targets", `${target.id}.mjs`),
}));

function parseArgs() {
  const options = {
    duration: 3,
    warmup: 1,
    rounds: 3,
    connections: 25,
    pipelining: 1,
    protocolPath: DEFAULT_PROTOCOL_PATH,
    resultsJson: DEFAULT_RESULTS_PATH,
    formal: false,
    pilot: false,
    loadCpus: undefined,
    targetCpus: undefined,
    explicit: new Set(),
  };
  const args = process.argv.slice(2);
  const next = (index) => args[index + 1];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--duration":
        options.duration = Number(next(index));
        options.explicit.add("duration");
        index += 1;
        break;
      case "--warmup":
        options.warmup = Number(next(index));
        options.explicit.add("warmup");
        index += 1;
        break;
      case "--rounds":
        options.rounds = Number(next(index));
        options.explicit.add("rounds");
        index += 1;
        break;
      case "--connections":
        options.connections = Number(next(index));
        options.explicit.add("connections");
        index += 1;
        break;
      case "--pipelining":
        options.pipelining = Number(next(index));
        options.explicit.add("pipelining");
        index += 1;
        break;
      case "--protocol":
        options.protocolPath = resolve(REPOSITORY_ROOT, next(index));
        index += 1;
        break;
      case "--results-json":
        options.resultsJson = resolve(REPOSITORY_ROOT, next(index));
        index += 1;
        break;
      case "--load-cpus":
        options.loadCpus = next(index);
        index += 1;
        break;
      case "--target-cpus":
        options.targetCpus = next(index);
        index += 1;
        break;
      case "--formal":
        options.formal = true;
        break;
      case "--pilot":
        options.pilot = true;
        break;
      case "--help":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (options.formal && options.pilot) {
    throw new Error("--formal and --pilot cannot be combined");
  }
  return options;
}

function printHelp() {
  console.log(
    `\n${ENTERPRISE_SUITE_ID}\n\nLocal pilot (non-citable):\n  npm run test:bench:enterprise -- --pilot\n\nFormal run (Linux x64 only, after the protocol is frozen from a pilot):\n  taskset -c <load-cpus> node test/benchmark/enterprise/run-enterprise-suite.mjs --formal --load-cpus <load-cpus> --target-cpus <target-cpus>\n`,
  );
}

function assertPositiveInteger(name, value, { allowZero = false } = {}) {
  if (!Number.isInteger(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(
      `--${name} must be a ${allowZero ? "non-negative" : "positive"} integer; received ${value}`,
    );
  }
}

async function loadProtocol(protocolPath) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(protocolPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to read enterprise benchmark protocol ${protocolPath}: ${error instanceof Error ? error.message : error}`,
    );
  }
  for (const key of [
    "id",
    "status",
    "connections",
    "pipelining",
    "warmupSeconds",
    "durationSeconds",
    "rounds",
  ]) {
    if (parsed[key] === undefined) {
      throw new Error(`Enterprise benchmark protocol is missing ${key}`);
    }
  }
  return parsed;
}

function applyFormalProtocol(options, protocol) {
  const mapping = {
    duration: protocol.durationSeconds,
    warmup: protocol.warmupSeconds,
    rounds: protocol.rounds,
    connections: protocol.connections,
    pipelining: protocol.pipelining,
  };
  for (const [key, value] of Object.entries(mapping)) {
    if (options.explicit.has(key) && options[key] !== value) {
      throw new Error(
        `Formal protocol ${protocol.id} fixes --${key}=${value}; received ${options[key]}`,
      );
    }
    options[key] = value;
  }
}

function validateOptions(options) {
  for (const key of [
    "duration",
    "warmup",
    "rounds",
    "connections",
    "pipelining",
  ]) {
    assertPositiveInteger(key, options[key], { allowZero: key === "warmup" });
  }
  if (options.pipelining !== 1) {
    throw new Error("Enterprise Workload Suite requires --pipelining 1");
  }
}

function readGit(args) {
  return execFileSync("git", args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function readSourceProvenance() {
  const status = readGit([
    "status",
    "--porcelain=v1",
    "--",
    ".",
    ":(exclude)test/benchmark/.artifacts",
  ]);
  return {
    branch: readGit(["branch", "--show-current"]),
    commit: readGit(["rev-parse", "HEAD"]),
    worktree: status ? "dirty" : "clean",
  };
}

function parseCpuSet(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("CPU set must be a non-empty list such as 0-3,6-7");
  }
  const cpus = new Set();
  for (const part of value.split(",")) {
    const [startRaw, endRaw] = part.trim().split("-");
    const start = Number(startRaw);
    const end = endRaw === undefined ? start : Number(endRaw);
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start
    ) {
      throw new Error(`Invalid CPU set entry: ${part}`);
    }
    for (let cpu = start; cpu <= end; cpu += 1) cpus.add(cpu);
  }
  return cpus;
}

function readCurrentCpuSet() {
  if (process.platform !== "linux") return undefined;
  const status = readFileSync("/proc/self/status", "utf8");
  const match = /^Cpus_allowed_list:\s*(.+)$/mu.exec(status);
  return match?.[1]?.trim();
}

function assertFormalEnvironment({ options, protocol, provenance }) {
  if (protocol.status !== "frozen") {
    throw new Error(
      `Formal execution requires a pilot-frozen protocol; ${protocol.id} is ${protocol.status}`,
    );
  }
  if (!Number.isFinite(protocol.maxCv) || protocol.maxCv <= 0) {
    throw new Error(
      `Formal protocol ${protocol.id} must define a positive pilot-frozen maxCv`,
    );
  }
  if (!Number.isInteger(protocol.nodeMajor) || protocol.nodeMajor <= 0) {
    throw new Error(
      `Formal protocol ${protocol.id} must pin the current-LTS nodeMajor from its qualifying pilot`,
    );
  }
  const runningNodeMajor = Number(process.versions.node.split(".")[0]);
  if (runningNodeMajor !== protocol.nodeMajor) {
    throw new Error(
      `Formal protocol ${protocol.id} requires Node.js ${protocol.nodeMajor}.x; running ${process.version}`,
    );
  }
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error(
      "Formal Enterprise Workload Suite artifacts require Linux x64",
    );
  }
  if (provenance.worktree !== "clean") {
    throw new Error(
      "Formal Enterprise Workload Suite artifacts require a clean source worktree",
    );
  }
  if (!options.loadCpus || !options.targetCpus) {
    throw new Error(
      "Formal execution requires --load-cpus and --target-cpus with no overlap",
    );
  }
  const loadCpus = parseCpuSet(options.loadCpus);
  const targetCpus = parseCpuSet(options.targetCpus);
  for (const cpu of loadCpus) {
    if (targetCpus.has(cpu)) {
      throw new Error(`Formal load and target CPU sets overlap at CPU ${cpu}`);
    }
  }
  const effectiveLoadCpus = readCurrentCpuSet();
  if (!effectiveLoadCpus) {
    throw new Error(
      "Unable to verify runner CPU affinity from /proc/self/status",
    );
  }
  const actual = parseCpuSet(effectiveLoadCpus);
  if (
    actual.size !== loadCpus.size ||
    [...actual].some((cpu) => !loadCpus.has(cpu))
  ) {
    throw new Error(
      `Runner CPU affinity ${effectiveLoadCpus} does not match --load-cpus ${options.loadCpus}; launch the runner under taskset`,
    );
  }
}

function getEnvironment() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    runnerCpuSet: readCurrentCpuSet() ?? "unavailable",
  };
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function summarizeSamples(samples) {
  if (samples.length === 0) throw new Error("Cannot summarize zero samples");
  const ordered = [...samples].sort((left, right) => left.rps - right.rps);
  const medianSample = { ...ordered[Math.floor(ordered.length / 2)] };
  const rps = samples.map((sample) => sample.rps);
  const mean = average(rps);
  return {
    ...medianSample,
    samples,
    rps: {
      median: medianSample.rps,
      mean,
      min: ordered[0].rps,
      max: ordered.at(-1).rps,
      cv: mean === 0 ? 0 : (standardDeviation(rps) / mean) * 100,
    },
    p50LatencyMs: median(samples.map((sample) => sample.p50LatencyMs)),
    p95LatencyMs: median(samples.map((sample) => sample.p95LatencyMs)),
    p99LatencyMs: median(samples.map((sample) => sample.p99LatencyMs)),
    cpuMicrosecondsPer1kRequests: median(
      samples.map((sample) => sample.cpuMicrosecondsPer1kRequests),
    ),
    rss: median(samples.map((sample) => sample.rss)),
    peakRss: median(samples.map((sample) => sample.peakRss)),
  };
}

function rotateTargets(round) {
  const offset = round % TARGETS.length;
  return [...TARGETS.slice(offset), ...TARGETS.slice(0, offset)];
}

function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
        } else if (typeof address === "object" && address) {
          resolvePort(address.port);
        } else {
          reject(new Error("Unable to reserve a TCP port"));
        }
      });
    });
  });
}

function startTarget(target, port, options) {
  return new Promise((resolveTarget, reject) => {
    const env = {
      ...process.env,
      PORT: String(port),
    };
    const child = options.formal
      ? spawn(
          "taskset",
          ["-c", options.targetCpus, process.execPath, target.entry],
          {
            env,
            stdio: ["ignore", "pipe", "pipe", "ipc"],
          },
        )
      : fork(target.entry, [], {
          env,
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        });
    let stderr = "";
    let settled = false;
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };
    const resolveOnce = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveTarget(value);
    };
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const timeout = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // This runner owns the child and only needs best-effort cleanup here.
      }
      rejectOnce(new Error(`${target.title} startup timed out: ${stderr}`));
    }, 15_000);
    child.on("message", (message) => {
      if (message?.type === "ready") {
        resolveOnce({
          target,
          process: child,
          port: message.port ?? port,
          runtime: message.runtime ?? {},
        });
      } else if (message?.type === "error") {
        rejectOnce(
          new Error(`${target.title} startup failed: ${message.message}`),
        );
      }
    });
    child.once("error", rejectOnce);
    child.once("exit", (code) => {
      if (!settled) {
        rejectOnce(
          new Error(`${target.title} exited ${code ?? "unknown"}: ${stderr}`),
        );
      }
    });
  });
}

function stopTarget(server) {
  if (
    !server?.process ||
    (server.process.exitCode !== null && server.process.exitCode !== undefined)
  ) {
    return Promise.resolve();
  }
  return new Promise((resolveStop) => {
    const timeout = setTimeout(() => {
      try {
        server.process.kill("SIGKILL");
      } catch {
        // The runner only owns this child process.
      }
      resolveStop();
    }, 5_000);
    server.process.once("exit", () => {
      clearTimeout(timeout);
      resolveStop();
    });
    try {
      server.process.kill("SIGTERM");
    } catch {
      clearTimeout(timeout);
      resolveStop();
    }
  });
}

function baseUrl(server) {
  return `http://127.0.0.1:${server.port}`;
}

async function requestJson(server, path, request = {}) {
  const method = request.method ?? "GET";
  const response = await fetch(`${baseUrl(server)}${path}`, {
    method,
    headers: request.headers,
    body:
      request.body === undefined || ["GET", "HEAD"].includes(method)
        ? undefined
        : JSON.stringify(request.body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
  };
}

async function resetTarget(server) {
  const response = await requestJson(
    server,
    `${ENTERPRISE_CONTROL_PREFIX}/reset`,
    {
      method: "POST",
    },
  );
  if (response.status !== 200) {
    throw new Error(
      `${server.target.title} reset failed with ${response.status}`,
    );
  }
}

async function getTargetStats(server) {
  const response = await requestJson(
    server,
    `${ENTERPRISE_CONTROL_PREFIX}/stats`,
  );
  if (response.status !== 200 || !response.body?.counters) {
    throw new Error(
      `${server.target.title} stats endpoint returned an invalid payload`,
    );
  }
  return response.body;
}

function assertSecurityHeaders(response, target) {
  for (const [name, value] of Object.entries(ENTERPRISE_SECURITY_HEADERS)) {
    if (response.headers[name] !== value) {
      throw new Error(
        `${target.title} missing security header ${name}=${value}; received ${response.headers[name]}`,
      );
    }
  }
}

function assertSuccessResponse(response, target, requestId) {
  const order = response.body?.data?.order;
  if (
    response.status !== 201 ||
    typeof order?.id !== "string" ||
    order.userId !== "10001" ||
    response.body?.meta?.requestId !== requestId ||
    response.body?.meta?.tenantId !== "benchmark-tenant" ||
    typeof response.body?.meta?.traceId !== "string"
  ) {
    throw new Error(
      `${target.title} success contract mismatch: ${JSON.stringify(response)}`,
    );
  }
  assertSecurityHeaders(response, target);
}

async function assertZeroWrites(server, label) {
  const stats = await getTargetStats(server);
  if (stats.repository.writes !== 0 || stats.counters.repositoryWrite !== 0) {
    throw new Error(
      `${server.target.title} wrote a repository record for ${label}`,
    );
  }
  return stats;
}

async function runConformance(server) {
  const statuses = {};
  await resetTarget(server);
  const successRequest = createWorkloadRequest(
    ENTERPRISE_WORKLOADS[0],
    "contract-success",
  );
  const success = await requestJson(
    server,
    successRequest.path,
    successRequest,
  );
  assertSuccessResponse(success, server.target, "contract-success");
  const successStats = await getTargetStats(server);
  if (
    successStats.repository.writes !== 1 ||
    successStats.counters.repositoryWrite !== 1 ||
    successStats.counters.controller !== 1 ||
    successStats.counters.authentication < 1 ||
    successStats.counters.authorization < 1 ||
    successStats.counters.validation < 1 ||
    successStats.counters.structuredLog < 1
  ) {
    throw new Error(
      `${server.target.title} success telemetry mismatch: ${JSON.stringify(successStats)}`,
    );
  }
  statuses.success = success.status;

  for (const [label, expectedStatus] of [
    ["missing-auth", 401],
    ["forbidden", 403],
    ["invalid-body", 422],
  ]) {
    await resetTarget(server);
    const request = createFailureRequest(label, `contract-${label}`);
    const response = await requestJson(server, request.path, request);
    if (response.status !== expectedStatus || !response.body?.requestId) {
      throw new Error(
        `${server.target.title} ${label} contract mismatch: ${JSON.stringify(response)}`,
      );
    }
    assertSecurityHeaders(response, server.target);
    await assertZeroWrites(server, label);
    statuses[label] = response.status;
  }

  for (const label of ["wrong-method", "wrong-content-type"]) {
    await resetTarget(server);
    const request = createFailureRequest(label, `contract-${label}`);
    const response = await requestJson(server, request.path, request);
    if (response.status < 400) {
      throw new Error(`${server.target.title} accepted ${label}`);
    }
    assertSecurityHeaders(response, server.target);
    await assertZeroWrites(server, label);
    statuses[label] = response.status;
  }
  return statuses;
}

function countStatusEntry(value) {
  if (typeof value === "number") return value;
  if (value && typeof value.count === "number") return value.count;
  return 0;
}

function normalizeStatusDistribution(statusCodeStats = {}) {
  return Object.fromEntries(
    Object.entries(statusCodeStats).map(([status, value]) => [
      status,
      countStatusEntry(value),
    ]),
  );
}

function statusDistributionMatches(statusDistribution, expectedStatus) {
  const expectedClass = `${Math.floor(expectedStatus / 100)}xx`;
  return Object.entries(statusDistribution).every(([status, count]) => {
    if (count === 0) return true;
    return (
      status === String(expectedStatus) ||
      status.toLowerCase() === expectedClass
    );
  });
}

async function runAutocannon(server, workload, options, phase, round) {
  const request = createWorkloadRequest(
    workload,
    `benchmark-${workload.id}-${round}-${server.target.id}`,
  );
  const result = await autocannon({
    url: `${baseUrl(server)}${request.path}`,
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(request.body),
    duration: phase === "warmup" ? options.warmup : options.duration,
    connections: options.connections,
    pipelining: options.pipelining,
  });
  const statusDistribution = normalizeStatusDistribution(
    result.statusCodeStats,
  );
  // Autocannon's elapsed-window total can exclude responses that were already
  // in flight at the final tick. The status distribution is the completed
  // HTTP-response count and is therefore the only count safe to compare with
  // the target's exactly-once repository telemetry.
  const completedResponses = Object.values(statusDistribution).reduce(
    (sum, count) => sum + count,
    0,
  );
  const totalRequests = completedResponses || result.requests?.total || 0;
  if (
    totalRequests <= 0 ||
    (result.errors ?? 0) > 0 ||
    (result.timeouts ?? 0) > 0 ||
    !statusDistributionMatches(statusDistribution, workload.expectedStatus)
  ) {
    throw new Error(
      `${server.target.title} ${workload.id} ${phase} failed: ${JSON.stringify({
        errors: result.errors,
        timeouts: result.timeouts,
        non2xx: result.non2xx,
        statusDistribution,
      })}`,
    );
  }
  return {
    rps: result.requests?.average ?? 0,
    totalRequests,
    p50LatencyMs: result.latency?.p50 ?? 0,
    p95LatencyMs: result.latency?.p95 ?? 0,
    p99LatencyMs: result.latency?.p99 ?? 0,
    errors: result.errors ?? 0,
    timeouts: result.timeouts ?? 0,
    non2xx: result.non2xx ?? 0,
    statusDistribution,
  };
}

async function measureTarget(server, workload, options, round) {
  if (options.warmup > 0) {
    await resetTarget(server);
    await runAutocannon(server, workload, options, "warmup", round);
  }
  await resetTarget(server);
  const measurement = await runAutocannon(
    server,
    workload,
    options,
    "measurement",
    round,
  );
  const stats = await getTargetStats(server);
  const processedRequests = stats.counters.requestId;
  const trailingRequestLimit = options.connections * options.pipelining;
  if (
    processedRequests < measurement.totalRequests ||
    processedRequests > measurement.totalRequests + trailingRequestLimit
  ) {
    throw new Error(
      `${server.target.title} processed-request telemetry is outside the allowed in-flight window for ${workload.id}: ${JSON.stringify(
        {
          reported: measurement.totalRequests,
          processedRequests,
          trailingRequestLimit,
        },
      )}`,
    );
  }
  const expectedWrites =
    workload.expectedStatus === 201 ? processedRequests : 0;
  if (
    stats.repository.writes !== expectedWrites ||
    stats.counters.repositoryWrite !== expectedWrites ||
    (workload.expectedStatus === 201 &&
      stats.counters.controller !== expectedWrites)
  ) {
    throw new Error(
      `${server.target.title} telemetry mismatch for ${workload.id}: ${JSON.stringify(
        {
          expectedWrites,
          counters: stats.counters,
          repository: stats.repository,
        },
      )}`,
    );
  }
  const cpuMicroseconds =
    stats.resource.cpuMicroseconds.user + stats.resource.cpuMicroseconds.system;
  return {
    round,
    ...measurement,
    reportedTotalRequests: measurement.totalRequests,
    totalRequests: processedRequests,
    cpuMicroseconds,
    cpuMicrosecondsPer1kRequests: (cpuMicroseconds / processedRequests) * 1_000,
    rss: stats.resource.rss,
    peakRss: stats.resource.peakRss,
    telemetry: stats.counters,
  };
}

async function runMeasurements(servers, options) {
  const results = [];
  for (const workload of ENTERPRISE_WORKLOADS) {
    const samplesByTarget = Object.fromEntries(
      TARGETS.map((target) => [target.id, []]),
    );
    const orderByRound = [];
    for (let round = 0; round < options.rounds; round += 1) {
      const order = rotateTargets(round);
      orderByRound.push(order.map((target) => target.id));
      for (const target of order) {
        const server = servers.get(target.id);
        samplesByTarget[target.id].push(
          await measureTarget(server, workload, options, round),
        );
      }
    }
    results.push({
      workload: {
        id: workload.id,
        title: workload.title,
        expectedStatus: workload.expectedStatus,
        delayMs: workload.delayMs,
        description: workload.description,
      },
      targetOrderByRound: orderByRound,
      targets: Object.fromEntries(
        TARGETS.map((target) => [
          target.id,
          summarizeSamples(samplesByTarget[target.id]),
        ]),
      ),
    });
  }
  return results;
}

function findUnstableResults(results, maxCv) {
  if (!Number.isFinite(maxCv)) return [];
  return results.flatMap((result) =>
    Object.entries(result.targets)
      .filter(([, metrics]) => metrics.rps.cv > maxCv)
      .map(([targetId, metrics]) => ({
        workload: result.workload.id,
        targetId,
        cv: metrics.rps.cv,
      })),
  );
}

function assertFastifyHostParity(servers, expectedVersion) {
  for (const targetId of ["fastify-native", "nest-fastify"]) {
    const version = servers.get(targetId)?.runtime?.fastify;
    if (version !== expectedVersion) {
      throw new Error(
        `${targetId} is not running the benchmark-pinned Fastify ${expectedVersion}; reported ${version ?? "missing"}`,
      );
    }
  }
}

function assertTargetCpuAffinity(servers, expectedCpuSet) {
  const expected = parseCpuSet(expectedCpuSet);
  for (const target of TARGETS) {
    const reported = servers.get(target.id)?.runtime?.cpuSet;
    let actual;
    try {
      actual = parseCpuSet(reported);
    } catch {
      throw new Error(
        `${target.title} did not report a verifiable effective CPU affinity; reported ${reported ?? "missing"}`,
      );
    }
    if (
      actual.size !== expected.size ||
      [...actual].some((cpu) => !expected.has(cpu))
    ) {
      throw new Error(
        `${target.title} CPU affinity ${reported} does not match --target-cpus ${expectedCpuSet}`,
      );
    }
  }
}

function createPilotRecommendation(results) {
  const observed = results.flatMap((result) =>
    Object.entries(result.targets).map(([targetId, metrics]) => ({
      workload: result.workload.id,
      targetId,
      cv: metrics.rps.cv,
    })),
  );
  const observedMaxCv = Math.max(...observed.map((entry) => entry.cv));
  return {
    observed,
    observedMaxCv,
    proposedMaxCv: Math.min(25, Math.max(5, Math.ceil(observedMaxCv + 3))),
    method:
      "ceil(observed maximum RPS CV + 3 percentage points), bounded to 5%–25%; maintainers must review and explicitly freeze it in the protocol before a formal run.",
  };
}

async function main() {
  const options = parseArgs();
  const protocol = await loadProtocol(options.protocolPath);
  if (options.formal) applyFormalProtocol(options, protocol);
  validateOptions(options);

  const provenance = readSourceProvenance();
  if (options.formal)
    assertFormalEnvironment({ options, protocol, provenance });
  if (!existsSync(join(REPOSITORY_ROOT, "dist", "lib", "bootstrap.js"))) {
    throw new Error(
      "Vext build output is missing; run npm run build before the suite",
    );
  }

  const dependencyVerification = await verifyLatestBenchmarkDependencies({
    repositoryRoot: REPOSITORY_ROOT,
    packageNames: ENTERPRISE_BENCHMARK_PACKAGES,
  });
  const ports = await Promise.all(TARGETS.map(() => reservePort()));
  const servers = new Map();
  try {
    for (const [index, target] of TARGETS.entries()) {
      const server = await startTarget(target, ports[index], options);
      servers.set(target.id, server);
      const health = await requestJson(
        server,
        `${ENTERPRISE_CONTROL_PREFIX}/health`,
      );
      if (health.status !== 200 || health.body?.target !== target.id) {
        throw new Error(`${target.title} did not satisfy the health contract`);
      }
    }
    assertFastifyHostParity(servers, dependencyVerification.versions.fastify);
    if (options.formal) {
      assertTargetCpuAffinity(servers, options.targetCpus);
    }

    const conformance = {};
    for (const target of TARGETS) {
      conformance[target.id] = await runConformance(servers.get(target.id));
    }
    const results = await runMeasurements(servers, options);
    const maxCv = options.formal ? protocol.maxCv : undefined;
    const unstable = findUnstableResults(results, maxCv);
    const pilot = options.pilot ? createPilotRecommendation(results) : null;
    if (options.formal && unstable.length > 0) {
      throw new Error(`Formal CV gate failed: ${JSON.stringify(unstable)}`);
    }
    const localVersions = readLocalBenchmarkVersions(REPOSITORY_ROOT, {
      packageNames: ENTERPRISE_BENCHMARK_PACKAGES,
    });
    const artifact = {
      schemaVersion: 1,
      suite: ENTERPRISE_SUITE_ID,
      suiteVersion: ENTERPRISE_SUITE_VERSION,
      recordedAt: new Date().toISOString(),
      complete: true,
      acceptedForPublication: options.formal && unstable.length === 0,
      executionMode: options.formal
        ? "formal"
        : options.pilot
          ? "pilot"
          : "local",
      protocol: {
        ...protocol,
        maxCv: protocol.maxCv ?? null,
      },
      options: {
        duration: options.duration,
        warmup: options.warmup,
        rounds: options.rounds,
        connections: options.connections,
        pipelining: options.pipelining,
        targetScheduling: "round-interleaved-rotating",
        loadCpus: options.loadCpus ?? null,
        targetCpus: options.targetCpus ?? null,
      },
      provenance,
      environment: getEnvironment(),
      dependencyVerification,
      frameworkVersions: {
        vextjs: PACKAGE_METADATA.version,
        ...localVersions,
      },
      architecture: ENTERPRISE_ARCHITECTURE_MAPPING,
      targetRuntime: Object.fromEntries(
        [...servers.entries()].map(([targetId, server]) => [
          targetId,
          server.runtime ?? {},
        ]),
      ),
      conformance,
      results,
      stability: {
        maxCv,
        unstable,
      },
      pilot,
    };
    await mkdir(dirname(options.resultsJson), { recursive: true });
    await writeFile(
      options.resultsJson,
      `${JSON.stringify(artifact, null, 2)}\n`,
    );
    console.log(
      JSON.stringify(
        {
          suite: artifact.suite,
          executionMode: artifact.executionMode,
          acceptedForPublication: artifact.acceptedForPublication,
          resultsJson: options.resultsJson,
          workloads: results.length,
          targets: TARGETS.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.all(
      [...servers.values()].map((server) => stopTarget(server)),
    );
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  process.exitCode = 1;
});
