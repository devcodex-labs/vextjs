/**
 * Framework-native Product-stack Enterprise API benchmark runner.
 *
 * The Adapter Matrix answers a different question: it keeps one Vext
 * application fixed and swaps adapters. This suite compares three documented
 * production paths that implement the same API semantics and capability set.
 * It never turns a local smoke/pilot observation into a publishable number.
 */

import { execFileSync, fork, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import autocannon from "autocannon";
import {
  FRAMEWORK_NATIVE_BENCHMARK_PACKAGES,
  readLocalBenchmarkVersions,
  verifyLatestBenchmarkDependencies,
} from "../dependency-versions.mjs";
import {
  CONTROL_PREFIX,
  FRAMEWORK_NATIVE_SUITE_ID,
  FRAMEWORK_NATIVE_SUITE_VERSION,
  FRAMEWORK_NATIVE_TARGETS,
  FRAMEWORK_NATIVE_WORKLOADS,
  createBenchmarkTokens,
  createNegativeProbe,
  createWorkloadRequest,
  semanticResponseHash,
} from "./contract.mjs";
import {
  FRAMEWORK_NATIVE_IMPLEMENTATION_MANIFEST,
  assertImplementationManifest,
} from "./implementation-manifest.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPOSITORY_ROOT = resolve(__dirname, "../../..");
const DEFAULT_PROTOCOL_PATH = join(__dirname, "protocols", "linux-x64-v1.json");
const DEFAULT_RESULTS_PATH = join(
  REPOSITORY_ROOT,
  "test",
  "benchmark",
  ".artifacts",
  "framework-native-latest.json",
);
const PACKAGE_METADATA = JSON.parse(
  readFileSync(join(REPOSITORY_ROOT, "package.json"), "utf8"),
);
const TARGETS = FRAMEWORK_NATIVE_TARGETS.map((target) => ({
  ...target,
  entry: join(__dirname, "targets", `${target.id}.mjs`),
}));
const SIDECAR_ENTRY = join(__dirname, "external-quote-sidecar.mjs");

function parseArgs() {
  const options = {
    duration: 3,
    warmup: 1,
    rounds: 3,
    connections: 20,
    pipelining: 1,
    protocolPath: DEFAULT_PROTOCOL_PATH,
    resultsJson: DEFAULT_RESULTS_PATH,
    formal: false,
    pilot: false,
    smoke: false,
    loadCpus: undefined,
    targetCpus: undefined,
    explicit: new Set(),
  };
  const args = process.argv.slice(2);
  const next = (index) => args[index + 1];
  const readNumber = (index, name) => {
    const raw = next(index);
    if (raw === undefined) throw new Error(`${name} requires a value`);
    return Number(raw);
  };

  for (let index = 0; index < args.length; index += 1) {
    switch (args[index]) {
      case "--duration":
        options.duration = readNumber(index, "--duration");
        options.explicit.add("duration");
        index += 1;
        break;
      case "--warmup":
        options.warmup = readNumber(index, "--warmup");
        options.explicit.add("warmup");
        index += 1;
        break;
      case "--rounds":
        options.rounds = readNumber(index, "--rounds");
        options.explicit.add("rounds");
        index += 1;
        break;
      case "--connections":
        options.connections = readNumber(index, "--connections");
        options.explicit.add("connections");
        index += 1;
        break;
      case "--pipelining":
        options.pipelining = readNumber(index, "--pipelining");
        options.explicit.add("pipelining");
        index += 1;
        break;
      case "--protocol":
        options.protocolPath = resolve(REPOSITORY_ROOT, next(index) ?? "");
        index += 1;
        break;
      case "--results-json":
        options.resultsJson = resolve(REPOSITORY_ROOT, next(index) ?? "");
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
      case "--smoke":
        options.smoke = true;
        break;
      case "--help":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${args[index]}`);
    }
  }

  if (
    [options.formal, options.pilot, options.smoke].filter(Boolean).length > 1
  ) {
    throw new Error("--formal, --pilot, and --smoke are mutually exclusive");
  }
  if (options.smoke) {
    const smokeDefaults = {
      duration: 1,
      warmup: 0,
      rounds: 1,
      connections: 2,
      pipelining: 1,
    };
    for (const [key, value] of Object.entries(smokeDefaults)) {
      if (!options.explicit.has(key)) options[key] = value;
    }
  }
  return options;
}

function printHelp() {
  console.log(`
${FRAMEWORK_NATIVE_SUITE_ID}

Local smoke (implementation/conformance only; never citable):
  npm run build
  npm run test:bench:enterprise -- --smoke

Local pilot (records complete but non-citable observations):
  npm run test:bench:enterprise -- --pilot

Formal run (Linux x64, clean tree, accepted protocol, and separated CPU sets):
  taskset -c <load-cpus> node test/benchmark/framework-native/run-framework-native-suite.mjs \\
    --formal --load-cpus <load-cpus> --target-cpus <target-cpus>
`);
}

function assertPositiveInteger(name, value, { allowZero = false } = {}) {
  if (!Number.isInteger(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(
      `--${name} must be a ${allowZero ? "non-negative" : "positive"} integer; received ${value}`,
    );
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
    throw new Error(
      "Framework-native product-stack runs require --pipelining 1",
    );
  }
}

async function loadProtocol(protocolPath) {
  let protocol;
  try {
    protocol = JSON.parse(await readFile(protocolPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to read framework-native benchmark protocol ${protocolPath}: ${error instanceof Error ? error.message : error}`,
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
    "maxCvPercent",
    "requiredPlatform",
    "requiredArch",
  ]) {
    if (protocol[key] === undefined) {
      throw new Error(`Framework-native protocol is missing ${key}`);
    }
  }
  return protocol;
}

function applyFormalProtocol(options, protocol) {
  const fixed = {
    duration: protocol.durationSeconds,
    warmup: protocol.warmupSeconds,
    rounds: protocol.rounds,
    connections: protocol.connections,
    pipelining: protocol.pipelining,
  };
  for (const [key, value] of Object.entries(fixed)) {
    if (options.explicit.has(key) && options[key] !== value) {
      throw new Error(
        `Formal protocol ${protocol.id} fixes --${key}=${value}; received ${options[key]}`,
      );
    }
    options[key] = value;
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
  for (const rawPart of value.split(",")) {
    const [startRaw, endRaw] = rawPart.trim().split("-");
    const start = Number(startRaw);
    const end = endRaw === undefined ? start : Number(endRaw);
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start
    ) {
      throw new Error(`Invalid CPU set entry: ${rawPart}`);
    }
    for (let cpu = start; cpu <= end; cpu += 1) cpus.add(cpu);
  }
  return cpus;
}

function readCurrentCpuSet() {
  if (process.platform !== "linux") return undefined;
  try {
    return /^Cpus_allowed_list:\s*(.+)$/mu
      .exec(readFileSync("/proc/self/status", "utf8"))?.[1]
      ?.trim();
  } catch {
    return undefined;
  }
}

function sameCpuSet(left, right) {
  return left.size === right.size && [...left].every((cpu) => right.has(cpu));
}

function assertFormalEnvironment({ options, protocol, provenance }) {
  if (protocol.status !== "accepted") {
    throw new Error(
      `Formal execution requires an accepted protocol; ${protocol.id} is ${protocol.status}`,
    );
  }
  if (
    process.platform !== protocol.requiredPlatform ||
    process.arch !== protocol.requiredArch
  ) {
    throw new Error(
      `Formal execution requires ${protocol.requiredPlatform} ${protocol.requiredArch}; running ${process.platform} ${process.arch}`,
    );
  }
  if (provenance.worktree !== "clean") {
    throw new Error("Formal execution requires a clean source worktree");
  }
  if (!options.loadCpus || !options.targetCpus) {
    throw new Error(
      "Formal execution requires --load-cpus and --target-cpus with no overlap",
    );
  }
  const load = parseCpuSet(options.loadCpus);
  const target = parseCpuSet(options.targetCpus);
  for (const cpu of load) {
    if (target.has(cpu))
      throw new Error(`Formal load and target CPU sets overlap at CPU ${cpu}`);
  }
  const actual = readCurrentCpuSet();
  if (!actual || !sameCpuSet(parseCpuSet(actual), load)) {
    throw new Error(
      `Runner CPU affinity ${actual ?? "unavailable"} does not match --load-cpus ${options.loadCpus}; launch the runner with taskset`,
    );
  }
}

function environment() {
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

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function standardDeviation(values) {
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function summarizeSamples(samples) {
  if (samples.length === 0) throw new Error("Cannot summarize zero samples");
  const ordered = [...samples].sort((left, right) => left.rps - right.rps);
  const rpsValues = samples.map((sample) => sample.rps);
  const mean = average(rpsValues);
  const medianSample = ordered[Math.floor(ordered.length / 2)];
  return {
    rps: {
      median: medianSample.rps,
      mean,
      min: ordered[0].rps,
      max: ordered.at(-1).rps,
      cvPercent: mean === 0 ? 0 : (standardDeviation(rpsValues) / mean) * 100,
    },
    p50LatencyMs: median(samples.map((sample) => sample.p50LatencyMs)),
    p97_5LatencyMs: median(samples.map((sample) => sample.p97_5LatencyMs)),
    p99LatencyMs: median(samples.map((sample) => sample.p99LatencyMs)),
    targetCpuMicrosecondsPer1kRequests: median(
      samples.map((sample) => sample.targetCpuMicrosecondsPer1kRequests),
    ),
    targetRssBytes: median(samples.map((sample) => sample.targetRssBytes)),
    targetPeakRssBytes: median(
      samples.map((sample) => sample.targetPeakRssBytes),
    ),
    samples,
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
        if (error) return reject(error);
        if (typeof address === "object" && address)
          return resolvePort(address.port);
        return reject(new Error("Unable to reserve a TCP port"));
      });
    });
  });
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function baseUrl(server) {
  return `http://127.0.0.1:${server.port}`;
}

function startOwnedProcess({ entry, label, port, env, targetCpuSet }) {
  return new Promise((resolveServer, reject) => {
    const processEnv = { ...process.env, ...env, PORT: String(port) };
    const child = targetCpuSet
      ? spawn("taskset", ["-c", targetCpuSet, process.execPath, entry], {
          cwd: REPOSITORY_ROOT,
          env: processEnv,
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        })
      : fork(entry, [], {
          cwd: REPOSITORY_ROOT,
          env: processEnv,
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        });
    let stderr = "";
    let stdout = "";
    let settled = false;
    const stopOnFailure = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // The runner only owns this process and will also attempt final cleanup.
      }
    };
    const settle = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      handler(value);
    };
    const rejectOnce = (error) => {
      stopOnFailure();
      settle(reject, error);
    };
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const timeout = setTimeout(() => {
      rejectOnce(new Error(`${label} startup timed out: ${stderr || stdout}`));
    }, 20_000);
    child.on("message", (message) => {
      if (message?.type === "ready") {
        settle(resolveServer, {
          label,
          process: child,
          port: message.port ?? port,
          runtime: message.runtime ?? {},
        });
      } else if (message?.type === "error") {
        rejectOnce(new Error(`${label} startup failed: ${message.message}`));
      }
    });
    child.once("error", rejectOnce);
    child.once("exit", (code, signal) => {
      if (!settled) {
        rejectOnce(
          new Error(
            `${label} exited before ready (${code ?? "unknown"}/${signal ?? "none"}): ${stderr || stdout}`,
          ),
        );
      }
    });
  });
}

function stopOwnedProcess(server) {
  if (!server?.process || server.process.exitCode !== null)
    return Promise.resolve();
  return new Promise((resolveStop) => {
    const timeout = setTimeout(() => {
      try {
        server.process.kill("SIGKILL");
      } catch {
        // The process may already be gone.
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

function assertPortReleased(port) {
  return new Promise((resolveCheck, reject) => {
    const server = createServer();
    server.once("error", (error) =>
      reject(
        new Error(
          `Owned benchmark port ${port} was not released: ${error.message}`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => (error ? reject(error) : resolveCheck()));
    });
  });
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

async function requireHealth(server, expected) {
  const response = await requestJson(server, `${CONTROL_PREFIX}/health`);
  if (response.status !== 200 || response.body?.target !== expected) {
    throw new Error(
      `${expected} did not satisfy its health contract: ${JSON.stringify(response)}`,
    );
  }
}

async function resetTarget(server) {
  const response = await requestJson(server, `${CONTROL_PREFIX}/reset`, {
    method: "POST",
  });
  if (response.status !== 200)
    throw new Error(`${server.label} reset failed with ${response.status}`);
}

async function targetStats(server) {
  const response = await requestJson(server, `${CONTROL_PREFIX}/stats`);
  if (
    response.status !== 200 ||
    !response.body?.repository ||
    !response.body?.resource
  ) {
    throw new Error(`${server.label} returned invalid runtime stats`);
  }
  return response.body;
}

async function resetSidecar(sidecar) {
  const response = await requestJson(sidecar, `${CONTROL_PREFIX}/reset`, {
    method: "POST",
  });
  if (response.status !== 200)
    throw new Error(`Quote sidecar reset failed with ${response.status}`);
}

async function sidecarStats(sidecar) {
  const response = await requestJson(sidecar, `${CONTROL_PREFIX}/stats`);
  if (
    response.status !== 200 ||
    !Number.isInteger(response.body?.quoteRequests)
  ) {
    throw new Error("Quote sidecar returned invalid runtime stats");
  }
  return response.body;
}

function assertObservation({ target, workload, stats, quoteRequests }) {
  if (!stats.telemetryEnabled)
    throw new Error(`${target.title} disabled telemetry during conformance`);
  const counters = stats.counters ?? {};
  const success = workload.expectedStatus === 201;
  const requiresExternal = workload.id === "success-external-http";
  const expectedWrites = success ? 1 : 0;
  const expectedExternalCalls = requiresExternal ? 1 : 0;
  if (
    stats.repository.writes !== expectedWrites ||
    counters.repositoryWrite !== expectedWrites ||
    quoteRequests !== expectedExternalCalls
  ) {
    throw new Error(
      `${target.title} side-effect contract failed for ${workload.id}: ${JSON.stringify(
        {
          repository: stats.repository,
          repositoryWrite: counters.repositoryWrite,
          quoteRequests,
        },
      )}`,
    );
  }
  for (const counter of ["requestId", "requestContext", "authentication"]) {
    if (counters[counter] < 1) {
      throw new Error(
        `${target.title} did not execute ${counter} for ${workload.id}`,
      );
    }
  }
  if (workload.outcome === "auth-required") {
    if (
      counters.authorization !== 0 ||
      counters.validation !== 0 ||
      counters.controller !== 0
    ) {
      throw new Error(
        `${target.title} advanced an unauthenticated request beyond authentication`,
      );
    }
    return;
  }
  if (counters.authorization < 1) {
    throw new Error(
      `${target.title} did not execute authorization for ${workload.id}`,
    );
  }
  if (workload.outcome === "auth-forbidden") {
    if (
      counters.validation !== 0 ||
      counters.controller !== 0 ||
      counters.service !== 0
    ) {
      throw new Error(
        `${target.title} advanced a forbidden request into business handling`,
      );
    }
    return;
  }
  if (counters.validation < 1) {
    throw new Error(
      `${target.title} did not execute validation for ${workload.id}`,
    );
  }
  if (workload.outcome === "validation-failed") {
    if (counters.controller !== 0 || counters.service !== 0) {
      throw new Error(
        `${target.title} advanced an invalid request into business handling`,
      );
    }
    return;
  }
  for (const counter of ["controller", "service", "structuredLog"]) {
    if (counters[counter] < 1) {
      throw new Error(
        `${target.title} did not execute ${counter} for ${workload.id}`,
      );
    }
  }
  if (counters.externalHttp !== expectedExternalCalls) {
    throw new Error(
      `${target.title} external HTTP telemetry mismatch for ${workload.id}`,
    );
  }
}

async function assertNegativeProbe(server, tokens, kind) {
  await resetTarget(server);
  const request = createNegativeProbe(kind, tokens, `negative-${kind}`);
  const response = await requestJson(server, request.path, request);
  if (response.status < 400) {
    throw new Error(`${server.label} accepted the ${kind} negative probe`);
  }
  const stats = await targetStats(server);
  if (stats.repository.writes !== 0 || stats.counters?.repositoryWrite !== 0) {
    throw new Error(`${server.label} wrote a repository record for ${kind}`);
  }
  return response.status;
}

async function runConformance(servers, sidecar, tokens) {
  const byTarget = {};
  for (const target of TARGETS) {
    const server = servers.get(target.id);
    const workloads = {};
    for (const workload of FRAMEWORK_NATIVE_WORKLOADS) {
      await resetTarget(server);
      await resetSidecar(sidecar);
      const request = createWorkloadRequest(
        workload,
        tokens,
        `conformance-${workload.id}`,
      );
      const response = await requestJson(server, request.path, request);
      let semantic;
      try {
        semantic = semanticResponseHash(response, request, workload);
      } catch (error) {
        throw new Error(
          `${target.title} failed semantic conformance for ${workload.id}: ${error instanceof Error ? error.message : error}; response=${JSON.stringify(response)}`,
          { cause: error },
        );
      }
      const stats = await targetStats(server);
      const quote = await sidecarStats(sidecar);
      assertObservation({
        target,
        workload,
        stats,
        quoteRequests: quote.quoteRequests,
      });
      workloads[workload.id] = {
        status: response.status,
        semantic,
        observation: {
          repositoryWrites: stats.repository.writes,
          quoteRequests: quote.quoteRequests,
          counters: stats.counters,
        },
      };
    }
    const negativeProbes = {};
    for (const kind of [
      "wrong-method",
      "wrong-content-type",
      "invalid-token",
    ]) {
      negativeProbes[kind] = await assertNegativeProbe(server, tokens, kind);
    }
    byTarget[target.id] = { workloads, negativeProbes };
  }

  const semanticHashes = {};
  for (const workload of FRAMEWORK_NATIVE_WORKLOADS) {
    const entries = TARGETS.map((target) => ({
      targetId: target.id,
      semantic: byTarget[target.id].workloads[workload.id].semantic,
    }));
    const expected = entries[0].semantic.hash;
    if (entries.some((entry) => entry.semantic.hash !== expected)) {
      throw new Error(
        `Canonical semantic response hash mismatch for ${workload.id}: ${JSON.stringify(
          entries.map((entry) => ({
            targetId: entry.targetId,
            hash: entry.semantic.hash,
          })),
        )}`,
      );
    }
    semanticHashes[workload.id] = {
      algorithm: entries[0].semantic.algorithm,
      hash: expected,
      projection: entries[0].semantic.projection,
    };
  }
  return {
    semanticHashing: {
      canonicalized: true,
      rawSerializedBytesCompared: false,
      workloads: semanticHashes,
    },
    targets: byTarget,
  };
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
  return Object.entries(statusDistribution).every(
    ([status, count]) =>
      count === 0 ||
      status === String(expectedStatus) ||
      status.toLowerCase() === expectedClass,
  );
}

async function runAutocannon(server, workload, tokens, options, phase, round) {
  const request = createWorkloadRequest(
    workload,
    tokens,
    `measure-${workload.id}-${round}`,
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
      `${server.label} ${workload.id} ${phase} failed: ${JSON.stringify({
        errors: result.errors,
        timeouts: result.timeouts,
        non2xx: result.non2xx,
        statusDistribution,
      })}`,
    );
  }
  const latency = result.latency;
  for (const [name, value] of [
    ["P50", latency?.p50],
    ["P97.5", latency?.p97_5],
    ["P99", latency?.p99],
  ]) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(
        `${server.label} ${workload.id} ${phase} did not report finite ${name}`,
      );
    }
  }
  return {
    rps: result.requests?.average ?? 0,
    totalRequests,
    p50LatencyMs: latency.p50,
    p97_5LatencyMs: latency.p97_5,
    p99LatencyMs: latency.p99,
    errors: result.errors ?? 0,
    timeouts: result.timeouts ?? 0,
    non2xx: result.non2xx ?? 0,
    statusDistribution,
  };
}

function quiescenceSignature(stats) {
  return JSON.stringify(stats.repository);
}

async function waitForTargetQuiescence(
  server,
  { pollMs = 25, stableSamples = 3 } = {},
) {
  const deadline = Date.now() + 5_000;
  let lastSignature;
  let stable = 0;
  while (Date.now() < deadline) {
    const stats = await targetStats(server);
    const signature = quiescenceSignature(stats);
    stable = signature === lastSignature ? stable + 1 : 1;
    lastSignature = signature;
    if (stable >= stableSamples) return stats;
    await sleep(pollMs);
  }
  throw new Error(
    `${server.label} did not reach a quiescent measurement state`,
  );
}

function assertMeasurementSideEffects({
  server,
  workload,
  measurement,
  stats,
  quote,
  options,
}) {
  if (
    stats.telemetryEnabled ||
    Object.values(stats.counters ?? {}).some((count) => count !== 0)
  ) {
    throw new Error(
      `${server.label} left test telemetry enabled during measurement`,
    );
  }
  const trailingLimit = options.connections * options.pipelining;
  const success = workload.expectedStatus === 201;
  const writes = stats.repository.writes;
  if (success) {
    if (
      writes < measurement.totalRequests ||
      writes > measurement.totalRequests + trailingLimit
    ) {
      throw new Error(
        `${server.label} repository writes do not match completed responses`,
      );
    }
    if (workload.id === "success-external-http") {
      if (
        quote.quoteRequests < measurement.totalRequests ||
        quote.quoteRequests > measurement.totalRequests + trailingLimit
      ) {
        throw new Error(
          `${server.label} controlled external HTTP calls do not match responses`,
        );
      }
    } else if (quote.quoteRequests !== 0) {
      throw new Error(`${server.label} made an unexpected external HTTP call`);
    }
  } else if (writes !== 0 || quote.quoteRequests !== 0) {
    throw new Error(`${server.label} failure workload produced a side effect`);
  }
  return writes;
}

async function measureTarget(
  server,
  sidecar,
  workload,
  tokens,
  options,
  round,
) {
  if (options.warmup > 0) {
    await resetTarget(server);
    await resetSidecar(sidecar);
    await runAutocannon(server, workload, tokens, options, "warmup", round);
    await waitForTargetQuiescence(server);
  }
  await resetTarget(server);
  await resetSidecar(sidecar);
  const measurement = await runAutocannon(
    server,
    workload,
    tokens,
    options,
    "measurement",
    round,
  );
  const stats = await waitForTargetQuiescence(server);
  const quote = await sidecarStats(sidecar);
  const processedRequests = assertMeasurementSideEffects({
    server,
    workload,
    measurement,
    stats,
    quote,
    options,
  });
  const cpu =
    stats.resource.cpuMicroseconds.user + stats.resource.cpuMicroseconds.system;
  return {
    round,
    ...measurement,
    processedRequests,
    targetCpuMicrosecondsPer1kRequests:
      processedRequests === 0 ? 0 : (cpu / processedRequests) * 1_000,
    targetRssBytes: stats.resource.rss,
    targetPeakRssBytes: stats.resource.peakRss,
  };
}

async function runMeasurements(servers, sidecar, tokens, options) {
  const results = [];
  for (const workload of FRAMEWORK_NATIVE_WORKLOADS) {
    const samplesByTarget = Object.fromEntries(
      TARGETS.map((target) => [target.id, []]),
    );
    const targetOrderByRound = [];
    for (let round = 0; round < options.rounds; round += 1) {
      const order = rotateTargets(round);
      targetOrderByRound.push(order.map((target) => target.id));
      for (const target of order) {
        samplesByTarget[target.id].push(
          await measureTarget(
            servers.get(target.id),
            sidecar,
            workload,
            tokens,
            options,
            round,
          ),
        );
      }
    }
    results.push({
      workload: {
        id: workload.id,
        title: workload.title,
        expectedStatus: workload.expectedStatus,
        description: workload.description,
      },
      targetOrderByRound,
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

function findUnstableResults(results, maxCvPercent) {
  return results.flatMap((result) =>
    Object.entries(result.targets)
      .filter(([, metrics]) => metrics.rps.cvPercent > maxCvPercent)
      .map(([targetId, metrics]) => ({
        workload: result.workload.id,
        targetId,
        cvPercent: metrics.rps.cvPercent,
      })),
  );
}

function assertFastifyHostParity(servers, expectedVersion) {
  for (const targetId of ["fastify-native", "nest-fastify"]) {
    const version = servers.get(targetId)?.runtime?.fastify;
    if (version !== expectedVersion) {
      throw new Error(
        `${targetId} is not running benchmark-pinned Fastify ${expectedVersion}; reported ${version ?? "missing"}`,
      );
    }
  }
}

function assertTargetCpuAffinity(servers, expectedCpuSet) {
  const expected = parseCpuSet(expectedCpuSet);
  for (const target of TARGETS) {
    const reported = servers.get(target.id)?.runtime?.cpuSet;
    if (!reported || !sameCpuSet(parseCpuSet(reported), expected)) {
      throw new Error(
        `${target.title} CPU affinity does not match --target-cpus ${expectedCpuSet}`,
      );
    }
  }
}

async function startSidecar({ telemetry, targetCpuSet, plannedPorts }) {
  const port = await reservePort();
  plannedPorts.add(port);
  const sidecar = await startOwnedProcess({
    entry: SIDECAR_ENTRY,
    label: "Framework-native quote sidecar",
    port,
    env: { BENCHMARK_TELEMETRY: telemetry },
    targetCpuSet,
  });
  const health = await requestJson(sidecar, `${CONTROL_PREFIX}/health`);
  if (
    health.status !== 200 ||
    health.body?.service !== "framework-native-quote"
  ) {
    throw new Error("Quote sidecar did not satisfy its health contract");
  }
  return sidecar;
}

async function startTargets({
  telemetry,
  externalUrl,
  targetCpuSet,
  plannedPorts,
}) {
  const servers = new Map();
  try {
    for (const target of TARGETS) {
      const port = await reservePort();
      plannedPorts.add(port);
      const server = await startOwnedProcess({
        entry: target.entry,
        label: target.title,
        port,
        targetCpuSet,
        env: {
          BENCHMARK_TELEMETRY: telemetry,
          BENCHMARK_EXTERNAL_URL: externalUrl,
        },
      });
      servers.set(target.id, server);
      await requireHealth(server, target.id);
    }
    return servers;
  } catch (error) {
    await Promise.all(
      [...servers.values()].map((server) => stopOwnedProcess(server)),
    );
    throw error;
  }
}

async function closeServers(servers, sidecar) {
  await Promise.all(
    [...servers.values()].map((server) => stopOwnedProcess(server)),
  );
  await stopOwnedProcess(sidecar);
}

async function main() {
  const options = parseArgs();
  const protocol = await loadProtocol(options.protocolPath);
  if (options.formal) applyFormalProtocol(options, protocol);
  validateOptions(options);
  assertImplementationManifest();
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
    packageNames: FRAMEWORK_NATIVE_BENCHMARK_PACKAGES,
  });
  const localVersions = readLocalBenchmarkVersions(REPOSITORY_ROOT, {
    packageNames: FRAMEWORK_NATIVE_BENCHMARK_PACKAGES,
  });
  const tokens = await createBenchmarkTokens();
  const plannedPorts = new Set();
  let conformanceSidecar;
  let conformanceServers = new Map();
  let measurementSidecar;
  let measurementServers = new Map();
  try {
    conformanceSidecar = await startSidecar({
      telemetry: "on",
      plannedPorts,
    });
    conformanceServers = await startTargets({
      telemetry: "on",
      externalUrl: baseUrl(conformanceSidecar),
      plannedPorts,
    });
    assertFastifyHostParity(conformanceServers, localVersions.fastify);
    const conformance = await runConformance(
      conformanceServers,
      conformanceSidecar,
      tokens,
    );
    await closeServers(conformanceServers, conformanceSidecar);
    conformanceServers = new Map();
    conformanceSidecar = undefined;

    measurementSidecar = await startSidecar({
      telemetry: "off",
      targetCpuSet: options.formal ? options.targetCpus : undefined,
      plannedPorts,
    });
    measurementServers = await startTargets({
      telemetry: "off",
      externalUrl: baseUrl(measurementSidecar),
      targetCpuSet: options.formal ? options.targetCpus : undefined,
      plannedPorts,
    });
    assertFastifyHostParity(measurementServers, localVersions.fastify);
    if (options.formal)
      assertTargetCpuAffinity(measurementServers, options.targetCpus);
    const results = await runMeasurements(
      measurementServers,
      measurementSidecar,
      tokens,
      options,
    );
    const stability = findUnstableResults(results, protocol.maxCvPercent);
    if (options.formal && stability.length > 0) {
      throw new Error(`Formal CV gate failed: ${JSON.stringify(stability)}`);
    }
    const mode = options.formal
      ? "formal"
      : options.pilot
        ? "pilot"
        : options.smoke
          ? "smoke"
          : "local";
    const citable =
      options.formal &&
      protocol.status === "accepted" &&
      stability.length === 0;
    const artifact = {
      schemaVersion: 1,
      suite: FRAMEWORK_NATIVE_SUITE_ID,
      suiteVersion: FRAMEWORK_NATIVE_SUITE_VERSION,
      recordedAt: new Date().toISOString(),
      mode,
      complete: true,
      citable,
      publication: {
        formalProtocolRequired: true,
        reason: citable
          ? "accepted formal protocol and all statistical gates passed"
          : "local/pilot/smoke observations are implementation evidence, not publishable benchmark data",
      },
      protocol,
      options: {
        durationSeconds: options.duration,
        warmupSeconds: options.warmup,
        rounds: options.rounds,
        connections: options.connections,
        pipelining: options.pipelining,
        targetScheduling: "round-interleaved-rotating",
        telemetryDuringMeasurement: false,
        loadCpus: options.loadCpus ?? null,
        targetCpus: options.targetCpus ?? null,
      },
      provenance,
      environment: environment(),
      dependencyVerification,
      frameworkVersions: { vextjs: PACKAGE_METADATA.version, ...localVersions },
      implementationManifest: FRAMEWORK_NATIVE_IMPLEMENTATION_MANIFEST,
      conformance,
      results,
      stability: {
        maxCvPercent: protocol.maxCvPercent,
        unstable: stability,
      },
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
          mode: artifact.mode,
          citable: artifact.citable,
          workloads: artifact.results.length,
          targets: TARGETS.length,
          resultsJson: options.resultsJson,
        },
        null,
        2,
      ),
    );
  } finally {
    await closeServers(conformanceServers, conformanceSidecar);
    await closeServers(measurementServers, measurementSidecar);
    await Promise.all(
      [...plannedPorts].map((port) => assertPortReleased(port)),
    );
  }
}

export { parseCpuSet, runConformance, waitForTargetQuiescence };

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exitCode = 1;
  });
}
