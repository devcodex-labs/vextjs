import { inspectSourceQuality } from "../tooling/diagnostics/code-quality.js";
import { existsSync } from "node:fs";
import { readProjectFile } from "../lib/project/read-project-file.js";
import {
  collectProjectStaticDiagnostics,
  domainSourceFiles,
} from "../tooling/diagnostics/project.js";
import type { RuntimeMode } from "../lib/config-profile.js";
import { projectStaticConfig } from "../tooling/project-index/config-projection.js";
import { normalizeDevMcpConfig } from "./contracts.js";
import path from "node:path";
import type { SourceView } from "../tooling/source-view/types.js";
import { ASSISTANT_SOURCE_ROOT } from "../tooling/project-index/analysis-source.js";
import {
  isInRole,
  type ResolvedAssistantRole,
} from "../tooling/project-index/roles.js";
import {
  ASSISTANT_DIAGNOSTIC_RULES,
  type AssistantRuleMetadata,
} from "./diagnostic-rules.js";
import type { VextMcpConfigTarget } from "./contracts.js";

export type VextMcpProjectDiagnosticSeverity = "error" | "warning" | "info";

export interface VextMcpProjectDiagnostic extends AssistantRuleMetadata {
  severity: VextMcpProjectDiagnosticSeverity;
  code: string;
  message: string;
  sourceFile?: string;
  recommendedAction: string;
  affectedCapabilityIds: string[];
}

const SOURCE_FILE_PATTERN = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/u;

interface DiagnosticContext {
  view: SourceView;
  roles: readonly ResolvedAssistantRole[];
}

export function collectVextProjectDiagnostics(
  rootDir: string,
  view: SourceView,
  roles: readonly ResolvedAssistantRole[],
  options: {
    includeGenerated?: boolean;
    configTarget?: VextMcpConfigTarget;
  } = {},
): VextMcpProjectDiagnostic[] {
  const diagnostics: VextMcpProjectDiagnostic[] = [];
  const context = { view, roles };
  diagnostics.push(
    ...collectProjectStaticDiagnostics(view, roles, {
      configTarget: options.configTarget,
    }).map((diagnostic) => ({
      ...diagnostic,
      affectedCapabilityIds:
        diagnostic.domain === "routes"
          ? ["C03", "C04", "C13", "C26", "C27"]
          : ["C08", "C12", "C20", "C28"],
    })),
  );
  collectServiceDiagnostics(context, diagnostics);
  collectConfigDiagnostics(context, diagnostics, options.configTarget);
  collectFrontendDiagnostics(context, diagnostics);
  collectTestDiagnostics(context, diagnostics);
  if (options.includeGenerated !== false)
    diagnostics.push(...readServiceManifestDiagnostics(rootDir));
  diagnostics.push(...readPackageDiagnostics(context));
  return diagnostics;
}

function collectServiceDiagnostics(
  context: DiagnosticContext,
  diagnostics: VextMcpProjectDiagnostic[],
): void {
  for (const relative of collectProjectSourceFiles(context, "src/services")) {
    const source = context.view.read(ASSISTANT_SOURCE_ROOT, relative);
    if (!source) continue;
    if (qualityFacts(relative, source)?.databaseTypeBypass) {
      diagnostics.push(
        projectDiagnostic({
          severity: "warning",
          code: "VEXT_MCP_SERVICE_DB_TYPE_BYPASS",
          sourceFile: relative,
          message:
            "Service code appears to define driver-like database helper types or cast app.db locally.",
          recommendedAction:
            "Keep database contracts in MonSQLize model definitions or src/types/server/** type-only files, and keep services focused on business methods.",
          affectedCapabilityIds: ["C05", "C08", "C25", "C26"],
        }),
      );
    }
  }
}

function collectConfigDiagnostics(
  context: DiagnosticContext,
  diagnostics: VextMcpProjectDiagnostic[],
  configTarget: VextMcpConfigTarget | undefined,
): void {
  for (const file of domainSourceFiles(context.view, context.roles, "config")) {
    const source = context.view.read(file.rootId, file.path);
    if (source && qualityFacts(file.path, source)?.eagerRedisAdapter)
      diagnostics.push(
        projectDiagnostic({
          severity: "warning",
          code: "VEXT_MCP_REDIS_ADAPTER_EAGER_CONFIG",
          sourceFile: file.path,
          message:
            "An imported Redis adapter is constructed while the config module is evaluated.",
          recommendedAction:
            "Review connection ownership and use a supported lazy factory when configuration must be loaded without opening connections.",
          affectedCapabilityIds: ["C12", "C19", "C21"],
        }),
      );
  }
  for (const mode of selectedConfigModes(configTarget)) {
    const config = projectStaticConfig(context.view, { mode });
    const sourceFile = config.sourceFiles.at(-1);
    const prefix = mode === "production" ? "[production] " : "";
    const mcp = config.field("dev.mcp");
    const mimeTypes = config.field("multipart.allowedMimeTypes");
    if (
      mimeTypes.state === "known" &&
      Array.isArray(mimeTypes.value) &&
      mimeTypes.value.includes("image/svg+xml")
    )
      diagnostics.push(
        projectDiagnostic({
          severity: "info",
          code: "VEXT_MCP_UPLOAD_SVG_REVIEW",
          sourceFile,
          message: `${prefix}The upload MIME policy includes SVG.`,
          recommendedAction:
            "Review the application's intended validation and serving behavior for SVG uploads.",
          affectedCapabilityIds: ["C21", "C22"],
        }),
      );
    if (mcp.state === "known") {
      const normalized = normalizeDevMcpConfig(mcp.value);
      if (!normalized.ok)
        diagnostics.push(
          projectDiagnostic({
            severity: "error",
            code: "VEXT_MCP_CONFIG_INVALID",
            sourceFile,
            message: prefix + normalized.failure.message,
            recommendedAction:
              "Correct the declared dev.mcp configuration before host synchronization or startup.",
            affectedCapabilityIds: ["C12", "C29"],
          }),
        );
    }
  }
}

function selectedConfigModes(
  target: VextMcpConfigTarget | undefined,
): RuntimeMode[] {
  return target === "all"
    ? ["development", "production"]
    : [target ?? "development"];
}

function qualityFacts(file: string, source: string) {
  try {
    return inspectSourceQuality(file, source);
  } catch {
    return undefined;
  }
}

function collectFrontendDiagnostics(
  context: DiagnosticContext,
  diagnostics: VextMcpProjectDiagnostic[],
): void {
  for (const relative of collectProjectSourceFiles(context, "src/frontend")) {
    const source = context.view.read(ASSISTANT_SOURCE_ROOT, relative);
    if (!source) continue;
    if (qualityFacts(relative, source)?.apiForm) {
      diagnostics.push(
        projectDiagnostic({
          severity: "info",
          code: "VEXT_MCP_FORM_API_BOUNDARY_REVIEW",
          sourceFile: relative,
          message:
            "A browser form posts directly to an API path; JSON APIs, CSRF, and generated clients may need an explicit boundary decision.",
          recommendedAction:
            "Use Vext frontend navigation/Form helpers for page actions, or document the JSON API/CSRF contract on the matching route.",
          affectedCapabilityIds: ["C09", "C13", "C21"],
        }),
      );
    }
  }
}

function collectTestDiagnostics(
  context: DiagnosticContext,
  diagnostics: VextMcpProjectDiagnostic[],
): void {
  for (const relative of collectProjectSourceFiles(context, "test")) {
    const source = context.view.read(ASSISTANT_SOURCE_ROOT, relative);
    if (!source) continue;
    if (qualityFacts(relative, source)?.placeholderAssertion) {
      diagnostics.push(
        projectDiagnostic({
          severity: "warning",
          code: "VEXT_MCP_TEST_PLACEHOLDER_ASSERTION",
          sourceFile: relative,
          message:
            "A test contains a placeholder assertion that does not verify framework or application behavior.",
          recommendedAction:
            "Replace placeholder assertions with route, service, model, job, or browser behavior checks before accepting the generated candidate.",
          affectedCapabilityIds: ["C15", "C26", "C27"],
        }),
      );
    }
  }
}

function collectProjectSourceFiles(
  context: DiagnosticContext,
  defaultDirectory: string,
): string[] {
  if (defaultDirectory === "src/frontend")
    return domainSourceFiles(context.view, context.roles, "frontend")
      .filter((file) => SOURCE_FILE_PATTERN.test(file.path))
      .map((file) => file.path);
  const directory =
    context.roles.find((role) => role.defaultPath === defaultDirectory)?.path ??
    defaultDirectory;
  return context.view
    .list({ rootId: ASSISTANT_SOURCE_ROOT })
    .filter(
      (file) =>
        isInRole(file.path, directory) &&
        (SOURCE_FILE_PATTERN.test(file.path) || file.path.endsWith(".json")),
    )
    .map((file) => file.path);
}

function readServiceManifestDiagnostics(
  rootDir: string,
): VextMcpProjectDiagnostic[] {
  const diagnostics: VextMcpProjectDiagnostic[] = [];
  for (const relative of [
    ".vext/manifest/services.json",
    ".vext/services.json",
  ]) {
    const absolute = path.join(rootDir, relative);
    if (!existsSync(absolute)) continue;
    const manifest = readJsonObject(rootDir, relative);
    if (!manifest) continue;
    const incomplete = collectIncompleteManifestSources(manifest).slice(0, 10);
    if (manifest.complete === false || incomplete.length) {
      diagnostics.push(
        projectDiagnostic({
          severity: "warning",
          code: "VEXT_MCP_SERVICE_DEPENDENCY_ANALYSIS_INCOMPLETE",
          sourceFile: relative,
          message:
            incomplete.length > 0
              ? `Service dependency analysis is incomplete for ${incomplete.join(", ")}.`
              : "Service dependency analysis manifest is marked incomplete.",
          recommendedAction:
            "Run host-side typegen/doctor or inspect the listed services for dynamic service access before accepting generated code.",
          affectedCapabilityIds: ["C05", "C16", "C27"],
        }),
      );
    }
  }
  return diagnostics;
}

function collectIncompleteManifestSources(value: unknown): string[] {
  const sources: string[] = [];
  visitManifest(value, (entry) => {
    const complete = entry.complete;
    const dependencyComplete =
      entry.dependencyAnalysisComplete ??
      entry.serviceDependencyAnalysisComplete;
    const status = readString(entry.status) ?? readString(entry.state);
    if (
      complete === false ||
      dependencyComplete === false ||
      status === "incomplete" ||
      status === "partial"
    ) {
      const source =
        readString(entry.sourceFile) ??
        readString(entry.file) ??
        readString(entry.path) ??
        readString(entry.id);
      if (source) sources.push(source);
    }
  });
  return [...new Set(sources)];
}

function visitManifest(
  value: unknown,
  visitor: (entry: Record<string, unknown>) => void,
): void {
  if (Array.isArray(value)) {
    for (const item of value) visitManifest(item, visitor);
    return;
  }
  if (!isRecord(value)) return;
  visitor(value);
  for (const item of Object.values(value)) visitManifest(item, visitor);
}

function readPackageDiagnostics(
  context: DiagnosticContext,
): VextMcpProjectDiagnostic[] {
  let packageJson: unknown;
  try {
    packageJson = JSON.parse(
      context.view.read(ASSISTANT_SOURCE_ROOT, "package.json") ?? "null",
    );
  } catch {
    return [];
  }
  if (!isRecord(packageJson) || !isRecord(packageJson.scripts)) return [];
  const devScript = readString(packageJson.scripts.dev);
  if (!devScript || !/\bdev-stable\b/u.test(devScript)) return [];
  return [
    projectDiagnostic({
      severity: "info",
      code: "VEXT_MCP_DEV_SCRIPT_WORKAROUND_REVIEW",
      sourceFile: "package.json",
      message:
        "The dev script points to a local stability workaround instead of the framework dev command.",
      recommendedAction:
        "Prefer `vext dev` once the underlying framework issue is fixed; keep workaround scripts documented when they are intentionally retained.",
      affectedCapabilityIds: ["C15", "C16", "C28"],
    }),
  ];
}

function projectDiagnostic(
  diagnostic: Omit<VextMcpProjectDiagnostic, keyof AssistantRuleMetadata>,
): VextMcpProjectDiagnostic {
  const metadata = ASSISTANT_DIAGNOSTIC_RULES[diagnostic.code];
  if (!metadata)
    throw new Error(`Unregistered MCP diagnostic: ${diagnostic.code}.`);
  return { ...metadata, ...diagnostic };
}

function readJsonObject(
  rootDir: string,
  relative: string,
): Record<string, unknown> | null {
  try {
    const content = readProjectFile(rootDir, relative, 2 * 1024 * 1024);
    if (content === null) return null;
    const value = JSON.parse(content.toString("utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
