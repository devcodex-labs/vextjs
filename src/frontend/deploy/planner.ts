import path from "node:path";
import type {
  ResolvedVextFrontendConfig,
  VextFrontendDeployManifest,
  VextFrontendDeployPlan,
  VextFrontendDeployPlanItem,
} from "../contract/types.js";
import { readFrontendDeployState } from "./state.js";

export async function createFrontendDeployPlan(
  manifest: VextFrontendDeployManifest,
  config: ResolvedVextFrontendConfig,
  manifestPath: string,
): Promise<VextFrontendDeployPlan> {
  const state = await readFrontendDeployState(config.deploy.upload.stateFile);
  const items: VextFrontendDeployPlanItem[] = manifest.assets.map((asset) => {
    const previous = state.assets[asset.uploadKey];
    const changed = !previous || previous.sha256 !== asset.sha256;
    return {
      asset,
      sourcePath: path.join(config.outDir, asset.file),
      status: changed ? "upload" : "skip",
      reason: !previous
        ? "missing-state"
        : changed
          ? "hash-changed"
          : "unchanged",
      previousSha256: previous?.sha256,
    };
  });

  return {
    manifestPath,
    outDir: config.outDir,
    items,
    summary: {
      total: items.length,
      upload: items.filter((item) => item.status === "upload").length,
      skip: items.filter((item) => item.status === "skip").length,
      bytes: items.reduce((sum, item) => sum + item.asset.bytes, 0),
      uploadBytes: items
        .filter((item) => item.status === "upload")
        .reduce((sum, item) => sum + item.asset.bytes, 0),
    },
  };
}
