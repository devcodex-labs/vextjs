import * as esbuild from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import type {
  ResolvedVextFrontendConfig,
  VextFrontendManifest,
  VextFrontendManifestAsset,
  VextFrontendRouteAssetsManifest,
  VextFrontendRouteInitialAssets,
} from "../contract/types.js";
import type { FrontendRenderRegistryResult } from "./render-registry-writer.js";

export interface BuildFrontendRouteAssetsOptions {
  rootDir: string;
  config: ResolvedVextFrontendConfig;
  manifest: VextFrontendManifest;
  metafile: esbuild.Metafile | undefined;
  registry: FrontendRenderRegistryResult;
}

export async function buildFrontendRouteAssets(
  options: BuildFrontendRouteAssetsOptions,
): Promise<VextFrontendRouteAssetsManifest> {
  const outputs = options.metafile?.outputs ?? {};
  const outputEntries = Object.entries(outputs);
  const assetByPath = new Map(
    options.manifest.assets.map((asset) => [asset.path, asset]),
  );
  const browserEntryScripts = options.manifest.assets
    .filter(
      (asset) =>
        asset.entry &&
        asset.path.endsWith(".js") &&
        isBrowserEntrypoint(options.config, asset),
    )
    .map((asset) => asset.path);
  const browserEntryOutputFiles = outputEntries
    .filter(([outputFile]) => {
      const asset = outputToManifestAsset(
        options.config,
        assetByPath,
        outputFile,
      );
      return (
        asset?.entry === true &&
        asset.path.endsWith(".js") &&
        isBrowserEntrypoint(options.config, asset)
      );
    })
    .map(([outputFile]) => outputFile);
  const routes = await Promise.all(
    options.registry.pages.map((page) =>
      buildRouteAssetsForPage({
        ...options,
        outputEntries,
        assetByPath,
        browserEntryScripts,
        browserEntryOutputFiles,
        page,
      }),
    ),
  );
  return { schemaVersion: 1, routes };
}

async function buildRouteAssetsForPage(
  input: BuildFrontendRouteAssetsOptions & {
    outputEntries: Array<[string, esbuild.Metafile["outputs"][string]]>;
    assetByPath: Map<string, VextFrontendManifestAsset>;
    browserEntryScripts: string[];
    browserEntryOutputFiles: string[];
    page: FrontendRenderRegistryResult["pages"][number];
  },
): Promise<VextFrontendRouteInitialAssets> {
  const sourceFiles = [
    input.page.file,
    ...resolveLayoutChain(input.registry.layouts, input.page.id).map(
      (layout) => layout.file,
    ),
    resolveDefaultLocaleFile(input),
  ].filter((file): file is string => Boolean(file));
  const outputFiles = collectOutputsForSources(
    input.rootDir,
    input.outputEntries,
    sourceFiles,
  );
  const outputClosure = collectStaticOutputClosure(input.metafile, outputFiles);
  const browserEntryOutputClosure = collectStaticOutputClosure(
    input.metafile,
    input.browserEntryOutputFiles,
  );
  const routeClosureScripts = outputClosure
    .map((file) => outputToManifestAsset(input.config, input.assetByPath, file))
    .filter((asset): asset is VextFrontendManifestAsset => Boolean(asset))
    .filter((asset) => asset.path.endsWith(".js"));
  const routeScripts = routeClosureScripts
    .filter((asset) => !isBrowserEntrypoint(input.config, asset))
    .map((asset) => asset.path)
    .sort();
  const browserEntryClosureScripts = browserEntryOutputClosure
    .map((file) => outputToManifestAsset(input.config, input.assetByPath, file))
    .filter((asset): asset is VextFrontendManifestAsset => Boolean(asset))
    .filter((asset) => asset.path.endsWith(".js"))
    .map((asset) => asset.path);
  const styles = outputClosure
    .flatMap((file) => [file, input.metafile?.outputs[file]?.cssBundle])
    .map((file) =>
      file
        ? outputToManifestAsset(input.config, input.assetByPath, file)
        : undefined,
    )
    .filter((asset): asset is VextFrontendManifestAsset => Boolean(asset))
    .filter((asset) => asset.path.endsWith(".css"))
    .map((asset) => asset.path)
    .sort();
  const assets = outputClosure
    .map((file) => outputToManifestAsset(input.config, input.assetByPath, file))
    .filter((asset): asset is VextFrontendManifestAsset => Boolean(asset))
    .filter(
      (asset) => !asset.path.endsWith(".js") && !asset.path.endsWith(".css"),
    )
    .map((asset) => asset.path)
    .sort();
  const initialScripts = unique([
    ...input.browserEntryScripts,
    ...browserEntryClosureScripts,
    ...routeClosureScripts.map((asset) => asset.path),
  ]);
  const jsSizes = await sumCompressedAssets(input.config, initialScripts);
  return {
    page: input.page.id,
    routePath: input.page.routePath,
    layouts: resolveLayoutChain(input.registry.layouts, input.page.id).map(
      (layout) => layout.id,
    ),
    locale:
      input.config.i18n.defaultLocale === "inherit"
        ? undefined
        : input.config.i18n.defaultLocale,
    scripts: unique(routeScripts),
    styles: unique(styles),
    assets: unique(assets),
    externalScripts: Object.values(
      input.config.build.client.externalRuntime,
    ).map((entry) => entry.url),
    initialJsBytes: jsSizes.raw,
    initialJsGzipBytes: jsSizes.gzip,
    initialJsBrotliBytes: jsSizes.brotli,
    appOwnedInitialJsBrotliBytes: jsSizes.brotli,
  };
}

function collectOutputsForSources(
  rootDir: string,
  outputEntries: Array<[string, esbuild.Metafile["outputs"][string]]>,
  sourceFiles: string[],
): string[] {
  const normalizedSources = new Set(
    sourceFiles.map((file) => path.resolve(rootDir, file).replace(/\\/g, "/")),
  );
  const matches: string[] = [];
  for (const [outputFile, output] of outputEntries) {
    const inputFiles = Object.keys(output.inputs ?? {});
    if (
      inputFiles.some((inputFile) =>
        normalizedSources.has(path.resolve(inputFile).replace(/\\/g, "/")),
      )
    ) {
      matches.push(outputFile);
    }
  }
  return matches;
}

/**
 * First-load metrics deliberately stop at dynamic imports. Other pages and
 * error fallbacks are emitted as entries too, but are not downloaded before a
 * navigation or render failure asks the browser for them.
 */
function collectStaticOutputClosure(
  metafile: esbuild.Metafile | undefined,
  outputFiles: string[],
): string[] {
  if (!metafile) return [];
  const visited = new Set<string>();
  const stack = [...outputFiles];
  while (stack.length > 0) {
    const file = stack.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    const output = metafile.outputs[file];
    for (const item of output?.imports ?? []) {
      if (item.kind === "dynamic-import") continue;
      if (metafile.outputs[item.path] && !visited.has(item.path)) {
        stack.push(item.path);
      }
    }
  }
  return [...visited];
}

function outputToManifestAsset(
  config: ResolvedVextFrontendConfig,
  assetByPath: Map<string, VextFrontendManifestAsset>,
  outputFile: string,
): VextFrontendManifestAsset | undefined {
  return assetByPath.get(outputToPublicPath(config, outputFile));
}

async function sumCompressedAssets(
  config: ResolvedVextFrontendConfig,
  assetPaths: string[],
): Promise<{ raw: number; gzip: number; brotli: number }> {
  let raw = 0;
  let gzip = 0;
  let brotli = 0;
  for (const assetPath of unique(assetPaths)) {
    const content = await readFile(publicAssetPathToFile(config, assetPath));
    raw += content.byteLength;
    gzip += gzipSync(content).byteLength;
    brotli += brotliCompressSync(content).byteLength;
  }
  return { raw, gzip, brotli };
}

function resolveLayoutChain(
  layouts: FrontendRenderRegistryResult["layouts"],
  page: string,
): FrontendRenderRegistryResult["layouts"] {
  const pageDirectory = page.includes("/")
    ? page.slice(0, page.lastIndexOf("/"))
    : "";
  return layouts
    .filter((layout) => {
      const directory = layout.directory ?? "";
      return (
        directory === "" ||
        pageDirectory === directory ||
        pageDirectory.startsWith(`${directory}/`)
      );
    })
    .sort((a, b) => (a.directory ?? "").length - (b.directory ?? "").length);
}

function resolveDefaultLocaleFile(
  input: BuildFrontendRouteAssetsOptions,
): string | undefined {
  const defaultLocale = input.config.i18n.defaultLocale;
  if (defaultLocale === "inherit") return undefined;
  return input.registry.locales.find(
    (locale) => locale.locale === defaultLocale,
  )?.file;
}

function outputToPublicPath(
  config: ResolvedVextFrontendConfig,
  filePath: string,
): string {
  const absolute = path.resolve(filePath);
  const relative = path.relative(config.outDir, absolute).replace(/\\/g, "/");
  return joinPublicPath(getAssetBase(config), relative);
}

function publicAssetPathToFile(
  config: ResolvedVextFrontendConfig,
  assetPath: string,
): string {
  const base = getAssetBase(config);
  if (!assetPath.startsWith(base)) {
    throw new Error(
      `[vextjs] frontend asset path is outside public base: ${assetPath}`,
    );
  }
  return path.join(config.outDir, assetPath.slice(base.length));
}

function joinPublicPath(publicPath: string, relativePath: string): string {
  return `${publicPath}${relativePath.replace(/^\/+/u, "")}`;
}

function getAssetBase(config: ResolvedVextFrontendConfig): string {
  return config.deploy.assetBaseUrl ?? config.publicPath;
}

function isBrowserEntrypoint(
  config: ResolvedVextFrontendConfig,
  asset: VextFrontendManifestAsset,
): boolean {
  const prefix = joinPublicPath(
    getAssetBase(config),
    `${config.build.client.assetsDir}/browser-entry`,
  );
  return asset.path.startsWith(prefix);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
