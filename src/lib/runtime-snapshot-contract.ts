import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { readProjectFile } from "./project/read-project-file.js";
import { projectIdentityDigest } from "./project/identity.js";

export const RUNTIME_SNAPSHOT_DIRECTORY = ".vext/runtime/snapshots";
export const LEGACY_RUNTIME_SNAPSHOT_PATH = ".vext/runtime/snapshot.json";
export const MAX_RUNTIME_SNAPSHOT_BYTES = 1024 * 1024;
export const MAX_RUNTIME_SNAPSHOT_TOTAL_BYTES = 8 * 1024 * 1024;
export const MAX_RUNTIME_INSTANCES = 200;
export const RUNTIME_COLLECTION_LIMITS = {
  events: 200,
  reloads: 100,
  workers: 200,
} as const;
export const INSTANCE_ID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const MODES = [
  "development",
  "production",
  "job-worker",
  "job-scheduler",
  "cluster",
] as const;

export interface VextRuntimeSnapshotIdentity {
  instanceId: string;
  projectId: string | null;
  rootDir: string;
  mode: (typeof MODES)[number];
  pid: number;
  startedAt: string;
  sourceRevision: string | null;
}

export interface VextRuntimeSnapshot {
  schemaVersion: 2;
  runtimeIdentity: VextRuntimeSnapshotIdentity;
  updatedAt: string;
  summary: Record<string, unknown>;
  workers: unknown[];
  reloads: unknown[];
  events: unknown[];
}

/** 每次 owner 启动生成一次，后续更新复用；PID 不充当跨启动的实例身份。 */
export function createRuntimeSnapshotIdentity(
  rootDir: string,
  mode: VextRuntimeSnapshotIdentity["mode"],
): VextRuntimeSnapshotIdentity {
  const root = realpathSync(rootDir);
  let projectId: string | null = null;
  try {
    const bytes = readProjectFile(root, "package.json", 256 * 1024);
    const pkg: unknown =
      bytes === null
        ? null
        : JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const name =
      isRuntimeRecord(pkg) && typeof pkg.name === "string" ? pkg.name : null;
    projectId = projectIdentityDigest(root, name);
  } catch {
    /* Missing evidence is diagnostic-only; the runtime may still start. */
  }
  return {
    instanceId: randomUUID(),
    projectId,
    rootDir: root,
    mode,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    sourceRevision: null,
  };
}

export function parseRuntimeSnapshot(
  bytes: Buffer,
): VextRuntimeSnapshot | null {
  try {
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (
      !isRuntimeRecord(value) ||
      value.schemaVersion !== 2 ||
      !isRuntimeRecord(value.runtimeIdentity) ||
      !isRuntimeRecord(value.summary) ||
      !isTimestamp(value.updatedAt)
    )
      return null;
    const id = value.runtimeIdentity;
    if (
      typeof id.instanceId !== "string" ||
      !INSTANCE_ID_PATTERN.test(id.instanceId) ||
      (id.projectId !== null &&
        (typeof id.projectId !== "string" ||
          !/^[a-f0-9]{64}$/u.test(id.projectId))) ||
      typeof id.rootDir !== "string" ||
      !MODES.includes(id.mode as VextRuntimeSnapshotIdentity["mode"]) ||
      !Number.isSafeInteger(id.pid) ||
      (id.pid as number) <= 0 ||
      !isTimestamp(id.startedAt) ||
      (id.sourceRevision !== null &&
        (typeof id.sourceRevision !== "string" ||
          !/^[a-f0-9]{64}$/u.test(id.sourceRevision)))
    )
      return null;
    for (const [key, limit] of Object.entries(RUNTIME_COLLECTION_LIMITS)) {
      if (
        !Array.isArray(value[key]) ||
        value[key].length > limit ||
        !value[key].every(isRuntimeRecord)
      )
        return null;
    }
    return value as unknown as VextRuntimeSnapshot;
  } catch {
    return null;
  }
}

export function isRuntimeRecord(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
