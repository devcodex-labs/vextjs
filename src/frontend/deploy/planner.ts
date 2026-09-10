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
import {
  ProjectFileReadError,
  readProjectFile,
} from "../../lib/project/read-project-file.js";

/** 本地目标可由其他服务/profile先后覆盖；历史上传state不能代替当前文件证据。 */
function filesystemAssetMatches(
  directory: string,
  asset: VextFrontendDeployManifest["assets"][number],
): boolean {
  try {
    const bytes = readProjectFile(directory, asset.file, asset.bytes);
    return (
      bytes !== null &&
      bytes.length === asset.bytes &&
      createSha256(bytes) === asset.sha256
    );
  } catch (error) {
    // 超过预期大小已足以证明需要重新上传；路径/读取一致性错误仍中止计划。
    if (error instanceof ProjectFileReadError && error.kind === "limit")
      return false;
    throw error;
  }
}

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
      const previous =
        previousAssets?.[
          target.physicalDirectory ? asset.file : asset.uploadKey
        ];
      const changed =
        !previous ||
        previous.sha256 !== asset.sha256 ||
        previous.bytes !== asset.bytes ||
        (target.physicalDirectory !== null &&
          !filesystemAssetMatches(target.physicalDirectory, asset));
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
