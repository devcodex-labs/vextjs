import { normalizeSourcePath } from "../source-view/policy.js";
import path from "node:path";
import { statSync } from "node:fs";
import { physicalPath, isPathInside } from "../../lib/path-boundary.js";
import type { ConfiguredSourceLayout } from "./layout-projection.js";

/** 已有 policy 示例使用单数 service；归一化为目录角色，避免静默失效。 */
export function canonicalAssistantRole(id: string): string {
  const aliases: Record<string, string> = {
    service: "services",
    "server-service-types": "service-types",
    "backend-locales": "locales",
    "public-assets": "public",
    "test-fixtures": "fixtures",
    "seed-scripts": "seeds",
    "runtime-data": "storage",
  };
  return Object.hasOwn(aliases, id) ? aliases[id]! : id;
}

export type AssistantRoleMode =
  | "loader"
  | "import"
  | "static"
  | "script"
  | "generated"
  | "runtime";

export interface AssistantRole {
  id: string;
  defaultPath: string;
  mode: AssistantRoleMode;
  candidate: boolean;
  purpose: string;
}

export interface ResolvedAssistantRole extends AssistantRole {
  path: string;
  source: "default" | "policy" | "config" | "existing";
  inheritedFrom?: string;
  runtimePath?: string;
  externalRootId?: string;
  unresolved?: string;
}

function role(
  id: string,
  defaultPath: string,
  mode: AssistantRoleMode,
  purpose: string,
  candidate = true,
): AssistantRole {
  return { id, defaultPath, mode, purpose, candidate };
}

/** 目录建议、事实采集与候选归属共用；目录声明不会创建框架注入或更改运行时 loader。 */
export const ASSISTANT_ROLES: readonly AssistantRole[] = Object.freeze([
  role(
    "routes",
    "src/routes",
    "loader",
    "HTTP routes and runtime input/response schemas.",
  ),
  role(
    "services",
    "src/services",
    "loader",
    "Business use cases, database/cache coordination and private helpers.",
  ),
  role(
    "middlewares",
    "src/middlewares",
    "loader",
    "Request lifecycle middleware.",
  ),
  role(
    "plugins",
    "src/plugins",
    "loader",
    "Explicit framework extensions and lifecycle hooks.",
  ),
  role(
    "models",
    "src/models",
    "loader",
    "MonSQLize model definitions; database/pool ownership follows config.",
  ),
  role(
    "jobs",
    "src/jobs",
    "loader",
    "Job definitions; schedules and stores are configured separately.",
  ),
  role(
    "schemas",
    "src/schemas",
    "import",
    "Reusable runtime schemas imported by their consumers.",
  ),
  role(
    "validators",
    "src/validators",
    "import",
    "Shared domain validation beyond the schema DSL.",
  ),
  role(
    "utils",
    "src/utils",
    "import",
    "Reusable pure helpers; business orchestration stays in services.",
  ),
  role(
    "constants",
    "src/constants",
    "import",
    "Shared named constants grouped by feature or responsibility.",
  ),
  role(
    "shared-types",
    "src/types/shared",
    "import",
    "Type-only contracts usable in both server and frontend.",
  ),
  role(
    "server-types",
    "src/types/server",
    "import",
    "Server-only type contracts.",
  ),
  role(
    "service-types",
    "src/types/server/services",
    "import",
    "Shared service input/output types; infer local implementation types when possible.",
  ),
  role(
    "frontend-types",
    "src/types/frontend",
    "import",
    "Frontend-only type contracts.",
  ),
  role(
    "job-types",
    "src/types/server/jobs",
    "import",
    "Reusable Job payload contracts inferred from their runtime schemas.",
  ),
  role(
    "frontend",
    "src/frontend",
    "loader",
    "Frontend source boundary; create files in the appropriate child role.",
    false,
  ),
  role(
    "frontend-pages",
    "src/frontend/pages",
    "loader",
    "Pages, layouts, loaders and actions.",
  ),
  role(
    "frontend-components",
    "src/frontend/components",
    "import",
    "Reusable frontend components.",
  ),
  role(
    "frontend-hooks",
    "src/frontend/hooks",
    "import",
    "Reusable frontend hooks where the selected frontend supports them.",
  ),
  role(
    "frontend-lib",
    "src/frontend/lib",
    "import",
    "Frontend API and presentation helpers without server imports.",
  ),
  role(
    "frontend-locales",
    "src/frontend/locales",
    "loader",
    "Feature/subfeature locale resources.",
  ),
  role("frontend-styles", "src/frontend/styles", "import", "Frontend styles."),
  role(
    "frontend-assets",
    "src/frontend/assets",
    "import",
    "Assets processed by the frontend build.",
  ),
  role(
    "public",
    "public",
    "static",
    "Fixed URL static files; do not store mutable uploads here.",
  ),
  role(
    "config",
    "src/config",
    "loader",
    "Runtime configuration; candidate creation requires a dedicated config operation.",
    false,
  ),
  role(
    "locales",
    "src/locales",
    "loader",
    "Backend locale resources grouped by feature and subfeature.",
  ),
  role(
    "docs",
    "docs",
    "import",
    "Project documentation; OpenAPI itself derives from runtime route contracts.",
  ),
  role(
    "mocks",
    "mocks",
    "import",
    "Explicit mock data and scenarios; never an implicit production fallback.",
  ),
  role(
    "seeds",
    "scripts/seeds",
    "script",
    "Explicit database initialization executed by the host.",
  ),
  role(
    "tests",
    "test",
    "script",
    "Unit, integration and end-to-end behavior tests.",
  ),
  role(
    "fixtures",
    "test/fixtures",
    "import",
    "Deterministic inputs owned by tests.",
  ),
  role(
    "feature-modules",
    "src/modules",
    "import",
    "Feature-owned implementation and contracts; use runtime loader entrypoints.",
  ),
  role(
    "server-utils",
    "src/utils/server",
    "import",
    "Server-only reusable pure helpers.",
  ),
  role(
    "shared-utils",
    "src/utils/shared",
    "import",
    "Browser-safe reusable pure helpers.",
  ),
  role(
    "service-constants",
    "src/constants/services",
    "import",
    "Shared constants owned by service use cases.",
  ),
  role(
    "server-model-types",
    "src/types/server/models",
    "import",
    "Persistent document types; use native database generics.",
  ),
  role(
    "generated-types",
    "src/types/generated",
    "generated",
    "Framework-generated declarations; edit source contracts.",
    false,
  ),
  role(
    "frontend-layouts",
    "src/frontend/layouts",
    "import",
    "Reusable layouts; import from page layout entrypoints.",
  ),
  role(
    "mock-data",
    "mocks/data",
    "import",
    "Side-effect-free demo data; never an implicit production data source.",
  ),
  role(
    "mock-scenarios",
    "mocks/scenarios",
    "import",
    "Named demo scenarios that import explicit mock data.",
  ),
  role(
    "mock-adapters",
    "mocks/adapters",
    "import",
    "Explicit browser/server integration of an already selected mock tool.",
  ),
  role(
    "test-unit",
    "test/unit",
    "script",
    "Tests that call real units with independent expectations.",
  ),
  role(
    "test-integration",
    "test/integration",
    "script",
    "Service and API integration tests.",
  ),
  role("test-e2e", "test/e2e", "script", "Browser and process behavior tests."),
  role(
    "verification-scripts",
    "scripts/verify",
    "script",
    "Explicit host-owned verification commands.",
  ),
  role(
    "storage",
    "storage",
    "runtime",
    "Mutable uploads and runtime data; excluded from source candidates.",
    false,
  ),
  role(
    "dist",
    "dist",
    "generated",
    "Build output; inspect or edit its source instead.",
    false,
  ),
  role(
    "vext-generated",
    ".vext",
    "generated",
    "Framework manifests and generated declarations; not source candidates.",
    false,
  ),
]);

export function resolveAssistantRoles(policy?: {
  roles?: Record<string, string>;
  architecture?: {
    style: "layered" | "feature" | "custom";
    featureRoot?: string;
  };
}): ResolvedAssistantRole[] {
  return ASSISTANT_ROLES.map((definition) => {
    const parent = ASSISTANT_ROLES.filter(
      (candidate) =>
        definition.defaultPath.startsWith(candidate.defaultPath + "/") &&
        policy?.roles?.[candidate.id] !== undefined,
    ).sort((a, b) => b.defaultPath.length - a.defaultPath.length)[0];
    const direct =
      policy?.roles?.[definition.id] ??
      (definition.id === "feature-modules" &&
      policy?.architecture?.style === "feature"
        ? policy.architecture.featureRoot
        : undefined);
    const override =
      direct ??
      (parent
        ? policy!.roles![parent.id] +
          definition.defaultPath.slice(parent.defaultPath.length)
        : undefined);
    return {
      ...definition,
      path: normalizeSourcePath(override ?? definition.defaultPath),
      source: override === undefined ? "default" : "policy",
      ...(direct === undefined && parent ? { inheritedFrom: parent.id } : {}),
    };
  });
}

export function isInRole(file: string, directory: string): boolean {
  return file.startsWith(directory + "/");
}

/** 配置决定实际读取根；用户策略决定候选放置，显式外部模型/语言根始终只读。 */
export function adoptConfiguredRoles(
  roles: readonly ResolvedAssistantRole[],
  layout: ConfiguredSourceLayout,
  rootDir: string,
): ResolvedAssistantRole[] {
  const adopted: ResolvedAssistantRole[] = roles.map((role) => {
    if (layout.unknown[role.id])
      return { ...role, unresolved: layout.unknown[role.id] };
    const configured = layout.directories[role.id];
    if (!configured) return role;
    const runtimePath = configured.absolutePath;
    if (!isPathInside(rootDir, physicalPath(runtimePath), true))
      return {
        ...role,
        runtimePath,
        externalRootId: "configured-" + role.id,
        candidate: false,
        source: "config",
        ...(!configured.explicit
          ? {
              unresolved:
                "External links require an explicit configured read directory.",
            }
          : {}),
      };
    const relative = path
      .relative(rootDir, runtimePath)
      .split(path.sep)
      .join("/");
    if (!relative)
      return {
        ...role,
        runtimePath,
        unresolved:
          "A whole-project loader root cannot be assigned a single source role. Select a narrower source directory.",
      };
    if (role.source === "policy") return { ...role, runtimePath };
    return {
      ...role,
      path: normalizeSourcePath(relative),
      runtimePath,
      source: configured.explicit ? "config" : role.source,
    };
  });
  // 布局配置与父级策略沿同一角色树传给子目录；显式子目录覆盖始终优先。
  for (const child of [...adopted].sort(
    (a, b) => a.defaultPath.length - b.defaultPath.length,
  )) {
    if (
      layout.directories[child.id] ||
      child.source === "existing" ||
      (child.source === "policy" && !child.inheritedFrom)
    )
      continue;
    const parent = adopted
      .filter((candidate) =>
        child.defaultPath.startsWith(candidate.defaultPath + "/"),
      )
      .sort((a, b) => b.defaultPath.length - a.defaultPath.length)[0];
    if (!parent) continue;
    const suffix = child.defaultPath.slice(parent.defaultPath.length);
    child.path = parent.path + suffix;
    child.source = parent.source;
    child.inheritedFrom = parent.id;
    if (parent.runtimePath) child.runtimePath = parent.runtimePath + suffix;
    if (parent.unresolved) child.unresolved = parent.unresolved;
    if (parent.externalRootId) {
      child.externalRootId = parent.externalRootId;
      child.candidate = false;
    }
  }
  return adopted;
}

export function roleForSource(
  file: string,
  roles: readonly ResolvedAssistantRole[],
): ResolvedAssistantRole | undefined {
  return roles
    .filter((definition) => isInRole(file, definition.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

/** 有限候选布局探测；只沿用普通 import/test 角色，不猜测新的运行时 loader。 */
export function adoptExistingRoles(
  rootDir: string,
  roles: readonly ResolvedAssistantRole[],
): ResolvedAssistantRole[] {
  const alternatives: Record<string, string[]> = {
    mocks: ["src/mocks"],
    tests: ["tests", "__tests__"],
    fixtures: ["fixtures"],
  };
  const directory = (relative: string) => {
    const absolute = path.resolve(rootDir, relative);
    return (
      isPathInside(rootDir, physicalPath(absolute), true) &&
      statSync(absolute, { throwIfNoEntry: false })?.isDirectory()
    );
  };
  return roles.map((role) => {
    if (role.source !== "default" || directory(role.path)) return role;
    const found = (alternatives[role.id] ?? []).filter(directory);
    return found.length === 1
      ? { ...role, path: found[0]!, source: "existing" }
      : role;
  });
}
