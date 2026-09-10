import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({ directory: "" }));
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    statSync: (...args: Parameters<typeof original.statSync>) => {
      if (String(args[0]) === fault.directory) {
        throw Object.assign(
          new Error("preload directory cannot be inspected"),
          { code: "EACCES" },
        );
      }
      return original.statSync(...args);
    },
  };
});
import { resolvePreloads } from "../../../src/cli/utils/preload.js";

const roots: string[] = [];
function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vext-preload-read-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, "dist/preload"), { recursive: true });
  fs.writeFileSync(path.join(root, "dist/preload/old.mjs"), "export {};");
  return root;
}
afterEach(() => {
  fault.directory = "";
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("preload discovery failures", () => {
  it("does not run dist preloads when the canonical directory stat fails", async () => {
    const root = project();
    const directory = path.join(root, "src/preload");
    fs.mkdirSync(directory);
    fault.directory = directory;
    await expect(resolvePreloads(root)).rejects.toMatchObject({
      code: "EACCES",
    });
    expect(fs.existsSync(path.join(root, ".vext"))).toBe(false);
  });

  it("diagnoses a file occupying the source directory instead of silently falling back", async () => {
    const root = project();
    fs.writeFileSync(path.join(root, "src/preload"), "occupied");
    await expect(resolvePreloads(root)).rejects.toThrow("must be a directory");
  });

  it("does not load a project preload directory linked outside the service root", async () => {
    const root = project();
    const external = project();
    fs.writeFileSync(path.join(external, "external.mjs"), "export {};");
    fs.symlinkSync(
      external,
      path.join(root, "src/preload"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(resolvePreloads(root)).rejects.toThrow("must remain inside");
    expect(fs.existsSync(path.join(external, "external.mjs"))).toBe(true);
  });
});
