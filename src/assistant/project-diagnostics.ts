import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type VextMcpProjectDiagnosticSeverity = "error" | "warning" | "info";

export interface VextMcpProjectDiagnostic {
  severity: VextMcpProjectDiagnosticSeverity;
  code: string;
  message: string;
  sourceFile?: string;
  recommendedAction: string;
  affectedCapabilityIds: string[];
}

const PROJECT_DIAGNOSTIC_MAX_FILE_BYTES = 256 * 1024;
const SOURCE_FILE_PATTERN = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/u;

export function collectVextProjectDiagnostics(
  rootDir: string,
): VextMcpProjectDiagnostic[] {
  const diagnostics: VextMcpProjectDiagnostic[] = [];
  collectRouteDiagnostics(rootDir, diagnostics);
  collectServiceDiagnostics(rootDir, diagnostics);
  collectConfigDiagnostics(rootDir, diagnostics);
  collectFrontendDiagnostics(rootDir, diagnostics);
  collectTestDiagnostics(rootDir, diagnostics);
  diagnostics.push(...readServiceManifestDiagnostics(rootDir));
  diagnostics.push(...readPackageDiagnostics(rootDir));
  return diagnostics;
}

function collectRouteDiagnostics(
  rootDir: string,
  diagnostics: VextMcpProjectDiagnostic[],
): void {
  for (const relative of collectProjectSourceFiles(
    rootDir,
    "src/routes",
    160,
  )) {
    const source = readProjectSourceText(rootDir, relative, diagnostics);
    if (!source) continue;
    if (/\bdocs\s*:\s*\{[\s\S]{0,3000}?\btags\s*:/u.test(source)) {
      diagnostics.push(
        projectDiagnostic({
          severity: "warning",
          code: "VEXT_MCP_DEPRECATED_DOCS_TAGS",
          sourceFile: relative,
          message:
            "Route docs.tags is deprecated and ignored; OpenAPI tags are inferred from the route path/source.",
          recommendedAction:
            "Remove docs.tags and use path/source grouping or OpenAPI tagGroups when an explicit group is required.",
          affectedCapabilityIds: ["C03", "C13", "C26"],
        }),
      );
    }
    if (
      /\b(?:res|reply)\.json\s*\(/u.test(source) &&
      /\bapp\.(?:get|post|put|patch|delete|head|options)\s*\(/u.test(source) &&
      !/\bresponses\s*:/u.test(source)
    ) {
      diagnostics.push(
        projectDiagnostic({
          severity: "warning",
          code: "VEXT_MCP_ROUTE_RESPONSE_SCHEMA_MISSING",
          sourceFile: relative,
          message:
            "A JSON route handler was found without a top-level RouteOptions.responses schema.",
          recommendedAction:
            "Declare RouteOptions.responses for each JSON status so OpenAPI, frontend contracts, serializers, and MCP all share the same runtime schema source.",
          affectedCapabilityIds: ["C03", "C04", "C13", "C26", "C27"],
        }),
      );
    }
  }
}

function collectServiceDiagnostics(
  rootDir: string,
  diagnostics: VextMcpProjectDiagnostic[],
): void {
  for (const relative of collectProjectSourceFiles(
    rootDir,
    "src/services",
    120,
  )) {
    const source = readProjectSourceText(rootDir, relative, diagnostics);
    if (!source) continue;
    if (
      /\b(?:type|interface)\s+(?:Cursor|Collection|Db)\b/u.test(source) ||
      /\bapp\.db\b[\s\S]{0,160}\bas\s+(?:unknown\s+as\s+)?\w/u.test(source)
    ) {
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
  rootDir: string,
  diagnostics: VextMcpProjectDiagnostic[],
): void {
  for (const relative of collectProjectSourceFiles(rootDir, "src/config", 80)) {
    const source = readProjectSourceText(rootDir, relative, diagnostics);
    if (!source) continue;
    if (
      /\bdatabase\s*:/u.test(source) &&
      !/\bcursorSecret\s*:/u.test(source) &&
      !/\bcursorSecretWarning\s*:/u.test(source)
    ) {
      diagnostics.push(
        projectDiagnostic({
          severity: "info",
          code: "VEXT_MCP_DATABASE_CURSOR_SECRET_REVIEW",
          sourceFile: relative,
          message:
            "Database config is present without an explicit cursorSecret or cursorSecretWarning choice.",
          recommendedAction:
            "For cursor-based pagination, configure database.cursorSecret in production or intentionally disable the warning only for trusted local/demo projects.",
          affectedCapabilityIds: ["C08", "C12"],
        }),
      );
    }
    if (
      hasRedisRateLimitStore(source) &&
      !/(?:\burl\s*:|\buri\s*:|VEXT_REDIS_URL|REDIS_URL)/u.test(source)
    ) {
      diagnostics.push(
        projectDiagnostic({
          severity: "error",
          code: "VEXT_MCP_RATE_LIMIT_REDIS_TARGET_MISSING",
          sourceFile: relative,
          message:
            "Redis-backed rateLimit.store is declared without a static url/uri or documented Redis environment fallback.",
          recommendedAction:
            "Provide store.url/store.uri or document the VEXT_REDIS_URL/REDIS_URL runtime requirement next to the config.",
          affectedCapabilityIds: ["C12", "C20"],
        }),
      );
    }
    if (
      hasRedisRateLimitStore(source) &&
      /VEXT_REDIS_URL|REDIS_URL|process\.env/u.test(source)
    ) {
      diagnostics.push(
        projectDiagnostic({
          severity: "warning",
          code: "VEXT_MCP_RATE_LIMIT_REDIS_ENV_REQUIRED",
          sourceFile: relative,
          message:
            "Redis-backed rateLimit.store depends on runtime environment variables; local dev will fail if no Redis URL is provided.",
          recommendedAction:
            "Set VEXT_REDIS_URL/REDIS_URL before starting, or use memory rateLimit store in local demos that do not require multi-process coordination.",
          affectedCapabilityIds: ["C12", "C20", "C28"],
        }),
      );
    }
    if (/const\s+\w+\s*=\s*createRedisCacheAdapter\s*\(/u.test(source)) {
      diagnostics.push(
        projectDiagnostic({
          severity: "warning",
          code: "VEXT_MCP_REDIS_ADAPTER_EAGER_CONFIG",
          sourceFile: relative,
          message:
            "A Redis cache adapter appears to be created at module scope in config.",
          recommendedAction:
            "Prefer lazy config factories or documented runtime env guards so static config loading and MCP inspection do not imply external connections.",
          affectedCapabilityIds: ["C12", "C19", "C21"],
        }),
      );
    }
    if (/image\/svg\+xml/u.test(source)) {
      diagnostics.push(
        projectDiagnostic({
          severity: "info",
          code: "VEXT_MCP_UPLOAD_SVG_REVIEW",
          sourceFile: relative,
          message:
            "SVG upload is allowed by config and may require an explicit sanitizer or private serving boundary.",
          recommendedAction:
            "Keep SVG disabled for public uploads unless the route sanitizes content and serves it with the intended security headers.",
          affectedCapabilityIds: ["C21", "C22"],
        }),
      );
    }
  }
}

function collectFrontendDiagnostics(
  rootDir: string,
  diagnostics: VextMcpProjectDiagnostic[],
): void {
  for (const relative of collectProjectSourceFiles(
    rootDir,
    "src/frontend",
    160,
  )) {
    const source = readProjectSourceText(rootDir, relative, diagnostics);
    if (!source) continue;
    if (
      /<form[\s\S]{0,1000}\bmethod=["']post["'][\s\S]{0,1000}\baction=["']\/api/u.test(
        source,
      )
    ) {
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
  rootDir: string,
  diagnostics: VextMcpProjectDiagnostic[],
): void {
  for (const relative of collectProjectSourceFiles(rootDir, "test", 120)) {
    const source = readProjectSourceText(rootDir, relative, diagnostics);
    if (!source) continue;
    if (
      /\bexpect\s*\(\s*(?:true|1)\s*\)\s*\.toBe\s*\(\s*(?:true|1)\s*\)/u.test(
        source,
      )
    ) {
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

function hasRedisRateLimitStore(source: string): boolean {
  return (
    /\brateLimit\s*:/u.test(source) &&
    /(?:\bstore\s*:\s*["']redis["']|\btype\s*:\s*["']redis["'])/u.test(source)
  );
}

function collectProjectSourceFiles(
  rootDir: string,
  relativeDir: string,
  limit: number,
): string[] {
  const dir = path.join(rootDir, relativeDir);
  const files: string[] = [];
  const stack = [dir];
  while (stack.length && files.length < limit) {
    const current = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    entries.sort();
    for (const entry of entries) {
      const full = path.join(current, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        if (!["node_modules", "dist", ".git", ".vext"].includes(entry)) {
          stack.push(full);
        }
        continue;
      }
      if (SOURCE_FILE_PATTERN.test(entry) || entry.endsWith(".json")) {
        files.push(toProjectRelative(rootDir, full));
        if (files.length >= limit) break;
      }
    }
  }
  return files;
}

function readProjectSourceText(
  rootDir: string,
  relative: string,
  diagnostics: VextMcpProjectDiagnostic[],
): string | null {
  const absolute = path.join(rootDir, relative);
  try {
    const stats = statSync(absolute);
    if (stats.size > PROJECT_DIAGNOSTIC_MAX_FILE_BYTES) {
      diagnostics.push(
        projectDiagnostic({
          severity: "info",
          code: "VEXT_MCP_DIAGNOSTIC_FILE_SKIPPED",
          sourceFile: relative,
          message: `${relative} is larger than the MCP static diagnostic file budget.`,
          recommendedAction:
            "Run host-side focused checks for this file if it is part of the current change.",
          affectedCapabilityIds: ["C27", "C28"],
        }),
      );
      return null;
    }
    return readFileSync(absolute, "utf8");
  } catch {
    return null;
  }
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
    const manifest = readJsonObject(absolute);
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

function readPackageDiagnostics(rootDir: string): VextMcpProjectDiagnostic[] {
  const packageJson = readJsonObject(path.join(rootDir, "package.json"));
  if (!packageJson || !isRecord(packageJson.scripts)) return [];
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
  diagnostic: VextMcpProjectDiagnostic,
): VextMcpProjectDiagnostic {
  return diagnostic;
}

function toProjectRelative(rootDir: string, absolute: string): string {
  return path.relative(rootDir, absolute).split(path.sep).join("/");
}

function readJsonObject(file: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as unknown;
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
