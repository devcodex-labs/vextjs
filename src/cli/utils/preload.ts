import { readFileSync, existsSync, realpathSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveConsumerPackage } from "../../lib/consumer-resolver.js";
import { assertRealPathInside } from "../../lib/path-boundary.js";
import { withProjectOwner } from "../../lib/project/owner.js";
import {
  withArtifactTransaction,
  type ArtifactCandidate,
} from "../../lib/project/artifact-transaction.js";
import {
  DIST_PRELOAD_DIR,
  formatLegacyProjectPreloadWarning,
  resolveProjectPreloadDirectory,
} from "../../lib/preload/project-preload-paths.js";

const PRELOAD_CACHE_DIR = ".vext/preload";

const PROJECT_PRELOAD_EXTENSIONS = new Set([".mjs", ".js", ".ts", ".mts"]);
const JS_PRELOAD_EXTENSIONS = new Set([".mjs", ".js"]);
const TS_PRELOAD_EXTENSIONS = new Set([".ts", ".mts"]);

/**
 * resolvePreloads — 解析项目级 + 包级 preload 列表
 *
 * 解析顺序：
 *   1. src/preload/ 目录（项目级 preload；根 preload/ 仅兼容旧项目）
 *   2. package.json 直接依赖中的 vext.preload（包级 preload）
 *   3. 合并后按绝对路径去重
 *
 * 关键行为：
 *   - 项目级 preload 支持 .mjs / .js / .ts / .mts
 *   - .ts / .mts 会在启动前编译到 .vext/preload/*.mjs 再注入
 *   - 包级 vext.preload 支持字符串或字符串数组
 *   - 路径基于当前服务实际解析的依赖包根（含 hoisted/pnpm），再转 file:// URL
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
export async function resolvePreloads(
  rootDir: string,
  options: { builtOutDir?: string } = {},
): Promise<string[]> {
  const projectFiles = options.builtOutDir
    ? await resolvePreloadDirectory(
        options.builtOutDir,
        join(options.builtOutDir, "preload"),
      )
    : await resolveProjectPreloads(rootDir);
  const projectPreloads = await compileProjectPreloads(
    rootDir,
    projectFiles,
    options.builtOutDir === undefined,
  );
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
  const sourceDirectory = resolveProjectPreloadDirectory(rootDir);
  if (sourceDirectory) {
    if (sourceDirectory.kind === "legacy" && sourceDirectory.hasSourceFiles) {
      console.warn(formatLegacyProjectPreloadWarning());
    }
    const sourcePreloads = await resolvePreloadDirectory(
      rootDir,
      sourceDirectory.path,
    );
    if (sourcePreloads.length > 0) {
      return sourcePreloads;
    }
  }

  const distPreloadDir = join(rootDir, DIST_PRELOAD_DIR);
  return resolvePreloadDirectory(rootDir, distPreloadDir);
}

async function resolvePreloadDirectory(
  readRoot: string,
  preloadDir: string,
): Promise<string[]> {
  // start先验证构建身份；compiled读取边界是该产物根，依赖解析仍由服务rootDir负责。
  assertRealPathInside(readRoot, preloadDir, "project preload directory");
  const entries = await readdir(preloadDir, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
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

    assertRealPathInside(readRoot, fullPath, "project preload file");
    if (JS_PRELOAD_EXTENSIONS.has(extension)) {
      preloads.push(fullPath);
      continue;
    }

    if (TS_PRELOAD_EXTENSIONS.has(extension)) {
      preloads.push(fullPath);
    }
  }

  return preloads;
}

async function compileProjectPreloads(
  rootDir: string,
  files: readonly string[],
  cleanSourceCache: boolean,
): Promise<string[]> {
  const cacheDir = join(rootDir, PRELOAD_CACHE_DIR);
  const compiled = new Map<string, string>();
  const sources = new Map<string, string>();
  for (const file of files) {
    if (!TS_PRELOAD_EXTENSIONS.has(extname(file).toLowerCase())) continue;
    const stem = basename(file).replace(/\.(mts|ts)$/i, "");
    const output = resolve(cacheDir, `${stem}.__compiled__.mjs`);
    const key = process.platform === "win32" ? output.toLowerCase() : output;
    const previous = sources.get(key);
    if (previous) {
      throw new Error(
        `[vextjs] preload: ${previous} and ${file} target the same compiled file: ${output}`,
      );
    }
    sources.set(key, file);
    compiled.set(file, output);
  }
  const urls = () =>
    files.map((file) => pathToFileURL(compiled.get(file) ?? file).href);
  // 纯读取不登记写者；源列表清空后仍回收已有归属，绝不按扩展名删除未知文件。
  if (compiled.size === 0 && (!cleanSourceCache || !existsSync(cacheDir)))
    return urls();
  return withProjectOwner(rootDir, "build", [cacheDir], () =>
    withArtifactTransaction(
      { rootDir, outDir: cacheDir, producer: "preload-cache" },
      async (transaction) => {
        const candidates: ArtifactCandidate[] = [];
        for (const [file, output] of compiled) {
          candidates.push(
            await compileProjectTypeScriptPreload(rootDir, file, output),
          );
        }
        await transaction.commit(candidates);
        return urls();
      },
    ),
  );
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
    let depPkg: Record<string, unknown>;
    let depDir: string;
    try {
      const resolved = resolveConsumerPackage(rootDir, depName);
      depPkg = resolved.manifest;
      depDir = resolved.rootDir;
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
      const absPath = resolve(depDir, relPath);

      if (!existsSync(absPath)) {
        console.warn(
          `[vextjs] preload: file not found: ${absPath} (from ${depName}), skipping`,
        );
        continue;
      }

      // 转换为 file:// URL（--import 对 URL 语义最稳定，跨平台 Windows/Unix 一致）
      preloads.push(pathToFileURL(realpathSync(absPath)).href);
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
  compiledFile: string,
): Promise<ArtifactCandidate> {
  const { build } = await import("esbuild");
  const tsconfigPath = join(rootDir, "tsconfig.json");

  try {
    const result = await build({
      entryPoints: [filePath],
      bundle: true,
      packages: "external",
      format: "esm",
      platform: "node",
      target: "node20",
      write: false,
      outfile: compiledFile,
      logLevel: "silent",
      ...(existsSync(tsconfigPath) ? { tsconfig: tsconfigPath } : {}),
    });
    const output = result.outputFiles?.[0];
    if (!output || result.outputFiles.length !== 1) {
      throw new Error("Expected one compiled preload module.");
    }
    return { path: compiledFile, contents: output.contents, source: filePath };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : `Unknown error: ${String(error)}`;
    throw new Error(
      `[vextjs] preload: failed to compile TypeScript preload ${filePath}\n${message}`,
    );
  }
}
