/**
 * Publishes the citable Adapter Matrix result into the user-facing docs site.
 *
 * The detailed pages and the landing-page result blocks are both derived from
 * one complete, clean-source formal artifact. This keeps a reader in the docs
 * site instead of making GitHub the only place to inspect the sample evidence.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(__dirname, "../..");
const SUMMARY_START = "<!-- benchmark-results:start -->";
const SUMMARY_END = "<!-- benchmark-results:end -->";

const SCENARIOS = [
  {
    name: "json",
    path: "/json",
    routeKey: "GET /json",
    en: "JSON response",
    zh: "JSON 响应",
    enDescription: "Route matching and JSON serialization.",
    zhDescription: "路由匹配与 JSON 序列化。",
  },
  {
    name: "params",
    path: "/users/42",
    routeKey: "GET /users/:id",
    en: "Route parameters",
    zh: "参数路由",
    enDescription: "Dynamic route matching and parameter extraction.",
    zhDescription: "动态路由匹配与参数提取。",
  },
  {
    name: "chain",
    path: "/chain",
    routeKey: "GET /chain",
    en: "Handler business chain",
    zh: "处理器业务链",
    enDescription:
      "Three layers of handler business logic and a JSON response.",
    zhDescription: "三层 handler 业务逻辑与 JSON 响应。",
  },
  {
    name: "middleware-chain",
    path: "/middleware-chain",
    routeKey: "GET /middleware-chain",
    en: "Route middleware chain",
    zh: "route middleware 链",
    enDescription: "Three route-level middleware layers and a JSON response.",
    zhDescription: "三层 route-level middleware 与 JSON 响应。",
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
    input: join(
      REPOSITORY_ROOT,
      "test/benchmark/.artifacts/adapter-matrix-formal-release.json",
    ),
    enOutput: join(REPOSITORY_ROOT, "website/docs/en/benchmark/results.md"),
    zhOutput: join(REPOSITORY_ROOT, "website/docs/zh/benchmark/results.md"),
    enSummary: join(REPOSITORY_ROOT, "website/docs/en/benchmark.md"),
    zhSummary: join(REPOSITORY_ROOT, "website/docs/zh/benchmark.md"),
    check: false,
  };
  const args = process.argv.slice(2);
  const next = (index) => args[index + 1];

  for (let index = 0; index < args.length; index += 1) {
    switch (args[index]) {
      case "--input":
        options.input = next(index);
        index += 1;
        break;
      case "--en-output":
        options.enOutput = next(index);
        index += 1;
        break;
      case "--zh-output":
        options.zhOutput = next(index);
        index += 1;
        break;
      case "--en-summary":
        options.enSummary = next(index);
        index += 1;
        break;
      case "--zh-summary":
        options.zhSummary = next(index);
        index += 1;
        break;
      case "--check":
        options.check = true;
        break;
      default:
        throw new Error(`Unknown option: ${args[index]}`);
    }
  }

  for (const [key, value] of Object.entries(options)) {
    if (key !== "check" && (!value || typeof value !== "string")) {
      throw new Error(`Missing --${key}`);
    }
  }
  return options;
}

function isPositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function routeKeyForScenario(scenario) {
  return scenario.routeKey;
}

function assertFormalArtifact(artifact) {
  if (
    artifact?.schemaVersion !== 1 ||
    artifact?.suite !== "vext-adapter-matrix" ||
    artifact?.complete !== true
  ) {
    throw new Error("Input is not a complete Vext Adapter Matrix artifact");
  }
  if (
    artifact.options?.formal !== true ||
    artifact.options?.scenario !== "all"
  ) {
    throw new Error(
      "Website benchmark results require a complete --formal Adapter Matrix run",
    );
  }
  if (
    artifact.provenance?.worktree !== "clean" ||
    artifact.provenance?.candidate !== null
  ) {
    throw new Error(
      "Website benchmark results require a clean-source formal artifact",
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(artifact.recordedAt ?? "")) {
    throw new Error(
      "Formal benchmark artifact is missing recordedAt UTC provenance",
    );
  }
  if (
    !Array.isArray(artifact.results) ||
    artifact.results.length !== SCENARIOS.length
  ) {
    throw new Error(
      "Formal benchmark artifact does not contain every scenario",
    );
  }

  const resultByScenario = new Map(
    artifact.results.map((result) => [result?.scenario, result]),
  );
  for (const scenario of SCENARIOS) {
    const result = resultByScenario.get(scenario.name);
    if (!result || result.path !== scenario.path) {
      throw new Error(`Formal benchmark artifact is missing ${scenario.name}`);
    }
    for (const target of TARGETS) {
      const metrics = result.targets?.[target.id];
      const telemetry = result.telemetry?.[target.id];
      if (
        !isPositiveNumber(metrics?.rps) ||
        !Array.isArray(metrics?.stats?.samples) ||
        metrics.stats.samples.length !== artifact.options.rounds ||
        !metrics.stats.samples.every(isPositiveNumber) ||
        !Number.isFinite(metrics.stats.cv) ||
        metrics.stats.cv > artifact.options.maxCv ||
        metrics.errors !== 0 ||
        metrics.timeouts !== 0 ||
        metrics.non2xx !== 0 ||
        !Number.isInteger(telemetry?.globalMiddlewareCount) ||
        !Number.isInteger(
          telemetry?.routeChainLengths?.[routeKeyForScenario(scenario)],
        )
      ) {
        throw new Error(
          `Formal benchmark artifact has invalid ${scenario.name}/${target.id} evidence`,
        );
      }
    }
  }
  return resultByScenario;
}

function formatNumber(value) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function roundCvRange(artifact) {
  const values = artifact.results.flatMap((result) =>
    TARGETS.map((target) => result.targets[target.id].stats.cv),
  );
  return `${Math.min(...values).toFixed(1)}%–${Math.max(...values).toFixed(1)}%`;
}

function resultRows(artifact, language) {
  return SCENARIOS.map((scenario) => {
    const result = artifact.results.find(
      (row) => row.scenario === scenario.name,
    );
    return `| ${scenario[language]} | ${TARGETS.map((target) => formatNumber(result.targets[target.id].rps)).join(" | ")} |`;
  }).join("\n");
}

function renderSummary(artifact, language) {
  const isEnglish = language === "en";
  const versions = artifact.provenance.versions;
  const heading = isEnglish ? "## Current results" : "## 当前结果";
  const description = isEnglish
    ? `This formal run was recorded at **${artifact.recordedAt}** from clean Vext source \`${artifact.provenance.branch}@${artifact.provenance.commit}\` (Vext ${versions.vextjs}; Node.js ${artifact.environment.node}). Every value is the median requests per second from **${artifact.options.rounds}** rounds; higher is better for that scenario.`
    : `本次正式运行记录于 **${artifact.recordedAt}**，使用干净的 Vext 源码 \`${artifact.provenance.branch}@${artifact.provenance.commit}\`（Vext ${versions.vextjs}；Node.js ${artifact.environment.node}）。所有数字均为 **${artifact.options.rounds}** 轮 req/s 的中位数，数值越高表示该测试场景中的吞吐越高。`;
  const header = isEnglish
    ? "| Scenario | Native | Hono | Fastify | Express | Koa |\n| --- | ---: | ---: | ---: | ---: | ---: |"
    : "| 场景 | Native | Hono | Fastify | Express | Koa |\n| --- | ---: | ---: | ---: | ---: | ---: |";
  const conclusion = isEnglish
    ? `All 20 adapter/scenario measurements completed with zero errors, timeouts, and non-2xx responses. Per-scenario CV ranged from ${roundCvRange(artifact)}. [Read the full in-document results and every sample](/benchmark/results.html), including P50/P99, exact versions, provenance, and route-lifecycle telemetry.`
    : `全部 20 个 Adapter/场景测量均为零错误、零超时、零非 2xx 响应。每个场景的 CV 在 ${roundCvRange(artifact)} 之间。[查看站内完整结果与全部样本](/zh/benchmark/results.html)，其中包含 P50/P99、精确版本、provenance 和路由生命周期 telemetry。`;
  return `${heading}\n\n${description}\n\n${header}\n${resultRows(artifact, language)}\n\n${conclusion}`;
}

function renderDetails(artifact, language) {
  const isEnglish = language === "en";
  const versions = artifact.provenance.versions;
  const rows = artifact.results;
  const labels = isEnglish
    ? {
        title: "# Full benchmark results",
        lead: "This page contains the complete formal Adapter Matrix sample. It is generated from the same artifact as the summary on the benchmark landing page, so no GitHub redirect is required to inspect the evidence.",
        identity: "## Run identity",
        comparison: "## What was compared",
        scenarios: "## Scenarios",
        medians: "## Median throughput",
        samples: "## Every measured sample",
        telemetry: "## Normal route-lifecycle telemetry",
        environment: "## Exact environment and versions",
        reproduce: "## Reproduce this run",
        limits: "## Interpretation limits",
      }
    : {
        title: "# 完整基准结果",
        lead: "此页包含完整的正式 Adapter Matrix 样本。它与基准首页摘要由同一 artifact 生成，因此查看证据不需要跳转到 GitHub。",
        identity: "## 运行身份",
        comparison: "## 对比对象",
        scenarios: "## 场景",
        medians: "## 吞吐中位数",
        samples: "## 每一个测量样本",
        telemetry: "## Normal 路由生命周期 telemetry",
        environment: "## 精确环境与版本",
        reproduce: "## 复现本次运行",
        limits: "## 解读限制",
      };
  const scenarioRows = SCENARIOS.map(
    (scenario) =>
      `| \`${scenario.path}\` | ${scenario[language]} | ${scenario[`${language}Description`]} |`,
  ).join("\n");
  const sampleRows = rows
    .flatMap((result) =>
      TARGETS.map((target) => {
        const metrics = result.targets[target.id];
        return `| ${SCENARIOS.find((scenario) => scenario.name === result.scenario)[language]} | ${target.title} | ${metrics.stats.samples.map(formatNumber).join(", ")} | ${formatNumber(metrics.rps)} | ${metrics.latencyP50} ms | ${metrics.latencyP99} ms | ${metrics.errors} / ${metrics.timeouts} / ${metrics.non2xx} | ${metrics.stats.cv.toFixed(1)}% |`;
      }),
    )
    .join("\n");
  const telemetryRows = rows
    .flatMap((result) =>
      TARGETS.map((target) => {
        const telemetry = result.telemetry[target.id];
        const scenario = SCENARIOS.find(
          (candidate) => candidate.name === result.scenario,
        );
        return `| ${scenario[language]} | ${target.title} | ${telemetry.globalMiddlewareCount} | ${telemetry.routeChainLengths[routeKeyForScenario(scenario)]} | ${isEnglish ? "asserted" : "已断言"} |`;
      }),
    )
    .join("\n");
  const comparison = isEnglish
    ? "Every target runs the same Vext Normal application: identical routes, `defineRoutes()` loading, route matching, request/response objects, middleware fixture, handler mode, HTTP contract, process priority, and Autocannon protocol. Only the HTTP adapter changes. Raw-framework and shortest-path measurements are maintainer diagnostics and are not used here."
    : "每个目标均运行同一个 Vext Normal 应用：routes、`defineRoutes()` 加载、路由匹配、请求/响应对象、中间件 fixture、handler 模式、HTTP 契约、进程优先级和 Autocannon 协议完全一致；唯一变量是 HTTP Adapter。裸框架与最短路径测量只用于维护者诊断，不用于此处。";
  const limits = isEnglish
    ? "This is a light Normal GET workload, not an all-features production or database/I/O benchmark. It comes from one Windows host. Do not combine absolute values across machines, dates, dependency versions, handler modes, or load protocols; validate your own production-shaped workload before choosing an adapter."
    : "这是轻量的 Normal GET 负载，不是全能力生产负载或数据库/I/O 基准；数据来自一台 Windows 主机。不要将不同机器、日期、依赖版本、handler 模式或压测协议下的绝对数字合并排名；选择 Adapter 前仍应验证与自身生产场景相近的负载。";
  const reproduce = isEnglish
    ? "A citable run must start from a clean source worktree. The `--formal` switch refuses dirty source; publishing this page additionally requires the complete matrix. The runner checks exact local dependency versions against npm `latest`, validates every HTTP contract, and rejects errors, timeouts, non-2xx responses, missing results, or CV above the declared limit."
    : "可引用运行必须从干净源码工作树开始。`--formal` 会拒绝脏源码；发布此页还要求完整矩阵。runner 会将精确本地依赖版本与 npm `latest` 核对、验证每个 HTTP 契约，并拒绝错误、超时、非 2xx、缺失结果或超过声明阈值的 CV。";
  const command = `node --expose-gc --max-old-space-size=512 test/benchmark/run-adapter-matrix.mjs --formal --scenario all --duration ${artifact.options.duration} --connections ${artifact.options.connections} --pipelining ${artifact.options.pipelining} --warmup ${artifact.options.warmup} --rounds ${artifact.options.rounds} --max-cv ${artifact.options.maxCv} --process-priority ${artifact.options.processPriority} --handler-mode ${artifact.options.handlerMode} --results-json test/benchmark/.artifacts/adapter-matrix-formal-release.json`;

  return `<!-- Generated by npm run generate:benchmark-docs; do not edit manually. -->
${labels.title}

${labels.lead}

${labels.identity}

| ${isEnglish ? "Field" : "字段"} | ${isEnglish ? "Value" : "值"} |
| --- | --- |
| ${isEnglish ? "Recorded at (UTC)" : "记录时间（UTC）"} | ${artifact.recordedAt} |
| ${isEnglish ? "Source revision" : "源码版本"} | \`${artifact.provenance.branch}@${artifact.provenance.commit}\` |
| ${isEnglish ? "Source state" : "源码状态"} | ${isEnglish ? "clean (required for formal publication)" : "clean（正式公开的必需条件）"} |
| Vext | ${versions.vextjs} |
| Node.js | ${artifact.environment.node} |
| ${isEnglish ? "Protocol" : "协议"} | ${artifact.options.duration}s × ${artifact.options.rounds} rounds; ${artifact.options.connections} connections; pipelining ${artifact.options.pipelining}; ${artifact.options.warmup}s warmup; ${artifact.options.handlerMode} handler; CV ≤ ${artifact.options.maxCv}% |

${labels.comparison}

${comparison}

${labels.scenarios}

| ${isEnglish ? "Path" : "路径"} | ${isEnglish ? "Scenario" : "场景"} | ${isEnglish ? "What it exercises" : "覆盖内容"} |
| --- | --- | --- |
${scenarioRows}

${labels.medians}

| ${isEnglish ? "Scenario" : "场景"} | Native | Hono | Fastify | Express | Koa |
| --- | ---: | ---: | ---: | ---: | ---: |
${resultRows(artifact, language)}

${labels.samples}

| ${isEnglish ? "Scenario" : "场景"} | Adapter | ${isEnglish ? "RPS samples (every round)" : "RPS 样本（所有轮次）"} | ${isEnglish ? "Median" : "中位数"} | P50 | P99 | ${isEnglish ? "Errors / timeouts / non-2xx" : "错误 / 超时 / 非 2xx"} | CV |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
${sampleRows}

${labels.telemetry}

| ${isEnglish ? "Scenario" : "场景"} | Adapter | ${isEnglish ? "Global middleware" : "全局 middleware"} | ${isEnglish ? "Route registration chain" : "路由注册链"} | ${isEnglish ? "Status" : "状态"} |
| --- | --- | ---: | ---: | --- |
${telemetryRows}

${labels.environment}

| ${isEnglish ? "Item" : "项目"} | ${isEnglish ? "Exact value" : "精确值"} |
| --- | --- |
| ${isEnglish ? "Platform" : "平台"} | ${artifact.environment.platform} ${artifact.environment.arch} |
| CPU | ${artifact.environment.cpuModel} |
| ${isEnglish ? "Memory" : "内存"} | ${Math.round(artifact.environment.totalMemoryBytes / 1024 / 1024 / 1024)} GiB |
| ${isEnglish ? "Process priority" : "进程优先级"} | ${artifact.environment.processPriority} |
| ${isEnglish ? "Vext" : "Vext"} | ${versions.vextjs} |
| Hono | ${versions.hono} |
| @hono/node-server | ${versions.honoNodeServer} |
| Fastify | ${versions.fastify} |
| Express | ${versions.express} |
| Koa | ${versions.koa} |
| @koa/router | ${versions.koaRouter} |
| Autocannon | ${versions.autocannon} |
| ${isEnglish ? "npm latest verification" : "npm latest 核验"} | ${artifact.provenance.latestDependencies.checkedAt} (${artifact.provenance.latestDependencies.registryUrl}) |

${labels.reproduce}

${reproduce}

\`\`\`bash
npm ci
npm run verify:benchmark-deps
${command}
npm run generate:benchmark-docs
\`\`\`

${labels.limits}

${limits}
`;
}

function replaceSummaryBlock(source, rendered) {
  const start = source.indexOf(SUMMARY_START);
  const end = source.indexOf(SUMMARY_END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(
      "Benchmark summary markers are missing; add benchmark-results markers before generating docs",
    );
  }
  const afterStart = start + SUMMARY_START.length;
  return `${source.slice(0, afterStart)}\n\n${rendered}\n\n${source.slice(end)}`;
}

async function desiredOutputs(artifact, options) {
  const [enSource, zhSource] = await Promise.all([
    readFile(options.enSummary, "utf8"),
    readFile(options.zhSummary, "utf8"),
  ]);
  const outputs = [
    [options.enOutput, renderDetails(artifact, "en")],
    [options.zhOutput, renderDetails(artifact, "zh")],
    [
      options.enSummary,
      replaceSummaryBlock(enSource, renderSummary(artifact, "en")),
    ],
    [
      options.zhSummary,
      replaceSummaryBlock(zhSource, renderSummary(artifact, "zh")),
    ],
  ];
  return Promise.all(
    outputs.map(async ([path, content]) => [
      path,
      await format(content, { parser: "markdown" }),
    ]),
  );
}

async function main() {
  const options = parseArgs();
  const artifact = JSON.parse(await readFile(options.input, "utf8"));
  assertFormalArtifact(artifact);
  const outputs = await desiredOutputs(artifact, options);
  const stale = [];

  for (const [path, content] of outputs) {
    let current = null;
    try {
      current = await readFile(path, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (current === content) continue;
    if (options.check) {
      stale.push(path);
      continue;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
    console.log(`Wrote ${path}`);
  }

  if (stale.length > 0) {
    throw new Error(
      `Benchmark website documentation is stale: ${stale.join(", ")}; run npm run generate:benchmark-docs`,
    );
  }
}

main().catch((error) => {
  console.error(
    `Benchmark documentation generation failed: ${error instanceof Error ? error.stack : error}`,
  );
  process.exit(1);
});
