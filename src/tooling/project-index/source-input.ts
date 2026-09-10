import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import micromatch from "micromatch";
import { parseSourceSyntax } from "../../lib/source-syntax.js";
import { sourceModuleReferences } from "./module-path.js";
import {
  resolvePathInside,
  assertRealPathInside,
} from "../../lib/path-boundary.js";
import {
  ROUTE_IGNORE_PATTERNS,
  ROUTE_SOURCE_PATTERNS,
} from "../../lib/route-file-policy.js";
import { isExcludedConventionFileName } from "../../lib/project/source-roles.js";
import { collectSourceView } from "../source-view/collect.js";
import {
  assertSourceBudget,
  normalizeSourcePath,
  resolveSourceLimits,
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

/** CLI、构建和类型生成共用宿主显式预算；纯SourceView本身不读取环境。 */
function projectSourceLimits(
  input: Partial<SourceLimits> = {},
): Readonly<SourceLimits> {
  const environment: Partial<SourceLimits> = {};
  const names = {
    maxFiles: "VEXT_SOURCE_MAX_FILES",
    maxFileBytes: "VEXT_SOURCE_MAX_FILE_BYTES",
    maxTotalBytes: "VEXT_SOURCE_MAX_TOTAL_BYTES",
    maxScanEntries: "VEXT_SOURCE_MAX_SCAN_ENTRIES",
  } as const;
  for (const [key, name] of Object.entries(names)) {
    const value = process.env[name];
    if (value === undefined || input[key as keyof SourceLimits] !== undefined)
      continue;
    if (!/^(?:0|[1-9]\d*)$/u.test(value))
      throw new SourceViewError(
        "VEXT_SOURCE_LIMIT",
        `Invalid source budget ${name}: expected a non-negative integer.`,
      );
    Object.assign(environment, { [key]: Number(value) });
  }
  return resolveSourceLimits({ ...environment, ...input });
}

function declaredExport(exports: unknown, subpath: string): boolean {
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

async function* discoverSourceFiles(
  root: string,
  directory: string,
  patterns: string[],
  ignore: string[],
  budget: { entries: number; limit: number },
  cancelled: () => void,
): AsyncGenerator<string> {
  const pending = [{ relative: "", ancestors: new Set<string>() }];
  while (pending.length) {
    cancelled();
    const current = pending.pop()!;
    const absolute = path.join(root, directory, current.relative);
    const real = assertRealPathInside(root, absolute, "source directory");
    const identity = process.platform === "win32" ? real.toLowerCase() : real;
    if (current.ancestors.has(identity))
      throw new SourceViewError(
        "VEXT_SOURCE_UNVERIFIED",
        `Source directory cycle: ${absolute}. Analysis is incomplete.`,
      );
    const ancestors = new Set([...current.ancestors, identity]);
    const before = fs.statSync(absolute, { bigint: true });
    // opendir逐条消费；超限/取消/失败时for-await负责关闭当前目录句柄。
    const handle = await fs.promises.opendir(absolute);
    for await (const entry of handle) {
      cancelled();
      if (++budget.entries > budget.limit)
        throw new SourceViewError(
          "VEXT_SOURCE_LIMIT",
          `Source discovery is incomplete at ${absolute}: exceeds ${budget.limit} entries. Adjust VEXT_SOURCE_MAX_SCAN_ENTRIES.`,
        );
      if (budget.entries % 16 === 0) {
        await yieldToEventLoop();
        cancelled();
      }
      const relative = path.posix.join(current.relative, entry.name);
      if (
        micromatch.isMatch(relative, ignore, { dot: true }) ||
        micromatch.isMatch(`${relative}/`, ignore, { dot: true })
      )
        continue;
      const target = path.join(absolute, entry.name);
      let isDirectory = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        assertRealPathInside(root, target, "linked source");
        isDirectory = fs.statSync(target).isDirectory();
        if (!isDirectory)
          throw new SourceViewError(
            "VEXT_SOURCE_UNVERIFIED",
            `Linked source file is unsupported: ${target}. Analysis is incomplete.`,
          );
      }
      if (isDirectory) pending.push({ relative, ancestors });
      else if (
        entry.isFile() &&
        !isExcludedConventionFileName(entry.name) &&
        micromatch.isMatch(relative, patterns)
      )
        yield relative;
    }
    const after = fs.statSync(absolute, { bigint: true });
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      fs.realpathSync.native(absolute) !== real
    )
      throw new SourceViewError(
        "VEXT_SOURCE_CHANGED",
        `Source directory changed: ${absolute}.`,
      );
  }
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
