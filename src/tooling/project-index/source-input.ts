import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import fg from "fast-glob";
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
} from "../source-view/policy.js";
import {
  SourceViewError,
  type SourceFileRef,
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

/** 有界消费既有 glob 引擎；角色策略和采集字节供全部静态消费者复用。 */
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
  const limits = resolveSourceLimits(options.limits);
  const files: SourceFileRef[] = [];
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
    const stream = fg.stream(definition.patterns, {
      cwd: absolute,
      onlyFiles: true,
      followSymbolicLinks: false,
      suppressErrors: false,
      ignore: definition.ignore,
    });
    // fast-glob 的声明仅为旧 ReadableStream；确认实际能力后使用 Node 生命周期 API。
    if (!(stream instanceof Readable)) {
      throw new SourceViewError(
        "VEXT_SOURCE_UNVERIFIED",
        "Source discovery did not return a supported Node readable stream.",
      );
    }
    const abort = () =>
      stream.destroy(
        new SourceViewError(
          "VEXT_SOURCE_CANCELLED",
          "Project source discovery was cancelled.",
        ),
      );
    signal?.addEventListener("abort", abort, { once: true });
    try {
      cancelled();
      for await (const entry of stream) {
        cancelled();
        const relative = String(entry).replaceAll("\\", "/");
        if (isExcludedConventionFileName(path.posix.basename(relative)))
          continue;
        assertSourceBudget(files.length + 1, 0, limits);
        files.push({
          rootId,
          path: normalizeSourcePath(directory + "/" + relative),
          role,
        });
      }
    } finally {
      signal?.removeEventListener("abort", abort);
      stream.destroy();
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
    roots: [{ id: rootId, kind: "service", realPath: realRoot }],
    files,
    rolePolicyVersion:
      "vext-project-roles-v1:" +
      createHash("sha256").update(JSON.stringify(definitions)).digest("hex"),
    limits,
    signal,
  });
}
