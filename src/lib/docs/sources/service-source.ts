import { basename, extname, join } from "node:path";
import {
  filePathToServiceKeys,
  shouldExcludeServiceFileName,
  SUPPORTED_SERVICE_EXTENSIONS,
} from "../../../shared/service-paths.js";
import type { VextCodeDocItem, VextCodeDocsSourceConfig } from "../types.js";
import { parseJSDocSymbols } from "./jsdoc-parser.js";
import {
  isSourceEnabled,
  readSourceFile,
  scanCodeSourceFiles,
  sourceConfig,
  toPosixRelative,
} from "./source-utils.js";

export interface ServiceDocsSourceOptions {
  srcDir: string;
  source: boolean | VextCodeDocsSourceConfig;
}

export async function loadServiceCodeDocs(
  options: ServiceDocsSourceOptions,
): Promise<VextCodeDocItem[]> {
  if (!isSourceEnabled(options.source)) {
    return [];
  }

  const config = sourceConfig(options.source);
  const servicesDir = join(options.srcDir, config.dir ?? "services");
  const files = (await scanCodeSourceFiles(servicesDir, config)).filter(
    (file) =>
      SUPPORTED_SERVICE_EXTENSIONS.has(extname(file)) &&
      !shouldExcludeServiceFileName(basename(file)),
  );

  const items: VextCodeDocItem[] = [];
  for (const file of files) {
    const symbols = parseJSDocSymbols(await readSourceFile(file));
    const serviceKey = filePathToServiceKeys(file, servicesDir).join(".");
    const sourceFile = toPosixRelative(options.srcDir, file);
    for (const symbol of symbols) {
      items.push({
        id: `service:${serviceKey}#${symbol.exportName}`,
        kind: "service",
        title: `services.${serviceKey}.${symbol.exportName}`,
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
        tags: ["services"],
      });
    }
  }
  return items;
}
