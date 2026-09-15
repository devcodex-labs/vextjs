import path from "node:path";
import type { RootRef, SourceFileRef } from "../source-view/types.js";
import { isPathInside } from "../../lib/path-boundary.js";

/** 相对模块只在显式登记的同一 SourceView root 中定位，不回退到宿主 require。 */
export function sourceModuleCandidates(
  importer: string,
  specifier: string,
): string[] {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return [];
  if (
    specifier.includes("\\") ||
    specifier.includes("?") ||
    specifier.includes("#")
  )
    return [];
  const target = path.posix.normalize(
    path.posix.join(path.posix.dirname(importer), specifier),
  );
  if (
    target === ".." ||
    target.startsWith("../") ||
    path.posix.isAbsolute(target)
  )
    return [];
  const extension = path.posix.extname(target);
  if (extension === ".js") return [target.slice(0, -3) + ".ts", target];
  if (extension === ".mjs") return [target.slice(0, -4) + ".mts", target];
  if (extension === ".cjs") return [target.slice(0, -4) + ".cts", target];
  if (extension) return [target];
  return [".ts", ".js", ".json"]
    .map((ext) => target + ext)
    .concat([".ts", ".js", ".json"].map((ext) => target + "/index" + ext));
}

/** 只使用显式根和sourceExports；不探测node_modules或执行包入口。 */
export function sourceModuleReferences(
  roots: readonly RootRef[],
  importer: Pick<SourceFileRef, "rootId" | "path">,
  specifier: string,
): SourceFileRef[] {
  const root = roots.find((item) => item.id === importer.rootId);
  if (!root || /[\\?#\0]/u.test(specifier)) return [];
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const absolute = path.resolve(
      root.realPath,
      path.dirname(importer.path),
      specifier,
    );
    const matches = roots.filter((item) =>
      isPathInside(item.realPath, absolute),
    );
    const target = matches.sort(
      (left, right) => right.realPath.length - left.realPath.length,
    )[0];
    if (!target) return [];
    const relative = path
      .relative(target.realPath, absolute)
      .replaceAll("\\", "/");
    return sourceModuleCandidates("_importer.ts", `./${relative}`).map(
      (file) => ({ rootId: target.id, path: file, role: "module" }),
    );
  }
  return roots.flatMap((target) => {
    if (!target.packageName || !target.sourceExports) return [];
    const subpath =
      specifier === target.packageName
        ? "."
        : specifier.startsWith(target.packageName + "/")
          ? "./" + specifier.slice(target.packageName.length + 1)
          : "";
    const file = target.sourceExports[subpath];
    return file ? [{ rootId: target.id, path: file, role: "module" }] : [];
  });
}
