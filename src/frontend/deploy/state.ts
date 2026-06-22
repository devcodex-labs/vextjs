import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { VextFrontendDeployManifestAsset } from "../contract/types.js";

export interface VextFrontendDeployState {
  schemaVersion: 1;
  kind: "frontend-deploy-state";
  updatedAt: string;
  assets: Record<
    string,
    {
      sha256: string;
      bytes: number;
      uploadedAt: string;
    }
  >;
}

export async function readFrontendDeployState(
  stateFile: string,
): Promise<VextFrontendDeployState> {
  if (!existsSync(stateFile)) {
    return createEmptyDeployState();
  }
  const parsed = JSON.parse(
    await readFile(stateFile, "utf-8"),
  ) as Partial<VextFrontendDeployState>;
  return {
    schemaVersion: 1,
    kind: "frontend-deploy-state",
    updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
    assets: parsed.assets ?? {},
  };
}

export async function writeFrontendDeployState(
  stateFile: string,
  assets: VextFrontendDeployManifestAsset[],
): Promise<void> {
  const uploadedAt = new Date().toISOString();
  const state: VextFrontendDeployState = {
    schemaVersion: 1,
    kind: "frontend-deploy-state",
    updatedAt: uploadedAt,
    assets: Object.fromEntries(
      assets.map((asset) => [
        asset.uploadKey,
        {
          sha256: asset.sha256,
          bytes: asset.bytes,
          uploadedAt,
        },
      ]),
    ),
  };
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

function createEmptyDeployState(): VextFrontendDeployState {
  return {
    schemaVersion: 1,
    kind: "frontend-deploy-state",
    updatedAt: new Date(0).toISOString(),
    assets: {},
  };
}
