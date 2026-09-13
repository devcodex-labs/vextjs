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

export interface JobDocsSourceOptions {
  srcDir: string;
  source: boolean | VextCodeDocsSourceConfig;
}

export async function loadJobCodeDocs(
  options: JobDocsSourceOptions,
): Promise<VextCodeDocItem[]> {
  if (!isSourceEnabled(options.source)) return [];
  const config = sourceConfig(options.source);
  const jobsDir = join(options.srcDir, config.dir ?? "jobs");
  const files = await scanCodeSourceFiles(jobsDir, config);
  const items: VextCodeDocItem[] = [];
  for (const file of files) {
    const source = await readSourceFile(file);
    const symbols = parseJSDocSymbols(source);
    const sourceFile = toPosixRelative(options.srcDir, file);
    const relativeKey = stripSourceExtension(toPosixRelative(jobsDir, file))
      .replace(/\/index$/u, "")
      .replaceAll("/", ".");
    const explicit = extractDefineJobMetadata(source);
    const jobName = explicit.name ?? relativeKey;
    const baseItem = {
      id: `job:${jobName}#default`,
      kind: "job" as const,
      title: `jobs.${jobName}`,
      sourceFile,
      sourceLocation: { file: sourceFile, line: explicit.line ?? 1 },
      exportName: "default",
      summary: explicit.description ?? `Job entry for jobs.${jobName}.`,
      description:
        explicit.description ??
        `Auto-detected job file ${sourceFile}. Add standard JSDoc above defineJob() to enrich this entry.`,
      tags: ["jobs", ...(explicit.tags ?? [])],
      job: {
        name: jobName,
        timeout: explicit.timeout,
        concurrency: explicit.concurrency,
        schedule: explicit.schedule,
        queue: explicit.queue,
        hasPayloadSchema: explicit.hasPayloadSchema,
        usage: `vext job run ${jobName}`,
      },
    } satisfies VextCodeDocItem;
    const defaultSymbol = symbols.find(
      (symbol) => symbol.exportName === "default",
    );
    items.push(
      defaultSymbol
        ? {
            ...baseItem,
            sourceLocation: { file: sourceFile, line: defaultSymbol.line },
            summary: defaultSymbol.summary ?? baseItem.summary,
            description: defaultSymbol.description ?? baseItem.description,
            params: defaultSymbol.params,
            returns: defaultSymbol.returns,
            throws: defaultSymbol.throws,
            examples: defaultSymbol.examples,
            deprecated: defaultSymbol.deprecated,
          }
        : baseItem,
    );
    for (const symbol of symbols) {
      if (symbol.exportName === "default") continue;
      items.push({
        id: `job:${jobName}#${symbol.exportName}`,
        kind: "job",
        title: `jobs.${jobName}.${symbol.exportName}`,
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
        tags: ["jobs", ...(explicit.tags ?? [])],
        job: {
          name:
            symbol.exportName === "default"
              ? jobName
              : `${jobName}.${symbol.exportName}`,
          usage: `vext job run ${jobName}`,
        },
      });
    }
  }
  return items;
}

function extractDefineJobMetadata(source: string): {
  name?: string;
  description?: string;
  tags?: string[];
  timeout?: number;
  concurrency?: number;
  schedule?: {
    cron?: string;
    interval?: number;
    timezone?: string;
    singleton?: boolean;
  };
  queue?: {
    enabled?: boolean;
    priority?: number;
  };
  hasPayloadSchema?: boolean;
  line?: number;
} {
  const match = source.match(/defineJob\s*\(\s*\{/u);
  const before = match ? source.slice(0, match.index) : "";
  const line = match ? before.split(/\r?\n/u).length : undefined;
  return {
    name: readStringProperty(source, "name"),
    description: readStringProperty(source, "description"),
    tags: readStringArrayProperty(source, "tags"),
    timeout: readNumberProperty(source, "timeout"),
    concurrency: readNumberProperty(source, "concurrency"),
    schedule: {
      cron: readNestedStringProperty(source, "schedule", "cron"),
      interval: readNestedNumberProperty(source, "schedule", "interval"),
      timezone: readNestedStringProperty(source, "schedule", "timezone"),
      singleton: readNestedBooleanProperty(source, "schedule", "singleton"),
    },
    queue: {
      enabled: readNestedBooleanProperty(source, "queue", "enabled"),
      priority: readNestedNumberProperty(source, "queue", "priority"),
    },
    hasPayloadSchema: /\bpayload\s*:/u.test(source),
    line,
  };
}

function readStringProperty(source: string, key: string): string | undefined {
  const match = new RegExp(
    `\\b${key}\\s*:\\s*(["'])((?:\\\\.|(?!\\1).)*)\\1`,
    "u",
  ).exec(source);
  return match?.[2];
}

function readNumberProperty(source: string, key: string): number | undefined {
  const match = new RegExp(`\\b${key}\\s*:\\s*(\\d+)`, "u").exec(source);
  return match ? Number(match[1]) : undefined;
}

function readNestedStringProperty(
  source: string,
  objectKey: string,
  key: string,
): string | undefined {
  return readStringProperty(readObjectBody(source, objectKey), key);
}

function readNestedNumberProperty(
  source: string,
  objectKey: string,
  key: string,
): number | undefined {
  return readNumberProperty(readObjectBody(source, objectKey), key);
}

function readNestedBooleanProperty(
  source: string,
  objectKey: string,
  key: string,
): boolean | undefined {
  const match = new RegExp(`\\b${key}\\s*:\\s*(true|false)`, "u").exec(
    readObjectBody(source, objectKey),
  );
  return match ? match[1] === "true" : undefined;
}

function readObjectBody(source: string, key: string): string {
  const match = new RegExp(`\\b${key}\\s*:\\s*\\{([\\s\\S]*?)\\}`, "u").exec(
    source,
  );
  return match?.[1] ?? "";
}

function readStringArrayProperty(
  source: string,
  key: string,
): string[] | undefined {
  const match = new RegExp(`\\b${key}\\s*:\\s*\\[([^\\]]*)\\]`, "u").exec(
    source,
  );
  if (!match) return undefined;
  return [...match[1]!.matchAll(/(["'])((?:\\.|(?!\1).)*)\1/gu)].map(
    (item) => item[2]!,
  );
}
