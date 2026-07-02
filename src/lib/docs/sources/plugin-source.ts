import { join } from "node:path";
import type { VextCodeDocItem, VextCodeDocsSourceConfig } from "../types.js";
import { parseJSDocSymbols } from "./jsdoc-parser.js";
import {
  isSourceEnabled,
  readSourceFile,
  scanCodeSourceFiles,
  sourceConfig,
  stripSourceExtension,
  toPosixRelative,
} from "./source-utils.js";

export interface PluginDocsSourceOptions {
  srcDir: string;
  source: boolean | VextCodeDocsSourceConfig;
}

export async function loadPluginCodeDocs(
  options: PluginDocsSourceOptions,
): Promise<VextCodeDocItem[]> {
  if (!isSourceEnabled(options.source)) {
    return [];
  }

  const config = sourceConfig(options.source);
  const pluginsDir = join(options.srcDir, config.dir ?? "plugins");
  const files = await scanCodeSourceFiles(pluginsDir, config);
  const items: VextCodeDocItem[] = [];

  for (const file of files) {
    const source = await readSourceFile(file);
    const symbols = parseJSDocSymbols(source);
    const sourceFile = toPosixRelative(options.srcDir, file);
    const relativeKey = stripSourceExtension(toPosixRelative(pluginsDir, file));
    const details = extractPluginDetails(source, relativeKey);
    const defaultSymbol = symbols.find((symbol) => symbol.exportName === "default");

    items.push({
      id: `plugin:${details.name ?? relativeKey}#default`,
      kind: "plugin",
      title: `plugins.${details.name ?? relativeKey}`,
      sourceFile,
      sourceLocation: { file: sourceFile, line: defaultSymbol?.line },
      exportName: "default",
      summary:
        defaultSymbol?.summary ??
        `Plugin entry for plugins.${details.name ?? relativeKey}.`,
      description:
        defaultSymbol?.description ??
        `Auto-detected plugin file ${sourceFile}. Add standard JSDoc above the default export to enrich this entry.`,
      params: defaultSymbol?.params,
      returns: defaultSymbol?.returns,
      throws: defaultSymbol?.throws,
      examples: defaultSymbol?.examples,
      deprecated: defaultSymbol?.deprecated,
      tags: ["plugins"],
      plugin: details,
    });

    for (const symbol of symbols.filter((entry) => entry.exportName !== "default")) {
      items.push({
        id: `plugin:${details.name ?? relativeKey}#${symbol.exportName}`,
        kind: "plugin",
        title: `plugins.${details.name ?? relativeKey}.${symbol.exportName}`,
        sourceFile,
        sourceLocation: { file: sourceFile, line: symbol.line },
        exportName: symbol.exportName,
        summary: symbol.summary,
        description: symbol.description,
        params: symbol.params,
        returns: symbol.returns,
        throws: symbol.throws,
        examples: symbol.examples,
        deprecated: symbol.deprecated,
        tags: ["plugins"],
        plugin: details,
      });
    }
  }

  return items;
}

function extractPluginDetails(source: string, fallbackName: string) {
  const name = matchStringProperty(source, "name") ?? fallbackName;
  return {
    name,
    dependencies: matchStringArrayProperty(source, "dependencies"),
    after: matchStringArrayProperty(source, "after"),
    lifecycle: {
      setup: /\bsetup\s*\(/u.test(source),
      onReady: /\bonReady\s*\(/u.test(source),
      onClose: /\bonClose\s*\(/u.test(source),
    },
    extensions: Array.from(source.matchAll(/app\.extend\s*\(\s*["']([^"']+)["']/gu))
      .map((match) => match[1]!)
      .filter(Boolean),
    globalMiddlewares: /\bapp\.use\s*\(/u.test(source),
  };
}

function matchStringProperty(source: string, property: string): string | undefined {
  const pattern = new RegExp(`\\b${property}\\s*:\\s*["']([^"']+)["']`, "u");
  return source.match(pattern)?.[1];
}

function matchStringArrayProperty(
  source: string,
  property: string,
): string[] | undefined {
  const pattern = new RegExp(`\\b${property}\\s*:\\s*\\[([^\\]]*)\\]`, "u");
  const body = source.match(pattern)?.[1];
  if (!body) return undefined;
  const values = Array.from(body.matchAll(/["']([^"']+)["']/gu))
    .map((match) => match[1]!)
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}
