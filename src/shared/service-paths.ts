import { dirname, extname, relative, sep } from "node:path";
import { isExcludedConventionFileName } from "../lib/project/source-roles.js";

/**
 * 支持的 service 文件扩展名
 */
export const SUPPORTED_SERVICE_EXTENSIONS = new Set([
  ".ts",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
]);

/**
 * shouldExcludeServiceFileName — 判断 service 文件是否应被排除
 *
 * 该 helper 位于 runtime/tooling 中立层，供 `service-loader` 与 `typegen`
 * 共同复用，避免扫描语义漂移，也避免 runtime 反向依赖 tooling。
 */
export function shouldExcludeServiceFileName(filename: string): boolean {
  return isExcludedConventionFileName(filename);
}

/**
 * filePathToServiceKeys — 文件路径 → service key 数组
 */
export function filePathToServiceKeys(
  filePath: string,
  servicesDir: string,
): string[] {
  let rel = relative(servicesDir, filePath);
  rel = rel.split(sep).join("/");

  const ext = extname(rel);
  rel = rel.slice(0, -ext.length);

  return rel.split("/").map(toCamelCaseSegment);
}

/**
 * toCamelCaseSegment — 将 kebab-case 路径段转为 camelCase
 */
export function toCamelCaseSegment(segment: string): string {
  return segment.replace(/-([a-z])/g, (_match, c: string) => c.toUpperCase());
}

/**
 * toGeneratedImportPath — 从 generated 声明文件到源码文件的 import 路径
 *
 * 声明指回用户源码，遵循 NodeNext 的扩展名替换规则；
 * 后端 esbuild 编译产物的 CJS/.js 映射不适用于这里。
 */
export function toGeneratedImportPath(
  generatedFilePath: string,
  sourceFilePath: string,
): string {
  let rel = relative(dirname(generatedFilePath), sourceFilePath)
    .split(sep)
    .join("/");
  rel = rel.replace(/\.(ts|mts|cts)$/u, (_match, extension: string) =>
    extension === "mts" ? ".mjs" : extension === "cts" ? ".cjs" : ".js",
  );

  if (!rel.startsWith(".")) {
    rel = `./${rel}`;
  }

  return rel;
}
