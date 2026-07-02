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

export interface MiddlewareDocsSourceOptions {
  srcDir: string;
  source: boolean | VextCodeDocsSourceConfig;
}

export async function loadMiddlewareCodeDocs(
  options: MiddlewareDocsSourceOptions,
): Promise<VextCodeDocItem[]> {
  if (!isSourceEnabled(options.source)) {
    return [];
  }

  const config = sourceConfig(options.source);
  const middlewaresDir = join(options.srcDir, config.dir ?? "middlewares");
  const files = await scanCodeSourceFiles(middlewaresDir, config);
  const items: VextCodeDocItem[] = [];

  for (const file of files) {
    const source = await readSourceFile(file);
    const symbols = parseJSDocSymbols(source);
    const sourceFile = toPosixRelative(options.srcDir, file);
    const relativeKey = stripSourceExtension(toPosixRelative(middlewaresDir, file));
    const details = extractMiddlewareDetails(source, relativeKey);
    const defaultSymbol = symbols.find((symbol) => symbol.exportName === "default");

    items.push({
      id: `middleware:${relativeKey}#default`,
      kind: "middleware",
      title: `middlewares.${relativeKey}`,
      sourceFile,
      sourceLocation: { file: sourceFile, line: defaultSymbol?.line },
      exportName: "default",
      summary:
        defaultSymbol?.summary ??
        `Middleware entry for middlewares.${relativeKey}.`,
      description:
        defaultSymbol?.description ??
        `Auto-detected middleware file ${sourceFile}. Add standard JSDoc above the default export to enrich this entry.`,
      params: defaultSymbol?.params,
      returns: defaultSymbol?.returns,
      throws: defaultSymbol?.throws,
      examples: defaultSymbol?.examples,
      deprecated: defaultSymbol?.deprecated,
      tags: ["middlewares"],
      middleware: details,
    });

    for (const symbol of symbols.filter((entry) => entry.exportName !== "default")) {
      items.push({
        id: `middleware:${relativeKey}#${symbol.exportName}`,
        kind: "middleware",
        title: `middlewares.${relativeKey}.${symbol.exportName}`,
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
        tags: ["middlewares"],
        middleware: details,
      });
    }
  }

  return items;
}

function extractMiddlewareDetails(source: string, name: string) {
  const hasFactoryCall =
    /\bdefineMiddlewareFactory\s*</u.test(source) ||
    /\bdefineMiddlewareFactory\s*\(/u.test(source);
  const hasMiddlewareCall = /\bdefineMiddleware\s*\(/u.test(source);
  const type = hasFactoryCall
    ? "factory"
    : hasMiddlewareCall
      ? "middleware"
      : "unknown";
  return {
    name,
    type,
    usage:
      type === "factory"
        ? `middlewares: [{ name: "${name}", options: { /* ... */ } }]`
        : `middlewares: ["${name}"]`,
  } as const;
}
