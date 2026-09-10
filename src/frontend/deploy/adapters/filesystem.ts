import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  canonicalPath,
  resolvePathInside,
} from "../../../lib/path-boundary.js";
import type {
  VextFrontendDeployUploadAdapter,
  VextFrontendDeployUploadAdapterInput,
  VextFrontendDeployUploadAdapterResult,
} from "../../contract/types.js";

const filesystemTargets = new WeakMap<
  VextFrontendDeployUploadAdapter,
  string
>();

/** 只对真实内置adapter暴露物理范围，第三方同名adapter不被误当成本地目录。 */
export function filesystemDeployDirectory(
  adapter: VextFrontendDeployUploadAdapter,
  prefix: string,
): string | null {
  const target = filesystemTargets.get(adapter);
  if (!target) return null;
  return prefix ? canonicalPath(resolveTargetPath(target, prefix)) : target;
}

export function createFilesystemDeployAdapter(
  targetDir: string,
  publicBaseUrl?: string,
): VextFrontendDeployUploadAdapter {
  const canonicalTarget = canonicalPath(targetDir);
  const adapter: VextFrontendDeployUploadAdapter = {
    name: "filesystem",
    targetIdentity: canonicalTarget,
    async upload(
      input: VextFrontendDeployUploadAdapterInput,
    ): Promise<VextFrontendDeployUploadAdapterResult> {
      input.signal?.throwIfAborted();
      if (input.dryRun) {
        return {
          uploaded: false,
          url: createPublicUrl(publicBaseUrl, input.uploadKey),
        };
      }
      const targetPath = resolveTargetPath(canonicalTarget, input.uploadKey);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await copyFile(input.sourcePath, targetPath);
      return {
        uploaded: true,
        url: createPublicUrl(publicBaseUrl, input.uploadKey),
      };
    },
  };
  filesystemTargets.set(adapter, canonicalTarget);
  return adapter;
}

function resolveTargetPath(targetDir: string, uploadKey: string): string {
  return resolvePathInside(targetDir, uploadKey, "frontend upload key", {
    realpath: true,
  });
}

function createPublicUrl(
  publicBaseUrl: string | undefined,
  uploadKey: string,
): string | undefined {
  if (!publicBaseUrl) return undefined;
  return `${publicBaseUrl}${uploadKey.replace(/^\/+/u, "")}`;
}
