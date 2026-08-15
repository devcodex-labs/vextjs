/**
 * Renders a formal Enterprise Workload Suite artifact into the two user-facing
 * documentation pages. Results never move to a GitHub-only or second results
 * page: the methodology and every formal sample stay together.
 */

import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ENTERPRISE_BENCHMARK_PACKAGES } from "../dependency-versions.mjs";
import {
  ENTERPRISE_SUITE_ID,
  ENTERPRISE_TARGETS,
  ENTERPRISE_WORKLOADS,
} from "./contract.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPOSITORY_ROOT = resolve(__dirname, "../../..");
const DEFAULT_INPUT = join(
  REPOSITORY_ROOT,
  "test",
  "benchmark",
  ".artifacts",
  "enterprise-latest.json",
);
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
    pending: "尚未发布可接受的正式 artifact。",
  },
];
const START = "<!-- enterprise-results:start -->";
const END = "<!-- enterprise-results:end -->";

function parseArgs() {
  const options = { input: DEFAULT_INPUT, check: false };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    switch (args[index]) {
      case "--input":
        options.input = resolve(REPOSITORY_ROOT, args[index + 1]);
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
    throw new Error("Enterprise benchmark page is missing its result markers");
  }
  return content.slice(start, end + END.length);
}

function formatNumber(value, maximumFractionDigits = 2) {
  return Number(value ?? 0).toLocaleString("en-US", {
    maximumFractionDigits,
  });
}

function formatBytes(bytes) {
  const value = Number(bytes ?? 0);
  if (value < 1024) return `${formatNumber(value)} B`;
  if (value < 1024 * 1024) return `${formatNumber(value / 1024)} KiB`;
  return `${formatNumber(value / (1024 * 1024))} MiB`;
}

function parseCpuSet(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid CPU set: ${value ?? "missing"}`);
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

function sameCpuSet(left, right) {
  return left.size === right.size && [...left].every((cpu) => right.has(cpu));
}

function expectedStatusDistribution(statusDistribution, expectedStatus) {
  const entries = Object.entries(statusDistribution ?? {});
  const expectedClass = `${Math.floor(expectedStatus / 100)}xx`;
  return (
    entries.length > 0 &&
    entries.every(([status, count]) => {
      const numericCount = Number(count);
      return (
        Number.isFinite(numericCount) &&
        numericCount >= 0 &&
        (numericCount === 0 ||
          status === String(expectedStatus) ||
          status.toLowerCase() === expectedClass)
      );
    })
  );
}

function assertConformance(artifact, targetId) {
  const statuses = artifact.conformance?.[targetId];
  if (
    statuses?.success !== 201 ||
    statuses["missing-auth"] !== 401 ||
    statuses.forbidden !== 403 ||
    statuses["invalid-body"] !== 422 ||
    statuses["wrong-method"] < 400 ||
    statuses["wrong-content-type"] < 400
  ) {
    throw new Error(
      `${targetId} does not satisfy the published conformance contract`,
    );
  }
}

function assertSamples(result, targetId, artifact) {
  const metrics = result.targets?.[targetId];
  const samples = metrics?.samples;
  if (!Array.isArray(samples) || samples.length !== artifact.options.rounds) {
    throw new Error(
      `${result.workload?.id}/${targetId} does not contain one complete sample per round`,
    );
  }
  const observedRounds = new Set();
  for (const sample of samples) {
    const completedResponses = Object.values(
      sample.statusDistribution ?? {},
    ).reduce((sum, count) => sum + Number(count), 0);
    if (
      !Number.isInteger(sample.round) ||
      sample.round < 0 ||
      sample.round >= artifact.options.rounds ||
      observedRounds.has(sample.round)
    ) {
      throw new Error(
        `${result.workload?.id}/${targetId} has invalid round evidence`,
      );
    }
    observedRounds.add(sample.round);
    if (
      !Number.isFinite(sample.rps) ||
      sample.rps <= 0 ||
      !Number.isFinite(sample.reportedTotalRequests) ||
      sample.reportedTotalRequests <= 0 ||
      !Number.isFinite(sample.totalRequests) ||
      sample.totalRequests <= 0 ||
      completedResponses !== sample.reportedTotalRequests ||
      sample.totalRequests < sample.reportedTotalRequests ||
      sample.totalRequests >
        sample.reportedTotalRequests +
          artifact.options.connections * artifact.options.pipelining ||
      sample.errors !== 0 ||
      sample.timeouts !== 0 ||
      !expectedStatusDistribution(
        sample.statusDistribution,
        result.workload.expectedStatus,
      )
    ) {
      throw new Error(
        `${result.workload?.id}/${targetId} contains an invalid formal sample`,
      );
    }
  }
  if (
    !Number.isFinite(metrics.rps?.cv) ||
    metrics.rps.cv > artifact.protocol.maxCv
  ) {
    throw new Error(
      `${result.workload?.id}/${targetId} does not satisfy the frozen CV gate`,
    );
  }
}

function assertFormalArtifact(artifact) {
  if (
    artifact?.schemaVersion !== 1 ||
    artifact.suite !== ENTERPRISE_SUITE_ID ||
    artifact.complete !== true ||
    artifact.acceptedForPublication !== true ||
    artifact.executionMode !== "formal"
  ) {
    throw new Error(
      "Artifact is not an accepted formal Enterprise Workload Suite result",
    );
  }
  const nodeMajor = Number(
    /^v?(\d+)\./u.exec(artifact.environment?.node ?? "")?.[1],
  );
  if (
    artifact.protocol?.status !== "frozen" ||
    !Number.isFinite(artifact.protocol?.maxCv) ||
    !Number.isInteger(artifact.protocol?.nodeMajor) ||
    artifact.protocol.nodeMajor <= 0 ||
    nodeMajor !== artifact.protocol.nodeMajor ||
    artifact.environment?.platform !== "linux" ||
    artifact.environment?.arch !== "x64" ||
    artifact.provenance?.worktree !== "clean" ||
    typeof artifact.provenance?.commit !== "string" ||
    artifact.provenance.commit.length === 0
  ) {
    throw new Error(
      "Formal artifact does not satisfy the publication environment gate",
    );
  }
  if (
    artifact.options?.connections !== 50 ||
    artifact.options?.pipelining !== 1 ||
    artifact.options?.warmup < 10 ||
    artifact.options?.duration < 30 ||
    artifact.options?.rounds < 7 ||
    !artifact.options?.loadCpus ||
    !artifact.options?.targetCpus
  ) {
    throw new Error(
      "Formal artifact does not satisfy the frozen workload protocol",
    );
  }
  for (const [optionKey, protocolKey] of [
    ["connections", "connections"],
    ["pipelining", "pipelining"],
    ["warmup", "warmupSeconds"],
    ["duration", "durationSeconds"],
    ["rounds", "rounds"],
  ]) {
    if (artifact.options?.[optionKey] !== artifact.protocol?.[protocolKey]) {
      throw new Error(
        `Formal artifact option ${optionKey} does not match frozen protocol ${protocolKey}`,
      );
    }
  }
  const loadCpus = parseCpuSet(artifact.options.loadCpus);
  const targetCpus = parseCpuSet(artifact.options.targetCpus);
  if ([...loadCpus].some((cpu) => targetCpus.has(cpu))) {
    throw new Error("Formal artifact load and target CPU sets overlap");
  }
  if (!sameCpuSet(loadCpus, parseCpuSet(artifact.environment.runnerCpuSet))) {
    throw new Error(
      "Formal artifact runner CPU affinity differs from its load CPU set",
    );
  }
  if (artifact.stability?.unstable?.length !== 0) {
    throw new Error(
      "Formal artifact contains measurements that fail its CV gate",
    );
  }
  if (artifact.stability?.maxCv !== artifact.protocol.maxCv) {
    throw new Error(
      "Formal artifact stability gate differs from its frozen protocol",
    );
  }
  const rows = artifact.dependencyVerification?.rows;
  if (
    !Array.isArray(rows) ||
    rows.length !== ENTERPRISE_BENCHMARK_PACKAGES.length
  ) {
    throw new Error("Formal artifact dependency verification is incomplete");
  }
  for (const packageName of ENTERPRISE_BENCHMARK_PACKAGES) {
    const row = rows.find((entry) => entry.packageName === packageName);
    if (
      !row ||
      row.current !== true ||
      row.local !== row.latest ||
      artifact.frameworkVersions?.[packageName] !== row.local
    ) {
      throw new Error(
        `Formal artifact dependency ${packageName} is not verified as current`,
      );
    }
  }
  if (typeof artifact.frameworkVersions?.vextjs !== "string") {
    throw new Error("Formal artifact does not record the VextJS version");
  }
  const runtime = artifact.targetRuntime;
  if (
    runtime?.["vext-native"]?.adapter !== "native" ||
    runtime?.["fastify-native"]?.fastify !==
      artifact.frameworkVersions.fastify ||
    runtime?.["nest-fastify"]?.fastify !== artifact.frameworkVersions.fastify
  ) {
    throw new Error(
      "Formal artifact does not prove the required target runtime versions",
    );
  }
  for (const target of ENTERPRISE_TARGETS) {
    if (!sameCpuSet(targetCpus, parseCpuSet(runtime[target.id]?.cpuSet))) {
      throw new Error(
        `Formal artifact ${target.id} CPU affinity differs from its target CPU set`,
      );
    }
    assertConformance(artifact, target.id);
  }
  if (!Array.isArray(artifact.results)) {
    throw new Error("Formal artifact has no workload results");
  }
  const expectedTargets = ENTERPRISE_TARGETS.map((target) => target.id).sort();
  const actualWorkloads = artifact.results.map((result) => result.workload?.id);
  const expectedWorkloads = ENTERPRISE_WORKLOADS.map((workload) => workload.id);
  if (JSON.stringify(actualWorkloads) !== JSON.stringify(expectedWorkloads)) {
    throw new Error(
      "Formal artifact workload set differs from the published Enterprise Workload Suite",
    );
  }
  for (const result of artifact.results) {
    const actualTargets = Object.keys(result.targets ?? {}).sort();
    if (JSON.stringify(actualTargets) !== JSON.stringify(expectedTargets)) {
      throw new Error(
        "Formal artifact target set differs from the published Enterprise Workload Suite",
      );
    }
    if (
      !Array.isArray(result.targetOrderByRound) ||
      result.targetOrderByRound.length !== artifact.options.rounds
    ) {
      throw new Error(
        `${result.workload?.id} lacks complete target rotation evidence`,
      );
    }
    for (const [round, order] of result.targetOrderByRound.entries()) {
      const targetIds = ENTERPRISE_TARGETS.map((target) => target.id);
      const expectedOrder = [
        ...targetIds.slice(round % targetIds.length),
        ...targetIds.slice(0, round % targetIds.length),
      ];
      if (JSON.stringify(order) !== JSON.stringify(expectedOrder)) {
        throw new Error(
          `${result.workload?.id} has an invalid target rotation order`,
        );
      }
    }
    for (const target of ENTERPRISE_TARGETS) {
      assertSamples(result, target.id, artifact);
    }
  }
}

function renderSummaryTable(artifact, language) {
  const labels =
    language === "zh"
      ? {
          workload: "工作负载",
          rps: "RPS 中位数",
          p99: "P99 中位数",
          cpu: "CPU / 1K 中位数",
        }
      : {
          workload: "Workload",
          rps: "Median RPS",
          p99: "Median P99",
          cpu: "Median CPU / 1K",
        };
  const header = [
    labels.workload,
    ...ENTERPRISE_TARGETS.flatMap((target) => [
      `${target.title} ${labels.rps}`,
      `${target.title} ${labels.p99}`,
      `${target.title} ${labels.cpu}`,
    ]),
  ];
  const rows = artifact.results.map((result) => [
    result.workload.title,
    ...ENTERPRISE_TARGETS.flatMap((target) => {
      const metrics = result.targets[target.id];
      return [
        formatNumber(metrics.rps.median),
        `${formatNumber(metrics.p99LatencyMs)} ms`,
        `${formatNumber(metrics.cpuMicrosecondsPer1kRequests)} μs`,
      ];
    }),
  ]);
  return [header, header.map(() => "---"), ...rows]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
}

function renderFullSamples(artifact, language) {
  const header =
    language === "zh"
      ? [
          "工作负载",
          "目标",
          "轮次",
          "RPS",
          "完成 / 已处理请求",
          "P50 / P95 / P99",
          "状态分布",
          "CPU / 1K",
          "RSS / 峰值 RSS",
        ]
      : [
          "Workload",
          "Target",
          "Round",
          "RPS",
          "Completed / processed requests",
          "P50 / P95 / P99",
          "Status distribution",
          "CPU / 1K",
          "RSS / peak RSS",
        ];
  const rows = artifact.results.flatMap((result) =>
    ENTERPRISE_TARGETS.map((target) => {
      const metrics = result.targets[target.id];
      return metrics.samples.map((sample) => {
        const statuses = Object.entries(sample.statusDistribution)
          .map(([status, count]) => `${status}: ${count}`)
          .join(", ");
        return [
          result.workload.title,
          target.title,
          String(sample.round + 1),
          formatNumber(sample.rps),
          `${formatNumber(sample.reportedTotalRequests)} / ${formatNumber(sample.totalRequests)}`,
          `${formatNumber(sample.p50LatencyMs)} / ${formatNumber(sample.p95LatencyMs)} / ${formatNumber(sample.p99LatencyMs)} ms`,
          statuses,
          `${formatNumber(sample.cpuMicrosecondsPer1kRequests)} μs`,
          `${formatBytes(sample.rss)} / ${formatBytes(sample.peakRss)}`,
        ];
      });
    }).flat(),
  );
  return [header, header.map(() => "---"), ...rows]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
}

function renderResults(artifact, language) {
  const isZh = language === "zh";
  const versions = artifact.frameworkVersions ?? {};
  const current = isZh ? "## 当前正式结果" : "## Current formal results";
  const statement = isZh
    ? `此结果于 **${artifact.recordedAt}** 生成，来自干净源码 \`${artifact.provenance.branch}@${artifact.provenance.commit}\`。它是一个可引用的 Linux x64 正式样本；每个数字都是 ${artifact.options.rounds} 轮的 RPS 中位数。`
    : `This result was recorded at **${artifact.recordedAt}** from clean source \`${artifact.provenance.branch}@${artifact.provenance.commit}\`. It is a citable Linux x64 formal sample; each throughput value is the median RPS from ${artifact.options.rounds} rounds.`;
  const metadata = isZh
    ? [
        ["字段", "值"],
        [
          "源码",
          `\`${artifact.provenance.branch}@${artifact.provenance.commit}\`（clean）`,
        ],
        [
          "平台",
          `${artifact.environment.platform} ${artifact.environment.arch}`,
        ],
        ["Node.js", artifact.environment.node],
        [
          "协议",
          `${artifact.protocol.id}; Node ${artifact.protocol.nodeMajor}.x；${artifact.options.duration}s × ${artifact.options.rounds} 轮；${artifact.options.connections} connections；pipelining ${artifact.options.pipelining}；${artifact.options.warmup}s 预热；CV ≤ ${artifact.protocol.maxCv}%`,
        ],
        [
          "CPU 隔离",
          `load=${artifact.options.loadCpus}; target=${artifact.options.targetCpus}`,
        ],
        [
          "版本",
          `Vext ${versions.vextjs}; Fastify ${versions.fastify}; Nest common/core/platform-fastify ${versions["@nestjs/common"]}/${versions["@nestjs/core"]}/${versions["@nestjs/platform-fastify"]}; reflect-metadata ${versions["reflect-metadata"]}; rxjs ${versions.rxjs}; Autocannon ${versions.autocannon}`,
        ],
      ]
    : [
        ["Field", "Value"],
        [
          "Source",
          `\`${artifact.provenance.branch}@${artifact.provenance.commit}\` (clean)`,
        ],
        [
          "Platform",
          `${artifact.environment.platform} ${artifact.environment.arch}`,
        ],
        ["Node.js", artifact.environment.node],
        [
          "Protocol",
          `${artifact.protocol.id}; Node ${artifact.protocol.nodeMajor}.x; ${artifact.options.duration}s × ${artifact.options.rounds} rounds; ${artifact.options.connections} connections; pipelining ${artifact.options.pipelining}; ${artifact.options.warmup}s warmup; CV ≤ ${artifact.protocol.maxCv}%`,
        ],
        [
          "CPU isolation",
          `load=${artifact.options.loadCpus}; target=${artifact.options.targetCpus}`,
        ],
        [
          "Versions",
          `Vext ${versions.vextjs}; Fastify ${versions.fastify}; Nest common/core/platform-fastify ${versions["@nestjs/common"]}/${versions["@nestjs/core"]}/${versions["@nestjs/platform-fastify"]}; reflect-metadata ${versions["reflect-metadata"]}; rxjs ${versions.rxjs}; Autocannon ${versions.autocannon}`,
        ],
      ];
  const metadataTable = [
    `| ${metadata[0].join(" | ")} |`,
    "| --- | --- |",
    ...metadata.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
  const fullTitle = isZh ? "### 完整逐轮样本" : "### Complete per-round sample";
  const note = isZh
    ? "每个逐轮样本的请求数、状态分布、延迟、CPU 与 RSS 都在本页；本页不会把完整证据转移到 GitHub 或另一个 results 页面。"
    : "Every per-round request count, status distribution, latency, CPU, and RSS value remains on this page; the complete evidence is not moved to GitHub or a separate results page.";
  return [
    START,
    current,
    "",
    statement,
    "",
    renderSummaryTable(artifact, language),
    "",
    isZh ? "### 运行身份与协议" : "### Run identity and protocol",
    "",
    metadataTable,
    "",
    fullTitle,
    "",
    note,
    "",
    renderFullSamples(artifact, language),
    "",
    END,
  ].join("\n");
}

async function verifyPendingPages() {
  for (const page of PAGES) {
    const content = await readFile(page.path, "utf8");
    if (!section(content).includes(page.pending)) {
      throw new Error(
        `${page.path} has no formal artifact but does not contain the required pending-state explanation`,
      );
    }
  }
}

async function main() {
  const options = parseArgs();
  if (!(await exists(options.input))) {
    if (options.check && options.input === DEFAULT_INPUT) {
      await verifyPendingPages();
      console.log(
        "Enterprise benchmark pages correctly show no accepted formal artifact.",
      );
      return;
    }
    throw new Error(
      `Enterprise benchmark artifact does not exist: ${options.input}`,
    );
  }
  const artifact = JSON.parse(await readFile(options.input, "utf8"));
  assertFormalArtifact(artifact);
  for (const page of PAGES) {
    const current = await readFile(page.path, "utf8");
    const expected = renderResults(artifact, page.language);
    if (options.check) {
      if (section(current) !== expected) {
        throw new Error(`${page.path} is out of sync with ${options.input}`);
      }
    } else {
      await writeFile(page.path, current.replace(section(current), expected));
    }
  }
  console.log(
    options.check
      ? "Enterprise benchmark pages are in sync with the accepted formal artifact."
      : "Enterprise benchmark pages were generated from the accepted formal artifact.",
  );
}

export { assertFormalArtifact, renderResults };

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exitCode = 1;
  });
}
