import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { VextRuntimeInspectInput } from "../assistant/contracts.js";
import type { VextMcpProjectInspection } from "../assistant/project-inspector.js";

const RUNTIME_SNAPSHOT_PATH = path.join(".vext", "runtime", "snapshot.json");
const MAX_RUNTIME_SNAPSHOT_BYTES = 1024 * 1024;

export interface VextRuntimeSnapshotResult {
  schemaVersion: 1;
  status: "ok";
  data: {
    availability: "available" | "unavailable" | "invalid";
    source: string;
    projectIdentity: VextMcpProjectInspection["identity"];
    runtimeIdentity: unknown | null;
    section: "summary" | "workers" | "reloads" | "events";
    snapshot: unknown | null;
    items: unknown[];
    events: unknown[];
    pageInfo: {
      limit: number;
      cursor: string | null;
      nextCursor: string | null;
    };
    gap: string | null;
    resyncRequired: boolean;
    reason: string | null;
  };
}

export async function inspectRuntimeSnapshot(input: {
  rootDir: string;
  project: VextMcpProjectInspection;
  options?: VextRuntimeInspectInput;
}): Promise<VextRuntimeSnapshotResult> {
  const section = input.options?.section ?? "summary";
  const limit = input.options?.limit ?? 20;
  const cursor = input.options?.cursor ?? null;
  const absolutePath = path.join(input.rootDir, RUNTIME_SNAPSHOT_PATH);
  const file = await readSnapshotFile(absolutePath);
  if (file.status === "missing") {
    return runtimeResult({
      availability: "unavailable",
      project: input.project,
      section,
      limit,
      cursor,
      reason:
        "Runtime snapshot is not present. Start or inspect runtime through the host; MCP does not start services.",
    });
  }
  if (file.status === "invalid") {
    return runtimeResult({
      availability: "invalid",
      project: input.project,
      section,
      limit,
      cursor,
      reason: file.reason,
    });
  }
  const parsed = parseSnapshot(file.content);
  if (parsed.status === "invalid") {
    return runtimeResult({
      availability: "invalid",
      project: input.project,
      section,
      limit,
      cursor,
      reason: parsed.reason,
    });
  }
  return availableRuntimeResult({
    snapshot: parsed.snapshot,
    project: input.project,
    section,
    limit,
    cursor,
  });
}

async function readSnapshotFile(
  absolutePath: string,
): Promise<
  | { status: "ok"; content: string }
  | { status: "missing" }
  | { status: "invalid"; reason: string }
> {
  try {
    const info = await stat(absolutePath);
    if (!info.isFile()) {
      return {
        status: "invalid",
        reason: "Runtime snapshot path exists but is not a file.",
      };
    }
    if (info.size > MAX_RUNTIME_SNAPSHOT_BYTES) {
      return {
        status: "invalid",
        reason: `Runtime snapshot exceeds ${MAX_RUNTIME_SNAPSHOT_BYTES} bytes.`,
      };
    }
    return { status: "ok", content: await readFile(absolutePath, "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "missing" };
    }
    throw error;
  }
}

function parseSnapshot(
  content: string,
):
  | { status: "ok"; snapshot: Record<string, unknown> }
  | { status: "invalid"; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      status: "invalid",
      reason: "Runtime snapshot is not valid JSON.",
    };
  }
  if (!isRecord(parsed)) {
    return {
      status: "invalid",
      reason: "Runtime snapshot must be a JSON object.",
    };
  }
  if (parsed.schemaVersion !== 1) {
    return {
      status: "invalid",
      reason: "Runtime snapshot schemaVersion must be 1.",
    };
  }
  return { status: "ok", snapshot: parsed };
}

function availableRuntimeResult(input: {
  snapshot: Record<string, unknown>;
  project: VextMcpProjectInspection;
  section: "summary" | "workers" | "reloads" | "events";
  limit: number;
  cursor: string | null;
}): VextRuntimeSnapshotResult {
  const runtimeIdentity = readRecord(input.snapshot.runtimeIdentity);
  const snapshotIdentity = readRecord(input.snapshot.identity);
  const snapshotRevision =
    readString(snapshotIdentity?.contextRevision) ??
    readString(runtimeIdentity?.contextRevision);
  const resyncRequired =
    typeof snapshotRevision === "string" &&
    snapshotRevision !== input.project.identity.contextRevision;
  const offset = decodeCursor(input.cursor);
  const items = sectionItems(input.snapshot, input.section);
  const page = paginate(items, offset, input.limit);
  return {
    schemaVersion: 1,
    status: "ok",
    data: {
      availability: "available",
      source: RUNTIME_SNAPSHOT_PATH,
      projectIdentity: input.project.identity,
      runtimeIdentity,
      section: input.section,
      snapshot:
        input.section === "summary"
          ? {
              summary: input.snapshot.summary ?? null,
              updatedAt: readString(input.snapshot.updatedAt) ?? null,
              counts: {
                workers: readArray(input.snapshot.workers).length,
                reloads: readArray(input.snapshot.reloads).length,
                events: readArray(input.snapshot.events).length,
              },
            }
          : null,
      items: page.items,
      events: input.section === "events" ? page.items : [],
      pageInfo: {
        limit: input.limit,
        cursor: input.cursor,
        nextCursor: page.nextCursor,
      },
      gap: null,
      resyncRequired,
      reason: resyncRequired
        ? "Runtime snapshot contextRevision differs from the current project inspection."
        : null,
    },
  };
}

function runtimeResult(input: {
  availability: "unavailable" | "invalid";
  project: VextMcpProjectInspection;
  section: "summary" | "workers" | "reloads" | "events";
  limit: number;
  cursor: string | null;
  reason: string;
}): VextRuntimeSnapshotResult {
  return {
    schemaVersion: 1,
    status: "ok",
    data: {
      availability: input.availability,
      source: RUNTIME_SNAPSHOT_PATH,
      projectIdentity: input.project.identity,
      runtimeIdentity: null,
      section: input.section,
      snapshot: null,
      items: [],
      events: [],
      pageInfo: {
        limit: input.limit,
        cursor: input.cursor,
        nextCursor: null,
      },
      gap: null,
      resyncRequired: false,
      reason: input.reason,
    },
  };
}

function sectionItems(
  snapshot: Record<string, unknown>,
  section: "summary" | "workers" | "reloads" | "events",
): unknown[] {
  if (section === "summary") return [];
  return readArray(snapshot[section]);
}

function paginate(
  items: unknown[],
  offset: number,
  limit: number,
): { items: unknown[]; nextCursor: string | null } {
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    items: page,
    nextCursor: nextOffset < items.length ? String(nextOffset) : null,
  };
}

function decodeCursor(cursor: string | null): number {
  if (!cursor) return 0;
  const value = Number.parseInt(cursor, 10);
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
