import { StaticModuleGraph } from "../project-index/static-module-graph.js";
import { relative } from "node:path";
import { SourceViewError } from "../source-view/types.js";
import { normalizeSourcePath } from "../source-view/policy.js";
import {
  collectServiceDependencies,
  findServiceDependencyCycles,
} from "../../lib/service-dependencies.js";
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
  incompleteFiles: string[];
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
  const incompleteFiles: string[] = [];

  const modules = new StaticModuleGraph(index.source.view);
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
    let resolved: Parameters<typeof collectServiceDependencies>[4];
    try {
      const expression = modules.exported(index.source.rootId, sourcePath);
      resolved = {
        program: expression.module.program,
        definition: expression.node,
      };
    } catch {
      /* CJS/动态导出继续使用原单文件分析，未知保持 incomplete。 */
    }
    const collected = collectServiceDependencies(
      source,
      entry.filePath,
      entry.serviceKey,
      knownKeys,
      resolved,
    );
    graph.set(entry.serviceKey, collected.dependencies);
    if (collected.incomplete) incompleteFiles.push(entry.filePath);
  }

  const diagnostics: ServiceDependencyDiagnostic[] = [];
  for (const sourceFile of incompleteFiles)
    diagnostics.push({
      level: "warn",
      sourceFile,
      message:
        "Service dependency analysis is incomplete: app injection or service access could not be resolved statically.",
    });
  detectCycles(graph, diagnostics, index.serviceEntries);

  if (diagnostics.length === 0 && index.serviceEntries.length > 0) {
    diagnostics.push({
      level: "info",
      message: `Path service dependency check passed (${index.serviceEntries.length} service(s))`,
      sourceFile: index.serviceEntries[0]!.filePath,
    });
  }

  return { diagnostics, graph, incompleteFiles };
}

function detectCycles(
  graph: Map<string, Set<string>>,
  diagnostics: ServiceDependencyDiagnostic[],
  entries: ServiceIndexEntry[],
): void {
  const entryMap = new Map(entries.map((entry) => [entry.serviceKey, entry]));
  for (const cycle of findServiceDependencyCycles(graph)) {
    const serviceKey = cycle[0]!;
    diagnostics.push({
      level: "error",
      message: `Circular service dependency detected: ${cycle.join(" -> ")}`,
      sourceFile: entryMap.get(serviceKey)?.filePath ?? "unknown",
      serviceKey,
      relatedKeys: cycle,
    });
  }
}
