import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePreloads } from "../../../src/cli/utils/preload.js";
import { acquireProjectOwner } from "../../../src/lib/project/owner.js";

const roots: string[] = [];
function project(): string {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "vext-preload-transaction-"),
  );
  roots.push(root);
  write(root, "package.json", '{"type":"module"}');
  return root;
}
function write(root: string, file: string, contents: string): void {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}
function snapshot(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const cache = path.join(root, ".vext/preload");
  if (fs.existsSync(cache)) {
    for (const file of fs.readdirSync(cache).sort()) {
      result[file] = fs.readFileSync(path.join(cache, file), "utf8");
    }
  }
  const manifest = path.join(root, ".vext/freshness/v1/artifacts.json");
  if (fs.existsSync(manifest))
    result.manifest = fs.readFileSync(manifest, "utf8");
  return result;
}
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("preload cache publication", () => {
  it("keeps the whole old generation when a later TS preload fails, then publishes the repaired generation", async () => {
    const root = project();
    write(
      root,
      "src/preload/01-first.ts",
      'export const value: string = "old-first";',
    );
    write(
      root,
      "src/preload/02-last.mts",
      'export const value: string = "old-last";',
    );
    const urls = await resolvePreloads(root);
    const before = snapshot(root);
    write(
      root,
      "src/preload/01-first.ts",
      'export const value: string = "new-first";',
    );
    write(root, "src/preload/02-last.mts", "export const broken: = ;");
    await expect(resolvePreloads(root)).rejects.toThrow(
      "failed to compile TypeScript preload",
    );
    expect(snapshot(root)).toEqual(before);
    write(
      root,
      "src/preload/02-last.mts",
      'export const value: string = "new-last";',
    );
    expect(await resolvePreloads(root)).toEqual(urls);
    expect(fs.readFileSync(fileURLToPath(urls[0]), "utf8")).toContain(
      "new-first",
    );
    expect(fs.readFileSync(fileURLToPath(urls[1]), "utf8")).toContain(
      "new-last",
    );
    expect(snapshot(root).manifest).not.toBe(before.manifest);
  });

  it("rejects two source extensions targeting the same output before replacing existing bytes", async () => {
    const root = project();
    write(root, "src/preload/01-env.ts", 'export const value = "original";');
    await resolvePreloads(root);
    const before = snapshot(root);
    write(root, "src/preload/01-env.mts", 'export const value = "other";');
    await expect(resolvePreloads(root)).rejects.toThrow(
      /01-env\.mts.*01-env\.ts|01-env\.ts.*01-env\.mts/s,
    );
    expect(snapshot(root)).toEqual(before);
  });

  it("does not rewrite an unchanged generation and removes only owned obsolete cache files, including the final TS source", async () => {
    const root = project();
    write(root, "src/preload/01-env.ts", 'export const value = "original";');
    const [url] = await resolvePreloads(root);
    const manifest = path.join(root, ".vext/freshness/v1/artifacts.json");
    const before = snapshot(root);
    const timestamp = fs.statSync(manifest).mtimeMs;
    await resolvePreloads(root);
    expect(snapshot(root)).toEqual(before);
    expect(fs.statSync(manifest).mtimeMs).toBe(timestamp);
    write(root, ".vext/preload/user-note.txt", "preserve me");
    fs.unlinkSync(path.join(root, "src/preload/01-env.ts"));
    expect(await resolvePreloads(root)).toEqual([]);
    expect(fs.existsSync(fileURLToPath(url))).toBe(false);
    expect(
      fs.readFileSync(path.join(root, ".vext/preload/user-note.txt"), "utf8"),
    ).toBe("preserve me");
  });

  it("preserves external output changes and all other preloads when the candidate conflicts", async () => {
    const root = project();
    write(root, "src/preload/01-env.ts", 'export const value = "first";');
    write(root, "src/preload/02-hook.ts", 'export const value = "second";');
    const [url] = await resolvePreloads(root);
    fs.writeFileSync(fileURLToPath(url), "// external edit\n");
    const before = snapshot(root);
    write(root, "src/preload/02-hook.ts", 'export const value = "changed";');
    await expect(resolvePreloads(root)).rejects.toMatchObject({
      code: "VEXT_OUTPUT_CONFLICT",
    });
    expect(snapshot(root)).toEqual(before);
  });

  it("keeps JS and compiled reads free of writer state while TS compilation respects another owner", async () => {
    const root = project();
    write(root, "src/preload/01-js.mjs", "export {};");
    write(root, "release/preload/01-built.mjs", "export {};");
    const owner = await acquireProjectOwner(root, "dev");
    try {
      expect(await resolvePreloads(root)).toEqual([
        pathToFileURL(path.join(root, "src/preload/01-js.mjs")).href,
      ]);
      expect(
        await resolvePreloads(root, {
          builtOutDir: path.join(root, "release"),
        }),
      ).toEqual([
        pathToFileURL(path.join(root, "release/preload/01-built.mjs")).href,
      ]);
      expect(fs.existsSync(path.join(root, ".vext"))).toBe(false);
      write(root, "src/preload/02-ts.ts", "export const value: number = 1;");
      await expect(resolvePreloads(root)).rejects.toMatchObject({
        code: "VEXT_OWNER_BUSY",
      });
      expect(fs.existsSync(path.join(root, ".vext"))).toBe(false);
      await owner.assertActive();
    } finally {
      await owner.release();
    }
  });
});
