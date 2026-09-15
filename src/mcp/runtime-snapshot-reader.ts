import { opendir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolvePathInside } from "../lib/path-boundary.js";
import { readProjectFile } from "../lib/project/read-project-file.js";
import {
  RUNTIME_SNAPSHOT_DIRECTORY,
  LEGACY_RUNTIME_SNAPSHOT_PATH,
  MAX_RUNTIME_INSTANCES,
  MAX_RUNTIME_SNAPSHOT_BYTES,
  MAX_RUNTIME_SNAPSHOT_TOTAL_BYTES,
  INSTANCE_ID_PATTERN,
  parseRuntimeSnapshot,
  isRuntimeRecord,
  type VextRuntimeSnapshot,
} from "../lib/runtime-snapshot-contract.js";

/** 有界读取诊断数据；不执行项目模块、探测端口或把时间戳当作心跳。 */
export async function readRuntimeInstances(rootDir: string, projectId: string) {
  const snapshots: VextRuntimeSnapshot[] = [];
  const issues: string[] = [];
  let totalBytes = 0;
  const digest = createHash("sha256");
  try {
    const directory = resolvePathInside(
      rootDir,
      RUNTIME_SNAPSHOT_DIRECTORY,
      "runtime snapshots",
      { realpath: true },
    );
    let count = 0;
    for await (const entry of await opendir(directory)) {
      if (++count > MAX_RUNTIME_INSTANCES) {
        issues.push("Runtime instance inventory exceeds 200 entries.");
        break;
      }
      if (entry.name.endsWith(".tmp")) {
        issues.push(
          "A runtime snapshot update is in progress; retry inspection.",
        );
        continue;
      }
      if (!entry.name.endsWith(".json")) continue;
      try {
        const instanceId = entry.name.slice(0, -5);
        if (!entry.isFile() || !INSTANCE_ID_PATTERN.test(instanceId))
          throw new Error("Invalid runtime snapshot entry.");
        const bytes = readProjectFile(
          rootDir,
          `${RUNTIME_SNAPSHOT_DIRECTORY}/${entry.name}`,
          Math.min(
            MAX_RUNTIME_SNAPSHOT_BYTES,
            MAX_RUNTIME_SNAPSHOT_TOTAL_BYTES - totalBytes,
          ),
        );
        if (!bytes)
          throw new Error("Runtime snapshot disappeared during inspection.");
        totalBytes += bytes.length;
        const snapshot = parseRuntimeSnapshot(bytes);
        if (
          !snapshot ||
          snapshot.runtimeIdentity.instanceId !== instanceId ||
          snapshot.runtimeIdentity.projectId !== projectId ||
          snapshot.runtimeIdentity.rootDir !== rootDir
        )
          throw new Error(
            "Runtime snapshot schema or project/instance ownership is invalid.",
          );
        snapshots.push(snapshot);
      } catch (error) {
        issues.push(
          `${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      issues.push(error instanceof Error ? error.message : String(error));
  }
  snapshots.sort((left, right) =>
    left.runtimeIdentity.instanceId.localeCompare(
      right.runtimeIdentity.instanceId,
    ),
  );
  for (const snapshot of snapshots) digest.update(JSON.stringify(snapshot));
  digest.update(JSON.stringify(issues));
  let legacy: Record<string, unknown> | null = null;
  if (!snapshots.length) {
    try {
      const bytes = readProjectFile(
        rootDir,
        LEGACY_RUNTIME_SNAPSHOT_PATH,
        MAX_RUNTIME_SNAPSHOT_BYTES,
      );
      if (bytes) {
        const parsed: unknown = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
        if (!isRuntimeRecord(parsed) || parsed.schemaVersion !== 1)
          throw new Error("Invalid legacy runtime snapshot.");
        legacy = parsed;
      }
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }
  return {
    snapshots,
    issues,
    legacy,
    revision: digest.digest("hex"),
    bytes: totalBytes,
  };
}
