import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { createImplementationTracker } from "../../../src/assistant/implementation-identity.js";

it("keeps loaded code identity until restart even when package version and file length stay the same", async () => {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(join(parent, "vext-mcp-implementation-"));
  try {
    await writeFile(join(root, "server.js"), "export const answer = 1;");
    const inspect = createImplementationTracker(root, {
      allowSourceFallback: true,
    });
    const before = inspect();
    expect(before.state).toBe("current");
    await writeFile(join(root, "server.js"), "export const answer = 2;");
    const after = inspect();
    expect(after).toMatchObject({
      state: "restart-required",
      loadedDigest: before.loadedDigest,
    });
    expect(after.onDiskDigest).not.toBe(before.onDiskDigest);
    expect(
      createImplementationTracker(root, { allowSourceFallback: true })(),
    ).toMatchObject({
      state: "current",
      loadedDigest: after.onDiskDigest,
    });
  } finally {
    expect(dirname(await realpath(root))).toBe(parent);
    await rm(root, { recursive: true, force: true });
  }
});
