import { statSync, type Stats } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { isPathInside } from "../path-boundary.js";
import { resolveProjectRolePath } from "../project/layout.js";
import { classifyChange, type ClassifierOptions } from "./change-classifier.js";

/** 仅用于发现变更；编译缓存另以源码字节 SHA256 判断 freshness。 */
export type WatchSnapshot = ReadonlyMap<string, string>;

export interface WatchTarget {
  recursive: boolean;
  identity: string;
}

interface WatchDirectory {
  path: string;
  recursive: boolean;
  allFiles: boolean;
}

const ROOT_COLD_FILES = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "tsconfig.json",
]);

export function isMissingWatchPath(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function optionalStat(file: string): Stats | undefined {
  try {
    return statSync(file);
  } catch (error) {
    if (isMissingWatchPath(error)) return undefined;
    throw error;
  }
}

function watchDirectories(
  root: string,
  options?: ClassifierOptions,
): WatchDirectory[] {
  const directories: WatchDirectory[] = [
    {
      path: resolveProjectRolePath(root, root, "src", "dev source directory"),
      recursive: true,
      allFiles: false,
    },
    {
      path: resolveProjectRolePath(
        root,
        root,
        "preload",
        "dev preload directory",
      ),
      recursive: false,
      allFiles: false,
    },
    {
      path: resolveProjectRolePath(
        root,
        root,
        "public",
        "dev public directory",
      ),
      recursive: true,
      allFiles: true,
    },
  ];
  const extra = [
    ...(options?.frontendDirectories ?? []),
    ...(options?.frontendFiles ?? []).map((file) => dirname(file)),
  ];
  for (const value of new Set(extra)) {
    const directory = resolveProjectRolePath(
      root,
      root,
      value,
      "dev watch directory",
    );
    if (
      !isPathInside(root, directory) ||
      ["src", "public", ".vext", ".git", "node_modules", "dist", "build"].some(
        (name) => isPathInside(join(root, name), directory, true),
      )
    )
      continue;
    directories.push({ path: directory, recursive: true, allFiles: true });
  }
  return directories;
}

/** 独立构建快照；任何未知读错误都交给调用方，不能变成“目录为空”。 */
export async function readWatchSnapshot(
  root: string,
  options?: ClassifierOptions,
): Promise<WatchSnapshot> {
  const snapshot = new Map<string, string>();
  const visited = new Set<string>();
  // 项目根必须存在；可选角色目录缺失才表示空目录。
  const rootEntries = await readdir(root, { withFileTypes: true });
  const addFile = (file: string) => {
    const stat = optionalStat(file);
    if (!stat?.isFile()) return;
    snapshot.set(
      relative(root, file).replaceAll("\\", "/"),
      `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`,
    );
  };
  const walk = async (directory: WatchDirectory): Promise<void> => {
    const visitKey = `${directory.path}:${directory.allFiles}:${directory.recursive}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);
    let entries;
    try {
      entries = await readdir(directory.path, { withFileTypes: true });
    } catch (error) {
      if (isMissingWatchPath(error)) return;
      throw error;
    }
    for (const entry of entries.sort((a, b) =>
      a.name.localeCompare(b.name, "en"),
    )) {
      const file = join(directory.path, entry.name);
      const allFiles =
        directory.allFiles ||
        classifyChange(relative(root, file), options).action === "client";
      if (entry.isDirectory()) {
        if (
          directory.recursive &&
          (allFiles || !entry.name.startsWith(".")) &&
          !["node_modules", ".git", ".vext"].includes(entry.name)
        )
          await walk({ path: file, recursive: true, allFiles });
      } else if (
        entry.isFile() &&
        (allFiles ||
          /\.(ts|mts|cts|tsx|js|jsx|mjs|cjs|json|css|html|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot)$/.test(
            entry.name,
          ))
      ) {
        addFile(file);
      }
    }
  };
  for (const directory of watchDirectories(root, options))
    await walk(directory);
  for (const entry of rootEntries) {
    if (ROOT_COLD_FILES.has(entry.name) || /^\.env(\..+)?$/.test(entry.name))
      addFile(join(root, entry.name));
  }
  for (const value of options?.frontendFiles ?? []) {
    const file = resolveProjectRolePath(root, root, value, "dev watch file");
    if (isPathInside(root, file)) addFile(file);
  }
  return snapshot;
}

/** 原生监听只挂载受控角色；缺失角色由最近的现存父目录捕获创建事件。 */
export function readWatchTargets(
  root: string,
  options?: ClassifierOptions,
): Map<string, WatchTarget> {
  const rootStat = statSync(root);
  if (!rootStat.isDirectory())
    throw new Error("[vext dev] watch root must be a directory");
  const targets = new Map<string, WatchTarget>([
    [
      root,
      {
        recursive: false,
        identity: `${rootStat.dev}:${rootStat.ino}`,
      },
    ],
  ]);
  for (const directory of watchDirectories(root, options)) {
    let target = directory.path;
    let stat = optionalStat(target);
    while (!stat?.isDirectory() && isPathInside(root, target)) {
      target = dirname(target);
      stat = optionalStat(target);
    }
    if (target === root || !stat?.isDirectory()) continue;
    const recursive = directory.recursive || target !== directory.path;
    const current = targets.get(target);
    targets.set(target, {
      recursive: recursive || current?.recursive === true,
      identity: `${stat.dev}:${stat.ino}`,
    });
  }
  for (const target of [...targets.keys()]) {
    if (
      [...targets].some(
        ([parent, value]) =>
          parent !== target && value.recursive && isPathInside(parent, target),
      )
    )
      targets.delete(target);
  }
  return targets;
}
