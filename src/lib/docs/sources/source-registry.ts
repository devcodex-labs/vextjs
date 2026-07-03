import type {
  ResolvedVextDocsConfig,
  ResolvedVextDocsSource,
  VextDocsOpenAPIDocument,
} from "../types.js";
import { collectOpenAPITags, isOpenAPIHttpMethod } from "./openapi-source.js";

export const DEFAULT_DOCS_SOURCE_ID = "all";
const NAMED_VERSION_SEGMENTS =
  /^(?:alpha|beta|canary|latest|next|preview|rc|stable)(?:-?\d+)?$/iu;
const NAMED_VERSION_ORDER = [
  "alpha",
  "beta",
  "rc",
  "preview",
  "next",
  "canary",
  "stable",
  "latest",
];
const NUMBERED_VERSION_SEGMENTS = /^v\d+[A-Za-z0-9-]*$/u;

type InferredVextDocsSource = ResolvedVextDocsSource & {
  namespace: string;
  operationCount: number;
  version: string;
};

export function resolveDocsSources(
  document: VextDocsOpenAPIDocument,
  config: ResolvedVextDocsConfig,
): ResolvedVextDocsSource[] {
  const configured = normalizeConfiguredSources(document, config.sources);
  if (configured.length > 0) {
    return configured;
  }

  const autoSources = inferVersionedSources(document);
  if (autoSources.length < 2) {
    return [createDefaultSource(document)];
  }

  return [createDefaultSource(document), ...autoSources];
}

export function resolveDocsSource(
  sources: ResolvedVextDocsSource[],
  sourceId?: string,
): ResolvedVextDocsSource | undefined {
  if (!sourceId) {
    return sources.find((source) => source.default) ?? sources[0] ?? undefined;
  }
  return sources.find((source) => source.id === sourceId);
}

export function filterOpenAPIDocumentBySource(
  document: VextDocsOpenAPIDocument,
  source: ResolvedVextDocsSource,
): VextDocsOpenAPIDocument {
  if (isDefaultSource(source)) {
    return document;
  }

  const paths: Record<string, unknown> = {};
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    if (matchesSourcePath(path, source)) {
      paths[path] = pathItem;
    }
  }

  const filtered: VextDocsOpenAPIDocument = {
    ...document,
    paths,
  };
  filterTagsInPlace(filtered);
  return filtered;
}

export function countOpenAPIOperations(
  document: VextDocsOpenAPIDocument,
): number {
  let count = 0;
  for (const pathItem of Object.values(document.paths ?? {})) {
    if (typeof pathItem !== "object" || pathItem === null) {
      continue;
    }
    for (const method of Object.keys(pathItem as Record<string, unknown>)) {
      if (isOpenAPIHttpMethod(method)) {
        count += 1;
      }
    }
  }
  return count;
}

export function filterCodeDocsItemsBySource<
  T extends { id?: string; title?: string; sourceFile?: string },
>(items: T[], source: ResolvedVextDocsSource): T[] {
  if (isDefaultSource(source)) {
    return items;
  }
  const code = source.code;
  if (!code || (!code.include?.length && !code.exclude?.length)) {
    return [];
  }
  return items.filter((item) => {
    const value = [item.id ?? "", item.title ?? "", item.sourceFile ?? ""].join(
      " ",
    );
    const included =
      !code.include?.length ||
      code.include.some((pattern) => matchesTextPattern(value, pattern));
    const excluded =
      code.exclude?.some((pattern) => matchesTextPattern(value, pattern)) ??
      false;
    return included && !excluded;
  });
}

function normalizeConfiguredSources(
  document: VextDocsOpenAPIDocument,
  sources: ResolvedVextDocsSource[],
): ResolvedVextDocsSource[] {
  if (sources.length === 0) {
    return [];
  }
  return sources.map((source, index) => ({
    ...source,
    default:
      source.default ||
      (!sources.some((candidate) => candidate.default) && index === 0),
    operationCount: countOpenAPIOperations(
      filterOpenAPIDocumentBySource(document, source),
    ),
  }));
}

function createDefaultSource(
  document: VextDocsOpenAPIDocument,
): ResolvedVextDocsSource {
  return {
    id: DEFAULT_DOCS_SOURCE_ID,
    label: "All",
    match: ["**"],
    default: true,
    operationCount: countOpenAPIOperations(document),
  };
}

function inferVersionedSources(
  document: VextDocsOpenAPIDocument,
): ResolvedVextDocsSource[] {
  const candidates = new Map<string, InferredVextDocsSource>();

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    const version = parseVersionedPath(path);
    if (!version) {
      continue;
    }
    const operationCount = countPathItemOperations(pathItem);
    if (operationCount === 0) {
      continue;
    }
    const id = `${version.namespace}-${version.version}`.toLowerCase();
    const pattern = `${version.matchPrefix}/**`;
    const existing = candidates.get(id);
    if (existing) {
      existing.operationCount += operationCount;
      if (!existing.match.includes(pattern)) {
        existing.match.push(pattern);
      }
      continue;
    }
    candidates.set(id, {
      id,
      label: `${toTitle(version.namespace)} ${formatVersionLabel(version.version)}`,
      match: [pattern],
      namespace: version.namespace.toLowerCase(),
      version: version.version,
      default: false,
      auto: true,
      operationCount,
    });
  }

  return Array.from(candidates.values())
    .sort(compareInferredSources)
    .map(({ namespace: _namespace, ...source }) => source);
}

function compareInferredSources(
  a: InferredVextDocsSource,
  b: InferredVextDocsSource,
): number {
  const namespaceOrder = a.namespace.localeCompare(b.namespace);
  if (namespaceOrder !== 0) {
    return namespaceOrder;
  }
  return compareVersionSegments(a.version, b.version);
}

function compareVersionSegments(a: string, b: string): number {
  const aKey = versionSortKey(a);
  const bKey = versionSortKey(b);
  return (
    aKey.bucket - bKey.bucket ||
    aKey.order - bKey.order ||
    aKey.number - bKey.number ||
    aKey.suffix.localeCompare(bKey.suffix) ||
    aKey.raw.localeCompare(bKey.raw)
  );
}

function versionSortKey(version: string): {
  bucket: number;
  order: number;
  number: number;
  suffix: string;
  raw: string;
} {
  const raw = version.toLowerCase();
  const numbered = /^v(\d+)(.*)$/u.exec(raw);
  if (NUMBERED_VERSION_SEGMENTS.test(version) && numbered) {
    return {
      bucket: 0,
      order: 0,
      number: Number(numbered[1]),
      suffix: numbered[2]!,
      raw,
    };
  }

  const named = /^([a-z]+)(?:-?(\d+))?$/u.exec(raw)!;
  return {
    bucket: 1,
    order: NAMED_VERSION_ORDER.indexOf(named[1]!),
    number: named[2] ? Number(named[2]) : 0,
    suffix: "",
    raw,
  };
}

function countPathItemOperations(pathItem: unknown): number {
  if (typeof pathItem !== "object" || pathItem === null) {
    return 0;
  }
  let count = 0;
  for (const method of Object.keys(pathItem as Record<string, unknown>)) {
    if (isOpenAPIHttpMethod(method)) {
      count += 1;
    }
  }
  return count;
}

function parseVersionedPath(
  path: string,
): { namespace: string; version: string; matchPrefix: string } | undefined {
  const namespaced =
    /^\/([A-Za-z][A-Za-z0-9-]*)\/([A-Za-z][A-Za-z0-9-]*)(?:\/|$)/u.exec(path);
  if (namespaced && isVersionSegment(namespaced[2]!)) {
    return {
      namespace: namespaced[1]!,
      version: namespaced[2]!,
      matchPrefix: `/${namespaced[1]!}/${namespaced[2]!}`,
    };
  }

  const rootVersion = /^\/([A-Za-z][A-Za-z0-9-]*)(?:\/|$)/u.exec(path);
  if (rootVersion && isVersionSegment(rootVersion[1]!)) {
    return {
      namespace: "api",
      version: rootVersion[1]!,
      matchPrefix: `/${rootVersion[1]!}`,
    };
  }
  return undefined;
}

function isVersionSegment(segment: string): boolean {
  return (
    NUMBERED_VERSION_SEGMENTS.test(segment) ||
    NAMED_VERSION_SEGMENTS.test(segment)
  );
}

function matchesSourcePath(
  path: string,
  source: ResolvedVextDocsSource,
): boolean {
  return source.match.some((pattern) => matchesPathPattern(path, pattern));
}

function matchesPathPattern(path: string, pattern: string): boolean {
  const normalizedPattern = normalizePath(pattern);
  if (
    normalizedPattern === "*" ||
    normalizedPattern === "**" ||
    normalizedPattern === "/*" ||
    normalizedPattern === "/**"
  ) {
    return true;
  }
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  if (normalizedPattern.endsWith("/*")) {
    const prefix = normalizedPattern.slice(0, -2);
    if (!path.startsWith(`${prefix}/`)) {
      return false;
    }
    return !path.slice(prefix.length + 1).includes("/");
  }
  return path === normalizedPattern;
}

function matchesTextPattern(value: string, pattern: string): boolean {
  const normalized = pattern.trim();
  if (!normalized) {
    return false;
  }
  const normalizedValue = value.replace(/\\/gu, "/");
  const candidates = [
    normalizedValue,
    ...normalizedValue.split(/\s+/u).filter(Boolean),
  ];
  if (normalized === "*" || normalized === "**") {
    return true;
  }
  if (normalized.includes("*")) {
    const matcher = wildcardTextPatternToRegExp(normalized);
    return candidates.some((candidate) => matcher.test(candidate));
  }
  return normalizedValue.toLowerCase().includes(normalized.toLowerCase());
}

function wildcardTextPatternToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!;
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/\\s]*";
      }
      continue;
    }
    source += char.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  }
  return new RegExp(`^${source}$`, "iu");
}

function normalizePath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "*" || trimmed === "**") {
    return trimmed;
  }
  return `/${trimmed.replace(/^\/+|\/+$/gu, "")}`;
}

function isDefaultSource(source: ResolvedVextDocsSource): boolean {
  return source.id === DEFAULT_DOCS_SOURCE_ID;
}

function toTitle(value: string): string {
  return value
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .map((part) => (part.toLowerCase() === "api" ? "API" : part))
    .join(" ");
}

function formatVersionLabel(version: string): string {
  if (NUMBERED_VERSION_SEGMENTS.test(version)) {
    return version;
  }
  if (/^rc(?:-?\d+)?$/iu.test(version)) {
    return version.toUpperCase();
  }
  return toTitle(version);
}

function filterTagsInPlace(document: VextDocsOpenAPIDocument): void {
  const usedTags = collectOpenAPITags(document);
  if (Array.isArray(document.tags)) {
    document.tags = document.tags.filter(
      (tag) => typeof tag.name === "string" && usedTags.has(tag.name),
    );
  }

  const tagGroups = document["x-tagGroups"];
  if (Array.isArray(tagGroups)) {
    document["x-tagGroups"] = tagGroups
      .map((group) => {
        if (
          typeof group !== "object" ||
          group === null ||
          !Array.isArray((group as Record<string, unknown>).tags)
        ) {
          return group;
        }
        const groupRecord = group as Record<string, unknown>;
        const tags = (groupRecord.tags as unknown[]).filter(
          (tag): tag is string => typeof tag === "string" && usedTags.has(tag),
        );
        return { ...groupRecord, tags };
      })
      .filter((group) => {
        if (typeof group !== "object" || group === null) {
          return true;
        }
        const tags = (group as Record<string, unknown>).tags;
        return !Array.isArray(tags) || tags.length > 0;
      });
  }
}
