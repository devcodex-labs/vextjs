import path from "node:path";
import { constants as bufferConstants } from "node:buffer";
import { normalizeSafeRelativePath } from "../../lib/path-boundary.js";
import {
  SourceViewError,
  type RootRef,
  type SourceFileRef,
  type SourceLimits,
} from "./types.js";

export const DEFAULT_SOURCE_LIMITS: Readonly<SourceLimits> = Object.freeze({
  maxScanEntries: 50_000,
  maxFiles: 5000,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
});

export function requireSourceLabel(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    /[\u0000-\u001f]/u.test(value) ||
    Buffer.from(value, "utf8").toString("utf8") !== value
  ) {
    throw new SourceViewError(
      "VEXT_SOURCE_UNVERIFIED",
      "Invalid " + label + ".",
    );
  }
  return value;
}

/** 保留合法中文和空格；不把 Windows 设备、ADS 或路径别名当成业务源码。 */
export function normalizeSourcePath(value: string): string {
  try {
    if (
      typeof value !== "string" ||
      value.length > 4096 ||
      /[<>:"|?*\u0000-\u001f]/u.test(value) ||
      Buffer.from(value, "utf8").toString("utf8") !== value
    ) {
      throw new Error("invalid characters or encoding");
    }
    const normalized = normalizeSafeRelativePath(value, "source path");
    if (
      normalized
        .split("/")
        .some(
          (segment) =>
            /[. ]$/u.test(segment) ||
            /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(
              segment,
            ) ||
            /^(?:conin\$|conout\$)(?:\.|$)/iu.test(segment),
        )
    ) {
      throw new Error("reserved device name or ambiguous suffix");
    }
    return normalized;
  } catch (cause) {
    throw new SourceViewError(
      "VEXT_SOURCE_UNVERIFIED",
      "Invalid source path " + JSON.stringify(value) + ".",
      { cause },
    );
  }
}

export function sourceKey(rootId: string, relativePath: string): string {
  return (
    requireSourceLabel(rootId, "source root id") +
    "\0" +
    normalizeSourcePath(relativePath)
  );
}

export function normalizeSourceRef(
  ref: SourceFileRef,
  roots: ReadonlyMap<string, RootRef>,
): SourceFileRef {
  requireSourceLabel(ref.rootId, "source root id");
  if (!roots.has(ref.rootId)) {
    throw new SourceViewError(
      "VEXT_SOURCE_UNVERIFIED",
      "Source root is not registered: " + ref.rootId + ".",
    );
  }
  return {
    rootId: ref.rootId,
    path: normalizeSourcePath(ref.path),
    role: requireSourceLabel(ref.role, "source role"),
  };
}

/** 只复制结构；物理根身份的检查属于 collect，纯 View 不探测文件系统。 */
export function copySourceRoots(
  roots: readonly RootRef[],
): ReadonlyMap<string, RootRef> {
  if (roots.length > 100) {
    throw new SourceViewError(
      "VEXT_SOURCE_LIMIT",
      "Source root count exceeds 100.",
    );
  }
  const copied = new Map<string, RootRef>();
  const paths = new Set<string>();
  for (const root of roots) {
    requireSourceLabel(root.id, "source root id");
    if (
      typeof root.realPath !== "string" ||
      !path.isAbsolute(root.realPath) ||
      root.realPath.includes("\0") ||
      /^[\\/]{2}[?.][\\/]/u.test(root.realPath) ||
      !["service", "shared"].includes(root.kind)
    ) {
      throw new SourceViewError(
        "VEXT_SOURCE_UNVERIFIED",
        "Invalid registered source root " + root.id + ".",
      );
    }
    const realPath = path.resolve(root.realPath);
    if (copied.has(root.id) || paths.has(realPath)) {
      throw new SourceViewError(
        "VEXT_SOURCE_UNVERIFIED",
        "Duplicate source root identity: " + root.id + ".",
      );
    }
    paths.add(realPath);
    if (
      root.sourceExports !== undefined &&
      (!root.packageName || root.kind !== "shared")
    )
      throw new SourceViewError(
        "VEXT_SOURCE_UNVERIFIED",
        "Source exports require a named shared package.",
      );
    if (
      root.packageName !== undefined &&
      !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/iu.test(root.packageName)
    )
      throw new SourceViewError(
        "VEXT_SOURCE_UNVERIFIED",
        "Invalid shared package name.",
      );
    const sourceExports =
      root.sourceExports === undefined
        ? undefined
        : Object.freeze(
            Object.fromEntries(
              Object.entries(root.sourceExports).map(([subpath, file]) => {
                if (subpath !== ".")
                  normalizeSourcePath(
                    subpath.startsWith("./") ? subpath.slice(2) : "",
                  );
                return [subpath, normalizeSourcePath(file)];
              }),
            ),
          );
    copied.set(
      root.id,
      Object.freeze({
        id: root.id,
        realPath,
        kind: root.kind,
        ...(root.packageName === undefined
          ? {}
          : { packageName: root.packageName }),
        ...(sourceExports === undefined ? {} : { sourceExports }),
      }),
    );
  }
  return copied;
}

export function resolveSourceLimits(
  input: Partial<SourceLimits> = {},
): Readonly<SourceLimits> {
  const limits = { ...DEFAULT_SOURCE_LIMITS, ...input };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new SourceViewError(
        "VEXT_SOURCE_LIMIT",
        "Invalid source limit " + name + ".",
      );
    }
  }
  if (limits.maxFileBytes > bufferConstants.MAX_LENGTH) {
    throw new SourceViewError(
      "VEXT_SOURCE_LIMIT",
      "Source file limit exceeds the Node buffer limit.",
    );
  }
  return Object.freeze(limits);
}

export function assertSourceBudget(
  count: number,
  bytes: number,
  limits: SourceLimits,
): void {
  if (
    !Number.isSafeInteger(count) ||
    !Number.isSafeInteger(bytes) ||
    count > limits.maxFiles ||
    bytes > limits.maxTotalBytes
  ) {
    throw new SourceViewError(
      "VEXT_SOURCE_LIMIT",
      `Source inventory is incomplete: file count or total byte budget exceeded (${count}/${limits.maxFiles} files, ${bytes}/${limits.maxTotalBytes} bytes). Adjust VEXT_SOURCE_MAX_FILES or VEXT_SOURCE_MAX_TOTAL_BYTES, or pass explicit source limits.`,
    );
  }
}

export function sourceByteLength(
  bytes: Uint8Array,
  limits: SourceLimits,
): number {
  if (!(bytes instanceof Uint8Array)) {
    throw new SourceViewError(
      "VEXT_SOURCE_UNVERIFIED",
      "Source content must be raw UTF-8 bytes.",
    );
  }
  if (bytes.byteLength > limits.maxFileBytes) {
    throw new SourceViewError(
      "VEXT_SOURCE_LIMIT",
      "Source content exceeds the per-file byte budget.",
    );
  }
  return bytes.byteLength;
}
