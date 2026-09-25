import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveDocsRollout,
  resolveDocsVerification,
  validateRequiredInventory,
} from "./docs-rollout.mjs";
import {
  loadDocumentationParser,
  documentationRouteForSource,
  documentationHtmlPath,
  documentationRelations,
  documentationRevision,
  documentationSnapshotInputs,
  parseDocumentationFrontmatter,
  documentationMetadata,
  documentationText,
} from "./documentation-contract.mjs";
import { parseSpecificationRules } from "./specification-rules.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const websiteRoot = path.resolve(scriptDir, "..");
const repositoryRoot = path.resolve(websiteRoot, "..");
const docsRoot = path.join(websiteRoot, "docs");
const distRoot = path.join(websiteRoot, "dist");
const rollout = resolveDocsRollout();
const verification = resolveDocsVerification();
const DEFAULT_DOCS_SITE_URL = "https://devcodex-labs.github.io/vextjs";
const docsSiteUrl = (
  process.env.VEXT_DOCS_SITE_URL || DEFAULT_DOCS_SITE_URL
).replace(/\/+$/, "");
const packageMetadata = JSON.parse(
  readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
);
const docsVersions = JSON.parse(
  readFileSync(path.join(websiteRoot, "version-channels.json"), "utf8"),
);

if (!new Set(["stable", "next"]).has(docsVersions.channel)) {
  throw new Error(
    `Unsupported documentation channel: ${String(docsVersions.channel)}`,
  );
}

const curatedLlmsSections = [
  {
    titles: { en: "Start here", zh: "从这里开始" },
    routes: [
      "/guide/introduction",
      "/guide/quick-start",
      "/guide/project-structure",
    ],
  },
  {
    titles: { en: "Frontend runtime", zh: "前端运行时" },
    routes: [
      "/frontend/overview",
      "/frontend/rendering-modes",
      "/frontend/boundaries-and-roadmap",
      "/frontend/data-flow",
      "/frontend/performance-budgets",
    ],
  },
  {
    titles: { en: "Runtime and operations", zh: "运行时与运维" },
    routes: [
      "/guide/routing",
      "/guide/services",
      "/guide/build",
      "/guide/deployment",
      "/guide/openapi",
    ],
  },
  {
    titles: {
      en: "Support and machine-readable documentation",
      zh: "支持与机器可读文档",
    },
    routes: [
      "/resources/support-and-services",
      "/resources/documentation-data-and-ai",
    ],
  },
];

const llmsLocaleContent = {
  en: {
    title: "VextJS",
    summary:
      "High-performance Node.js full-stack runtime documentation. The current frontend model is route-owned SSR plus hydration, optional Streaming SSR, and an esbuild build pipeline; React Server Components, Server Functions, and PPR are documented non-goals for this release.",
    scope:
      "This is the concise English index. Use the complete English index for every public English page, or the documentation manifest for the authoritative bilingual inventory.",
    fullTitle: "VextJS Complete English Documentation Index",
    fullSummary:
      "Generated from every public English documentation source. Each canonical URL appears exactly once with its source-derived summary.",
    fullSectionTitle: "English documentation",
    machineAssetsTitle: "Machine-readable assets",
    optionalSectionTitle: "Other language",
    optionalLabel: "Simplified Chinese index",
    optionalDescription:
      "Use the locale-specific Chinese index when the requested answer should be grounded in Simplified Chinese documentation.",
  },
  zh: {
    title: "VextJS 简体中文文档",
    summary:
      "VextJS 的简体中文机器可读文档入口。当前前端模型是路由拥有的 SSR 与 hydration、可选 Streaming SSR，以及 esbuild 构建链；本版本明确不包含 React Server Components、Server Functions 和 PPR。",
    scope:
      "这是精简的简体中文索引。全部中文页面请使用完整中文索引；权威双语清单请使用文档 manifest。",
    fullTitle: "VextJS 完整简体中文文档索引",
    fullSummary:
      "由全部公开简体中文文档源生成；每个 canonical URL 只出现一次，并带有从源文档提取的摘要。",
    fullSectionTitle: "简体中文文档",
    machineAssetsTitle: "机器可读资产",
    optionalSectionTitle: "可选语言",
    optionalLabel: "英文索引",
    optionalDescription:
      "需要以英文文档为依据回答时，请使用英文 locale 的索引。",
  },
};

function listFiles(directory, extensions) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return listFiles(absolute, extensions);
      return extensions.some((extension) => entry.name.endsWith(extension))
        ? [absolute]
        : [];
    });
}

function normalizeRoute(route) {
  let normalized = route.replaceAll("\\", "/").replace(/\/+/g, "/");
  normalized = normalized.replace(/\.html$/, "").replace(/\/index$/, "/");
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  if (normalized !== "/" && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized || "/";
}

function routeForSource(relativePath) {
  return documentationRouteForSource(relativePath);
}

function htmlPathForRoute(route) {
  return documentationHtmlPath(distRoot, route);
}

function canonicalUrlForRoute(route) {
  if (route === "/" || route.endsWith("/")) {
    return `${docsSiteUrl}${route}`;
  }
  return `${docsSiteUrl}${normalizeRoute(route)}`;
}

function parseFrontmatter(content) {
  return parseDocumentationFrontmatter(content);
}

export function metadataForSource(relativePath, source) {
  return documentationMetadata(relativePath, source);
}

function stripMarkdown(value) {
  return documentationText(value);
}

function firstProse(content) {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  let insideCodeFence = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      insideCodeFence = !insideCodeFence;
      continue;
    }
    if (
      insideCodeFence ||
      !line ||
      line.startsWith("#") ||
      line.startsWith("<") ||
      line.startsWith("|") ||
      line.startsWith("-") ||
      line.startsWith("*")
    ) {
      continue;
    }
    const prose = stripMarkdown(line);
    if (prose) return prose;
  }
  return "VextJS documentation page.";
}

function titleForDocument(content, fallback) {
  const frontmatter = parseFrontmatter(content);
  if (frontmatter.title) return stripMarkdown(frontmatter.title);
  const heading = content.match(/^#\s+(.+)$/m);
  return heading ? stripMarkdown(heading[1]) : fallback;
}

function summaryForDocument(content, title) {
  const frontmatter = parseFrontmatter(content);
  const candidate = frontmatter.description || firstProse(content);
  const normalized = stripMarkdown(candidate) || title;
  return normalized.length > 260
    ? `${normalized.slice(0, 257)}...`
    : normalized;
}

function sectionForRoute(route) {
  const segments = normalizeRoute(route).split("/").filter(Boolean);
  if (segments[0] === "zh") segments.shift();
  return segments[0] || "home";
}

function appliesToForRoute(route) {
  const section = sectionForRoute(route);
  const mappings = {
    api: ["public-api"],
    benchmark: ["performance"],
    examples: ["examples"],
    frontend: ["frontend"],
    guide: ["runtime"],
    resources: ["documentation"],
    specification: ["framework-contract"],
  };
  return mappings[section] || ["framework"];
}

function readDocumentationEntries() {
  const entries = [];
  for (const locale of ["en", "zh"]) {
    const localeRoot = path.join(docsRoot, locale);
    for (const file of listFiles(localeRoot, [".md", ".mdx"])) {
      const relativePath = path.relative(docsRoot, file).replaceAll("\\", "/");
      const route = routeForSource(relativePath);
      const source = readFileSync(file, "utf8");
      const metadata = metadataForSource(relativePath, source);
      const title = titleForDocument(
        source,
        relativePath.replace(/\.(?:md|mdx)$/, ""),
      );
      entries.push({
        ...metadata,
        locale,
        route,
        canonicalUrl: canonicalUrlForRoute(route),
        title,
        summary: summaryForDocument(source, title),
        audience:
          route.includes("support-and-services") || route === "/"
            ? ["developers", "engineering-leads"]
            : ["developers"],
        appliesTo: appliesToForRoute(route),
        stability: docsVersions.channel,
        sourcePath: `website/docs/${relativePath}`,
        contentHash: createHash("sha256").update(source).digest("hex"),
        source,
      });
    }
  }
  return entries.sort((left, right) => left.route.localeCompare(right.route));
}

function validateDocumentationEntries(entries) {
  const keys = new Map();
  for (const entry of entries) {
    const key = `${entry.locale}:${entry.docId}`;
    if (keys.has(key)) {
      throw new Error(
        `Duplicate docId ${entry.docId} for locale ${entry.locale}: ${keys.get(key)} and ${entry.sourcePath}`,
      );
    }
    keys.set(key, entry.sourcePath);
  }
}

export function ruleRecordsForEntry(entry) {
  if (entry.role !== "specification") return [];
  return parseSpecificationRules(entry.source, entry.sourcePath).map(
    (rule) => ({
      ...rule,
      docId: entry.docId,
      locale: entry.locale,
      title: stripMarkdown(rule.title),
      canonicalUrl: entry.canonicalUrl,
      ruleUrl: `${entry.canonicalUrl}#${rule.anchor}`,
    }),
  );
}

function validateRuleRecords(rules) {
  const keys = new Map();
  for (const rule of rules) {
    const key = `${rule.id}:${rule.locale}`;
    if (keys.has(key)) {
      throw new Error(
        `Duplicate Rule ID ${rule.id} for locale ${rule.locale}: ${keys.get(key)} and ${rule.canonicalUrl}`,
      );
    }
    keys.set(key, rule.canonicalUrl);
  }
}

function escapeHtmlAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function writeIfChanged(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  if (existsSync(file) && readFileSync(file, "utf8") === content) return;
  writeFileSync(file, content, "utf8");
}

function injectCanonicalMetadata(entries) {
  for (const entry of entries) {
    const htmlFile = htmlPathForRoute(entry.route);
    if (!existsSync(htmlFile)) {
      throw new Error(
        `No rendered HTML exists for ${entry.sourcePath}: ${path.relative(websiteRoot, htmlFile)}`,
      );
    }
    const canonicalTag = `<link rel="canonical" href="${escapeHtmlAttribute(entry.canonicalUrl)}">`;
    const ogUrlTag = `<meta property="og:url" content="${escapeHtmlAttribute(entry.canonicalUrl)}">`;
    const original = readFileSync(htmlFile, "utf8");
    const withoutExistingMetadata = original
      .replace(
        /<link\b(?=[^>]*\brel=(?:"canonical"|'canonical'))[^>]*>\s*/gi,
        "",
      )
      .replace(
        /<meta\b(?=[^>]*\bproperty=(?:"og:url"|'og:url'))[^>]*>\s*/gi,
        "",
      );
    if (!withoutExistingMetadata.includes("</head>")) {
      throw new Error(
        `Rendered HTML has no closing head tag: ${path.relative(websiteRoot, htmlFile)}`,
      );
    }
    writeIfChanged(
      htmlFile,
      withoutExistingMetadata.replace(
        "</head>",
        `${canonicalTag}${ogUrlTag}</head>`,
      ),
    );
  }
}

function requirePublicArtifact(name) {
  const artifact = path.join(distRoot, name);
  if (!existsSync(artifact)) {
    throw new Error(
      `Rspress did not copy required public artifact: ${path.relative(websiteRoot, artifact)}`,
    );
  }
}

function routeForLlmsLocale(route, locale) {
  const normalized = normalizeRoute(route);
  if (locale === "en") return normalized;
  if (normalized === "/") return "/zh/";
  return normalizeRoute(`/zh${normalized}`);
}

function llmsArtifactUrl(locale, name) {
  const localePrefix = locale === "zh" ? "/zh" : "";
  return `${docsSiteUrl}${localePrefix}/${name}`;
}

function assertLlmsLocalePurity(locale, name, content) {
  if (content.includes("\uFFFD")) {
    throw new Error(`${name} contains invalid UTF-8 replacement characters.`);
  }
  const containsHan = /[\u3400-\u9fff]/u.test(content);
  if (locale === "en" && containsHan) {
    throw new Error(`${name} must not contain Simplified Chinese content.`);
  }
  if (locale === "zh" && !containsHan) {
    throw new Error(`${name} must contain Simplified Chinese content.`);
  }
}

function buildLlmsForLocale(locale, entriesByRoute, entries) {
  const content = llmsLocaleContent[locale];
  const localeEntries = entries.filter((entry) => entry.locale === locale);
  const lines = [
    `# ${content.title}`,
    "",
    `> ${content.summary}`,
    "",
    content.scope,
    "",
  ];
  for (const section of curatedLlmsSections) {
    lines.push(`## ${section.titles[locale]}`, "");
    for (const route of section.routes) {
      const localizedRoute = routeForLlmsLocale(route, locale);
      const entry = entriesByRoute.get(localizedRoute);
      if (!entry) {
        throw new Error(
          `${locale}/llms.txt route is missing from the manifest: ${localizedRoute}`,
        );
      }
      lines.push(`- [${entry.title}](${entry.canonicalUrl}): ${entry.summary}`);
    }
    lines.push("");
  }
  lines.push(`## ${content.machineAssetsTitle}`, "");
  if (locale === "en") {
    lines.push(
      `- [Documentation manifest](${docsSiteUrl}/docs-manifest.json): authoritative bilingual page metadata, locales, public applicability, relationships, and source hashes.`,
      `- [Capability boundary](${docsSiteUrl}/capabilities.json): supported frontend/runtime capabilities and explicit exclusions.`,
      `- [AI reference questions](${docsSiteUrl}/ai-gold-questions.json): citation-required evaluation prompts.`,
      `- [Event contract](${docsSiteUrl}/docs-events.schema.json): optional privacy-preserving documentation event schema; no collector is enabled by default.`,
      `- [Measurement definition](${docsSiteUrl}/docs-dashboard-definition.json): metric definitions and collection boundary.`,
      `- [Complete English documentation index](${llmsArtifactUrl(locale, "llms-full.txt")}): every public English page URL and summary, generated from the manifest.`,
    );
  } else {
    lines.push(
      `- [文档 manifest](${docsSiteUrl}/docs-manifest.json): 权威双语页面元数据，包含 locale、适用面、关联页面和 source hash。`,
      `- [能力边界](${docsSiteUrl}/capabilities.json): 已支持的 frontend/runtime 能力与明确排除项。`,
      `- [AI 参考问题](${docsSiteUrl}/ai-gold-questions.json): 要求引用来源的评测问题。`,
      `- [事件合同](${docsSiteUrl}/docs-events.schema.json): 可选的隐私保护文档事件 schema；默认不启用 collector。`,
      `- [度量定义](${docsSiteUrl}/docs-dashboard-definition.json): 指标定义与采集边界。`,
      `- [完整简体中文文档索引](${llmsArtifactUrl(locale, "llms-full.txt")}): 由 manifest 生成的全部公开中文页面 URL 与摘要。`,
    );
  }
  lines.push(
    "",
    `## ${content.optionalSectionTitle}`,
    "",
    `- [${content.optionalLabel}](${llmsArtifactUrl(locale === "en" ? "zh" : "en", "llms.txt")}): ${content.optionalDescription}`,
    "",
  );

  const fullLines = [
    `# ${content.fullTitle}`,
    "",
    `> ${content.fullSummary}`,
    "",
    `## ${content.fullSectionTitle}`,
    "",
  ];
  for (const entry of localeEntries) {
    fullLines.push(
      `- [${entry.title}](${entry.canonicalUrl}): ${entry.summary}`,
    );
  }
  fullLines.push("");

  const llms = `${lines.join("\n").trimEnd()}\n`;
  const llmsFull = `${fullLines.join("\n").trimEnd()}\n`;
  assertLlmsLocalePurity(locale, llmsArtifactUrl(locale, "llms.txt"), llms);
  assertLlmsLocalePurity(
    locale,
    llmsArtifactUrl(locale, "llms-full.txt"),
    llmsFull,
  );
  return { llms, llmsFull };
}

async function main() {
  await loadDocumentationParser();
  if (!existsSync(distRoot)) {
    throw new Error(
      "website/dist does not exist; run rspress build before generating machine artifacts.",
    );
  }

  const entries = readDocumentationEntries();
  if (entries.length < 140) {
    throw new Error(
      `Documentation inventory unexpectedly small: ${entries.length}`,
    );
  }
  validateDocumentationEntries(entries);
  const entriesByRoute = new Map(
    entries.map((entry) => [normalizeRoute(entry.route), entry]),
  );
  const relations = documentationRelations(entries);
  const manifestEntries = entries.map(({ source, ...entry }) => ({
    ...entry,
    relatedDocuments: relations.get(entry.sourcePath),
  }));
  const rules = entries
    .flatMap((entry) => ruleRecordsForEntry(entry))
    .sort((left, right) =>
      `${left.id}:${left.locale}`.localeCompare(`${right.id}:${right.locale}`),
    );
  validateRuleRecords(rules);
  const requiredFailures = validateRequiredInventory(
    rollout,
    entries.map((entry) => ({
      ...entry,
      neutralPath: entry.sourcePath.replace(/^website\/docs\/(?:en|zh)\//, ""),
    })),
    rules,
    undefined,
    verification,
  );
  if (requiredFailures.length) throw new Error(requiredFailures.join("\n"));
  const revision = documentationRevision(
    entries,
    documentationSnapshotInputs(
      repositoryRoot,
      docsSiteUrl,
      rollout,
      verification,
    ),
  );

  injectCanonicalMetadata(entries);
  for (const artifact of [
    "capabilities.json",
    "ai-gold-questions.json",
    "docs-events.schema.json",
    "docs-dashboard-definition.json",
  ]) {
    requirePublicArtifact(artifact);
  }

  const manifest = {
    schemaVersion: "vext.docs-manifest/v2",
    rollout,
    verification,
    documentationRevision: revision,
    frameworkVersion: packageMetadata.version,
    channel: docsVersions.channel,
    stableVersion: docsVersions.stable,
    nextVersion: docsVersions.next,
    defaultLocale: "en",
    siteUrl: `${docsSiteUrl}/`,
    entries: manifestEntries,
  };
  writeIfChanged(
    path.join(distRoot, "docs-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  writeIfChanged(
    path.join(distRoot, "spec-rules.json"),
    `${JSON.stringify(
      {
        schemaVersion: "vext.spec-rules/v1",
        rollout,
        verification,
        documentationRevision: revision,
        frameworkVersion: packageMetadata.version,
        rules,
      },
      null,
      2,
    )}\n`,
  );
  for (const locale of ["en", "zh"]) {
    const { llms, llmsFull } = buildLlmsForLocale(
      locale,
      entriesByRoute,
      manifestEntries,
    );
    const localeRoot = locale === "zh" ? path.join(distRoot, "zh") : distRoot;
    writeIfChanged(path.join(localeRoot, "llms.txt"), llms);
    writeIfChanged(path.join(localeRoot, "llms-full.txt"), llmsFull);
  }

  console.log(
    `Generated canonical metadata, docs-manifest.json, spec-rules.json, and locale-specific llms indexes for ${manifestEntries.length} documentation pages.`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  await main();
