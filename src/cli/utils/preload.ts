import { readFileSync, existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT_PRELOAD_DIR = "preload";
const DIST_PRELOAD_DIR = "dist/preload";
const PRELOAD_CACHE_DIR = ".vext/preload";

const PROJECT_PRELOAD_EXTENSIONS = new Set([".mjs", ".js", ".ts", ".mts"]);
const JS_PRELOAD_EXTENSIONS = new Set([".mjs", ".js"]);
const TS_PRELOAD_EXTENSIONS = new Set([".ts", ".mts"]);

/**
 * resolvePreloads — 解析项目级 + 包级 preload 列表
 *
 * 解析顺序：
 *   1. 项目根 preload/ 目录（项目级 preload）
 *   2. package.json 直接依赖中的 vext.preload（包级 preload）
 *   3. 合并后按绝对路径去重
 *
 * 关键行为：
 *   - 项目级 preload 支持 .mjs / .js / .ts / .mts
 *   - .ts / .mts 会在启动前编译到 .vext/preload/*.mjs 再注入
 *   - 包级 vext.preload 支持字符串或字符串数组
 *   - 路径基于 node_modules/<dep>/ 解析为绝对路径，再转 file:// URL
 *   - 包级 preload 解析失败只 warn，不阻断启动
 *   - 项目级 TS preload 编译失败视为启动前错误，直接抛出
 *
 * 使用示例（@devcodex/opentelemetry/package.json）：
 *   { "vext": { "preload": "./dist/instrumentation.js" } }
 *
 * @param rootDir 用户项目根目录（含 package.json 和 node_modules/）
 * @returns file:/// URL 数组，用于 --import 参数注入
 *
 * @see 技术方案 §2.1 resolvePreloads 工具函数设计
 */
export async function resolvePreloads(rootDir: string): Promise<string[]> {
  const projectPreloads = await resolveProjectPreloads(rootDir);
  const packagePreloads = resolvePackagePreloads(rootDir);

  const merged = [...projectPreloads, ...packagePreloads];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const fileUrl of merged) {
    const dedupeKey = fileURLToPath(fileUrl);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push(fileUrl);
  }

  return result;
}

async function resolveProjectPreloads(rootDir: string): Promise<string[]> {
  const preloadDir = resolveProjectPreloadDir(rootDir);
  if (!preloadDir) {
    return [];
  }

  const entries = await readdir(preloadDir, { withFileTypes: true });
  const sortedEntries = [...entries].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const preloads: string[] = [];

  for (const entry of sortedEntries) {
    const fullPath = join(preloadDir, entry.name);

    if (!entry.isFile()) {
      console.warn(
        `[vextjs] preload: unsupported project preload entry: ${fullPath} (not a regular file), skipping`,
      );
      continue;
    }

    const extension = extname(entry.name).toLowerCase();
    if (!PROJECT_PRELOAD_EXTENSIONS.has(extension)) {
      console.warn(
        `[vextjs] preload: unsupported project preload extension: ${fullPath}, skipping`,
      );
      continue;
    }

    if (JS_PRELOAD_EXTENSIONS.has(extension)) {
      preloads.push(pathToFileURL(fullPath).href);
      continue;
    }

    if (TS_PRELOAD_EXTENSIONS.has(extension)) {
      preloads.push(await compileProjectTypeScriptPreload(rootDir, fullPath));
    }
  }

  return preloads;
}

function resolveProjectPreloadDir(rootDir: string): string | null {
  const projectPreloadDir = join(rootDir, PROJECT_PRELOAD_DIR);
  if (existsSync(projectPreloadDir)) {
    return projectPreloadDir;
  }

  const distPreloadDir = join(rootDir, DIST_PRELOAD_DIR);
  if (existsSync(distPreloadDir)) {
    return distPreloadDir;
  }

  return null;
}

function resolvePackagePreloads(rootDir: string): string[] {
  // ── 1. 读取项目 package.json ──────────────────────────
  const pkgPath = join(rootDir, "package.json");
  if (!existsSync(pkgPath)) {
    return [];
  }

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
  } catch {
    console.warn(
      "[vextjs] preload: failed to parse package.json, skipping preload resolution",
    );
    return [];
  }

  // ── 2. 提取所有直接依赖键名（仅扫描直接依赖，不递归）──
  const deps = Object.keys({
    ...((pkg.dependencies as Record<string, string> | undefined) ?? {}),
    ...((pkg.devDependencies as Record<string, string> | undefined) ?? {}),
  });

  if (deps.length === 0) {
    return [];
  }

  // ── 3. 遍历依赖，收集 vext.preload 字段 ──────────────
  const preloads: string[] = [];

  for (const depName of deps) {
    const depPkgPath = join(rootDir, "node_modules", depName, "package.json");
    if (!existsSync(depPkgPath)) continue;

    let depPkg: Record<string, unknown>;
    try {
      depPkg = JSON.parse(readFileSync(depPkgPath, "utf-8")) as Record<
        string,
        unknown
      >;
    } catch {
      console.warn(
        `[vextjs] preload: failed to parse ${depName}/package.json, skipping`,
      );
      continue;
    }

    // 提取 vext.preload（string | string[]）
    const vextField =
      typeof depPkg.vext === "object" && depPkg.vext !== null
        ? (depPkg.vext as Record<string, unknown>)
        : undefined;
    if (
      !vextField ||
      !Object.prototype.hasOwnProperty.call(vextField, "preload")
    ) {
      continue;
    }

    const relPaths = normalizePackagePreloadPaths(depName, vextField.preload);

    for (const relPath of relPaths) {
      const depDir = join(rootDir, "node_modules", depName);
      const absPath = resolve(depDir, relPath);

      if (!existsSync(absPath)) {
        console.warn(
          `[vextjs] preload: file not found: ${absPath} (from ${depName}), skipping`,
        );
        continue;
      }

      // 转换为 file:// URL（--import 对 URL 语义最稳定，跨平台 Windows/Unix 一致）
      preloads.push(pathToFileURL(absPath).href);
    }
  }

  return preloads;
}

function normalizePackagePreloadPaths(
  depName: string,
  preloadField: unknown,
): string[] {
  if (typeof preloadField === "string") {
    return [preloadField];
  }

  if (!Array.isArray(preloadField)) {
    console.warn(
      `[vextjs] preload: invalid ${depName}/package.json vext.preload: expected string or string[], received ${describePreloadValue(preloadField)}, skipping`,
    );
    return [];
  }

  const relPaths: string[] = [];
  for (const [index, entry] of preloadField.entries()) {
    if (typeof entry === "string") {
      relPaths.push(entry);
      continue;
    }

    console.warn(
      `[vextjs] preload: invalid ${depName}/package.json vext.preload[${index}]: expected string, received ${describePreloadValue(entry)}, skipping`,
    );
  }

  return relPaths;
}

function describePreloadValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

async function compileProjectTypeScriptPreload(
  rootDir: string,
  filePath: string,
): Promise<string> {
  const { build } = await import("esbuild");
  const cacheDir = join(rootDir, PRELOAD_CACHE_DIR);
  await mkdir(cacheDir, { recursive: true });

  const filename = basename(filePath).replace(/\.(mts|ts)$/i, "");
  const compiledFile = join(cacheDir, `${filename}.__compiled__.mjs`);
  const tsconfigPath = join(rootDir, "tsconfig.json");

  try {
    await build({
      entryPoints: [filePath],
      bundle: true,
      packages: "external",
      format: "esm",
      platform: "node",
      target: "node20",
      write: true,
      outfile: compiledFile,
      logLevel: "silent",
      ...(existsSync(tsconfigPath) ? { tsconfig: tsconfigPath } : {}),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : `Unknown error: ${String(error)}`;
    throw new Error(
      `[vextjs] preload: failed to compile TypeScript preload ${filePath}\n${message}`,
    );
  }

  return pathToFileURL(resolve(compiledFile)).href;
}
