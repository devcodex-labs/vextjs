import type { Plugin } from "esbuild";
import { realpathSync } from "node:fs";
import path from "node:path";
import { assertPathInside, assertRealPathInside } from "../path-boundary.js";

const MODULE_EXTENSION = /\.(?:ts|mts|cts|js|mjs|cjs)$/iu;

/** 后端始终逐文件输出 CJS；引用映射必须与源文件的产物映射一致。 */
export function backendOutputPath(sourcePath: string): string {
  return sourcePath.replace(MODULE_EXTENSION, ".js");
}

/**
 * 借用 esbuild 的模块/tsconfig 解析，不把相邻模块合并到入口中。
 * 每个模块保持独立 require.cache 身份，使全量和增量重载使用相同路径。
 */
export function createBackendModulePlugin(
  srcDir: string,
  entryPoints: readonly string[],
): Plugin {
  const outputs = new Map<string, string>();
  const resolving = Symbol("vext-backend-resolve");
  return {
    name: "vext-backend-modules",
    setup(build) {
      const outputOwners = new Map<string, string>();
      for (const entry of entryPoints) {
        const source = assertPathInside(
          srcDir,
          path.resolve(srcDir, entry),
          "backend source",
        );
        assertRealPathInside(srcDir, source, "backend source");
        const output = backendOutputPath(source);
        const key =
          process.platform === "win32" ? output.toLowerCase() : output;
        const previous = outputOwners.get(key);
        if (previous && previous !== source) {
          throw new Error(
            `[vextjs] Backend output collision: ${previous} and ${source} produce ${output}`,
          );
        }
        outputOwners.set(key, source);
        outputs.set(realpathSync(source), output);
      }

      build.onResolve({ filter: /.*/ }, async (args) => {
        if (args.kind === "entry-point" || args.pluginData === resolving)
          return;
        const resolved = await build.resolve(args.path, {
          kind: args.kind,
          importer: args.importer,
          namespace: args.namespace,
          resolveDir: args.resolveDir,
          with: args.with,
          pluginData: resolving,
        });
        if (resolved.errors.length > 0)
          return { errors: resolved.errors, warnings: resolved.warnings };
        if (resolved.external) return resolved;
        assertPathInside(srcDir, resolved.path, "backend import source");
        assertRealPathInside(srcDir, resolved.path, "backend import source");
        const output = outputs.get(realpathSync(resolved.path));
        if (!output) {
          throw new Error(
            `[vextjs] Unsupported backend import ${args.path}: ${resolved.path} is excluded or has no independent backend output. Check frontend, source-role, and module-extension settings.`,
          );
        }
        let relative = path
          .relative(path.dirname(args.importer), output)
          .replaceAll("\\", "/");
        if (!relative.startsWith("./") && !relative.startsWith("../")) {
          relative = `./${relative}`;
        }
        return { path: relative, external: true, warnings: resolved.warnings };
      });
    },
  };
}
