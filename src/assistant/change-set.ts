import { createHash } from "node:crypto";
import { findRecipe, validateRecipeOptions } from "./recipe-registry.js";
import { RecipeContext, RecipeInputError } from "./recipe-context.js";
import { renderBackendRecipe } from "./recipes-backend.js";
import { renderFrontendRecipe } from "./recipes-frontend.js";
import { renderSupportRecipe } from "./recipes-support.js";
import { isBuiltin } from "node:module";
import { collectProjectStaticDiagnostics } from "../tooling/diagnostics/project.js";
import { inspectSourceQuality } from "../tooling/diagnostics/code-quality.js";
import { isPathInside } from "../lib/path-boundary.js";
import { existsSync } from "node:fs";
import { canonicalPath, resolvePathInside } from "../lib/path-boundary.js";
import { parseSourceSyntax } from "../lib/source-syntax.js";
import { normalizeSourcePath } from "../tooling/source-view/policy.js";
import { overlaySourceView } from "../tooling/source-view/view.js";
import type { SourceChange } from "../tooling/source-view/types.js";
import { ASSISTANT_SOURCE_ROOT } from "../tooling/project-index/analysis-source.js";
import { inspectRouteFacts } from "../tooling/project-index/route-facts.js";
import { analyzeCandidateOverlay } from "./candidate-analysis.js";
import path from "node:path";
import type {
  VextGenerateChangesInput,
  VextValidateChangesInput,
} from "./contracts.js";
import {
  getInspectionSources,
  getInspectionRoles,
  type VextMcpProjectInspection,
} from "./project-inspector.js";
import { ASSISTANT_ROLES } from "../tooling/project-index/roles.js";

export interface VextMcpChangeSetFile {
  path: string;
  action: "create";
  encoding: "utf8";
  content: string;
  sha256?: string;
  reason: string;
}

export interface VextMcpChangeSet {
  schemaVersion: 2;
  kind: "change-set";
  recipeId: string;
  recipeTitle: string;
  name: string;
  baseIdentity: {
    projectId: string;
    contextRevision: string | null;
  };
  files: VextMcpChangeSetFile[];
  warnings: string[];
  scaffold: boolean;
  prerequisites: string[];
  requiredHostSteps: string[];
}

export interface VextMcpChangeSetResult {
  status: "ready" | "unsupported" | "invalid" | "incomplete";
  changeSet?: VextMcpChangeSet;
  diagnostics: string[];
  missingEvidence: string[];
}

export interface VextMcpValidationFileResult {
  path: string | null;
  verdict: "valid" | "invalid";
  directory?: VextMcpCandidateDirectory;
  issues: string[];
}

export interface VextMcpCandidateDirectory {
  prefix: string;
  source:
    | "default"
    | "project-section"
    | "workspace-service"
    | "workspace-shared-package";
  role?: string;
  serviceId?: string;
  packageId?: string;
  packageKind?: string;
}

export interface VextMcpValidationResult {
  verdict: "valid" | "invalid" | "incomplete";
  staticVerdict: "valid" | "invalid" | "incomplete";
  applyReady: boolean;
  configTarget: VextValidateChangesInput["configTarget"];
  missingEvidence: string[];
  diagnostics: string[];
  fileCount: number;
  files: VextMcpValidationFileResult[];
  allowedDirectories: VextMcpCandidateDirectory[];
  requiredHostSteps: string[];
}

const CANDIDATE_ROLES = ASSISTANT_ROLES.filter((role) => role.candidate);
const DEFAULT_CANDIDATE_SECTION_ROLES = CANDIDATE_ROLES.map((role) => role.id);
const DEFAULT_SERVICE_CANDIDATE_PATHS = CANDIDATE_ROLES.map(
  (role) => role.defaultPath,
);

export function generateMcpChangeSet(
  input: VextGenerateChangesInput,
  project: VextMcpProjectInspection,
): VextMcpChangeSetResult {
  const recipe = findRecipe(input.recipeId);
  if (!recipe)
    return {
      status: "unsupported",
      diagnostics: [`Unknown recipe: ${input.recipeId}.`],
      missingEvidence: [],
    };
  const issues = validateRecipeOptions(recipe, input.options);
  if (issues.length)
    return { status: "invalid", diagnostics: issues, missingEvidence: [] };
  if (
    input.expectedIdentity &&
    (input.expectedIdentity.projectId !== project.identity.projectId ||
      input.expectedIdentity.contextRevision !==
        project.identity.contextRevision)
  )
    return {
      status: "invalid",
      diagnostics: [
        "expectedIdentity does not match the current project context.",
      ],
      missingEvidence: [],
    };
  try {
    const context = new RecipeContext(input, project);
    const render =
      recipe.group === "backend"
        ? renderBackendRecipe
        : recipe.group === "frontend"
          ? renderFrontendRecipe
          : renderSupportRecipe;
    const files = render(recipe.name, context).map((file) => ({
      ...file,
      sha256: createHash("sha256").update(file.content, "utf8").digest("hex"),
    }));
    const changeSet: VextMcpChangeSet = {
      schemaVersion: 2,
      kind: "change-set",
      recipeId: recipe.id,
      recipeTitle: recipe.name,
      name: context.name,
      baseIdentity: {
        projectId: project.identity.projectId,
        contextRevision: project.identity.contextRevision,
      },
      files,
      scaffold: context.scaffold,
      prerequisites: context.prerequisites,
      warnings: context.warnings,
      requiredHostSteps: context.hostSteps(),
    };
    const validation = validateMcpChangeSet(changeSet, project);
    const missingEvidence = [
      ...validation.missingEvidence,
      ...(!project.identity.contextRevision
        ? ["Project source identity is incomplete."]
        : []),
    ];
    if (!validation.ok || missingEvidence.length)
      return {
        status: validation.ok ? "incomplete" : "invalid",
        diagnostics: validation.diagnostics,
        missingEvidence,
      };
    return { status: "ready", changeSet, diagnostics: [], missingEvidence: [] };
  } catch (error) {
    if (!(error instanceof RecipeInputError)) throw error;
    return {
      status: error.status,
      diagnostics: [error.message],
      missingEvidence: error.status === "incomplete" ? [error.message] : [],
    };
  }
}

export function validateMcpChangeSetInput(
  input: VextValidateChangesInput,
  project?: VextMcpProjectInspection,
): VextMcpValidationResult {
  const validation = input.changeSet
    ? validateMcpChangeSet(
        input.changeSet,
        project,
        input.profile,
        input.configTarget,
      )
    : input.files
      ? validateCandidateFiles(
          input.files,
          project,
          input.profile,
          input.configTarget,
        )
      : invalidCandidate("changeSet or files is required.");
  const complete =
    input.profile === "syntax" || project?.identity.sourceState === "complete";
  const identity =
    input.expectedIdentity ??
    (isRecord(input.changeSet?.baseIdentity)
      ? input.changeSet.baseIdentity
      : undefined);
  const identityBound =
    !!project &&
    identity?.projectId === project.identity.projectId &&
    typeof identity?.contextRevision === "string" &&
    identity.contextRevision === project.identity.contextRevision;
  if (input.expectedIdentity && !identityBound) {
    validation.ok = false;
    validation.diagnostics.push(
      "expectedIdentity does not match the current project context.",
    );
  }
  const staticVerdict = validation.ok
    ? complete && validation.missingEvidence.length === 0
      ? "valid"
      : "incomplete"
    : "invalid";
  return {
    verdict: staticVerdict,
    staticVerdict,
    applyReady:
      staticVerdict === "valid" && input.profile !== "syntax" && identityBound,
    configTarget: input.configTarget ?? "development",
    missingEvidence: validation.missingEvidence,
    diagnostics: validation.diagnostics,
    fileCount: validation.fileCount,
    files: validation.files,
    allowedDirectories: validation.allowedDirectories,
    requiredHostSteps: [
      ...(!identityBound
        ? [
            "Bind expectedIdentity or ChangeSet.baseIdentity to the inspected source context before applying.",
          ]
        : []),
      ...validation.requiredHostSteps,
    ],
  };
}

function validateMcpChangeSet(
  value: unknown,
  project?: VextMcpProjectInspection,
  profile: VextValidateChangesInput["profile"] = "standard",
  configTarget: VextValidateChangesInput["configTarget"] = "development",
): {
  ok: boolean;
  missingEvidence: string[];
  diagnostics: string[];
  fileCount: number;
  files: VextMcpValidationFileResult[];
  allowedDirectories: VextMcpCandidateDirectory[];
  requiredHostSteps: string[];
} {
  if (!isRecord(value)) return invalidCandidate("changeSet must be an object.");
  if (value.schemaVersion !== 2)
    return invalidCandidate("changeSet.schemaVersion must be 2.");
  if (value.kind !== "change-set")
    return invalidCandidate("changeSet.kind must be change-set.");
  if (!Array.isArray(value.files))
    return invalidCandidate("changeSet.files must be an array.");
  const validation = validateCandidateFiles(
    value.files,
    project,
    profile,
    configTarget,
  );
  const diagnostics = [...validation.diagnostics];
  if (project && isRecord(value.baseIdentity)) {
    if (value.baseIdentity.projectId !== project.identity.projectId) {
      diagnostics.push(
        "changeSet.baseIdentity.projectId does not match the current project.",
      );
    }
    if (
      value.baseIdentity.contextRevision !== project.identity.contextRevision
    ) {
      diagnostics.push(
        "changeSet.baseIdentity.contextRevision does not match the current project.",
      );
    }
  }
  return {
    ok: validation.ok && diagnostics.length === 0,
    missingEvidence: validation.missingEvidence,
    diagnostics,
    fileCount: validation.fileCount,
    files: validation.files,
    allowedDirectories: validation.allowedDirectories,
    requiredHostSteps: validation.requiredHostSteps,
  };
}

function validateCandidateFiles(
  files: unknown[],
  project?: VextMcpProjectInspection,
  profile: VextValidateChangesInput["profile"] = "standard",
  configTarget: VextValidateChangesInput["configTarget"] = "development",
): {
  ok: boolean;
  missingEvidence: string[];
  diagnostics: string[];
  fileCount: number;
  files: VextMcpValidationFileResult[];
  allowedDirectories: VextMcpCandidateDirectory[];
  requiredHostSteps: string[];
} {
  const allowedDirectories = candidateDirectoryPolicy(project);
  if (files.length < 1 || files.length > 50) {
    return invalidCandidate(
      "files must contain 1 to 50 entries.",
      files.length,
      allowedDirectories,
    );
  }
  const seen = new Set<string>();
  const overlayChanges: SourceChange[] = [];
  let totalBytes = 0;
  const diagnostics: string[] = [];
  const missingEvidence: string[] =
    project?.diagnostics
      .filter((item) => item.code === "VEXT_MCP_POLICY_RULE_UNRESOLVED")
      .map((item) => item.message) ?? [];
  const fileResults: VextMcpValidationFileResult[] = [];
  for (const file of files) {
    const fileIssues: string[] = [];
    if (!isRecord(file)) {
      const issue = "file entry must be an object.";
      diagnostics.push(issue);
      fileResults.push({ path: null, verdict: "invalid", issues: [issue] });
      continue;
    }
    if (file.action !== undefined && file.action !== "create") {
      fileIssues.push("Only create actions are supported in this batch.");
    }
    if (typeof file.path !== "string" || !isSafeRelativePath(file.path)) {
      fileIssues.push("file.path must be a safe relative path.");
      diagnostics.push(...fileIssues);
      fileResults.push({
        path: typeof file.path === "string" ? file.path : null,
        verdict: "invalid",
        issues: fileIssues,
      });
      continue;
    }
    const directory = findCandidateDirectory(file.path, allowedDirectories);
    if (!directory) {
      fileIssues.push(
        `${file.path} is outside supported Vext candidate directories.`,
      );
    }
    const protectedRole = (
      getInspectionRoles(project!) ??
      ASSISTANT_ROLES.map((role) => ({ ...role, path: role.defaultPath }))
    ).find(
      (role) =>
        (role.mode === "generated" || role.mode === "runtime") &&
        typeof file.path === "string" &&
        file.path.startsWith(role.path + "/"),
    );
    if (protectedRole)
      fileIssues.push(
        `${file.path} belongs to the protected ${protectedRole.id} role.`,
      );
    let identityPath = normalizeSourcePath(file.path);
    if (project) {
      try {
        identityPath = canonicalPath(
          resolvePathInside(project.identity.rootDir, file.path, "candidate", {
            realpath: true,
          }),
        );
      } catch (error) {
        fileIssues.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (project && existsSync(path.join(project.identity.rootDir, file.path))) {
      fileIssues.push(
        `${file.path} already exists; create-only candidates must not overwrite files.`,
      );
    }
    if (seen.has(identityPath))
      fileIssues.push(`Duplicate file path ${file.path}.`);
    seen.add(identityPath);
    if (typeof file.content !== "string")
      fileIssues.push(`${file.path} content must be a string.`);
    if (typeof file.content === "string") {
      const bytes = Buffer.from(file.content, "utf8");
      if (
        file.sha256 !== undefined &&
        file.sha256 !== createHash("sha256").update(bytes).digest("hex")
      )
        fileIssues.push(
          `${file.path} content does not match its declared sha256.`,
        );
      totalBytes += bytes.length;
      if (bytes.toString("utf8") !== file.content)
        fileIssues.push(`${file.path} contains invalid Unicode text.`);
      if (bytes.length > 512 * 1024)
        fileIssues.push(
          `${file.path} exceeds the 512 KiB candidate file limit.`,
        );
      if (totalBytes > 2 * 1024 * 1024)
        fileIssues.push("Candidate files exceed the 2 MiB total limit.");
      if (bytes.length <= 512 * 1024 && totalBytes <= 2 * 1024 * 1024) {
        fileIssues.push(...candidateSyntaxIssues(file.path, file.content));
        if (profile !== "syntax")
          fileIssues.push(
            ...contentQualityIssues(
              file.path,
              file.content,
              directory?.role,
              project,
            ),
          );
      }
      if (
        profile === "strict" &&
        bytes.length <= 512 * 1024 &&
        totalBytes <= 2 * 1024 * 1024
      )
        fileIssues.push(
          ...strictBoundaryIssues(file.path, file.content, directory?.role),
        );
      if (fileIssues.length === 0)
        overlayChanges.push({
          kind: "create",
          ...candidateSourceRef(project, file.path),
          role: directory?.role ?? "source",
          bytes,
        });
    }
    if (file.encoding !== undefined && file.encoding !== "utf8")
      fileIssues.push(`${file.path} encoding must be utf8.`);
    diagnostics.push(...fileIssues);
    fileResults.push({
      path: file.path,
      verdict: fileIssues.length === 0 ? "valid" : "invalid",
      directory,
      issues: fileIssues,
    });
  }
  if (diagnostics.length === 0 && project) {
    const base = getInspectionSources(project);
    if (base) {
      try {
        const overlay = overlaySourceView(base, overlayChanges);
        if (profile !== "syntax") {
          const roles = getInspectionRoles(project);
          if (roles) {
            const changedFiles = new Set(
              overlayChanges
                .filter((change) => change.rootId === ASSISTANT_SOURCE_ROOT)
                .map((change) => change.path),
            );
            const serviceDirectory =
              project.snapshot.sections.services?.resolvedPath ??
              "src/services";
            const serviceChanged = [...changedFiles].some((file) =>
              file.startsWith(serviceDirectory + "/"),
            );
            const configChanged = [...changedFiles].some((file) =>
              file.startsWith("src/config/"),
            );
            for (const item of collectProjectStaticDiagnostics(overlay, roles, {
              configTarget,
            })) {
              if (
                !changedFiles.has(item.sourceFile ?? "") &&
                !(serviceChanged && item.domain === "services") &&
                !(configChanged && item.domain === "configuration")
              )
                continue;
              if (item.severity === "error") diagnostics.push(item.message);
              if (item.incomplete) missingEvidence.push(item.message);
            }
          }
          const result = analyzeCandidateOverlay(
            overlay,
            project.identity.rootDir,
            new Set(
              overlayChanges.map((change) => `${change.rootId}:${change.path}`),
            ),
            project.snapshot.sections.routes?.resolvedPath ?? "src/routes",
          );
          diagnostics.push(...result.errors);
          missingEvidence.push(...result.missingEvidence);
        }
      } catch (error) {
        diagnostics.push(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
  return {
    ok: diagnostics.length === 0,
    missingEvidence,
    diagnostics,
    fileCount: files.length,
    files: fileResults,
    allowedDirectories,
    requiredHostSteps: planHostValidationSteps(fileResults),
  };
}

function candidateSourceRef(
  project: VextMcpProjectInspection | undefined,
  file: string,
) {
  if (project) {
    const absolute = path.resolve(project.identity.rootDir, file);
    const target = getInspectionSources(project)
      ?.roots()
      .filter(
        (root) => root.packageName && isPathInside(root.realPath, absolute),
      )
      .sort((a, b) => b.realPath.length - a.realPath.length)[0];
    if (target)
      return {
        rootId: target.id,
        path: normalizeSourcePath(
          path.relative(target.realPath, absolute).replaceAll("\\", "/"),
        ),
      };
  }
  return { rootId: ASSISTANT_SOURCE_ROOT, path: normalizeSourcePath(file) };
}

function invalidCandidate(
  message: string,
  fileCount = 0,
  allowedDirectories: VextMcpCandidateDirectory[] = [],
) {
  return {
    ok: false,
    missingEvidence: [],
    diagnostics: [message],
    fileCount,
    files: [],
    allowedDirectories,
    requiredHostSteps: ["Fix candidate shape before planning validation."],
  };
}

function planHostValidationSteps(
  files: VextMcpValidationFileResult[],
): string[] {
  const steps = new Set<string>([
    "Review every candidate file before applying it.",
    "Run npm run typecheck after applying candidate files.",
  ]);
  for (const file of files) {
    if (!file.path || file.verdict !== "valid") {
      steps.add("Fix candidate diagnostics before applying any file.");
      continue;
    }
    const normalized = file.path.replaceAll("\\", "/");
    const role = file.directory?.role;
    if (
      role === "routes" ||
      role === "services" ||
      role === "models" ||
      role === "middlewares" ||
      role === "plugins" ||
      role === "schemas" ||
      role === "shared-types" ||
      role === "server-types" ||
      role === "frontend-types" ||
      role === "utils" ||
      normalized.includes("/src/routes/") ||
      normalized.includes("/src/services/") ||
      normalized.includes("/src/models/") ||
      normalized.includes("/src/schemas/")
    ) {
      steps.add(
        "Run focused backend unit or integration tests for affected routes/services/models.",
      );
    }
    if (
      role === "frontend-pages" ||
      role === "frontend-components" ||
      role === "frontend-styles" ||
      role === "frontend-assets" ||
      normalized.includes("/src/frontend/")
    ) {
      steps.add(
        "Run npm run build and affected frontend/e2e checks after applying frontend files.",
      );
    }
    if (
      role === "locales" ||
      role === "frontend-locales" ||
      normalized.includes("/src/locales/") ||
      normalized.includes("/src/frontend/locales/")
    ) {
      steps.add("Run affected locale/i18n tests after applying locale files.");
    }
    if (
      role === "jobs" ||
      role === "job-types" ||
      normalized.includes("/src/jobs/") ||
      normalized.includes("/src/types/server/jobs/")
    ) {
      steps.add(
        "Run focused job unit tests and scheduler/worker integration checks for affected jobs.",
      );
    }
    if (role === "tests" || normalized.startsWith("test/")) {
      steps.add("Run the new or changed focused test file directly.");
    }
    if (file.directory?.source === "workspace-shared-package") {
      steps.add(
        "Run tests for every workspace service that consumes the changed shared package.",
      );
    }
  }
  return [...steps];
}

function candidateSyntaxIssues(filePath: string, content: string): string[] {
  try {
    if (/\.[cm]?[jt]sx?$/u.test(filePath)) parseSourceSyntax(filePath, content);
    else if (filePath.endsWith(".json"))
      JSON.parse(content.replace(/^\uFEFF/u, ""));
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

function contentQualityIssues(
  filePath: string,
  content: string,
  role?: string,
  project?: VextMcpProjectInspection,
): string[] {
  const normalized = filePath.replaceAll("\\", "/");
  const issues: string[] = [];
  const blocks = (id: string) =>
    (project?.policy.patch.rules?.find((rule) => rule.id === id)?.level ??
      "error") === "error";
  if (role === "routes" || (!role && normalized.startsWith("src/routes/"))) {
    const facts = inspectRouteFacts(filePath, content);
    for (const route of facts.routes) {
      if (route.deprecatedDocsTags && blocks("VEXT_MCP_DEPRECATED_DOCS_TAGS"))
        issues.push(
          `${filePath} uses deprecated docs.tags; tags are inferred automatically.`,
        );
      if (route.responses === "invalid")
        issues.push(
          `${filePath} has an invalid RouteOptions.responses declaration.`,
        );
      if (
        route.returnsJson &&
        route.responses === "absent" &&
        blocks("VEXT_MCP_ROUTE_RESPONSE_SCHEMA_MISSING")
      )
        issues.push(
          `${filePath} returns JSON without top-level RouteOptions.responses at offset ${route.start}.`,
        );
    }
  }
  if (
    (role === "tests" || normalized.startsWith("test/")) &&
    blocks("VEXT_MCP_TEST_PLACEHOLDER_ASSERTION") &&
    hasPlaceholderAssertion(content, filePath)
  )
    issues.push(`${filePath} contains a placeholder assertion.`);
  return issues;
}

function hasPlaceholderAssertion(content: string, file: string) {
  try {
    return inspectSourceQuality(file, content).placeholderAssertion;
  } catch {
    return false;
  }
}

/** strict 追加消费者边界检查；类型导入与运行时依赖不能混为一谈。 */
function strictBoundaryIssues(
  file: string,
  source: string,
  role?: string,
): string[] {
  if (
    !role ||
    !(role.startsWith("frontend-") || role === "shared-types") ||
    !/\.[cm]?[jt]sx?$/u.test(file)
  )
    return [];
  const issues: string[] = [];
  try {
    for (const node of parseSourceSyntax(file, source).body) {
      if (
        node.type !== "ImportDeclaration" &&
        node.type !== "ExportNamedDeclaration" &&
        node.type !== "ExportAllDeclaration"
      )
        continue;
      const specifier = node.source?.value;
      if (typeof specifier !== "string") continue;
      const typeOnly =
        node.type === "ImportDeclaration"
          ? node.importKind === "type" ||
            (node.specifiers.length > 0 &&
              node.specifiers.every(
                (item) =>
                  item.type === "ImportSpecifier" && item.importKind === "type",
              ))
          : node.exportKind === "type";
      if (
        !typeOnly &&
        (isBuiltin(specifier) ||
          ["vextjs", "vextjs/testing", "monsqlize", "mongodb", "ioredis"].some(
            (name) =>
              specifier === name ||
              (name !== "vextjs" && specifier.startsWith(name + "/")),
          ))
      )
        issues.push(
          `${file}: ${specifier} is a server runtime dependency in a browser/shared source role.`,
        );
    }
  } catch {
    /* 语法错误由统一候选语法检查报告。 */
  }
  return issues;
}

function isSafeRelativePath(value: string): boolean {
  try {
    const normalized = normalizeSourcePath(value);
    return !normalized
      .split("/")
      .some((segment) => [".git", ".vext", "node_modules"].includes(segment));
  } catch {
    return false;
  }
}

function candidateDirectoryPolicy(
  project: VextMcpProjectInspection | undefined,
): VextMcpCandidateDirectory[] {
  if (!project) {
    return DEFAULT_SERVICE_CANDIDATE_PATHS.map((item) => ({
      prefix: normalizeCandidatePrefix(item),
      source: "default" as const,
    })).filter((item) => item.prefix);
  }
  const directories = new Map<string, VextMcpCandidateDirectory>();
  for (const role of DEFAULT_CANDIDATE_SECTION_ROLES) {
    if (
      project &&
      project.structureDecisions.some(
        (entry) => entry.role === role && !entry.editable,
      )
    )
      continue;
    const section = project.snapshot.sections[role];
    if (!section) continue;
    addCandidateDirectory(
      directories,
      section.resolvedPath ?? section.actualPath ?? section.defaultPath,
      {
        source: "project-section",
        role,
      },
    );
  }
  for (const id of ["routes", "services", "middlewares", "plugins"]) {
    if (project.snapshot.sections[id]?.resolvedPath !== `src/${id}`)
      addCandidateDirectory(directories, `src/${id}`, {
        source: "project-section",
        role: id,
      });
  }
  for (const sharedPackage of project.assistant.workspace?.config
    .sharedPackages ?? []) {
    const sharedRoot = getInspectionSources(project)
      ?.roots()
      .find((root) => root.id === "workspace-package-" + sharedPackage.id);
    if (!sharedRoot) continue;
    const relativeRoot = path
      .relative(project.identity.rootDir, sharedRoot.realPath)
      .replaceAll("\\", "/");
    if (!isSafeRelativePath(relativeRoot)) continue;
    for (const exportedPath of Object.values(sharedPackage.sourceExports)) {
      if (path.posix.dirname(exportedPath) === ".") continue;
      addCandidateDirectory(
        directories,
        path.posix.join(relativeRoot, path.posix.dirname(exportedPath)),
        {
          source: "workspace-shared-package",
          packageId: sharedPackage.id,
          packageKind: sharedPackage.kind,
        },
      );
    }
  }
  return [...directories.values()].sort((a, b) =>
    a.prefix.localeCompare(b.prefix),
  );
}

function addCandidateDirectory(
  directories: Map<string, VextMcpCandidateDirectory>,
  value: string | null,
  metadata: Omit<VextMcpCandidateDirectory, "prefix">,
): void {
  if (!value) return;
  if (!isSafeRelativePath(value)) return;
  const prefix = normalizeCandidatePrefix(value);
  if (prefix && !directories.has(prefix)) {
    directories.set(prefix, { prefix, ...metadata });
  }
}

function normalizeCandidatePrefix(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized === "." ? "" : `${normalized}/`;
}

function findCandidateDirectory(
  value: string,
  directories: VextMcpCandidateDirectory[],
): VextMcpCandidateDirectory | undefined {
  const normalized = value.replaceAll("\\", "/");
  return directories
    .filter((directory) => normalized.startsWith(directory.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
