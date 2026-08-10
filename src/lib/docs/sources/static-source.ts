import { join } from "node:path";
import { resolveProjectPreloadDirectory } from "../../preload/project-preload-paths.js";
import type { VextCodeDocItem, VextCodeDocsSourceConfig } from "../types.js";
import {
  isSourceEnabled,
  readSourceFile,
  scanCodeSourceFiles,
  sourceConfig,
  stripSourceExtension,
  toPosixRelative,
} from "./source-utils.js";

export interface StaticDocsSourceOptions {
  rootDir?: string;
  srcDir: string;
  source: boolean | VextCodeDocsSourceConfig;
}

export async function loadLocaleCodeDocs(
  options: StaticDocsSourceOptions,
): Promise<VextCodeDocItem[]> {
  if (!isSourceEnabled(options.source)) {
    return [];
  }

  const config = sourceConfig(options.source);
  const roots = config.dir
    ? [join(options.srcDir, config.dir)]
    : unique([
        join(options.srcDir, "locales"),
        join(options.srcDir, "frontend/locales"),
      ]);
  const items: VextCodeDocItem[] = [];

  for (const root of roots) {
    const files = await scanCodeSourceFiles(root, config);
    for (const file of files) {
      const source = await readSourceFile(file);
      const sourceFile = toPosixRelative(options.srcDir, file);
      const relativeKey = stripSourceExtension(toPosixRelative(root, file));
      const frontend = sourceFile.startsWith("frontend/locales/");
      const locale = relativeKey.split("/").pop() || relativeKey;
      const namespace = frontend
        ? "frontend"
        : relativeKey.split("/").slice(0, -1).join("/") || "root";
      const keys = extractObjectKeys(source);
      const keyPreview = keys.length > 0 ? ` Keys: ${formatList(keys)}.` : "";
      items.push({
        id: `locale:${frontend ? "frontend/" : ""}${relativeKey}#default`,
        kind: "locale",
        title: frontend
          ? `frontend.locales.${locale}`
          : `locales.${namespace}.${locale}`,
        sourceFile,
        sourceLocation: { file: sourceFile, line: 1 },
        exportName: "default",
        summary: `${frontend ? "Frontend" : "Backend"} locale resource for ${locale}.`,
        description: `${frontend ? "Frontend" : "Backend"} i18n messages from ${sourceFile}.${keyPreview}`,
        tags: ["locales", frontend ? "frontend" : "backend", locale],
      });
    }
  }
  return items;
}

export async function loadConfigCodeDocs(
  options: StaticDocsSourceOptions,
): Promise<VextCodeDocItem[]> {
  if (!isSourceEnabled(options.source)) {
    return [];
  }

  const config = sourceConfig(options.source);
  const configDir = join(options.srcDir, config.dir ?? "config");
  const files = await scanCodeSourceFiles(configDir, config);
  const items: VextCodeDocItem[] = [];

  for (const file of files) {
    const source = await readSourceFile(file);
    const sourceFile = toPosixRelative(options.srcDir, file);
    const relativeKey = stripSourceExtension(toPosixRelative(configDir, file));
    const sections = extractIndentedKeys(source, 2);
    items.push({
      id: `config:${relativeKey}#default`,
      kind: "config",
      title: `config/${relativeKey}`,
      sourceFile,
      sourceLocation: { file: sourceFile, line: 1 },
      exportName: "default",
      summary:
        relativeKey === "bootstrap"
          ? "Project bootstrap config hook."
          : `Runtime config profile ${relativeKey}.`,
      description:
        sections.length > 0
          ? `Detected top-level config sections: ${formatList(sections)}.`
          : "Project runtime config file.",
      tags: ["config"],
    });
  }
  return items;
}

export async function loadPreloadCodeDocs(
  options: StaticDocsSourceOptions,
): Promise<VextCodeDocItem[]> {
  if (!options.rootDir || !isSourceEnabled(options.source)) {
    return [];
  }

  const config = sourceConfig(options.source);
  const preloadDir = config.dir
    ? join(options.rootDir, config.dir)
    : resolveProjectPreloadDirectory(options.rootDir)?.path;
  if (!preloadDir) {
    return [];
  }
  const files = await scanCodeSourceFiles(preloadDir, config);
  const items: VextCodeDocItem[] = [];

  for (const file of files) {
    const source = await readSourceFile(file);
    const sourceFile = toPosixRelative(options.rootDir, file);
    const relativeKey = stripSourceExtension(toPosixRelative(preloadDir, file));
    const exports = extractExports(source);
    items.push({
      id: `preload:${relativeKey}#file`,
      kind: "preload",
      title: `preload/${relativeKey}`,
      sourceFile,
      sourceLocation: { file: sourceFile, line: 1 },
      exportName: "file",
      summary: "Project preload entry.",
      description:
        exports.length > 0
          ? `Preload module loaded before app bootstrap. Exports: ${formatList(exports)}.`
          : "Preload module loaded before app bootstrap.",
      tags: ["preload"],
    });
  }
  return items;
}

export async function loadStyleCodeDocs(
  options: StaticDocsSourceOptions,
): Promise<VextCodeDocItem[]> {
  if (!isSourceEnabled(options.source)) {
    return [];
  }

  const config = sourceConfig(options.source);
  const stylesDir = join(options.srcDir, config.dir ?? "frontend/styles");
  const files = await scanCodeSourceFiles(stylesDir, config);
  const items: VextCodeDocItem[] = [];

  for (const file of files) {
    const source = await readSourceFile(file);
    const sourceFile = toPosixRelative(options.srcDir, file);
    const relativeKey = stripSourceExtension(toPosixRelative(stylesDir, file));
    const exports = extractExports(source);
    items.push({
      id: `style:${relativeKey}#file`,
      kind: "style",
      title: `styles/${relativeKey}`,
      sourceFile,
      sourceLocation: { file: sourceFile, line: 1 },
      exportName: "file",
      summary: "Frontend style module.",
      description:
        exports.length > 0
          ? `Frontend style module. Exports: ${formatList(exports)}.`
          : "Frontend style module.",
      tags: ["styles", "frontend"],
    });
  }
  return items;
}

function extractObjectKeys(source: string): string[] {
  return unique([
    ...Array.from(source.matchAll(/['"]([A-Za-z0-9_.:-]+)['"]\s*:/gu)).map(
      (match) => match[1]!,
    ),
    ...extractIndentedKeys(source, 2),
  ]);
}

function extractIndentedKeys(source: string, spaces: number): string[] {
  const pattern = new RegExp(
    `^ {${spaces}}([A-Za-z_$][A-Za-z0-9_$-]*)\\s*:`,
    "gmu",
  );
  return unique(Array.from(source.matchAll(pattern)).map((match) => match[1]!));
}

function extractExports(source: string): string[] {
  return unique(
    Array.from(
      source.matchAll(
        /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s*([A-Za-z_$][\w$]*)?/gu,
      ),
    ).map((match) => match[1] ?? "default"),
  );
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function formatList(values: string[], limit = 8): string {
  const visible = values.slice(0, limit);
  const suffix =
    values.length > limit ? `, +${values.length - limit} more` : "";
  return visible.join(", ") + suffix;
}
