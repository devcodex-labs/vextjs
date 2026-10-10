import { findWorkspaceSourceDeclarations } from "../tooling/project-index/workspace-sources.js";
import {
  inspectProjectDependencies,
  type ProjectDependencyFact,
} from "../tooling/project-index/dependencies.js";
import { createHash } from "node:crypto";
import { projectIdentityDigest } from "../lib/project/identity.js";
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { parse, type ParseError } from "jsonc-parser";
import { resolvePathInside } from "../lib/path-boundary.js";
import { readProjectFile } from "../lib/project/read-project-file.js";
import type { SourceLimits, SourceView } from "../tooling/source-view/types.js";
import {
  collectProjectAnalysisContext,
  ASSISTANT_SOURCE_ROOT,
} from "../tooling/project-index/analysis-source.js";
import {
  resolveAssistantRoles,
  isInRole,
} from "../tooling/project-index/roles.js";
import {
  resolveAssistantPolicy,
  applyAssistantDiagnosticPolicy,
} from "./policy.js";
import {
  inspectImplementationIdentity,
  type ImplementationIdentity,
} from "./implementation-identity.js";
import { inspectStaticJobs } from "./jobs-inspection.js";
import { redactRedisUrl } from "../lib/redis/config.js";
import {
  projectStaticConfig,
  type StaticConfigProjection,
} from "../tooling/project-index/config-projection.js";
import type { StaticFact } from "../tooling/project-index/static-values.js";
import {
  normalizeDevMcpConfig,
  normalizePolicyPatch,
  normalizeWorkspaceConfig,
  type NormalizedVextDevMcpConfig,
  type VextMcpConfigTarget,
  type VextAssistantWorkspaceConfig,
  type NormalizedVextAssistantPolicy,
  type VextAssistantPolicyPatch,
} from "./contracts.js";
import {
  collectVextProjectDiagnostics,
  type VextMcpProjectDiagnostic,
} from "./project-diagnostics.js";

export type {
  VextMcpProjectDiagnostic,
  VextMcpProjectDiagnosticSeverity,
} from "./project-diagnostics.js";

export type VextMcpSourceState =
  | "complete"
  | "metadata-only"
  | "partial"
  | "unavailable";

export interface VextMcpProjectIdentity {
  projectId: string;
  contextRevision: string | null;
  rootDir: string;
  packageName: string | null;
  packageVersion: string | null;
  frameworkVersion: string;
  sourceState: VextMcpSourceState;
  sourceRevision: string | null;
  implementationDigest: string | null;
  policyDigest: string;
  dependencyDigest: string;
}

export interface VextMcpProjectInspection {
  schemaVersion: 2;
  status: "ok";
  identity: VextMcpProjectIdentity;
  snapshot: {
    language: "ts" | "js" | "unknown";
    packageManager: string | null;
    frameworkDependency: string | null;
    sections: Record<string, VextMcpSectionSummary>;
  };
  dependencies: ProjectDependencyFact[];
  partitions: VextMcpSectionSummary[];
  structureDecisions: VextMcpStructureDecision[];
  assistant: VextMcpAssistantContext;
  policy: NormalizedVextAssistantPolicy;
  diagnostics: VextMcpProjectDiagnostic[];
  warnings: string[];
  implementation: ImplementationIdentity;
  analysis: {
    sourceMode: "auto" | "baseline";
    freshSourceRead: true;
    refreshRequested: boolean;
    runtimeVerified: false;
  };
}

export interface VextMcpSectionSummary {
  section: string;
  state: "known" | "not-detected" | "unknown";
  actualPath: string | null;
  defaultPath: string;
  resolvedPath: string;
  runtimePath: string | null;
  readRootId: string;
  loading: import("../tooling/project-index/roles.js").AssistantRoleMode;
  fileCount: number;
  notes: string[];
}

export interface VextMcpStructureDecision {
  role: string;
  actualPath: string | null;
  defaultPath: string;
  editable: boolean;
  source: "actual" | "default" | "policy";
  notes: string[];
}

export interface VextMcpAssistantContext {
  contractVersion: 1;
  devMcp: NormalizedVextDevMcpConfig;
  devMcpSources: string[];
  devMcpState: StaticFact["state"];
  workspace: {
    rootDir: string;
    path: string;
    digest: string;
    config: VextAssistantWorkspaceConfig;
    policyDefaultsDigest: string | null;
  } | null;
}

const inspectionRoles = new WeakMap<
  VextMcpProjectInspection,
  readonly import("../tooling/project-index/roles.js").ResolvedAssistantRole[]
>();
export function getInspectionRoles(project: VextMcpProjectInspection) {
  return inspectionRoles.get(project);
}

const inspectionSources = new WeakMap<VextMcpProjectInspection, SourceView>();
const inspectionConfig = new WeakMap<
  VextMcpProjectInspection,
  StaticConfigProjection
>();

export function getInspectionConfig(
  project: VextMcpProjectInspection,
): StaticConfigProjection | undefined {
  return inspectionConfig.get(project);
}

/** 内部消费者复用封存字节；源码视图不会序列化进 MCP 响应。 */
export function getInspectionSources(
  project: VextMcpProjectInspection,
): SourceView | undefined {
  return inspectionSources.get(project);
}

export async function inspectVextProject(input: {
  rootDir: string;
  frameworkVersion: string;
  signal?: AbortSignal;
  limits?: Partial<SourceLimits>;
  policyPatch?: VextAssistantPolicyPatch;
  sourceMode?: "auto" | "baseline";
  configTarget?: VextMcpConfigTarget;
  refresh?: boolean;
}): Promise<VextMcpProjectInspection> {
  const rootDir = realpathSync(path.resolve(input.rootDir));
  const warnings: string[] = [];
  const implementation = inspectImplementationIdentity();
  if (implementation.state !== "current")
    warnings.push(
      "Installed MCP implementation changed or cannot be verified. Restart MCP before generating or validating changes.",
    );
  const workspace = readWorkspaceConfig(rootDir, warnings);
  const policy = resolveAssistantPolicy(
    workspace?.config.policyDefaults,
    input.policyPatch,
  );
  let roles = resolveAssistantRoles(policy.patch);
  let sourceView: SourceView | undefined;
  try {
    const context = await collectProjectAnalysisContext(rootDir, {
      ...input,
      roles,
      workspace: workspace?.config,
    });
    sourceView = context.view;
    roles = context.roles;
  } catch (error) {
    if (input.signal?.aborted) throw error;
    sourceView = undefined;
    warnings.push(errorMessage(error));
  }
  const packageJson = sourceView
    ? parseJsonObject(sourceView.read(ASSISTANT_SOURCE_ROOT, "package.json"))
    : null;
  if (!packageJson) warnings.push("package.json is missing or invalid.");
  const packageName = readString(packageJson?.name);
  const packageVersion = readString(packageJson?.version);
  const frameworkDependency = detectFrameworkDependency(packageJson);
  const language = detectLanguage(
    sourceView,
    roles
      .filter((role) => role.id.startsWith("frontend"))
      .map((role) => role.path),
  );
  const packageManager = detectPackageManager(packageJson, sourceView);
  const dependencies = inspectProjectDependencies(
    rootDir,
    packageJson,
    input.signal,
  );
  const configProjection = sourceView
    ? projectStaticConfig(sourceView, {
        mode:
          input.configTarget === "production" ? "production" : "development",
      })
    : undefined;
  if (configProjection) warnings.push(...configProjection.warnings);
  const assistant = sourceView
    ? inspectAssistantContext(rootDir, warnings, sourceView, configProjection!)
    : {
        contractVersion: 1 as const,
        devMcp: disabledDevMcpConfig(),
        devMcpSources: [],
        devMcpState: "unknown" as const,
        workspace,
      };
  if (assistant.workspace?.digest !== workspace?.digest) {
    sourceView = undefined;
    warnings.push(
      "Workspace policy changed during source collection. Inspect again.",
    );
  }
  const sections: Record<string, VextMcpSectionSummary> = {};
  const structureDecisions: VextMcpStructureDecision[] = [];
  for (const definition of roles) {
    const { id: role, defaultPath, mode } = definition;
    let exists = false;
    try {
      const absolute = definition.externalRootId
        ? definition.runtimePath!
        : resolvePathInside(rootDir, definition.path, "MCP role", {
            realpath: true,
          });
      exists = existsSync(absolute) && statSync(absolute).isDirectory();
    } catch (error) {
      warnings.push(errorMessage(error));
    }
    const section: VextMcpSectionSummary = {
      section: role,
      state:
        sourceView && !definition.unresolved
          ? exists
            ? "known"
            : "not-detected"
          : "unknown",
      actualPath: exists
        ? definition.externalRootId
          ? definition.runtimePath!
          : definition.path
        : null,
      runtimePath: definition.runtimePath ?? null,
      readRootId: definition.externalRootId ?? ASSISTANT_SOURCE_ROOT,
      defaultPath,
      resolvedPath: definition.path,
      loading: mode,
      fileCount:
        sourceView
          ?.list()
          .filter((file) =>
            definition.externalRootId
              ? file.rootId === definition.externalRootId
              : file.rootId === ASSISTANT_SOURCE_ROOT &&
                isInRole(file.path, definition.path),
          ).length ?? 0,
      notes: [
        definition.purpose,
        ...roleNotes(role, exists),
        ...(definition.unresolved ? [definition.unresolved] : []),
        ...(definition.externalRootId
          ? [
              "Configured external source root is read-only and cannot receive generated candidates.",
            ]
          : []),
      ],
    };
    if (definition.source === "policy" && mode === "loader") {
      section.notes.push(
        "Policy selects source placement; verify the matching runtime loader/config or explicit import. Policy alone does not reconfigure the framework.",
      );
    }
    sections[role] = section;
    structureDecisions.push({
      role,
      actualPath: section.actualPath,
      defaultPath,
      editable: definition.candidate,
      source:
        definition.source === "policy"
          ? "policy"
          : exists
            ? "actual"
            : "default",
      notes: section.notes,
    });
  }
  const hasConfig =
    sections.config?.state === "known" &&
    configProjection?.sourceFiles.some((file) =>
      /^src\/config\/default\.(?:ts|js|mjs|cjs)$/u.test(file),
    );
  const hasSource = existsSync(path.join(rootDir, "src"));
  const workspaceInvalid =
    !assistant.workspace &&
    !!sourceView
      ?.list()
      .some(
        (file) =>
          (file.rootId === ASSISTANT_SOURCE_ROOT ||
            file.rootId === "workspace") &&
          /^vext\.workspace\.jsonc?$/u.test(file.path),
      );
  const sourceState: VextMcpSourceState = !sourceView
    ? "partial"
    : packageJson
      ? hasSource &&
        hasConfig &&
        !workspaceInvalid &&
        !roles.some((role) => role.unresolved)
        ? "complete"
        : hasSource
          ? "partial"
          : "metadata-only"
      : "unavailable";
  const identityInput = JSON.stringify({
    rootDir,
    packageName,
    packageVersion,
    frameworkDependency,
    frameworkVersion: input.frameworkVersion,
    sourceState,
    language,
    assistant,
    sourceRevision: sourceView?.revision ?? null,
    implementation,
    policyDigest: policy.digest,
    roles: roles.map(({ id, path, runtimePath, source, unresolved }) => ({
      id,
      path,
      runtimePath,
      source,
      unresolved,
    })),
    dependencyDigest: dependencies.digest,
    sections: Object.fromEntries(
      Object.entries(sections).map(([key, value]) => [key, value.fileCount]),
    ),
  });
  const projectId = projectIdentityDigest(rootDir, packageName);
  const contextRevision =
    sourceState === "complete" ? sha256(identityInput) : null;
  const diagnostics = applyAssistantDiagnosticPolicy(
    sourceView
      ? collectVextProjectDiagnostics(rootDir, sourceView, roles, {
          includeGenerated: input.sourceMode !== "baseline",
          configTarget: input.configTarget,
        })
      : [],
    policy,
  );
  const result: VextMcpProjectInspection = {
    schemaVersion: 2,
    status: "ok",
    identity: {
      projectId,
      contextRevision,
      rootDir,
      packageName,
      packageVersion,
      frameworkVersion: input.frameworkVersion,
      sourceState,
      sourceRevision: sourceView?.revision ?? null,
      implementationDigest: implementation.loadedDigest,
      policyDigest: policy.digest,
      dependencyDigest: dependencies.digest,
    },
    snapshot: {
      language,
      packageManager,
      frameworkDependency,
      sections,
    },
    dependencies: dependencies.facts,
    partitions: Object.values(sections),
    structureDecisions,
    assistant,
    policy,
    diagnostics,
    warnings,
    implementation,
    analysis: {
      sourceMode: input.sourceMode ?? "auto",
      freshSourceRead: true,
      refreshRequested: input.refresh === true,
      runtimeVerified: false,
    },
  };
  if (sourceView) inspectionSources.set(result, sourceView);
  inspectionRoles.set(result, roles);
  if (configProjection) inspectionConfig.set(result, configProjection);
  return result;
}

export function resolveMcpProjectRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  while (true) {
    if (existsSync(path.join(dir, "package.json"))) return realpathSync(dir);
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`[vextjs] Cannot find package.json from ${startDir}.`);
    }
    dir = parent;
  }
}

const inspectionJobs = new WeakMap<
  VextMcpProjectInspection,
  ReturnType<typeof readVextProjectJobDetails>
>();
export function inspectVextProjectJobDetails(
  project: VextMcpProjectInspection,
) {
  let result = inspectionJobs.get(project);
  if (!result) {
    result = readVextProjectJobDetails(project);
    inspectionJobs.set(project, result);
  }
  return result;
}

function readVextProjectJobDetails(project: VextMcpProjectInspection) {
  const view = getInspectionSources(project);
  const projection = getInspectionConfig(project);
  if (!view || !projection)
    return {
      jobs: [],
      fileCount: 0,
      truncated: false,
      sourceState: "unknown",
      config: null,
      operations: ["vext start", "vext dev"],
      deploymentNotes: createJobDeploymentNotes(),
      warnings: ["Jobs source/configuration is unavailable."],
      readiness: {
        projectState: "unknown" as const,
        missingPrerequisites: ["Inspect complete project sources."],
        runtimeVerified: false,
      },
    };
  const result = inspectStaticJobs(view, projection, project.identity.rootDir);
  return {
    ...result,
    jobs: result.jobs.map(({ definition: _definition, ...job }) => job),
    truncated: false,
    config: { ...result.config, redis: summarizeJobRedis(result.config.redis) },
    operations: ["vext start", "vext dev"],
    deploymentNotes: createJobDeploymentNotes(),
  };
}

function inspectAssistantContext(
  rootDir: string,
  warnings: string[],
  sourceView: SourceView,
  configProjection: StaticConfigProjection,
): VextMcpAssistantContext {
  const devMcp = readStaticDevMcp(configProjection, warnings);
  const normalizedDevMcp = normalizeDevMcpConfig(devMcp.value, {
    declared: devMcp.declared,
  });
  const finalDevMcp = normalizedDevMcp.ok
    ? normalizedDevMcp.value
    : disabledDevMcpConfig();
  if (!normalizedDevMcp.ok) {
    warnings.push(`dev.mcp is invalid: ${normalizedDevMcp.failure.message}`);
  } else {
    warnings.push(
      ...normalizedDevMcp.warnings.map((item) => `dev.mcp: ${item}`),
    );
  }
  return {
    contractVersion: 1,
    devMcp: finalDevMcp,
    devMcpSources: devMcp.sources,
    devMcpState: normalizedDevMcp.ok ? devMcp.state : "invalid",
    workspace: readWorkspaceConfig(rootDir, warnings, sourceView),
  };
}

function disabledDevMcpConfig(): NormalizedVextDevMcpConfig {
  const normalized = normalizeDevMcpConfig(undefined, { declared: false });
  if (!normalized.ok) {
    throw new Error("Internal dev.mcp disabled defaults must be valid.");
  }
  return normalized.value;
}

function readStaticDevMcp(
  projection: StaticConfigProjection,
  warnings: string[],
): {
  declared: boolean;
  value: unknown;
  sources: string[];
  state: StaticFact["state"];
} {
  const fact = projection.field("dev.mcp");
  if (fact.state === "unknown" || fact.state === "invalid")
    warnings.push(
      `dev.mcp is ${fact.state}: ${fact.reason ?? "runtime evidence is required"}.`,
    );
  return {
    declared: fact.state !== "absent",
    value: fact.state === "known" ? fact.value : undefined,
    sources: fact.state === "absent" ? [] : fact.sourceRefs,
    state: fact.state,
  };
}

function readWorkspaceConfig(
  rootDir: string,
  warnings: string[],
  sourceView?: SourceView,
): VextMcpAssistantContext["workspace"] {
  let declaration: ReturnType<typeof findWorkspaceSourceDeclarations>;
  try {
    declaration = findWorkspaceSourceDeclarations(rootDir);
  } catch (error) {
    warnings.push(errorMessage(error));
    return null;
  }
  if (!declaration) return null;
  const workspaceRootDir = declaration.rootDir;
  for (const relative of [declaration.file]) {
    const absolute = path.join(workspaceRootDir, relative);
    if (!existsSync(absolute)) continue;
    let raw: string;
    try {
      const text = sourceView
        ? sourceView.read(
            workspaceRootDir === rootDir ? ASSISTANT_SOURCE_ROOT : "workspace",
            relative,
          )
        : readProjectFile(
            workspaceRootDir,
            relative,
            2 * 1024 * 1024,
          )?.toString("utf8");
      if (text === undefined) continue;
      raw = text;
    } catch (error) {
      warnings.push(`${relative} cannot be read: ${errorMessage(error)}.`);
      return null;
    }
    const errors: ParseError[] = [];
    const parsed = parse(raw, errors, {
      allowTrailingComma: true,
      disallowComments: false,
    }) as unknown;
    if (errors.length) {
      warnings.push(`${relative} contains invalid JSONC.`);
      return null;
    }
    const normalized = normalizeWorkspaceConfig(parsed);
    if (!normalized.ok) {
      warnings.push(`${relative} is invalid: ${normalized.failure.message}`);
      return null;
    }
    warnings.push(...normalized.warnings.map((item) => `${relative}: ${item}`));
    return {
      rootDir: workspaceRootDir,
      path: relative,
      digest: sha256(JSON.stringify(normalized.value)),
      config: normalized.value,
      policyDefaultsDigest: readPolicyDefaultsDigest(parsed),
    };
  }
  return null;
}

function readPolicyDefaultsDigest(value: unknown): string | null {
  if (!isRecord(value) || value.policyDefaults === undefined) return null;
  const normalized = normalizePolicyPatch(value.policyDefaults);
  return normalized.ok ? normalized.value.digest : null;
}

function summarizeJobRedis(value: unknown) {
  const config = summarizeRecord(value);
  if (!config) return null;
  for (const key of ["url", "uri"])
    if (typeof config[key] === "string")
      config[key] = redactRedisUrl(config[key]);
  return config;
}

function createJobDeploymentNotes(): string[] {
  return [
    "Scheduled jobs start automatically after application readiness; no separate scheduler or worker process is required.",
    "Active jobs in built-in Cluster require config.jobs.redis at startup. Multiple hosts must share Redis. Namespace is automatic from package name/profile/runtime mode; matching replicas need no explicit value.",
    "Redis coordinates each scheduled point and renews running leases; failures pause triggers without a local fallback. No retries, downtime catch-up or immediate startup execution are provided.",
    "MCP reads source and static configuration only; it never starts timers or executes handlers.",
  ];
}

function summarizeRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean" ||
      item === null
    ) {
      result[key] = item;
    } else if (Array.isArray(item)) {
      const strings = readStringArray(item);
      if (strings) result[key] = strings;
    }
  }
  return result;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter(
    (item): item is string => typeof item === "string",
  );
  return items.length === value.length ? items : null;
}

function detectLanguage(
  sourceView: SourceView | undefined,
  frontendDirectories: string[],
): "ts" | "js" | "unknown" {
  if (!sourceView) return "unknown";
  // 声明文件、测试与前端 TS 不要求后端使用 TS；无需第二次磁盘扫描。
  const backend = sourceView
    .list({ rootId: ASSISTANT_SOURCE_ROOT })
    .filter(
      (file) =>
        file.path.startsWith("src/") &&
        !frontendDirectories.some((directory) =>
          isInRole(file.path, directory),
        ) &&
        !file.path.startsWith("src/preload/") &&
        !/\.(?:d\.[cm]?ts|test\.[cm]?[jt]s|spec\.[cm]?[jt]s)$/u.test(file.path),
    );
  return backend.some((file) => /\.[cm]?ts$/u.test(file.path)) ? "ts" : "js";
}

function detectPackageManager(
  manifest: Record<string, unknown> | null,
  view: SourceView | undefined,
): string | null {
  const declared =
    typeof manifest?.packageManager === "string"
      ? manifest.packageManager.split("@")[0]
      : undefined;
  if (declared && ["npm", "pnpm", "yarn", "bun"].includes(declared))
    return declared;
  const detected = [
    ["pnpm", "pnpm-lock.yaml"],
    ["yarn", "yarn.lock"],
    ["bun", "bun.lock"],
    ["npm", "package-lock.json"],
  ].filter(([, file]) => view?.record(ASSISTANT_SOURCE_ROOT, file!));
  return detected.length === 1 ? detected[0]![0]! : null;
}

function detectFrameworkDependency(
  packageJson: Record<string, unknown> | null,
): string | null {
  const fields = ["dependencies", "devDependencies", "peerDependencies"];
  for (const field of fields) {
    const deps = packageJson?.[field];
    if (deps && typeof deps === "object" && !Array.isArray(deps)) {
      const value = (deps as Record<string, unknown>).vextjs;
      if (typeof value === "string") return value;
    }
  }
  return packageJson?.name === "vextjs" ? "workspace-self" : null;
}

function roleNotes(role: string, exists: boolean): string[] {
  if (!exists)
    return [
      "Default path is available as a recommendation; it is not created automatically.",
    ];
  if (role === "locales")
    return [
      "Locales may be grouped by feature module and nested subdirectory.",
    ];
  if (role === "jobs")
    return [
      "Scheduled job definitions are discovered without starting timers.",
    ];
  if (role === "docs")
    return [
      "Docs/OpenAPI source is inspected statically; runtime endpoints are not requested.",
    ];
  return [];
}

function parseJsonObject(
  source: string | undefined,
): Record<string, unknown> | null {
  if (source === undefined) return null;
  try {
    const value: unknown = JSON.parse(source.replace(/^\uFEFF/u, ""));
    return isRecord(value) ? value : null;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
