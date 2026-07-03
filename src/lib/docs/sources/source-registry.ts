import type {
  ResolvedVextDocsConfig,
  ResolvedVextDocsSource,
  VextDocsOpenAPIDocument,
} from "../types.js";
import { collectOpenAPITags, isOpenAPIHttpMethod } from "./openapi-source.js";

export const DEFAULT_DOCS_SOURCE_ID = "all";

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
    return (
      sources.find((source) => source.default) ??
      sources[0] ??
      undefined
    );
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

export function filterCodeDocsItemsBySource<T extends { id?: string; title?: string; sourceFile?: string }>(
  items: T[],
  source: ResolvedVextDocsSource,
): T[] {
  if (isDefaultSource(source)) {
    return items;
  }
  const code = source.code;
  if (!code || (!code.include?.length && !code.exclude?.length)) {
    return [];
  }
  return items.filter((item) => {
    const value = [
      item.id ?? "",
      item.title ?? "",
      item.sourceFile ?? "",
    ].join(" ");
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
  const candidates = new Map<string, ResolvedVextDocsSource>();

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
    const existing = candidates.get(id);
    if (existing) {
      existing.operationCount = (existing.operationCount ?? 0) + operationCount;
      continue;
    }
    candidates.set(id, {
      id,
      label: `${toTitle(version.namespace)} ${version.version}`,
      match: [`/${version.namespace}/${version.version}/**`],
      version: version.version,
      default: false,
      auto: true,
      operationCount,
    });
  }

  return Array.from(candidates.values()).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
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
): { namespace: string; version: string } | undefined {
  const namespaced = /^\/([A-Za-z][A-Za-z0-9-]*)\/(v\d+[A-Za-z0-9-]*)(?:\/|$)/u.exec(
    path,
  );
  if (namespaced) {
    return {
      namespace: namespaced[1]!,
      version: namespaced[2]!,
    };
  }

  const rootVersion = /^\/(v\d+[A-Za-z0-9-]*)(?:\/|$)/u.exec(path);
  if (rootVersion) {
    return {
      namespace: "api",
      version: rootVersion[1]!,
    };
  }
  return undefined;
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
  if (normalized === "*" || normalized === "**") {
    return true;
  }
  if (normalized.includes("*")) {
    const escaped = normalized
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
      .join(".*");
    return new RegExp(`^${escaped}$`, "iu").test(value);
  }
  return value.toLowerCase().includes(normalized.toLowerCase());
}

function normalizePath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "*" || trimmed === "**") {
    return trimmed;
  }
  return `/${trimmed.replace(/^\/+|\/+$/gu, "")}`;
}

function isDefaultSource(source: ResolvedVextDocsSource): boolean {
  return (
    source.id === DEFAULT_DOCS_SOURCE_ID ||
    source.match.some((pattern) => pattern === "**" || pattern === "/**")
  );
}

function toTitle(value: string): string {
  return value
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .map((part) => (part.toLowerCase() === "api" ? "API" : part))
    .join(" ");
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
