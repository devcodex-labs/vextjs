import type { FileChangeInfo } from "./file-watcher.js";

export interface WorkerOperation {
  operation: "reload" | "frontend-rebuild";
  files: FileChangeInfo[];
}

export interface WorkerOperationRequest extends WorkerOperation {
  type: "dev-operation";
  requestId: string;
}

export type WorkerOperationResult =
  | { success: true }
  | { success: false; error: string; requestedColdRestart: boolean };

export type WorkerOperationResponse = WorkerOperationResult & {
  type: "dev-operation-result";
  requestId: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function readWorkerFiles(value: unknown): FileChangeInfo[] | null {
  if (!Array.isArray(value) || value.length > 5000) return null;
  const paths = new Set<string>();
  let bytes = 0;
  const files: FileChangeInfo[] = [];
  for (const item of value) {
    if (
      !record(item) ||
      !hasOnlyKeys(item, ["path", "type"]) ||
      typeof item.path !== "string" ||
      item.path.length === 0 ||
      item.path.length > 4096 ||
      /[\\\x00-\x1f<>:"|?*]/.test(item.path) ||
      item.path.startsWith("/") ||
      item.path
        .split("/")
        .some(
          (part, index, parts) =>
            part === "." ||
            part === ".." ||
            (part === "" && index !== parts.length - 1),
        ) ||
      typeof item.type !== "string" ||
      !["add", "modify", "delete"].includes(item.type) ||
      paths.has(item.path)
    )
      return null;
    bytes += Buffer.byteLength(item.path, "utf8") + 64;
    if (bytes > 1024 * 1024) return null;
    paths.add(item.path);
    files.push({ path: item.path, type: item.type as FileChangeInfo["type"] });
  }
  return files;
}

export function readWorkerOperationRequest(
  value: unknown,
): WorkerOperationRequest | null {
  if (
    !record(value) ||
    value.type !== "dev-operation" ||
    typeof value.requestId !== "string" ||
    !UUID.test(value.requestId) ||
    !hasOnlyKeys(value, ["type", "requestId", "operation", "files"]) ||
    (value.operation !== "reload" && value.operation !== "frontend-rebuild")
  )
    return null;
  const files = readWorkerFiles(value.files);
  if (!files || (value.operation === "reload" && files.length === 0))
    return null;
  return {
    type: "dev-operation",
    requestId: value.requestId,
    operation: value.operation,
    files,
  };
}

export function readWorkerOperationResponse(
  value: unknown,
): WorkerOperationResponse | null {
  if (
    !record(value) ||
    value.type !== "dev-operation-result" ||
    typeof value.requestId !== "string" ||
    !UUID.test(value.requestId)
  )
    return null;
  if (
    value.success === true &&
    hasOnlyKeys(value, ["type", "requestId", "success"])
  )
    return {
      type: "dev-operation-result",
      requestId: value.requestId,
      success: true,
    };
  if (
    value.success === false &&
    hasOnlyKeys(value, [
      "type",
      "requestId",
      "success",
      "error",
      "requestedColdRestart",
    ]) &&
    typeof value.error === "string" &&
    value.error.length > 0 &&
    value.error.length <= 4096 &&
    typeof value.requestedColdRestart === "boolean"
  )
    return {
      type: "dev-operation-result",
      requestId: value.requestId,
      success: false,
      error: value.error,
      requestedColdRestart: value.requestedColdRestart,
    };
  return null;
}
