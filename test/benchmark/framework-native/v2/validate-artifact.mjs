/**
 * Independent acceptance gate for Framework-native v2 raw artifacts.
 *
 * It recomputes every publication condition from the raw observations and
 * current candidate identity. A raw runner never gets to self-approve.
 */

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  FRAMEWORK_NATIVE_BENCHMARK_PACKAGES,
  readLocalBenchmarkVersions,
} from "../../dependency-versions.mjs";
import {
  CONFORMANCE_ONLY_PROBES,
  FRAMEWORK_NATIVE_V2_PROTOCOL_VERSION,
  FRAMEWORK_NATIVE_V2_SUITE_ID,
  TARGETS,
  TIMED_WORKLOADS,
} from "./contract.mjs";
import {
  coefficientOfVariationPercent,
  jsonSafe,
  pairedBlockBootstrap,
  roundMetric,
  sha256File,
  summarizeRps,
} from "./artifact-utils.mjs";
import {
  WINDOWS_V2_PROTOCOL,
  createBalancedBlockSchedule,
  protocolForMode,
  scheduleMeasurements,
} from "./protocol.mjs";
import { runConformance } from "./run-conformance.mjs";
import { parseCpuSet, selectRoleCores } from "./windows-affinity.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repositoryRoot = resolve(__dirname, "../../../..");

function parseArgs() {
  const options = {
    input: undefined,
    output: undefined,
    liveConformance: true,
  };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    switch (args[index]) {
      case "--input":
        options.input = resolve(repositoryRoot, args[index + 1] ?? "");
        index += 1;
        break;
      case "--output":
        options.output = resolve(repositoryRoot, args[index + 1] ?? "");
        index += 1;
        break;
      case "--no-live-conformance":
        options.liveConformance = false;
        break;
      case "--help":
        console.log(`
Validate an Enterprise Benchmark v2 raw artifact:
  node test/benchmark/framework-native/v2/validate-artifact.mjs --input <raw.json>

The validator writes an accepted artifact beside the raw input unless --output
is supplied. It exits non-zero when any publication gate fails.
`);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${args[index]}`);
    }
  }
  if (!options.input) throw new Error("--input is required");
  if (!options.output) {
    options.output = options.input.replace(
      /-raw-([^\\/]+)\.json$/u,
      "-accepted-$1.json",
    );
    if (options.output === options.input)
      options.output = `${options.input}.accepted.json`;
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

function gate(gates, id, pass, detail) {
  gates.push({ id, status: pass ? "PASS" : "FAIL", detail });
  return pass;
}

function issue(issues, condition, message) {
  if (!condition) issues.push(message);
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function sumStatusCounts(counts) {
  if (!counts || typeof counts !== "object") return Number.NaN;
  return Object.values(counts).reduce(
    (total, value) => total + Number(value),
    0,
  );
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cpuSetText(value) {
  return [...parseCpuSet(value)].sort((left, right) => left - right).join(",");
}

function affinityEntriesMatch(entries, expectedCpuSet) {
  if (!Array.isArray(entries) || entries.length === 0) return false;
  const expected = cpuSetText(expectedCpuSet);
  return entries.every(
    (entry) =>
      Number.isInteger(Number(entry?.pid)) &&
      cpuSetText(entry.cpuSet) === expected,
  );
}

function affinityAfterMatches(entries, expectedCpuSet) {
  return affinityEntriesMatch(entries, expectedCpuSet);
}

function preStartIdentityMatches(
  record,
  affinityEntries,
  { requirePort = false } = {},
) {
  const pid = Number(record?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (Number(record?.awaitingStart?.pid) !== pid) return false;
  if (Number(record?.ready?.pid) !== pid) return false;
  if (
    !Array.isArray(affinityEntries) ||
    !affinityEntries.some((entry) => Number(entry?.pid) === pid)
  ) {
    return false;
  }
  return !requirePort || Number(record?.ready?.port) === Number(record?.port);
}

function expectedMeasurementPrefix(sample, protocol) {
  return `${protocol.id}-b${sample.block}-${sample.targetId}-${sample.workloadId}-measure`;
}

function validateStatusAndRequestFactory({
  value,
  expectedStatus,
  prefix,
  issues,
}) {
  const counts = value?.statusCounts;
  const total = sumStatusCounts(counts);
  issue(
    issues,
    Number.isInteger(total) && total > 0,
    "response count is not a positive integer",
  );
  issue(
    issues,
    Object.keys(counts ?? {}).length === 1 &&
      Number(Object.keys(counts ?? {})[0]) === expectedStatus,
    `status distribution is not exactly HTTP ${expectedStatus}`,
  );
  issue(
    issues,
    Number(counts?.[String(expectedStatus)] ?? 0) === total,
    `expected HTTP ${expectedStatus} count does not equal total`,
  );
  issue(
    issues,
    Number(value?.completedRequests) === total,
    "completed request count does not equal status count",
  );
  issue(
    issues,
    value?.requestFactory?.mode === "autocannon-requests-setupRequest",
    "request factory is not documented setupRequest mode",
  );
  issue(
    issues,
    value?.requestFactory?.prefix === prefix,
    "request factory prefix is not the protocol-derived deterministic value",
  );
  issue(
    issues,
    Number(value?.requestFactory?.generatedRequestIds) >= total,
    "generated request IDs are fewer than completed responses",
  );
  for (const key of ["errors", "timeouts", "resets"]) {
    issue(
      issues,
      Number(value?.autocannon?.[key] ?? 0) === 0,
      `autocannon ${key} is non-zero`,
    );
  }
  issue(
    issues,
    Number(value?.requestErrors ?? 0) === 0,
    "request error count is non-zero",
  );
  return total;
}

function validateLatency(value, total, issues) {
  issue(
    issues,
    Number(value?.latency?.samples) === total,
    "latency sample count differs from responses",
  );
  for (const percentile of ["p50", "p95", "p99"]) {
    issue(
      issues,
      isFiniteNumber(value?.latency?.[percentile]) &&
        Number(value.latency[percentile]) >= 0,
      `latency ${percentile} is missing or invalid`,
    );
  }
}

function validateSidecarSnapshot(snapshot, workload, protocol, issues) {
  if (workload.quoteDelayMs === 0) return;
  const actual = snapshot?.actualDelayMs;
  const nominal = workload.quoteDelayMs;
  issue(
    issues,
    Number(snapshot?.nominalDelayMs) === nominal,
    "sidecar nominal delay does not match workload",
  );
  issue(
    issues,
    Number(snapshot?.samples ?? 0) > 0,
    "sidecar recorded zero delay samples",
  );
  issue(
    issues,
    isFiniteNumber(actual?.p50) &&
      Number(actual.p50) >= nominal * protocol.sidecar.minimumP50Ratio,
    "sidecar P50 under-ran the protocol gate",
  );
  issue(
    issues,
    isFiniteNumber(actual?.p95) &&
      Number(actual.p95) <= nominal + protocol.sidecar.maximumP95ExcessMs,
    "sidecar P95 exceeded the protocol gate",
  );
  issue(
    issues,
    isFiniteNumber(actual?.p99) &&
      Number(actual.p99) <= nominal + protocol.sidecar.maximumP99ExcessMs,
    "sidecar P99 exceeded the protocol gate",
  );
}

function validateSample(
  sample,
  descriptor,
  roleCpuSets,
  protocol,
  expectedSemantic,
) {
  const issues = [];
  const workload = TIMED_WORKLOADS.find(
    (entry) => entry.id === descriptor.workloadId,
  );
  issue(issues, Boolean(workload), `unknown workload ${descriptor.workloadId}`);
  issue(
    issues,
    sample?.id === descriptor.id,
    "sample ID differs from the balanced schedule",
  );
  for (const key of [
    "sequence",
    "block",
    "workloadId",
    "targetId",
    "targetPosition",
    "workloadPosition",
  ]) {
    issue(
      issues,
      Number(sample?.[key]) === Number(descriptor[key]) ||
        sample?.[key] === descriptor[key],
      `sample ${key} differs from schedule`,
    );
  }
  if (!workload) return issues;
  try {
    const total = validateStatusAndRequestFactory({
      value: sample?.measurement,
      expectedStatus: workload.expectedStatus,
      prefix: expectedMeasurementPrefix(descriptor, protocol),
      issues,
    });
    validateLatency(sample?.measurement, total, issues);
    issue(
      issues,
      sample?.measurementTargetSemantic?.algorithm ===
        expectedSemantic?.algorithm &&
        sample?.measurementTargetSemantic?.hash === expectedSemantic?.hash,
      "fresh measurement target semantic probe does not match recorded cross-target conformance",
    );
    const measuredDuration = Number(
      sample?.measurement?.autocannon?.durationSeconds,
    );
    issue(issues, measuredDuration > 0, "measurement duration is not positive");
    const expectedRps =
      measuredDuration > 0 ? total / measuredDuration : Number.NaN;
    issue(
      issues,
      Math.abs(Number(sample?.measurement?.rps) - roundMetric(expectedRps)) <=
        0.001,
      "reported RPS does not equal raw completed requests / autocannon duration",
    );
    issue(
      issues,
      Number(sample?.load?.cpuUtilizationPercent) <=
        protocol.load.maximumCpuPercent,
      "load CPU utilization exceeds the protocol gate",
    );
    issue(
      issues,
      affinityEntriesMatch(sample?.target?.affinityBefore, roleCpuSets.target),
      "target pre-warmup child affinity proof is incomplete",
    );
    issue(
      issues,
      preStartIdentityMatches(sample?.target, sample?.target?.affinityBefore, {
        requirePort: true,
      }),
      "target pre-start identity/port proof is incomplete",
    );
    issue(
      issues,
      affinityEntriesMatch(
        sample?.sidecar?.affinityBefore,
        roleCpuSets.dependency,
      ),
      "sidecar pre-warmup child affinity proof is incomplete",
    );
    issue(
      issues,
      preStartIdentityMatches(
        sample?.sidecar,
        sample?.sidecar?.affinityBefore,
        {
          requirePort: true,
        },
      ),
      "sidecar pre-start identity/port proof is incomplete",
    );
    issue(
      issues,
      affinityEntriesMatch(sample?.load?.affinityBefore, roleCpuSets.load),
      "load pre-warmup child affinity proof is incomplete",
    );
    issue(
      issues,
      preStartIdentityMatches(sample?.load, sample?.load?.affinityBefore),
      "load pre-start identity proof is incomplete",
    );
    issue(
      issues,
      affinityAfterMatches(sample?.affinityAfter?.target, roleCpuSets.target),
      "target post-measurement child affinity proof is incomplete",
    );
    issue(
      issues,
      affinityAfterMatches(
        sample?.affinityAfter?.sidecar,
        roleCpuSets.dependency,
      ),
      "sidecar post-measurement child affinity proof is incomplete",
    );
    issue(
      issues,
      affinityAfterMatches(sample?.affinityAfter?.load, roleCpuSets.load),
      "load post-measurement child affinity proof is incomplete",
    );
    validateSidecarSnapshot(
      sample?.sidecar?.snapshot,
      workload,
      protocol,
      issues,
    );
    issue(
      issues,
      Array.isArray(sample?.cleanup) &&
        sample.cleanup.length === 3 &&
        sample.cleanup.every(
          (entry) => entry.exitCode !== null || entry.signalCode !== null,
        ),
      "sample cleanup evidence is missing or a child did not exit",
    );
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  return issues;
}

function validateCalibration(
  calibration,
  workload,
  roleCpuSets,
  protocol,
  maximumTargetRps,
) {
  const issues = [];
  try {
    issue(
      issues,
      calibration?.workloadId === workload.id,
      "calibration workload ID differs",
    );
    const value = {
      ...calibration,
      measurement: undefined,
      autocannon: calibration?.autocannon,
      statusCounts: calibration?.statusCounts,
      requestFactory: calibration?.requestFactory,
      requestErrors: calibration?.requestErrors,
    };
    const total = validateStatusAndRequestFactory({
      value,
      expectedStatus: 201,
      prefix: `${protocol.id}-headroom-${workload.id}-measure`,
      issues,
    });
    validateLatency(value, total, issues);
    const duration = Number(calibration?.autocannon?.durationSeconds);
    const expectedRps = duration > 0 ? total / duration : Number.NaN;
    issue(
      issues,
      Math.abs(Number(calibration?.rps) - roundMetric(expectedRps)) <= 0.001,
      "calibration RPS does not equal raw requests / duration",
    );
    issue(
      issues,
      Number(calibration?.rps) >=
        maximumTargetRps * protocol.load.minimumNoopHeadroomRatio,
      "no-op load headroom is below 2x the highest target RPS for this workload",
    );
    issue(
      issues,
      isFiniteNumber(calibration?.load?.cpuUtilizationPercent) &&
        Number(calibration.load.cpuUtilizationPercent) >= 0,
      "calibration load CPU utilization is missing or invalid",
    );
    issue(
      issues,
      affinityEntriesMatch(
        calibration?.target?.affinityBefore,
        roleCpuSets.target,
      ) &&
        affinityAfterMatches(
          calibration?.affinityAfter?.target,
          roleCpuSets.target,
        ),
      "no-op target affinity evidence is incomplete",
    );
    issue(
      issues,
      preStartIdentityMatches(
        calibration?.target,
        calibration?.target?.affinityBefore,
        { requirePort: true },
      ),
      "no-op target pre-start identity/port proof is incomplete",
    );
    issue(
      issues,
      affinityEntriesMatch(
        calibration?.load?.affinityBefore,
        roleCpuSets.load,
      ) &&
        affinityAfterMatches(
          calibration?.affinityAfter?.load,
          roleCpuSets.load,
        ),
      "calibration load affinity evidence is incomplete",
    );
    issue(
      issues,
      preStartIdentityMatches(
        calibration?.load,
        calibration?.load?.affinityBefore,
      ),
      "calibration load pre-start identity proof is incomplete",
    );
    issue(
      issues,
      Array.isArray(calibration?.cleanup) &&
        calibration.cleanup.length === 2 &&
        calibration.cleanup.every(
          (entry) => entry.exitCode !== null || entry.signalCode !== null,
        ),
      "calibration cleanup evidence is missing or a child did not exit",
    );
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  return issues;
}

function validateHostQualification(qualification, protocol) {
  const issues = [];
  const roleCpuSets = qualification?.roleCpuSets;
  issue(
    issues,
    qualification?.status === "PASS",
    "host qualification did not pass",
  );
  issue(
    issues,
    Array.isArray(qualification?.reasons) && qualification.reasons.length === 0,
    "host qualification retained failure reasons",
  );
  issue(
    issues,
    Number(qualification?.policy?.backgroundSeconds) ===
      protocol.hostQualification.backgroundSeconds,
    "host background qualification duration differs from the formal protocol",
  );
  issue(
    issues,
    Number(qualification?.policy?.maxBackgroundPercent) ===
      protocol.hostQualification.maximumBackgroundPercent,
    "host background threshold differs from the formal protocol",
  );
  try {
    const roles = ["load", "target", "dependency", "control"];
    for (const role of roles) {
      issue(
        issues,
        Boolean(roleCpuSets?.[role]),
        `host role CPU set ${role} is missing`,
      );
      const background =
        qualification?.roleBackground?.[role]?.maxLogicalCpuAverage;
      issue(
        issues,
        isFiniteNumber(background) &&
          Number(background) <=
            protocol.hostQualification.maximumBackgroundPercent,
        `${role} background CPU exceeds the qualification limit`,
      );
    }
    const cpuSets = roles.map((role) => parseCpuSet(roleCpuSets?.[role]));
    const all = cpuSets.flatMap((entry) => [...entry]);
    issue(issues, new Set(all).size === all.length, "role CPU sets overlap");
    issue(
      issues,
      Number(qualification?.host?.logicalCpuCount) >= 6,
      "host has fewer than six logical CPUs",
    );
    issue(
      issues,
      !/power saver|a1841308-3541-4fab-bc81-f71556f20b4a/iu.test(
        String(qualification?.host?.powerPlan ?? ""),
      ),
      "Power Saver was active",
    );
    const selection = selectRoleCores(
      qualification?.host,
      qualification?.background,
    );
    const expectedRoleSets = Object.fromEntries(
      roles.map((role, index) => [
        role,
        [...selection.selected[index].logicalCpus]
          .sort((left, right) => left - right)
          .join(","),
      ]),
    );
    issue(
      issues,
      roles.every(
        (role) => cpuSetText(roleCpuSets?.[role]) === expectedRoleSets[role],
      ),
      "role CPU sets do not follow the recorded deterministic low-background selection",
    );
    issue(
      issues,
      equalJson(
        qualification?.roleSelection?.candidates,
        selection.candidates,
      ) &&
        qualification?.roleSelection?.method ===
          "all-safe-physical-cores-sampled; lowest-background-average-then-logical-cpu-selected",
      "candidate core samples or deterministic selection evidence differs",
    );
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  return { issues, roleCpuSets };
}

function validateConformance(conformance, protocol) {
  const issues = [];
  issue(
    issues,
    conformance?.suite === FRAMEWORK_NATIVE_V2_SUITE_ID,
    "conformance suite differs",
  );
  issue(
    issues,
    Number(conformance?.protocolVersion) ===
      FRAMEWORK_NATIVE_V2_PROTOCOL_VERSION,
    "conformance protocol version differs",
  );
  issue(
    issues,
    conformance?.status === "PASS",
    "recorded conformance did not pass",
  );
  issue(
    issues,
    conformance?.semanticHashing?.canonicalized === true &&
      conformance?.semanticHashing?.rawSerializedBytesCompared === false,
    "recorded conformance does not declare canonical semantic hashing",
  );
  const sidecar = conformance?.sidecarDelays ?? {};
  const p50s = [];
  for (const nominal of protocol.sidecar.nominalDelayMs) {
    const sample = sidecar[`${nominal}ms`];
    const actual = sample?.actualDelayMs;
    issue(
      issues,
      Number(sample?.nominalDelayMs) === nominal,
      `conformance ${nominal}ms sidecar nominal mismatch`,
    );
    issue(
      issues,
      Number(sample?.samples) >= 64,
      `conformance ${nominal}ms sidecar sample count is incomplete`,
    );
    issue(
      issues,
      Number(actual?.p50) >= nominal * protocol.sidecar.minimumP50Ratio,
      `conformance ${nominal}ms sidecar P50 under-ran`,
    );
    issue(
      issues,
      Number(actual?.p95) <= nominal + protocol.sidecar.maximumP95ExcessMs,
      `conformance ${nominal}ms sidecar P95 exceeded`,
    );
    issue(
      issues,
      Number(actual?.p99) <= nominal + protocol.sidecar.maximumP99ExcessMs,
      `conformance ${nominal}ms sidecar P99 exceeded`,
    );
    p50s.push(Number(actual?.p50));
  }
  issue(
    issues,
    p50s.length === 2 &&
      p50s[1] - p50s[0] >= protocol.sidecar.minimumDistinctP50GapMs,
    "conformance 20ms/40ms sidecar modes are not distinguishable",
  );
  const cases = [
    ...TIMED_WORKLOADS.map((entry) => entry.id),
    ...CONFORMANCE_ONLY_PROBES.map((entry) => entry.id),
  ];
  for (const testId of cases) {
    const hashes = TARGETS.map(
      (target) => conformance?.targets?.[target.id]?.[testId]?.hash,
    );
    issue(
      issues,
      hashes.every((hash) => typeof hash === "string" && hash.length === 64) &&
        new Set(hashes).size === 1,
      `semantic hash differs or is missing for ${testId}`,
    );
  }
  return issues;
}

function aggregateStatistics(samples, protocol) {
  const results = [];
  for (const workload of TIMED_WORKLOADS) {
    const perTarget = Object.fromEntries(
      TARGETS.map((target) => {
        const targetSamples = samples
          .filter(
            (sample) =>
              sample.workloadId === workload.id &&
              sample.targetId === target.id,
          )
          .sort((left, right) => Number(left.block) - Number(right.block));
        const rpsValues = targetSamples.map((sample) =>
          Number(sample.measurement.rps),
        );
        return [
          target.id,
          {
            summary: summarizeRps(rpsValues),
            latency: {
              p50: summarizeRps(
                targetSamples.map((sample) =>
                  Number(sample.measurement.latency.p50),
                ),
              ).median,
              p95: summarizeRps(
                targetSamples.map((sample) =>
                  Number(sample.measurement.latency.p95),
                ),
              ).median,
              p99: summarizeRps(
                targetSamples.map((sample) =>
                  Number(sample.measurement.latency.p99),
                ),
              ).median,
            },
            cpuMicrosecondsPer1kRequests: summarizeRps(
              targetSamples.map((sample) => {
                const cpuSeconds = Number(sample.target.metrics.cpuSeconds);
                const completed = Number(sample.measurement.completedRequests);
                return (cpuSeconds * 1_000_000 * 1_000) / completed;
              }),
            ).median,
            workingSetBytes: summarizeRps(
              targetSamples.map((sample) =>
                Number(sample.target.metrics.workingSetBytes),
              ),
            ).median,
            peakWorkingSetBytes: summarizeRps(
              targetSamples.map((sample) =>
                Number(sample.target.metrics.peakWorkingSetBytes),
              ),
            ).median,
            samples: targetSamples,
          },
        ];
      }),
    );
    const comparisons = [];
    for (let leftIndex = 0; leftIndex < TARGETS.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < TARGETS.length;
        rightIndex += 1
      ) {
        const left = TARGETS[leftIndex];
        const right = TARGETS[rightIndex];
        comparisons.push({
          leftTargetId: left.id,
          rightTargetId: right.id,
          ...pairedBlockBootstrap({
            leftByBlock: perTarget[left.id].samples.map((sample) => ({
              block: sample.block,
              rps: sample.measurement.rps,
            })),
            rightByBlock: perTarget[right.id].samples.map((sample) => ({
              block: sample.block,
              rps: sample.measurement.rps,
            })),
            seed: `${protocol.bootstrap.seed}:${workload.id}:${left.id}:${right.id}`,
            iterations: protocol.bootstrap.iterations,
            practicalRatioBand: protocol.bootstrap.practicalRatioBand,
          }),
        });
      }
    }
    results.push({ workload, targets: perTarget, comparisons });
  }
  return results;
}

async function readCurrentIdentity() {
  const status = readGit([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ".",
    ":(exclude)test/benchmark/.artifacts",
  ]);
  const packageManifest = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
  );
  return {
    commit: readGit(["rev-parse", "HEAD"]),
    worktree: status ? "dirty" : "clean",
    packageJsonSha256: await sha256File(join(repositoryRoot, "package.json")),
    packageLockSha256: await sha256File(
      join(repositoryRoot, "package-lock.json"),
    ),
    buildEntrypointSha256: await sha256File(
      join(repositoryRoot, "dist", "lib", "bootstrap.js"),
    ),
    frameworkVersions: {
      vextjs: packageManifest.version,
      ...readLocalBenchmarkVersions(repositoryRoot, {
        packageNames: FRAMEWORK_NATIVE_BENCHMARK_PACKAGES,
      }),
    },
  };
}

const MEASUREMENT_PURITY_RELATIVE_PATHS = Object.freeze([
  "test/benchmark/framework-native/v2/targets/vext-native-measurement.mjs",
  "test/benchmark/framework-native/v2/targets/fastify-measurement.mjs",
  "test/benchmark/framework-native/v2/targets/nest-fastify-measurement.mjs",
  "test/benchmark/framework-native/v2/fastify-app.mjs",
  "test/benchmark/framework-native/v2/nest-app.mjs",
  "test/benchmark/framework-native/v2/fixtures/vext-measurement/src/config/default.mjs",
  "test/benchmark/framework-native/v2/fixtures/vext-measurement/src/routes/api/users.mjs",
  "test/benchmark/framework-native/v2/fixtures/vext-measurement/src/services/order.mjs",
  "test/benchmark/framework-native/v2/fixtures/vext-measurement/src/plugins/benchmark-context.mjs",
  "test/benchmark/framework-native/v2/fixtures/vext-measurement/src/plugins/benchmark-validation.mjs",
  "test/benchmark/framework-native/v2/fixtures/vext-measurement/src/plugins/benchmark-error-access-log.mjs",
]);

async function validateMeasurementPurity(recorded) {
  const current = [];
  for (const relativePath of MEASUREMENT_PURITY_RELATIVE_PATHS) {
    const source = await readFile(join(repositoryRoot, relativePath), "utf8");
    if (
      /observation\.mjs|benchmark-observer|installConformanceIpc/iu.test(source)
    ) {
      throw new Error(
        `Measurement source contains a conformance-only symbol: ${relativePath}`,
      );
    }
    current.push({
      relativePath,
      sha256: await sha256File(join(repositoryRoot, relativePath)),
    });
  }
  const normalizedRecorded = (recorded ?? []).map((entry) => ({
    relativePath: String(entry.path ?? "").replaceAll("\\", "/"),
    sha256: entry.sha256,
  }));
  return equalJson(normalizedRecorded, current);
}

function sidecarP50Gap(samples) {
  const byWorkload = Object.fromEntries(
    ["EW-02", "EW-03"].map((workloadId) => [
      workloadId,
      samples
        .filter((sample) => sample.workloadId === workloadId)
        .map((sample) => Number(sample.sidecar?.snapshot?.actualDelayMs?.p50)),
    ]),
  );
  const p20 = summarizeRps(byWorkload["EW-02"]).median;
  const p40 = summarizeRps(byWorkload["EW-03"]).median;
  return { p20, p40, gap: p40 - p20 };
}

export async function validateRawArtifact(
  raw,
  {
    rawSha256 = null,
    rawFile = null,
    liveConformance = false,
    validationMode = "formal",
  } = {},
) {
  const formalValidation = validationMode === "formal";
  const controlValidation = validationMode === "control";
  const protocol =
    formalValidation || raw?.mode !== "pilot"
      ? WINDOWS_V2_PROTOCOL
      : protocolForMode("pilot");
  const gates = [];
  const details = {
    currentIdentity: null,
    statistics: [],
    liveConformance: null,
  };
  const fail = (id, detail) => gate(gates, id, false, detail);
  try {
    gate(
      gates,
      "raw-schema",
      raw?.schemaVersion === 1 &&
        raw?.artifactType === "framework-native-v2-raw-run",
      "raw artifact schema and producer type",
    );
    gate(
      gates,
      formalValidation ? "formal-mode" : "control-mode",
      formalValidation
        ? raw?.mode === "formal"
        : controlValidation && raw?.mode === "pilot",
      formalValidation
        ? "only a formal raw run can become a citable artifact"
        : "only a complete pilot raw run can pass control validation",
    );
    gate(
      gates,
      "suite-protocol",
      raw?.suite === FRAMEWORK_NATIVE_V2_SUITE_ID &&
        Number(raw?.suiteProtocolVersion) ===
          FRAMEWORK_NATIVE_V2_PROTOCOL_VERSION &&
        equalJson(raw?.protocol, protocol),
      formalValidation
        ? "suite identity and immutable Windows formal protocol"
        : "suite identity and immutable Windows pilot protocol",
    );
    gate(
      gates,
      "runner-completion",
      raw?.execution?.status === "completed" &&
        Array.isArray(raw?.execution?.errors) &&
        raw.execution.errors.length === 0,
      "raw runner completed without recorded errors",
    );
    gate(
      gates,
      "raw-has-no-self-approval",
      !Object.hasOwn(raw ?? {}, "citable") &&
        !Object.hasOwn(raw ?? {}, "accepted"),
      "raw producer did not self-approve its result",
    );

    details.currentIdentity = await readCurrentIdentity();
    const provenance = raw?.provenance ?? {};
    if (formalValidation) {
      gate(
        gates,
        "clean-identity",
        provenance.worktree === "clean" &&
          provenance.status === "" &&
          details.currentIdentity.worktree === "clean" &&
          provenance.commit === details.currentIdentity.commit &&
          provenance.packageJsonSha256 ===
            details.currentIdentity.packageJsonSha256 &&
          provenance.packageLockSha256 ===
            details.currentIdentity.packageLockSha256 &&
          provenance.buildEntrypointSha256 ===
            details.currentIdentity.buildEntrypointSha256,
        "clean commit, package lock and build identity are still present",
      );
    }
    const validatorRunnerSha = await sha256File(
      join(
        repositoryRoot,
        "test",
        "benchmark",
        "framework-native",
        "v2",
        "run-suite.mjs",
      ),
    );
    gate(
      gates,
      "runner-source-identity",
      raw?.runner?.sourceSha256 === validatorRunnerSha,
      "raw runner source matches current candidate",
    );
    gate(
      gates,
      "versions",
      equalJson(
        raw?.frameworkVersions,
        details.currentIdentity.frameworkVersions,
      ),
      "executed framework and direct benchmark dependency versions match candidate",
    );
    gate(
      gates,
      "platform",
      raw?.environment?.platform === "win32" &&
        raw?.environment?.arch === "x64" &&
        process.platform === "win32" &&
        process.arch === "x64",
      "Windows x64 is required for this formal protocol",
    );
    gate(
      gates,
      "measurement-purity",
      await validateMeasurementPurity(raw?.measurementPurity),
      "measurement sources contain no observer/control symbol and match recorded hashes",
    );
    const host = validateHostQualification(raw?.hostQualification, protocol);
    gate(
      gates,
      "host-qualification",
      host.issues.length === 0,
      host.issues.length === 0
        ? "recorded Windows qualification gates"
        : host.issues.join("; "),
    );

    const expectedSchedule = createBalancedBlockSchedule(protocol.blocks);
    const expectedDescriptors = scheduleMeasurements(expectedSchedule);
    gate(
      gates,
      "balanced-schedule",
      equalJson(raw?.schedule, expectedSchedule) &&
        Number(raw?.expectedMeasurementSamples) === expectedDescriptors.length,
      "nine pre-registered balanced Latin-square blocks",
    );
    const sampleById = new Map(
      (raw?.samples ?? []).map((sample) => [sample?.id, sample]),
    );
    const conformanceSemanticWorkloads =
      raw?.conformance?.semanticHashing?.workloads ?? {};
    const sampleIssues = [];
    if (
      !Array.isArray(raw?.samples) ||
      raw.samples.length !== expectedDescriptors.length
    ) {
      sampleIssues.push(
        `expected ${expectedDescriptors.length} complete samples, received ${raw?.samples?.length ?? 0}`,
      );
    }
    for (const descriptor of expectedDescriptors) {
      const sample = sampleById.get(descriptor.id);
      if (!sample) {
        sampleIssues.push(`${descriptor.id}: missing sample`);
        continue;
      }
      for (const problem of validateSample(
        sample,
        descriptor,
        host.roleCpuSets ?? {},
        protocol,
        conformanceSemanticWorkloads[descriptor.workloadId],
      )) {
        sampleIssues.push(`${descriptor.id}: ${problem}`);
      }
    }
    gate(
      gates,
      "measurement-integrity",
      sampleIssues.length === 0,
      sampleIssues.length === 0
        ? "all balanced samples have correct HTTP, latency, affinity and cleanup evidence"
        : sampleIssues.slice(0, 20).join("; "),
    );

    const sidecarGapIssues = [];
    try {
      const gap = sidecarP50Gap(raw?.samples ?? []);
      details.sidecarDelayModes = gap;
      if (gap.gap < protocol.sidecar.minimumDistinctP50GapMs) {
        sidecarGapIssues.push(
          "20ms/40ms measured sidecar P50 gap is below the protocol minimum",
        );
      }
    } catch (error) {
      sidecarGapIssues.push(
        error instanceof Error ? error.message : String(error),
      );
    }
    gate(
      gates,
      "sidecar-delay-separation",
      sidecarGapIssues.length === 0,
      sidecarGapIssues.length === 0
        ? "20ms and 40ms injected dependency modes are distinguishable"
        : sidecarGapIssues.join("; "),
    );

    const calibrationByWorkload = new Map(
      (raw?.calibrations ?? []).map((calibration) => [
        calibration?.workloadId,
        calibration,
      ]),
    );
    const calibrationIssues = [];
    if (
      !Array.isArray(raw?.calibrations) ||
      raw.calibrations.length !== TIMED_WORKLOADS.length
    ) {
      calibrationIssues.push(
        `expected ${TIMED_WORKLOADS.length} no-op calibrations`,
      );
    }
    for (const workload of TIMED_WORKLOADS) {
      const calibration = calibrationByWorkload.get(workload.id);
      if (!calibration) {
        calibrationIssues.push(`${workload.id}: missing no-op calibration`);
        continue;
      }
      const maximumTargetRps = Math.max(
        ...(raw?.samples ?? [])
          .filter((sample) => sample.workloadId === workload.id)
          .map((sample) => Number(sample.measurement?.rps)),
      );
      for (const problem of validateCalibration(
        calibration,
        workload,
        host.roleCpuSets ?? {},
        protocol,
        maximumTargetRps,
      )) {
        calibrationIssues.push(`${workload.id}: ${problem}`);
      }
    }
    gate(
      gates,
      "load-headroom",
      calibrationIssues.length === 0,
      calibrationIssues.length === 0
        ? "same-factory no-op load headroom and CPU gates"
        : calibrationIssues.slice(0, 20).join("; "),
    );

    const cvIssues = [];
    try {
      for (const workload of TIMED_WORKLOADS) {
        for (const target of TARGETS) {
          const values = (raw?.samples ?? [])
            .filter(
              (sample) =>
                sample.workloadId === workload.id &&
                sample.targetId === target.id,
            )
            .map((sample) => Number(sample.measurement?.rps));
          const cv = coefficientOfVariationPercent(values);
          if (values.length !== protocol.blocks || cv > protocol.maxCvPercent) {
            cvIssues.push(
              `${workload.id}/${target.id} CV=${roundMetric(cv)} samples=${values.length}`,
            );
          }
        }
      }
    } catch (error) {
      cvIssues.push(error instanceof Error ? error.message : String(error));
    }
    gate(
      gates,
      "stability-cv",
      cvIssues.length === 0,
      cvIssues.length === 0
        ? `all target/workload CV values are ≤${protocol.maxCvPercent}%`
        : cvIssues.join("; "),
    );

    const conformanceIssues = validateConformance(raw?.conformance, protocol);
    gate(
      gates,
      "recorded-conformance",
      conformanceIssues.length === 0,
      conformanceIssues.length === 0
        ? "all target semantic response hashes and side effects were recorded as equivalent"
        : conformanceIssues.slice(0, 20).join("; "),
    );
    if (liveConformance) {
      try {
        details.liveConformance = await runConformance();
        const liveIssues = validateConformance(
          details.liveConformance,
          protocol,
        );
        gate(
          gates,
          "independent-live-conformance",
          liveIssues.length === 0,
          liveIssues.length === 0
            ? "validator reran conformance in fresh processes"
            : liveIssues.join("; "),
        );
      } catch (error) {
        fail(
          "independent-live-conformance",
          error instanceof Error ? error.message : String(error),
        );
      }
    } else {
      gate(
        gates,
        "independent-live-conformance",
        false,
        "live conformance was explicitly skipped",
      );
    }

    try {
      details.statistics = aggregateStatistics(raw?.samples ?? [], protocol);
      gate(
        gates,
        "paired-bootstrap",
        true,
        "fixed-seed 10,000-iteration paired block bootstrap recomputed",
      );
    } catch (error) {
      fail(
        "paired-bootstrap",
        error instanceof Error ? error.message : String(error),
      );
    }
  } catch (error) {
    fail(
      "validator-internal",
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
  }
  const allGatesPassed =
    gates.length > 0 && gates.every((entry) => entry.status === "PASS");
  const citable = formalValidation && allGatesPassed;
  const controlValid = controlValidation && allGatesPassed;
  return {
    schemaVersion: 1,
    artifactType: formalValidation
      ? "framework-native-v2-accepted-artifact"
      : "framework-native-v2-control-validation",
    suite: FRAMEWORK_NATIVE_V2_SUITE_ID,
    suiteProtocolVersion: FRAMEWORK_NATIVE_V2_PROTOCOL_VERSION,
    acceptedAt: new Date().toISOString(),
    citable,
    controlValid,
    rawArtifact: {
      file: rawFile ? rawFile.split(/[\\/]/u).at(-1) : null,
      sha256: rawSha256,
    },
    validator: {
      entry: "test/benchmark/framework-native/v2/validate-artifact.mjs",
      sourceSha256: await sha256File(__filename),
      liveConformance,
      validationMode,
    },
    gates,
    protocol,
    provenance: raw?.provenance ?? null,
    frameworkVersions: raw?.frameworkVersions ?? null,
    environment: raw?.environment ?? null,
    hostQualification: raw?.hostQualification ?? null,
    conformance: raw?.conformance ?? null,
    validationEvidence: {
      currentIdentity: details.currentIdentity,
      liveConformance: details.liveConformance,
      sidecarDelayModes: details.sidecarDelayModes ?? null,
    },
    statistics: details.statistics,
    samples: raw?.samples ?? [],
    calibrations: raw?.calibrations ?? [],
    publication: {
      method: formalValidation
        ? "independent-validator-recomputed-gates"
        : "independent-control-validator-recomputed-gates",
      rawRunnerCannotSelfApprove: true,
      rawArtifactSha256Required: true,
    },
  };
}

export async function validatePilotRawArtifact(raw, options = {}) {
  return validateRawArtifact(raw, { ...options, validationMode: "control" });
}

async function main() {
  const options = parseArgs();
  const rawText = await readFile(options.input, "utf8");
  const raw = JSON.parse(rawText);
  const accepted = await validateRawArtifact(raw, {
    rawSha256: await sha256File(options.input),
    rawFile: options.input,
    liveConformance: options.liveConformance,
  });
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(
    options.output,
    `${JSON.stringify(jsonSafe(accepted), null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      {
        suite: accepted.suite,
        citable: accepted.citable,
        output: options.output,
        failedGates: accepted.gates
          .filter((entry) => entry.status !== "PASS")
          .map((entry) => entry.id),
      },
      null,
      2,
    ),
  );
  if (!accepted.citable) process.exitCode = 1;
}

export {
  aggregateStatistics,
  parseArgs,
  validateCalibration,
  validateConformance,
  validateHostQualification,
  validateSample,
};

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exitCode = 1;
  });
}
