import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export interface ResolvePathInsideOptions {
  allowRoot?: boolean;
  realpath?: boolean;
}

const DEFAULT_PROTECTED_PROJECT_ROOTS = [
  ".git",
  ".github",
  "node_modules",
  "src",
  "test",
  "tests",
];

/** 写入归属与只读清单必须使用同一个真实项目身份，Windows 忽略大小写。 */
export function canonicalProjectRoot(rootDir: string): string {
  const real = normalizeNativePath(realpathSync.native(path.resolve(rootDir)));
  return process.platform === "win32" ? real.toLowerCase() : real;
}

/** 解析链接祖先但保留大小写；用于实际I/O路径，不能使用忽略大小写的身份键写文件。 */
export function physicalPath(filename: string): string {
  return normalizeNativePath(resolvePathThroughExistingAncestor(filename));
}

/** 已存在祖先取 realpath，保留尚未创建的末段；用于显式输出目标身份。 */
export function canonicalPath(filename: string): string {
  const real = physicalPath(filename);
  return process.platform === "win32" ? real.toLowerCase() : real;
}

/**
 * Normalizes a config or manifest path into a portable relative path.
 * Traversal is rejected instead of normalized away so the result is safe to
 * use as a canonical identity.
 */
export function normalizeSafeRelativePath(
  value: string,
  label: string,
): string {
  if (value.includes("\0")) {
    throw new Error(`[vextjs] ${label} must not contain NUL bytes.`);
  }
  if (
    value === "" ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    /^[A-Za-z]:/u.test(value)
  ) {
    throw new Error(`[vextjs] ${label} must be a non-empty relative path.`);
  }

  const portable = value.replace(/\\/gu, "/");
  const segments = portable.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new Error(
      `[vextjs] ${label} must not contain empty, ".", or ".." path segments.`,
    );
  }
  return segments.join("/");
}

export function isPathInside(
  rootDir: string,
  candidatePath: string,
  allowRoot = false,
): boolean {
  const root = normalizeNativePath(path.resolve(rootDir));
  const candidate = normalizeNativePath(path.resolve(candidatePath));
  const relative = path.relative(root, candidate);
  if (relative === "") return allowRoot;
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export function assertPathInside(
  rootDir: string,
  candidatePath: string,
  label: string,
  allowRoot = false,
): string {
  const candidate = path.resolve(candidatePath);
  if (!isPathInside(rootDir, candidate, allowRoot)) {
    throw new Error(
      `[vextjs] ${label} must resolve inside ${path.resolve(rootDir)}.`,
    );
  }
  return candidate;
}

export function assertRealPathInside(
  rootDir: string,
  candidatePath: string,
  label: string,
  allowRoot = false,
): string {
  const root = resolvePathThroughExistingAncestor(rootDir);
  const candidate = resolvePathThroughExistingAncestor(candidatePath);
  if (!isPathInside(root, candidate, allowRoot)) {
    throw new Error(
      `[vextjs] ${label} must remain inside ${path.resolve(rootDir)} after resolving symbolic links.`,
    );
  }
  return candidate;
}

export function resolvePathInside(
  rootDir: string,
  relativePath: string,
  label: string,
  options: ResolvePathInsideOptions = {},
): string {
  const normalized = normalizeSafeRelativePath(relativePath, label);
  const candidate = assertPathInside(
    rootDir,
    path.resolve(rootDir, ...normalized.split("/")),
    label,
    options.allowRoot ?? false,
  );
  if (options.realpath) {
    assertRealPathInside(rootDir, candidate, label, options.allowRoot ?? false);
  }
  return candidate;
}

export function assertSafeProjectOutputDirectory(
  projectRoot: string,
  outputDir: string,
  label: string,
  protectedRoots: readonly string[] = DEFAULT_PROTECTED_PROJECT_ROOTS,
): string {
  const root = path.resolve(projectRoot);
  const output = assertPathInside(root, outputDir, label);

  for (const relativeProtectedRoot of protectedRoots) {
    const protectedRoot = path.resolve(root, relativeProtectedRoot);
    if (
      isPathInside(protectedRoot, output, true) ||
      isPathInside(output, protectedRoot, true)
    ) {
      throw new Error(
        `[vextjs] ${label} must not overlap protected project path ${relativeProtectedRoot}.`,
      );
    }
  }

  assertRealPathInside(root, output, label);
  return output;
}

/** 显式输出可位于服务外；不扩大相对文件读取边界，也不允许覆盖其他包或服务源码。 */
export function assertExplicitOutputDirectory(
  projectRoot: string,
  outputDir: string,
  label: string,
): string {
  const root = path.resolve(projectRoot);
  const output = path.resolve(root, outputDir);
  if (isPathInside(root, output))
    return assertSafeProjectOutputDirectory(root, output, label);
  const realRoot = canonicalProjectRoot(root);
  const realOutput = canonicalPath(output);
  if (
    isPathInside(realOutput, realRoot, true) ||
    realOutput === path.parse(realOutput).root
  ) {
    throw new Error(
      `[vextjs] ${label} must be a dedicated output directory, not a project ancestor or filesystem root.`,
    );
  }
  // 输出指向项目内的链接仍须通过同一源码保护检查。
  if (isPathInside(realRoot, realOutput)) {
    assertSafeProjectOutputDirectory(realRoot, realOutput, label);
    return output;
  }
  const protectedNames = new Set([
    ...DEFAULT_PROTECTED_PROJECT_ROOTS,
    ".devcodex",
    "storage",
  ]);
  for (let cursor = realOutput; ; cursor = path.dirname(cursor)) {
    if (protectedNames.has(path.basename(cursor)))
      throw new Error(
        `[vextjs] ${label} overlaps a protected external path: ${cursor}.`,
      );
    const metadata = path.join(cursor, "package.json");
    if (
      existsSync(metadata) &&
      !isPathInside(cursor, realRoot, true) &&
      !isOutputModuleBoundary(metadata)
    ) {
      throw new Error(`[vextjs] ${label} overlaps another package: ${cursor}.`);
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
  }
  return output;
}

function isOutputModuleBoundary(file: string): boolean {
  // 编译器生成的单字段文件只选择JS模块格式，不声明另一个包或源码范围。
  const stat = lstatSync(file);
  return (
    stat.isFile() &&
    !stat.isSymbolicLink() &&
    stat.size <= 256 &&
    /^\s*\{\s*"type"\s*:\s*"commonjs"\s*\}\s*$/u.test(
      readFileSync(file, "utf8"),
    ) &&
    !["src", "test", "tests", ".git"].some((name) =>
      existsSync(path.join(path.dirname(file), name)),
    )
  );
}

function resolvePathThroughExistingAncestor(value: string): string {
  let cursor = path.resolve(value);
  const missingSegments: string[] = [];

  while (true) {
    try {
      const real = realpathSync.native(cursor);
      return path.resolve(real, ...missingSegments);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missingSegments.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

function normalizeNativePath(value: string): string {
  const resolved = path.resolve(value);
  if (process.platform !== "win32") return resolved;
  if (/^\\\\\?\\UNC\\/iu.test(resolved)) return `\\\\${resolved.slice(8)}`;
  if (/^\\\\\?\\/u.test(resolved)) return resolved.slice(4);
  return resolved;
}
