import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { detectProjectLanguage } from "../lib/build/project-language.js";

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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
