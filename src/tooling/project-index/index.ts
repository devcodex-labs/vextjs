import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fg from "fast-glob";
import {
  filePathToServiceKeys,
  toGeneratedImportPath,
} from "../../shared/service-paths.js";
import { getTypegenGeneratedPaths } from "../typegen/generated-paths.js";
import {
  isRuntimeAppExtensionKey,
  renderTypeStringLiteral,
} from "../typegen/property-key.js";

export type ExtensionSourceKind =
  | "setup"
  | "onReady"
  | "onClose"
  | "declaration";
export type InferenceConfidence = "high" | "medium" | "low";

export interface ServiceIndexEntry {
  filePath: string;
  importPath: string;
  serviceKey: string;
  keySegments: string[];
}

export interface AppExtensionIndexEntry {
  pluginFile: string;
  propertyKey: string;
  inferredTypeText: string;
  sourceKind: ExtensionSourceKind;
  confidence: InferenceConfidence;
}

export interface ProjectIndex {
  serviceEntries: ServiceIndexEntry[];
  appExtensions: AppExtensionIndexEntry[];
}

const SOURCE_PATTERNS = ["**/*.{ts,mts,cts,js,mjs,cjs}"];
const COMMON_IGNORE_PATTERNS = [
  "**/_*/**",
  "**/_*",
  "**/*.d.ts",
  "**/*.test.*",
  "**/*.spec.*",
  "**/*.__vext_compiled__*",
];

const LIFECYCLE_METHODS: Array<Exclude<ExtensionSourceKind, "declaration">> = [
  "setup",
  "onReady",
  "onClose",
];

export async function buildProjectIndex(
  rootDir: string,
): Promise<ProjectIndex> {
  const servicesDir = join(rootDir, "src", "services");
  const pluginsDir = join(rootDir, "src", "plugins");
  const paths = getTypegenGeneratedPaths(rootDir);

  const serviceFiles = existsSync(servicesDir)
    ? await fg(SOURCE_PATTERNS, {
        cwd: servicesDir,
        absolute: true,
        onlyFiles: true,
        ignore: COMMON_IGNORE_PATTERNS,
      })
    : [];

  const pluginFiles = existsSync(pluginsDir)
    ? await fg(SOURCE_PATTERNS, {
        cwd: pluginsDir,
        absolute: true,
        onlyFiles: true,
        ignore: COMMON_IGNORE_PATTERNS,
      })
    : [];

  const serviceEntries = serviceFiles
    .map((filePath) => {
      const keySegments = filePathToServiceKeys(filePath, servicesDir);
      return {
        filePath,
        importPath: toGeneratedImportPath(paths.servicesDts, filePath),
        serviceKey: keySegments.join("."),
        keySegments,
      } satisfies ServiceIndexEntry;
    })
    .sort((a, b) => a.serviceKey.localeCompare(b.serviceKey));

  const appExtensions = pluginFiles
    .flatMap((filePath) => scanAppExtensions(filePath, paths.appExtensionsDts))
    .sort((a, b) => a.propertyKey.localeCompare(b.propertyKey));

  return {
    serviceEntries,
    appExtensions,
  };
}

function scanAppExtensions(
  pluginFile: string,
  generatedFilePath: string,
): AppExtensionIndexEntry[] {
  const source = readFileSync(pluginFile, "utf-8");
  const declared = scanDeclaredAppExtensions(
    source,
    pluginFile,
    generatedFilePath,
  );
  const declaredKeys = new Set(declared.map((entry) => entry.propertyKey));
  const legacy = scanLegacyAppExtendCalls(source, pluginFile).filter(
    (entry) => !declaredKeys.has(entry.propertyKey),
  );
  return [...declared, ...legacy];
}

function scanDeclaredAppExtensions(
  source: string,
  pluginFile: string,
  generatedFilePath: string,
): AppExtensionIndexEntry[] {
  const entries: AppExtensionIndexEntry[] = [];
  const declarationPattern =
    /export\s+const\s+appExtensions\s*=\s*defineAppExtensions\s*<\s*\{([\s\S]*?)\}\s*>\s*\(/gu;
  const importPath = toGeneratedImportPath(generatedFilePath, pluginFile);

  for (const match of source.matchAll(declarationPattern)) {
    const body = match[1] ?? "";
    for (const propertyKey of extractObjectTypeKeys(body)) {
      entries.push({
        pluginFile,
        propertyKey,
        inferredTypeText: `typeof import("${importPath}").appExtensions[${renderTypeStringLiteral(propertyKey)}]`,
        sourceKind: "declaration",
        confidence: "high",
      });
    }
  }

  return entries;
}

function scanLegacyAppExtendCalls(
  source: string,
  pluginFile: string,
): AppExtensionIndexEntry[] {
  const entries: AppExtensionIndexEntry[] = [];

  for (const lifecycle of LIFECYCLE_METHODS) {
    for (const block of findLifecycleBlocks(source, lifecycle)) {
      const callPattern = new RegExp(
        `${escapeRegExp(block.paramName)}\\.extend\\s*\\(\\s*([\"'\`])([^\"'\`]+)\\1\\s*,`,
        "gu",
      );

      for (const match of block.body.matchAll(callPattern)) {
        const propertyKey = match[2];
        if (!propertyKey) continue;
        if (!isRuntimeAppExtensionKey(propertyKey)) continue;

        const valueStart = match.index + match[0].length;
        const valueExpression = readCallArgument(block.body, valueStart);
        const inferred = inferLegacyValueType(block.body, valueExpression);

        entries.push({
          pluginFile,
          propertyKey,
          inferredTypeText: inferred.typeText,
          sourceKind: lifecycle,
          confidence: inferred.confidence,
        });
      }
    }
  }

  return entries;
}

function findLifecycleBlocks(
  source: string,
  lifecycle: Exclude<ExtensionSourceKind, "declaration">,
): Array<{ paramName: string; body: string }> {
  const blocks: Array<{ paramName: string; body: string }> = [];
  const methodPattern = new RegExp(
    `${lifecycle}\\s*\\(\\s*([A-Za-z_$][\\w$]*)[^)]*\\)\\s*\\{`,
    "gu",
  );

  for (const match of source.matchAll(methodPattern)) {
    const openBrace = source.indexOf("{", match.index);
    const body = readBalanced(source, openBrace, "{", "}");
    const paramName = match[1];
    if (paramName && body) {
      blocks.push({ paramName, body: body.slice(1, -1) });
    }
  }

  const propertyPattern = new RegExp(
    `${lifecycle}\\s*:\\s*(?:async\\s*)?\\(?\\s*([A-Za-z_$][\\w$]*)[^)]*\\)?\\s*=>\\s*\\{`,
    "gu",
  );

  for (const match of source.matchAll(propertyPattern)) {
    const openBrace = source.indexOf("{", match.index);
    const body = readBalanced(source, openBrace, "{", "}");
    const paramName = match[1];
    if (paramName && body) {
      blocks.push({ paramName, body: body.slice(1, -1) });
    }
  }

  return blocks;
}

function inferLegacyValueType(
  lifecycleBody: string,
  valueExpression: string,
): { typeText: string; confidence: InferenceConfidence } {
  const value = valueExpression.trim();
  if (!value) {
    return { typeText: "unknown", confidence: "low" };
  }

  if (value.startsWith("{")) {
    return {
      typeText: inferObjectLiteralType(value),
      confidence: "medium",
    };
  }

  if (/^(true|false)$/u.test(value)) {
    return { typeText: "boolean", confidence: "medium" };
  }
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) {
    return { typeText: "number", confidence: "medium" };
  }
  if (/^["'`]/u.test(value)) {
    return { typeText: "string", confidence: "medium" };
  }

  const identifier = /^[A-Za-z_$][\w$]*/u.exec(value)?.[0];
  if (identifier) {
    const initializer = findConstObjectInitializer(lifecycleBody, identifier);
    if (initializer) {
      return {
        typeText: inferObjectLiteralType(initializer),
        confidence: "medium",
      };
    }
  }

  return { typeText: "unknown", confidence: "low" };
}

function inferObjectLiteralType(objectLiteral: string): string {
  const body = objectLiteral.trim().replace(/^\{|\}$/gu, "");
  const members: string[] = [];

  const methodPattern =
    /(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?::\s*([^\{]+?))?\s*\{/gu;
  for (const match of body.matchAll(methodPattern)) {
    const name = match[1];
    const params = normalizeParams(match[2] ?? "");
    const returnType = normalizeReturnType(match[3], match[0]);
    if (name) {
      members.push(`${name}(${params}): ${returnType};`);
    }
  }

  const propertyPattern =
    /(?:^|,|\n)\s*([A-Za-z_$][\w$]*)\s*:\s*(true|false|-?\d+(?:\.\d+)?|["'`][\s\S]*?["'`])/gu;
  for (const match of body.matchAll(propertyPattern)) {
    const name = match[1];
    const value = match[2] ?? "";
    if (name && !members.some((item) => item.startsWith(`${name}(`))) {
      members.push(`${name}: ${inferPrimitiveLiteralType(value)};`);
    }
  }

  if (members.length === 0) {
    return "Record<string, unknown>";
  }

  return `{ ${members.join(" ")} }`;
}

function normalizeParams(paramsText: string): string {
  const params = paramsText
    .split(",")
    .map((param) => param.trim())
    .filter(Boolean)
    .map((param) => {
      if (param.includes(":")) {
        return param;
      }
      return `${param}: any`;
    });
  return params.join(", ");
}

function normalizeReturnType(
  explicitReturnType: string | undefined,
  signatureText: string,
): string {
  const cleaned = explicitReturnType?.trim().replace(/,$/u, "");
  if (cleaned) {
    return cleaned;
  }
  return signatureText.trim().startsWith("async ") ? "Promise<any>" : "any";
}

function inferPrimitiveLiteralType(value: string): string {
  if (/^(true|false)$/u.test(value)) return "boolean";
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) return "number";
  return "string";
}

function findConstObjectInitializer(
  body: string,
  identifier: string,
): string | null {
  const pattern = new RegExp(
    `\\bconst\\s+${escapeRegExp(identifier)}\\s*=`,
    "u",
  );
  const match = pattern.exec(body);
  if (!match) return null;

  const openBrace = body.indexOf("{", match.index + match[0].length);
  if (openBrace < 0) return null;
  return readBalanced(body, openBrace, "{", "}");
}

function extractObjectTypeKeys(body: string): string[] {
  const keys: string[] = [];
  let index = 0;

  while (index < body.length) {
    index = skipTypeWhitespaceAndDelimiters(body, index);
    if (body.startsWith("readonly", index)) {
      index = skipTypeWhitespaceAndDelimiters(body, index + "readonly".length);
    }

    const keyToken = readTypePropertyKey(body, index);
    if (!keyToken) {
      index++;
      continue;
    }

    const key = keyToken.key;
    index = keyToken.end;
    index = skipTypeWhitespaceAndDelimiters(body, index);
    if (body[index] === "?") {
      index++;
      index = skipTypeWhitespaceAndDelimiters(body, index);
    }

    if (body[index] === ":") {
      keys.push(key);
      index = consumeTypeValue(body, index + 1);
      continue;
    }

    index++;
  }

  return [...new Set(keys)].sort((a, b) => a.localeCompare(b));
}

function readTypePropertyKey(
  body: string,
  index: number,
): { key: string; end: number } | null {
  const char = body[index];
  if (char === '"' || char === "'") {
    return readQuotedTypePropertyKey(body, index, char);
  }

  const keyMatch = /^[A-Za-z_$][\w$]*/u.exec(body.slice(index));
  if (!keyMatch) return null;

  const key = keyMatch[0];
  return { key, end: index + key.length };
}

function readQuotedTypePropertyKey(
  body: string,
  index: number,
  quote: '"' | "'",
): { key: string; end: number } | null {
  let key = "";
  let escaped = false;

  for (let current = index + 1; current < body.length; current++) {
    const char = body[current]!;

    if (escaped) {
      key += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === quote) {
      return { key, end: current + 1 };
    }

    key += char;
  }

  return null;
}

function skipTypeWhitespaceAndDelimiters(body: string, index: number): number {
  let current = index;
  while (current < body.length && /[\s;,]/u.test(body[current] ?? "")) {
    current++;
  }
  return current;
}

function consumeTypeValue(body: string, index: number): number {
  let current = index;
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  while (current < body.length) {
    const char = body[current]!;

    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      current++;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      current++;
      continue;
    }

    if (char === "{" || char === "(" || char === "[" || char === "<") {
      depth++;
    } else if (char === "}" || char === ")" || char === "]" || char === ">") {
      depth = Math.max(0, depth - 1);
    } else if ((char === ";" || char === ",") && depth === 0) {
      return current + 1;
    }

    current++;
  }

  return current;
}

function readCallArgument(source: string, startIndex: number): string {
  let index = startIndex;
  while (/\s/u.test(source[index] ?? "")) index++;

  if (source[index] === "{") {
    return readBalanced(source, index, "{", "}") ?? "";
  }
  if (source[index] === "(") {
    return readBalanced(source, index, "(", ")") ?? "";
  }

  let end = index;
  while (end < source.length && source[end] !== ")" && source[end] !== "\n") {
    if (source[end] === ",") break;
    end++;
  }
  return source.slice(index, end);
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
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === openChar) {
      depth++;
    } else if (char === closeChar) {
      depth--;
      if (depth === 0) {
        return source.slice(openIndex, i + 1);
      }
    }
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
