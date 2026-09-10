import fs, { type BigIntStats } from "node:fs";
import { constants as bufferConstants } from "node:buffer";
import { assertRealPathInside, resolvePathInside } from "../path-boundary.js";

export class ProjectFileReadError extends Error {
  readonly code = "VEXT_FILE_UNVERIFIED";
  constructor(file: string, reason: string) {
    super(`[vextjs] Cannot read a consistent project file ${file}: ${reason}`);
    this.name = "ProjectFileReadError";
  }
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return (
    right.isFile() &&
    !right.isSymbolicLink() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

/**
 * 读取同一普通文件的原字节；上限在分配和read时都生效，不能只靠先行stat。
 * 这是单文件变化检测，不提供跨文件原子快照或敌对进程沙箱。
 */
export function readProjectFile(
  rootDir: string,
  relativeFile: string,
  maxBytes?: number,
): Buffer | null {
  if (
    maxBytes !== undefined &&
    (!Number.isSafeInteger(maxBytes) ||
      maxBytes < 0 ||
      maxBytes > bufferConstants.MAX_LENGTH)
  ) {
    throw new ProjectFileReadError(relativeFile, "invalid byte limit");
  }
  const file = resolvePathInside(rootDir, relativeFile, "project file", {
    realpath: true,
  });
  let before: BigIntStats;
  try {
    before = fs.lstatSync(file, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new ProjectFileReadError(relativeFile, "not a regular file");
  }
  if (before.size > BigInt(maxBytes ?? bufferConstants.MAX_LENGTH)) {
    throw new ProjectFileReadError(relativeFile, "byte limit exceeded");
  }

  // Windows不提供这两个POSIX flags；其余平台仅在宿主提供时使用。
  const flags =
    fs.constants.O_RDONLY |
    (process.platform === "win32"
      ? 0
      : (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(file, flags);
    if (!sameFile(before, fs.fstatSync(descriptor, { bigint: true }))) {
      throw new ProjectFileReadError(relativeFile, "changed before reading");
    }
    assertRealPathInside(rootDir, file, "project file");
    const size = Number(before.size);
    const bytes = Buffer.allocUnsafe(size);
    let offset = 0;
    while (offset < size) {
      const count = fs.readSync(
        descriptor,
        bytes,
        offset,
        size - offset,
        offset,
      );
      if (count === 0)
        throw new ProjectFileReadError(relativeFile, "truncated while reading");
      offset += count;
    }
    // 最多额外读取一个字节，发现增长也不扩大已分配的正文缓冲区。
    if (fs.readSync(descriptor, Buffer.allocUnsafe(1), 0, 1, size) !== 0) {
      throw new ProjectFileReadError(relativeFile, "grew while reading");
    }
    if (
      !sameFile(before, fs.fstatSync(descriptor, { bigint: true })) ||
      !sameFile(before, fs.lstatSync(file, { bigint: true }))
    ) {
      throw new ProjectFileReadError(relativeFile, "changed while reading");
    }
    assertRealPathInside(rootDir, file, "project file");
    return bytes;
  } catch (error) {
    if (
      ["ENOENT", "ENOTDIR", "ELOOP"].includes(
        String((error as NodeJS.ErrnoException).code),
      )
    ) {
      throw new ProjectFileReadError(
        relativeFile,
        "path changed while reading",
      );
    }
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}
