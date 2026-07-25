import { dirname, extname, relative, sep } from "node:path";

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
  // Match plugin-loader: hide private/hidden files from convention scanning.
  if (filename.startsWith("_") || filename.startsWith(".")) return true;
  if (filename.includes(".test.") || filename.includes(".spec.")) return true;
  if (filename.endsWith(".d.ts")) return true;
  if (filename.includes(".__vext_compiled__")) return true;
  return false;
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
 * TypeScript / NodeNext 用户项目源码通常使用 `.js` 扩展名引用源码模块，
 * 因此这里统一将源文件扩展名归一为 `.js`。
 */
export function toGeneratedImportPath(
  generatedFilePath: string,
  sourceFilePath: string,
): string {
  let rel = relative(dirname(generatedFilePath), sourceFilePath)
    .split(sep)
    .join("/");
  rel = rel.replace(/\.(ts|mts|cts|js|mjs|cjs)$/u, ".js");

  if (!rel.startsWith(".")) {
    rel = `./${rel}`;
  }

  return rel;
}
