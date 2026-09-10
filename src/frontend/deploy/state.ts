import { mkdir, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { createSha256 } from "./integrity.js";
import {
  canonicalPath,
  normalizeSafeRelativePath,
} from "../../lib/path-boundary.js";
import {
  listenOwnerEndpoint,
  ProjectOwnerError,
} from "../../lib/project/owner-endpoint.js";
import { readProjectFile } from "../../lib/project/read-project-file.js";

export interface VextFrontendDeployState {
  schemaVersion: 2;
  kind: "frontend-deploy-state";
  updatedAt: string;
  targets: Record<
    string,
    {
      simulation: boolean;
      manifestDigest: string;
      assets: Record<
        string,
        {
          sha256: string;
          bytes: number;
          uploadedAt: string;
        }
      >;
    }
  >;
}

export interface DeployStateSnapshot {
  state: VextFrontendDeployState;
  digest: string | null;
}
const heldState = new AsyncLocalStorage<string>();

/** OS 端点自动随进程退出释放，不依据陈旧文件或 PID 猜测抢锁。 */
export async function withFrontendDeployStateLock<T>(
  stateFile: string,
  operation: () => Promise<T>,
): Promise<T> {
  const file = canonicalPath(stateFile);
  if (heldState.getStore() === file) return operation();
  let endpoint;
  try {
    endpoint = await listenOwnerEndpoint(
      "frontend-deploy-state:" + file,
      () => ({ pid: process.pid }),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE")
      throw new ProjectOwnerError(
        "VEXT_OWNER_BUSY",
        "Frontend deployment state already has a writer.",
      );
    throw error;
  }
  try {
    return await heldState.run(file, operation);
  } finally {
    await endpoint.close();
  }
}

export async function readFrontendDeployState(
  stateFile: string,
): Promise<VextFrontendDeployState> {
  return (await readFrontendDeployStateSnapshot(stateFile)).state;
}

export async function readFrontendDeployStateSnapshot(
  stateFile: string,
): Promise<DeployStateSnapshot> {
  const file = path.resolve(stateFile);
  const bytes = readProjectFile(
    path.dirname(file),
    path.basename(file),
    64 * 1024 * 1024,
  );
  if (bytes === null) return { state: createEmptyDeployState(), digest: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[vextjs] Invalid frontend deploy state JSON: ${message}`);
  }
  return {
    state: parseFrontendDeployState(parsed),
    digest: createSha256(bytes),
  };
}

export async function writeFrontendDeployState(
  stateFile: string,
  state: VextFrontendDeployState,
  expectedDigest: string | null,
): Promise<void> {
  const file = canonicalPath(stateFile);
  const validated = parseFrontendDeployState(state);
  await withFrontendDeployStateLock(file, async () => {
    if ((await readFrontendDeployStateSnapshot(file)).digest !== expectedDigest)
      throw new Error(
        "[vextjs] Frontend deploy state changed after planning; preserve current state and retry.",
      );
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    let created = false;
    try {
      await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      created = true;
      // 对不遵守 writer 协议的外部编辑再做一次字节比较。
      if (
        (await readFrontendDeployStateSnapshot(file)).digest !== expectedDigest
      )
        throw new Error(
          "[vextjs] Frontend deploy state changed before commit.",
        );
      await rename(temporary, file);
      created = false;
    } finally {
      if (created) await unlink(temporary);
    }
  });
}

function createEmptyDeployState(): VextFrontendDeployState {
  return {
    schemaVersion: 2,
    kind: "frontend-deploy-state",
    updatedAt: new Date(0).toISOString(),
    targets: {},
  };
}

function parseFrontendDeployState(value: unknown): VextFrontendDeployState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("[vextjs] frontend deploy state must be an object.");
  }
  const state = value as Record<string, unknown>;
  const unknownKeys = Object.keys(state).filter(
    (key) => !["schemaVersion", "kind", "updatedAt", "targets"].includes(key),
  );
  if (
    state.schemaVersion !== 2 ||
    state.kind !== "frontend-deploy-state" ||
    unknownKeys.length > 0
  ) {
    throw new Error(
      "[vextjs] frontend deploy state must use schemaVersion 2, the expected kind, and supported fields only; unsupported state is preserved.",
    );
  }
  const updatedAt = expectStateDate(state.updatedAt, "updatedAt");
  if (
    !state.targets ||
    typeof state.targets !== "object" ||
    Array.isArray(state.targets)
  )
    throw new Error(
      "[vextjs] frontend deploy state.targets must be an object.",
    );
  const targets: VextFrontendDeployState["targets"] = {};
  for (const [targetId, value] of Object.entries(state.targets)) {
    if (
      !/^[a-f0-9]{64}$/u.test(targetId) ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    )
      throw new Error("[vextjs] Invalid frontend deploy state target.");
    const target = value as Record<string, unknown>;
    if (
      Object.keys(target).some(
        (key) => !["simulation", "manifestDigest", "assets"].includes(key),
      ) ||
      typeof target.simulation !== "boolean" ||
      typeof target.manifestDigest !== "string" ||
      !/^[a-f0-9]{64}$/u.test(target.manifestDigest)
    )
      throw new Error(
        "[vextjs] Invalid frontend deploy state target metadata.",
      );
    targets[targetId] = {
      simulation: target.simulation,
      manifestDigest: target.manifestDigest,
      assets: parseStateAssets(target.assets),
    };
  }
  return {
    schemaVersion: 2,
    kind: "frontend-deploy-state",
    updatedAt,
    targets,
  };
}

function parseStateAssets(
  value: unknown,
): VextFrontendDeployState["targets"][string]["assets"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("[vextjs] frontend deploy state.assets must be an object.");
  }

  const assets: VextFrontendDeployState["targets"][string]["assets"] = {};
  for (const [uploadKey, rawEntry] of Object.entries(
    value as Record<string, unknown>,
  )) {
    let canonicalKey: string;
    try {
      canonicalKey = normalizeSafeRelativePath(
        uploadKey,
        "frontend deploy state upload key",
      );
    } catch {
      throw new Error(
        `[vextjs] Invalid frontend deploy state upload key: ${uploadKey}`,
      );
    }
    if (canonicalKey !== uploadKey) {
      throw new Error(
        `[vextjs] frontend deploy state upload key must use canonical POSIX separators: ${uploadKey}`,
      );
    }
    if (
      typeof rawEntry !== "object" ||
      rawEntry === null ||
      Array.isArray(rawEntry)
    ) {
      throw new Error(
        `[vextjs] frontend deploy state entry ${uploadKey} must be an object.`,
      );
    }
    const entry = rawEntry as Record<string, unknown>;
    if (
      Object.keys(entry).some(
        (key) => !["sha256", "bytes", "uploadedAt"].includes(key),
      ) ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(entry.sha256) ||
      !Number.isSafeInteger(entry.bytes) ||
      (entry.bytes as number) < 0
    ) {
      throw new Error(
        `[vextjs] frontend deploy state entry ${uploadKey} has invalid integrity metadata.`,
      );
    }
    assets[uploadKey] = {
      sha256: entry.sha256,
      bytes: entry.bytes as number,
      uploadedAt: expectStateDate(entry.uploadedAt, `${uploadKey}.uploadedAt`),
    };
  }
  return assets;
}

function expectStateDate(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value === "" ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error(
      `[vextjs] frontend deploy state ${label} must be a date string.`,
    );
  }
  return value;
}
