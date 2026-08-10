import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..", "..");
const docsRoot = path.join(root, "website", "docs");
const renderedRoot = path.join(root, "website", "dist");
const renderedBasePath = "/vextjs";
const renderedOnly = process.argv.includes("--rendered");
const failures = [];

function fail(message) {
  failures.push(message);
}

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  try {
    return JSON.parse(read(relativePath));
  } catch (error) {
    fail(`${relativePath} is not valid JSON: ${error.message}`);
    return null;
  }
}

function markdownLinkUrls(content) {
  return [...content.matchAll(/\[[^\]]+\]\((https:\/\/[^)\s]+)\)/g)].map(
    (match) => match[1],
  );
}

function containsHan(content) {
  return /[\u3400-\u9fff]/u.test(content);
}

function verifyLlmsShape(name, content) {
  const lines = content.split(/\r?\n/);
  if (!/^# [^#\s].+/.test(lines[0] ?? "")) {
    fail(`${name} must start with exactly one H1 project title`);
  }
  if (!lines.some((line) => line.startsWith("> "))) {
    fail(`${name} must contain a project summary blockquote`);
  }
  if (!lines.some((line) => line.startsWith("## "))) {
    fail(`${name} must contain at least one H2 file-list section`);
  }
  if (!lines.some((line) => /^- \[[^\]]+\]\(https:\/\//.test(line))) {
    fail(`${name} must contain absolute Markdown file-list links`);
  }
  if (content.includes("\uFFFD")) {
    fail(`${name} contains an invalid UTF-8 replacement character`);
  }
}

function listFiles(directory, extension) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(absolute, extension);
    return entry.name.endsWith(extension) ? [absolute] : [];
  });
}

function splitTableRow(line) {
  let source = line.trim();
  if (source.startsWith("|")) source = source.slice(1);
  if (source.endsWith("|")) source = source.slice(0, -1);

  const cells = [""];
  let inlineCodeTicks = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") {
      cells[cells.length - 1] += character + (source[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (character === "`") {
      let tickCount = 1;
      while (source[index + tickCount] === "`") tickCount += 1;
      if (inlineCodeTicks === tickCount) inlineCodeTicks = 0;
      else if (inlineCodeTicks === 0) inlineCodeTicks = tickCount;
      cells[cells.length - 1] += source.slice(index, index + tickCount);
      index += tickCount - 1;
      continue;
    }
    if (character === "|" && inlineCodeTicks === 0) {
      cells.push("");
    } else {
      cells[cells.length - 1] += character;
    }
  }

  return cells.map((cell) => cell.trim());
}

function isSeparatorRow(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function verifyMarkdownTables() {
  const markdownFiles = listFiles(docsRoot, ".md");
  let tableCount = 0;

  for (const file of markdownFiles) {
    const relative = path.relative(root, file).replaceAll("\\", "/");
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    for (let index = 1; index < lines.length; index += 1) {
      if (!isSeparatorRow(lines[index])) continue;
      tableCount += 1;
      const expected = splitTableRow(lines[index]).length;
      const headerCells = splitTableRow(lines[index - 1]).length;
      if (headerCells !== expected) {
        fail(
          `${relative}:${index} table header has ${headerCells} cells; separator has ${expected}`,
        );
      }
      for (
        let row = index + 1;
        row < lines.length && lines[row].trim().startsWith("|");
        row += 1
      ) {
        const actual = splitTableRow(lines[row]).length;
        if (actual !== expected) {
          fail(
            `${relative}:${row + 1} table row has ${actual} cells; expected ${expected}`,
          );
        }
      }
    }
  }

  if (markdownFiles.length < 140) {
    fail(`documentation inventory unexpectedly small: ${markdownFiles.length}`);
  }
  if (tableCount < 150) {
    fail(`documentation table inventory unexpectedly small: ${tableCount}`);
  }
}

function sectionBetween(content, startMarker, endMarker) {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker, start);
  if (start === -1 || end === -1) {
    fail(`documentation navigation config is missing ${startMarker}`);
    return "";
  }
  return content.slice(start, end);
}

function verifyWebsiteNavigationContract() {
  const config = read("website/rspress.config.ts");
  const navSource = sectionBetween(
    config,
    "const navSource: NavItemSource[] = [",
    "const createNav",
  );
  const englishSidebar = sectionBetween(
    config,
    "const englishSidebar: SidebarGroup[] = [",
    "const englishFrontendSidebar",
  );
  const chineseSidebar = sectionBetween(
    config,
    "const chineseSidebar: SidebarGroup[] = [",
    "const chineseFrontendSidebar",
  );

  for (const token of [
    'en: "Tooling & Operations"',
    'zh: "工具与运维"',
    'en: "Resources"',
    'zh: "资源"',
    'en: "Examples"',
    'en: "Benchmark"',
    'en: "Contributing"',
    'en: "Support & Services"',
    'zh: "支持与服务"',
    'en: "Docs Data & AI"',
    'zh: "文档数据与 AI"',
    'activeMatch: "^/api/"',
  ]) {
    if (!navSource.includes(token)) {
      fail(`website navigation is missing contract token: ${token}`);
    }
  }

  const versionMenu = sectionBetween(navSource, 'en: "v1.0.1"', "  },\n];");
  if (versionMenu.includes('en: "Contributing"')) {
    fail("website version menu must not duplicate Contributing");
  }
  if (englishSidebar.includes('text: "Frontend Overview"')) {
    fail("general English Start sidebar must not duplicate Frontend Overview");
  }
  if (chineseSidebar.includes('text: "前端总览"')) {
    fail("general Chinese 开始 sidebar must not duplicate 前端总览");
  }
}

function documentationSourceForRoute(route) {
  const normalized = route.replace(/\/$/, "") || "/";
  const locale =
    normalized === "/zh" || normalized.startsWith("/zh/") ? "zh" : "en";
  const localePrefix = locale === "zh" ? "/zh" : "";
  const suffix = normalized.slice(localePrefix.length).replace(/^\//, "");
  const stem = suffix || "index";
  const base = `website/docs/${locale}/${stem}`;
  for (const extension of [".md", ".mdx"]) {
    if (existsSync(path.join(root, `${base}${extension}`))) {
      return `${base}${extension}`;
    }
  }
  return null;
}

function verifyDocumentationGrowthContract() {
  const supportTokens = {
    en: [
      "GitHub Discussions",
      "Apache-2.0",
      "scope",
      "credentials",
      "service-level",
    ],
    zh: ["GitHub Discussions", "Apache-2.0", "范围", "凭据", "SLA"],
  };
  const dataAndAiTokens = {
    en: [
      "docs-manifest.json",
      "capabilities.json",
      "ai-gold-questions.json",
      "https://devcodex-labs.github.io/vextjs/llms.txt",
      "https://devcodex-labs.github.io/vextjs/llms-full.txt",
      "https://devcodex-labs.github.io/vextjs/zh/llms.txt",
      "https://devcodex-labs.github.io/vextjs/zh/llms-full.txt",
      "Language and completeness contract",
      "docs-events.schema.json",
      "docs-dashboard-definition.json",
      "tracker",
      "raw search",
    ],
    zh: [
      "docs-manifest.json",
      "capabilities.json",
      "ai-gold-questions.json",
      "https://devcodex-labs.github.io/vextjs/llms.txt",
      "https://devcodex-labs.github.io/vextjs/llms-full.txt",
      "https://devcodex-labs.github.io/vextjs/zh/llms.txt",
      "https://devcodex-labs.github.io/vextjs/zh/llms-full.txt",
      "语言与完整性合同",
      "docs-events.schema.json",
      "docs-dashboard-definition.json",
      "tracker",
      "原始",
    ],
  };
  for (const locale of ["en", "zh"]) {
    requireTokens(
      `website/docs/${locale}/resources/support-and-services.md`,
      supportTokens[locale],
    );
    requireTokens(
      `website/docs/${locale}/resources/documentation-data-and-ai.md`,
      dataAndAiTokens[locale],
    );
    requireTokens(`website/docs/${locale}/frontend/rendering-modes.md`, [
      "Streaming SSR",
      "React Server Components",
      "Server Functions",
      "server/client",
      "route",
      "esbuild",
    ]);
    requireTokens(`website/docs/${locale}/frontend/boundaries-and-roadmap.md`, [
      "React Server Components",
      "Server Functions",
      "server/client",
      "payload",
      "esbuild",
      "adapter",
    ]);
  }

  requireTokens("website/package.json", ["generate-machine-artifacts.mjs"]);

  const capabilities = readJson("website/docs/public/capabilities.json");
  if (capabilities) {
    if (capabilities.schemaVersion !== "vext.capabilities/v1") {
      fail("capabilities.json must declare vext.capabilities/v1");
    }
    const excluded = capabilities.frontend?.explicitNonGoals ?? [];
    for (const id of [
      "react-server-components",
      "server-functions",
      "partial-prerendering",
      "bundler-plugin-ecosystem",
    ]) {
      if (!excluded.some((item) => item.id === id)) {
        fail(`capabilities.json is missing explicit non-goal: ${id}`);
      }
    }
  }

  const questions = readJson("website/docs/public/ai-gold-questions.json");
  if (questions) {
    if (questions.schemaVersion !== "vext.docs-gold-questions/v1") {
      fail("ai-gold-questions.json must declare vext.docs-gold-questions/v1");
    }
    if (
      !Array.isArray(questions.questions) ||
      questions.questions.length < 20
    ) {
      fail(
        "ai-gold-questions.json must contain at least 20 citation questions",
      );
    }
    for (const question of questions.questions ?? []) {
      if (
        !question.id ||
        !question.question ||
        !Array.isArray(question.requiredRoutes)
      ) {
        fail("ai-gold-questions.json contains an incomplete question");
        continue;
      }
      for (const route of question.requiredRoutes) {
        if (!documentationSourceForRoute(route)) {
          fail(
            `AI gold question ${question.id} references missing route: ${route}`,
          );
        }
      }
    }
  }

  const eventSchema = readJson("website/docs/public/docs-events.schema.json");
  if (eventSchema) {
    if (eventSchema.properties?.schemaVersion?.const !== "vext.docs-event/v1") {
      fail("docs-events.schema.json must declare vext.docs-event/v1");
    }
    if (
      eventSchema.properties?.queryLength?.description?.includes(
        "raw search text",
      ) !== true
    ) {
      fail("docs-events.schema.json must prohibit raw search text");
    }
  }

  const dashboard = readJson(
    "website/docs/public/docs-dashboard-definition.json",
  );
  if (dashboard) {
    if (dashboard.collection?.default !== "disabled") {
      fail("docs dashboard collection must be disabled by default");
    }
    if (!dashboard.collection?.neverCollect?.includes("user identity")) {
      fail("docs dashboard must prohibit user identity collection");
    }
  }
}

function cliSection(content, command) {
  const marker = `## \`vext ${command}\``;
  const start = content.indexOf(marker);
  if (start === -1) {
    fail(`missing documentation section: ${marker}`);
    return "";
  }
  const next = content.indexOf("\n## ", start + marker.length);
  return content.slice(start, next === -1 ? content.length : next);
}

function longOptionsFromHelp(command) {
  const args = [
    path.join(root, "dist", "cli", "index.js"),
    ...command.split(" "),
    "--help",
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(`CLI help failed for "${command}": ${result.stderr || result.stdout}`);
    return new Set();
  }
  const options = new Set();
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^\s+(?:-\w,\s*)?(--[a-z0-9-]+)/i);
    if (match) options.add(match[1]);
  }
  return options;
}

function longOptionsFromDocs(section) {
  const options = new Set();
  for (const line of section.split(/\r?\n/)) {
    const firstCell = line.match(/^\|\s*`([^`]+)`/);
    if (!firstCell) continue;
    for (const match of firstCell[1].matchAll(/--[a-z0-9-]+/gi)) {
      options.add(match[0]);
    }
  }
  return options;
}

function compareSets(label, actual, expected) {
  const missing = [...expected].filter((item) => !actual.has(item));
  const extra = [...actual].filter((item) => !expected.has(item));
  if (missing.length > 0) fail(`${label} missing: ${missing.join(", ")}`);
  if (extra.length > 0) fail(`${label} extra: ${extra.join(", ")}`);
}

function verifyCliDocs() {
  const commands = [
    "build",
    "deploy assets",
    "start",
    "stop",
    "reload",
    "status",
  ];
  const en = read("website/docs/en/guide/cli.md");
  const zh = read("website/docs/zh/guide/cli.md");

  for (const command of commands) {
    const implementation = longOptionsFromHelp(command);
    const documented = longOptionsFromDocs(cliSection(en, command));
    compareSets(`English CLI docs for ${command}`, documented, implementation);
  }
  for (const command of commands) {
    const implementation = longOptionsFromHelp(command);
    const documented = longOptionsFromDocs(cliSection(zh, command));
    compareSets(`Chinese CLI docs for ${command}`, documented, implementation);
  }
}

function requireTokens(relativePath, tokens) {
  const content = read(relativePath);
  for (const token of tokens) {
    if (!content.includes(token)) {
      fail(`${relativePath} is missing contract token: ${token}`);
    }
  }
}

function forbidTokens(relativePath, tokens) {
  const content = read(relativePath);
  for (const token of tokens) {
    if (content.includes(token)) {
      fail(`${relativePath} contains stale contract token: ${token}`);
    }
  }
}

function normalizeDocumentedCode(value) {
  return value.trim().replaceAll("\r\n", "\n");
}

function documentedCodeBlock(relativeDocsPath, startMarker, endMarker) {
  const content = read(relativeDocsPath);
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker, start + startMarker.length);
  if (start === -1 || end === -1 || end <= start) {
    fail(
      `${relativeDocsPath} is missing documented code markers: ${startMarker}`,
    );
    return "";
  }

  const section = content.slice(start + startMarker.length, end);
  const match = section.match(/```(?:ts|tsx)\r?\n([\s\S]*?)\r?\n```/);
  if (!match) {
    fail(`${relativeDocsPath} has no fenced code block for ${startMarker}`);
    return "";
  }

  return normalizeDocumentedCode(match[1]);
}

function verifyDocumentedFixture(
  relativeDocsPath,
  startMarker,
  endMarker,
  fixturePath,
) {
  const documented = documentedCodeBlock(
    relativeDocsPath,
    startMarker,
    endMarker,
  );
  const fixture = normalizeDocumentedCode(read(fixturePath));
  if (documented && documented !== fixture) {
    fail(`${relativeDocsPath} drifts from executable fixture ${fixturePath}`);
  }
}

function interfaceBody(relativePath, interfaceName) {
  const content = read(relativePath);
  const declaration = `export interface ${interfaceName}`;
  const declarationIndex = content.indexOf(declaration);
  if (declarationIndex === -1) {
    fail(`${relativePath} is missing public interface ${interfaceName}`);
    return "";
  }
  const openBrace = content.indexOf("{", declarationIndex + declaration.length);
  if (openBrace === -1) {
    fail(`${relativePath} has an invalid ${interfaceName} declaration`);
    return "";
  }

  let depth = 0;
  for (let index = openBrace; index < content.length; index += 1) {
    if (content[index] === "{") depth += 1;
    if (content[index] === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(openBrace + 1, index);
    }
  }
  fail(`${relativePath} has an unclosed ${interfaceName} declaration`);
  return "";
}

function publicInterfaceMembers(relativePath, interfaceName, exclusions = []) {
  const body = interfaceBody(relativePath, interfaceName)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const members = new Set();
  const excluded = new Set(exclusions);
  let braceDepth = 0;
  let parenthesisDepth = 0;

  for (const line of body.split(/\r?\n/)) {
    if (braceDepth === 0 && parenthesisDepth === 0) {
      const match = line.match(
        /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)(?:\?|!)?\s*(?=[:<(])/,
      );
      const member = match?.[1];
      if (member && !member.startsWith("_") && !excluded.has(member)) {
        members.add(member);
      }
    }
    braceDepth += (line.match(/{/g) ?? []).length;
    braceDepth -= (line.match(/}/g) ?? []).length;
    parenthesisDepth += (line.match(/\(/g) ?? []).length;
    parenthesisDepth -= (line.match(/\)/g) ?? []).length;
  }
  return members;
}

function verifyInterfaceReference(
  relativeSourcePath,
  interfaceName,
  relativeDocsPath,
  exclusions = [],
) {
  const docs = read(relativeDocsPath);
  for (const member of publicInterfaceMembers(
    relativeSourcePath,
    interfaceName,
    exclusions,
  )) {
    const escaped = member.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`\`${escaped}(?:\\(|\\?|\\\`)`).test(docs)) {
      fail(
        `${relativeDocsPath} does not cover ${interfaceName}.${member} from ${relativeSourcePath}`,
      );
    }
  }
}

function documentationSection(relativeDocsPath, startHeading, endHeading) {
  const docs = read(relativeDocsPath);
  const start = docs.indexOf(startHeading);
  const end = docs.indexOf(endHeading, start + startHeading.length);
  if (start === -1 || end === -1 || end <= start) {
    fail(
      `${relativeDocsPath} must contain a ${startHeading} section before ${endHeading}`,
    );
    return "";
  }
  return docs.slice(start, end);
}

function verifyQualifiedInterfaceReference(
  relativeSourcePath,
  interfaceName,
  relativeDocsPath,
  docsSection,
  prefix,
  exclusions = [],
) {
  for (const member of publicInterfaceMembers(
    relativeSourcePath,
    interfaceName,
    exclusions,
  )) {
    const token = `\`${prefix}${member}\``;
    if (!docsSection.includes(token)) {
      fail(
        `${relativeDocsPath} does not cover ${interfaceName}.${member} as ${token} from ${relativeSourcePath}`,
      );
    }
  }
}

function verifyFrontendConfigurationReferenceContracts() {
  const relativeSourcePath = "src/frontend/contract/types.ts";
  const interfaces = [
    ["VextFrontendConfig", ""],
    ["VextFrontendPagesConfig", "pages."],
    ["VextFrontendSpaFallbackConfig", "spaFallback."],
    ["VextFrontendSpaFallbackScope", "spaFallback.scopes[]."],
    ["VextFrontendStylesConfig", "styles."],
    ["VextFrontendJscssConfig", "styles.jscss."],
    ["VextFrontendBuildConfig", "build."],
    ["VextFrontendBuildTargetConfig", "build.client."],
    ["VextFrontendServerBuildTargetConfig", "build.server."],
    ["VextFrontendVendorChunksConfig", "build.vendorChunks."],
    ["VextFrontendBuildBudgetsConfig", "build.budgets."],
    ["VextFrontendMediaConfig", "media."],
    ["VextFrontendMediaImagesConfig", "media.images."],
    ["VextFrontendMediaFontsConfig", "media.fonts."],
    ["VextFrontendDeployConfig", "deploy."],
    ["VextFrontendDeployUploadConfig", "deploy.upload."],
    ["VextFrontendRenderConfig", "render."],
    ["VextFrontendErrorPagesConfig", "errorPages."],
    ["VextFrontendI18nConfig", "i18n."],
    ["VextFrontendDevConfig", "dev."],
    ["VextFrontendApiClientConfig", "apiClient."],
  ];
  const extensionTokens = [
    "`VextFrontendAdapter`",
    "`name`",
    "`framework`",
    "`resolveBuildOptions(config)`",
    "`VextFrontendDeployUploadAdapter`",
    "`upload(input)`",
    "`VextFrontendDeployUploadAdapterInput`",
    "`asset`",
    "`sourcePath`",
    "`uploadKey`",
    "`dryRun`",
    "`VextFrontendDeployUploadAdapterResult`",
    "`uploaded`",
    "`url`",
    "`etag`",
    "`build.client.externalRuntime.<specifier>.url`",
    "`build.client.externalRuntime.<specifier>.integrity`",
    "`build.client.externalRuntime.<specifier>.crossOrigin`",
  ];

  for (const locale of ["en", "zh"]) {
    const relativeDocsPath = `website/docs/${locale}/api/config.md`;
    const docsSection = documentationSection(
      relativeDocsPath,
      "## VextFrontendConfig",
      "## VextClusterConfig",
    );
    for (const [interfaceName, prefix] of interfaces) {
      verifyQualifiedInterfaceReference(
        relativeSourcePath,
        interfaceName,
        relativeDocsPath,
        docsSection,
        prefix,
      );
    }
    for (const token of extensionTokens) {
      if (!docsSection.includes(token)) {
        fail(
          `${relativeDocsPath} is missing frontend extension token: ${token}`,
        );
      }
    }
  }
}

function verifyPublicReferenceContracts() {
  const contextTokens = [
    "`cookies`",
    "`cookie()`",
    "`csrfToken()`",
    "`auth`",
    "`session`",
    "`render(page, props?, options?)`",
    "`renderError(error?, page?, options?)`",
    "`clearCookie(name, options?)`",
    "`headersSent`",
    "`sse()`",
    "`upgrade()`",
  ];
  const configTokens = [
    "`cache`",
    "`dev`",
    "`prettyColor`",
    "`onFatalError`",
    "`logErrors`",
    "`memoryThreshold`",
    "## VextDevConfig",
  ];
  for (const locale of ["en", "zh"]) {
    const contextDocs = `website/docs/${locale}/api/context.md`;
    const configDocs = `website/docs/${locale}/api/config.md`;
    verifyInterfaceReference(
      "src/types/request.ts",
      "VextRequest",
      contextDocs,
    );
    verifyInterfaceReference(
      "src/types/response.ts",
      "VextResponse",
      contextDocs,
      ["rawJson"],
    );
    verifyInterfaceReference("src/types/app.ts", "VextConfig", configDocs);
    verifyInterfaceReference("src/types/app.ts", "VextDevConfig", configDocs);
    verifyInterfaceReference(
      "src/types/app.ts",
      "VextDevOverlayConfig",
      configDocs,
    );
    requireTokens(contextDocs, contextTokens);
    requireTokens(configDocs, configTokens);
  }
  verifyFrontendConfigurationReferenceContracts();
}

function verifyFrontendStreamingDocumentationContract() {
  const renderingTokens = [
    'frontend.render.streaming: "buffered"',
    'frontend.render.streaming: "auto"',
    "renderToPipeableStream",
    "Suspense fallback",
    "Native",
    "Hono",
    "Fastify",
    "Express",
    "Koa",
    "React Server Components",
    "Server Functions",
    "Server Actions",
    "PPR",
    "Webpack/Vite/Rollup/Rolldown",
    "esbuild",
  ];
  for (const locale of ["en", "zh"]) {
    requireTokens(
      `website/docs/${locale}/frontend/rendering-modes.md`,
      renderingTokens,
    );
    requireTokens(`website/docs/${locale}/frontend/boundaries-and-roadmap.md`, [
      'frontend.render.streaming: "auto"',
      '"buffered"',
      "React Server Components",
      "Server Functions",
      "Server Actions",
      "PPR",
      "Webpack/Vite/Rollup/Rolldown",
      "esbuild",
    ]);
    requireTokens(`website/docs/${locale}/frontend/troubleshooting.md`, [
      'frontend.render.streaming: "auto"',
      '"buffered"',
      "React Server Components",
      "Server Functions",
      "Server Actions",
      "PPR",
    ]);
    requireTokens(`website/docs/${locale}/api/config.md`, [
      "`render.streaming`",
      "`'buffered' \\| 'auto'`",
      "`'buffered'`",
      "`render.timeoutMs`",
      "`3000`",
    ]);
    forbidTokens(`website/docs/${locale}/frontend/boundaries-and-roadmap.md`, [
      "\n- streaming SSR\n",
    ]);
    forbidTokens(`website/docs/${locale}/frontend/troubleshooting.md`, [
      "\n- streaming SSR\n",
    ]);
  }
}

function verifyFrontendNavigationDocumentationContract() {
  const apiTokens = [
    "`Link`",
    "`Form`",
    "`navigate`",
    "`prefetch`",
    "`revalidate`",
    "`useNavigation`",
    "`useFetcher`",
    "`useRouteData`",
  ];
  for (const locale of ["en", "zh"]) {
    requireTokens(`website/docs/${locale}/frontend/data-flow.md`, [
      ...apiTokens,
      'prefetch="none" | "click" | "visible"',
      "idle",
      "loading",
      "submitting",
      "revalidating",
      "error",
      "aborted",
      "application/vnd.vext.page+json;v=1",
      "routeId, path, tags, keys",
      "no-store",
    ]);
    requireTokens(`website/docs/${locale}/frontend/boundaries-and-roadmap.md`, [
      "`Link`",
      "`Form`",
      "loader/action route DSL",
      "esbuild",
    ]);
    forbidTokens(`website/docs/${locale}/frontend/boundaries-and-roadmap.md`, [
      "\n- persistent client layout navigation\n",
      "\n- 持久客户端 layout 导航\n",
    ]);
  }
}

function verifyFrontendFreshnessMediaDocumentationContract() {
  for (const locale of ["en", "zh"]) {
    requireTokens("website/docs/" + locale + "/frontend/rendering-modes.md", [
      `mode: "static"`,
      `mode: "revalidate"`,
      `staticParams`,
      `clientOnly: true`,
      `revalidate`,
      `tags`,
      `PPR`,
    ]);
    requireTokens(
      "website/docs/" + locale + "/frontend/static-assets-and-cdn.md",
      [
        `config.frontend.media`,
        `media.maxBytes`,
        `maxInputPixels`,
        `maxVariants`,
        `Image`,
        `defineFont`,
        `defineImageLoader`,
        `WOFF2`,
      ],
    );
    requireTokens("website/docs/" + locale + "/api/config.md", [
      `media.maxBytes`,
      `media.images.widths`,
      `media.images.formats`,
      `media.images.quality`,
      `media.images.maxInputPixels`,
      `media.images.maxVariants`,
      `media.fonts.maxBytes`,
    ]);
    requireTokens("website/docs/" + locale + "/api/route-definition.md", [
      `VextRouteFrontendOptions`,
      `staticParams`,
      `clientOnly`,
      `staticBudget`,
    ]);
  }

  forbidTokens("website/docs/en/frontend/boundaries-and-roadmap.md", [
    `- built-in image/font optimization components\n`,
  ]);
  forbidTokens("website/docs/zh/frontend/boundaries-and-roadmap.md", [
    `- 内置图片/字体优化组件\n`,
  ]);
}

function verifyJscssUserGuideDocumentationContract() {
  requireTokens("website/rspress.config.ts", [
    '{ text: "Vext JSCSS", link: "/frontend/jscss" },',
    '{ text: "Vext JSCSS", link: "/zh/frontend/jscss" },',
  ]);

  for (const locale of ["en", "zh"]) {
    const frontendDocs = `website/docs/${locale}/frontend`;
    const route = locale === "zh" ? "/zh/frontend/jscss" : "/frontend/jscss";

    verifyDocumentedFixture(
      `${frontendDocs}/jscss.md`,
      "<!-- jscss-user-guide:button-style:start -->",
      "<!-- jscss-user-guide:button-style:end -->",
      "test/fixtures/frontend/jscss-user-guide/button.style.ts",
    );
    verifyDocumentedFixture(
      `${frontendDocs}/jscss.md`,
      "<!-- jscss-user-guide:button-component:start -->",
      "<!-- jscss-user-guide:button-component:end -->",
      "test/fixtures/frontend/jscss-user-guide/Button.tsx",
    );

    requireTokens(`${frontendDocs}/jscss.md`, [
      "`recipe()`",
      "`className`",
      "`setVar()`",
      "document.documentElement.style.setProperty",
      "src/frontend/**",
      "Sass",
      "SCSS",
    ]);
    requireTokens(`${frontendDocs}/styles-and-assets.md`, [
      route,
      "`recipe()`",
      "`setVar()`",
    ]);
    forbidTokens(`${frontendDocs}/styles-and-assets.md`, [
      "base: style(",
      "primary: style(",
      "danger: style(",
    ]);
    requireTokens(`${frontendDocs}/getting-started.md`, [route]);
    requireTokens(`${frontendDocs}/overview.md`, [route]);
  }
}
function verifyExampleAndMetadata() {
  const examplePackage = JSON.parse(read("examples/hello-world/package.json"));
  if (examplePackage.dependencies?.vextjs !== "file:../..") {
    fail(
      'examples/hello-world/package.json must declare "vextjs": "file:../.."',
    );
  }

  requireTokens("examples/hello-world/README.md", [
    "npm install",
    "5 种内置 HTTP Adapter",
    'adapter: "native"',
    "Vext Docs Renderer",
    "../../README.md#cli",
  ]);
  requireTokens("examples/hello-world/src/config/default.js", [
    '"native"   — 默认',
    '默认使用 "native"',
    "Vext Docs Renderer",
  ]);
  forbidTokens("examples/hello-world/README.md", [
    "symlink（已配置）",
    "4 种内置 HTTP Adapter",
    "Swagger UI",
    'adapter: "hono", // 默认值',
  ]);
  forbidTokens("examples/hello-world/src/config/default.js", [
    '不配置时默认使用 "hono"',
    "Swagger UI",
  ]);

  requireTokens("CONTRIBUTING.md", [
    "Node.js** >= 20.19.0",
    "YOUR_USERNAME/vextjs.git",
    "cd vextjs",
    "Apache License 2.0",
  ]);
  forbidTokens("CONTRIBUTING.md", [
    "Node.js** >= 18.0.0",
    "YOUR_USERNAME/vext.git",
    "MIT License",
  ]);
  requireTokens("CHANGELOG.md", [
    "https://github.com/devcodex-labs/vextjs",
    "https://github.com/devcodex-labs/vextjs/issues",
  ]);

  verifyReadmePublicEntryContract();
}

function verifyReadmePublicEntryContract() {
  requireTokens("README.md", [
    "## CLI",
    "## Get started",
    "## Why VextJS",
    "## One route model",
    "## Simplified project model",
    "## Good fit",
    "## Boundaries",
    "npx vextjs create",
    "res.render",
    "Apache-2.0",
    ">=20.19.0",
    "https://devcodex-labs.github.io/vextjs/",
    "https://github.com/devcodex-labs/vextjs",
    "https://devcodex-labs.github.io/vextjs/llms.txt",
    "https://devcodex-labs.github.io/vextjs/capabilities.json",
    "For AI assistants",
    "Ship APIs and server-rendered React pages from one Node.js application",
    "full-stack Node.js application framework",
    "one route model and request lifecycle",
    "Route contracts drive validation",
    "config.database",
    "Three-tier hot reload",
    "React Fast Refresh",
    "Production lifecycle",
    "not an Edge runtime adapter",
  ]);
  forbidTokens("README.md", [
    "vextjs.github.io",
    "github.com/vextjs/vext",
    "License: MIT",
    "Node.js-%3E%3D18.0.0",
    "opensource.org/licenses/MIT",
    "on one request path",
    "Validation can drive OpenAPI",
    "Same-route navigation and page envelopes",
  ]);

  requireTokens("website/docs/en/index.mdx", [
    "full-stack Node.js application framework",
    "under one route model and request lifecycle",
    "Route contracts feed validation, docs, and client types",
    "not an",
    "Edge runtime adapter",
  ]);
  forbidTokens("website/docs/en/index.mdx", [
    "stay on one request path",
    "Validation feeds docs and typed clients",
    "edge scenarios",
  ]);
  requireTokens("website/docs/zh/index.mdx", [
    "Node.js 全栈应用框架",
    "一套路由模型与请求生命周期",
    "路由契约驱动校验、文档和客户端类型",
    "不是 Edge runtime adapter",
  ]);
  forbidTokens("website/docs/zh/index.mdx", [
    "共用一条请求链",
    "校验驱动文档和类型客户端",
    "适合边缘",
  ]);
  requireTokens("website/docs/en/guide/introduction.md", [
    "Hono + `@hono/node-server`",
    "Node.js applications",
    "config.database",
  ]);
  forbidTokens("website/docs/en/guide/introduction.md", [
    "Full Stack / Edge Runtime",
    "conditional loading with zero overhead",
  ]);
  requireTokens("website/docs/zh/guide/introduction.md", [
    "Hono + `@hono/node-server`",
    "Node.js 应用",
    "config.database",
  ]);
  forbidTokens("website/docs/zh/guide/introduction.md", [
    "全栈 / 边缘运行时",
    "条件加载零开销",
  ]);
  // Cold-start must not put bare `npx vext create` in copy-paste fences.
  // Local binary usage (`npx vext dev`) after install remains valid.
  const readme = read("README.md");
  if (/"vextjs"\s*:\s*"\^\d+\.\d+\.\d+"/.test(readme)) {
    fail(
      "README.md must not hardcode an unpublished package version; keep versioned manual installation in bilingual Quick Start docs",
    );
  }
  if (/```[\s\S]*?\bnpx vext create\b[\s\S]*?```/.test(readme)) {
    fail(
      'README.md must not put "npx vext create" inside a copy-paste code fence (use "npx vextjs create")',
    );
  }
}

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function canonicalRoute(relativeHtmlPath) {
  const normalized = relativeHtmlPath.replaceAll("\\", "/");
  if (normalized === "index.html") return "/";
  if (normalized.endsWith("/index.html")) {
    return `/${normalized.slice(0, -"/index.html".length)}`;
  }
  return `/${normalized.replace(/\.html$/, "")}`;
}

function normalizeTargetPath(value) {
  let normalized = safeDecode(value).replace(/\/+/g, "/");
  if (
    normalized === renderedBasePath ||
    normalized.startsWith(`${renderedBasePath}/`)
  ) {
    normalized = normalized.slice(renderedBasePath.length) || "/";
  }
  normalized = normalized.replace(/\.html$/, "");
  normalized = normalized.replace(/\/index$/, "");
  if (normalized.length > 1) normalized = normalized.replace(/\/$/, "");
  return normalized || "/";
}

function verifyRenderedAnchors() {
  if (!existsSync(renderedRoot)) {
    fail("website/dist does not exist; run the website build first");
    return;
  }

  const pages = new Map();
  const htmlFiles = listFiles(renderedRoot, ".html");
  for (const file of htmlFiles) {
    const route = canonicalRoute(path.relative(renderedRoot, file));
    const html = readFileSync(file, "utf8");
    const anchors = new Set();
    for (const match of html.matchAll(/\s(?:id|name)="([^"]+)"/g)) {
      anchors.add(safeDecode(decodeHtml(match[1])));
    }
    pages.set(normalizeTargetPath(route), { file, route, html, anchors });
  }

  let checked = 0;
  for (const page of pages.values()) {
    for (const match of page.html.matchAll(/\shref="([^"]+)"/g)) {
      const href = decodeHtml(match[1]);
      if (!href.includes("#")) continue;
      if (/^(?:https?:|mailto:|tel:|javascript:)/i.test(href)) continue;
      const basePath =
        page.route === "/" ? "/" : `${normalizeTargetPath(page.route)}.html`;
      let target;
      try {
        target = new URL(href, `https://docs.local${basePath}`);
      } catch {
        fail(`${path.relative(root, page.file)} has invalid href: ${href}`);
        continue;
      }
      const fragment = safeDecode(target.hash.slice(1));
      if (!fragment) continue;
      checked += 1;
      const targetPage = pages.get(normalizeTargetPath(target.pathname));
      if (!targetPage) {
        fail(
          `${path.relative(root, page.file)} links to missing page ${target.pathname}#${fragment}`,
        );
        continue;
      }
      if (!targetPage.anchors.has(fragment)) {
        fail(
          `${path.relative(root, page.file)} links to missing anchor ${target.pathname}#${fragment}`,
        );
      }
    }
  }

  if (htmlFiles.length < 140) {
    fail(
      `rendered documentation inventory unexpectedly small: ${htmlFiles.length}`,
    );
  }
  if (checked < 1000) {
    fail(`rendered hash-link inventory unexpectedly small: ${checked}`);
  }
}

function renderedHtmlForManifestRoute(route) {
  if (route === "/") return path.join(renderedRoot, "index.html");
  if (route.endsWith("/")) {
    return path.join(renderedRoot, route.slice(1), "index.html");
  }
  return path.join(renderedRoot, `${route.slice(1)}.html`);
}

function readRenderedJson(name) {
  const file = path.join(renderedRoot, name);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`website/dist/${name} is not valid JSON: ${error.message}`);
    return null;
  }
}

function verifyRenderedMachineArtifacts() {
  if (!existsSync(renderedRoot)) {
    fail("website/dist does not exist; run the website build first");
    return;
  }

  for (const name of [
    "docs-manifest.json",
    "capabilities.json",
    "ai-gold-questions.json",
    "docs-events.schema.json",
    "docs-dashboard-definition.json",
    "llms.txt",
    "llms-full.txt",
    "zh/llms.txt",
    "zh/llms-full.txt",
    "sitemap.xml",
  ]) {
    if (!existsSync(path.join(renderedRoot, name))) {
      fail(`website/dist is missing machine-readable artifact: ${name}`);
    }
  }

  const manifest = readRenderedJson("docs-manifest.json");
  if (!manifest) return;
  if (manifest.schemaVersion !== "vext.docs-manifest/v1") {
    fail("website/dist/docs-manifest.json must declare vext.docs-manifest/v1");
  }
  if (manifest.frameworkVersion !== "1.0.1") {
    fail(
      "website/dist/docs-manifest.json must declare framework version 1.0.1",
    );
  }
  if (!Array.isArray(manifest.entries)) {
    fail("website/dist/docs-manifest.json must contain entries");
    return;
  }
  if (manifest.defaultLocale !== "en") {
    fail(
      "website/dist/docs-manifest.json must declare English as defaultLocale",
    );
  }

  const sourceFiles = [
    ...listFiles(path.join(docsRoot, "en"), ".md"),
    ...listFiles(path.join(docsRoot, "en"), ".mdx"),
    ...listFiles(path.join(docsRoot, "zh"), ".md"),
    ...listFiles(path.join(docsRoot, "zh"), ".mdx"),
  ];
  if (manifest.entries.length !== sourceFiles.length) {
    fail(
      `docs manifest has ${manifest.entries.length} entries; expected ${sourceFiles.length}`,
    );
  }

  const entriesByRoute = new Map();
  for (const entry of manifest.entries) {
    const routeKey = normalizeTargetPath(entry.route ?? "");
    if (entriesByRoute.has(routeKey)) {
      fail(`docs manifest duplicates route: ${entry.route}`);
      continue;
    }
    entriesByRoute.set(routeKey, entry);
    const expectedLocale =
      routeKey === "/zh" || routeKey.startsWith("/zh/") ? "zh" : "en";
    if (entry.locale !== expectedLocale) {
      fail(`docs manifest has invalid locale for route: ${entry.route}`);
    }
    if (!entry.title?.trim() || !entry.summary?.trim()) {
      fail(`docs manifest has an empty title or summary: ${entry.route}`);
    }
    const localizedText = `${entry.title ?? ""} ${entry.summary ?? ""}`;
    if (entry.locale === "en" && containsHan(localizedText)) {
      fail(
        `English docs manifest metadata contains Chinese text: ${entry.route}`,
      );
    }
    if (entry.locale === "zh" && !containsHan(localizedText)) {
      fail(
        `Chinese docs manifest metadata has no Chinese text: ${entry.route}`,
      );
    }
    const expectedSource = documentationSourceForRoute(entry.route ?? "");
    if (!expectedSource || entry.sourcePath !== expectedSource) {
      fail(
        `docs manifest has invalid source mapping for route: ${entry.route}`,
      );
    }
    if (!/^[a-f0-9]{64}$/.test(entry.contentHash ?? "")) {
      fail(`docs manifest has invalid source hash for route: ${entry.route}`);
    }
    if (!Array.isArray(entry.audience) || !Array.isArray(entry.appliesTo)) {
      fail(
        `docs manifest has incomplete semantic metadata for route: ${entry.route}`,
      );
    }
    if (entry.stability !== "stable" || !Array.isArray(entry.related)) {
      fail(
        `docs manifest has invalid stability or related metadata for route: ${entry.route}`,
      );
    }
    const htmlFile = renderedHtmlForManifestRoute(entry.route);
    if (!existsSync(htmlFile)) {
      fail(`docs manifest route has no rendered HTML: ${entry.route}`);
      continue;
    }
    const html = readFileSync(htmlFile, "utf8");
    const canonicalTag = `<link rel="canonical" href="${entry.canonicalUrl}">`;
    const ogUrlTag = `<meta property="og:url" content="${entry.canonicalUrl}">`;
    if (!html.includes(canonicalTag) || !html.includes(ogUrlTag)) {
      fail(`rendered metadata does not match manifest route: ${entry.route}`);
    }
    if ((html.match(/<link rel="canonical"/g) ?? []).length !== 1) {
      fail(
        `rendered page must contain exactly one canonical tag: ${entry.route}`,
      );
    }
  }

  const sitemap = readFileSync(path.join(renderedRoot, "sitemap.xml"), "utf8");
  const sitemapUrls = new Set(
    [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]),
  );
  for (const entry of manifest.entries) {
    if (!sitemapUrls.has(entry.canonicalUrl)) {
      fail(`sitemap is missing manifest canonical URL: ${entry.canonicalUrl}`);
    }
  }

  const questions = readRenderedJson("ai-gold-questions.json");
  for (const question of questions?.questions ?? []) {
    for (const route of question.requiredRoutes ?? []) {
      if (!entriesByRoute.has(normalizeTargetPath(route))) {
        fail(
          `rendered AI gold question references missing manifest route: ${route}`,
        );
      }
    }
  }

  const entriesByCanonicalUrl = new Map(
    manifest.entries.map((entry) => [entry.canonicalUrl, entry]),
  );
  const llmsArtifacts = [
    {
      locale: "en",
      indexName: "llms.txt",
      fullName: "llms-full.txt",
      fullUrl: "https://devcodex-labs.github.io/vextjs/llms-full.txt",
      alternateUrl: "https://devcodex-labs.github.io/vextjs/zh/llms.txt",
      optionalHeading: "## Other language",
      forbiddenOptionalHeading: "## Optional",
    },
    {
      locale: "zh",
      indexName: "zh/llms.txt",
      fullName: "zh/llms-full.txt",
      fullUrl: "https://devcodex-labs.github.io/vextjs/zh/llms-full.txt",
      alternateUrl: "https://devcodex-labs.github.io/vextjs/llms.txt",
      optionalHeading: "## 可选语言",
      forbiddenOptionalHeading: "## Optional",
    },
  ];

  for (const artifact of llmsArtifacts) {
    const llms = readFileSync(
      path.join(renderedRoot, artifact.indexName),
      "utf8",
    );
    const llmsFull = readFileSync(
      path.join(renderedRoot, artifact.fullName),
      "utf8",
    );
    verifyLlmsShape(`website/dist/${artifact.indexName}`, llms);
    verifyLlmsShape(`website/dist/${artifact.fullName}`, llmsFull);
    if (!llms.includes(artifact.optionalHeading)) {
      fail(
        `${artifact.indexName} is missing locale-specific heading: ${artifact.optionalHeading}`,
      );
    }
    if (llms.includes(artifact.forbiddenOptionalHeading)) {
      fail(
        `${artifact.indexName} contains a non-localized optional-language heading`,
      );
    }

    if (artifact.locale === "en") {
      if (containsHan(llms) || containsHan(llmsFull)) {
        fail("root llms indexes must contain English content only");
      }
    } else if (!containsHan(llms) || !containsHan(llmsFull)) {
      fail("/zh llms indexes must contain Simplified Chinese content");
    }

    for (const token of [
      "docs-manifest.json",
      "capabilities.json",
      "ai-gold-questions.json",
      "docs-events.schema.json",
      artifact.fullUrl,
      artifact.alternateUrl,
    ]) {
      if (!llms.includes(token)) {
        fail(`${artifact.indexName} is missing required token: ${token}`);
      }
    }

    const curatedPageUrls = markdownLinkUrls(llms).filter((url) =>
      entriesByCanonicalUrl.has(url),
    );
    if (curatedPageUrls.length !== 15) {
      fail(
        `${artifact.indexName} must contain exactly 15 curated documentation links; found ${curatedPageUrls.length}`,
      );
    }
    if (new Set(curatedPageUrls).size !== curatedPageUrls.length) {
      fail(`${artifact.indexName} contains duplicate documentation links`);
    }
    for (const url of curatedPageUrls) {
      if (entriesByCanonicalUrl.get(url)?.locale !== artifact.locale) {
        fail(`${artifact.indexName} contains a cross-locale page link: ${url}`);
      }
    }

    const fullPageUrls = markdownLinkUrls(llmsFull).filter((url) =>
      entriesByCanonicalUrl.has(url),
    );
    const expectedUrls = manifest.entries
      .filter((entry) => entry.locale === artifact.locale)
      .map((entry) => entry.canonicalUrl);
    if (fullPageUrls.length !== expectedUrls.length) {
      fail(
        `${artifact.fullName} has ${fullPageUrls.length} page links; expected ${expectedUrls.length}`,
      );
    }
    if (new Set(fullPageUrls).size !== fullPageUrls.length) {
      fail(`${artifact.fullName} contains duplicate documentation links`);
    }
    const actualUrls = new Set(fullPageUrls);
    for (const expectedUrl of expectedUrls) {
      if (!actualUrls.has(expectedUrl)) {
        fail(`${artifact.fullName} is missing manifest URL: ${expectedUrl}`);
      }
    }
    for (const actualUrl of fullPageUrls) {
      if (entriesByCanonicalUrl.get(actualUrl)?.locale !== artifact.locale) {
        fail(
          `${artifact.fullName} contains a cross-locale page link: ${actualUrl}`,
        );
      }
    }
  }
}

function runTokenizerSelfTest() {
  const valid = [
    "| Field | Type |",
    "| --- | --- |",
    "| `value` | `'a' \\| 'b'` |",
  ];
  const invalid = ["| Field | Type |", "| --- | --- | --- |"];
  if (
    splitTableRow(valid[0]).length !== 2 ||
    splitTableRow(valid[2]).length !== 2 ||
    !isSeparatorRow(valid[1]) ||
    splitTableRow(invalid[0]).length === splitTableRow(invalid[1]).length
  ) {
    fail("documentation table tokenizer self-test failed");
  }
}

runTokenizerSelfTest();

if (renderedOnly) {
  verifyRenderedMachineArtifacts();
  verifyRenderedAnchors();
} else {
  verifyMarkdownTables();
  verifyWebsiteNavigationContract();
  verifyCliDocs();
  verifyPublicReferenceContracts();
  verifyFrontendStreamingDocumentationContract();
  verifyFrontendNavigationDocumentationContract();
  verifyFrontendFreshnessMediaDocumentationContract();
  verifyJscssUserGuideDocumentationContract();
  verifyDocumentationGrowthContract();
  verifyExampleAndMetadata();
}

if (failures.length > 0) {
  console.error(
    `Documentation contract verification failed (${failures.length}):`,
  );
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  renderedOnly
    ? "Rendered documentation contract verified."
    : "Documentation source contract verified.",
);
