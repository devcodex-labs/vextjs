import { relative } from "node:path";
import { SourceViewError } from "../source-view/types.js";
import { normalizeSourcePath } from "../source-view/policy.js";
import {
  parseSourceSyntax,
  walkSourceSyntax,
  type SyntaxNode,
} from "../../lib/source-syntax.js";
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
    const collected = collectDependencies(source, entry, knownKeys);
    graph.set(entry.serviceKey, collected.dependencies);
    if (collected.incomplete) incompleteFiles.push(entry.filePath);
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

  return { diagnostics, graph, incompleteFiles };
}

function collectDependencies(
  source: string,
  entry: ServiceIndexEntry,
  knownKeys: Set<string>,
): { dependencies: Set<string>; incomplete: boolean } {
  const deps = new Set<string>();
  let incomplete = false;
  const chain = (node: SyntaxNode): (string | null)[] | undefined => {
    if (node.type === "Identifier") return [node.name];
    if (node.type === "ThisExpression") return ["this"];
    if (node.type !== "MemberExpression") return undefined;
    const parent = chain(node.object);
    if (!parent) return undefined;
    const key =
      !node.computed && node.property.type === "Identifier"
        ? node.property.name
        : node.property.type === "Literal" &&
            typeof node.property.value === "string"
          ? node.property.value
          : null;
    return [...parent, key];
  };
  walkSourceSyntax(parseSourceSyntax(entry.filePath, source), (node) => {
    if (node.type !== "MemberExpression") return;
    const parts = chain(node);
    if (!parts) return;
    const offset =
      parts[0] === "app" && parts[1] === "services"
        ? 2
        : parts[0] === "this" && parts[1] === "app" && parts[2] === "services"
          ? 3
          : 0;
    if (!offset) return;
    const keys = parts.slice(offset);
    if (keys.length === 0 || keys.some((key) => key === null))
      incomplete = true;
    const candidates = [...knownKeys]
      .filter((key) => {
        const segments = key.split(".");
        return (
          segments.length <= keys.length &&
          segments.every((segment, i) => keys[i] === segment)
        );
      })
      .sort((a, b) => b.length - a.length);
    const dependency = candidates[0];
    if (dependency && dependency !== entry.serviceKey) deps.add(dependency);
    if (!dependency && keys.length > 0) incomplete = true;
    // Consume the complete member chain once; comments and strings never become edges.
    return false;
  });
  return { dependencies: deps, incomplete };
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
