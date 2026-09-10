import { createHash } from "node:crypto";
import type {
  ResolvedVextFrontendConfig,
  VextFrontendDeployUploadAdapter,
} from "../contract/types.js";
import { canonicalProjectRoot } from "../../lib/path-boundary.js";
import { validateConfigProfileName } from "../../lib/config-profile.js";
import {
  createFilesystemDeployAdapter,
  filesystemDeployDirectory,
} from "./adapters/filesystem.js";
import { createMockDeployAdapter } from "./adapters/mock.js";

export function resolveDeployAdapter(
  config: ResolvedVextFrontendConfig,
): VextFrontendDeployUploadAdapter {
  const adapter = config.deploy.upload.adapter;
  if (typeof adapter !== "string") return adapter;
  if (adapter === "mock") return createMockDeployAdapter();
  if (adapter === "filesystem") {
    if (!config.deploy.upload.targetDir)
      throw new Error(
        "[vextjs] config.frontend.deploy.upload.targetDir is required for filesystem upload.",
      );
    return createFilesystemDeployAdapter(
      config.deploy.upload.targetDir,
      config.deploy.upload.publicBaseUrl ?? config.deploy.assetBaseUrl,
    );
  }
  throw new Error(`[vextjs] Unsupported frontend deploy adapter: ${adapter}`);
}

/** 状态按服务/profile分区；物理写锁不含服务/profile，以发现同一远端目标的竞争。 */
export function resolveDeployTarget(
  config: ResolvedVextFrontendConfig,
  adapter: VextFrontendDeployUploadAdapter,
  profile = "production",
) {
  profile = validateConfigProfileName(profile);
  const identity = adapter.targetIdentity;
  if (
    identity !== undefined &&
    (typeof identity !== "string" ||
      identity.trim() === "" ||
      identity.includes("\0"))
  )
    throw new Error(
      "[vextjs] deploy adapter targetIdentity must be a non-empty stable string.",
    );
  const simulation = adapter.name === "mock";
  const physicalDirectory = filesystemDeployDirectory(
    adapter,
    config.deploy.upload.prefix,
  );
  const digest = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const storage = physicalDirectory
    ? ["filesystem-directory", physicalDirectory, simulation]
    : identity
      ? [adapter.name, identity, config.deploy.upload.prefix, simulation]
      : null;
  return {
    physicalDirectory,
    targetId: storage
      ? digest([canonicalProjectRoot(config.projectRoot), profile, ...storage])
      : null,
    simulation,
    // 同一 namespace 的父/子 prefix 可能指向同一个对象，写锁按 namespace 串行。
    storageLockKey:
      storage && !physicalDirectory
        ? "frontend-deploy-target:" +
          digest([adapter.name, identity, simulation])
        : null,
  };
}
