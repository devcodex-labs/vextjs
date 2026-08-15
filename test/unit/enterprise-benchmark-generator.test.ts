import { describe, expect, it } from "vitest";
import { ENTERPRISE_BENCHMARK_PACKAGES } from "../benchmark/dependency-versions.mjs";
import {
  ENTERPRISE_TARGETS,
  ENTERPRISE_WORKLOADS,
} from "../benchmark/enterprise/contract.mjs";
import {
  assertFormalArtifact,
  assertRawDiagnosticArtifact,
  renderRawDiagnosticReference,
  renderResults,
} from "../benchmark/enterprise/generate-enterprise-results.mjs";

function createSample(round: number, expectedStatus: number) {
  return {
    round,
    rps: 1_000 + round,
    reportedTotalRequests: 30_000 + round,
    totalRequests: 30_000 + round,
    p50LatencyMs: 2 + round,
    p97_5LatencyMs: 4 + round,
    p99LatencyMs: 6 + round,
    errors: 0,
    timeouts: 0,
    non2xx: expectedStatus === 201 ? 0 : 30_000 + round,
    statusDistribution: { [String(expectedStatus)]: 30_000 + round },
    cpuMicroseconds: 1_000_000,
    cpuMicrosecondsPer1kRequests: 100,
    rss: 32 * 1024 * 1024,
    peakRss: 40 * 1024 * 1024,
    telemetry: {},
  };
}

function summarize(samples: ReturnType<typeof createSample>[]) {
  const middle = samples[3]!;
  return {
    ...middle,
    samples,
    rps: {
      median: middle.rps,
      mean: middle.rps,
      min: samples[0]!.rps,
      max: samples.at(-1)!.rps,
      cv: 1,
    },
  };
}

function createFormalArtifact() {
  const targetIds = ENTERPRISE_TARGETS.map((target) => target.id);
  const frameworkVersions = Object.fromEntries(
    ENTERPRISE_BENCHMARK_PACKAGES.map((packageName) => [
      packageName,
      packageName === "fastify" ? "5.12.0" : "1.0.0",
    ]),
  );
  const rounds = 7;
  return {
    schemaVersion: 1,
    suite: "vext-enterprise-workload-suite",
    suiteVersion: 1,
    recordedAt: "2026-08-15T00:00:00.000Z",
    complete: true,
    acceptedForPublication: true,
    executionMode: "formal",
    protocol: {
      id: "linux-x64-v1",
      status: "frozen",
      nodeMajor: 20,
      maxCv: 5,
      qualification: {
        mode: "qualification-pilot",
        recordedAt: "2026-08-14T23:00:00.000Z",
        nodeMajor: 20,
        observedMaxCv: 1,
        approvedMaxCv: 5,
      },
      connections: 50,
      pipelining: 1,
      warmupSeconds: 10,
      durationSeconds: 30,
      rounds,
    },
    options: {
      connections: 50,
      pipelining: 1,
      warmup: 10,
      duration: 30,
      rounds,
      loadCpus: "4-7",
      targetCpus: "0-3",
    },
    provenance: { branch: "main", commit: "abc123", worktree: "clean" },
    environment: {
      node: "v20.20.2",
      platform: "linux",
      arch: "x64",
      cpuModel: "Qualification CPU",
      totalMemoryBytes: 32 * 1024 * 1024 * 1024,
      runnerCpuSet: "4-7",
    },
    dependencyVerification: {
      rows: ENTERPRISE_BENCHMARK_PACKAGES.map((packageName) => ({
        packageName,
        local: frameworkVersions[packageName],
        latest: frameworkVersions[packageName],
        current: true,
      })),
    },
    frameworkVersions: { vextjs: "1.0.1", ...frameworkVersions },
    targetRuntime: {
      "vext-native": { adapter: "native", cpuSet: "0-3" },
      "fastify-native": { fastify: "5.12.0", cpuSet: "0-3" },
      "nest-fastify": { fastify: "5.12.0", cpuSet: "0-3" },
    },
    conformance: Object.fromEntries(
      targetIds.map((targetId) => [
        targetId,
        {
          success: 201,
          "missing-auth": 401,
          forbidden: 403,
          "invalid-body": 422,
          "wrong-method": 405,
          "wrong-content-type": 415,
        },
      ]),
    ),
    results: ENTERPRISE_WORKLOADS.map((workload) => ({
      workload: { ...workload },
      targetOrderByRound: Array.from({ length: rounds }, (_, round) => [
        ...targetIds.slice(round % targetIds.length),
        ...targetIds.slice(0, round % targetIds.length),
      ]),
      targets: Object.fromEntries(
        targetIds.map((targetId) => [
          targetId,
          summarize(
            Array.from({ length: rounds }, (_, round) =>
              createSample(round, workload.expectedStatus),
            ),
          ),
        ]),
      ),
    })),
    stability: { maxCv: 5, unstable: [] },
  };
}

function createRawDiagnosticArtifact(
  formalArtifact: ReturnType<typeof createFormalArtifact>,
) {
  const sample = (round: number) => ({
    rps: 10_000 + round,
    totalRequests: 100_000 + round,
    latencyP50: 1 + round,
    latencyP99: 3 + round,
    throughput: 1_000_000 + round,
    errors: 0,
    timeouts: 0,
    non2xx: 0,
  });
  const metrics = () => {
    const samples = Array.from({ length: 5 }, (_, round) => sample(round));
    return {
      ...samples[2],
      rps: samples[2]!.rps,
      samples,
      stats: {
        samples: samples.map((entry) => entry.rps),
        median: samples[2]!.rps,
        cv: 1,
      },
    };
  };
  const targets = [
    "raw-native",
    "raw-fastify",
    "vext-native-core",
    "vext-native-normal",
  ];
  return {
    schemaVersion: 2,
    suite: "vext-native-fairness-diagnostics",
    suiteVersion: 2,
    recordedAt: "2026-08-15T00:15:00.000Z",
    complete: true,
    provenance: {
      branch: "main",
      commit: formalArtifact.provenance.commit,
      worktree: "clean",
      versions: {
        vextjs: formalArtifact.frameworkVersions.vextjs,
        fastify: formalArtifact.frameworkVersions.fastify,
        autocannon: formalArtifact.frameworkVersions.autocannon,
        routeCore: "0.0.7",
      },
    },
    environment: {
      node: formalArtifact.environment.node,
      platform: formalArtifact.environment.platform,
      arch: formalArtifact.environment.arch,
      cpuModel: formalArtifact.environment.cpuModel,
      totalMemoryBytes: formalArtifact.environment.totalMemoryBytes,
      processPriority: 0,
    },
    options: {
      duration: 10,
      connections: 50,
      pipelining: 10,
      warmup: 5,
      rounds: 5,
      maxCv: 15,
    },
    stability: { maxCv: 15, unstable: [] },
    results: ["json", "params", "chain", "middleware-chain"].map(
      (scenario) => ({
        scenario,
        targets: Object.fromEntries(
          targets
            .filter(
              (targetId) =>
                !(
                  targetId === "vext-native-core" &&
                  scenario === "middleware-chain"
                ),
            )
            .map((targetId) => [targetId, metrics()]),
        ),
      }),
    ),
  };
}

describe("Enterprise benchmark result generator", () => {
  it("renders every formal round on the localized result page", () => {
    const artifact = createFormalArtifact();

    expect(() => assertFormalArtifact(artifact)).not.toThrow();

    const en = renderResults(artifact, "en");
    const zh = renderResults(artifact, "zh");
    expect(en).toContain("### Complete per-round sample");
    expect(en).toContain("Completed / processed requests");
    expect(en).toContain("30,000 / 30,000");
    expect(zh).toContain("### 完整逐轮样本");
    expect(zh).toContain("完成 / 已处理请求");
    expect(
      en.match(/\| Success: CPU-bound service composition \| Vext Native \|/g),
    ).toHaveLength(7);
  });

  it("rejects an artifact whose complete-sample evidence is tampered", () => {
    const artifact = createFormalArtifact();
    artifact.results[0]!.targets["vext-native"].samples[0]!.errors = 1;

    expect(() => assertFormalArtifact(artifact)).toThrow(
      "contains an invalid formal sample",
    );
  });

  it("rejects a formal artifact that omits Autocannon's P97.5 latency", () => {
    const artifact = createFormalArtifact();
    delete artifact.results[0]!.targets["vext-native"]!.samples[0]!
      .p97_5LatencyMs;

    expect(() => assertFormalArtifact(artifact)).toThrow(
      "contains an invalid formal sample",
    );
  });

  it("renders matching raw diagnostics as an explicitly secondary same-page reference", () => {
    const formalArtifact = createFormalArtifact();
    const rawArtifact = createRawDiagnosticArtifact(formalArtifact);

    expect(() =>
      assertRawDiagnosticArtifact(rawArtifact, formalArtifact),
    ).not.toThrow();

    const en = renderRawDiagnosticReference(rawArtifact, "en");
    const zh = renderRawDiagnosticReference(rawArtifact, "zh");
    expect(en).toContain("not a production ranking");
    expect(en).toContain("Complete per-round diagnostic samples");
    expect(en).toContain("Raw Native");
    expect(zh).toContain("非生产排名");
    expect(zh).toContain("完整逐轮诊断样本");
  });

  it("rejects a raw diagnostic from a different source revision", () => {
    const formalArtifact = createFormalArtifact();
    const rawArtifact = createRawDiagnosticArtifact(formalArtifact);
    rawArtifact.provenance.commit = "other-commit";

    expect(() =>
      assertRawDiagnosticArtifact(rawArtifact, formalArtifact),
    ).toThrow("does not match the formal result source or environment");
  });

  it("rejects a raw diagnostic without complete per-round metrics", () => {
    const formalArtifact = createFormalArtifact();
    const rawArtifact = createRawDiagnosticArtifact(formalArtifact);
    rawArtifact.results[0]!.targets["raw-native"]!.samples = [];

    expect(() =>
      assertRawDiagnosticArtifact(rawArtifact, formalArtifact),
    ).toThrow("does not contain complete samples");
  });
});
