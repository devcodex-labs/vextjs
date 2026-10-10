import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  inspectJobSource,
  type StaticJobDefinition,
} from "../../jobs/job-metadata.js";
import { inferJobName } from "../../jobs/job-name.js";
import {
  scanJobFiles,
  resolveJobsDirectory,
} from "../../jobs/job-discovery.js";
import type { VextJobsConfig } from "../../jobs/types.js";
import { parseSourceSyntax } from "../../source-syntax.js";
import type { SourceView } from "../../../tooling/source-view/types.js";
import { collectSourceView } from "../../../tooling/source-view/collect.js";
import { sourceModuleReferences } from "../../../tooling/project-index/module-path.js";
import { StaticModuleGraph } from "../../../tooling/project-index/static-module-graph.js";
import type { VextCodeDocItem, VextCodeDocsSourceConfig } from "../types.js";
import { parseJSDocSymbols } from "./jsdoc-parser.js";
import {
  isSourceEnabled,
  readSourceFile,
  sourceConfig,
  toPosixRelative,
} from "./source-utils.js";

export interface JobDocsSourceOptions {
  srcDir: string;
  rootDir?: string;
  jobsConfig?: VextJobsConfig;
  source: boolean | VextCodeDocsSourceConfig;
}

export async function loadJobCodeDocs(
  options: JobDocsSourceOptions,
): Promise<VextCodeDocItem[]> {
  if (!isSourceEnabled(options.source)) return [];
  const overrides = sourceConfig(options.source);
  const config = {
    dir: overrides.dir ?? options.jobsConfig?.dir,
    include: overrides.include ?? options.jobsConfig?.include,
    exclude: overrides.exclude ?? options.jobsConfig?.exclude,
  };
  const jobsDir = resolveJobsDirectory(
    options.srcDir,
    config.dir,
    options.rootDir,
  );
  const files = await scanJobFiles(jobsDir, config);
  if (!files.length) return [];
  const rootId = "job-docs";
  const root = {
    id: rootId,
    kind: "service" as const,
    realPath: options.srcDir,
  };
  // Dependencies remain inside the declared source root; never load node_modules.
  let view: SourceView;
  let graph: StaticModuleGraph;
  try {
    view = await collectSourceView({
      roots: [root],
      rolePolicyVersion: "job-docs-v1",
      files: files.map((file) => ({
        rootId,
        path: toPosixRelative(options.srcDir, file),
        role: "jobs",
      })),
      dependencies(input) {
        const program = parseSourceSyntax(
          input.path,
          Buffer.from(input.bytes).toString("utf8"),
        );
        return program.body.flatMap((statement) => {
          if (
            ![
              "ImportDeclaration",
              "ExportNamedDeclaration",
              "ExportAllDeclaration",
            ].includes(statement.type) ||
            !("source" in statement) ||
            !statement.source
          )
            return [];
          const candidates = sourceModuleReferences(
            [root],
            input,
            statement.source.value,
          );
          const selected = candidates.find((ref) =>
            existsSync(join(options.srcDir, ref.path)),
          );
          return selected ? [selected] : [];
        });
      },
    });
    graph = new StaticModuleGraph(view);
  } catch (error) {
    return files.map((file) =>
      unresolvedItem(toPosixRelative(options.srcDir, file), [String(error)]),
    );
  }
  const items: VextCodeDocItem[] = [];
  for (const file of files) {
    const sourceFile = toPosixRelative(options.srcDir, file);
    const inspection = inspectJobSource(
      sourceFile,
      view.read(rootId, sourceFile)!,
      { graph, rootId },
    );
    if (!inspection.definitions.length) {
      items.push({
        id: `job-source:${sourceFile}`,
        kind: "job",
        title: `jobs.${toPosixRelative(jobsDir, file)} (unresolved)`,
        sourceFile,
        summary:
          "No statically proven job export. Check the source and verify application startup.",
        job: {
          name: null,
          parseState: "partial",
          parseNotes: inspection.warnings,
        },
      });
    }
    for (const metadata of inspection.definitions) {
      const { definition, exportName, line, fieldStates } = metadata;
      const inferredName = inferJobName(
        toPosixRelative(jobsDir, file),
        exportName,
      );
      const name =
        fieldStates.name === "absent" ||
        (fieldStates.name === "known" && definition.name === undefined)
          ? inferredName
          : (string(definition.name) ?? null);
      const definitionSource =
        view.read(rootId, metadata.definitionFile) ??
        (await readSourceFile(file));
      const symbols = parseJSDocSymbols(definitionSource);
      const symbol =
        symbols.find((item) => item.exportName === exportName) ??
        symbols.find((item) => item.line === line);
      const docs =
        definition.docs && typeof definition.docs === "object"
          ? (definition.docs as Record<string, unknown>)
          : {};
      const description =
        string(docs.description) ?? string(definition.description);
      const tags = [definition.tags, docs.tags].flatMap((value) =>
        Array.isArray(value)
          ? value.filter((tag): tag is string => typeof tag === "string")
          : [],
      );
      items.push({
        id:
          name === null
            ? `job-source:${sourceFile}#${exportName}`
            : `job:${name}#${exportName}`,
        kind: "job",
        title: `jobs.${name ?? inferredName + " (name unknown)"}`,
        sourceFile,
        sourceLocation: {
          file: metadata.definitionFile,
          line: symbol?.line ?? line,
        },
        exportName,
        summary:
          symbol?.summary ??
          string(docs.summary) ??
          description ??
          `Scheduled job ${name ?? "(unknown name)"}.`,
        description: symbol?.description ?? description,
        params: symbol?.params,
        returns: symbol?.returns,
        throws: symbol?.throws,
        examples: symbol?.examples,
        deprecated: symbol?.deprecated,
        tags: [...new Set(["jobs", ...tags])],
        job: {
          name,
          inferredName,
          parseState: inspection.warnings.length
            ? "partial"
            : metadata.staticState,
          parseNotes: [
            ...new Set([...metadata.reasons, ...inspection.warnings]),
          ],
          fieldStates,
          enabled:
            typeof definition.enabled === "boolean"
              ? definition.enabled
              : undefined,
          cron: string(definition.cron),
          interval:
            typeof definition.interval === "number"
              ? definition.interval
              : undefined,
          timezone: string(definition.timezone),
          effectiveTimezone: effectiveTimezone(metadata, options.jobsConfig),
          schedulingEnabled:
            options.jobsConfig?.enabled === false
              ? false
              : fieldStates.enabled === "unknown"
                ? undefined
                : definition.enabled !== false,
        },
      });
    }
  }
  return items;
}
function effectiveTimezone(
  metadata: StaticJobDefinition,
  config?: VextJobsConfig,
): string | undefined {
  if (
    typeof metadata.definition.cron !== "string" ||
    metadata.fieldStates.timezone === "unknown"
  )
    return undefined;
  return string(metadata.definition.timezone) ?? config?.timezone ?? "UTC";
}
function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function unresolvedItem(
  sourceFile: string,
  warnings: string[],
): VextCodeDocItem {
  return {
    id: `job-source:${sourceFile}`,
    kind: "job",
    title: `jobs.${sourceFile} (unresolved)`,
    sourceFile,
    summary:
      "Job source evidence is unavailable; verify source boundaries and application startup.",
    job: { name: null, parseState: "partial", parseNotes: warnings },
  };
}
