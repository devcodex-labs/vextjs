import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  resolvePathInside,
  physicalPath,
  isPathInside,
} from "../../lib/path-boundary.js";
import { resolveConfigProfile } from "../../lib/config-profile.js";
import type { ConfiguredSourceLayout } from "./layout-projection.js";
import { collectSourceView } from "../source-view/collect.js";
import {
  discoverSourceFiles,
  projectSourceLimits,
} from "../source-view/discover.js";
import {
  assertSourceBudget,
  DEFAULT_SOURCE_LIMITS,
  normalizeSourcePath,
} from "../source-view/policy.js";
import {
  SourceViewError,
  type SourceFileRef,
  type SourceLimits,
  type SourceView,
  type RootRef,
} from "../source-view/types.js";
import {
  roleForSource,
  resolveAssistantRoles,
  adoptConfiguredRoles,
  adoptExistingRoles,
  type ResolvedAssistantRole,
} from "./roles.js";
import {
  findWorkspaceSourceDeclarations,
  resolveWorkspacePackageSources,
  verifyWorkspacePackageSources,
  type WorkspaceSourceDeclarations,
} from "./workspace-sources.js";
import { projectStaticConfig } from "./config-projection.js";
import { projectConfiguredSourceLayout } from "./layout-projection.js";

export const ASSISTANT_SOURCE_ROOT = "project";

export interface ProjectAnalysisSourceOptions {
  limits?: Partial<SourceLimits>;
  signal?: AbortSignal;
  workspace?: WorkspaceSourceDeclarations;
  workspaceRootDir?: string;
  roles?: readonly ResolvedAssistantRole[];
}

/** MCP 与 Doctor 的共同源码入口；配置读取根与封存正文必须属于同一配置代次。 */
export async function collectProjectAnalysisContext(
  rootDir: string,
  options: ProjectAnalysisSourceOptions = {},
) {
  rootDir = fs.realpathSync.native(rootDir);
  const workspaceSource = findWorkspaceSourceDeclarations(rootDir);
  const preliminary = await collectAssistantConfigSources(rootDir, options);
  const layout = projectConfiguredSourceLayout(
    rootDir,
    projectStaticConfig(preliminary),
  );
  const roles = adoptConfiguredRoles(
    adoptExistingRoles(rootDir, options.roles ?? resolveAssistantRoles()),
    layout,
    rootDir,
  );
  const view = await collectAssistantSources(rootDir, roles, {
    ...options,
    workspace: options.workspace ?? workspaceSource?.workspace,
    workspaceRootDir: workspaceSource?.rootDir ?? rootDir,
    layout,
  });
  if (
    workspaceSource &&
    view.record(
      workspaceSource.rootDir === rootDir ? ASSISTANT_SOURCE_ROOT : "workspace",
      workspaceSource.file,
    )?.sha256 !== workspaceSource.digest
  )
    throw new SourceViewError(
      "VEXT_SOURCE_CHANGED",
      "Workspace source declarations changed during collection.",
    );
  if (
    JSON.stringify(
      projectConfiguredSourceLayout(rootDir, projectStaticConfig(view)),
    ) !== JSON.stringify(layout)
  )
    throw new SourceViewError(
      "VEXT_SOURCE_CHANGED",
      "Configuration source-root declarations changed during collection. Inspect again.",
    );
  for (const file of preliminary.list())
    if (view.record(file.rootId, file.path)?.sha256 !== file.sha256)
      throw new SourceViewError(
        "VEXT_SOURCE_CHANGED",
        "Configuration changed while resolving source roots. Inspect again.",
      );
  return { view, roles, layout };
}

const METADATA_FILES = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "vext.workspace.json",
  "vext.workspace.jsonc",
  "tsconfig.json",
  "jsconfig.json",
  "README.md",
  "AGENTS.md",
  ".editorconfig",
  ".prettierrc",
  "prettier.config.js",
  "prettier.config.mjs",
  ".prettierrc.json",
  "eslint.config.js",
  "eslint.config.mjs",
  "vitest.config.ts",
  "vitest.config.js",
  "playwright.config.ts",
  "playwright.config.js",
];
const TEXT_PATTERNS = [
  "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,json,jsonc,md,yml,yaml,html,css,scss,svg,txt}",
];
const IGNORED = [
  "**/node_modules{,/**}",
  "**/dist{,/**}",
  "**/.git{,/**}",
  "**/.vext{,/**}",
  "**/.devcodex{,/**}",
  "**/coverage{,/**}",
  "**/.cache{,/**}",
  "**/*.__vext_compiled__*",
  "**/*.tsbuildinfo",
];

/** 只收集声明角色及项目元数据，不执行配置，不读取依赖目录或可变运行数据。 */
export async function collectAssistantSources(
  rootDir: string,
  roles: readonly ResolvedAssistantRole[],
  options: {
    limits?: Partial<SourceLimits>;
    signal?: AbortSignal;
    workspace?: WorkspaceSourceDeclarations;
    workspaceRootDir?: string;
    layout?: ConfiguredSourceLayout;
  } = {},
): Promise<SourceView> {
  const limits = projectSourceLimits(options.limits);
  const budget = {
    entries: 0,
    limit: limits.maxScanEntries ?? DEFAULT_SOURCE_LIMITS.maxScanEntries!,
  };
  const files = new Map<string, SourceFileRef>();
  const directoryEvidence = new Map<
    string,
    { real: string; stat: fs.BigIntStats }
  >();
  const observeDirectory = (
    absolute: string,
    real: string,
    stat: fs.BigIntStats,
  ) => {
    directoryEvidence.set(absolute, { real, stat });
  };
  const cancelled = () => {
    if (options.signal?.aborted)
      throw new SourceViewError(
        "VEXT_SOURCE_CANCELLED",
        "MCP source collection was cancelled.",
      );
  };
  const add = (file: string, role: string, rootId = ASSISTANT_SOURCE_ROOT) => {
    const normalized = normalizeSourcePath(file);
    const key = rootId + ":" + normalized;
    if (files.has(key)) return;
    assertSourceBudget(files.size + 1, 0, limits);
    files.set(key, {
      rootId,
      path: normalized,
      role,
    });
  };
  const roots: RootRef[] = [
    { id: ASSISTANT_SOURCE_ROOT, realPath: rootDir, kind: "service" },
  ];
  const workspaceRootDir = options.workspaceRootDir ?? rootDir;
  const workspaceRootId =
    workspaceRootDir === rootDir ? ASSISTANT_SOURCE_ROOT : "workspace";
  if (workspaceRootId !== ASSISTANT_SOURCE_ROOT)
    roots.push({
      id: workspaceRootId,
      realPath: workspaceRootDir,
      kind: "shared",
    });
  const packages = resolveWorkspacePackageSources(
    workspaceRootDir,
    rootDir,
    options.workspace ?? {},
  );
  const isPackageDirectory = (absolute: string) =>
    packages.some((item) => path.relative(item.declaredRoot, absolute) === "");
  const external = Object.entries(options.layout?.directories ?? {}).flatMap(
    ([role, configured]) => {
      const real = physicalPath(configured.absolutePath);
      if (!isPathInside(rootDir, real, true) && !configured.explicit)
        throw new SourceViewError(
          "VEXT_SOURCE_UNVERIFIED",
          `Undeclared external source link: ${configured.absolutePath}.`,
        );
      return isPathInside(rootDir, real, true)
        ? []
        : [
            {
              role,
              logicalPath: configured.absolutePath,
              realPath: real,
              id: "configured-" + role,
            },
          ];
    },
  );
  const internalDirectories = Object.values(options.layout?.directories ?? {})
    .filter((item) => isPathInside(rootDir, physicalPath(item.absolutePath)))
    .map((item) =>
      path.relative(rootDir, item.absolutePath).split(path.sep).join("/"),
    );
  const isExternalAlias = (absolute: string) =>
    external.some((entry) => path.relative(absolute, entry.logicalPath) === "");
  if (workspaceRootId !== ASSISTANT_SOURCE_ROOT)
    for (const file of ["vext.workspace.json", "vext.workspace.jsonc"])
      if (
        fs.existsSync(
          resolvePathInside(workspaceRootDir, file, "workspace metadata", {
            realpath: true,
          }),
        )
      )
        add(file, "metadata", workspaceRootId);
  for (const relative of METADATA_FILES) {
    cancelled();
    const absolute = resolvePathInside(rootDir, relative, "MCP metadata", {
      realpath: true,
    });
    if (fs.existsSync(absolute)) add(relative, "metadata");
  }
  for (const [role, configured] of Object.entries(
    options.layout?.files ?? {},
  )) {
    cancelled();
    const relative = path
      .relative(rootDir, configured.absolutePath)
      .split(path.sep)
      .join("/");
    const absolute = resolvePathInside(
      rootDir,
      relative,
      "configured source file",
      { realpath: true },
    );
    if (fs.existsSync(absolute)) add(relative, role);
  }
  // 父角色覆盖子角色的发现范围，文件归属仍取最具体角色，避免重复遍历。
  const sourceRoles = roles.filter(
    (role) => role.mode !== "generated" && role.mode !== "runtime",
  );
  const directories = [
    ...new Set([
      "src",
      "scripts",
      ".github/workflows",
      ...internalDirectories,
      ...sourceRoles.map((role) => role.path),
      ...(workspaceRootDir === rootDir
        ? (options.workspace?.services ?? [])
        : []
      ).flatMap((service) => [
        ...sourceRoles.map((role) => path.posix.join(service.root, role.path)),
        path.posix.join(service.root, "src"),
      ]),
    ]),
  ].sort((a, b) => a.length - b.length || a.localeCompare(b));
  const selected = directories.filter(
    (directory, index) =>
      !directories
        .slice(0, index)
        .some((parent) => directory.startsWith(parent + "/")),
  );
  for (const directory of selected) {
    cancelled();
    if (
      isExternalAlias(path.resolve(rootDir, directory)) ||
      isPackageDirectory(path.resolve(rootDir, directory))
    )
      continue;
    const absolute = resolvePathInside(
      rootDir,
      directory,
      "MCP source directory",
      { realpath: true },
    );
    if (!fs.existsSync(absolute)) continue;
    if (!fs.statSync(absolute).isDirectory())
      throw new SourceViewError(
        "VEXT_SOURCE_UNVERIFIED",
        `MCP source role is not a directory: ${directory}.`,
      );
    for await (const relative of discoverSourceFiles(
      rootDir,
      directory,
      TEXT_PATTERNS,
      IGNORED,
      budget,
      cancelled,
      () => true,
      (relative) =>
        !isExternalAlias(path.resolve(rootDir, directory, relative)) &&
        !isPackageDirectory(path.resolve(rootDir, directory, relative)),
      observeDirectory,
    )) {
      const file = path.posix.join(directory, relative);
      const configuredRole = Object.entries(options.layout?.directories ?? {})
        .filter(([, entry]) =>
          isPathInside(entry.absolutePath, path.resolve(rootDir, file)),
        )
        .sort(
          ([, left], [, right]) =>
            right.absolutePath.length - left.absolutePath.length,
        )[0]?.[0];
      add(file, roleForSource(file, roles)?.id ?? configuredRole ?? "source");
    }
  }
  for (const entry of external) {
    cancelled();
    if (!fs.existsSync(entry.realPath)) continue;
    if (!fs.statSync(entry.realPath).isDirectory())
      throw new SourceViewError(
        "VEXT_SOURCE_UNVERIFIED",
        `Configured source root is not a directory: ${entry.logicalPath}.`,
      );
    roots.push({ id: entry.id, realPath: entry.realPath, kind: "shared" });
    for await (const relative of discoverSourceFiles(
      entry.realPath,
      "",
      TEXT_PATTERNS,
      IGNORED,
      budget,
      cancelled,
      undefined,
      undefined,
      observeDirectory,
    ))
      add(relative, entry.role, entry.id);
  }
  for (const item of packages) {
    roots.push(item.root);
    for await (const file of discoverSourceFiles(
      item.root.realPath,
      "",
      TEXT_PATTERNS,
      IGNORED,
      budget,
      cancelled,
      undefined,
      undefined,
      observeDirectory,
    ))
      add(file, "shared-source", item.root.id);
    for (const file of item.consumerFiles)
      add(file, "metadata", workspaceRootId);
  }
  for (const service of workspaceRootDir === rootDir
    ? (options.workspace?.services ?? [])
    : []) {
    const metadata = path.posix.join(service.root, "package.json");
    if (
      fs.existsSync(
        resolvePathInside(rootDir, metadata, "service metadata", {
          realpath: true,
        }),
      )
    )
      add(metadata, "metadata");
  }
  const view = await collectSourceView({
    roots,
    files: files.values(),
    rolePolicyVersion:
      "vext-assistant-roles-v2:" +
      createHash("sha256").update(JSON.stringify(roles)).digest("hex"),
    limits,
    signal: options.signal,
    verifyUnchanged: true,
  });
  // 文件复读不能发现新增或删除的目录项，封存前还需核对本次实际遍历过的目录。
  for (const [absolute, before] of directoryEvidence) {
    cancelled();
    const after = fs.statSync(absolute, { bigint: true });
    if (
      after.dev !== before.stat.dev ||
      after.ino !== before.stat.ino ||
      after.mtimeNs !== before.stat.mtimeNs ||
      after.ctimeNs !== before.stat.ctimeNs ||
      fs.realpathSync.native(absolute) !== before.real
    )
      throw new SourceViewError(
        "VEXT_SOURCE_CHANGED",
        `Source inventory changed during collection: ${absolute}.`,
      );
  }
  verifyWorkspacePackageSources(view, packages, workspaceRootId);
  for (const entry of external)
    if (
      path.relative(physicalPath(entry.logicalPath), entry.realPath) !== "" ||
      fs.existsSync(entry.realPath) !==
        roots.some((root) => root.id === entry.id)
    )
      throw new SourceViewError(
        "VEXT_SOURCE_CHANGED",
        "Configured source-root identity changed during collection. Inspect again.",
      );
  return view;
}

/** 先读有限配置层以确定声明读取根，再采集源码；最终视图必须再次核对这些字节。 */
export async function collectAssistantConfigSources(
  rootDir: string,
  options: { signal?: AbortSignal; limits?: Partial<SourceLimits> } = {},
): Promise<SourceView> {
  const profile = resolveConfigProfile({ command: "dev" }).profile;
  const files: SourceFileRef[] = [];
  for (const layer of new Set(["default", profile, "local", "bootstrap"])) {
    for (const extension of ["ts", "js", "mjs", "cjs"]) {
      const relative = `src/config/${layer}.${extension}`;
      const absolute = resolvePathInside(rootDir, relative, "config source", {
        realpath: true,
      });
      if (fs.existsSync(absolute))
        files.push({
          rootId: ASSISTANT_SOURCE_ROOT,
          path: relative,
          role: "config",
        });
    }
  }
  return collectSourceView({
    roots: [{ id: ASSISTANT_SOURCE_ROOT, realPath: rootDir, kind: "service" }],
    files,
    rolePolicyVersion: "assistant-config-roots-v1",
    signal: options.signal,
    limits: projectSourceLimits(options.limits),
    verifyUnchanged: true,
  });
}
