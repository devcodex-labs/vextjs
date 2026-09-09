import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VextFileWatcher,
  type FileChangeEvent,
} from "../../src/lib/dev/file-watcher.js";

const faults = vi.hoisted(() => ({
  readPath: "",
  statPath: "",
  scans: 0,
  hold: null as null | ((target: string, result: unknown) => Promise<unknown>),
  watched: [] as { path: string; watcher: import("node:fs").FSWatcher }[],
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    readdir: async (...args: unknown[]) => {
      const target = String(args[0]);
      if (target.endsWith(`${path.sep}src`)) faults.scans++;
      if (target === faults.readPath)
        throw Object.assign(new Error("read denied"), { code: "EACCES" });
      const result = await Reflect.apply(real.readdir, real, args);
      return faults.hold ? faults.hold(target, result) : result;
    },
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    statSync: (...args: unknown[]) => {
      if (String(args[0]) === faults.statPath)
        throw Object.assign(new Error("stat denied"), { code: "EACCES" });
      return Reflect.apply(real.statSync, real, args);
    },
    watch: (...args: unknown[]) => {
      const watcher = Reflect.apply(
        real.watch,
        real,
        args,
      ) as import("node:fs").FSWatcher;
      faults.watched.push({ path: String(args[0]), watcher });
      return watcher;
    },
  };
});

let root: string;
let watcher: VextFileWatcher;
let events: FileChangeEvent[];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "vext-watch-failure-"));
  fs.mkdirSync(path.join(root, "src/services"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src/services/a.ts"),
    "export const value = 1;",
  );
  fs.writeFileSync(
    path.join(root, "src/services/z.ts"),
    "export const value = 2;",
  );
  faults.readPath = faults.statPath = "";
  faults.scans = 0;
  faults.hold = null;
  faults.watched = [];
  events = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  watcher?.stop();
  faults.readPath = faults.statPath = "";
  faults.hold = null;
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

async function start(usePolling = true, debounce = 120): Promise<void> {
  watcher = new VextFileWatcher({
    root,
    usePolling,
    pollInterval: 20,
    debounce,
  });
  watcher.on("change", (event: FileChangeEvent) => events.push(event));
  await watcher.start();
}

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("watcher condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function nextScans(count = 2): Promise<void> {
  const target = faults.scans + count;
  await waitUntil(() => faults.scans >= target);
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe("watcher coherent state and recovery", () => {
  it("a late failure from a stopped startup cannot stop the next generation", async () => {
    let rejectRead: (error: Error) => void = () => {};
    let held = false;
    faults.hold = async (target, result) => {
      if (target !== path.join(root, "src")) return result;
      faults.hold = null;
      held = true;
      return new Promise((_resolve, reject) => {
        rejectRead = reject;
      });
    };
    watcher = new VextFileWatcher({ root, usePolling: true, pollInterval: 20 });
    watcher.on("change", (event: FileChangeEvent) => events.push(event));
    const first = watcher.start().then(
      () => "ready",
      () => "failed",
    );
    await waitUntil(() => held);
    watcher.stop();
    await watcher.start();
    rejectRead(Object.assign(new Error("old scan failed"), { code: "EACCES" }));
    expect(await first).toBe("failed");
    fs.writeFileSync(
      path.join(root, "src/services/a.ts"),
      "export const value = 123;",
    );
    await waitUntil(() => events.length > 0);
    expect(events.flatMap((event) => event.files)).toContainEqual({
      path: "src/services/a.ts",
      type: "modify",
    });
  });

  it("startup rejects an unreadable source and can be retried after recovery", async () => {
    faults.readPath = path.join(root, "src");
    watcher = new VextFileWatcher({ root, usePolling: true, pollInterval: 20 });
    watcher.on("change", (event: FileChangeEvent) => events.push(event));
    await expect(watcher.start()).rejects.toMatchObject({ code: "EACCES" });
    faults.readPath = "";
    await watcher.start();
    fs.writeFileSync(
      path.join(root, "src/services/a.ts"),
      "export const value = 3;",
    );
    await waitUntil(() => events.length > 0);
    expect(events.flatMap((event) => event.files)).toContainEqual({
      path: "src/services/a.ts",
      type: "modify",
    });
  });

  it("an unreadable directory cannot delete known files or commit a partial snapshot", async () => {
    await start(true, 0);
    faults.readPath = path.join(root, "src/services");
    fs.writeFileSync(
      path.join(root, "src/new.ts"),
      "export const next = true;",
    );
    fs.unlinkSync(path.join(root, "src/services/a.ts"));
    await nextScans(3);
    expect(events).toEqual([]);
    expect(console.warn).toHaveBeenCalled();
    faults.readPath = "";
    await waitUntil(() => events.length > 0);
    expect(events.flatMap((event) => event.files)).toEqual(
      expect.arrayContaining([
        { path: "src/new.ts", type: "add" },
        { path: "src/services/a.ts", type: "delete" },
      ]),
    );
    expect(events.flatMap((event) => event.files)).not.toContainEqual({
      path: "src/services/z.ts",
      type: "delete",
    });
  });

  it("a late stat failure preserves every file until a whole scan succeeds", async () => {
    await start(true, 0);
    faults.statPath = path.join(root, "src/services/z.ts");
    fs.writeFileSync(
      path.join(root, "src/services/a.ts"),
      "export const value = 333;",
    );
    await nextScans(3);
    expect(events).toEqual([]);
    faults.statPath = "";
    await waitUntil(() => events.length > 0);
    expect(events.flatMap((event) => event.files)).toEqual([
      { path: "src/services/a.ts", type: "modify" },
    ]);
  });

  it("modify then delete reports the final deletion", async () => {
    await start();
    fs.writeFileSync(
      path.join(root, "src/services/a.ts"),
      "export const value = 4;",
    );
    await nextScans();
    fs.unlinkSync(path.join(root, "src/services/a.ts"));
    await waitUntil(() => events.length > 0);
    expect(events.flatMap((event) => event.files)).toEqual([
      { path: "src/services/a.ts", type: "delete" },
    ]);
  });

  it("a file created and deleted within the debounce window produces no phantom addition", async () => {
    await start();
    const file = path.join(root, "src/services/temp.ts");
    fs.writeFileSync(file, "export const value = 4;");
    await nextScans();
    fs.unlinkSync(file);
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(events).toEqual([]);
  });

  it("delete then recreate is a modification of the existing path", async () => {
    await start();
    const file = path.join(root, "src/services/a.ts");
    fs.unlinkSync(file);
    await nextScans();
    fs.writeFileSync(file, "export const value = 5;");
    await waitUntil(() => events.length > 0);
    expect(events.flatMap((event) => event.files)).toEqual([
      { path: "src/services/a.ts", type: "modify" },
    ]);
  });

  it("native watch failure preserves pending changes when falling back to polling", async () => {
    await start(false, 250);
    fs.writeFileSync(
      path.join(root, "src/services/a.ts"),
      "export const value = 9;",
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    const sourceWatcher = faults.watched.find(
      (entry) => entry.path === path.join(root, "src"),
    )!;
    expect(sourceWatcher).toBeDefined();
    sourceWatcher.watcher.emit(
      "error",
      Object.assign(new Error("watch capacity"), { code: "ENOSPC" }),
    );
    await waitUntil(() => events.length > 0);
    expect(events.flatMap((event) => event.files)).toContainEqual({
      path: "src/services/a.ts",
      type: "modify",
    });
  });
});
