import { buildProjectIndex, type ServiceIndexEntry } from "../project-index/index.js";
import { loadTsMorph } from "../shared/lazy-ts-morph.js";

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
): Promise<ServiceDependencyReport> {
  const index = await buildProjectIndex(rootDir);
  const tsMorph = await loadTsMorph();
  const knownKeys = new Set(index.serviceEntries.map((entry) => entry.serviceKey));
  const graph = new Map<string, Set<string>>();

  for (const entry of index.serviceEntries) {
    graph.set(entry.serviceKey, collectDependencies(entry, knownKeys, tsMorph));
  }

  const diagnostics: ServiceDependencyDiagnostic[] = [];
  detectCycles(graph, diagnostics, index.serviceEntries);

  if (diagnostics.length === 0 && index.serviceEntries.length > 0) {
    diagnostics.push({
      level: "info",
      message: `AST service dependency check passed (${index.serviceEntries.length} service(s))`,
      sourceFile: index.serviceEntries[0]!.filePath,
    });
  }

  return { diagnostics, graph };
}

function collectDependencies(
  entry: ServiceIndexEntry,
  knownKeys: Set<string>,
  tsMorph: typeof import("ts-morph"),
): Set<string> {
  const deps = new Set<string>();
  const nodes = entry.sourceFile.getDescendantsOfKind(
    tsMorph.SyntaxKind.PropertyAccessExpression,
  );

  for (const node of nodes) {
    const dep = extractServiceAccessPath(node, tsMorph);
    if (!dep || dep === entry.serviceKey || !knownKeys.has(dep)) {
      continue;
    }
    deps.add(dep);
  }

  return deps;
}

function extractServiceAccessPath(
  node: import("ts-morph").PropertyAccessExpression,
  tsMorph: typeof import("ts-morph"),
): string | null {
  const segments: string[] = [];
  let current: import("ts-morph").Node = node;

  while (tsMorph.Node.isPropertyAccessExpression(current)) {
    segments.unshift(current.getName());
    current = current.getExpression();
  }

  if (
    tsMorph.Node.isIdentifier(current) &&
    current.getText() === "app" &&
    segments[0] === "services" &&
    segments.length >= 2
  ) {
    return segments.slice(1).join(".");
  }

  if (
    tsMorph.Node.isThisExpression(current) &&
    segments[0] === "app" &&
    segments[1] === "services" &&
    segments.length >= 3
  ) {
    return segments.slice(2).join(".");
  }

  return null;
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
        message: `Circular service dependency detected: ${cycle.join(" → ")}`,
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

