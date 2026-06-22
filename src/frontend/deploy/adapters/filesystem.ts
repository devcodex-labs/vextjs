import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  VextFrontendDeployUploadAdapter,
  VextFrontendDeployUploadAdapterInput,
  VextFrontendDeployUploadAdapterResult,
} from "../../contract/types.js";

export function createFilesystemDeployAdapter(
  targetDir: string,
  publicBaseUrl?: string,
): VextFrontendDeployUploadAdapter {
  return {
    name: "filesystem",
    async upload(
      input: VextFrontendDeployUploadAdapterInput,
    ): Promise<VextFrontendDeployUploadAdapterResult> {
      if (input.dryRun) {
        return {
          uploaded: false,
          url: createPublicUrl(publicBaseUrl, input.uploadKey),
        };
      }
      const targetPath = resolveTargetPath(targetDir, input.uploadKey);
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
  const normalized = uploadKey.replace(/\\/g, "/").replace(/^\/+/u, "");
  const targetPath = path.resolve(targetDir, normalized);
  const relative = path.relative(targetDir, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`[vextjs] Invalid frontend upload key: ${uploadKey}`);
  }
  return targetPath;
}

function createPublicUrl(
  publicBaseUrl: string | undefined,
  uploadKey: string,
): string | undefined {
  if (!publicBaseUrl) return undefined;
  return `${publicBaseUrl}${uploadKey.replace(/^\/+/u, "")}`;
}
