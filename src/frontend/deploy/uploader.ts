import type {
  ResolvedVextFrontendConfig,
  VextFrontendDeployManifestAsset,
  VextFrontendDeployManifest,
  VextFrontendDeployResult,
  VextFrontendDeployUploadAdapter,
} from "../contract/types.js";
import { readFile } from "node:fs/promises";
import { canonicalPath } from "../../lib/path-boundary.js";
import {
  listenOwnerEndpoint,
  ProjectOwnerError,
} from "../../lib/project/owner-endpoint.js";
import { resolveDeployAdapter, resolveDeployTarget } from "./target.js";
import { withOutputDirectoryOwner } from "../../lib/project/owner.js";
import { createSha256 } from "./integrity.js";
import { joinUploadKey } from "./manifest.js";
import { readFrontendDeployManifestFile } from "./manifest-validator.js";
import { createFrontendDeployPlan } from "./planner.js";
import {
  readFrontendDeployStateSnapshot,
  writeFrontendDeployState,
  withFrontendDeployStateLock,
} from "./state.js";

export interface DeployFrontendAssetsOptions {
  config: ResolvedVextFrontendConfig;
  manifestPath: string;
  dryRun?: boolean;
  adapter?: VextFrontendDeployUploadAdapter;
  configProfile?: string;
  signal?: AbortSignal;
}

export class FrontendDeployError extends Error {
  constructor(
    message: string,
    readonly result: VextFrontendDeployResult,
  ) {
    super(message);
  }
}

export async function deployFrontendAssets(
  options: DeployFrontendAssetsOptions,
): Promise<VextFrontendDeployResult> {
  const config = {
    ...options.config,
    deploy: {
      ...options.config.deploy,
      upload: {
        ...options.config.deploy.upload,
        stateFile: canonicalPath(options.config.deploy.upload.stateFile),
      },
    },
  };
  const dryRun = options.dryRun ?? config.deploy.upload.dryRun;
  const adapter = options.adapter ?? resolveDeployAdapter(config);
  const target = resolveDeployTarget(config, adapter, options.configProfile);
  const run = async (): Promise<VextFrontendDeployResult> => {
    const manifest = applyDeployConfigOverrides(
      await readFrontendDeployManifestFile(options.manifestPath),
      config,
    );
    const plan = await createFrontendDeployPlan(
      manifest,
      config,
      options.manifestPath,
      { adapter, configProfile: options.configProfile },
    );
    const confirmed: VextFrontendDeployManifestAsset[] = [];
    const invalidated: string[] = [];
    const assets: VextFrontendDeployResult["assets"] = [];
    await runWithConcurrency(
      plan.items,
      config.deploy.upload.concurrency,
      async (item) => {
        const base = { file: item.asset.file, uploadKey: item.asset.uploadKey };
        if (options.signal?.aborted) {
          assets.push({ ...base, status: "cancelled" });
          return;
        }
        if (item.status === "skip") {
          assets.push({ ...base, status: "skipped" });
          return;
        }
        // dry-run 不调用自定义 adapter，框架可以保证零目标/状态写入。
        if (dryRun) {
          assets.push({ ...base, status: "planned" });
          return;
        }
        try {
          const upload = await adapter.upload({
            asset: item.asset,
            sourcePath: item.sourcePath,
            uploadKey: item.asset.uploadKey,
            dryRun: false,
            signal: options.signal,
          });
          if (!upload.uploaded)
            throw new Error("Upload adapter did not confirm success.");
          // 不能用已发生变化的本地文件摘要为远端内容背书。
          if (
            createSha256(await readFile(item.sourcePath)) !== item.asset.sha256
          )
            throw new Error(
              "Deploy source changed while uploading; remote content is unconfirmed.",
            );
          confirmed.push(item.asset);
          assets.push({
            ...base,
            status: target.simulation ? "simulated" : "uploaded",
            url: upload.url,
          });
        } catch (error) {
          invalidated.push(
            target.physicalDirectory ? item.asset.file : item.asset.uploadKey,
          );
          assets.push({
            ...base,
            status: "unconfirmed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
    const result: VextFrontendDeployResult = {
      targetId: target.targetId,
      manifestPath: options.manifestPath,
      stateFile: config.deploy.upload.stateFile,
      dryRun,
      uploaded: assets.filter((item) => item.status === "uploaded").length,
      simulated: assets.filter((item) => item.status === "simulated").length,
      skipped: assets.filter((item) => item.status === "skipped").length,
      unconfirmed: assets.filter((item) => item.status === "unconfirmed")
        .length,
      cancelled: options.signal?.aborted ?? false,
      bytesUploaded:
        dryRun || target.simulation
          ? 0
          : confirmed.reduce((sum, asset) => sum + asset.bytes, 0),
      assets: assets.sort((a, b) => a.file.localeCompare(b.file)),
    };
    if (!dryRun && target.targetId) {
      const snapshot = await readFrontendDeployStateSnapshot(
        config.deploy.upload.stateFile,
      ).catch((error: unknown) => {
        throw new FrontendDeployError(
          error instanceof Error ? error.message : String(error),
          result,
        );
      });
      if (snapshot.digest !== plan.stateDigest)
        throw new FrontendDeployError(
          "[vextjs] Frontend deploy state changed after planning; remote results require reconciliation.",
          result,
        );
      const previous = snapshot.state.targets[target.targetId];
      const changed =
        confirmed.length > 0 ||
        invalidated.some((key) => previous?.assets[key] !== undefined);
      if (changed) {
        const uploadedAt = new Date().toISOString();
        const next = previous?.assets ?? {};
        for (const key of invalidated) delete next[key];
        for (const asset of confirmed)
          next[target.physicalDirectory ? asset.file : asset.uploadKey] = {
            sha256: asset.sha256,
            bytes: asset.bytes,
            uploadedAt,
          };
        snapshot.state.updatedAt = uploadedAt;
        snapshot.state.targets[target.targetId] = {
          simulation: target.simulation,
          manifestDigest: plan.manifestDigest,
          assets: next,
        };
        try {
          await writeFrontendDeployState(
            config.deploy.upload.stateFile,
            snapshot.state,
            plan.stateDigest,
          );
        } catch (error) {
          throw new FrontendDeployError(
            error instanceof Error ? error.message : String(error),
            result,
          );
        }
      }
    }
    if (result.unconfirmed || result.cancelled)
      throw new FrontendDeployError(
        "[vextjs] Frontend deployment incomplete: " +
          (assets.find((asset) => asset.error)?.error ?? "cancelled"),
        result,
      );
    return result;
  };
  if (dryRun) return run();
  return withFrontendDeployStateLock(
    config.deploy.upload.stateFile,
    async () => {
      let endpoint;
      try {
        if (target.storageLockKey)
          endpoint = await listenOwnerEndpoint(target.storageLockKey, () => ({
            pid: process.pid,
          }));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EADDRINUSE")
          throw new ProjectOwnerError(
            "VEXT_OWNER_BUSY",
            "Frontend storage target already has a writer.",
          );
        throw error;
      }
      try {
        return await (target.physicalDirectory
          ? withOutputDirectoryOwner(target.physicalDirectory, run)
          : run());
      } finally {
        await endpoint?.close();
      }
    },
  );
}

function applyDeployConfigOverrides(
  manifest: VextFrontendDeployManifest,
  config: ResolvedVextFrontendConfig,
): VextFrontendDeployManifest {
  const prefix = config.deploy.upload.prefix;
  if (prefix === manifest.upload.prefix) {
    return manifest;
  }
  return {
    ...manifest,
    upload: {
      ...manifest.upload,
      prefix,
      dryRun: config.deploy.upload.dryRun,
    },
    assets: manifest.assets.map((asset) => ({
      ...asset,
      uploadKey: joinUploadKey(prefix, asset.file),
    })),
  };
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workerCount = Math.max(1, Math.min(concurrency, queue.length || 1));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item !== undefined) {
          await worker(item);
        }
      }
    }),
  );
}
