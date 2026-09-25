import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Resolve the installed Rspress parser, including under non-hoisted installs.
// Loading is lazy so source-only validation does not need website dependencies.
let markdownParser;

export function parseDocumentationFrontmatter(
  content,
  sourcePath = "<markdown>",
) {
  const source = content.replace(/^\uFEFF/, "");
  if (!/^---\r?\n/.test(source)) return {};
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`Unclosed frontmatter in ${sourcePath}`);
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!field) continue;
    const [, key, raw] = field;
    if (key !== "docId" && key !== "role") {
      fields[key] = raw.replace(/^['"]|['"]$/g, "").trim();
      continue;
    }
    if (Object.hasOwn(fields, key))
      throw new Error(`Duplicate ${key} in ${sourcePath}`);
    const scalar = raw.match(
      /^(?:"([a-z0-9.-]+)"|'([a-z0-9.-]+)'|([a-z0-9.-]+))(?:\s+#.*)?\s*$/,
    );
    if (!scalar || ["null", "true", "false"].includes(scalar[3]))
      throw new Error(
        `Invalid non-empty string scalar ${key} in ${sourcePath}`,
      );
    fields[key] = scalar[1] ?? scalar[2] ?? scalar[3];
  }
  return fields;
}

export function documentationMetadata(relativePath, source) {
  const [locale, ...parts] = relativePath.split("/");
  if (!["en", "zh"].includes(locale))
    throw new Error(`Unsupported documentation locale: ${relativePath}`);
  const neutral = parts.join("/");
  const fields = parseDocumentationFrontmatter(
    source,
    `website/docs/${relativePath}`,
  );
  const roles = {
    api: "reference",
    examples: "example",
    frontend: "guide",
    guide: "guide",
    resources: "resource",
    specification: "specification",
  };
  const docId =
    fields.docId ?? neutral.replace(/\.mdx?$/, "").replaceAll("/", ".");
  const role = fields.role ?? roles[parts[0]] ?? "resource";
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(docId))
    throw new Error(`Invalid docId for website/docs/${relativePath}: ${docId}`);
  if (
    ![
      "specification",
      "guide",
      "reference",
      "example",
      "troubleshooting",
      "resource",
    ].includes(role)
  )
    throw new Error(`Invalid role for website/docs/${relativePath}: ${role}`);
  return { docId, role };
}

export function documentationText(value) {
  if (!markdownParser)
    throw new Error("Call loadDocumentationParser before extracting text");
  const text = (node) => {
    if (node.type === "definition") return "";
    if (node.type === "image") return node.alt ?? "";
    if (node.type === "break") return " ";
    if (node.type === "html")
      return node.value.replace(/<!--[\s\S]*?-->|<[^>]+>/g, "");
    if (typeof node.value === "string") return node.value;
    const separator = ["root", "list", "listItem", "blockquote"].includes(
      node.type,
    )
      ? " "
      : "";
    return (node.children ?? []).map(text).join(separator);
  };
  return text(markdownParser.parse(value)).replace(/\s+/g, " ").trim();
}
export async function loadDocumentationParser() {
  if (markdownParser) return;
  const here = createRequire(import.meta.url);
  const rspress = createRequire(here.resolve("@rspress/core/package.json"));
  const [{ unified }, { default: remarkParse }] = await Promise.all([
    import(pathToFileURL(rspress.resolve("unified")).href),
    import(pathToFileURL(rspress.resolve("remark-parse")).href),
  ]);
  markdownParser = unified().use(remarkParse);
}

export function normalizeDocumentationRoute(route) {
  return (
    `/${route}`
      .replaceAll("\\", "/")
      .replace(/\/+/g, "/")
      .replace(/\.(?:html|mdx?)$/i, "")
      .replace(/\/index$/i, "/")
      .replace(/\/$/, "") || "/"
  );
}
export function documentationRouteForSource(relativePath) {
  const [locale, ...segments] = relativePath.replaceAll("\\", "/").split("/");
  if (!["en", "zh"].includes(locale))
    throw new Error(`Unsupported documentation source locale: ${relativePath}`);
  const stem = segments.join("/").replace(/\.mdx?$/, "");
  return `/${locale === "zh" ? "zh/" : ""}${stem === "index" ? "" : stem.replace(/\/index$/, "/")}`;
}
export function documentationHtmlPath(distRoot, route) {
  return path.join(
    distRoot,
    `${route.slice(1)}${route.endsWith("/") ? "index.html" : ".html"}`,
  );
}
export function documentationLinks(source) {
  if (!markdownParser)
    throw new Error("Call loadDocumentationParser before extracting links");
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const tree = markdownParser.parse(body);
  // The two MDX home pages use a static locale helper to retain the site base.
  // Read its declaration without evaluating MDX; fenced examples are excluded.
  const helperDeclarations = tree.children
    .filter((node) => node.type === "paragraph")
    .flatMap((node) => [
      ...body
        .slice(node.position.start.offset, node.position.end.offset)
        .matchAll(
          /^export const docsHref = \(path\) => `\$\{basePath\}(\/zh)?\$\{path\}`;\s*$/gm,
        ),
    ]);
  const helperPrefix =
    helperDeclarations.length === 1
      ? (helperDeclarations[0][1] ?? "")
      : undefined;
  const definitions = new Map();
  const links = [];
  const walk = (node, visit) => {
    visit(node);
    for (const child of node.children ?? []) walk(child, visit);
  };
  walk(tree, (node) => {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
  });
  walk(tree, (node) => {
    if (node.type === "link") links.push(node.url);
    if (node.type === "linkReference" && definitions.has(node.identifier))
      links.push(definitions.get(node.identifier));
    if (node.type === "html" || node.type === "text") {
      // remark-parse treats a JSX opening tag with an expression as text.
      // Restrict extraction to actual opening tags, excluding prose attributes.
      const html = [
        ...node.value
          .replace(/<!--[\s\S]*?-->/g, "")
          .matchAll(/<[A-Za-z][\w.-]*\b[^>]*>/gs),
      ]
        .map((match) => match[0])
        .join("\n");
      for (const match of html.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gs))
        links.push(match[2]);
      for (const match of html.matchAll(/\bhref\s*=\s*\{([^}]+)\}/gs)) {
        const expression = match[1].trim();
        const literal = expression.match(/^(["'])(\/[^"'\\]*)\1$/);
        const helper = expression.match(
          /^docsHref\(\s*(["'])(\/[^"'\\]*)\1\s*\)$/,
        );
        if (literal) links.push(literal[2]);
        else if (helper && helperPrefix !== undefined)
          links.push(`${helperPrefix}${helper[2]}`);
        else
          throw new Error(
            `Unsupported dynamic documentation href: ${expression}`,
          );
      }
    }
  });
  return links;
}
export function resolveDocumentationLink(entry, rawLink) {
  if (!rawLink || /^(?:#|\/\/|[a-z][a-z0-9+.-]*:)/i.test(rawLink)) return null;
  const pathname = rawLink.split(/[?#]/, 1)[0];
  if (!pathname) return null;
  const extension = path.posix.extname(pathname).toLowerCase();
  if (extension && ![".md", ".mdx", ".html"].includes(extension)) return null;
  const sourcePath = entry.sourcePath.replace(/^website\/docs\//, "");
  const sourceBase = `/${sourcePath.replace(/^en\//, "")}`;
  return normalizeDocumentationRoute(
    decodeURI(new URL(pathname, `https://vext.local${sourceBase}`).pathname),
  );
}
export function documentationRelations(entries) {
  const byRoute = new Map();
  for (const entry of entries) {
    const key = normalizeDocumentationRoute(entry.route);
    if (byRoute.has(key))
      throw new Error(`Duplicate documentation route: ${entry.sourcePath}`);
    byRoute.set(key, entry);
  }
  const edges = new Map(entries.map((entry) => [entry.sourcePath, new Set()]));
  for (const entry of entries) {
    for (const rawLink of documentationLinks(entry.source)) {
      const route = resolveDocumentationLink(entry, rawLink);
      if (route === null) continue;
      const target = byRoute.get(route);
      if (!target)
        throw new Error(
          `Unresolved internal documentation link in ${entry.sourcePath}: ${rawLink}`,
        );
      if (target === entry) continue;
      edges.get(entry.sourcePath).add(target);
      edges.get(target.sourcePath).add(entry);
    }
  }
  return new Map(
    [...edges].map(([source, targets]) => [
      source,
      [...targets]
        .map(({ docId, locale, canonicalUrl }) => ({
          docId,
          locale,
          canonicalUrl,
        }))
        .sort((a, b) =>
          `${a.locale}/${a.docId}/${a.canonicalUrl}`.localeCompare(
            `${b.locale}/${b.docId}/${b.canonicalUrl}`,
          ),
        ),
    ]),
  );
}
export function validateDocumentationRelations(actualEntries, sourceEntries) {
  const expected = documentationRelations(sourceEntries);
  return actualEntries.flatMap((entry) => {
    const actual = (entry.relatedDocuments ?? []).map(
      ({ docId, locale, canonicalUrl }) => ({ docId, locale, canonicalUrl }),
    );
    return JSON.stringify(actual) ===
      JSON.stringify(expected.get(entry.sourcePath))
      ? []
      : [
          `docs manifest relatedDocuments differ from source links: ${entry.sourcePath}`,
        ];
  });
}
export function documentationRevision(entries, inputs) {
  const sources = entries
    .map(({ sourcePath, contentHash }) => [sourcePath, contentHash])
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256")
    .update(JSON.stringify({ sources, inputs }))
    .digest("hex");
}
export function documentationSnapshotInputs(
  root,
  siteUrl,
  rollout,
  verification = { scope: "stage" },
) {
  const files = [
    "package.json",
    "package-lock.json",
    "website/package.json",
    "website/package-lock.json",
    "website/version-channels.json",
    "website/rspress.config.ts",
    "website/docs/public/ai-gold-questions.json",
    "website/scripts/generate-machine-artifacts.mjs",
    "website/scripts/specification-rules.mjs",
    "website/scripts/documentation-contract.mjs",
    "website/scripts/docs-rollout.mjs",
  ];
  return {
    siteUrl: siteUrl.replace(/\/+$/, ""),
    rollout,
    verification,
    files: files.map((file) => [
      file,
      createHash("sha256")
        .update(readFileSync(path.join(root, file)))
        .digest("hex"),
    ]),
  };
}
export function validateGoldQuestionMirrors(
  questions,
  rollout,
  verification = { scope: "stage" },
) {
  const failures = [];
  const seen = new Set();
  for (const question of questions) {
    if (
      typeof question.id !== "string" ||
      !question.id.trim() ||
      seen.has(question.id)
    )
      failures.push(
        `Gold Question id is missing or duplicated: ${question.id}`,
      );
    seen.add(question.id);
    if (typeof question.question !== "string" || !question.question.trim())
      failures.push(
        `Gold Question text must be a non-empty string: ${question.id}`,
      );
    if (!["en", "zh"].includes(question.locale))
      failures.push(`Gold Question locale is invalid: ${question.id}`);
    if (
      verification.scope === "stage" &&
      (rollout === "final" ||
        (rollout === "zh-complete" && question.locale === "zh")) &&
      !Array.isArray(question.requiredDocIds)
    )
      failures.push(`Gold Question is missing requiredDocIds: ${question.id}`);
    for (const name of [
      "requiredRoutes",
      ...(question.requiredDocIds === undefined ? [] : ["requiredDocIds"]),
    ]) {
      const values = question[name];
      if (
        !Array.isArray(values) ||
        !values.length ||
        values.some((value) => typeof value !== "string" || !value.trim()) ||
        new Set(values).size !== values.length
      )
        failures.push(
          `Gold Question ${name} must be a non-empty unique string array: ${question.id}`,
        );
    }
  }
  if (failures.length || rollout !== "final" || verification.scope !== "stage")
    return failures;
  const byId = new Map(questions.map((question) => [question.id, question]));
  for (const zh of questions.filter(
    (q) => q.locale === "zh" && q.id.endsWith("-zh"),
  )) {
    const en = byId.get(zh.id.slice(0, -3));
    if (
      !en ||
      en.locale !== "en" ||
      JSON.stringify([...(en.requiredDocIds ?? [])].sort()) !==
        JSON.stringify([...(zh.requiredDocIds ?? [])].sort())
    )
      failures.push(`Gold Question mirror coverage differs: ${zh.id}`);
  }
  return failures;
}
