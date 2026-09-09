import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireProjectOwner,
  adoptProjectOwner,
  currentProjectOwner,
  withProjectOwner,
  type ProjectOwner,
  type ProjectOwnerGrant,
} from "../../src/lib/project/owner.js";
import { withOwnerRegistry } from "../../src/lib/project/owner-registry.js";

const roots: string[] = [];
const owners: ProjectOwner[] = [];
const children: ChildProcess[] = [];

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "vext-owner-test-"));
  roots.push(root);
  return root;
}

async function acquire(
  root: string,
  purpose: "dev" | "build" | "typegen" = "dev",
) {
  const owner = await acquireProjectOwner(root, purpose);
  owners.push(owner);
  return owner;
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Owner fixture did not exit")),
      5000,
    );
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function message(
  child: ChildProcess,
  request: object,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("exit", onExit);
    };
    const onMessage = (value: unknown) => {
      cleanup();
      resolve(value as Record<string, unknown>);
    };
    const onExit = () => {
      cleanup();
      reject(new Error("Owner fixture exited before replying"));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Owner fixture request timed out"));
    }, 5000);
    child.once("message", onMessage);
    child.once("exit", onExit);
    child.send(request);
  });
}

afterEach(async () => {
  for (const child of children.splice(0).reverse()) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await waitForExit(child);
  }
  for (const owner of owners.splice(0).reverse()) await owner.release();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("project writer ownership", () => {
  it("reclaims verified inactive discovery records when a different project starts", async () => {
    const root = await fixture();
    const previous = await acquire(root);
    await previous.release();
    // 模拟进程异常退出留下的索引；端点已由真实生命周期关闭。
    await withOwnerRegistry(async (records) => {
      records.push({ identity: previous.identity, participants: [] });
    });
    await acquire(await fixture(), "build");
    await withOwnerRegistry(async (records) => {
      expect(
        records.some(
          (record) =>
            record.identity.instanceId === previous.identity.instanceId,
        ),
      ).toBe(false);
    });
  });

  it("rejects dev/build/typegen competitors and resolves junction aliases to the same owner", async () => {
    const root = await fixture();
    const project = path.join(root, "project");
    await mkdir(project);
    const alias = path.join(root, "alias");
    await symlink(
      project,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    const first = await acquire(project);
    await expect(acquireProjectOwner(alias, "build")).rejects.toMatchObject({
      code: "VEXT_OWNER_BUSY",
    });
    await expect(acquireProjectOwner(project, "typegen")).rejects.toMatchObject(
      { code: "VEXT_OWNER_BUSY" },
    );
    await first.assertActive();
    await first.release();
    const next = await acquire(alias, "build");
    expect(next.identity.realRoot).toBe(first.identity.realRoot);
    expect(next.identity.instanceId).not.toBe(first.identity.instanceId);
  });

  it("allows two sibling services concurrently and refuses nested live service roots", async () => {
    const root = await fixture();
    const a = path.join(root, "a");
    const b = path.join(root, "b");
    await mkdir(a);
    await mkdir(b);
    const [first, second] = await Promise.all([acquire(a), acquire(b)]);
    await Promise.all([
      first.reserveOutputs(["dist"]),
      second.reserveOutputs(["dist"]),
    ]);
    await expect(acquireProjectOwner(root, "build")).rejects.toMatchObject({
      code: "VEXT_OWNER_BUSY",
    });
  });

  it("reuses only an explicitly inherited scope and serializes concurrent output reservations", async () => {
    const root = await fixture();
    const owner = await acquire(root);
    expect(currentProjectOwner(root)).toBeUndefined();
    await owner.run(async () => {
      await Promise.all([
        withProjectOwner(root, "typegen", [".vext/types"], async () =>
          expect(currentProjectOwner(root)).toBe(owner),
        ),
        withProjectOwner(root, "build", [".vext/types", "dist"], async () =>
          expect(currentProjectOwner(root)).toBe(owner),
        ),
      ]);
    });
    expect(currentProjectOwner(root)).toBeUndefined();
    await owner.assertActive();
  });

  it("checks real output boundaries before reserving and rejects work after release", async () => {
    const root = await fixture();
    const project = path.join(root, "project");
    const outside = path.join(root, "outside");
    await mkdir(project);
    await mkdir(outside);
    await symlink(
      outside,
      path.join(project, "redirect"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const owner = await acquire(project);
    await expect(owner.reserveOutputs(["redirect/dist"])).rejects.toThrow(
      /inside/,
    );
    await expect(owner.reserveOutputs(["../outside"])).rejects.toThrow(
      /inside/,
    );
    await owner.reserveOutputs(["dist"]);
    await owner.release();
    await expect(owner.assertActive()).rejects.toMatchObject({
      code: "VEXT_OWNER_CLOSED",
    });
  });

  it("registers child writers before use and drains them before releasing the parent", async () => {
    const root = await fixture();
    const parent = await acquire(root);
    const child = await adoptProjectOwner(root, parent.createGrant());
    owners.push(child);
    await child.reserveOutputs([".vext/dev"]);
    await expect(parent.release()).rejects.toMatchObject({
      code: "VEXT_OWNER_BUSY",
    });
    await expect(child.assertActive()).rejects.toMatchObject({
      code: "VEXT_OWNER_CLOSED",
    });
    await child.release();
    await parent.release();
    await acquire(root, "build");
  });

  it("does not release an orphaned worker's protection when its real parent process is killed", async () => {
    const root = await fixture();
    const fixtureFile = path.join(root, "owner-fixture.cjs");
    await build({
      entryPoints: [path.resolve("test/fixtures/project-owner-child.ts")],
      outfile: fixtureFile,
      bundle: true,
      format: "cjs",
      platform: "node",
      logLevel: "silent",
    });
    const launch = () => {
      const child = fork(fixtureFile, [], {
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        execArgv: [],
      });
      children.push(child);
      return child;
    };
    const parent = launch();
    const ready = await message(parent, {
      operation: "initialize",
      rootDir: root,
    });
    expect(ready.type).toBe("ready");
    const worker = launch();
    expect(
      (
        await message(worker, {
          operation: "initialize",
          rootDir: root,
          grant: ready.grant as ProjectOwnerGrant,
        })
      ).type,
    ).toBe("ready");
    parent.kill("SIGKILL");
    await waitForExit(parent);
    await expect(acquireProjectOwner(root, "build")).rejects.toMatchObject({
      code: "VEXT_OWNER_BUSY",
    });
    expect((await message(worker, { operation: "assert" })).type).toBe("error");
    worker.send({ operation: "release" });
    await waitForExit(worker);
    const next = await acquire(root, "build");
    expect(next.identity.instanceId).not.toBe(
      (ready.identity as { instanceId: string }).instanceId,
    );
    console.log(
      `[owner fixture] parent PID ${parent.pid}, worker PID ${worker.pid}: exited; reclaimed after both endpoints closed`,
    );
  }, 15000);
});
