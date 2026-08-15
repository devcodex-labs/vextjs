/**
 * Projects one accepted Framework-native formal artifact into the two public
 * documentation pages. Full samples remain on those pages; this script never
 * creates a GitHub-only or second results page.
 */

import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format as formatMarkdown } from "prettier";
import { FRAMEWORK_NATIVE_BENCHMARK_PACKAGES } from "../dependency-versions.mjs";
import {
  FRAMEWORK_NATIVE_SUITE_ID,
  FRAMEWORK_NATIVE_TARGETS,
  FRAMEWORK_NATIVE_WORKLOADS,
} from "./contract.mjs";
import { assertImplementationManifest } from "./implementation-manifest.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPOSITORY_ROOT = resolve(__dirname, "../../..");
const DEFAULT_INPUT = join(
  REPOSITORY_ROOT,
  "test",
  "benchmark",
  ".artifacts",
  "framework-native-latest.json",
);
const START = "<!-- framework-native-results:start -->";
const END = "<!-- framework-native-results:end -->";
const PAGES = [
  {
    language: "en",
    path: join(
      REPOSITORY_ROOT,
      "website",
      "docs",
      "en",
      "enterprise-benchmark.md",
    ),
    pending: "No accepted formal artifact has been published yet.",
    labels: {
      title: "Accepted formal result",
      body: "This block is generated only from an accepted clean Linux x64 formal artifact. It keeps the complete sample set here with the methodology; local and pilot observations cannot replace it.",
      identity: "Artifact identity",
      versions: "Executed versions",
      summary: "Summary",
      samples: "Complete round samples",
      protocol: "Protocol",
      source: "Source",
      environment: "Environment",
      recorded: "Recorded UTC",
      semantic: "Semantic response hash",
      semanticDescription:
        "The values below are SHA-256 hashes of a versioned canonical semantic projection. JSON byte order, whitespace, and raw serialized representation are intentionally not compared.",
      workload: "Workload",
      target: "Target",
      rps: "Median RPS",
      cv: "RPS CV",
      p50: "P50",
      p99: "P99",
      cpu: "Target CPU / 1K",
      peakRss: "Target peak RSS",
      round: "Round",
      requests: "Completed requests",
      statuses: "Status distribution",
    },
  },
  {
    language: "zh",
    path: join(
      REPOSITORY_ROOT,
      "website",
      "docs",
      "zh",
      "enterprise-benchmark.md",
    ),
    pending: "尚未发布已接受的正式 artifact。",
    labels: {
      title: "已接受的正式结果",
      body: "本区块只由已接受、源码干净的 Linux x64 正式 artifact 生成。完整轮次样本与方法留在同一页面；本地或 pilot 观察不能替代它。",
      identity: "Artifact 身份",
      versions: "实际执行版本",
      summary: "汇总",
      samples: "完整逐轮样本",
      protocol: "协议",
      source: "源码",
      environment: "环境",
      recorded: "记录时间（UTC）",
      semantic: "语义响应哈希",
      semanticDescription:
        "下列值是版本化规范语义投影的 SHA-256 哈希；JSON 字节顺序、空白和原始序列化表示刻意不参与比较。",
      workload: "工作负载",
      target: "目标",
      rps: "RPS 中位数",
      cv: "RPS CV",
      p50: "P50",
      p99: "P99",
      cpu: "目标 CPU / 1K",
      peakRss: "目标峰值 RSS",
      round: "轮次",
      requests: "完成请求数",
      statuses: "状态分布",
    },
  },
];

function parseArgs() {
  const options = { input: DEFAULT_INPUT, check: false };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    switch (args[index]) {
      case "--input":
        options.input = resolve(REPOSITORY_ROOT, args[index + 1] ?? "");
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

function section(content) {
  const start = content.indexOf(START);
  const end = content.indexOf(END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(
      `Framework-native documentation is missing ${START} / ${END}`,
    );
  }
  return content.slice(start, end + END.length);
}

function replaceSection(content, nextSection) {
  const start = content.indexOf(START);
  const end = content.indexOf(END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(
      `Framework-native documentation is missing ${START} / ${END}`,
    );
  }
  return `${content.slice(0, start)}${nextSection}${content.slice(end + END.length)}`;
}

function formatNumber(value, maximumFractionDigits = 2) {
  return Number(value ?? 0).toLocaleString("en-US", { maximumFractionDigits });
}

function formatBytes(value) {
  const bytes = Number(value ?? 0);
  if (bytes < 1024) return `${formatNumber(bytes)} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024)} KiB`;
  return `${formatNumber(bytes / (1024 * 1024))} MiB`;
}

function formatMicros(value) {
  return `${formatNumber(value)} μs`;
}

function statusDistribution(value) {
  return Object.entries(value ?? {})
    .map(([status, count]) => `${status}: ${count}`)
    .join(", ");
}

function assertArtifact(artifact) {
  if (
    artifact?.suite !== FRAMEWORK_NATIVE_SUITE_ID ||
    artifact?.mode !== "formal" ||
    artifact?.complete !== true ||
    artifact?.citable !== true
  ) {
    throw new Error(
      "Only a complete citable formal Framework-native artifact may update user documentation",
    );
  }
  if (
    artifact.protocol?.status !== "accepted" ||
    artifact.provenance?.worktree !== "clean"
  ) {
    throw new Error(
      "Formal artifact lacks an accepted protocol or clean source provenance",
    );
  }
  if (
    artifact.conformance?.semanticHashing?.canonicalized !== true ||
    artifact.conformance?.semanticHashing?.rawSerializedBytesCompared !== false
  ) {
    throw new Error(
      "Formal artifact does not prove canonical semantic response hashing",
    );
  }
  assertImplementationManifest(artifact.implementationManifest);
  for (const packageName of FRAMEWORK_NATIVE_BENCHMARK_PACKAGES) {
    if (!artifact.frameworkVersions?.[packageName]) {
      throw new Error(
        `Formal artifact is missing ${packageName} version provenance`,
      );
    }
  }
  if (
    !Array.isArray(artifact.results) ||
    artifact.results.length !== FRAMEWORK_NATIVE_WORKLOADS.length
  ) {
    throw new Error("Formal artifact has an incomplete workload set");
  }
  for (const result of artifact.results) {
    const workload = FRAMEWORK_NATIVE_WORKLOADS.find(
      (entry) => entry.id === result.workload?.id,
    );
    if (!workload)
      throw new Error(
        `Formal artifact contains an unknown workload ${result.workload?.id}`,
      );
    for (const target of FRAMEWORK_NATIVE_TARGETS) {
      const metrics = result.targets?.[target.id];
      if (
        !metrics ||
        !Array.isArray(metrics.samples) ||
        metrics.samples.length !== artifact.options?.rounds
      ) {
        throw new Error(
          `${workload.id}/${target.id} is missing complete formal samples`,
        );
      }
    }
  }
  return artifact;
}

function renderPending(page) {
  return `${START}\n\n## ${page.labels.title}\n\n${page.pending}\n\n${END}`;
}

function renderArtifact(page, artifact) {
  const labels = page.labels;
  const versionRows = ["vextjs", ...FRAMEWORK_NATIVE_BENCHMARK_PACKAGES]
    .map(
      (packageName) =>
        `| ${packageName} | ${artifact.frameworkVersions[packageName]} |`,
    )
    .join("\n");
  const summaryRows = artifact.results.flatMap((result) =>
    FRAMEWORK_NATIVE_TARGETS.map((target) => {
      const metrics = result.targets[target.id];
      return `| ${result.workload.title} | ${target.title} | ${formatNumber(metrics.rps.median)} | ${formatNumber(metrics.rps.cvPercent)}% | ${formatNumber(metrics.p50LatencyMs)} ms | ${formatNumber(metrics.p99LatencyMs)} ms | ${formatMicros(metrics.targetCpuMicrosecondsPer1kRequests)} | ${formatBytes(metrics.targetPeakRssBytes)} |`;
    }),
  );
  const sampleRows = artifact.results.flatMap((result) =>
    FRAMEWORK_NATIVE_TARGETS.flatMap((target) =>
      result.targets[target.id].samples.map(
        (sample) =>
          `| ${result.workload.title} | ${target.title} | ${sample.round + 1} | ${formatNumber(sample.rps)} | ${formatNumber(sample.totalRequests)} | ${formatNumber(sample.p50LatencyMs)} / ${formatNumber(sample.p99LatencyMs)} ms | ${statusDistribution(sample.statusDistribution)} |`,
      ),
    ),
  );
  const semanticRows = FRAMEWORK_NATIVE_WORKLOADS.map((workload) => {
    const semantic =
      artifact.conformance.semanticHashing.workloads[workload.id];
    return `| ${workload.title} | ${semantic.algorithm} | \`${semantic.hash}\` |`;
  });
  return `${START}

## ${labels.title}

${labels.body}

### ${labels.identity}

| ${labels.recorded} | ${labels.source} | ${labels.protocol} | ${labels.environment} |
| --- | --- | --- | --- |
| ${artifact.recordedAt} | \`${artifact.provenance.commit}\` (${artifact.provenance.worktree}) | ${artifact.protocol.id}; ${artifact.options.connections} connections; pipelining ${artifact.options.pipelining}; ${artifact.options.warmupSeconds}s warmup; ${artifact.options.durationSeconds}s × ${artifact.options.rounds} | ${artifact.environment.platform} ${artifact.environment.arch}; Node ${artifact.environment.node}; ${artifact.environment.cpuModel}; ${formatBytes(artifact.environment.totalMemoryBytes)} |

### ${labels.versions}

| Package | Version |
| --- | --- |
${versionRows}

### ${labels.semantic}

${labels.semanticDescription}

| ${labels.workload} | Algorithm | Hash |
| --- | --- | --- |
${semanticRows.join("\n")}

### ${labels.summary}

| ${labels.workload} | ${labels.target} | ${labels.rps} | ${labels.cv} | ${labels.p50} | ${labels.p99} | ${labels.cpu} | ${labels.peakRss} |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
${summaryRows.join("\n")}

### ${labels.samples}

| ${labels.workload} | ${labels.target} | ${labels.round} | RPS | ${labels.requests} | P50 / P99 | ${labels.statuses} |
| --- | --- | ---: | ---: | ---: | --- | --- |
${sampleRows.join("\n")}

${END}`;
}

async function readArtifact(path) {
  if (!(await exists(path))) return undefined;
  const artifact = JSON.parse(await readFile(path, "utf8"));
  // Local smoke and pilot artifacts intentionally share the default evidence
  // location. They prove implementation behavior but must leave user-facing
  // documentation in its pending state rather than making docs verification
  // fail or, worse, publishing local throughput.
  if (
    artifact?.suite === FRAMEWORK_NATIVE_SUITE_ID &&
    artifact?.citable === false
  ) {
    return undefined;
  }
  return assertArtifact(artifact);
}

async function main() {
  const options = parseArgs();
  const artifact = await readArtifact(options.input);
  for (const page of PAGES) {
    const current = await readFile(page.path, "utf8");
    const expected = artifact
      ? renderArtifact(page, artifact)
      : renderPending(page);
    if (options.check) {
      if (section(current).trim() !== expected.trim()) {
        throw new Error(
          `${page.path} does not match the current Framework-native artifact state`,
        );
      }
      continue;
    }
    const next = await formatMarkdown(replaceSection(current, expected), {
      parser: "markdown",
    });
    await writeFile(page.path, next);
  }
  console.log(
    JSON.stringify(
      {
        input: options.input,
        citableArtifact: Boolean(artifact),
        checked: options.check,
      },
      null,
      2,
    ),
  );
}

export { assertArtifact, renderArtifact, renderPending };

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exitCode = 1;
  });
}
