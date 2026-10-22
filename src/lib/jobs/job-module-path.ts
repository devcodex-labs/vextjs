import path from "node:path";
import {
  sourceModuleCandidates,
  sourceModuleReferences,
} from "../../tooling/project-index/module-path.js";
import type {
  RootRef,
  SourceFileRef,
} from "../../tooling/source-view/types.js";

/** Jobs follows actual Node/esbuild file precedence; the generic graph keeps its existing policy. */
function orderCandidates(
  candidates: SourceFileRef[],
  importer: string,
  specifier: string,
): SourceFileRef[] {
  if (!specifier.startsWith("./") && !specifier.startsWith("../"))
    return candidates;
  const typed = /\.[cm]?ts$/iu.test(importer);
  const extension = path.posix.extname(specifier);
  if (extension) {
    return candidates
      .filter((ref) => typed || !/\.[cm]?ts$/iu.test(ref.path))
      .sort(
        (left, right) =>
          Number(path.posix.extname(right.path) === extension) -
          Number(path.posix.extname(left.path) === extension),
      );
  }
  const first = candidates[0];
  if (!first) return [];
  const base = first.path.replace(/\.ts$/u, "");
  const extensions = typed
    ? [".tsx", ".ts", ".jsx", ".js", ".css", ".json"]
    : [".js", ".json"];
  return [base, base + "/index"].flatMap((stem) =>
    extensions.map((ext) => ({ ...first, path: stem + ext })),
  );
}
export function jobModuleCandidates(
  importer: string,
  specifier: string,
): string[] {
  return orderCandidates(
    sourceModuleCandidates(importer, specifier).map((file) => ({
      rootId: "jobs",
      path: file,
      role: "module",
    })),
    importer,
    specifier,
  ).map((ref) => ref.path);
}
export function jobModuleReferences(
  roots: readonly RootRef[],
  importer: Pick<SourceFileRef, "rootId" | "path">,
  specifier: string,
): SourceFileRef[] {
  return orderCandidates(
    sourceModuleReferences(roots, importer, specifier),
    importer.path,
    specifier,
  );
}
