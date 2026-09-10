import { relative } from "node:path";
import { SourceViewError } from "../source-view/types.js";
import { normalizeSourcePath } from "../source-view/policy.js";
import {
  buildProjectIndex,
  type ProjectIndex,
  type ServiceIndexEntry,
} from "../project-index/index.js";

type ServiceDepLevel = "error" | "warn" | "info";

export interface ServiceDependencyDiagnostic {
  level: ServiceDepLevel;
  message: string;
  sourceFile: string;
  serviceKey?: string;
  relatedKeys?: string[];
}

export interface ServiceDependencyReport {
  diagnostics: ServiceDependencyDiagnostic[];
  graph: Map<string, Set<string>>;
}

export async function analyzeServiceDependencies(
  rootDir: string,
  options: { index?: ProjectIndex } = {},
): Promise<ServiceDependencyReport> {
  const index = options.index ?? (await buildProjectIndex(rootDir));
  return analyzeIndexedServiceDependencies(index);
}

/** 依赖分析与类型生成共用索引的源码代次，不重新读盘。 */
export function analyzeIndexedServiceDependencies(
  index: ProjectIndex,
): ServiceDependencyReport {
  const knownKeys = new Set(
    index.serviceEntries.map((entry) => entry.serviceKey),
  );
  const graph = new Map<string, Set<string>>();

  for (const entry of index.serviceEntries) {
    const sourcePath = normalizeSourcePath(
      relative(index.source.rootDir, entry.filePath),
    );
    const record = index.source.view.record(index.source.rootId, sourcePath);
    const source = index.source.view.read(index.source.rootId, sourcePath);
    if (record?.role !== "service" || source === undefined) {
      throw new SourceViewError(
        "VEXT_SOURCE_UNVERIFIED",
        "Indexed service source is absent from its sealed view: " +
          sourcePath +
          ".",
      );
    }
    graph.set(entry.serviceKey, collectDependencies(source, entry, knownKeys));
  }

  const diagnostics: ServiceDependencyDiagnostic[] = [];
  detectCycles(graph, diagnostics, index.serviceEntries);

  if (diagnostics.length === 0 && index.serviceEntries.length > 0) {
    diagnostics.push({
      level: "info",
      message: `Path service dependency check passed (${index.serviceEntries.length} service(s))`,
      sourceFile: index.serviceEntries[0]!.filePath,
    });
  }

  return { diagnostics, graph };
}

function collectDependencies(
  source: string,
  entry: ServiceIndexEntry,
  knownKeys: Set<string>,
): Set<string> {
  const deps = new Set<string>();
  const accessPattern =
    /(?:\bapp|this\.app)\.services((?:\.[A-Za-z_$][\w$]*)+)/gu;

  for (const match of source.matchAll(accessPattern)) {
    const dep = (match[1] ?? "").split(".").filter(Boolean).join(".");
    if (!dep || dep === entry.serviceKey || !knownKeys.has(dep)) {
      continue;
    }
    deps.add(dep);
  }

  return deps;
}

function detectCycles(
  graph: Map<string, Set<string>>,
  diagnostics: ServiceDependencyDiagnostic[],
  entries: ServiceIndexEntry[],
): void {
  const entryMap = new Map(entries.map((entry) => [entry.serviceKey, entry]));
  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    if (stack.has(node)) {
      const cycleStart = path.indexOf(node);
      const cycle = [...path.slice(cycleStart), node];
      const sourceFile = entryMap.get(node)?.filePath ?? "unknown";
      diagnostics.push({
        level: "error",
        message: `Circular service dependency detected: ${cycle.join(" -> ")}`,
        sourceFile,
        serviceKey: node,
        relatedKeys: cycle,
      });
      return;
    }

    if (visited.has(node)) return;

    visited.add(node);
    stack.add(node);
    path.push(node);

    for (const dep of graph.get(node) ?? []) {
      dfs(dep, [...path]);
    }

    stack.delete(node);
    path.pop();
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  }
}
