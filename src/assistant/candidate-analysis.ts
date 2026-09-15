import path from "node:path";
import { StaticModuleGraph } from "../tooling/project-index/static-module-graph.js";
import { parseSourceSyntax } from "../lib/source-syntax.js";
import {
  createCanonicalRouteIdentity,
  normalizeRegisteredRoutePath,
  projectRouteFilePrefix,
} from "../lib/route-contract.js";
import { shouldIncludeRouteFilePath } from "../lib/route-file-policy.js";
import { sourceModuleReferences } from "../tooling/project-index/module-path.js";
import { inspectRouteFacts } from "../tooling/project-index/route-facts.js";
import type { SourceView } from "../tooling/source-view/types.js";
import { ASSISTANT_SOURCE_ROOT } from "../tooling/project-index/analysis-source.js";

export interface CandidateAnalysis {
  errors: string[];
  missingEvidence: string[];
}

/** 分析 Overlay 的最终正文；既有文件和同批新文件走同一导入及路由判定。 */
export function analyzeCandidateOverlay(
  view: SourceView,
  rootDir: string,
  changedPaths: ReadonlySet<string>,
  routeDirectory: string,
): CandidateAnalysis {
  const errors: string[] = [];
  const missingEvidence: string[] = [];
  for (const file of view.list()) {
    if (
      !changedPaths.has(`${file.rootId}:${file.path}`) ||
      !/\.[cm]?[jt]sx?$/u.test(file.path)
    )
      continue;
    const program = parseSourceSyntax(
      file.path,
      view.read(file.rootId, file.path)!,
    );
    for (const statement of program.body) {
      if (
        statement.type !== "ImportDeclaration" &&
        statement.type !== "ExportNamedDeclaration" &&
        statement.type !== "ExportAllDeclaration"
      )
        continue;
      const source = statement.source?.value;
      if (typeof source !== "string") continue;
      const shared = view
        .roots()
        .some(
          (root) =>
            root.packageName &&
            (source === root.packageName ||
              source.startsWith(root.packageName + "/")),
        );
      if (!source.startsWith(".") && !shared) continue;
      const references = sourceModuleReferences(view.roots(), file, source);
      const typeOnly =
        statement.type === "ImportDeclaration"
          ? statement.importKind === "type" ||
            (statement.specifiers.length > 0 &&
              statement.specifiers.every(
                (item) =>
                  item.type === "ImportSpecifier" && item.importKind === "type",
              ))
          : statement.exportKind === "type";
      const present = references.some(
        (ref) =>
          view.record(ref.rootId, ref.path) !== undefined ||
          (typeOnly &&
            ref.path.endsWith(".ts") &&
            view.record(ref.rootId, ref.path.slice(0, -3) + ".d.ts") !==
              undefined),
      );
      if (present) continue;
      if (
        /[?#]/u.test(source) ||
        /\.(?:png|jpe?g|gif|webp|avif|woff2?)$/u.test(source)
      )
        missingEvidence.push(
          `${file.path}: host asset resolution is required for ${source}.`,
        );
      else
        errors.push(
          `${file.path}: source import ${source} is absent from the declared source snapshot and candidate files.`,
        );
    }
  }
  const graph = new StaticModuleGraph(view);
  const routesRoot = path.join(rootDir, routeDirectory);
  const registrations = new Map<string, string>();
  for (const file of view.list()) {
    if (
      file.rootId !== ASSISTANT_SOURCE_ROOT ||
      !file.path.startsWith(routeDirectory + "/") ||
      !shouldIncludeRouteFilePath(path.join(rootDir, file.path), routesRoot)
    )
      continue;
    const facts = inspectRouteFacts(
      file.path,
      view.read(file.rootId, file.path)!,
      { graph, rootId: file.rootId },
    );
    if (facts.state !== "complete") {
      if (
        [...changedPaths].some((key) =>
          key.startsWith(`${ASSISTANT_SOURCE_ROOT}:${routeDirectory}/`),
        )
      )
        missingEvidence.push(
          `${file.path}: ${facts.reason ?? "route analysis is incomplete"}`,
        );
      continue;
    }
    const prefix = projectRouteFilePrefix(
      path.join(rootDir, file.path),
      routesRoot,
    );
    for (const route of facts.routes) {
      if (route.subPath === null || route.responses === "unknown") {
        if (changedPaths.has(`${file.rootId}:${file.path}`))
          missingEvidence.push(
            `${file.path}: route path or response schema is dynamic.`,
          );
        continue;
      }
      const key = createCanonicalRouteIdentity(
        route.method,
        normalizeRegisteredRoutePath(prefix, route.subPath),
      );
      const existing = registrations.get(key);
      if (
        existing &&
        (changedPaths.has(`${ASSISTANT_SOURCE_ROOT}:${existing}`) ||
          changedPaths.has(`${file.rootId}:${file.path}`))
      )
        errors.push(`Route conflict ${key}: ${existing} and ${file.path}.`);
      else registrations.set(key, file.path);
    }
  }
  return { errors, missingEvidence };
}
