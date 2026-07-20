import {
  collectOpenAPITags,
  createOpenAPIOperationDescriptor,
  getOpenAPIOperationTags,
  isOpenAPIHttpMethod,
} from "../sources/openapi-source.js";
import type {
  VextCodeDocItem,
  VextCodeDocsDocument,
  ResolvedVextDocsAccessConfig,
  VextDocsAccessDescriptor,
  VextDocsMenu,
  VextDocsMenuItem,
  VextDocsOpenAPIDocument,
  VextDocsRequestContext,
  VextRouteDocsAccessConfig,
  VextDocsSourceKind,
} from "../types.js";
import { resolveDocsAccess } from "./resolver.js";

type VextDocsOperationKind = "backend-api" | "frontend-route";

export interface VextDocsFilterOptions {
  includeVisibilityOnly?: boolean;
}

function shouldApplyAccessFilter(
  access: ResolvedVextDocsAccessConfig,
  options: VextDocsFilterOptions = {},
): boolean {
  if (access.mode === "enforce") {
    return true;
  }
  return (
    access.mode === "visibility-only" && options.includeVisibilityOnly === true
  );
}

export async function filterOpenAPIDocumentForDocs(
  document: VextDocsOpenAPIDocument,
  access: ResolvedVextDocsAccessConfig,
  request?: VextDocsRequestContext,
  options: VextDocsFilterOptions = {},
): Promise<VextDocsOpenAPIDocument> {
  if (!shouldApplyAccessFilter(access, options)) {
    return document;
  }

  const filteredPaths: Record<string, Record<string, unknown>> = {};
  const paths = document.paths ?? {};

  for (const [path, pathItem] of Object.entries(paths)) {
    if (typeof pathItem !== "object" || pathItem === null) {
      continue;
    }

    const pathRecord = pathItem as Record<string, unknown>;
    const nextPath: Record<string, unknown> = {};
    let visibleOperationCount = 0;

    for (const [method, operation] of Object.entries(pathRecord)) {
      if (!isOpenAPIHttpMethod(method)) {
        nextPath[method] = operation;
        continue;
      }

      const descriptor = createOpenAPIOperationDescriptor(
        path,
        method,
        operation,
      );
      const routeAccess = readRouteDocsAccessConfig(descriptor.access);
      if (routeAccess?.visible === false) {
        continue;
      }
      const accessResult = await resolveDocsAccess(access, descriptor, request);
      if (!accessResult.visible) {
        continue;
      }
      const tryItOut = accessResult.tryItOut && routeAccess?.tryItOut !== false;

      nextPath[method] = tryItOut
        ? operation
        : {
            ...(typeof operation === "object" && operation !== null
              ? (operation as Record<string, unknown>)
              : {}),
            "x-vext-docs-tryItOut": false,
          };
      visibleOperationCount++;
    }

    if (visibleOperationCount > 0) {
      filteredPaths[path] = nextPath;
    }
  }

  const filtered: VextDocsOpenAPIDocument = {
    ...document,
    paths: filteredPaths,
  };
  filterTagsInPlace(filtered);
  return filtered;
}

export async function filterCodeDocsForDocs(
  document: VextCodeDocsDocument,
  access: ResolvedVextDocsAccessConfig,
  request?: VextDocsRequestContext,
  options: VextDocsFilterOptions = {},
): Promise<VextCodeDocsDocument> {
  if (!shouldApplyAccessFilter(access, options)) {
    return document;
  }

  const items: VextCodeDocItem[] = [];
  for (const item of document.items) {
    const descriptor = createCodeDocAccessDescriptor(item);
    const accessResult = await resolveDocsAccess(access, descriptor, request);
    if (accessResult.visible) {
      items.push(item);
    }
  }

  return {
    ...document,
    items,
  };
}

export function createDocsSearchIndex(
  codeDocs: VextCodeDocsDocument,
  openapi?: VextDocsOpenAPIDocument,
): {
  items: Array<{
    id: string;
    title: string;
    kind: VextDocsSourceKind;
    summary?: string;
    sourceFile?: string;
    method?: string;
    path?: string;
  }>;
} {
  const openapiItems =
    openapi?.paths && typeof openapi.paths === "object"
      ? collectOpenAPIMenuEntries(openapi).map((entry) => ({
          id: entry.descriptor.id,
          title: `${entry.descriptor.method} ${entry.descriptor.path}`,
          kind: "openapi" as const,
          summary: extractOperationSummary(entry.operation),
          method: entry.descriptor.method,
          path: entry.descriptor.path,
        }))
      : [];

  return {
    items: [
      ...openapiItems,
      ...codeDocs.items.map((item) => ({
        id: item.id,
        title: item.title,
        kind: item.kind,
        summary: item.summary,
        sourceFile: item.sourceFile,
      })),
    ],
  };
}

export function buildDocsMenu(
  openapi: VextDocsOpenAPIDocument,
  codeDocs: VextCodeDocsDocument,
): VextDocsMenu {
  const items: VextDocsMenuItem[] = [];

  const backendChildren = createOpenAPIMenuItems(openapi, "backend-api");
  if (backendChildren.length > 0) {
    items.push({
      id: "group:backend-api",
      title: "HTTP API",
      kind: "group",
      source: "openapi",
      children: backendChildren,
      descriptor: {
        kind: "group",
        id: "group:backend-api",
        title: "HTTP API",
        source: "openapi",
      },
    });
  }

  const frontendChildren = createOpenAPIMenuItems(openapi, "frontend-route");
  if (frontendChildren.length > 0) {
    items.push({
      id: "group:frontend-routes",
      title: "Pages",
      kind: "group",
      source: "openapi",
      children: frontendChildren,
      descriptor: {
        kind: "group",
        id: "group:frontend-routes",
        title: "Pages",
        source: "openapi",
      },
    });
  }

  for (const [source, title] of [
    ["service", "Services"],
    ["utils", "Utils"],
    ["model", "Models"],
    ["component", "Components"],
    ["plugin", "Plugins"],
    ["middleware", "Middlewares"],
    ["locale", "Locales"],
    ["config", "Config"],
    ["style", "Styles"],
    ["preload", "Preload"],
  ] as const) {
    const children = codeDocs.items
      .filter((item) => item.kind === source)
      .map(
        (item): VextDocsMenuItem => ({
          id: item.id,
          title: item.title,
          kind: item.kind,
          source: item.kind,
          descriptor: createCodeDocAccessDescriptor(item),
        }),
      );
    if (children.length > 0) {
      items.push({
        id: `group:${source}`,
        title,
        kind: "group",
        source,
        children,
        descriptor: {
          kind: "group",
          id: `group:${source}`,
          title,
          source: "code",
        },
      });
    }
  }

  return { items };
}

export function createCodeDocAccessDescriptor(
  item: VextCodeDocItem,
): VextDocsAccessDescriptor {
  const [rawScope = "", rawMember = item.exportName ?? "default"] =
    item.id.split("#", 2);
  const value = rawScope.replace(/^[^:]+:/u, "");
  if (item.kind === "service") {
    return {
      kind: "service",
      id: item.id,
      serviceKey: value,
      member: rawMember,
    };
  }
  if (item.kind === "utils") {
    return {
      kind: "utils",
      id: item.id,
      file: item.sourceFile ?? value,
      exportName: rawMember,
    };
  }
  if (item.kind === "model") {
    return {
      kind: "model",
      id: item.id,
      modelKey: value,
    };
  }
  if (item.kind === "component") {
    return {
      kind: "component",
      id: item.id,
      file: item.sourceFile ?? value,
      exportName: rawMember,
    };
  }
  if (item.kind === "plugin") {
    return {
      kind: "plugin",
      id: item.id,
      pluginName: item.plugin?.name ?? value,
      file: item.sourceFile,
    };
  }
  if (item.kind === "middleware") {
    return {
      kind: "middleware",
      id: item.id,
      middlewareName: item.middleware?.name ?? value,
      file: item.sourceFile,
      middlewareType: item.middleware?.type,
    };
  }
  if (
    item.kind === "locale" ||
    item.kind === "config" ||
    item.kind === "preload" ||
    item.kind === "style"
  ) {
    return {
      kind: item.kind,
      id: item.id,
      file: item.sourceFile,
      title: item.title,
    };
  }
  return {
    kind: "group",
    id: item.id,
    title: item.title,
    source: "code",
  };
}

interface OpenAPIMenuEntry {
  descriptor: Extract<VextDocsAccessDescriptor, { kind: "operation" }>;
  operation: unknown;
  tags: string[];
}

function createOpenAPIMenuItems(
  document: VextDocsOpenAPIDocument,
  docsKind?: VextDocsOperationKind,
): VextDocsMenuItem[] {
  const entries = collectOpenAPIMenuEntries(document, docsKind);
  if (entries.length === 0) {
    return [];
  }

  const byTag = new Map<string, VextDocsMenuItem[]>();
  for (const entry of entries) {
    const tag = entry.tags[0] ?? "Untagged";
    if (!byTag.has(tag)) {
      byTag.set(tag, []);
    }
    byTag.get(tag)!.push(createOpenAPIOperationMenuItem(entry));
  }

  const groups: VextDocsMenuItem[] = [];
  const groupedTags = new Set<string>();
  const tagGroups = Array.isArray(document["x-tagGroups"])
    ? document["x-tagGroups"]
    : [];

  for (const group of tagGroups) {
    if (typeof group !== "object" || group === null) {
      continue;
    }
    const groupRecord = group as Record<string, unknown>;
    const groupName =
      typeof groupRecord.name === "string" ? groupRecord.name : "Group";
    const tags = Array.isArray(groupRecord.tags) ? groupRecord.tags : [];
    const children: VextDocsMenuItem[] = [];

    for (const tag of tags) {
      if (typeof tag !== "string") {
        continue;
      }
      const operations = byTag.get(tag);
      if (!operations || operations.length === 0) {
        continue;
      }
      groupedTags.add(tag);
      children.push(
        createOpenAPIGroupMenuItem(
          `group:openapi:${slugify(groupName)}:${slugify(tag)}`,
          tag,
          operations,
        ),
      );
    }

    if (children.length > 0) {
      groups.push(
        createOpenAPIGroupMenuItem(
          `group:openapi:${slugify(groupName)}`,
          groupName,
          children,
        ),
      );
    }
  }

  for (const [tag, operations] of byTag) {
    if (groupedTags.has(tag)) {
      continue;
    }
    groups.push(
      createOpenAPIGroupMenuItem(
        `group:openapi:tag:${slugify(tag)}`,
        tag,
        operations,
      ),
    );
  }

  return groups;
}

function collectOpenAPIMenuEntries(
  document: VextDocsOpenAPIDocument,
  docsKind?: VextDocsOperationKind,
): OpenAPIMenuEntry[] {
  const entries: OpenAPIMenuEntry[] = [];
  const paths = document.paths ?? {};
  for (const [path, pathItem] of Object.entries(paths)) {
    if (typeof pathItem !== "object" || pathItem === null) {
      continue;
    }
    for (const [method, operation] of Object.entries(
      pathItem as Record<string, unknown>,
    )) {
      if (!isOpenAPIHttpMethod(method)) {
        continue;
      }
      if (docsKind && resolveOpenAPIDocsKind(operation, path) !== docsKind) {
        continue;
      }
      const descriptor = createOpenAPIOperationDescriptor(
        path,
        method,
        operation,
      );
      entries.push({
        descriptor,
        operation,
        tags:
          descriptor.tags && descriptor.tags.length > 0
            ? descriptor.tags
            : ["Untagged"],
      });
    }
  }
  return entries;
}

function createOpenAPIOperationMenuItem(
  entry: OpenAPIMenuEntry,
): VextDocsMenuItem {
  return {
    id: entry.descriptor.id,
    title: `${entry.descriptor.method} ${entry.descriptor.path}`,
    kind: "openapi",
    source: "openapi",
    descriptor: entry.descriptor,
  };
}

function createOpenAPIGroupMenuItem(
  id: string,
  title: string,
  children: VextDocsMenuItem[],
): VextDocsMenuItem {
  return {
    id,
    title,
    kind: "group",
    source: "openapi",
    children,
    descriptor: {
      kind: "group",
      id,
      title,
      source: "openapi",
    },
  };
}

function resolveOpenAPIDocsKind(
  operation: unknown,
  path: string,
): VextDocsOperationKind {
  if (typeof operation === "object" && operation !== null) {
    const explicit = (operation as Record<string, unknown>)["x-vext-docs-kind"];
    if (explicit === "frontend-route" || explicit === "backend-api") {
      return explicit;
    }
  }

  const tags = getOpenAPIOperationTags(operation).map((tag) =>
    tag.toLowerCase(),
  );
  if (tags.includes("frontend") || path.startsWith("/frontend")) {
    return "frontend-route";
  }
  return "backend-api";
}

function readRouteDocsAccessConfig(
  access: VextRouteDocsAccessConfig | string | undefined,
): VextRouteDocsAccessConfig | undefined {
  if (typeof access === "object" && access !== null && !Array.isArray(access)) {
    return access;
  }
  return undefined;
}

function extractOperationSummary(operation: unknown): string | undefined {
  if (typeof operation !== "object" || operation === null) {
    return undefined;
  }
  const record = operation as Record<string, unknown>;
  return typeof record.summary === "string"
    ? record.summary
    : typeof record.description === "string"
      ? record.description
      : undefined;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  return slug || "group";
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
