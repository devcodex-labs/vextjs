import { existsSync } from "node:fs";
import { join } from "node:path";
import fg from "fast-glob";
import { resolveModelEntry } from "../../plugins/monsqlize/model-loader.js";
import type { VextCodeDocItem, VextCodeDocsSourceConfig } from "../types.js";
import { parseJSDocSymbols } from "./jsdoc-parser.js";
import {
  isSourceEnabled,
  readSourceFile,
  sourceConfig,
  toPosixRelative,
} from "./source-utils.js";
import { extractStaticModelDocs } from "./model-static-parser.js";

export interface ModelDocsSourceOptions {
  srcDir: string;
  modelsDir?: string;
  source: boolean | VextCodeDocsSourceConfig;
}

export async function loadModelCodeDocs(
  options: ModelDocsSourceOptions,
): Promise<VextCodeDocItem[]> {
  if (!isSourceEnabled(options.source)) {
    return [];
  }

  const config = sourceConfig(options.source);
  const modelsDir = join(
    options.srcDir,
    config.dir ?? options.modelsDir ?? "models",
  );
  const files = await scanModelSourceFiles(modelsDir, config);
  const items: VextCodeDocItem[] = [];

  for (const file of files) {
    const source = await readSourceFile(file);
    const symbols = parseJSDocSymbols(source);
    const staticDocs = extractStaticModelDocs(source);
    const sourceFile = toPosixRelative(options.srcDir, file);
    const relativeFile = toPosixRelative(modelsDir, file);
    const entry = resolveModelEntry(relativeFile, {});
    const runtimeEntry = resolveModelEntry(relativeFile, staticDocs.definition);
    if (!entry) {
      continue;
    }
    const modelKey = entry.registryKey;
    const defaultSymbol = symbols.find((symbol) => symbol.exportName === "default");

    items.push(
      createModelDocItem(
        modelKey,
        sourceFile,
        defaultSymbol,
        staticDocs,
        runtimeEntry ?? entry,
      ),
    );

    for (const symbol of symbols.filter((entry) => entry.exportName !== "default")) {
      items.push({
        id: `model:${modelKey}#${symbol.exportName}`,
        kind: "model",
        title: `models.${modelKey}.${symbol.exportName}`,
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
        tags: ["models"],
      });
    }
  }
  return items;
}

function createModelDocItem(
  modelKey: string,
  sourceFile: string,
  symbol:
    | ReturnType<typeof parseJSDocSymbols>[number]
    | undefined,
  staticDocs: ReturnType<typeof extractStaticModelDocs>,
  runtimeEntry: NonNullable<ReturnType<typeof resolveModelEntry>>,
): VextCodeDocItem {
  const model = {
    ...staticDocs.details,
    registryKey: runtimeEntry.registryKey,
    name:
      typeof runtimeEntry.finalDef.name === "string"
        ? runtimeEntry.finalDef.name
        : staticDocs.details.name,
    collection:
      typeof runtimeEntry.finalDef.collection === "string"
        ? runtimeEntry.finalDef.collection
        : staticDocs.details.collection,
    connection: isStringRecord(runtimeEntry.finalDef.connection)
      ? runtimeEntry.finalDef.connection
      : staticDocs.details.connection,
    depth: runtimeEntry.depth,
    usage: createModelUsage(runtimeEntry),
  };
  return {
    id: `model:${modelKey}#default`,
    kind: "model",
    title: `models.${modelKey}`,
    sourceFile,
    sourceLocation: {
      file: sourceFile,
      line: symbol?.line ?? staticDocs.defaultExportLine,
    },
    exportName: "default",
    summary: symbol?.summary ?? `Model entry for models.${modelKey}.`,
    description:
      symbol?.description ??
      `Auto-detected model file ${sourceFile}. Add standard JSDoc above the default export to enrich this entry.`,
    params: symbol?.params,
    returns: symbol?.returns,
    throws: symbol?.throws,
    examples: symbol?.examples,
    deprecated: symbol?.deprecated,
    tags: ["models"],
    model,
  };
}

function createModelUsage(
  runtimeEntry: NonNullable<ReturnType<typeof resolveModelEntry>>,
): string {
  const connection = runtimeEntry.finalDef.connection;
  const modelName =
    typeof runtimeEntry.finalDef.name === "string"
      ? runtimeEntry.finalDef.name
      : runtimeEntry.registryKey;
  if (isStringRecord(connection) && connection.pool && connection.database) {
    return `const Model = app.db.pool("${connection.pool}").use("${connection.database}").model("${modelName}");`;
  }
  if (isStringRecord(connection) && connection.database) {
    return `const Model = app.db.use("${connection.database}").model("${modelName}");`;
  }
  return `const Model = app.db.model("${runtimeEntry.registryKey}");`;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

async function scanModelSourceFiles(
  modelsDir: string,
  config: VextCodeDocsSourceConfig,
): Promise<string[]> {
  if (!existsSync(modelsDir)) {
    return [];
  }
  const include = config.include ?? ["**/*.{ts,js,mjs,cjs}"];
  const files = await fg(include, {
    cwd: modelsDir,
    absolute: true,
    onlyFiles: true,
    ignore: [
      "**/_*.{ts,js,mjs,cjs}",
      "**/*.d.ts",
      "**/*.test.{ts,js,mjs,cjs}",
      "**/*.spec.{ts,js,mjs,cjs}",
      ...(config.exclude ?? []),
    ],
  });
  return files.sort();
}
