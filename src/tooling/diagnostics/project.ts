import { StaticModuleGraph } from "../project-index/static-module-graph.js";
import { buildProjectIndexFromSourceView } from "../project-index/index.js";
import { projectConventionSourceView } from "../project-index/source-input.js";
import { analyzeIndexedServiceDependencies } from "./service-deps.js";
import { inspectRouteFacts } from "../project-index/route-facts.js";
import { wrappedRequestSchemaLocations } from "../project-index/request-schema.js";
import { projectStaticConfig } from "../project-index/config-projection.js";
import type { SourceView } from "../source-view/types.js";
import {
  isInRole,
  type ResolvedAssistantRole,
} from "../project-index/roles.js";
import { PROJECT_DIAGNOSTIC_RULES } from "./project-rules.js";
import type {
  ProjectStaticDiagnostic,
  ProjectDiagnosticMetadata,
} from "./contracts.js";
import { parseSourceSyntax } from "../../lib/source-syntax.js";
import { shouldIncludeRouteFilePath } from "../../lib/route-file-policy.js";
import path from "node:path";

const ASSISTANT_SOURCE_ROOT = "project";
const SOURCE_FILE_PATTERN = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/u;
interface DiagnosticContext {
  view: SourceView;
  roles: readonly ResolvedAssistantRole[];
}

/** 只分析封存字节，不读取磁盘、不执行配置或业务代码。 */
export function collectProjectStaticDiagnostics(
  view: SourceView,
  roles: readonly ResolvedAssistantRole[],
  options: { includeDependencies?: boolean } = {},
): ProjectStaticDiagnostic[] {
  const diagnostics: ProjectStaticDiagnostic[] = [];
  const context = { view, roles };
  collectRouteDiagnostics(context, diagnostics);
  collectConfigDiagnostics(context, diagnostics);
  collectModuleSyntaxDiagnostics(context, diagnostics);
  if (options.includeDependencies !== false)
    collectServiceDependencyDiagnostics(context, diagnostics);
  return diagnostics;
}

function collectRouteDiagnostics(
  context: DiagnosticContext,
  diagnostics: ProjectStaticDiagnostic[],
): void {
  const graph = new StaticModuleGraph(context.view);
  for (const relative of collectProjectSourceFiles(context, "src/routes")) {
    const root = context.view
      .roots()
      .find((item) => item.id === ASSISTANT_SOURCE_ROOT)!;
    const routeDirectory =
      context.roles.find((role) => role.id === "routes")?.path ?? "src/routes";
    if (
      !shouldIncludeRouteFilePath(
        path.join(root.realPath, relative),
        path.join(root.realPath, routeDirectory),
      )
    )
      continue;
    const source = context.view.read(ASSISTANT_SOURCE_ROOT, relative);
    if (!source) continue;
    const facts = inspectRouteFacts(relative, source, {
      graph,
      rootId: ASSISTANT_SOURCE_ROOT,
    });
    if (facts.state !== "complete") {
      diagnostics.push(
        projectDiagnostic({
          severity: facts.state === "invalid" ? "error" : "info",
          code:
            facts.state === "invalid"
              ? "VEXT_MCP_SOURCE_SYNTAX_ERROR"
              : "VEXT_MCP_ROUTE_ANALYSIS_UNKNOWN",
          sourceFile: relative,
          message: facts.reason ?? "Route analysis is incomplete.",
          recommendedAction:
            "Inspect the reported source and run the matching host-side typecheck/doctor check.",
        }),
      );
    }
    for (const route of facts.routes) {
      const label = `${route.method} ${route.subPath ?? "(dynamic)"} at offset ${route.start}`;
      const validation = route.fields.validate;
      for (const location of wrappedRequestSchemaLocations(
        validation?.state === "known" ? validation.value : undefined,
      ))
        diagnostics.push(
          projectDiagnostic({
            severity: "warning",
            code: "VEXT_MCP_REQUEST_SCHEMA_BOUNDARY_REVIEW",
            sourceFile: relative,
            message: `${label}: validate.${location} looks like a whole-object JSON Schema; the default Vext request validator treats this position as a DSL field map.`,
            recommendedAction:
              "Use DSL fields/required markers, or verify the explicitly installed custom validator with real request tests. Do not confuse this boundary with responses schemas.",
          }),
        );
      if (route.deprecatedDocsTags)
        diagnostics.push(
          projectDiagnostic({
            severity: "warning",
            code: "VEXT_MCP_DEPRECATED_DOCS_TAGS",
            sourceFile: relative,
            message: `${label}: Route docs.tags is deprecated and ignored; tags are inferred from the route path/source.`,
            recommendedAction:
              "Remove docs.tags and use path/source grouping or OpenAPI tagGroups when an explicit group is required.",
          }),
        );
      if (route.returnsJson && route.responses === "absent")
        diagnostics.push(
          projectDiagnostic({
            severity: "warning",
            code: "VEXT_MCP_ROUTE_RESPONSE_SCHEMA_MISSING",
            sourceFile: relative,
            message: `${label}: JSON handler has no top-level RouteOptions.responses schema.`,
            recommendedAction:
              "Declare runtime responses for this route; docs.responses and another route's schema do not provide its runtime contract.",
          }),
        );
      if (route.responses === "invalid")
        diagnostics.push(
          projectDiagnostic({
            severity: "error",
            code: "VEXT_MCP_ROUTE_RESPONSE_SCHEMA_INVALID",
            sourceFile: relative,
            message: `${label}: RouteOptions.responses must be a status-to-schema object.`,
            recommendedAction:
              "Use the framework runtime response schema contract.",
          }),
        );
      if (
        route.responses === "unknown" ||
        (route.returnsJson === null && route.responses === "absent")
      )
        diagnostics.push(
          projectDiagnostic({
            severity: "info",
            code: "VEXT_MCP_ROUTE_ANALYSIS_UNKNOWN",
            sourceFile: relative,
            message: `${label}: Handler or response contract cannot be determined statically.`,
            recommendedAction:
              "Resolve the contract through declared source imports or provide host-side runtime/type evidence.",
          }),
        );
    }
  }
}

const SYNTAX_DOMAINS = {
  services: "services",
  plugins: "plugins",
  models: "models",
  middlewares: "middlewares",
  jobs: "jobs",
  locales: "i18n",
  frontend: "frontend",
} as const;

function collectServiceDependencyDiagnostics(
  context: DiagnosticContext,
  diagnostics: ProjectStaticDiagnostic[],
): void {
  const root = context.view
    .roots()
    .find((item) => item.id === ASSISTANT_SOURCE_ROOT);
  if (!root) return;
  const options = {
    directories: {
      service: context.roles.find((role) => role.id === "services")?.path,
      plugin: context.roles.find((role) => role.id === "plugins")?.path,
    },
  };
  try {
    const view = projectConventionSourceView(
      context.view,
      root.realPath,
      options,
    );
    const report = analyzeIndexedServiceDependencies(
      buildProjectIndexFromSourceView(root.realPath, view, options),
    );
    for (const item of report.diagnostics) {
      if (item.level === "info") continue;
      diagnostics.push(
        projectDiagnostic({
          severity: item.level === "warn" ? "warning" : "error",
          code:
            item.level === "error"
              ? "VEXT_MCP_SERVICE_DEPENDENCY_INVALID"
              : "VEXT_MCP_SERVICE_DEPENDENCY_ANALYSIS_INCOMPLETE",
          sourceFile: path
            .relative(root.realPath, item.sourceFile)
            .replaceAll("\\", "/"),
          message: item.message,
          recommendedAction:
            "Review the indicated dependency paths and run the project's service/type checks.",
        }),
      );
    }
  } catch (error) {
    diagnostics.push(
      projectDiagnostic({
        severity: "info",
        code: "VEXT_MCP_SERVICE_DEPENDENCY_ANALYSIS_INCOMPLETE",
        message: String(error),
        recommendedAction:
          "Resolve service source syntax or unsupported static access before accepting this dependency analysis.",
      }),
    );
  }
}

function collectModuleSyntaxDiagnostics(
  context: DiagnosticContext,
  diagnostics: ProjectStaticDiagnostic[],
): void {
  for (const [role, domain] of Object.entries(SYNTAX_DOMAINS)) {
    for (const record of domainSourceFiles(context.view, context.roles, role)) {
      if (
        !SOURCE_FILE_PATTERN.test(record.path) &&
        !record.path.endsWith(".json")
      )
        continue;
      try {
        const text = context.view.read(record.rootId, record.path)!;
        if (record.path.endsWith(".json"))
          JSON.parse(text.replace(/^\uFEFF/u, ""));
        else parseSourceSyntax(record.path, text);
      } catch (error) {
        diagnostics.push({
          ...projectDiagnostic({
            severity: "error",
            code: "VEXT_MCP_SOURCE_SYNTAX_ERROR",
            message: String(error),
            sourceFile:
              record.rootId === ASSISTANT_SOURCE_ROOT
                ? record.path
                : `@${record.rootId}/${record.path}`,
            recommendedAction:
              "Correct source syntax and run the matching host-side type or runtime validation.",
          }),
          domain,
        });
      }
    }
  }
}

export function domainSourceFiles(
  view: SourceView,
  roles: readonly ResolvedAssistantRole[],
  role: string,
) {
  const selected = roles.filter((item) =>
    role === "frontend" ? item.id.startsWith("frontend") : item.id === role,
  );
  return view
    .list()
    .filter(
      (file) =>
        selected.some((item) =>
          item.externalRootId
            ? file.rootId === item.externalRootId
            : file.rootId === ASSISTANT_SOURCE_ROOT &&
              isInRole(file.path, item.path),
        ) ||
        (role === "frontend" && file.role.startsWith("frontend")),
    );
}

function collectConfigDiagnostics(
  context: DiagnosticContext,
  diagnostics: ProjectStaticDiagnostic[],
): void {
  const config = projectStaticConfig(context.view);
  const sourceFile = config.sourceFiles.at(-1);
  const middleware = config.field("middlewares");
  const mcp = config.field("dev.mcp");
  if (
    mcp.state === "invalid" ||
    middleware.state === "invalid" ||
    (middleware.state === "known" &&
      middleware.value !== undefined &&
      !Array.isArray(middleware.value))
  )
    diagnostics.push(
      projectDiagnostic({
        severity: "error",
        code: "VEXT_MCP_CONFIG_INVALID",
        sourceFile,
        message:
          mcp.reason ??
          middleware.reason ??
          "config.middlewares must be an array.",
        recommendedAction: "Fix config syntax before starting the service.",
      }),
    );
  if (config.providerState === "unknown")
    diagnostics.push(
      projectDiagnostic({
        severity: "info",
        code: "VEXT_MCP_CONFIG_UNKNOWN",
        sourceFile,
        message:
          "Bootstrap provider output is unknown; MCP does not execute it.",
        recommendedAction:
          "Use host-side startup/config evidence for provider overrides.",
      }),
    );
  const enabled = config.field("rateLimit.enabled");
  const store = config.field("rateLimit.store");
  const storeType = config.field("rateLimit.store.type");
  const redis = store.value === "redis" || storeType.value === "redis";
  if (redis && enabled.value !== false) {
    const url = config.field("rateLimit.store.url");
    const uri = config.field("rateLimit.store.uri");
    const client = config.field("rateLimit.store.client");
    const target = [url, uri].find(
      (fact) =>
        fact.state === "known" &&
        fact.value !== undefined &&
        fact.value !== null,
    );
    if (
      target &&
      (typeof target.value !== "string" || target.value.length === 0)
    )
      diagnostics.push(
        projectDiagnostic({
          severity: "error",
          code: "VEXT_MCP_RATE_LIMIT_REDIS_TARGET_MISSING",
          sourceFile,
          message:
            "rateLimit.store Redis target must be a non-empty URL string or an explicit client.",
          recommendedAction:
            "Correct this store's target; another module's Redis URL does not configure rate limiting.",
        }),
      );
    else if (!target && !(client.state === "known" && client.value))
      diagnostics.push(
        projectDiagnostic({
          severity: "warning",
          code: "VEXT_MCP_RATE_LIMIT_REDIS_ENV_REQUIRED",
          sourceFile,
          message:
            "Rate limiting has no proven static Redis target. An explicit client or VEXT_REDIS_URL/REDIS_URL must be available at runtime.",
          recommendedAction:
            "Verify the rate-limit owner's runtime target before startup; unrelated Redis module settings do not satisfy it.",
        }),
      );
  }
  const database = config.field("database");
  if (
    database.state !== "absent" &&
    config.field("database.cursorSecret").state === "absent" &&
    config.field("database.cursorSecretWarning").state === "absent"
  )
    diagnostics.push(
      projectDiagnostic({
        severity: "info",
        code: "VEXT_MCP_DATABASE_CURSOR_SECRET_REVIEW",
        sourceFile,
        message: "Database config has no explicit cursor-secret policy.",
        recommendedAction:
          "Review cursor signing when cursor-based pagination is used; this is not proof of a startup failure.",
      }),
    );
}

function collectProjectSourceFiles(
  context: DiagnosticContext,
  defaultDirectory: string,
): string[] {
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

function projectDiagnostic(
  input: Omit<ProjectStaticDiagnostic, keyof ProjectDiagnosticMetadata>,
): ProjectStaticDiagnostic {
  const metadata = PROJECT_DIAGNOSTIC_RULES[input.code];
  if (!metadata) throw new Error("Unknown static diagnostic: " + input.code);
  return { ...metadata, ...input };
}
