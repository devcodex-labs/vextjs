import { createHash } from "node:crypto";
import {
  lstatSync,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

/** Shared by the build script and development CLI; never scans a consumer project. */
export function fingerprintImplementationTree(codeRoot) {
  const root = realpathSync(codeRoot);
  const pending = [""];
  const files = [];
  let entries = 0;
  let bytes = 0;
  while (pending.length) {
    const relativeDir = pending.pop();
    for (const entry of readdirSync(path.join(root, relativeDir), {
      withFileTypes: true,
    })) {
      if (++entries > 5000)
        throw new Error("Implementation inventory exceeds 5000 entries.");
      if (entry.isSymbolicLink())
        throw new Error("Implementation inventory contains a link.");
      const relative = path.posix.join(relativeDir, entry.name);
      if (entry.isDirectory()) pending.push(relative);
      else if (entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name))
        files.push(relative);
    }
  }
  const digest = createHash("sha256");
  for (const relative of files.sort()) {
    const content = readImplementationFile(
      path.join(root, relative),
      Math.min(4 * 1024 * 1024, 32 * 1024 * 1024 - bytes),
    );
    bytes += content.length;
    digest
      .update(relative)
      .update("\0")
      .update(createHash("sha256").update(content).digest());
  }
  if (!files.length) throw new Error("Implementation tree is empty.");
  return digest.digest("hex");
}

/** Exact-sized reads detect growth/truncation without unbounded readFile allocation. */
export function readImplementationFile(file, maxBytes) {
  const before = lstatSync(file, { bigint: true });
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size > BigInt(maxBytes)
  )
    throw new Error("Invalid or oversized implementation file: " + file);
  const descriptor = openSync(file, "r");
  const same = (after) =>
    after.isFile() &&
    before.ino === after.ino &&
    before.dev === after.dev &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs;
  try {
    if (!same(fstatSync(descriptor, { bigint: true })))
      throw new Error("Implementation changed before reading.");
    const buffer = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(
        descriptor,
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (!count) throw new Error("Implementation file truncated.");
      offset += count;
    }
    if (
      readSync(descriptor, Buffer.alloc(1), 0, 1, offset) ||
      !same(fstatSync(descriptor, { bigint: true })) ||
      !same(lstatSync(file, { bigint: true }))
    )
      throw new Error("Implementation changed during reading.");
    return buffer;
  } finally {
    closeSync(descriptor);
  }
}
