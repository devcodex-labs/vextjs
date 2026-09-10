import path from "node:path";
import { statSync } from "node:fs";
import type { Loader, Plugin } from "esbuild";
import type { ArtifactDraft } from "../project/artifact-draft.js";

const loaders: Record<string, Loader> = {
  ".js": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".jsx": "jsx",
  ".ts": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".tsx": "tsx",
  ".json": "json",
  ".css": "css",
};

/** 只接管明确生成目录；业务源码和包仍交给 esbuild 原有解析器。 */
export function createArtifactDraftPlugin(draft: ArtifactDraft): Plugin {
  return {
    name: "vext-artifact-draft",
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData?.vextArtifactDraftResolved) return;
        if (
          !path.isAbsolute(args.path) &&
          !args.path.startsWith(".") &&
          args.kind !== "entry-point"
        ) {
          if (!draft.has(args.importer)) return;
          let resolveDir = args.resolveDir;
          while (true) {
            try {
              if (!statSync(resolveDir).isDirectory())
                throw new Error(`Not a directory: ${resolveDir}`);
              break;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
              const parent = path.dirname(resolveDir);
              if (parent === resolveDir) throw error;
              resolveDir = parent;
            }
          }
          return build.resolve(args.path, {
            importer: args.importer,
            kind: args.kind,
            namespace: args.namespace,
            resolveDir,
            pluginData: { ...args.pluginData, vextArtifactDraftResolved: true },
          });
        }
        const absolute = path.resolve(
          args.resolveDir || process.cwd(),
          args.path,
        );
        if (!draft.owns(absolute)) {
          if (!draft.has(args.importer) || !args.path.startsWith(".")) return;
          // 逻辑生成目录尚未落盘；先规范化 ..，避免原生解析器穿过不存在的目录。
          return build.resolve(absolute, {
            importer: args.importer,
            kind: args.kind,
            namespace: args.namespace,
            resolveDir: draft.rootDir,
            pluginData: { ...args.pluginData, vextArtifactDraftResolved: true },
          });
        }
        const candidates = [
          absolute,
          ...[".tsx", ".ts", ".jsx", ".js", ".json"].map(
            (extension) => absolute + extension,
          ),
        ];
        if (absolute.endsWith(".js"))
          candidates.push(
            absolute.slice(0, -3) + ".ts",
            absolute.slice(0, -3) + ".tsx",
          );
        const found = candidates.find((file) => draft.has(file));
        if (found) return { path: found, namespace: "file" };
        return {
          errors: [
            { text: `Current generated artifact is missing: ${absolute}` },
          ],
        };
      });
      build.onLoad({ filter: /.*/, namespace: "file" }, (args) => {
        if (!draft.owns(args.path)) return;
        return {
          contents: draft.read(args.path),
          loader: loaders[path.extname(args.path)] ?? "file",
          resolveDir: path.dirname(args.path),
        };
      });
    },
  };
}
