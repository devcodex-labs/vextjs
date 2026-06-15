import * as esbuild from "esbuild";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ResolvedVextFrontendConfig,
  VextFrontendManifest,
  VextFrontendManifestAsset,
  VextFrontendMode,
  VextFrontendUserConfig,
} from "../contract/types.js";
import { resolveFrontendConfig } from "./config-resolver.js";
import { writeClientContractFromRouteManifest } from "./client-contract-writer.js";

export interface BuildFrontendClientOptions {
  rootDir: string;
  config: VextFrontendUserConfig | undefined;
  mode: VextFrontendMode;
}

export interface BuildFrontendClientResult {
  skipped: boolean;
  config: ResolvedVextFrontendConfig;
  manifestPath?: string;
  contractPath?: string;
  modulePath?: string;
  routeCount?: number;
  warnings: string[];
}

export async function buildFrontendClient(
  options: BuildFrontendClientOptions,
): Promise<BuildFrontendClientResult> {
  const config = resolveFrontendConfig(options.config, {
    rootDir: options.rootDir,
    mode: options.mode,
  });
  if (!config.enabled) {
    return { skipped: true, config, warnings: [] };
  }

  if (!existsSync(config.entry)) {
    throw new Error(
      `[vextjs] frontend entry not found: ${path.relative(options.rootDir, config.entry)}`,
    );
  }

  await rm(config.outDir, { recursive: true, force: true });
  await mkdir(config.outDir, { recursive: true });

  if (existsSync(config.publicDir)) {
    await cp(config.publicDir, config.outDir, {
      recursive: true,
      force: true,
      errorOnExist: false,
    });
  }

  const contract = config.apiClient.enabled
    ? await writeClientContractFromRouteManifest({
        rootDir: options.rootDir,
        outDir: config.outDir,
      })
    : undefined;

  const buildResult = await esbuild.build({
    entryPoints: [config.entry],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: config.build.target,
    outdir: config.outDir,
    entryNames: "assets/[name]-[hash]",
    chunkNames: "assets/[name]-[hash]",
    assetNames: "assets/[name]-[hash]",
    sourcemap: config.build.sourcemap,
    minify: config.build.minify,
    splitting: false,
    metafile: true,
    jsx: "automatic",
    loader: {
      ".png": "file",
      ".jpg": "file",
      ".jpeg": "file",
      ".gif": "file",
      ".webp": "file",
      ".svg": "file",
      ".ico": "file",
      ".woff": "file",
      ".woff2": "file",
      ".ttf": "file",
      ".eot": "file",
      ".css": "css",
    },
    define: {
      "process.env.NODE_ENV":
        options.mode === "production" ? '"production"' : '"development"',
    },
    logLevel: "warning",
  });

  const manifest = buildManifest(config, buildResult.metafile, options.mode);
  const manifestPath = path.join(config.outDir, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  await writeFile(
    path.join(config.outDir, "size-report.json"),
    `${JSON.stringify(buildSizeReport(manifest), null, 2)}\n`,
    "utf-8",
  );
  await writeFile(
    path.join(config.outDir, "index.html"),
    await renderIndexHtml(config, manifest),
    "utf-8",
  );

  return {
    skipped: false,
    config,
    manifestPath,
    contractPath: contract?.contractPath,
    modulePath: contract?.modulePath,
    routeCount: contract?.routeCount,
    warnings: [...buildResult.warnings.map((item) => item.text), ...(contract?.warnings ?? [])],
  };
}

function buildManifest(
  config: ResolvedVextFrontendConfig,
  metafile: esbuild.Metafile | undefined,
  mode: VextFrontendMode,
): VextFrontendManifest {
  const outputs = Object.entries(metafile?.outputs ?? {});
  const assets: VextFrontendManifestAsset[] = outputs
    .filter(([filePath]) => !filePath.endsWith(".map"))
    .map(([filePath, output]) => {
      const relativePath = toPublicAssetPath(config, filePath);
      return {
        path: relativePath,
        bytes: output.bytes,
        entry: Boolean(output.entryPoint),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    schemaVersion: 1,
    kind: "frontend-manifest",
    generatedAt: new Date().toISOString(),
    mode,
    publicPath: config.publicPath,
    indexHtml: joinPublicPath(config.publicPath, "index.html"),
    entrypoints: assets.filter((asset) => asset.entry).map((asset) => asset.path),
    assets,
  };
}

function toPublicAssetPath(
  config: ResolvedVextFrontendConfig,
  filePath: string,
): string {
  const absolute = path.resolve(filePath);
  const relative = path.relative(config.outDir, absolute).replace(/\\/g, "/");
  return joinPublicPath(config.publicPath, relative);
}

function joinPublicPath(publicPath: string, relativePath: string): string {
  const trimmed = relativePath.replace(/^\/+/, "");
  return `${publicPath}${trimmed}`.replace(/\/+/g, "/");
}

async function renderIndexHtml(
  config: ResolvedVextFrontendConfig,
  manifest: VextFrontendManifest,
): Promise<string> {
  const entryScript = manifest.entrypoints[0];
  const scriptTag = entryScript
    ? `<script type="module" src="${entryScript}" data-vext-entry></script>`
    : "";
  const styleTags = manifest.assets
    .filter((asset) => asset.path.endsWith(".css"))
    .map((asset) => `<link rel="stylesheet" href="${asset.path}" data-vext-style>`)
    .join("\n");
  const template = existsSync(config.indexHtml)
    ? await readFile(config.indexHtml, "utf-8")
    : '<!doctype html>\n<html lang="en">\n<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Vext</title></head>\n<body><div id="root"></div></body>\n</html>\n';

  let output = template;
  let stylesInjected = false;
  if (output.includes("%VEXT_STYLES%")) {
    output = output.replace("%VEXT_STYLES%", styleTags);
    stylesInjected = true;
  } else if (styleTags && output.includes("</head>")) {
    output = output.replace("</head>", `  ${styleTags}\n</head>`);
    stylesInjected = true;
  }

  if (output.includes("%VEXT_ENTRY%")) {
    return output.replace("%VEXT_ENTRY%", scriptTag);
  }
  if (output.includes("</body>")) {
    const bodyAssets = [stylesInjected ? "" : styleTags, scriptTag]
      .filter(Boolean)
      .join("\n");
    return output.replace("</body>", `  ${bodyAssets}\n</body>`);
  }
  return `${output}\n${[styleTags, scriptTag].filter(Boolean).join("\n")}\n`;
}

function buildSizeReport(manifest: VextFrontendManifest): {
  totalBytes: number;
  assets: VextFrontendManifestAsset[];
} {
  return {
    totalBytes: manifest.assets.reduce((sum, asset) => sum + asset.bytes, 0),
    assets: manifest.assets,
  };
}
