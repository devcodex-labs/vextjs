import { existsSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

export interface LocaleSource {
  locale: string;
  namespace: string;
  file: string;
  absolutePath: string;
  layout: "flat" | "module";
}

export const LOCALE_EXTENSIONS = new Set([
  ".ts",
  ".js",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
  ".json",
]);

/** 使用 BCP 47 标准化，拒绝任意文件名被误当成语言。 */
export function canonicalLocale(value: string): string | undefined {
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/i.test(value)) return undefined;
  try {
    return Intl.getCanonicalLocales(value)[0];
  } catch {
    return undefined;
  }
}

/** 在加载字典前识别扩展名、大小写及 Unicode 路径别名。 */
export function scanLocaleSources(directory: string): LocaleSource[] {
  if (!existsSync(directory)) return [];
  const root = realpathSync(directory);
  const result: LocaleSource[] = [];
  const owners = new Map<string, string>();
  const walk = (relative: string): void => {
    const entries = readdirSync(path.join(root, relative), {
      withFileTypes: true,
    }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const file = path.posix.join(relative, entry.name);
      const absolutePath = path.join(root, file);
      if (entry.isSymbolicLink())
        throw new Error(
          `[vextjs] Locale source must not be a symlink: ${absolutePath}`,
        );
      if (entry.isDirectory()) {
        walk(file);
        continue;
      }
      const ext = path.extname(entry.name);
      if (
        !entry.isFile() ||
        !LOCALE_EXTENSIONS.has(ext) ||
        /\.(?:d|test|spec)\.[cm]?[jt]s$/.test(entry.name)
      )
        continue;
      const locale = canonicalLocale(path.basename(entry.name, ext));
      if (!locale) continue;
      const namespace = relative
        .split("/")
        .filter(Boolean)
        .map((segment) => segment.normalize("NFC"))
        .join(".");
      const identity = `${locale}:${namespace}`.toLowerCase();
      const previous = owners.get(identity);
      if (previous)
        throw new Error(
          `[vextjs] Duplicate locale source ${locale}:${namespace}: ${previous} and ${file}`,
        );
      owners.set(identity, file);
      result.push({
        locale,
        namespace,
        file,
        absolutePath,
        layout: namespace ? "module" : "flat",
      });
    }
  };
  walk("");
  return result;
}
