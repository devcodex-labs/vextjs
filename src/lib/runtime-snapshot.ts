import { mkdir, opendir, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolvePathInside } from "./path-boundary.js";
import { readProjectFile } from "./project/read-project-file.js";
import {
  RUNTIME_SNAPSHOT_DIRECTORY,
  MAX_RUNTIME_SNAPSHOT_BYTES,
  MAX_RUNTIME_INSTANCES,
  RUNTIME_COLLECTION_LIMITS,
  INSTANCE_ID_PATTERN,
  parseRuntimeSnapshot,
  type VextRuntimeSnapshot,
  type VextRuntimeSnapshotIdentity,
} from "./runtime-snapshot-contract.js";
export {
  createRuntimeSnapshotIdentity,
  type VextRuntimeSnapshotIdentity,
} from "./runtime-snapshot-contract.js";
import path from "node:path";

const {
  events: MAX_EVENTS,
  reloads: MAX_RELOADS,
  workers: MAX_WORKERS,
} = RUNTIME_COLLECTION_LIMITS;
const updates = new Map<string, Promise<void>>();
export interface VextRuntimeSnapshotEvent {
  id?: string;
  type: string;
  at?: string;
  [key: string]: unknown;
}

export interface VextRuntimeSnapshotInput {
  rootDir: string;
  runtimeIdentity: VextRuntimeSnapshotIdentity;
  summary?: Record<string, unknown>;
  workers?: unknown[];
  reloads?: unknown[];
  events?: VextRuntimeSnapshotEvent[];
}

export interface VextRuntimeSnapshotPatch {
  rootDir: string;
  runtimeIdentity: VextRuntimeSnapshotIdentity;
  summary?: Record<string, unknown>;
  workers?: unknown[];
  reload?: Record<string, unknown>;
  event?: VextRuntimeSnapshotEvent;
}

export async function writeRuntimeSnapshot(
  input: VextRuntimeSnapshotInput,
): Promise<void> {
  await serializeUpdate(input, async () => {
    if (readRuntimeSnapshot(input.rootDir, input.runtimeIdentity.instanceId))
      throw new Error(
        "[vextjs] Runtime instance already initialized; use patch.",
      );
    const now = new Date().toISOString();
    await atomicWriteRuntimeSnapshot(input.rootDir, {
      schemaVersion: 2,
      runtimeIdentity: input.runtimeIdentity,
      updatedAt: now,
      summary: input.summary ?? {},
      workers: limitArray(input.workers ?? [], MAX_WORKERS),
      reloads: limitArray(input.reloads ?? [], MAX_RELOADS),
      events: limitArray(
        (input.events ?? []).map((event) => normalizeEvent(event, now)),
        MAX_EVENTS,
      ),
    });
  });
  if (input.runtimeIdentity.projectId)
    await cleanupStoppedRuntimeSnapshots(
      input.rootDir,
      input.runtimeIdentity.projectId,
    );
}

export async function patchRuntimeSnapshot(
  input: VextRuntimeSnapshotPatch,
): Promise<void> {
  await serializeUpdate(input, async () => {
    const now = new Date().toISOString();
    const previous = readRuntimeSnapshot(
      input.rootDir,
      input.runtimeIdentity.instanceId,
    );
    if (
      previous &&
      JSON.stringify(previous.runtimeIdentity) !==
        JSON.stringify(input.runtimeIdentity)
    )
      throw new Error("[vextjs] Runtime snapshot owner mismatch.");
    const runtimeIdentity = input.runtimeIdentity;
    const events = readArray(previous?.events);
    if (input.event) events.push(normalizeEvent(input.event, now));
    const reloads = readArray(previous?.reloads);
    if (input.reload) {
      reloads.push({
        id: input.reload.id ?? eventId("reload", now),
        at: now,
        ...input.reload,
      });
    }
    await atomicWriteRuntimeSnapshot(input.rootDir, {
      schemaVersion: 2,
      runtimeIdentity,
      updatedAt: now,
      summary: {
        ...(readRecord(previous?.summary) ?? {}),
        ...(input.summary ?? {}),
      },
      workers: limitArray(
        input.workers ?? readArray(previous?.workers),
        MAX_WORKERS,
      ),
      reloads: limitArray(reloads, MAX_RELOADS),
      events: limitArray(events, MAX_EVENTS),
    });
  });
}

export function runtimeModeFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): VextRuntimeSnapshotIdentity["mode"] {
  if (env.VEXT_DEV_MODE === "1" || env.VEXT_MODE === "dev")
    return "development";
  return "production";
}

function readRuntimeSnapshot(
  rootDir: string,
  instanceId: string,
): VextRuntimeSnapshot | null {
  const bytes = readProjectFile(
    rootDir,
    snapshotRelativePath(instanceId),
    MAX_RUNTIME_SNAPSHOT_BYTES,
  );
  if (!bytes) return null;
  const parsed = parseRuntimeSnapshot(bytes);
  if (!parsed)
    throw new Error(
      "[vextjs] Invalid runtime snapshot; refusing to overwrite unknown contents.",
    );
  return parsed;
}

async function atomicWriteRuntimeSnapshot(
  rootDir: string,
  snapshot: VextRuntimeSnapshot,
): Promise<void> {
  const relative = snapshotRelativePath(snapshot.runtimeIdentity.instanceId);
  const target = resolvePathInside(rootDir, relative, "runtime snapshot", {
    realpath: true,
  });
  const content = Buffer.from(JSON.stringify(snapshot) + "\n");
  if (
    content.length > MAX_RUNTIME_SNAPSHOT_BYTES ||
    !parseRuntimeSnapshot(content)
  )
    throw new Error("[vextjs] Invalid or oversized runtime snapshot.");
  await mkdir(path.dirname(target), { recursive: true });
  resolvePathInside(rootDir, relative, "runtime snapshot", { realpath: true });
  const temporary = target + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, content, { flag: "wx" });
    resolvePathInside(rootDir, relative, "runtime snapshot", {
      realpath: true,
    });
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

function snapshotRelativePath(instanceId: string): string {
  if (!INSTANCE_ID_PATTERN.test(instanceId))
    throw new Error("[vextjs] Invalid runtime instanceId.");
  return RUNTIME_SNAPSHOT_DIRECTORY + "/" + instanceId + ".json";
}

/** 同一 owner 的 read/merge/rename 必须顺序执行；失败不毒化后续更新队列。 */
async function serializeUpdate(
  input: VextRuntimeSnapshotInput | VextRuntimeSnapshotPatch,
  action: () => Promise<void>,
): Promise<void> {
  const root = realpathSync(input.rootDir);
  if (input.runtimeIdentity.rootDir !== root)
    throw new Error("[vextjs] Runtime snapshot root mismatch.");
  const key =
    root + "\n" + snapshotRelativePath(input.runtimeIdentity.instanceId);
  const next = (updates.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(action);
  updates.set(key, next);
  try {
    await next;
  } finally {
    if (updates.get(key) === next) updates.delete(key);
  }
}

/** 仅清理同项目、已报告停止至少24小时且PID不存在的记录；未知存活状态保留。 */
export async function cleanupStoppedRuntimeSnapshots(
  rootDir: string,
  projectId: string,
  now = Date.now(),
): Promise<void> {
  try {
    const directory = resolvePathInside(
      rootDir,
      RUNTIME_SNAPSHOT_DIRECTORY,
      "runtime snapshots",
      { realpath: true },
    );
    const entries = await opendir(directory);
    let count = 0;
    for await (const entry of entries) {
      if (++count > MAX_RUNTIME_INSTANCES) break;
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const instanceId = entry.name.slice(0, -5);
      if (!INSTANCE_ID_PATTERN.test(instanceId)) continue;
      try {
        const snapshot = readRuntimeSnapshot(rootDir, instanceId);
        if (
          !snapshot ||
          snapshot.runtimeIdentity.projectId !== projectId ||
          snapshot.runtimeIdentity.rootDir !== realpathSync(rootDir) ||
          snapshot.runtimeIdentity.instanceId !== instanceId ||
          snapshot.summary.state !== "stopped" ||
          now - Date.parse(snapshot.updatedAt) < 24 * 60 * 60 * 1000
        )
          continue;
        try {
          process.kill(snapshot.runtimeIdentity.pid, 0);
          continue;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") continue;
        }
        await unlink(
          resolvePathInside(
            rootDir,
            snapshotRelativePath(instanceId),
            "runtime cleanup",
            { realpath: true },
          ),
        );
      } catch {
        /* 不因诊断文件清理失败中断应用，也不删除不可证明的记录。 */
      }
    }
  } catch {
    /* 可选诊断目录不影响服务启动。 */
  }
}

function normalizeEvent(
  event: VextRuntimeSnapshotEvent,
  now: string,
): VextRuntimeSnapshotEvent {
  return {
    id: event.id ?? eventId(event.type, now),
    at: event.at ?? now,
    ...event,
  };
}

function eventId(type: string, at: string): string {
  return `${type}:${at}:${randomUUID()}`;
}

function limitArray<T>(items: T[], limit: number): T[] {
  return items.slice(Math.max(0, items.length - limit));
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
