import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readArtifactFile } from "../../src/lib/project/artifact-manifest.js";
import { readProjectFile } from "../../src/lib/project/read-project-file.js";
import { withOwnerRegistry } from "../../src/lib/project/owner-registry.js";

const registryFixture = vi.hoisted(() => ({ directory: "" }));
vi.mock("../../src/lib/project/owner-endpoint.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../src/lib/project/owner-endpoint.js")
  >()),
  ownerRegistryDirectory: () => registryFixture.directory,
}));

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vext-project-read-"));
  roots.push(root);
  const file = path.join(root, "record.json");
  fs.writeFileSync(file, "old");
  return { root, file };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("shared project file reads", () => {
  it.each(["growth", "same-length"])(
    "rejects %s changes between metadata inspection and reading",
    (kind) => {
      const { root, file } = fixture();
      const lstat = fs.lstatSync;
      let changed = false;
      vi.spyOn(fs, "lstatSync").mockImplementation(((
        ...args: Parameters<typeof fs.lstatSync>
      ) => {
        const before = lstat(...args);
        if (!changed && String(args[0]) === file) {
          changed = true;
          fs.writeFileSync(
            file,
            kind === "growth" ? "x".repeat(32 * 1024) : "new",
          );
          fs.utimesSync(file, 1000, 1000);
        }
        return before;
      }) as typeof fs.lstatSync);
      expect(() => readArtifactFile(root, "record.json", 3)).toThrow();
      expect(changed).toBe(true);
    },
  );

  it("preserves raw bytes, handles empty files and distinguishes initial absence", () => {
    const { root, file } = fixture();
    const bytes = Buffer.from([0xef, 0xbb, 0xbf, 0, 0xff, 13, 10]);
    fs.writeFileSync(file, bytes);
    expect(readProjectFile(root, "record.json", bytes.length)).toEqual(bytes);
    fs.writeFileSync(file, "");
    expect(readProjectFile(root, "record.json", 0)).toEqual(Buffer.alloc(0));
    fs.unlinkSync(file);
    expect(readProjectFile(root, "record.json", 0)).toBeNull();
  });

  it("rejects invalid limits, non-files and paths outside the root", () => {
    const { root, file } = fixture();
    for (const maximum of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expect(() => readProjectFile(root, "record.json", maximum)).toThrow(
        "invalid byte limit",
      );
    }
    expect(() => readProjectFile(root, "record.json", 2)).toThrow(
      "byte limit exceeded",
    );
    expect(() => readProjectFile(root, "../record.json", 3)).toThrow();
    fs.unlinkSync(file);
    fs.mkdirSync(file);
    expect(() => readProjectFile(root, "record.json", 3)).toThrow(
      "not a regular file",
    );
  });

  it("rejects a junction or directory symlink that leads to another root", () => {
    const { root } = fixture();
    const outside = fixture().root;
    fs.symlinkSync(
      outside,
      path.join(root, "foreign"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() => readProjectFile(root, "foreign/record.json", 3)).toThrow(
      "after resolving symbolic links",
    );
  });

  it("handles short reads without losing or inventing bytes", () => {
    const { root, file } = fixture();
    fs.writeFileSync(file, "123456789");
    const read = fs.readSync;
    vi.spyOn(fs, "readSync").mockImplementation(((
      fd: number,
      bytes: Buffer,
      offset: number,
      length: number,
      position: number,
    ) =>
      read(
        fd,
        bytes,
        offset,
        Math.min(length, 2),
        position,
      )) as typeof fs.readSync);
    expect(readProjectFile(root, "record.json", 9)?.toString()).toBe(
      "123456789",
    );
  });

  it("never reads an expanding file beyond its initial size plus one byte", () => {
    const { root, file } = fixture();
    const read = fs.readSync;
    let total = 0;
    let changed = false;
    vi.spyOn(fs, "readSync").mockImplementation(((
      fd: number,
      bytes: Buffer,
      offset: number,
      length: number,
      position: number,
    ) => {
      const count = read(fd, bytes, offset, length, position);
      total += count;
      if (!changed) {
        changed = true;
        fs.appendFileSync(file, "x".repeat(64 * 1024));
      }
      return count;
    }) as typeof fs.readSync);
    expect(() => readProjectFile(root, "record.json", 3)).toThrow(
      "grew while reading",
    );
    expect(total).toBe(4);
  });

  it("does not treat deletion after opening as initial absence", () => {
    const { root, file } = fixture();
    const read = fs.readSync;
    let changed = false;
    vi.spyOn(fs, "readSync").mockImplementation(((
      fd: number,
      bytes: Buffer,
      offset: number,
      length: number,
      position: number,
    ) => {
      const count = read(fd, bytes, offset, length, position);
      if (!changed) {
        changed = true;
        fs.unlinkSync(file);
      }
      return count;
    }) as typeof fs.readSync);
    expect(() => readProjectFile(root, "record.json", 3)).toThrow();
    expect(changed).toBe(true);
  });

  it("closes the opened descriptor when reading fails", () => {
    const { root } = fixture();
    const opened = vi.spyOn(fs, "openSync");
    vi.spyOn(fs, "readSync").mockImplementation(() => {
      throw Object.assign(new Error("injected read failure"), { code: "EIO" });
    });
    expect(() => readProjectFile(root, "record.json", 3)).toThrow(
      "injected read failure",
    );
    const descriptor = opened.mock.results[0]?.value as number;
    expect(Number.isInteger(descriptor)).toBe(true);
    expect(() => fs.fstatSync(descriptor)).toThrow();
  });

  it("applies the same bounded read to owner discovery without invoking its operation on a changed record", async () => {
    const { root } = fixture();
    registryFixture.directory = root;
    const file = path.join(root, "registry.json");
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, records: [] }));
    const lstat = fs.lstatSync;
    let changed = false;
    vi.spyOn(fs, "lstatSync").mockImplementation(((
      ...args: Parameters<typeof fs.lstatSync>
    ) => {
      const before = lstat(...args);
      if (!changed && String(args[0]) === file) {
        changed = true;
        fs.writeFileSync(
          file,
          JSON.stringify({
            schemaVersion: 1,
            records: [],
            padding: "x".repeat(2 * 1024 * 1024),
          }),
        );
      }
      return before;
    }) as typeof fs.lstatSync);
    const operation = vi.fn(async () => undefined);
    await expect(withOwnerRegistry(operation)).rejects.toMatchObject({
      code: "VEXT_OWNER_UNVERIFIED",
    });
    expect(changed).toBe(true);
    expect(operation).not.toHaveBeenCalled();
  });
});
