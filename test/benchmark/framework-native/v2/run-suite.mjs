/**
 * Windows x64 Enterprise API raw-run producer.
 *
 * This process records observations only. It deliberately cannot mark a run
 * accepted or citable; validate-artifact.mjs owns that decision.
 */

import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  FRAMEWORK_NATIVE_BENCHMARK_PACKAGES,
  readLocalBenchmarkVersions,
  verifyLatestBenchmarkDependencies,
} from "../../dependency-versions.mjs";
import {
  FRAMEWORK_NATIVE_V2_PROTOCOL_VERSION,
  FRAMEWORK_NATIVE_V2_SUITE_ID,
  TARGETS,
  TIMED_WORKLOADS,
  createBenchmarkTokens,
  createRequest,
  getTimedWorkload,
  semanticResponseHash,
} from "./contract.mjs";
import { jsonSafe, roundMetric, sha256File } from "./artifact-utils.mjs";
import {
  findAvailablePort,
  requestProcessMessage,
  requestJson,
  startOwnedProcess,
  stopOwnedProcess,
} from "./process-utils.mjs";
import {
  createBalancedBlockSchedule,
  protocolForMode,
  scheduleMeasurements,
} from "./protocol.mjs";
import { runConformance } from "./run-conformance.mjs";
import {
  parseCpuSet,
  qualifyWindowsHost,
  readProcessCpuSet,
  setAndVerifyProcessTreesCpuSets,
  setProcessCpuSet,
  snapshotProcessTreeMetrics,
} from "./windows-affinity.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repositoryRoot = resolve(__dirname, "../../../..");
const artifactDirectory = join(
  repositoryRoot,
  "test",
  "benchmark",
  ".artifacts",
);
const targetEntries = Object.freeze({
  "vext-native": join(__dirname, "targets", "vext-native-measurement.mjs"),
  fastify: join(__dirname, "targets", "fastify-measurement.mjs"),
  "nest-fastify": join(__dirname, "targets", "nest-fastify-measurement.mjs"),
  noop: join(__dirname, "targets", "noop-measurement.mjs"),
});
const sidecarEntry = join(__dirname, "quote-sidecar.mjs");
const loadWorkerEntry = join(__dirname, "load-worker.mjs");

function assert(condition, message) {
  if (!condition)
    throw new Error(`Framework-native v2 raw-run failure: ${message}`);
}

function timestampForFilename(date = new Date()) {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function parseArgs() {
  const options = {
    mode: "pilot",
    output: undefined,
    sampleLimit: undefined,
  };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    switch (args[index]) {
      case "--formal":
        options.mode = "formal";
        break;
      case "--pilot":
        options.mode = "pilot";
        break;
      case "--smoke":
        options.mode = "smoke";
        break;
      case "--output":
        options.output = resolve(repositoryRoot, args[index + 1] ?? "");
        index += 1;
        break;
      case "--sample-limit": {
        const raw = args[index + 1];
        const value = Number(raw);
        if (!Number.isInteger(value) || value <= 0) {
          throw new Error("--sample-limit must be a positive integer");
        }
        options.sampleLimit = value;
        index += 1;
        break;
      }
      case "--help":
        console.log(`
${FRAMEWORK_NATIVE_V2_SUITE_ID}

Pilot (non-citable Windows diagnostic):
  node test/benchmark/framework-native/v2/run-suite.mjs --pilot

Formal (only from a clean committed Windows x64 candidate):
  node test/benchmark/framework-native/v2/run-suite.mjs --formal

Focused non-citable smoke while developing control-plane code:
  node test/benchmark/framework-native/v2/run-suite.mjs --smoke --sample-limit 3

The runner creates a raw artifact only. Validate it separately with:
  node test/benchmark/framework-native/v2/validate-artifact.mjs --input <raw.json>
`);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${args[index]}`);
    }
  }
  return options;
}

function readGit(args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

async function sourceProvenance() {
  const status = readGit([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ".",
    ":(exclude)test/benchmark/.artifacts",
  ]);
  const packageJsonPath = join(repositoryRoot, "package.json");
  const packageLockPath = join(repositoryRoot, "package-lock.json");
  const buildEntrypoint = join(repositoryRoot, "dist", "lib", "bootstrap.js");
  await access(buildEntrypoint);
  return {
    branch: readGit(["branch", "--show-current"]),
    commit: readGit(["rev-parse", "HEAD"]),
    worktree: status ? "dirty" : "clean",
    status,
    packageJsonSha256: await sha256File(packageJsonPath),
    packageLockSha256: await sha256File(packageLockPath),
    buildEntrypoint: "dist/lib/bootstrap.js",
    buildEntrypointSha256: await sha256File(buildEntrypoint),
  };
}

async function readFrameworkVersions() {
  const packageManifest = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
  );
  return {
    vextjs: packageManifest.version,
    ...readLocalBenchmarkVersions(repositoryRoot, {
      packageNames: FRAMEWORK_NATIVE_BENCHMARK_PACKAGES,
    }),
  };
}

function runnerEnvironment() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    logicalCpuCount: os.cpus().length,
    totalMemoryBytes: String(os.totalmem()),
  };
}

function assertFormalEnvironment({ mode, protocol, provenance }) {
  if (mode !== "formal") return;
  assert(
    protocol.status === "accepted",
    "formal execution requires an accepted protocol",
  );
  assert(
    process.platform === protocol.requiredPlatform &&
      process.arch === protocol.requiredArch,
    `formal execution requires ${protocol.requiredPlatform}/${protocol.requiredArch}`,
  );
  assert(
    provenance.worktree === "clean",
    "formal execution requires a clean committed source tree",
  );
}

async function assertPortReleased(port) {
  await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", (error) =>
      reject(
        new Error(
          `Owned benchmark port ${port} was not released: ${error.message}`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => (error ? reject(error) : resolvePort()));
    });
  });
}

function processExitEvidence(owned) {
  return {
    label: owned?.label ?? null,
    pid: owned?.pid ?? null,
    exitCode: owned?.child?.exitCode ?? null,
    signalCode: owned?.child?.signalCode ?? null,
  };
}

async function closeOwned(owned, ports, evidence) {
  if (!owned) return;
  await stopOwnedProcess(owned);
  evidence.push(processExitEvidence(owned));
  for (const port of ports) await assertPortReleased(port);
}

function measurementPurityPaths() {
  return [
    targetEntries["vext-native"],
    targetEntries.fastify,
    targetEntries["nest-fastify"],
    join(__dirname, "fastify-app.mjs"),
    join(__dirname, "nest-app.mjs"),
    join(
      __dirname,
      "fixtures",
      "vext-measurement",
      "src",
      "config",
      "default.mjs",
    ),
    join(
      __dirname,
      "fixtures",
      "vext-measurement",
      "src",
      "routes",
      "api",
      "users.mjs",
    ),
    join(
      __dirname,
      "fixtures",
      "vext-measurement",
      "src",
      "services",
      "order.mjs",
    ),
    join(
      __dirname,
      "fixtures",
      "vext-measurement",
      "src",
      "plugins",
      "benchmark-context.mjs",
    ),
    join(
      __dirname,
      "fixtures",
      "vext-measurement",
      "src",
      "plugins",
      "benchmark-validation.mjs",
    ),
    join(
      __dirname,
      "fixtures",
      "vext-measurement",
      "src",
      "plugins",
      "benchmark-error-access-log.mjs",
    ),
  ];
}

async function assertMeasurementPurity() {
  const forbidden = [
    /observation\.mjs/iu,
    /benchmark-observer/iu,
    /installConformanceIpc/iu,
  ];
  const checked = [];
  for (const path of measurementPurityPaths()) {
    const content = await readFile(path, "utf8");
    const match = forbidden.find((pattern) => pattern.test(content));
    if (match) {
      throw new Error(`Measurement path ${path} contains forbidden ${match}`);
    }
    checked.push({
      path: path.slice(repositoryRoot.length + 1),
      sha256: await sha256File(path),
    });
  }
  return checked;
}

async function startSidecar({ quoteDelayMs, autoStart = true }) {
  const port = await findAvailablePort();
  const sidecar = await startOwnedProcess({
    entry: sidecarEntry,
    label: `quote-sidecar-${quoteDelayMs}ms`,
    cwd: repositoryRoot,
    env: {
      PORT: String(port),
      BENCHMARK_QUOTE_DELAY_MS: String(quoteDelayMs),
    },
    autoStart,
    discardStdout: true,
  });
  return {
    owned: sidecar,
    url: `http://127.0.0.1:${port}`,
    port,
    affinityBefore: null,
  };
}

async function startMeasurementTarget({
  targetId,
  sidecarUrl,
  autoStart = true,
}) {
  const port = await findAvailablePort();
  const target = await startOwnedProcess({
    entry: targetEntries[targetId],
    label: `${targetId} measurement target`,
    cwd: repositoryRoot,
    env: {
      PORT: String(port),
      BENCHMARK_EXTERNAL_URL: sidecarUrl,
    },
    autoStart,
    readyTimeoutMs: 30_000,
    discardStdout: true,
  });
  return {
    owned: target,
    port,
    url: `http://127.0.0.1:${port}`,
    affinityBefore: null,
  };
}

async function startNoopTarget({ autoStart = true } = {}) {
  const port = await findAvailablePort();
  const target = await startOwnedProcess({
    entry: targetEntries.noop,
    label: "no-op headroom target",
    cwd: repositoryRoot,
    env: { PORT: String(port) },
    autoStart,
    discardStdout: true,
  });
  return {
    owned: target,
    port,
    url: `http://127.0.0.1:${port}`,
    affinityBefore: null,
  };
}

async function startLoadWorker({ autoStart = true } = {}) {
  const worker = await startOwnedProcess({
    entry: loadWorkerEntry,
    label: "autocannon load worker",
    cwd: repositoryRoot,
    autoStart,
    outputTailCharacters: 2_000,
    discardStdout: true,
  });
  return { owned: worker, affinityBefore: null };
}

function preStartIdentity(owned, role) {
  assert(
    Number(owned?.awaitingStart?.pid) === Number(owned?.pid),
    `${role} awaiting-start PID does not match its child handle`,
  );
  assert(
    owned?.child?.exitCode === null &&
      owned?.child?.signalCode === null &&
      owned?.child?.connected,
    `${role} child is not live and IPC-connected before start`,
  );
  return { pid: Number(owned.pid) };
}

async function startAfterPreStartAffinity(owned, role) {
  const awaitingStart = preStartIdentity(owned, role);
  const ready = await owned.start();
  assert(
    Number(ready?.pid) === Number(owned.pid),
    `${role} ready PID does not match its child handle`,
  );
  return { awaitingStart, ready };
}

function responseCount(statusCounts) {
  return Object.values(statusCounts ?? {}).reduce(
    (total, value) => total + Number(value),
    0,
  );
}

function assertLoadCorrectness(result, expectedStatus) {
  const counts = result?.statusCounts ?? {};
  const count = responseCount(counts);
  const statuses = Object.keys(counts);
  const unexpected = statuses.filter(
    (status) => Number(status) !== expectedStatus,
  );
  assert(count > 0, "load worker completed zero responses");
  assert(
    unexpected.length === 0,
    `unexpected status distribution ${JSON.stringify(counts)}`,
  );
  assert(
    Number(counts[String(expectedStatus)] ?? 0) === count,
    `expected HTTP ${expectedStatus} for every response`,
  );
  assert(
    Number(result.requestFactory?.generatedRequestIds) >= count,
    "request factory generated fewer unique IDs than completed responses",
  );
  for (const key of ["errors", "timeouts", "resets"]) {
    assert(
      Number(result.autocannon?.[key] ?? 0) === 0,
      `autocannon ${key} is non-zero`,
    );
  }
  assert(
    Number(result.requestErrors ?? 0) === 0,
    "load worker request errors are non-zero",
  );
  assert(
    Number(result.latency?.samples ?? 0) === count,
    "latency sample count does not equal response count",
  );
  return count;
}

function processMetricDelta(before, after) {
  const cpuSeconds = Number(after.cpuSeconds) - Number(before.cpuSeconds);
  assert(cpuSeconds >= 0, "process CPU time moved backwards");
  return {
    cpuSeconds,
    workingSetBytes: String(after.workingSetBytes),
    peakWorkingSetBytes: String(after.peakWorkingSetBytes),
    before,
    after,
  };
}

async function runLoad({
  worker,
  url,
  workloadId,
  prefix,
  protocol,
  tokens,
  durationSeconds,
}) {
  const message = await requestProcessMessage(worker.owned, "run", {
    timeoutMs: (durationSeconds + 45) * 1_000,
    payload: {
      url,
      workloadId,
      prefix,
      tokens,
      connections: protocol.connections,
      pipelining: protocol.pipelining,
      durationSeconds,
      timeoutSeconds: Math.max(10, durationSeconds + 10),
    },
  });
  if (message?.type === "run-error") {
    throw new Error(`Load worker failed: ${message.message}`);
  }
  assert(
    message?.type === "run",
    "load worker returned an invalid IPC message",
  );
  return message.result;
}

async function verifyAffinityAfter(processes, roleCpuSets) {
  const expected = {
    target: roleCpuSets.target,
    sidecar: roleCpuSets.dependency,
    load: roleCpuSets.load,
  };
  const assignments = Object.entries(processes)
    .filter(([, owned]) => Boolean(owned))
    .map(([role, owned]) => ({
      role,
      rootPid: owned.pid,
      cpuSet: expected[role],
    }));
  return setAndVerifyProcessTreesCpuSets(assignments);
}

async function verifyMeasurementTargetSemantic({ target, workload, tokens }) {
  // Conformance runs in an instrumented, separately-owned process. Every
  // fresh measurement target also receives this untimed semantic probe before
  // warmup, so a measurement-only fixture cannot silently diverge from the
  // conformance fixture while still returning the expected HTTP status.
  const request = createRequest(
    workload,
    tokens,
    `measurement-preflight-${workload.id}`,
  );
  const response = await requestJson(
    `${target.url}/api/users/10001/orders`,
    request,
  );
  const semantic = semanticResponseHash(response, request, workload);
  return {
    algorithm: semantic.algorithm,
    hash: semantic.hash,
  };
}

function loadCpuPercent({ metrics, wallDurationSeconds, loadCpuSet }) {
  const assignedLogicalCpus = parseCpuSet(loadCpuSet).size;
  assert(assignedLogicalCpus > 0, "load CPU set is empty");
  assert(
    Number.isFinite(wallDurationSeconds) && wallDurationSeconds > 0,
    "load worker did not report a positive wall duration",
  );
  return (metrics.cpuSeconds / wallDurationSeconds / assignedLogicalCpus) * 100;
}

async function runMeasurementSample({
  descriptor,
  protocol,
  tokens,
  roleCpuSets,
}) {
  const workload = getTimedWorkload(descriptor.workloadId);
  const cleanup = [];
  const startedAt = new Date().toISOString();
  let target;
  let sidecar;
  let worker;
  try {
    sidecar = await startSidecar({
      quoteDelayMs: workload.quoteDelayMs,
      autoStart: false,
    });
    target = await startMeasurementTarget({
      targetId: descriptor.targetId,
      sidecarUrl: sidecar.url,
      autoStart: false,
    });
    worker = await startLoadWorker({ autoStart: false });
    const affinityBefore = await setAndVerifyProcessTreesCpuSets([
      { role: "target", rootPid: target.owned.pid, cpuSet: roleCpuSets.target },
      {
        role: "sidecar",
        rootPid: sidecar.owned.pid,
        cpuSet: roleCpuSets.dependency,
      },
      { role: "load", rootPid: worker.owned.pid, cpuSet: roleCpuSets.load },
    ]);
    target.affinityBefore = affinityBefore.target;
    sidecar.affinityBefore = affinityBefore.sidecar;
    worker.affinityBefore = affinityBefore.load;
    const preStart = {
      sidecar: await startAfterPreStartAffinity(sidecar.owned, "sidecar"),
      target: await startAfterPreStartAffinity(target.owned, "target"),
      load: await startAfterPreStartAffinity(worker.owned, "load"),
    };
    assert(
      Number(preStart.sidecar.ready.port) === Number(sidecar.port),
      "sidecar ready port does not match its pre-allocated port",
    );
    assert(
      Number(preStart.target.ready.port) === Number(target.port),
      "target ready port does not match its pre-allocated port",
    );
    const measurementTargetSemantic = await verifyMeasurementTargetSemantic({
      target,
      workload,
      tokens,
    });
    const warmup = await runLoad({
      worker,
      url: target.url + "/api/users/10001/orders",
      workloadId: workload.id,
      prefix: `${protocol.id}-b${descriptor.block}-${descriptor.targetId}-${workload.id}-warmup`,
      protocol,
      tokens,
      durationSeconds: protocol.warmupSeconds,
    });
    const warmupResponses = assertLoadCorrectness(
      warmup,
      workload.expectedStatus,
    );

    const before = {
      target: await snapshotProcessTreeMetrics(target.owned.pid),
      sidecar: await snapshotProcessTreeMetrics(sidecar.owned.pid),
      load: await snapshotProcessTreeMetrics(worker.owned.pid),
    };
    const measurementStarted = performance.now();
    const measurement = await runLoad({
      worker,
      url: target.url + "/api/users/10001/orders",
      workloadId: workload.id,
      prefix: `${protocol.id}-b${descriptor.block}-${descriptor.targetId}-${workload.id}-measure`,
      protocol,
      tokens,
      durationSeconds: protocol.measurementSeconds,
    });
    const measurementElapsedSeconds =
      (performance.now() - measurementStarted) / 1_000;
    const completedRequests = assertLoadCorrectness(
      measurement,
      workload.expectedStatus,
    );
    const after = {
      target: await snapshotProcessTreeMetrics(target.owned.pid),
      sidecar: await snapshotProcessTreeMetrics(sidecar.owned.pid),
      load: await snapshotProcessTreeMetrics(worker.owned.pid),
    };
    const sidecarSnapshot = await requestProcessMessage(
      sidecar.owned,
      "snapshot",
    );
    const affinityAfter = await verifyAffinityAfter(
      {
        target: target.owned,
        sidecar: sidecar.owned,
        load: worker.owned,
      },
      roleCpuSets,
    );
    const targetMetrics = processMetricDelta(before.target, after.target);
    const sidecarMetrics = processMetricDelta(before.sidecar, after.sidecar);
    const loadMetrics = processMetricDelta(before.load, after.load);
    const loadWallSeconds = Number(measurement.autocannon?.wallDurationSeconds);
    const targetRpsDuration = Number(measurement.autocannon?.durationSeconds);
    assert(
      Number.isFinite(targetRpsDuration) && targetRpsDuration > 0,
      "autocannon did not report a positive measurement duration",
    );
    const rps = completedRequests / targetRpsDuration;
    const loadCpuUtilizationPercent = loadCpuPercent({
      metrics: loadMetrics,
      wallDurationSeconds: loadWallSeconds,
      loadCpuSet: roleCpuSets.load,
    });
    return {
      ...descriptor,
      startedAt,
      completedAt: new Date().toISOString(),
      workload: {
        id: workload.id,
        expectedStatus: workload.expectedStatus,
        quoteDelayMs: workload.quoteDelayMs,
      },
      target: {
        title: TARGETS.find(
          (targetEntry) => targetEntry.id === descriptor.targetId,
        )?.title,
        pid: target.owned.pid,
        port: target.port,
        awaitingStart: preStart.target.awaitingStart,
        ready: preStart.target.ready,
        affinityBefore: target.affinityBefore,
        metrics: targetMetrics,
      },
      measurementTargetSemantic,
      sidecar: {
        pid: sidecar.owned.pid,
        port: sidecar.port,
        awaitingStart: preStart.sidecar.awaitingStart,
        ready: preStart.sidecar.ready,
        affinityBefore: sidecar.affinityBefore,
        metrics: sidecarMetrics,
        snapshot: sidecarSnapshot.sidecar,
      },
      load: {
        pid: worker.owned.pid,
        awaitingStart: preStart.load.awaitingStart,
        ready: preStart.load.ready,
        affinityBefore: worker.affinityBefore,
        metrics: loadMetrics,
        cpuUtilizationPercent: roundMetric(loadCpuUtilizationPercent),
      },
      affinityAfter,
      warmup: {
        durationSeconds: protocol.warmupSeconds,
        completedRequests: warmupResponses,
        statusCounts: warmup.statusCounts,
      },
      measurement: {
        configuredDurationSeconds: protocol.measurementSeconds,
        elapsedWallSeconds: roundMetric(measurementElapsedSeconds),
        completedRequests,
        rps: roundMetric(rps),
        latency: measurement.latency,
        statusCounts: measurement.statusCounts,
        requestFactory: measurement.requestFactory,
        requestErrors: measurement.requestErrors,
        autocannon: measurement.autocannon,
      },
      cleanup,
    };
  } finally {
    if (worker) await closeOwned(worker.owned, [], cleanup);
    if (target) await closeOwned(target.owned, [target.port], cleanup);
    if (sidecar) await closeOwned(sidecar.owned, [sidecar.port], cleanup);
  }
}

async function runHeadroomCalibration({
  workloadId,
  protocol,
  tokens,
  roleCpuSets,
}) {
  const cleanup = [];
  let target;
  let worker;
  try {
    target = await startNoopTarget({ autoStart: false });
    worker = await startLoadWorker({ autoStart: false });
    const affinityBefore = await setAndVerifyProcessTreesCpuSets([
      { role: "target", rootPid: target.owned.pid, cpuSet: roleCpuSets.target },
      { role: "load", rootPid: worker.owned.pid, cpuSet: roleCpuSets.load },
    ]);
    target.affinityBefore = affinityBefore.target;
    worker.affinityBefore = affinityBefore.load;
    const preStart = {
      target: await startAfterPreStartAffinity(target.owned, "target"),
      load: await startAfterPreStartAffinity(worker.owned, "load"),
    };
    assert(
      Number(preStart.target.ready.port) === Number(target.port),
      "no-op target ready port does not match its pre-allocated port",
    );
    const warmup = await runLoad({
      worker,
      url: target.url,
      workloadId,
      prefix: `${protocol.id}-headroom-${workloadId}-warmup`,
      protocol,
      tokens,
      durationSeconds: protocol.warmupSeconds,
    });
    const warmupResponses = assertLoadCorrectness(warmup, 201);
    const before = {
      target: await snapshotProcessTreeMetrics(target.owned.pid),
      load: await snapshotProcessTreeMetrics(worker.owned.pid),
    };
    const measurement = await runLoad({
      worker,
      url: target.url,
      workloadId,
      prefix: `${protocol.id}-headroom-${workloadId}-measure`,
      protocol,
      tokens,
      durationSeconds: protocol.measurementSeconds,
    });
    const completedRequests = assertLoadCorrectness(measurement, 201);
    const after = {
      target: await snapshotProcessTreeMetrics(target.owned.pid),
      load: await snapshotProcessTreeMetrics(worker.owned.pid),
    };
    const affinityAfter = await verifyAffinityAfter(
      { target: target.owned, load: worker.owned },
      roleCpuSets,
    );
    const loadMetrics = processMetricDelta(before.load, after.load);
    const targetMetrics = processMetricDelta(before.target, after.target);
    const durationSeconds = Number(measurement.autocannon?.durationSeconds);
    const rps = completedRequests / durationSeconds;
    const loadCpuUtilizationPercent = loadCpuPercent({
      metrics: loadMetrics,
      wallDurationSeconds: Number(measurement.autocannon?.wallDurationSeconds),
      loadCpuSet: roleCpuSets.load,
    });
    return {
      workloadId,
      completedRequests,
      rps: roundMetric(rps),
      latency: measurement.latency,
      statusCounts: measurement.statusCounts,
      requestFactory: measurement.requestFactory,
      requestErrors: measurement.requestErrors,
      autocannon: measurement.autocannon,
      warmup: {
        completedRequests: warmupResponses,
        statusCounts: warmup.statusCounts,
      },
      target: {
        pid: target.owned.pid,
        port: target.port,
        awaitingStart: preStart.target.awaitingStart,
        ready: preStart.target.ready,
        affinityBefore: target.affinityBefore,
        metrics: targetMetrics,
      },
      load: {
        pid: worker.owned.pid,
        awaitingStart: preStart.load.awaitingStart,
        ready: preStart.load.ready,
        affinityBefore: worker.affinityBefore,
        metrics: loadMetrics,
        cpuUtilizationPercent: roundMetric(loadCpuUtilizationPercent),
      },
      affinityAfter,
      cleanup,
    };
  } finally {
    if (worker) await closeOwned(worker.owned, [], cleanup);
    if (target) await closeOwned(target.owned, [target.port], cleanup);
  }
}

function errorDetails(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? (error.stack ?? null) : null,
  };
}

async function writeRawArtifact(path, artifact) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify(jsonSafe(artifact), null, 2)}\n`,
  );
  await rename(temporary, path);
}

async function main() {
  const options = parseArgs();
  const protocol = protocolForMode(options.mode);
  const output =
    options.output ??
    join(
      artifactDirectory,
      `${FRAMEWORK_NATIVE_V2_SUITE_ID}-${options.mode}-raw-${timestampForFilename()}.json`,
    );
  const artifact = {
    schemaVersion: 1,
    artifactType: "framework-native-v2-raw-run",
    suite: FRAMEWORK_NATIVE_V2_SUITE_ID,
    suiteProtocolVersion: FRAMEWORK_NATIVE_V2_PROTOCOL_VERSION,
    mode: options.mode,
    protocol,
    recordedAt: new Date().toISOString(),
    runner: {
      entry: "test/benchmark/framework-native/v2/run-suite.mjs",
      sourceSha256: await sha256File(__filename),
    },
    execution: {
      status: "running",
      errors: [],
    },
    samples: [],
    calibrations: [],
    cleanup: [],
  };
  let originalRunnerCpuSet;
  let capturedError;
  try {
    artifact.provenance = await sourceProvenance();
    assertFormalEnvironment({
      mode: options.mode,
      protocol,
      provenance: artifact.provenance,
    });
    artifact.frameworkVersions = await readFrameworkVersions();
    if (options.mode === "formal") {
      artifact.latestDependencyAudit = await verifyLatestBenchmarkDependencies({
        repositoryRoot,
        packageNames: FRAMEWORK_NATIVE_BENCHMARK_PACKAGES,
      });
    }
    artifact.environment = runnerEnvironment();
    artifact.measurementPurity = await assertMeasurementPurity();
    artifact.hostQualification = await qualifyWindowsHost(
      protocol.hostQualification,
    );
    assert(
      artifact.hostQualification.status === "PASS",
      `Windows host qualification failed: ${artifact.hostQualification.reasons.join("; ")}`,
    );
    const roleCpuSets = artifact.hostQualification.roleCpuSets;
    originalRunnerCpuSet = await readProcessCpuSet(process.pid);
    const runnerCpuSet = await setProcessCpuSet(
      process.pid,
      roleCpuSets.control,
    );
    artifact.runner.affinity = {
      before: [...originalRunnerCpuSet]
        .sort((left, right) => left - right)
        .join(","),
      after: [...runnerCpuSet].sort((left, right) => left - right).join(","),
      role: "control",
    };

    artifact.conformance = await runConformance();
    assert(artifact.conformance.status === "PASS", "conformance did not pass");
    const tokens = await createBenchmarkTokens(undefined, {
      // A formal candidate can run for more than one hour. Tokens must remain
      // valid for the entire fixed batch without renewing during measurement.
      expirationSeconds: 14_400,
    });
    artifact.schedule = createBalancedBlockSchedule(protocol.blocks);
    const allDescriptors = scheduleMeasurements(artifact.schedule);
    assert(
      options.mode !== "formal" || options.sampleLimit === undefined,
      "formal execution cannot limit samples",
    );
    const descriptors = options.sampleLimit
      ? allDescriptors.slice(0, options.sampleLimit)
      : allDescriptors;
    artifact.expectedMeasurementSamples = descriptors.length;
    artifact.fullProtocolMeasurementSamples = allDescriptors.length;
    await writeRawArtifact(output, artifact);
    for (const descriptor of descriptors) {
      const sample = await runMeasurementSample({
        descriptor,
        protocol,
        tokens,
        roleCpuSets,
      });
      artifact.samples.push(sample);
      artifact.cleanup.push(...sample.cleanup);
      await writeRawArtifact(output, artifact);
      console.log(
        JSON.stringify({
          type: "measurement-progress",
          mode: options.mode,
          completed: artifact.samples.length,
          total: descriptors.length,
          block: descriptor.block,
          workload: descriptor.workloadId,
          target: descriptor.targetId,
          rps: sample.measurement.rps,
        }),
      );
    }
    for (const workload of TIMED_WORKLOADS) {
      const calibration = await runHeadroomCalibration({
        workloadId: workload.id,
        protocol,
        tokens,
        roleCpuSets,
      });
      artifact.calibrations.push(calibration);
      artifact.cleanup.push(...calibration.cleanup);
      await writeRawArtifact(output, artifact);
      console.log(
        JSON.stringify({
          type: "headroom-progress",
          mode: options.mode,
          completed: artifact.calibrations.length,
          total: TIMED_WORKLOADS.length,
          workload: workload.id,
          rps: calibration.rps,
        }),
      );
    }
    artifact.execution.status = "completed";
  } catch (error) {
    capturedError = error;
    artifact.execution.status = "failed";
    artifact.execution.errors.push(errorDetails(error));
  } finally {
    if (originalRunnerCpuSet) {
      try {
        const restored = await setProcessCpuSet(
          process.pid,
          [...originalRunnerCpuSet]
            .sort((left, right) => left - right)
            .join(","),
        );
        artifact.runner.affinity.restored = [...restored]
          .sort((left, right) => left - right)
          .join(",");
      } catch (error) {
        artifact.execution.status = "failed";
        artifact.execution.errors.push(errorDetails(error));
        capturedError ??= error;
      }
    }
    artifact.completedAt = new Date().toISOString();
    await writeRawArtifact(output, artifact);
  }
  console.log(
    JSON.stringify(
      {
        suite: artifact.suite,
        mode: artifact.mode,
        rawArtifact: output,
        execution: artifact.execution.status,
        samples: artifact.samples.length,
        calibrations: artifact.calibrations.length,
      },
      null,
      2,
    ),
  );
  if (capturedError) throw capturedError;
}

export {
  assertLoadCorrectness,
  assertMeasurementPurity,
  parseArgs,
  runHeadroomCalibration,
  runMeasurementSample,
};

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exitCode = 1;
  });
}
