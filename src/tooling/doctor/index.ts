import {
  buildRouteIndexFromSourceView,
  projectRouteSourceSnapshot,
} from "../project-index/scan-routes.js";
import { collectProjectSources } from "../project-index/source-input.js";
import {
  readDoctorRouteSnapshot,
  type SnapshotRouteEntry,
} from "./route-snapshot.js";
import { inferOperationId } from "../../lib/openapi/operation-id.js";
import { createRouteId } from "../../frontend/contract/schema-ir.js";
import type {
  VextRouteFreshnessIdentity,
  VextRouteSchemaContractV1,
} from "../../frontend/contract/types.js";
import type { VextOpenAPIDocsKind } from "../../lib/openapi/types.js";
import type { GeneratedFileResult } from "../../lib/project/generated-files.js";
import { createRouteInspectFile } from "./write-route-inspect.js";
import { publishGeneratedFiles } from "../../lib/project/generated-files.js";
import { withProjectOwner } from "../../lib/project/owner.js";
import {
  createRouteManifestFile,
  type RouteManifestPayload,
} from "./write-route-manifest.js";

export type DoctorTarget = "routes" | "all";
export type DoctorLevel = "error" | "warn" | "info";
export type DoctorGroup = "routing" | "docs" | "tooling";

export interface DoctorDiagnostic {
  level: DoctorLevel;
  group: DoctorGroup;
  blocking: boolean;
  code:
    | "duplicate-route"
    | "missing-docs-summary"
    | "auto-operation-id"
    | "missing-tags"
    | "deprecated-docs-tags"
    | "doctor-routes-ok"
    | "doctor-no-routes"
    | "snapshot-source-state"
    | "snapshot-incomplete";
  message: string;
  filePath?: string;
  fileRelativePath?: string;
  method?: string;
  path?: string;
  suggestedValue?: string;
}

export interface RunDoctorOptions {
  rootDir: string;
  target?: DoctorTarget;
  writeInspect?: boolean;
  writeManifest?: boolean;
  refresh?: boolean;
  /** Read the stored manifest as an explicit snapshot, even when stale. */
  manifestOnly?: boolean;
}

export interface DoctorSummary {
  errors: number;
  warnings: number;
  infos: number;
  blocking: number;
  byCode: Record<string, number>;
  byGroup: Record<string, number>;
}

export interface DoctorRouteRecord {
  filePath: string;
  fileRelativePath: string;
  method: string;
  subPath: string;
  path: string;
  prefix: string;
  docsSummary: string | null;
  operationId: string | null;
  effectiveOperationId: string;
  operationIdSource: "explicit" | "inferred";
  tags: string[];
  hidden: boolean;
  docsKind?: VextOpenAPIDocsKind;
  schema?: VextRouteSchemaContractV1;
  freshness?: VextRouteFreshnessIdentity;
}

export interface DoctorResult {
  ok: boolean;
  target: DoctorTarget;
  routeFileCount: number;
  routeCount: number;
  summary: DoctorSummary;
  diagnostics: DoctorDiagnostic[];
  routes: DoctorRouteRecord[];
  inspect?: GeneratedFileResult;
  manifest?: GeneratedFileResult;
  sourceFingerprint: string | null;
  sourceFiles: string[];
  sourceFreshness: "current" | "stale" | "unverified";
}

export async function runDoctor(
  options: RunDoctorOptions,
): Promise<DoctorResult> {
  if (!options.writeInspect && !options.writeManifest)
    return runDoctorOwned(options);
  return withProjectOwner(options.rootDir, "typegen", [".vext"], () =>
    runDoctorOwned(options),
  );
}

async function runDoctorOwned(
  options: RunDoctorOptions,
): Promise<DoctorResult> {
  const target = options.target ?? "routes";
  const writeInspect = options.writeInspect ?? false;
  const writeManifest = options.writeManifest ?? false;
  if (options.manifestOnly && writeManifest) {
    throw new Error(
      "[vextjs] doctor --manifest-only cannot be combined with --write-manifest because a stale snapshot must not be re-attested as current.",
    );
  }
  const sourceView = await collectProjectSources(options.rootDir, ["route"]);
  const currentSnapshot = projectRouteSourceSnapshot(sourceView);
  let sourceSnapshot: { fingerprint: string | null; files: string[] } =
    currentSnapshot;
  let sourceFreshness: DoctorResult["sourceFreshness"] = "current";
  let routeEntries: SnapshotRouteEntry[];
  const snapshotDiagnostics: DoctorDiagnostic[] = [];
  if (options.manifestOnly) {
    const snapshot = readDoctorRouteSnapshot(options.rootDir);
    if (!snapshot) {
      throw new Error(
        "[vextjs] doctor --manifest-only requires an existing .vext/manifest/routes.json snapshot.",
      );
    }
    routeEntries = snapshot.entries;
    sourceSnapshot = {
      fingerprint: snapshot.sourceFingerprint,
      files: snapshot.sourceFiles,
    };
    sourceFreshness =
      snapshot.sourceFingerprint !== null &&
      snapshot.sourceFingerprint !== currentSnapshot.fingerprint
        ? "stale"
        : "unverified";
    snapshotDiagnostics.push({
      level: "warn",
      group: "tooling",
      blocking: false,
      code: "snapshot-source-state",
      message:
        "Stored route snapshot is " +
        sourceFreshness +
        "; its projection was not rechecked against current source.",
    });
    if (snapshot.incompleteFields.length > 0)
      snapshotDiagnostics.push({
        level: "warn",
        group: "tooling",
        blocking: false,
        code: "snapshot-incomplete",
        message:
          "Stored snapshot omits metadata: " +
          snapshot.incompleteFields.join(", ") +
          ".",
      });
  } else {
    // 同一 View 产生摘要和投影；未认证的磁盘 manifest 不能充当静态事实缓存。
    routeEntries = buildRouteIndexFromSourceView(options.rootDir, sourceView);
  }
  const diagnostics = [...analyzeRoutes(routeEntries), ...snapshotDiagnostics];
  const routes = routeEntries.map((entry) => toDoctorRouteRecord(entry));
  const summary = summarizeDiagnostics(diagnostics);
  const inspectDraft = writeInspect
    ? createRouteInspectFile(options.rootDir, {
        schemaVersion: 1,
        target: "routes",
        sourceFingerprint: sourceSnapshot.fingerprint,
        sourceFiles: sourceSnapshot.files,
        sourceFreshness,
        routeFileCount: new Set(routeEntries.map((item) => item.filePath)).size,
        routeCount: routeEntries.length,
        summary,
        diagnostics,
        routes,
      })
    : undefined;
  const manifestDraft = writeManifest
    ? createRouteManifestFile(
        options.rootDir,
        buildRouteManifestPayload(routes, diagnostics, sourceSnapshot),
      )
    : undefined;

  const generated = await publishGeneratedFiles(options.rootDir, [
    ...(inspectDraft ? [inspectDraft] : []),
    ...(manifestDraft ? [manifestDraft] : []),
  ]);
  const inspect = inspectDraft
    ? generated.find((file) => file.filePath === inspectDraft.filePath)
    : undefined;
  const manifest = manifestDraft
    ? generated.find((file) => file.filePath === manifestDraft.filePath)
    : undefined;

  return {
    ok: !diagnostics.some((item) => item.level === "error"),
    target,
    routeFileCount: new Set(routeEntries.map((item) => item.filePath)).size,
    routeCount: routeEntries.length,
    summary,
    diagnostics,
    routes,
    inspect,
    manifest,
    sourceFingerprint: sourceSnapshot.fingerprint,
    sourceFiles: sourceSnapshot.files,
    sourceFreshness,
  };
}

function analyzeRoutes(routeEntries: SnapshotRouteEntry[]): DoctorDiagnostic[] {
  if (routeEntries.length === 0) {
    return [
      {
        level: "info",
        group: "tooling",
        blocking: false,
        code: "doctor-no-routes",
        message: "No routes were found in this analysis input.",
      },
    ];
  }

  const diagnostics: DoctorDiagnostic[] = [];
  const duplicateMap = new Map<string, SnapshotRouteEntry[]>();

  for (const entry of routeEntries) {
    const routeKey = `${entry.method} ${entry.path}`;
    const bucket = duplicateMap.get(routeKey) ?? [];
    bucket.push(entry);
    duplicateMap.set(routeKey, bucket);
  }

  for (const [routeKey, entries] of duplicateMap) {
    if (entries.length < 2) continue;

    const locations = entries.map((entry) => entry.filePath).join("; ");
    diagnostics.push({
      level: "error",
      group: "routing",
      blocking: true,
      code: "duplicate-route",
      message: `Duplicate static route definition detected for ${routeKey}. Sources: ${locations}`,
      filePath: entries[0]?.filePath,
      fileRelativePath: entries[0]?.fileRelativePath,
      method: entries[0]?.method,
      path: entries[0]?.path,
    });
  }

  for (const entry of routeEntries) {
    if (entry.hidden) {
      continue;
    }

    if (!entry.hasDocsSummary) {
      diagnostics.push({
        level: "warn",
        group: "docs",
        blocking: false,
        code: "missing-docs-summary",
        message: `${entry.method} ${entry.path} is missing docs.summary.`,
        filePath: entry.filePath,
        fileRelativePath: entry.fileRelativePath,
        method: entry.method,
        path: entry.path,
      });
    }

    if (!entry.operationId) {
      diagnostics.push({
        level: "info",
        group: "tooling",
        blocking: false,
        code: "auto-operation-id",
        message: `${entry.method} ${entry.path} will use inferred operationId at runtime.`,
        filePath: entry.filePath,
        fileRelativePath: entry.fileRelativePath,
        method: entry.method,
        path: entry.path,
        suggestedValue: inferOperationId(entry.method, entry.path),
      });
    }

    if (entry.tags.length > 0) {
      diagnostics.push({
        level: "info",
        group: "docs",
        blocking: false,
        code: "deprecated-docs-tags",
        message: `${entry.method} ${entry.path} uses deprecated docs.tags; Vext ignores it and infers operation tags automatically.`,
        filePath: entry.filePath,
        fileRelativePath: entry.fileRelativePath,
        method: entry.method,
        path: entry.path,
      });
    }
  }

  if (diagnostics.length === 0) {
    diagnostics.push({
      level: "info",
      group: "tooling",
      blocking: false,
      code: "doctor-routes-ok",
      message: `Route doctor passed for ${routeEntries.length} route(s).`,
    });
  }

  return diagnostics;
}

function toDoctorRouteRecord(entry: SnapshotRouteEntry): DoctorRouteRecord {
  return {
    filePath: entry.filePath,
    fileRelativePath: entry.fileRelativePath,
    method: entry.method,
    subPath: entry.subPath,
    path: entry.path,
    prefix: entry.prefix,
    docsSummary: entry.docsSummary,
    operationId: entry.operationId,
    effectiveOperationId:
      entry.operationId ?? inferOperationId(entry.method, entry.path),
    operationIdSource: entry.operationId ? "explicit" : "inferred",
    tags: entry.tags,
    hidden: entry.hidden,
    docsKind: entry.docsKind,
    schema: entry.schema,
    freshness: entry.freshness,
  };
}

function summarizeDiagnostics(diagnostics: DoctorDiagnostic[]): DoctorSummary {
  const summary: DoctorSummary = {
    errors: 0,
    warnings: 0,
    infos: 0,
    blocking: 0,
    byCode: {},
    byGroup: {},
  };

  for (const diagnostic of diagnostics) {
    if (diagnostic.level === "error") summary.errors += 1;
    if (diagnostic.level === "warn") summary.warnings += 1;
    if (diagnostic.level === "info") summary.infos += 1;
    if (diagnostic.blocking) summary.blocking += 1;
    summary.byCode[diagnostic.code] =
      (summary.byCode[diagnostic.code] ?? 0) + 1;
    summary.byGroup[diagnostic.group] =
      (summary.byGroup[diagnostic.group] ?? 0) + 1;
  }

  return summary;
}

function buildRouteManifestPayload(
  routes: DoctorRouteRecord[],
  diagnostics: DoctorDiagnostic[],
  sourceSnapshot: { fingerprint: string | null; files: string[] },
): RouteManifestPayload {
  if (sourceSnapshot.fingerprint === null)
    throw new Error(
      "[vextjs] Cannot publish a route manifest without source identity.",
    );
  const missingDocsSummary = diagnostics.filter(
    (item) => item.code === "missing-docs-summary",
  ).length;
  const missingTags = diagnostics.filter(
    (item) => item.code === "missing-tags",
  ).length;
  const duplicateRoutes = diagnostics.filter(
    (item) => item.code === "duplicate-route",
  ).length;
  const explicitOperationIds = routes.filter(
    (item) => item.operationIdSource === "explicit",
  ).length;
  const inferredOperationIds = routes.filter(
    (item) => item.operationIdSource === "inferred",
  ).length;
  const hiddenRoutes = routes.filter((item) => item.hidden).length;
  const publicRoutes = routes.length - hiddenRoutes;

  return {
    schemaVersion: 1,
    kind: "routes-manifest",
    target: "routes",
    sourceFingerprint: sourceSnapshot.fingerprint,
    sourceFiles: sourceSnapshot.files,
    routeFileCount: new Set(routes.map((item) => item.fileRelativePath)).size,
    routeCount: routes.length,
    summary: {
      publicRoutes,
      hiddenRoutes,
      explicitOperationIds,
      inferredOperationIds,
      missingDocsSummary,
      missingTags,
      duplicateRoutes,
    },
    routes: routes.map((item) => {
      if (!item.docsKind || !item.schema || !item.freshness)
        throw new Error("[vextjs] Cannot publish incomplete route metadata.");
      return {
        fileRelativePath: item.fileRelativePath,
        source: item.fileRelativePath,
        prefix: item.prefix,
        method: item.method,
        subPath: item.subPath,
        path: item.path,
        docsKind: item.docsKind,
        docsSummary: item.docsSummary,
        summary: item.docsSummary,
        routeId: createRouteId(item.method, item.path),
        operationId: item.effectiveOperationId,
        operationIdSource: item.operationIdSource,
        tags: item.tags,
        hidden: item.hidden,
        schema: item.schema,
        freshness: item.freshness,
        layout: { state: "unresolved", paths: [] },
      };
    }),
  };
}
