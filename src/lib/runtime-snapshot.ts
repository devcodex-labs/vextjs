import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const RUNTIME_SNAPSHOT_PATH = path.join(".vext", "runtime", "snapshot.json");
const MAX_EVENTS = 200;
const MAX_RELOADS = 100;
const MAX_WORKERS = 200;

export interface VextRuntimeSnapshotIdentity {
  mode:
    | "development"
    | "production"
    | "job-worker"
    | "job-scheduler"
    | "cluster";
  pid: number;
  startedAt?: string;
  contextRevision?: string | null;
}

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
  const now = new Date().toISOString();
  await atomicWriteRuntimeSnapshot(input.rootDir, {
    schemaVersion: 1,
    identity: {
      contextRevision: input.runtimeIdentity.contextRevision ?? null,
    },
    runtimeIdentity: normalizeRuntimeIdentity(input.runtimeIdentity, now),
    updatedAt: now,
    summary: input.summary ?? {},
    workers: limitArray(input.workers ?? [], MAX_WORKERS),
    reloads: limitArray(input.reloads ?? [], MAX_RELOADS),
    events: limitArray(
      (input.events ?? []).map((event) => normalizeEvent(event, now)),
      MAX_EVENTS,
    ),
  });
}

export async function patchRuntimeSnapshot(
  input: VextRuntimeSnapshotPatch,
): Promise<void> {
  const now = new Date().toISOString();
  const previous = await readRuntimeSnapshot(input.rootDir);
  const previousRuntimeIdentity = readRecord(previous?.runtimeIdentity);
  const previousStartedAt =
    typeof previousRuntimeIdentity?.startedAt === "string"
      ? previousRuntimeIdentity.startedAt
      : undefined;
  const runtimeIdentity = normalizeRuntimeIdentity(
    {
      ...input.runtimeIdentity,
      startedAt: input.runtimeIdentity.startedAt ?? previousStartedAt,
    },
    now,
  );
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
    schemaVersion: 1,
    identity: {
      contextRevision: runtimeIdentity.contextRevision ?? null,
    },
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
}

export function runtimeModeFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): VextRuntimeSnapshotIdentity["mode"] {
  if (env.VEXT_DEV_MODE === "1" || env.VEXT_MODE === "dev")
    return "development";
  return "production";
}

async function readRuntimeSnapshot(
  rootDir: string,
): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(snapshotPath(rootDir), "utf8");
    const parsed = JSON.parse(content) as unknown;
    return readRecord(parsed);
  } catch {
    return null;
  }
}

async function atomicWriteRuntimeSnapshot(
  rootDir: string,
  snapshot: Record<string, unknown>,
): Promise<void> {
  const target = snapshotPath(rootDir);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

function snapshotPath(rootDir: string): string {
  return path.join(rootDir, RUNTIME_SNAPSHOT_PATH);
}

function normalizeRuntimeIdentity(
  identity: VextRuntimeSnapshotIdentity,
  now: string,
): VextRuntimeSnapshotIdentity {
  return {
    ...identity,
    startedAt: identity.startedAt ?? now,
    contextRevision: identity.contextRevision ?? null,
  };
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
  return `${type}:${at}:${process.pid}`;
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
