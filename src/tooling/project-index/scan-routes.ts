import { existsSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import fg from "fast-glob";

const ROUTE_SOURCE_PATTERNS = ["**/*.{ts,mts,cts,js,mjs,cjs}"];
const ROUTE_IGNORE_PATTERNS = [
  "**/_*/**",
  "**/_*",
  "**/*.d.ts",
  "**/*.test.*",
  "**/*.spec.*",
  "**/*.__vext_compiled__*",
];
const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
];

export interface RouteIndexEntry {
  filePath: string;
  fileRelativePath: string;
  prefix: string;
  method: string;
  path: string;
  docsSummary: string | null;
  hasDocsSummary: boolean;
  operationId: string | null;
  tags: string[];
  hidden: boolean;
}

export async function buildRouteIndex(
  rootDir: string,
): Promise<RouteIndexEntry[]> {
  const routesDir = join(rootDir, "src", "routes");
  if (!existsSync(routesDir)) {
    return [];
  }

  const routeFiles = await fg(ROUTE_SOURCE_PATTERNS, {
    cwd: routesDir,
    absolute: true,
    onlyFiles: true,
    ignore: ROUTE_IGNORE_PATTERNS,
  });

  return routeFiles
    .flatMap((filePath) => scanRouteEntries(filePath, rootDir, routesDir))
    .sort((a, b) =>
      `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`),
    );
}

function scanRouteEntries(
  filePath: string,
  rootDir: string,
  routesDir: string,
): RouteIndexEntry[] {
  const source = readFileSync(filePath, "utf-8");
  const prefix = filePathToRoutePrefix(filePath, routesDir);
  const fileRelativePath = relative(rootDir, filePath).split(sep).join("/");
  const entries: RouteIndexEntry[] = [];

  for (const block of findDefineRoutesBlocks(source)) {
    const methodPattern = new RegExp(
      `${escapeRegExp(block.paramName)}\\.(${HTTP_METHODS.join("|")})\\s*\\(`,
      "gu",
    );

    for (const match of block.body.matchAll(methodPattern)) {
      const openParen = block.body.indexOf("(", match.index);
      const callBody = readBalanced(block.body, openParen, "(", ")");
      if (!callBody) continue;

      const args = splitTopLevelArgs(callBody.slice(1, -1));
      const routePath = readStringLiteral(args[0] ?? "");
      if (!routePath) continue;

      const docs = readRouteDocs(args[1]);
      const method = match[1]!.toUpperCase();

      entries.push({
        filePath,
        fileRelativePath,
        prefix,
        method,
        path: normalizeRoutePath(prefix, routePath),
        docsSummary: docs.docsSummary,
        hasDocsSummary: docs.hasDocsSummary,
        operationId: docs.operationId,
        tags: docs.tags,
        hidden: docs.hidden,
      });
    }
  }

  return entries;
}

function findDefineRoutesBlocks(
  source: string,
): Array<{ paramName: string; body: string }> {
  const blocks: Array<{ paramName: string; body: string }> = [];
  const pattern =
    /defineRoutes\s*\(\s*(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)[^)=]*\)?\s*=>\s*\{/gu;

  for (const match of source.matchAll(pattern)) {
    const openBrace = source.indexOf("{", match.index);
    const body = readBalanced(source, openBrace, "{", "}");
    const paramName = match[1];
    if (body && paramName) {
      blocks.push({ paramName, body: body.slice(1, -1) });
    }
  }

  return blocks;
}

function readRouteDocs(optionsArg: string | undefined): {
  docsSummary: string | null;
  hasDocsSummary: boolean;
  operationId: string | null;
  tags: string[];
  hidden: boolean;
} {
  const empty = {
    docsSummary: null,
    hasDocsSummary: false,
    operationId: null,
    tags: [],
    hidden: false,
  };

  const options = optionsArg?.trim();
  if (!options?.startsWith("{")) {
    return empty;
  }

  const docsMatch = /\bdocs\s*:/u.exec(options);
  if (!docsMatch) {
    return empty;
  }

  const docsOpen = options.indexOf("{", docsMatch.index);
  const docsObject = readBalanced(options, docsOpen, "{", "}");
  if (!docsObject) {
    return empty;
  }

  const summary = readStringProperty(docsObject, "summary");
  const operationId = readStringProperty(docsObject, "operationId");

  return {
    docsSummary: summary,
    hasDocsSummary: Boolean(summary?.trim()),
    operationId,
    tags: readStringArrayProperty(docsObject, "tags"),
    hidden: readBooleanProperty(docsObject, "hidden"),
  };
}

function readStringProperty(objectLiteral: string, key: string): string | null {
  const pattern = new RegExp(
    `\\b${escapeRegExp(key)}\\s*:\\s*([\"'\`])([\\s\\S]*?)\\1`,
    "u",
  );
  return pattern.exec(objectLiteral)?.[2] ?? null;
}

function readStringArrayProperty(objectLiteral: string, key: string): string[] {
  const pattern = new RegExp(`\\b${escapeRegExp(key)}\\s*:\\s*\\[`, "u");
  const match = pattern.exec(objectLiteral);
  if (!match) return [];

  const openBracket = objectLiteral.indexOf("[", match.index);
  const arrayText = readBalanced(objectLiteral, openBracket, "[", "]");
  if (!arrayText) return [];

  return [...arrayText.matchAll(/(["'`])([\s\S]*?)\1/gu)]
    .map((item) => item[2])
    .filter((item): item is string => Boolean(item));
}

function readBooleanProperty(objectLiteral: string, key: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegExp(key)}\\s*:\\s*true\\b`, "u");
  return pattern.test(objectLiteral);
}

function splitTopLevelArgs(argsText: string): string[] {
  const args: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let i = 0; i < argsText.length; i++) {
    const char = argsText[i]!;

    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "{" || char === "(" || char === "[") depth++;
    else if (char === "}" || char === ")" || char === "]") depth--;
    else if (char === "," && depth === 0) {
      args.push(argsText.slice(start, i).trim());
      start = i + 1;
    }
  }

  args.push(argsText.slice(start).trim());
  return args;
}

function readStringLiteral(value: string): string | null {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'" && quote !== "`") {
    return null;
  }
  const end = trimmed.indexOf(quote, 1);
  if (end < 0) {
    return null;
  }
  return trimmed.slice(1, end);
}

function readBalanced(
  source: string,
  openIndex: number,
  openChar: "{" | "(" | "[",
  closeChar: "}" | ")" | "]",
): string | null {
  if (openIndex < 0 || source[openIndex] !== openChar) return null;

  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let i = openIndex; i < source.length; i++) {
    const char = source[i]!;

    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === openChar) depth++;
    else if (char === closeChar) {
      depth--;
      if (depth === 0) {
        return source.slice(openIndex, i + 1);
      }
    }
  }

  return null;
}

function filePathToRoutePrefix(filePath: string, routesDir: string): string {
  let rel = relative(routesDir, filePath);
  rel = rel.split(sep).join("/");

  const ext = extname(rel);
  rel = rel.slice(0, -ext.length);

  if (rel === "index") {
    rel = "";
  } else if (rel.endsWith("/index")) {
    rel = rel.slice(0, -"/index".length);
  }

  rel = rel.replace(/\[([^]]+)]/g, ":$1");

  if (!rel.startsWith("/")) {
    rel = `/${rel}`;
  }

  if (rel.length > 1 && rel.endsWith("/")) {
    rel = rel.slice(0, -1);
  }

  return rel;
}

function normalizeRoutePath(prefix: string, subPath: string): string {
  const cleanPrefix =
    prefix.endsWith("/") && prefix.length > 1 ? prefix.slice(0, -1) : prefix;
  const cleanSubPath = subPath.startsWith("/") ? subPath.slice(1) : subPath;

  if (!cleanSubPath) {
    return cleanPrefix || "/";
  }

  if (cleanPrefix === "/") {
    return `/${cleanSubPath}`;
  }

  const fullPath = `${cleanPrefix}/${cleanSubPath}`;
  if (fullPath.length > 1 && fullPath.endsWith("/")) {
    return fullPath.slice(0, -1);
  }

  return fullPath;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
