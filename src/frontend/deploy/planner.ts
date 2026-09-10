import type {
  ResolvedVextFrontendConfig,
  VextFrontendDeployManifest,
  VextFrontendDeployPlan,
  VextFrontendDeployPlanItem,
  VextFrontendDeployUploadAdapter,
} from "../contract/types.js";
import { resolvePathInside } from "../../lib/path-boundary.js";
import { validateFrontendDeployManifest } from "./manifest-validator.js";
import { readFrontendDeployStateSnapshot } from "./state.js";
import { resolveDeployAdapter, resolveDeployTarget } from "./target.js";
import { createSha256 } from "./integrity.js";

export async function createFrontendDeployPlan(
  manifest: VextFrontendDeployManifest,
  config: ResolvedVextFrontendConfig,
  manifestPath: string,
  options: {
    adapter?: VextFrontendDeployUploadAdapter;
    configProfile?: string;
  } = {},
): Promise<VextFrontendDeployPlan> {
  const validatedManifest = await validateFrontendDeployManifest(
    manifest,
    config,
  );
  const snapshot = await readFrontendDeployStateSnapshot(
    config.deploy.upload.stateFile,
  );
  const target = resolveDeployTarget(
    config,
    options.adapter ?? resolveDeployAdapter(config),
    options.configProfile,
  );
  const previousAssets = target.targetId
    ? snapshot.state.targets[target.targetId]?.assets
    : undefined;
  const items: VextFrontendDeployPlanItem[] = validatedManifest.assets.map(
    (asset, index) => {
      const previous = previousAssets?.[asset.uploadKey];
      const changed =
        !previous ||
        previous.sha256 !== asset.sha256 ||
        previous.bytes !== asset.bytes;
      return {
        asset,
        sourcePath: resolvePathInside(
          config.outDir,
          asset.file,
          `frontend deploy manifest asset[${index}].file`,
          { realpath: true },
        ),
        status: changed ? "upload" : "skip",
        reason: !target.targetId
          ? "unknown-target"
          : !previous
            ? "missing-state"
            : changed
              ? "hash-changed"
              : "unchanged",
        previousSha256: previous?.sha256,
      };
    },
  );

  return {
    targetId: target.targetId,
    simulation: target.simulation,
    stateDigest: snapshot.digest,
    manifestDigest: createSha256(
      Buffer.from(JSON.stringify(validatedManifest)),
    ),
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
