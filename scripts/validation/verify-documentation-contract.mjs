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
}

function verifyFrontendStreamingDocumentationContract() {
  requireTokens("README.md", [
    'frontend.render.streaming: "auto"',
    'default `"buffered"`',
    "Suspense fallback",
    "Native, Hono, Fastify, Express, and Koa",
    "React Server Components",
    "Server Functions",
    "partial prerendering",
  ]);

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
  requireTokens("README.md", [
    ...apiTokens,
    "application/vnd.vext.page+json;v=1",
    "same handler",
    "one document navigation",
    "second loader/action route DSL",
  ]);
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
  requireTokens("README.md", [
    `RouteOptions.frontend`,
    `mode: "dynamic" | "static" | "revalidate"`,
    `staticParams`,
    `config.frontend.media`,
    `Image`,
    `defineFont`,
    `defineImageLoader`,
  ]);

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
  verifyRenderedAnchors();
} else {
  verifyMarkdownTables();
  verifyCliDocs();
  verifyPublicReferenceContracts();
  verifyFrontendStreamingDocumentationContract();
  verifyFrontendNavigationDocumentationContract();
  verifyFrontendFreshnessMediaDocumentationContract();
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
