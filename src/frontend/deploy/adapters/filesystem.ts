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

export function createFilesystemDeployAdapter(
  targetDir: string,
  publicBaseUrl?: string,
): VextFrontendDeployUploadAdapter {
  const canonicalTarget = canonicalPath(targetDir);
  return {
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
