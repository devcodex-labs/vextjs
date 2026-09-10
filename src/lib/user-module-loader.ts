import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertPathInside, isPathInside } from "./path-boundary.js";
import { currentProjectOwner, withProjectOwner } from "./project/owner.js";
import { withTemporaryArtifact } from "./project/temporary-artifact.js";
import { logicalModuleMetaBanner } from "./build/logical-module-meta.js";
import { parseSourceSyntax, walkSourceSyntax } from "./source-syntax.js";
import MagicString from "magic-string";
import type { Plugin } from "esbuild";

const userModuleCache = new Map<string, Promise<Record<string, unknown>>>();
const requireFromHere = createRequire(import.meta.url);
const moduleResolverUrl = pathToFileURL(
  requireFromHere.resolve("import-meta-resolve"),
).href;

/** Import a user module while supporting TypeScript on every supported Node line. */
export async function importUserModule(
  filePath: string,
  rootDir: string,
  options: { cache?: boolean; readRoot?: string } = {},
): Promise<Record<string, unknown>> {
  const root = realpathSync.native(path.resolve(rootDir));
  const filename = realpathSync.native(path.resolve(filePath));
  const readRoot = options.readRoot
    ? realpathSync.native(path.resolve(options.readRoot))
    : root;
  assertPathInside(readRoot, filename, "user module");
  if (!/\.(?:ts|mts|cts)$/iu.test(filename)) {
    const url = pathToFileURL(filename);
    if (options.cache === false) {
      // 原生ESM和CJS均刷新入口；传递依赖的整体刷新由调用方cold restart负责。
      delete requireFromHere.cache[filename];
      url.searchParams.set("vextModule", randomUUID());
    }
    return (await import(url.href)) as Record<string, unknown>;
  }
  // 公共 helper 默认以模块目录为读取根；已有服务异步上下文负责临时产物写入。
  // 只继承包含该读取根的 owner，不把同进程或相邻项目视为授权关系。
  const current = currentProjectOwner();
  const writeRoot =
    current && isPathInside(current.identity.realRoot, root, true)
      ? current.identity.realRoot
      : root;
  const key = `${pathToFileURL(writeRoot).href}\n${pathToFileURL(filename).href}`;
  const load = () =>
    withProjectOwner(writeRoot, "build", [], () =>
      loadUserModule(filename, writeRoot),
    );
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
  const externalSource = !isPathInside(rootDir, filePath);
  const commonjs = filePath.endsWith(".cts");
  const result = await build({
    entryPoints: [filePath],
    bundle: true,
    packages: externalSource ? undefined : "external",
    format: commonjs ? "cjs" : "esm",
    platform: "node",
    target: "node20",
    sourcemap: "inline",
    write: false,
    logLevel: "silent",
    banner: {
      js: commonjs
        ? `__filename = ${JSON.stringify(filePath)}; __dirname = ${JSON.stringify(path.dirname(filePath))};`
        : logicalModuleMetaBanner(filePath),
    },
    plugins: externalSource ? [relocatedModulePlugin(commonjs)] : [],
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
      // 共享源只能读取；编译缓存和收据属于调用服务。内部模块保留相邻执行语义。
      logicalPath: externalSource
        ? path.join(
            rootDir,
            ".vext/runtime-modules",
            commonjs ? "module.cjs" : "module.mjs",
          )
        : filePath.replace(/\.[cm]?ts$/u, commonjs ? ".cjs" : ".mjs"),
      contents: output.contents,
    },
    async (compiledPath) =>
      (await import(pathToFileURL(compiledPath).href)) as Record<
        string,
        unknown
      >,
  );
}

/** 共享 TS 暂存到服务根后，静态包依赖与延迟相对 import 仍按原模块位置解析。 */
function relocatedModulePlugin(commonjs: boolean): Plugin {
  const resolving = Symbol("vext-relocated-module");
  return {
    name: "vext-relocated-module",
    setup(build) {
      build.onResolve({ filter: /^[^./]/ }, async (args) => {
        if (args.path === moduleResolverUrl)
          return { path: args.path, external: true };
        if (
          args.kind === "entry-point" ||
          args.pluginData === resolving ||
          args.path.startsWith("node:") ||
          path.isAbsolute(args.path)
        )
          return;
        const resolved = await build.resolve(args.path, {
          kind: args.kind,
          importer: args.importer,
          resolveDir: args.resolveDir,
          namespace: args.namespace,
          with: args.with,
          pluginData: resolving,
        });
        if (resolved.errors.length) return;
        // 默认解析器提供真实包路径，保留其 import/require 条件而不打包包实例。
        if (!path.isAbsolute(resolved.path)) return resolved;
        return {
          path: commonjs ? resolved.path : pathToFileURL(resolved.path).href,
          external: true,
        };
      });
      build.onLoad({ filter: /\.[cm]?[jt]s$/ }, (args) => {
        const source = readFileSync(args.path, "utf8");
        const edited = new MagicString(source);
        const resolver = "__vextResolve" + randomUUID().replaceAll("-", "");
        let needsResolver = false;
        walkSourceSyntax(parseSourceSyntax(args.path, source), (node) => {
          if (
            node.type !== "ImportExpression" ||
            node.source.type === "Literal"
          )
            return;
          // 延迟包名也须按原消费者的import条件定位，不能落到服务缓存目录的依赖。
          needsResolver = true;
          edited.appendRight(
            node.source.start,
            "((specifier) => typeof specifier === 'string' ? " +
              resolver +
              "(specifier, new URL(" +
              JSON.stringify(pathToFileURL(args.path).href) +
              "), new Set(['node', 'import']), false).href : specifier)(",
          );
          edited.appendLeft(node.source.end, ")");
        });
        if (needsResolver)
          edited.prepend(
            "import { moduleResolve as " +
              resolver +
              " } from " +
              JSON.stringify(moduleResolverUrl) +
              ";\n",
          );
        const sourceMap = edited.generateMap({
          source: args.path,
          includeContent: true,
          hires: true,
        });
        return {
          contents:
            edited.toString() + "\n//# sourceMappingURL=" + sourceMap.toUrl(),
          loader: /\.[cm]?ts$/.test(args.path) ? "ts" : "js",
          resolveDir: path.dirname(args.path),
        };
      });
    },
  };
}
