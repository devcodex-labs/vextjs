import { join } from "node:path";
import { TextDecoder } from "node:util";
import { readProjectFile } from "../../lib/project/read-project-file.js";
import { normalizeSourcePath } from "../source-view/policy.js";
import { SourceViewError } from "../source-view/types.js";
import type { RouteIndexEntry } from "../project-index/scan-routes.js";
import { VEXT_ROUTE_METHODS } from "../../lib/route-contract.js";

export type SnapshotRouteEntry = Omit<
  RouteIndexEntry,
  "schema" | "freshness" | "docsKind"
> &
  Partial<Pick<RouteIndexEntry, "schema" | "freshness" | "docsKind">>;

export interface DoctorRouteSnapshot {
  entries: SnapshotRouteEntry[];
  sourceFingerprint: string | null;
  sourceFiles: string[];
  incompleteFields: string[];
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(field: string): never {
  throw new SourceViewError(
    "VEXT_SOURCE_UNVERIFIED",
    "Stored route snapshot has invalid " + field + ".",
  );
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return invalid(field);
  return value;
}

/** 显式历史诊断入口；元数据缺失保持未知，不作为当前静态分析缓存。 */
export function readDoctorRouteSnapshot(
  rootDir: string,
): DoctorRouteSnapshot | null {
  const bytes = readProjectFile(
    rootDir,
    ".vext/manifest/routes.json",
    16 * 1024 * 1024,
  );
  if (bytes === null) return null;
  const payload: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    !object(payload) ||
    !Array.isArray(payload.routes) ||
    (payload.schemaVersion !== undefined && payload.schemaVersion !== 1) ||
    (payload.kind !== undefined && payload.kind !== "routes-manifest")
  ) {
    return invalid("envelope");
  }
  const sourceFingerprint =
    optionalString(payload.sourceFingerprint, "sourceFingerprint") ?? null;
  if (sourceFingerprint !== null && !/^[a-f0-9]{64}$/u.test(sourceFingerprint))
    return invalid("sourceFingerprint");
  const incompleteFields: string[] = [];
  const sourceFiles =
    payload.sourceFiles === undefined ? [] : payload.sourceFiles;
  if (
    !Array.isArray(sourceFiles) ||
    sourceFiles.some((file) => typeof file !== "string")
  )
    return invalid("sourceFiles");
  const entries = payload.routes
    .map((route: unknown, index: number): SnapshotRouteEntry => {
      if (!object(route)) return invalid("routes[" + index + "]");
      const label = "routes[" + index + "].";
      const source = optionalString(
        route.fileRelativePath ?? route.source,
        label + "source",
      );
      const method = optionalString(route.method, label + "method");
      const fullPath = optionalString(route.path, label + "path");
      if (
        !source ||
        !method ||
        !VEXT_ROUTE_METHODS.includes(
          method.toLowerCase() as (typeof VEXT_ROUTE_METHODS)[number],
        ) ||
        !fullPath?.startsWith("/") ||
        fullPath.includes("\0")
      )
        return invalid(label + "route identity");
      const fileRelativePath = normalizeSourcePath(source);
      const prefix = optionalString(route.prefix, label + "prefix") ?? "";
      const docsSummary =
        optionalString(route.docsSummary ?? route.summary, label + "summary") ??
        null;
      const operationId =
        optionalString(route.operationId, label + "operationId") ?? null;
      const tags = route.tags === undefined ? [] : route.tags;
      if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string"))
        return invalid(label + "tags");
      if (route.hidden !== undefined && typeof route.hidden !== "boolean")
        return invalid(label + "hidden");
      if (
        route.docsKind !== undefined &&
        (typeof route.docsKind !== "string" ||
          !["backend-api", "frontend-route"].includes(route.docsKind))
      )
        return invalid(label + "docsKind");
      if (
        route.schema !== undefined &&
        (!object(route.schema) ||
          route.schema.schemaVersion !== 1 ||
          !object(route.schema.request) ||
          !Array.isArray(route.schema.responses))
      )
        return invalid(label + "schema");
      if (
        route.freshness !== undefined &&
        (!object(route.freshness) ||
          typeof route.freshness.mode !== "string" ||
          !["dynamic", "static", "revalidate"].includes(route.freshness.mode) ||
          typeof route.freshness.source !== "string" ||
          !["legacy-default", "route-options"].includes(route.freshness.source))
      )
        return invalid(label + "freshness");
      for (const field of [
        "schema",
        "freshness",
        "docsKind",
        "tags",
        "hidden",
      ]) {
        if (route[field] === undefined) incompleteFields.push(label + field);
      }
      return {
        filePath: join(rootDir, fileRelativePath),
        fileRelativePath,
        prefix,
        method: method.toUpperCase(),
        subPath:
          optionalString(route.subPath, label + "subPath") ??
          (prefix && fullPath === prefix
            ? "/"
            : prefix && fullPath.startsWith(prefix + "/")
              ? fullPath.slice(prefix.length)
              : fullPath),
        path: fullPath,
        docsSummary,
        hasDocsSummary: Boolean(docsSummary?.trim()),
        operationId:
          route.operationIdSource === "explicit" ? operationId : null,
        tags,
        hidden: route.hidden === true,
        docsKind: route.docsKind as SnapshotRouteEntry["docsKind"],
        schema: route.schema as SnapshotRouteEntry["schema"],
        freshness: route.freshness as SnapshotRouteEntry["freshness"],
      };
    })
    .sort((a, b) =>
      (a.method + " " + a.path).localeCompare(b.method + " " + b.path),
    );
  return {
    entries,
    sourceFingerprint,
    sourceFiles: sourceFiles.map((file) => normalizeSourcePath(file)),
    incompleteFields,
  };
}
