import type { VextRuntimeInspectInput } from "../assistant/contracts.js";
import type { VextMcpProjectInspection } from "../assistant/project-inspector.js";
import { paginateAssistantItems } from "../assistant/pagination.js";
import {
  RUNTIME_SNAPSHOT_DIRECTORY,
  LEGACY_RUNTIME_SNAPSHOT_PATH,
  isRuntimeRecord,
} from "../lib/runtime-snapshot-contract.js";
import { readRuntimeInstances } from "./runtime-snapshot-reader.js";

export interface VextRuntimeSnapshotResult {
  schemaVersion: 2;
  status: "ok";
  data: {
    availability:
      | "available"
      | "partial"
      | "unavailable"
      | "invalid"
      | "legacy";
    source: string;
    projectIdentity: VextMcpProjectInspection["identity"];
    runtimeIdentity: unknown | null;
    section: "summary" | "workers" | "reloads" | "events";
    snapshot: unknown | null;
    instances: unknown[];
    items: unknown[];
    events: unknown[];
    evidence: {
      ownership: "verified" | "unverified";
      liveness: "unverified";
      sourceFreshness: "current" | "stale" | "unverified";
    };
    pageInfo: {
      limit: number;
      cursor: string | null;
      nextCursor: string | null;
      total: number;
      truncated: boolean;
    };
    gap: string | null;
    resyncRequired: boolean;
    reason: string | null;
    issues: string[];
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
  const read = await readRuntimeInstances(
    input.rootDir,
    input.project.identity.projectId,
  );
  const snapshots = input.options?.instanceId
    ? read.snapshots.filter(
        (snapshot) =>
          snapshot.runtimeIdentity.instanceId === input.options!.instanceId,
      )
    : read.snapshots;
  const evidence = snapshots.map((snapshot) => {
    const source = snapshot.runtimeIdentity.sourceRevision;
    return {
      instanceId: snapshot.runtimeIdentity.instanceId,
      runtimeIdentity: snapshot.runtimeIdentity,
      updatedAt: snapshot.updatedAt,
      summary: snapshot.summary,
      counts: {
        workers: snapshot.workers.length,
        reloads: snapshot.reloads.length,
        events: snapshot.events.length,
      },
      evidence: {
        ownership: "verified" as const,
        liveness: "unverified" as const,
        sourceFreshness:
          source && input.project.identity.sourceRevision
            ? source === input.project.identity.sourceRevision
              ? ("current" as const)
              : ("stale" as const)
            : ("unverified" as const),
      },
    };
  });
  const items =
    section === "summary"
      ? evidence
      : snapshots.flatMap((snapshot) =>
          snapshot[section].map((item) => ({
            ...(isRuntimeRecord(item) ? item : {}),
            instanceId: snapshot.runtimeIdentity.instanceId,
          })),
        );
  const page = paginateAssistantItems(items, {
    identity: {
      projectId: input.project.identity.projectId,
      contextRevision: input.project.identity.contextRevision,
      revision: read.revision,
      instanceId: input.options?.instanceId ?? null,
    },
    section: "runtime:" + section,
    limit,
    cursor: cursor ?? undefined,
    maxBytes: 64 * 1024,
  });
  const stale = evidence.some(
    (item) => item.evidence.sourceFreshness === "stale",
  );
  const legacy =
    !snapshots.length && !input.options?.instanceId && read.legacy !== null;
  let reason: string | null = !page.ok
    ? page.failure.message
    : read.issues.length
      ? "Runtime inventory is partial; inspect issues and retry."
      : snapshots.length
        ? null
        : legacy
          ? "Legacy single-file snapshot has no verified instance ownership, liveness or source freshness. Restart through the current framework to create per-instance records."
          : "No matching runtime snapshot. MCP does not start services.";
  return {
    schemaVersion: 2,
    status: "ok",
    data: {
      availability: !page.ok
        ? "invalid"
        : snapshots.length
          ? read.issues.length
            ? "partial"
            : "available"
          : read.issues.length
            ? "invalid"
            : legacy
              ? "legacy"
              : "unavailable",
      source: legacy
        ? LEGACY_RUNTIME_SNAPSHOT_PATH
        : RUNTIME_SNAPSHOT_DIRECTORY,
      projectIdentity: input.project.identity,
      runtimeIdentity:
        evidence.length === 1 ? evidence[0]!.runtimeIdentity : null,
      section,
      snapshot:
        page.ok && evidence.length === 1 && section === "summary"
          ? evidence[0]
          : null,
      // Only return this page's summaries. Detail queries carry per-item ownership.
      instances: section === "summary" && page.ok ? page.value.items : [],
      items: page.ok ? page.value.items : [],
      events: section === "events" && page.ok ? page.value.items : [],
      evidence: {
        ownership: snapshots.length ? "verified" : "unverified",
        liveness: "unverified",
        sourceFreshness: stale
          ? "stale"
          : evidence.length &&
              evidence.every(
                (item) => item.evidence.sourceFreshness === "current",
              )
            ? "current"
            : "unverified",
      },
      pageInfo: {
        limit,
        cursor,
        nextCursor: page.ok ? page.value.nextCursor : null,
        total: items.length,
        truncated: page.ok ? page.value.truncated : false,
      },
      gap: !page.ok
        ? page.failure.code
        : read.issues.length
          ? "partial-inventory"
          : null,
      resyncRequired: !page.ok || stale || read.issues.length > 0,
      reason:
        stale && reason === null
          ? "Recorded source revision differs from current source."
          : reason,
      issues: read.issues,
    },
  };
}
