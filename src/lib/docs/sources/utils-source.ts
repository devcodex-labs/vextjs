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

export interface UtilsDocsSourceOptions {
  srcDir: string;
  source: boolean | VextCodeDocsSourceConfig;
}

export async function loadUtilsCodeDocs(
  options: UtilsDocsSourceOptions,
): Promise<VextCodeDocItem[]> {
  if (!isSourceEnabled(options.source)) {
    return [];
  }

  const config = sourceConfig(options.source);
  const utilsDir = join(options.srcDir, config.dir ?? "utils");
  const files = await scanCodeSourceFiles(utilsDir, config);
  const items: VextCodeDocItem[] = [];

  for (const file of files) {
    const symbols = parseJSDocSymbols(await readSourceFile(file));
    const sourceFile = toPosixRelative(options.srcDir, file);
    const relativeKey = stripSourceExtension(toPosixRelative(utilsDir, file));
    for (const symbol of symbols) {
      items.push({
        id: `utils:${relativeKey}#${symbol.exportName}`,
        kind: "utils",
        title: `utils/${relativeKey}#${symbol.exportName}`,
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
        tags: ["utils"],
      });
    }
  }
  return items;
}
