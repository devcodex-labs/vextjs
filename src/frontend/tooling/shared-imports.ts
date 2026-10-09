import path from "node:path";
import { readFile } from "node:fs/promises";
import * as esbuild from "esbuild";
import {
  transform,
  type CSSModuleExport,
  type TransformResult,
} from "lightningcss";
import type { ResolvedVextFrontendConfig } from "../contract/types.js";
import { physicalPath } from "../../lib/path-boundary.js";
import { evaluateGeneratedModule } from "../../lib/build/generated-module.js";

const ASSET_FILTER = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot)$/i;
const CSS_NAMESPACE = "vext-compiled-css";

/** One compilation owns the module identities consumed by both build graphs. */
export class SharedFrontendImports {
  private readonly css = new Map<string, Promise<TransformResult>>();
  private readonly assetUrls = new Map<string, string>();

  constructor(private readonly config: ResolvedVextFrontendConfig) {}

  cssPlugin(browser: boolean): esbuild.Plugin {
    const compile = (filename: string): Promise<TransformResult> => {
      const identity = physicalPath(filename);
      let result = this.css.get(identity);
      if (!result) {
        result = readFile(identity).then((code) =>
          transform({
            // Relative, slash-normalized identity also works through directory aliases.
            filename: path
              .relative(physicalPath(this.config.projectRoot), identity)
              .replace(/\\/g, "/"),
            code,
            cssModules: { pattern: "vext_[hash]_[local]" },
            minify: false,
          }),
        );
        this.css.set(identity, result);
      }
      return result;
    };
    return {
      name: "vext-shared-css-modules",
      setup: (build) => {
        build.onResolve({ filter: /^vext-compiled-css:/ }, (args) => ({
          path: args.path.slice("vext-compiled-css:".length),
          namespace: CSS_NAMESPACE,
        }));
        // CSS @import needs stylesheet contents, whereas JS imports need mappings.
        build.onResolve({ filter: /\.module\.css$/ }, async (args) => {
          if (args.kind !== "import-rule" || !this.config.build.css.modules)
            return undefined;
          const resolved = await build.resolve(args.path, {
            resolveDir: args.resolveDir,
            kind: "import-statement",
          });
          if (resolved.errors.length) return { errors: resolved.errors };
          return { path: resolved.path, namespace: CSS_NAMESPACE };
        });
        build.onLoad(
          { filter: /.*/, namespace: CSS_NAMESPACE },
          async (args) => ({
            contents: (await compile(args.path)).code,
            resolveDir: path.dirname(args.path),
            loader: "css",
          }),
        );
        build.onLoad({ filter: /\.css$/, namespace: "file" }, async (args) => {
          if (
            !args.path.endsWith(".module.css") ||
            !this.config.build.css.modules
          ) {
            if (!browser)
              return { contents: "export default {};", loader: "js" };
            return undefined;
          }
          const compiled = await compile(args.path);
          const exported = compiled.exports ?? {};
          const moduleExports = Object.entries(exported);
          // Lightning CSS's native binding assigns __proto__ as a prototype.
          // Recover that export only when it has the actual CSS export shape.
          const prototype = Object.getPrototypeOf(
            exported,
          ) as CSSModuleExport | null;
          if (
            !Object.hasOwn(exported, "__proto__") &&
            prototype &&
            Object.hasOwn(prototype, "name") &&
            typeof prototype.name === "string" &&
            Array.isArray(prototype.composes) &&
            typeof prototype.isReferenced === "boolean"
          ) {
            moduleExports.push(["__proto__", prototype]);
          }
          const imports: string[] = browser
            ? [`import ${JSON.stringify(`vext-compiled-css:${args.path}`)};`]
            : [];
          const dependencies = new Map<string, string>();
          const entries = moduleExports.map(([key, value]) => {
            const names = [JSON.stringify(value.name)];
            for (const reference of value.composes) {
              if (reference.type !== "dependency") {
                names.push(JSON.stringify(reference.name));
              } else {
                let variable = dependencies.get(reference.specifier);
                if (!variable) {
                  variable = `dependency${dependencies.size}`;
                  dependencies.set(reference.specifier, variable);
                  imports.push(
                    `import ${variable} from ${JSON.stringify(reference.specifier)};`,
                  );
                }
                names.push(`${variable}[${JSON.stringify(reference.name)}]`);
              }
            }
            return `[${JSON.stringify(key)}]: [${names.join(",")}].join(" ")`;
          });
          return {
            contents: `${imports.join("\n")}\nconst classes = {${entries.join(",")}};\nexport default classes;\n${moduleExports
              .filter(([key]) => key !== "default")
              .map(
                ([key], index) =>
                  `const class${index} = classes[${JSON.stringify(key)}]; export { class${index} as ${JSON.stringify(key)} };`,
              )
              .join("\n")}`,
            resolveDir: path.dirname(args.path),
            loader: "js",
          };
        });
      },
    };
  }

  browserAssetsPlugin(): esbuild.Plugin {
    return {
      name: "vext-shared-browser-assets",
      setup: (build) => {
        build.onLoad({ filter: ASSET_FILTER }, async (args) => {
          const content = await readFile(args.path);
          if (
            this.config.build.assets.inlineLimit > 0 &&
            content.byteLength <= this.config.build.assets.inlineLimit
          ) {
            const transformed = await esbuild.transform(content, {
              sourcefile: args.path,
              loader: "dataurl",
              format: "cjs",
            });
            this.assetUrls.set(
              physicalPath(args.path),
              evaluateGeneratedModule<string>(transformed.code, args.path),
            );
            return { contents: content, loader: "dataurl" };
          }
          return { contents: content, loader: "file" };
        });
      },
    };
  }

  captureAssetOutputs(metafile: esbuild.Metafile): void {
    const base = this.config.deploy.assetBaseUrl ?? this.config.publicPath;
    for (const [output, entry] of Object.entries(metafile.outputs)) {
      if (!ASSET_FILTER.test(output)) continue;
      const relative = path
        .relative(this.config.outDir, path.resolve(output))
        .replace(/\\/g, "/");
      for (const input of Object.keys(entry.inputs)) {
        this.assetUrls.set(
          physicalPath(path.resolve(input)),
          `${base}${relative}`,
        );
      }
    }
  }

  serverAssetsPlugin(): esbuild.Plugin {
    return {
      name: "vext-shared-server-assets",
      setup: (build) => {
        build.onLoad({ filter: ASSET_FILTER }, (args) => {
          const url = this.assetUrls.get(physicalPath(args.path));
          if (url === undefined)
            throw new Error(
              `[vextjs] SSR asset has no browser candidate: ${args.path}`,
            );
          return {
            contents: `export default ${JSON.stringify(url)};`,
            loader: "js",
          };
        });
      },
    };
  }
}
