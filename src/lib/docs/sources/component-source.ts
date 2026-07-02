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

export interface ComponentDocsSourceOptions {
  srcDir: string;
  source: boolean | VextCodeDocsSourceConfig;
}

export async function loadComponentCodeDocs(
  options: ComponentDocsSourceOptions,
): Promise<VextCodeDocItem[]> {
  if (!isSourceEnabled(options.source)) {
    return [];
  }

  const config = sourceConfig(options.source);
  const componentsDir = join(options.srcDir, config.dir ?? "frontend/components");
  const files = await scanCodeSourceFiles(componentsDir, config);
  const items: VextCodeDocItem[] = [];

  for (const file of files) {
    const symbols = parseJSDocSymbols(await readSourceFile(file));
    const sourceFile = toPosixRelative(options.srcDir, file);
    const relativeKey = stripSourceExtension(
      toPosixRelative(componentsDir, file),
    );
    for (const symbol of symbols) {
      items.push({
        id: `component:${relativeKey}#${symbol.exportName}`,
        kind: "component",
        title: `components/${relativeKey}#${symbol.exportName}`,
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
        tags: ["components"],
      });
    }
  }
  return items;
}
