import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertPathInside } from "./path-boundary.js";
import { withProjectOwner } from "./project/owner.js";
import { withTemporaryArtifact } from "./project/temporary-artifact.js";
import { logicalModuleMetaBanner } from "./build/logical-module-meta.js";

const userModuleCache = new Map<string, Promise<Record<string, unknown>>>();

/** Import a user module while supporting TypeScript on every supported Node line. */
export async function importUserModule(
  filePath: string,
  rootDir: string,
  options: { cache?: boolean } = {},
): Promise<Record<string, unknown>> {
  const root = realpathSync.native(path.resolve(rootDir));
  const filename = realpathSync.native(path.resolve(filePath));
  assertPathInside(root, filename, "user module");
  if (path.extname(filename).toLowerCase() !== ".ts") {
    return (await import(pathToFileURL(filename).href)) as Record<
      string,
      unknown
    >;
  }
  const key = `${pathToFileURL(root).href}\n${pathToFileURL(filename).href}`;
  const load = () =>
    withProjectOwner(root, "build", [], () => loadUserModule(filename, root));
  if (options.cache === false) return load();
  const cached = userModuleCache.get(key);
  if (cached) return cached;

  const pending = load();
  userModuleCache.set(key, pending);
  void pending.catch(() => userModuleCache.delete(key));
  return pending;
}

async function loadUserModule(
  filePath: string,
  rootDir: string,
): Promise<Record<string, unknown>> {
  const { build } = await import("esbuild");
  const result = await build({
    entryPoints: [filePath],
    bundle: true,
    packages: "external",
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    logLevel: "silent",
    banner: { js: logicalModuleMetaBanner(filePath) },
  });
  const output = result.outputFiles?.[0];
  if (!output) {
    throw new Error(
      `[vextjs] TypeScript module compilation produced no output: ${filePath}`,
    );
  }

  // 导出可能含函数、class 和父进程状态，必须在当前进程按原生 ESM 求值。
  return withTemporaryArtifact(
    {
      rootDir,
      logicalPath: `${filePath.slice(0, -3)}.mjs`,
      contents: output.contents,
    },
    async (compiledPath) =>
      (await import(pathToFileURL(compiledPath).href)) as Record<
        string,
        unknown
      >,
  );
}
