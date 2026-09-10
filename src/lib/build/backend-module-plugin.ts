import type { Plugin } from "esbuild";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import MagicString from "magic-string";
import {
  assertPathInside,
  assertRealPathInside,
  isPathInside,
} from "../path-boundary.js";
import {
  parseSourceSyntax,
  walkSourceSyntax,
  type SyntaxNode,
} from "../source-syntax.js";

const MODULE_EXTENSION = /\.(?:ts|mts|cts|js|mjs|cjs)$/iu;

function isStaticString(node: SyntaxNode): boolean {
  return (
    (node.type === "Literal" && typeof node.value === "string") ||
    (node.type === "TemplateLiteral" && node.expressions.length === 0) ||
    (node.type === "BinaryExpression" &&
      node.operator === "+" &&
      isStaticString(node.left) &&
      isStaticString(node.right))
  );
}

/** 逐文件输出的动态路径由Node运行时解析，不让esbuild按尚不存在的.js源码枚举glob。 */
function preserveRuntimeImports(filename: string, source: string): string {
  const edited = new MagicString(source);
  walkSourceSyntax(parseSourceSyntax(filename, source), (node) => {
    const argument =
      node.type === "ImportExpression"
        ? node.source
        : node.type === "CallExpression" &&
            node.callee.type === "Identifier" &&
            node.callee.name === "require"
          ? node.arguments[0]
          : undefined;
    if (
      !argument ||
      !["BinaryExpression", "TemplateLiteral"].includes(argument.type) ||
      isStaticString(argument)
    )
      return;
    // 参数表达式仍在原词法作用域求值；包装函数只返回原值，不修改动态路径。
    edited.appendRight(argument.start, "((__vext_path) => __vext_path)(");
    edited.appendLeft(argument.end, ")");
  });
  if (!edited.hasChanged()) return source;
  const map = edited.generateMap({
    source: filename,
    includeContent: true,
    hires: true,
  });
  return `${edited.toString()}\n//# sourceMappingURL=${map.toUrl()}`;
}

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
      build.onLoad({ filter: /\.(?:ts|mts|cts|js|mjs|cjs)$/i }, (args) => ({
        contents: preserveRuntimeImports(
          args.path,
          readFileSync(args.path, "utf8"),
        ),
        loader: /\.(?:ts|mts|cts)$/iu.test(args.path) ? "ts" : "js",
        resolveDir: path.dirname(args.path),
      }));
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
        // 原生解析器知道该require是否处于try/catch；由它判定可选缺失或真正编译错误。
        if (resolved.errors.length > 0) return;
        if (resolved.external) return resolved;
        if (
          resolved.path.endsWith(".json") &&
          !isPathInside(srcDir, resolved.path)
        ) {
          const root = path.dirname(srcDir);
          assertPathInside(root, resolved.path, "backend runtime resource");
          assertRealPathInside(root, resolved.path, "backend runtime resource");
          const outDir = build.initialOptions.outdir;
          if (!outDir)
            throw new Error(
              "[vextjs] Backend resource mapping requires an output directory.",
            );
          const importerOutput = path.resolve(
            outDir,
            path.relative(srcDir, args.importer),
          );
          let resource = path
            .relative(path.dirname(importerOutput), resolved.path)
            .replaceAll("\\", "/");
          if (!resource.startsWith(".")) resource = `./${resource}`;
          return { path: resource, external: true };
        }
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
