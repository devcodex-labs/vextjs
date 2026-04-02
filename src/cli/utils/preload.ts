import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * resolvePreloads — 扫描直接依赖的 vext.preload 字段
 *
 * 读取 <rootDir>/package.json 的 dependencies + devDependencies，
 * 遍历各依赖包的 package.json，收集 pkg.vext?.preload 字段，
 * 转换为 file:/// URL 数组（供 --import 使用）。
 *
 * 关键行为：
 *   - vext.preload 支持字符串或字符串数组
 *   - 路径基于 node_modules/<dep>/ 解析为绝对路径，再转 file:// URL
 *   - 任何包解析失败只 warn，不阻断启动
 *   - 预加载文件不存在时 warn 并跳过
 *   - 无依赖或无 preload 包时返回 []
 *
 * 使用示例（vextjs-opentelemetry/package.json）：
 *   { "vext": { "preload": "./dist/instrumentation.js" } }
 *
 * @param rootDir 用户项目根目录（含 package.json 和 node_modules/）
 * @returns file:/// URL 数组，用于 --import 参数注入
 *
 * @see 技术方案 §2.1 resolvePreloads 工具函数设计
 */
export function resolvePreloads(rootDir: string): string[] {
  // ── 1. 读取项目 package.json ──────────────────────────
  const pkgPath = join(rootDir, "package.json");
  if (!existsSync(pkgPath)) {
    return [];
  }

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(
      readFileSync(pkgPath, "utf-8"),
    ) as Record<string, unknown>;
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
      depPkg = JSON.parse(
        readFileSync(depPkgPath, "utf-8"),
      ) as Record<string, unknown>;
    } catch {
      console.warn(
        `[vextjs] preload: failed to parse ${depName}/package.json, skipping`,
      );
      continue;
    }

    // 提取 vext.preload（string | string[]）
    const vextField = depPkg.vext as Record<string, unknown> | undefined;
    if (!vextField?.preload) continue;

    const preloadField = vextField.preload;
    const relPaths: string[] =
      typeof preloadField === "string"
        ? [preloadField]
        : Array.isArray(preloadField)
          ? (preloadField as string[])
          : [];

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

