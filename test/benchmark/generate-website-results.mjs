/**
 * Publishes the citable Adapter Matrix result into the user-facing docs site.
 *
 * The summary and full-sample blocks are both derived from one complete,
 * clean-source formal artifact and live in the same benchmark page. This keeps
 * the conclusion, methodology, and evidence on one user-facing reading path.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(__dirname, "../..");
const SUMMARY_START = "<!-- benchmark-results:start -->";
const SUMMARY_END = "<!-- benchmark-results:end -->";
const DETAILS_START = "<!-- benchmark-details:start -->";
const DETAILS_END = "<!-- benchmark-details:end -->";

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
    ? `All 20 adapter/scenario measurements completed with zero errors, timeouts, and non-2xx responses. Per-scenario CV ranged from ${roundCvRange(artifact)}. The full per-round sample, P50/P99, exact versions, provenance, and route-lifecycle telemetry appear below on this page.`
    : `全部 20 个 Adapter/场景测量均为零错误、零超时、零非 2xx 响应。每个场景的 CV 在 ${roundCvRange(artifact)} 之间。完整的逐轮样本、P50/P99、精确版本、provenance 和路由生命周期 telemetry 均在本页下方。`;
  return `${heading}\n\n${description}\n\n${header}\n${resultRows(artifact, language)}\n\n${conclusion}`;
}

function renderDetails(artifact, language) {
  const isEnglish = language === "en";
  const versions = artifact.provenance.versions;
  const rows = artifact.results;
  const labels = isEnglish
    ? {
        title: "## Full formal sample",
        lead: "This complete formal sample is generated from the same artifact as the current-result summary above. It remains on this page so the conclusion, method, and every measurement can be reviewed together.",
        identity: "### Run identity",
        scenarios: "### Scenarios",
        samples: "### Every measured sample",
        telemetry: "### Normal route-lifecycle telemetry",
        environment: "### Exact environment and versions",
      }
    : {
        title: "## 完整正式样本",
        lead: "此完整正式样本与上方当前结果摘要由同一 artifact 生成，并保留在本页中，使结论、方法和每一条测量数据可以一起审阅。",
        identity: "### 运行身份",
        scenarios: "### 场景",
        samples: "### 每一个测量样本",
        telemetry: "### Normal 路由生命周期 telemetry",
        environment: "### 精确环境与版本",
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

${labels.scenarios}

| ${isEnglish ? "Path" : "路径"} | ${isEnglish ? "Scenario" : "场景"} | ${isEnglish ? "What it exercises" : "覆盖内容"} |
| --- | --- | --- |
${scenarioRows}

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

function replaceDetailsBlock(source, rendered) {
  const start = source.indexOf(DETAILS_START);
  const end = source.indexOf(DETAILS_END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(
      "Benchmark details markers are missing; add benchmark-details markers before generating docs",
    );
  }
  const afterStart = start + DETAILS_START.length;
  return `${source.slice(0, afterStart)}\n\n${rendered}\n\n${source.slice(end)}`;
}

async function desiredOutputs(artifact, options) {
  const [enSource, zhSource] = await Promise.all([
    readFile(options.enSummary, "utf8"),
    readFile(options.zhSummary, "utf8"),
  ]);
  const outputs = [
    [
      options.enSummary,
      replaceDetailsBlock(
        replaceSummaryBlock(enSource, renderSummary(artifact, "en")),
        renderDetails(artifact, "en"),
      ),
    ],
    [
      options.zhSummary,
      replaceDetailsBlock(
        replaceSummaryBlock(zhSource, renderSummary(artifact, "zh")),
        renderDetails(artifact, "zh"),
      ),
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
