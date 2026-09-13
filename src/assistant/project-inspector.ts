import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { parse, type ParseError } from "jsonc-parser";
import { detectProjectLanguage } from "../lib/build/project-language.js";
import { parseSourceSyntax, type SyntaxNode } from "../lib/source-syntax.js";
import {
  normalizeDevMcpConfig,
  normalizePolicyPatch,
  normalizeWorkspaceConfig,
  type NormalizedVextDevMcpConfig,
  type VextAssistantWorkspaceConfig,
} from "./contracts.js";

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
}

export interface VextMcpProjectInspection {
  schemaVersion: 1;
  status: "ok";
  identity: VextMcpProjectIdentity;
  snapshot: {
    language: "ts" | "js" | "unknown";
    packageManager: string | null;
    frameworkDependency: string | null;
    sections: Record<string, VextMcpSectionSummary>;
  };
  partitions: VextMcpSectionSummary[];
  structureDecisions: VextMcpStructureDecision[];
  assistant: VextMcpAssistantContext;
  warnings: string[];
}

export interface VextMcpSectionSummary {
  section: string;
  state: "known" | "not-detected" | "unknown";
  actualPath: string | null;
  defaultPath: string;
  fileCount: number;
  notes: string[];
}

export interface VextMcpStructureDecision {
  role: string;
  actualPath: string | null;
  defaultPath: string;
  editable: boolean;
  source: "actual" | "default";
  notes: string[];
}

export interface VextMcpAssistantContext {
  contractVersion: 1;
  devMcp: NormalizedVextDevMcpConfig;
  devMcpSources: string[];
  workspace: {
    path: string;
    digest: string;
    config: VextAssistantWorkspaceConfig;
    policyDefaultsDigest: string | null;
  } | null;
}

const ROLE_DEFAULTS = [
  ["routes", "src/routes"],
  ["services", "src/services"],
  ["middlewares", "src/middlewares"],
  ["plugins", "src/plugins"],
  ["models", "src/models"],
  ["frontend", "src/frontend"],
  ["frontend-pages", "src/frontend/pages"],
  ["frontend-assets", "src/frontend/assets"],
  ["public", "public"],
  ["config", "src/config"],
  ["locales", "src/locales"],
  ["docs", "src/docs"],
  ["mocks", "src/mocks"],
  ["jobs", "src/jobs"],
  ["tests", "test"],
] as const;

export function inspectVextProject(input: {
  rootDir: string;
  frameworkVersion: string;
}): VextMcpProjectInspection {
  const rootDir = realpathSync(path.resolve(input.rootDir));
  const warnings: string[] = [];
  const packagePath = path.join(rootDir, "package.json");
  const packageJson = readJsonObject(packagePath);
  if (!packageJson) warnings.push("package.json is missing or invalid.");
  const packageName = readString(packageJson?.name);
  const packageVersion = readString(packageJson?.version);
  const frameworkDependency = detectFrameworkDependency(packageJson);
  const language = detectLanguage(rootDir);
  const packageManager = detectPackageManager(rootDir);
  const assistant = inspectAssistantContext(rootDir, warnings);
  const sections: Record<string, VextMcpSectionSummary> = {};
  const structureDecisions: VextMcpStructureDecision[] = [];
  for (const [role, defaultPath] of ROLE_DEFAULTS) {
    const absolute = path.join(rootDir, defaultPath);
    const exists = existsSync(absolute);
    const fileCount = exists ? countProjectFiles(absolute) : 0;
    const section: VextMcpSectionSummary = {
      section: role,
      state: exists ? "known" : "not-detected",
      actualPath: exists ? defaultPath : null,
      defaultPath,
      fileCount,
      notes: roleNotes(role, exists),
    };
    sections[role] = section;
    structureDecisions.push({
      role,
      actualPath: section.actualPath,
      defaultPath,
      editable: role !== "public" || exists,
      source: exists ? "actual" : "default",
      notes: section.notes,
    });
  }
  const hasConfig = sections.config?.state === "known";
  const hasSource = existsSync(path.join(rootDir, "src"));
  const sourceState: VextMcpSourceState = packageJson
    ? hasSource && hasConfig
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
    sections: Object.fromEntries(
      Object.entries(sections).map(([key, value]) => [key, value.fileCount]),
    ),
  });
  const projectId = sha256(
    `${rootDir}\n${packageName ?? ""}\n${packageVersion ?? ""}`,
  );
  const contextRevision =
    sourceState === "complete" ? sha256(identityInput) : null;
  return {
    schemaVersion: 1,
    status: "ok",
    identity: {
      projectId,
      contextRevision,
      rootDir,
      packageName,
      packageVersion,
      frameworkVersion: input.frameworkVersion,
      sourceState,
    },
    snapshot: {
      language,
      packageManager,
      frameworkDependency,
      sections,
    },
    partitions: Object.values(sections),
    structureDecisions,
    assistant,
    warnings,
  };
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

function inspectAssistantContext(
  rootDir: string,
  warnings: string[],
): VextMcpAssistantContext {
  const devMcp = readStaticDevMcp(rootDir, warnings);
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
    workspace: readWorkspaceConfig(rootDir, warnings),
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
  rootDir: string,
  warnings: string[],
): { declared: boolean; value: unknown; sources: string[] } {
  let declared = false;
  let value: unknown;
  const sources: string[] = [];
  for (const relative of configCandidates()) {
    const absolute = path.join(rootDir, relative);
    if (!existsSync(absolute)) continue;
    const extracted = extractStaticDevMcp(absolute, relative, warnings);
    if (extracted.kind === "value") {
      declared = true;
      value = extracted.value;
      sources.push(relative);
    } else if (extracted.kind === "unknown") {
      warnings.push(
        `${relative} contains a dev.mcp expression that MCP cannot safely evaluate statically.`,
      );
    }
  }
  return { declared, value, sources };
}

function readWorkspaceConfig(
  rootDir: string,
  warnings: string[],
): VextMcpAssistantContext["workspace"] {
  for (const relative of ["vext.workspace.json", "vext.workspace.jsonc"]) {
    const absolute = path.join(rootDir, relative);
    if (!existsSync(absolute)) continue;
    let raw: string;
    try {
      raw = readFileSync(absolute, "utf8");
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

function extractStaticDevMcp(
  absolute: string,
  relative: string,
  warnings: string[],
): { kind: "none" } | { kind: "unknown" } | { kind: "value"; value: unknown } {
  let source: string;
  try {
    source = readFileSync(absolute, "utf8");
  } catch (error) {
    warnings.push(`${relative} cannot be read: ${errorMessage(error)}.`);
    return { kind: "none" };
  }
  let program;
  try {
    program = parseSourceSyntax(relative, source);
  } catch (error) {
    warnings.push(`${relative} cannot be parsed: ${errorMessage(error)}.`);
    return { kind: "none" };
  }
  const variables = new Map<string, SyntaxNode>();
  for (const statement of program.body) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const declaration of statement.declarations) {
      if (declaration.id.type === "Identifier" && declaration.init) {
        variables.set(declaration.id.name, declaration.init);
      }
    }
  }
  const defaults = program.body.filter(
    (statement) => statement.type === "ExportDefaultDeclaration",
  );
  for (const statement of defaults) {
    const declaration = statement.declaration;
    const expression =
      declaration.type === "Identifier"
        ? variables.get(declaration.name)
        : declaration;
    if (!expression) return { kind: "unknown" };
    const literal = staticLiteral(expression);
    if (!literal.ok)
      return source.includes("mcp") ? { kind: "unknown" } : { kind: "none" };
    if (!isRecord(literal.value)) return { kind: "none" };
    const dev = literal.value.dev;
    if (!isRecord(dev) || !Object.prototype.hasOwnProperty.call(dev, "mcp")) {
      return { kind: "none" };
    }
    return { kind: "value", value: dev.mcp };
  }
  return { kind: "none" };
}

function staticLiteral(
  node: SyntaxNode,
): { ok: true; value: unknown } | { ok: false } {
  const current = unwrapExpression(node);
  if (current.type === "Literal") return { ok: true, value: current.value };
  if (current.type === "CallExpression" && current.arguments.length === 1) {
    const [argument] = current.arguments;
    if (argument && argument.type !== "SpreadElement") {
      return staticLiteral(argument);
    }
  }
  if (current.type === "ArrayExpression") {
    const items: unknown[] = [];
    for (const element of current.elements) {
      if (!element) return { ok: false };
      const value = staticLiteral(element);
      if (!value.ok) return value;
      items.push(value.value);
    }
    return { ok: true, value: items };
  }
  if (current.type === "ObjectExpression") {
    const result: Record<string, unknown> = {};
    for (const property of current.properties) {
      if (
        property.type !== "Property" ||
        property.computed ||
        property.method
      ) {
        return { ok: false };
      }
      const key = staticPropertyName(property.key);
      if (key === null) return { ok: false };
      const value = staticLiteral(property.value);
      if (!value.ok) return value;
      result[key] = value.value;
    }
    return { ok: true, value: result };
  }
  return { ok: false };
}

function unwrapExpression(node: SyntaxNode): SyntaxNode {
  let current = node;
  while (
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSNonNullExpression" ||
    current.type === "TSTypeAssertion"
  ) {
    current = current.expression;
  }
  return current;
}

function staticPropertyName(node: SyntaxNode): string | null {
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string")
    return node.value;
  return null;
}

function configCandidates(): string[] {
  const names = ["default", "development"];
  const extensions = ["ts", "js", "mjs", "cjs", "mts", "cts"];
  return names.flatMap((name) =>
    extensions.map((extension) => `src/config/${name}.${extension}`),
  );
}

function detectLanguage(rootDir: string): "ts" | "js" | "unknown" {
  try {
    return detectProjectLanguage(rootDir);
  } catch {
    if (existsSync(path.join(rootDir, "tsconfig.json"))) return "ts";
    if (existsSync(path.join(rootDir, "src"))) return "js";
    return "unknown";
  }
}

function detectPackageManager(rootDir: string): string | null {
  if (existsSync(path.join(rootDir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(rootDir, "yarn.lock"))) return "yarn";
  if (
    existsSync(path.join(rootDir, "bun.lockb")) ||
    existsSync(path.join(rootDir, "bun.lock"))
  )
    return "bun";
  if (existsSync(path.join(rootDir, "package-lock.json"))) return "npm";
  return null;
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
    return ["Job definitions are discovered without querying queue state."];
  if (role === "docs")
    return [
      "Docs/OpenAPI source is inspected statically; runtime endpoints are not requested.",
    ];
  return [];
}

function countProjectFiles(dir: string, limit = 500): number {
  let count = 0;
  const stack = [dir];
  while (stack.length && count < limit) {
    const current = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (["node_modules", "dist", ".git", ".vext"].includes(entry)) continue;
      const full = path.join(current, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) stack.push(full);
      else count += 1;
      if (count >= limit) break;
    }
  }
  return count;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
