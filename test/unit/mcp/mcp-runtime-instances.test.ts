import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import {
  createRuntimeSnapshotIdentity,
  writeRuntimeSnapshot,
  patchRuntimeSnapshot,
  cleanupStoppedRuntimeSnapshots,
} from "../../../src/lib/runtime-snapshot.js";
import { RUNTIME_SNAPSHOT_DIRECTORY } from "../../../src/lib/runtime-snapshot-contract.js";
import { inspectRuntimeSnapshot } from "../../../src/mcp/runtime-snapshot.js";
import type { VextMcpProjectInspection } from "../../../src/assistant/project-inspector.js";

async function fixture(
  run: (
    root: string,
    inspect: (
      options?: Parameters<typeof inspectRuntimeSnapshot>[0]["options"],
    ) => ReturnType<typeof inspectRuntimeSnapshot>,
  ) => Promise<void>,
) {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(parent, "vext-runtime-instances-"));
  try {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "runtime-fixture" }),
    );
    const identity = createRuntimeSnapshotIdentity(root, "development");
    const project = {
      identity: {
        projectId: identity.projectId,
        rootDir: root,
        contextRevision: "context-1",
        sourceRevision: null,
      },
    } as unknown as VextMcpProjectInspection;
    await run(root, (options) =>
      inspectRuntimeSnapshot({ rootDir: root, project, options }),
    );
  } finally {
    expect(path.dirname(await realpath(root))).toBe(parent);
    await rm(root, { recursive: true, force: true });
  }
}

it("keeps web/worker/scheduler instances separate even in the same process and merges concurrent patches", async () =>
  fixture(async (rootDir, inspect) => {
    const identities = (
      ["development", "job-worker", "job-scheduler", "cluster"] as const
    ).map((mode) => createRuntimeSnapshotIdentity(rootDir, mode));
    await Promise.all(
      identities.map((runtimeIdentity) =>
        writeRuntimeSnapshot({
          rootDir,
          runtimeIdentity,
          summary: { state: "ready" },
        }),
      ),
    );
    await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        patchRuntimeSnapshot({
          rootDir,
          runtimeIdentity: identities[0]!,
          summary: { ["key" + index]: index },
          event: { type: "reload", index },
        }),
      ),
    );
    const summary = await inspect();
    expect(summary.data.pageInfo.total).toBe(4);
    expect(summary.data.runtimeIdentity).toBeNull();
    expect(summary.data.evidence).toMatchObject({
      ownership: "verified",
      liveness: "unverified",
      sourceFreshness: "unverified",
    });
    const one = await inspect({
      instanceId: identities[0]!.instanceId,
      section: "events",
      limit: 100,
    });
    expect(one.data.items).toHaveLength(40);
    expect(new Set(one.data.items.map((item: any) => item.id)).size).toBe(40);
    expect(
      await readdir(path.join(rootDir, RUNTIME_SNAPSHOT_DIRECTORY)),
    ).toHaveLength(4);
    expect(
      (await inspect({ instanceId: identities[0]!.instanceId })).data.snapshot,
    ).toMatchObject({ summary: { key0: 0, key39: 39 } });
  }));

it("binds cursors to project, snapshot contents, selected instance and section", async () =>
  fixture(async (rootDir, inspect) => {
    const runtimeIdentity = createRuntimeSnapshotIdentity(
      rootDir,
      "production",
    );
    await writeRuntimeSnapshot({
      rootDir,
      runtimeIdentity,
      events: [{ type: "ready" }, { type: "reload" }],
    });
    const first = await inspect({ section: "events", limit: 1 });
    const cursor = first.data.pageInfo.nextCursor!;
    expect(cursor).not.toBe("1");
    expect(
      (await inspect({ section: "events", limit: 1, cursor })).data.items,
    ).toHaveLength(1);
    expect((await inspect({ section: "reloads", cursor })).data.gap).toBe(
      "VEXT_CURSOR_STALE",
    );
    expect((await inspect({ section: "events", cursor: "1" })).data.gap).toBe(
      "VEXT_VALIDATION_FAILED",
    );
    await patchRuntimeSnapshot({
      rootDir,
      runtimeIdentity,
      event: { type: "updated" },
    });
    expect((await inspect({ section: "events", cursor })).data.gap).toBe(
      "VEXT_CURSOR_STALE",
    );
  }));

it("rejects foreign ownership and invalid UTF-8, and retains valid instances as partial evidence", async () =>
  fixture(async (rootDir, inspect) => {
    const own = createRuntimeSnapshotIdentity(rootDir, "production");
    const foreign = createRuntimeSnapshotIdentity(rootDir, "job-worker");
    await writeRuntimeSnapshot({ rootDir, runtimeIdentity: own });
    await writeRuntimeSnapshot({ rootDir, runtimeIdentity: foreign });
    const file = path.join(
      rootDir,
      RUNTIME_SNAPSHOT_DIRECTORY,
      foreign.instanceId + ".json",
    );
    const data = JSON.parse(await readFile(file, "utf8"));
    data.runtimeIdentity.projectId = "f".repeat(64);
    await writeFile(file, JSON.stringify(data));
    expect((await inspect()).data).toMatchObject({
      availability: "partial",
      pageInfo: { total: 1 },
      resyncRequired: true,
    });
    await writeFile(file, Buffer.from([0xff, 0xfe]));
    expect((await inspect()).data.availability).toBe("partial");
    await expect(
      patchRuntimeSnapshot({
        rootDir,
        runtimeIdentity: foreign,
        event: { type: "no-overwrite" },
      }),
    ).rejects.toThrow("Invalid runtime snapshot");
    await rm(file);
    await patchRuntimeSnapshot({
      rootDir,
      runtimeIdentity: foreign,
      event: { type: "recovered-queue" },
    });
    expect((await inspect()).data.availability).toBe("available");
  }));

it("bounds instance inventory, collections, and individual response/file bytes", async () =>
  fixture(async (rootDir, inspect) => {
    const runtimeIdentity = createRuntimeSnapshotIdentity(
      rootDir,
      "production",
    );
    await writeRuntimeSnapshot({
      rootDir,
      runtimeIdentity,
      events: Array.from({ length: 220 }, (_, index) => ({
        type: "event",
        index,
      })),
    });
    expect(
      (await inspect({ section: "events", limit: 100 })).data.pageInfo.total,
    ).toBe(200);
    await expect(
      patchRuntimeSnapshot({
        rootDir,
        runtimeIdentity,
        summary: { huge: "x".repeat(1024 * 1024) },
      }),
    ).rejects.toThrow("oversized");
    await patchRuntimeSnapshot({
      rootDir,
      runtimeIdentity,
      summary: { large: "x".repeat(270 * 1024) },
    });
    const large = await inspect();
    expect(large.data.gap).toBe("VEXT_RESPONSE_LIMIT");
    expect(large.data.snapshot).toBeNull();
    expect(Buffer.byteLength(JSON.stringify(large))).toBeLessThan(4096);
    const dir = path.join(rootDir, RUNTIME_SNAPSHOT_DIRECTORY);
    await Promise.all(
      Array.from({ length: 201 }, (_, index) =>
        writeFile(path.join(dir, "unrelated-" + index), ""),
      ),
    );
    expect((await inspect()).data.issues.join(" ")).toContain("200");
  }));

it("does not follow snapshot directory links outside the project", async () =>
  fixture(async (rootDir, inspect) => {
    const external = await mkdtemp(
      path.join(await realpath(tmpdir()), "vext-runtime-outside-"),
    );
    try {
      await mkdir(path.join(rootDir, ".vext", "runtime"), { recursive: true });
      await symlink(
        external,
        path.join(rootDir, RUNTIME_SNAPSHOT_DIRECTORY),
        process.platform === "win32" ? "junction" : "dir",
      );
      expect((await inspect()).data.availability).toBe("invalid");
      await expect(
        writeRuntimeSnapshot({
          rootDir,
          runtimeIdentity: createRuntimeSnapshotIdentity(rootDir, "production"),
        }),
      ).rejects.toThrow("inside");
      expect(await readdir(external)).toEqual([]);
    } finally {
      expect(path.dirname(await realpath(external))).toBe(
        await realpath(tmpdir()),
      );
      await rm(external, { recursive: true, force: true });
    }
  }));

it("retains active/foreign/recent records and only cleans proven stopped records after 24 hours", async () =>
  fixture(async (rootDir) => {
    const runtimeIdentity = createRuntimeSnapshotIdentity(
      rootDir,
      "production",
    );
    await writeRuntimeSnapshot({
      rootDir,
      runtimeIdentity,
      summary: { state: "stopped" },
    });
    const file = path.join(
      rootDir,
      RUNTIME_SNAPSHOT_DIRECTORY,
      runtimeIdentity.instanceId + ".json",
    );
    const now = Date.now() + 25 * 60 * 60 * 1000;
    await cleanupStoppedRuntimeSnapshots(
      rootDir,
      runtimeIdentity.projectId,
      now,
    );
    expect(await readFile(file, "utf8")).toContain("stopped"); // current PID is alive
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("absent"), { code: "ESRCH" });
    });
    try {
      await cleanupStoppedRuntimeSnapshots(rootDir, "a".repeat(64), now);
      expect(kill).not.toHaveBeenCalled();
      await cleanupStoppedRuntimeSnapshots(
        rootDir,
        runtimeIdentity.projectId,
        Date.now(),
      );
      expect(kill).not.toHaveBeenCalled();
      await cleanupStoppedRuntimeSnapshots(
        rootDir,
        runtimeIdentity.projectId,
        now,
      );
      expect(kill).toHaveBeenCalledWith(process.pid, 0);
      expect(
        await readdir(path.join(rootDir, RUNTIME_SNAPSHOT_DIRECTORY)),
      ).toEqual([]);
    } finally {
      kill.mockRestore();
    }
  }));
