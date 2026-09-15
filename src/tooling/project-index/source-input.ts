import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  discoverSourceFiles,
  projectSourceLimits,
} from "../source-view/discover.js";
import { parseSourceSyntax } from "../../lib/source-syntax.js";
import { sourceModuleReferences } from "./module-path.js";
import {
  resolvePathInside,
  assertRealPathInside,
} from "../../lib/path-boundary.js";
import {
  ROUTE_IGNORE_PATTERNS,
  ROUTE_SOURCE_PATTERNS,
  shouldIncludeRouteFilePath,
} from "../../lib/route-file-policy.js";
import { isExcludedConventionFileName } from "../../lib/project/source-roles.js";
import { collectSourceView } from "../source-view/collect.js";
import {
  assertSourceBudget,
  normalizeSourcePath,
  DEFAULT_SOURCE_LIMITS,
} from "../source-view/policy.js";
import {
  SourceViewError,
  type SourceFileRef,
  type RootRef,
  type SourceLimits,
  type SourceView,
} from "../source-view/types.js";

export const PROJECT_SOURCE_ROOT_ID = "project";
export type ProjectSourceRole = "route" | "service" | "plugin";

export interface ProjectSourceOptions {
  readonly rootId?: string;
  readonly directories?: Partial<Record<ProjectSourceRole, string>>;
  readonly limits?: Partial<SourceLimits>;
  readonly signal?: AbortSignal;
  /** 调用方明确登记的只读根；命名包的sourceExports须与其真实exports及消费者依赖一致。 */
  readonly sharedRoots?: readonly RootRef[];
}

const DIRECTORIES: Record<ProjectSourceRole, string> = {
  route: "src/routes",
  service: "src/services",
  plugin: "src/plugins",
};
const MODULE_PATTERNS = ["**/*.{ts,mts,cts,js,mjs,cjs}"];
const MODULE_IGNORE = [
  "**/node_modules/**",
  "**/_*/**",
  "**/_*",
  "**/.*",
  "**/.*/**",
  "**/*.d.{ts,mts,cts}",
  "**/*.test.*",
  "**/*.spec.*",
  "**/*.__vext_compiled__*",
];

export function projectSourceDirectory(
  role: ProjectSourceRole,
  options: ProjectSourceOptions = {},
): string {
  return normalizeSourcePath(options.directories?.[role] ?? DIRECTORIES[role]);
}

/** 在已封存的广义源码上投影真实 Loader 角色；不重新发现或读取文件。 */
export function projectConventionSourceView(
  view: SourceView,
  rootDir: string,
  options: ProjectSourceOptions = {},
): SourceView {
  const rootId = options.rootId ?? PROJECT_SOURCE_ROOT_ID;
  const records = view.list().map((record) => {
    if (record.rootId !== rootId) return record;
    for (const role of ["route", "service", "plugin"] as const) {
      const directory = projectSourceDirectory(role, options);
      if (!record.path.startsWith(directory + "/")) continue;
      const local = record.path.slice(directory.length + 1);
      const included =
        role === "route"
          ? shouldIncludeRouteFilePath(
              path.join(rootDir, record.path),
              path.join(rootDir, directory),
            )
          : /\.(?:ts|mts|cts|js|mjs|cjs)$/u.test(local) &&
            !local.split("/").some(isExcludedConventionFileName);
      if (included) return Object.freeze({ ...record, role });
    }
    return Object.freeze({ ...record, role: "source" });
  });
  const byKey = new Map(
    records.map((record) => [record.rootId + ":" + record.path, record]),
  );
  return Object.freeze({
    revision: view.revision,
    roots: () => view.roots(),
    list: (filter?: Parameters<SourceView["list"]>[0]) =>
      Object.freeze(
        records.filter(
          (record) =>
            (!filter?.rootId || record.rootId === filter.rootId) &&
            (!filter?.roles || filter.roles.includes(record.role)),
        ),
      ),
    record: (id: string, file: string) => byKey.get(id + ":" + file),
    read: (id: string, file: string) => view.read(id, file),
  });
}

export function declaredExport(exports: unknown, subpath: string): boolean {
  const targetExists = (target: unknown): boolean => {
    if (typeof target === "string")
      return (
        target.startsWith("./") && !target.slice(2).split("/").includes("..")
      );
    if (Array.isArray(target)) return target.some(targetExists);
    return (
      !!target &&
      typeof target === "object" &&
      Object.values(target).some(targetExists)
    );
  };
  if (!exports || typeof exports !== "object" || Array.isArray(exports))
    return subpath === "." && targetExists(exports);
  const entries = Object.entries(exports);
  if (!entries.some(([key]) => key.startsWith(".")))
    return subpath === "." && targetExists(exports);
  const exact = entries.find(([key]) => key === subpath);
  if (exact) return targetExists(exact[1]);
  const pattern = entries
    .filter(
      ([key]) =>
        key.includes("*") &&
        key.indexOf("*") === key.lastIndexOf("*") &&
        subpath.startsWith(key.slice(0, key.indexOf("*"))) &&
        subpath.endsWith(key.slice(key.indexOf("*") + 1)),
    )
    .sort(
      ([a], [b]) => b.indexOf("*") - a.indexOf("*") || b.length - a.length,
    )[0];
  return pattern !== undefined && targetExists(pattern[1]);
}

/** 有界发现普通目录与根内链接，逻辑路径和封存字节供全部静态消费者复用。 */
export async function collectProjectSources(
  rootDir: string,
  roles: readonly ProjectSourceRole[],
  options: ProjectSourceOptions = {},
): Promise<SourceView> {
  const signal = options.signal;
  const cancelled = () => {
    if (signal?.aborted)
      throw new SourceViewError(
        "VEXT_SOURCE_CANCELLED",
        "Project source discovery was cancelled.",
      );
  };
  cancelled();
  const realRoot = fs.realpathSync.native(rootDir);
  const rootId = options.rootId ?? PROJECT_SOURCE_ROOT_ID;
  const limits = projectSourceLimits(options.limits);
  const discoveryBudget = {
    entries: 0,
    limit: limits.maxScanEntries ?? DEFAULT_SOURCE_LIMITS.maxScanEntries!,
  };
  const roots: RootRef[] = [
    { id: rootId, kind: "service", realPath: realRoot },
    ...(options.sharedRoots ?? []).map((root) => {
      if (root.kind !== "shared")
        throw new SourceViewError(
          "VEXT_SOURCE_UNVERIFIED",
          "Additional source roots must be shared read roots.",
        );
      return { ...root, realPath: fs.realpathSync.native(root.realPath) };
    }),
  ];
  const hasPackages = roots.some((root) => root.packageName !== undefined);
  const files: SourceFileRef[] = hasPackages
    ? roots
        .filter(
          (root) => root.kind === "service" || root.packageName !== undefined,
        )
        .map((root) => ({
          rootId: root.id,
          path: "package.json",
          role: "source-package",
        }))
    : [];
  const packages = new Map<string, Record<string, unknown>>();
  const selected = [...new Set(roles)].sort();
  const definitions = selected.map((role) => ({
    role,
    directory: projectSourceDirectory(role, options),
    patterns: [...(role === "route" ? ROUTE_SOURCE_PATTERNS : MODULE_PATTERNS)],
    ignore: [...(role === "route" ? ROUTE_IGNORE_PATTERNS : MODULE_IGNORE)],
  }));
  for (const definition of definitions) {
    cancelled();
    const { role, directory } = definition;
    const absolute = resolvePathInside(
      realRoot,
      directory,
      "source role directory",
      { realpath: true },
    );
    let before;
    try {
      before = fs.statSync(absolute, { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (!before.isDirectory()) {
      throw new SourceViewError(
        "VEXT_SOURCE_UNVERIFIED",
        "Source role path is not a directory: " + directory + ".",
      );
    }
    for await (const relative of discoverSourceFiles(
      realRoot,
      directory,
      definition.patterns,
      definition.ignore,
      discoveryBudget,
      cancelled,
      (name) => !isExcludedConventionFileName(name),
    )) {
      assertSourceBudget(files.length + 1, 0, limits);
      files.push({
        rootId,
        path: normalizeSourcePath(directory + "/" + relative),
        role,
      });
    }
    const after = fs.statSync(absolute, { bigint: true });
    assertRealPathInside(realRoot, absolute, "source role directory");
    if (
      !after.isDirectory() ||
      after.dev !== before.dev ||
      after.ino !== before.ino
    ) {
      throw new SourceViewError(
        "VEXT_SOURCE_CHANGED",
        "Source role directory changed: " + directory + ".",
      );
    }
  }
  return collectSourceView({
    roots,
    files,
    rolePolicyVersion:
      "vext-project-roles-v1:" +
      createHash("sha256").update(JSON.stringify(definitions)).digest("hex"),
    limits,
    signal,
    dependencies(input, root) {
      if (input.role === "source-package") {
        const value: unknown = JSON.parse(
          Buffer.from(input.bytes)
            .toString("utf8")
            .replace(/^\uFEFF/u, ""),
        );
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new SourceViewError(
            "VEXT_SOURCE_UNVERIFIED",
            `Invalid source package metadata: ${root.id}/package.json.`,
          );
        const metadata = value as Record<string, unknown>;
        if (
          root.packageName !== undefined &&
          metadata.name !== root.packageName
        )
          throw new SourceViewError(
            "VEXT_SOURCE_UNVERIFIED",
            `Shared package name differs from its declaration: ${root.id}.`,
          );
        for (const subpath of Object.keys(root.sourceExports ?? {})) {
          if (!declaredExport(metadata.exports, subpath))
            throw new SourceViewError(
              "VEXT_SOURCE_UNVERIFIED",
              `sourceExports ${root.packageName}${subpath === "." ? "" : subpath.slice(1)} is not a declared package export.`,
            );
        }
        packages.set(root.id, metadata);
        return [];
      }
      if (!selected.includes("route") || !/\.[cm]?[jt]sx?$/u.test(input.path))
        return [];
      const program = parseSourceSyntax(
        input.path,
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          input.bytes,
        ),
      );
      const specifiers = program.body.flatMap((statement) => {
        if (
          (statement.type === "ImportDeclaration" &&
            statement.importKind !== "type") ||
          (statement.type === "ExportNamedDeclaration" &&
            statement.exportKind !== "type")
        ) {
          return statement.source ? [statement.source.value] : [];
        }
        return [];
      });
      return specifiers.flatMap((specifier) => {
        const candidates = sourceModuleReferences(roots, input, specifier);
        if (
          candidates.length > 1 &&
          new Set(candidates.map((candidate) => candidate.rootId)).size > 1
        )
          throw new SourceViewError(
            "VEXT_SOURCE_UNVERIFIED",
            `Ambiguous shared source import: ${specifier}.`,
          );
        const file = candidates.find((candidate) => {
          const targetRoot = roots.find(
            (item) => item.id === candidate.rootId,
          )!;
          if (!specifier.startsWith(".") && candidate.rootId !== input.rootId) {
            const metadata = packages.get(input.rootId);
            const declared = [
              "dependencies",
              "devDependencies",
              "peerDependencies",
              "optionalDependencies",
            ].some((kind) => {
              const dependencies = metadata?.[kind];
              return (
                dependencies &&
                typeof dependencies === "object" &&
                Object.hasOwn(dependencies, targetRoot.packageName!)
              );
            });
            if (!declared)
              throw new SourceViewError(
                "VEXT_SOURCE_UNVERIFIED",
                `Shared source package ${targetRoot.packageName} is not a declared dependency of ${root.id}.`,
              );
          }
          const absolute = resolvePathInside(
            targetRoot.realPath,
            candidate.path,
            "source import",
            { realpath: true },
          );
          try {
            return fs.statSync(absolute).isFile();
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
              return false;
            throw error;
          }
        });
        return file ? [file] : [];
      });
    },
  });
}
