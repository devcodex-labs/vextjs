import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, relative, sep } from "node:path";
import fg from "fast-glob";
import type { VextCodeDocsSourceConfig } from "../types.js";

export const CODE_DOCS_SOURCE_EXTENSIONS = [
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
];

export function isSourceEnabled(
  source: boolean | VextCodeDocsSourceConfig,
): boolean {
  if (typeof source === "boolean") {
    return source;
  }
  return source.enabled !== false;
}

export function sourceConfig(
  source: boolean | VextCodeDocsSourceConfig,
): VextCodeDocsSourceConfig {
  return typeof source === "boolean" ? {} : source;
}

export async function scanCodeSourceFiles(
  dir: string,
  config: VextCodeDocsSourceConfig,
): Promise<string[]> {
  if (!existsSync(dir)) {
    return [];
  }
  const include =
    config.include ?? [`**/*.{${CODE_DOCS_SOURCE_EXTENSIONS.join(",")}}`];
  const exclude = [
    "**/*.d.ts",
    "**/*.test.*",
    "**/*.spec.*",
    "**/*.__vext_compiled__*",
    ...(config.exclude ?? []),
  ];
  return fg(include, {
    cwd: dir,
    absolute: true,
    onlyFiles: true,
    ignore: exclude,
  });
}

export async function readSourceFile(file: string): Promise<string> {
  return readFile(file, "utf8");
}

export function toPosixRelative(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}

export function stripSourceExtension(file: string): string {
  const ext = extname(file);
  return ext ? file.slice(0, -ext.length) : file;
}
