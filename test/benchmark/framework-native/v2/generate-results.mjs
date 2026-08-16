/**
 * Projects an independently accepted Windows v2 artifact into the same public
 * English and Chinese Enterprise Benchmark pages. It never links users away
 * for samples: the complete table is rendered in-place.
 */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  FRAMEWORK_NATIVE_V2_SUITE_ID,
  TARGETS,
  TIMED_WORKLOADS,
} from "./contract.mjs";
import { sha256 } from "./artifact-utils.mjs";
import { WINDOWS_V2_PROTOCOL } from "./protocol.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repositoryRoot = resolve(__dirname, "../../../..");
const defaultInput = join(
  repositoryRoot,
  "test",
  "benchmark",
  ".artifacts",
  "framework-native-v2-accepted.json",
);
const publicationManifestPath = join(
  repositoryRoot,
  "website",
  "docs",
  "public",
  "benchmark",
  "enterprise-framework-native-v2-manifest.json",
);
const startMarker = "<!-- framework-native-results:start -->";
const endMarker = "<!-- framework-native-results:end -->";

const pages = [
  {
    language: "en",
    path: join(
      repositoryRoot,
      "website",
      "docs",
      "en",
      "enterprise-benchmark.md",
    ),
    labels: {
      title: "Accepted Windows result",
      pending:
        "No independently accepted Windows formal artifact has been published. Smoke and pilot observations are deliberately not shown as benchmark results.",
      introduction:
        "This block is generated only from the independent validator's accepted artifact. It contains the complete sample set on this page; the JSON artifacts are audit evidence, not a second results destination.",
      identity: "Artifact identity and environment",
      versions: "Executed versions",
      conformance: "Semantic conformance fingerprints",
      summary: "Per-workload summary",
      comparisons: "Paired block uncertainty",
      samples: "Complete formal samples",
      headroom: "Load-generator headroom calibration",
      source: "Source",
      accepted: "Accepted artifact SHA-256",
      raw: "Raw-run SHA-256",
      recorded: "Accepted UTC",
      host: "Host",
      roles: "Role CPU sets",
      workload: "Workload",
      target: "Target",
      rps: "Median RPS",
      mean: "Mean RPS",
      cv: "RPS CV",
      p50: "P50",
      p95: "P95",
      p99: "P99",
      cpu: "Target CPU / 1K",
      memory: "Working / peak set",
      left: "Left / right",
      ratio: "Median ratio",
      ratioCi: "95% ratio interval",
      differenceCi: "95% RPS difference interval",
      conclusion: "Pre-registered conclusion",
      block: "Block",
      position: "Target position",
      requests: "Requests",
      statuses: "Statuses",
      loadCpu: "Load CPU",
      sidecar: "Actual sidecar P50 / P95 / P99",
      noopRps: "No-op RPS",
      headroomRatio: "No-op / max target",
      semantic: "Canonical semantic hash",
      conformanceDescription:
        "The hashes below are canonical semantic projections. They intentionally do not compare raw serialized bytes, JSON key order, whitespace, generated order IDs, or volatile request/trace IDs; correlation is asserted before canonicalization.",
      comparisonDescription:
        "The interval is a paired, block-aware percentile bootstrap (10,000 iterations, fixed seed). A conclusion is only “reliable difference” outside the pre-registered ±5% band, “practical tie” wholly inside it, otherwise inconclusive.",
    },
  },
  {
    language: "zh",
    path: join(
      repositoryRoot,
      "website",
      "docs",
      "zh",
      "enterprise-benchmark.md",
    ),
    labels: {
      title: "已接受的 Windows 正式结果",
      pending:
        "尚未发布通过独立验收的 Windows 正式 artifact。smoke 和 pilot 观察值刻意不作为基准结果展示。",
      introduction:
        "本区块只由独立 validator 产生的 accepted artifact 生成。完整样本直接保留在本页；JSON artifact 仅是审计证据，不是第二个结果页面。",
      identity: "Artifact 身份与环境",
      versions: "实际执行版本",
      conformance: "规范语义一致性指纹",
      summary: "按工作负载汇总",
      comparisons: "配对 block 不确定性",
      samples: "完整正式样本",
      headroom: "负载生成器 headroom 校准",
      source: "源码",
      accepted: "Accepted artifact SHA-256",
      raw: "Raw-run SHA-256",
      recorded: "接受时间（UTC）",
      host: "主机",
      roles: "角色 CPU 集合",
      workload: "工作负载",
      target: "目标",
      rps: "RPS 中位数",
      mean: "RPS 均值",
      cv: "RPS CV",
      p50: "P50",
      p95: "P95",
      p99: "P99",
      cpu: "目标 CPU / 1K",
      memory: "Working / 峰值集合",
      left: "左 / 右",
      ratio: "中位数比值",
      ratioCi: "95% 比值区间",
      differenceCi: "95% RPS 差值区间",
      conclusion: "预注册结论",
      block: "Block",
      position: "目标位置",
      requests: "请求数",
      statuses: "状态分布",
      loadCpu: "负载 CPU",
      sidecar: "实际 sidecar P50 / P95 / P99",
      noopRps: "No-op RPS",
      headroomRatio: "No-op / 最大 target",
      semantic: "规范化语义哈希",
      conformanceDescription:
        "下列 hash 是规范化的语义投影；它们刻意不比较原始序列化字节、JSON 键序、空白、生成的订单 ID 或易变的 request/trace ID；关联关系会在规范化前被断言。",
      comparisonDescription:
        "区间使用配对、按 block 感知的 percentile bootstrap（固定 seed、10,000 次）。只有比值区间完全位于预注册 ±5% 区间外才称“可靠差异”，完全位于区间内才称“实际持平”，其余为“未观察到可靠差异”。",
    },
  },
];

function parseArgs() {
  const options = { input: defaultInput, check: false };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    switch (args[index]) {
      case "--input":
        options.input = resolve(repositoryRoot, args[index + 1] ?? "");
        index += 1;
        break;
      case "--check":
        options.check = true;
        break;
      default:
        throw new Error(`Unknown option: ${args[index]}`);
    }
  }
  return options;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function replaceSection(content, replacement) {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`Missing ${startMarker} / ${endMarker}`);
  }
  return `${content.slice(0, start)}${replacement}${content.slice(end + endMarker.length)}`;
}

function currentSection(content) {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`Missing ${startMarker} / ${endMarker}`);
  }
  return content.slice(start, end + endMarker.length);
}

function number(value, fractionDigits = 2) {
  return Number(value ?? 0).toLocaleString("en-US", {
    maximumFractionDigits: fractionDigits,
  });
}

function bytes(value) {
  const input = Number(value ?? 0);
  if (input < 1024) return `${number(input)} B`;
  if (input < 1024 * 1024) return `${number(input / 1024)} KiB`;
  return `${number(input / (1024 * 1024))} MiB`;
}

function micros(value) {
  return `${number(value)} μs`;
}

function statusCounts(value) {
  return Object.entries(value ?? {})
    .map(([status, count]) => `${status}: ${count}`)
    .join(", ");
}

function conclusion(value, language) {
  const localized = {
    "reliable-difference":
      language === "zh" ? "可靠差异" : "reliable difference",
    "practical-tie": language === "zh" ? "实际持平" : "practical tie",
    inconclusive: language === "zh" ? "未观察到可靠差异" : "inconclusive",
  };
  return localized[value] ?? value;
}

function assertAcceptedArtifact(artifact) {
  if (
    artifact?.schemaVersion !== 1 ||
    artifact?.artifactType !== "framework-native-v2-accepted-artifact" ||
    artifact?.suite !== FRAMEWORK_NATIVE_V2_SUITE_ID ||
    artifact?.citable !== true ||
    artifact?.protocol?.id !== WINDOWS_V2_PROTOCOL.id
  ) {
    throw new Error(
      "Only a citable accepted Framework-native v2 artifact may update public pages",
    );
  }
  if (
    !/^[a-f0-9]{64}$/u.test(artifact.rawArtifact?.sha256 ?? "") ||
    !/^[a-f0-9]{64}$/u.test(artifact.validator?.sourceSha256 ?? "") ||
    !Array.isArray(artifact.gates) ||
    artifact.gates.length === 0 ||
    artifact.gates.some((entry) => entry.status !== "PASS")
  ) {
    throw new Error(
      "Accepted artifact lacks a complete independent validation proof",
    );
  }
  if (
    !Array.isArray(artifact.samples) ||
    artifact.samples.length !==
      WINDOWS_V2_PROTOCOL.blocks * TARGETS.length * TIMED_WORKLOADS.length ||
    !Array.isArray(artifact.calibrations) ||
    artifact.calibrations.length !== TIMED_WORKLOADS.length ||
    !Array.isArray(artifact.statistics) ||
    artifact.statistics.length !== TIMED_WORKLOADS.length
  ) {
    throw new Error("Accepted artifact is missing complete formal data");
  }
  return artifact;
}

function renderPending(page) {
  return `${startMarker}

## ${page.labels.title}

${page.labels.pending}

${endMarker}`;
}

function renderArtifact(page, artifact, acceptedSha256) {
  const labels = page.labels;
  const versionRows = Object.entries(artifact.frameworkVersions)
    .map(([packageName, version]) => `| ${packageName} | ${version} |`)
    .join("\n");
  const semanticRows = TIMED_WORKLOADS.map((workload) => {
    const semantic =
      artifact.conformance?.semanticHashing?.workloads?.[workload.id];
    return `| ${workload.id} | ${workload.title} | ${semantic?.algorithm ?? "missing"} | \`${semantic?.hash ?? "missing"}\` |`;
  }).join("\n");
  const summaryRows = artifact.statistics
    .flatMap((result) =>
      TARGETS.map((target) => {
        const metrics = result.targets[target.id];
        return `| ${result.workload.id} | ${target.title} | ${number(metrics.summary.median)} | ${number(metrics.summary.mean)} | ${number(metrics.summary.cvPercent)}% | ${number(metrics.latency.p50)} ms | ${number(metrics.latency.p95)} ms | ${number(metrics.latency.p99)} ms | ${micros(metrics.cpuMicrosecondsPer1kRequests)} | ${bytes(metrics.workingSetBytes)} / ${bytes(metrics.peakWorkingSetBytes)} |`;
      }),
    )
    .join("\n");
  const comparisonRows = artifact.statistics
    .flatMap((result) =>
      result.comparisons.map(
        (comparison) =>
          `| ${result.workload.id} | ${comparison.leftTargetId} / ${comparison.rightTargetId} | ${number(comparison.pointEstimate.ratio, 4)} | ${number(comparison.ratioInterval.lower, 4)} – ${number(comparison.ratioInterval.upper, 4)} | ${number(comparison.differenceInterval.lower)} – ${number(comparison.differenceInterval.upper)} | ${conclusion(comparison.conclusion, page.language)} |`,
      ),
    )
    .join("\n");
  const sampleRows = artifact.samples
    .slice()
    .sort((left, right) => Number(left.sequence) - Number(right.sequence))
    .map((sample) => {
      const latency = sample.measurement.latency;
      const sidecar = sample.sidecar?.snapshot?.actualDelayMs;
      const targetCpu =
        (Number(sample.target.metrics.cpuSeconds) * 1_000_000 * 1_000) /
        Number(sample.measurement.completedRequests);
      const sidecarText =
        sidecar?.p50 === null || sidecar?.p50 === undefined
          ? "—"
          : `${number(sidecar.p50)} / ${number(sidecar.p95)} / ${number(sidecar.p99)} ms`;
      return `| ${sample.block} | ${sample.workloadId} | ${sample.targetId} | ${sample.targetPosition} | ${number(sample.measurement.rps)} | ${number(latency.p50)} | ${number(latency.p95)} | ${number(latency.p99)} | ${number(sample.measurement.completedRequests)} | ${statusCounts(sample.measurement.statusCounts)} | ${number(sample.load.cpuUtilizationPercent)}% | ${micros(targetCpu)} | ${bytes(sample.target.metrics.workingSetBytes)} | ${sidecarText} |`;
    })
    .join("\n");
  const calibrationRows = artifact.calibrations
    .map((calibration) => {
      const maximumTargetRps = Math.max(
        ...artifact.samples
          .filter((sample) => sample.workloadId === calibration.workloadId)
          .map((sample) => Number(sample.measurement.rps)),
      );
      return `| ${calibration.workloadId} | ${number(calibration.rps)} | ${number(Number(calibration.rps) / maximumTargetRps, 3)}× | ${number(calibration.load.cpuUtilizationPercent)}% | ${number(calibration.latency.p50)} / ${number(calibration.latency.p95)} / ${number(calibration.latency.p99)} ms |`;
    })
    .join("\n");
  const roleSets = Object.entries(artifact.hostQualification?.roleCpuSets ?? {})
    .map(([role, cpuSet]) => `${role}: ${cpuSet}`)
    .join("; ");
  const selectedCores = Object.entries(
    artifact.hostQualification?.roleSelection?.roles ?? {},
  )
    .map(
      ([role, value]) =>
        `${role}=${value.coreId} (${value.logicalCpus.join(",")})`,
    )
    .join("; ");
  return `${startMarker}

## ${labels.title}

${labels.introduction}

### ${labels.identity}

| ${labels.recorded} | ${labels.source} | ${labels.host} | ${labels.roles} |
| --- | --- | --- | --- |
| ${artifact.acceptedAt} | \`${artifact.provenance.commit}\` (${artifact.provenance.worktree}) | ${artifact.environment.platform}/${artifact.environment.arch}; Node ${artifact.environment.node}; ${artifact.environment.cpuModel}; ${bytes(artifact.environment.totalMemoryBytes)} | ${roleSets} |

| ${labels.raw} | ${labels.accepted} | Protocol | Selected physical cores |
| --- | --- | --- | --- |
| \`${artifact.rawArtifact.sha256}\` | \`${acceptedSha256}\` | ${artifact.protocol.id}; ${artifact.protocol.connections} connections; pipelining ${artifact.protocol.pipelining}; ${artifact.protocol.warmupSeconds}s warmup; ${artifact.protocol.measurementSeconds}s measure; ${artifact.protocol.blocks} blocks | ${selectedCores} |

### ${labels.versions}

| Package | Version |
| --- | --- |
${versionRows}

### ${labels.conformance}

${labels.conformanceDescription}

| ID | ${labels.workload} | Algorithm | ${labels.semantic} |
| --- | --- | --- | --- |
${semanticRows}

### ${labels.summary}

| ${labels.workload} | ${labels.target} | ${labels.rps} | ${labels.mean} | ${labels.cv} | ${labels.p50} | ${labels.p95} | ${labels.p99} | ${labels.cpu} | ${labels.memory} |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
${summaryRows}

### ${labels.comparisons}

${labels.comparisonDescription}

| ${labels.workload} | ${labels.left} | ${labels.ratio} | ${labels.ratioCi} | ${labels.differenceCi} | ${labels.conclusion} |
| --- | --- | ---: | --- | --- | --- |
${comparisonRows}

### ${labels.samples}

| ${labels.block} | ${labels.workload} | ${labels.target} | ${labels.position} | RPS | ${labels.p50} ms | ${labels.p95} ms | ${labels.p99} ms | ${labels.requests} | ${labels.statuses} | ${labels.loadCpu} | ${labels.cpu} | Working set | ${labels.sidecar} |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- | --- |
${sampleRows}

### ${labels.headroom}

| ${labels.workload} | ${labels.noopRps} | ${labels.headroomRatio} | ${labels.loadCpu} | ${labels.p50} / ${labels.p95} / ${labels.p99} |
| --- | ---: | ---: | ---: | --- |
${calibrationRows}

${endMarker}`;
}

function publicationManifest(artifact, acceptedSha256) {
  if (!artifact) {
    return {
      schemaVersion: 1,
      suite: FRAMEWORK_NATIVE_V2_SUITE_ID,
      status: "pending",
      reason: "No independently accepted formal artifact is available.",
    };
  }
  return {
    schemaVersion: 1,
    suite: FRAMEWORK_NATIVE_V2_SUITE_ID,
    status: "accepted",
    acceptedAt: artifact.acceptedAt,
    sourceCommit: artifact.provenance.commit,
    rawArtifactSha256: artifact.rawArtifact.sha256,
    acceptedArtifactSha256: acceptedSha256,
    validatorSourceSha256: artifact.validator.sourceSha256,
    protocol: artifact.protocol.id,
  };
}

async function readAccepted(path) {
  if (!(await exists(path))) return { artifact: null, acceptedSha256: null };
  const content = await readFile(path);
  const artifact = assertAcceptedArtifact(JSON.parse(content.toString("utf8")));
  return { artifact, acceptedSha256: sha256(content) };
}

async function main() {
  const options = parseArgs();
  const { artifact, acceptedSha256 } = await readAccepted(options.input);
  const manifest = `${JSON.stringify(publicationManifest(artifact, acceptedSha256), null, 2)}\n`;
  for (const page of pages) {
    const current = await readFile(page.path, "utf8");
    const expected = artifact
      ? renderArtifact(page, artifact, acceptedSha256)
      : renderPending(page);
    if (options.check) {
      if (currentSection(current).trim() !== expected.trim()) {
        throw new Error(`${page.path} does not match accepted artifact state`);
      }
      continue;
    }
    await writeFile(page.path, replaceSection(current, expected));
  }
  if (options.check) {
    const currentManifest = (await exists(publicationManifestPath))
      ? await readFile(publicationManifestPath, "utf8")
      : null;
    if (currentManifest !== manifest) {
      throw new Error(
        `${publicationManifestPath} does not match accepted artifact state`,
      );
    }
  } else {
    await mkdir(dirname(publicationManifestPath), { recursive: true });
    await writeFile(publicationManifestPath, manifest);
  }
  console.log(
    JSON.stringify(
      {
        suite: FRAMEWORK_NATIVE_V2_SUITE_ID,
        acceptedArtifact: Boolean(artifact),
        input: options.input,
        checked: options.check,
      },
      null,
      2,
    ),
  );
}

export { assertAcceptedArtifact, renderArtifact, renderPending };

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exitCode = 1;
  });
}
