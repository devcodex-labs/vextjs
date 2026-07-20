import { readFile } from "node:fs/promises";
import path from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import type {
  ResolvedVextFrontendConfig,
  VextFrontendAssetGroup,
  VextFrontendDeployManifest,
  VextFrontendDeployManifestAsset,
  VextFrontendRouteInitialAssets,
  VextFrontendSizeMetric,
  VextFrontendSizeReport,
} from "../contract/types.js";
import { STABLE_FRONTEND_GENERATED_AT } from "../contract/metadata.js";

export interface BuildFrontendSizeReportOptions {
  config: ResolvedVextFrontendConfig;
  deployManifest: VextFrontendDeployManifest;
  routes?: VextFrontendRouteInitialAssets[];
}

export async function buildFrontendSizeReport(
  options: BuildFrontendSizeReportOptions,
): Promise<VextFrontendSizeReport> {
  const assets = await Promise.all(
    options.deployManifest.assets.map((asset) =>
      buildAssetMetric(options.config, asset),
    ),
  );
  const initialJs = assets.filter(
    (asset) => asset.entry && asset.path.endsWith(".js"),
  );
  return {
    schemaVersion: 1,
    kind: "frontend-size-report",
    generatedAt: STABLE_FRONTEND_GENERATED_AT,
    totalBytes: sumBy(assets, "bytes"),
    totalGzipBytes: sumBy(assets, "gzipBytes"),
    totalBrotliBytes: sumBy(assets, "brotliBytes"),
    initialJsBytes: sumBy(initialJs, "bytes"),
    initialJsGzipBytes: sumBy(initialJs, "gzipBytes"),
    initialJsBrotliBytes: sumBy(initialJs, "brotliBytes"),
    appOwnedInitialJsBrotliBytes: sumBy(
      initialJs.filter((asset) => asset.source !== "external"),
      "brotliBytes",
    ),
    assets,
    routes: options.routes,
  };
}

export function assertFrontendBudgets(
  config: ResolvedVextFrontendConfig,
  report: VextFrontendSizeReport,
): void {
  const budgets = config.build.budgets;
  const failures: string[] = [];

  if (budgets.maxAssetBytes > 0) {
    for (const asset of report.assets) {
      if (asset.bytes <= budgets.maxAssetBytes) continue;
      failures.push(
        `${asset.path} is ${formatBytes(asset.bytes)} raw, over maxAssetBytes ${formatBytes(budgets.maxAssetBytes)}`,
      );
    }
  }

  addBudgetFailure(
    failures,
    "maxInitialJsBytes",
    report.initialJsBytes,
    budgets.maxInitialJsBytes,
  );
  addBudgetFailure(
    failures,
    "maxInitialJsGzipBytes",
    report.initialJsGzipBytes,
    budgets.maxInitialJsGzipBytes,
  );
  addBudgetFailure(
    failures,
    "maxInitialJsBrotliBytes",
    report.initialJsBrotliBytes,
    budgets.maxInitialJsBrotliBytes,
  );
  addBudgetFailure(
    failures,
    "maxAppOwnedInitialJsBrotliBytes",
    report.appOwnedInitialJsBrotliBytes,
    budgets.maxAppOwnedInitialJsBrotliBytes,
  );

  if (budgets.maxRouteInitialJsBrotliBytes > 0) {
    const routeSets =
      report.routes && report.routes.length > 0
        ? report.routes.map((route) => ({
            label: route.page,
            bytes: route.initialJsBrotliBytes ?? report.initialJsBrotliBytes,
          }))
        : [{ label: "initial JS", bytes: report.initialJsBrotliBytes }];
    for (const route of routeSets) {
      if (route.bytes <= budgets.maxRouteInitialJsBrotliBytes) continue;
      failures.push(
        `${route.label} is ${formatBytes(route.bytes)} brotli, over maxRouteInitialJsBrotliBytes ${formatBytes(budgets.maxRouteInitialJsBrotliBytes)}`,
      );
    }
  }

  if (budgets.maxTotalBytes > 0 && report.totalBytes > budgets.maxTotalBytes) {
    failures.push(
      `total frontend assets are ${formatBytes(report.totalBytes)} raw, over maxTotalBytes ${formatBytes(budgets.maxTotalBytes)}`,
    );
  }

  if (failures.length === 0) return;
  const message = [
    "[vextjs] frontend build budget exceeded.",
    ...failures.map((failure) => `  - ${failure}`),
    "Recommendations:",
    '  - keep frontend.i18n.clientLoad="current"',
    "  - split large page/layout chunks or adjust route boundaries",
    "  - use React externalRuntime only when your CDN/version-lock strategy is ready",
    "  - raise budgets only after checking size-report.json",
  ].join("\n");
  if (budgets.warnOnly) {
    console.warn(message);
    return;
  }
  throw new Error(message);
}

async function buildAssetMetric(
  config: ResolvedVextFrontendConfig,
  asset: VextFrontendDeployManifestAsset,
): Promise<VextFrontendSizeMetric> {
  const content = await readFile(path.join(config.outDir, asset.file));
  return {
    path: asset.path,
    bytes: asset.bytes,
    gzipBytes: gzipSync(content).byteLength,
    brotliBytes: brotliCompressSync(content).byteLength,
    source: asset.source,
    group: classifyAssetGroup(asset),
    entry: asset.entry,
  };
}

function classifyAssetGroup(
  asset: VextFrontendDeployManifestAsset,
): VextFrontendAssetGroup {
  if (asset.entry) return "entry";
  if (asset.file.endsWith(".css")) return "style";
  if (asset.file.endsWith(".js")) return "shared";
  return "asset";
}

function addBudgetFailure(
  failures: string[],
  label: string,
  actual: number,
  budget: number,
): void {
  if (budget <= 0 || actual <= budget) return;
  failures.push(
    `${label} actual ${formatBytes(actual)} is over budget ${formatBytes(budget)}`,
  );
}

function sumBy(
  items: VextFrontendSizeMetric[],
  key: "bytes" | "gzipBytes" | "brotliBytes",
): number {
  return items.reduce((sum, item) => sum + item[key], 0);
}

function formatBytes(value: number): string {
  return `${value} bytes`;
}
