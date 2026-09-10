import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { build as bundle } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withOwnerRegistry } from "../../src/lib/project/owner-registry.js";

const location = vi.hoisted(() => ({ directory: "", registryAttempts: 0 }));
vi.mock("../../src/lib/project/owner-endpoint.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/lib/project/owner-endpoint.js")
    >();
  return {
    ...actual,
    ownerRegistryDirectory: () => location.directory,
    listenOwnerEndpoint: (
      ...args: Parameters<typeof actual.listenOwnerEndpoint>
    ) => {
      if (args[0].startsWith("registry:")) location.registryAttempts++;
      return actual.listenOwnerEndpoint(...args);
    },
  };
});

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "vext-registry-recovery-"),
  );
  roots.push(root);
  location.directory = root;
  location.registryAttempts = 0;
  return root;
}
function candidate(root: string, content: string) {
  const sha256 = createHash("sha256").update(content).digest("hex");
  const file = path.join(root, `registry.json.${sha256}.${randomUUID()}.tmp`);
  fs.writeFileSync(file, content);
  return file;
}
function record(root: string) {
  return {
    identity: {
      protocolVersion: 1 as const,
      realRoot: root,
      instanceId: randomUUID(),
      pid: process.pid,
      processStartIdentity: `${process.pid}:${performance.timeOrigin}`,
      producerVersion: "test",
      purpose: "build" as const,
    },
    participants: [],
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("owner discovery candidate recovery", () => {
  it("recovers a verified abandoned candidate under the registry mutex", async () => {
    const root = fixture();
    const temporary = candidate(
      root,
      JSON.stringify({ schemaVersion: 1, records: [] }),
    );
    await withOwnerRegistry(async (records) => {
      expect(records).toEqual([]);
      expect(fs.existsSync(temporary)).toBe(false);
    });
    expect(fs.existsSync(path.join(root, "registry.json"))).toBe(false);
  });

  it.each(["modified", "oversized", "directory", "legacy"])(
    "preserves a %s candidate without replacing authoritative records",
    async (kind) => {
      const root = fixture();
      const authoritative = '{"schemaVersion":1,"records":[]}\n';
      fs.writeFileSync(path.join(root, "registry.json"), authoritative);
      const temporary =
        kind === "legacy"
          ? path.join(root, `registry.json.${randomUUID()}.tmp`)
          : candidate(root, authoritative);
      if (kind === "modified" || kind === "legacy")
        fs.writeFileSync(temporary, "externally changed");
      if (kind === "oversized")
        fs.writeFileSync(temporary, "x".repeat(1024 * 1024 + 1));
      if (kind === "directory") {
        fs.unlinkSync(temporary);
        fs.mkdirSync(temporary);
      }
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      await withOwnerRegistry(async (records) => expect(records).toEqual([]));
      expect(fs.existsSync(temporary)).toBe(true);
      expect(fs.readFileSync(path.join(root, "registry.json"), "utf8")).toBe(
        authoritative,
      );
      expect(warning).toHaveBeenCalledWith(expect.stringContaining(temporary));
    },
  );

  it("preserves unknown files and candidate symlinks without visiting their targets", async () => {
    const root = fixture();
    const outside = fixture();
    location.directory = root;
    const temporary = candidate(root, "expected");
    fs.unlinkSync(temporary);
    fs.symlinkSync(
      outside,
      temporary,
      process.platform === "win32" ? "junction" : "dir",
    );
    fs.writeFileSync(path.join(root, "notes.tmp"), "user data");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await withOwnerRegistry(async () => undefined);
    expect(fs.lstatSync(temporary).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(root, "notes.tmp"), "utf8")).toBe(
      "user data",
    );
    expect(fs.readdirSync(outside)).toEqual([]);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining(temporary));
  });

  it("retains recovery material when the authoritative index is corrupt", async () => {
    const root = fixture();
    const temporary = candidate(root, '{"schemaVersion":1,"records":[]}');
    fs.writeFileSync(path.join(root, "registry.json"), "corrupt");
    await expect(
      withOwnerRegistry(async () => undefined),
    ).rejects.toMatchObject({ code: "VEXT_OWNER_UNVERIFIED" });
    expect(fs.existsSync(temporary)).toBe(true);
    expect(fs.readFileSync(path.join(root, "registry.json"), "utf8")).toBe(
      "corrupt",
    );
  });

  it("recovers at most one bounded batch and leaves the rest for a later operation", async () => {
    const root = fixture();
    const files = Array.from({ length: 20 }, () =>
      candidate(root, '{"schemaVersion":1,"records":[]}'),
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await withOwnerRegistry(async () => undefined);
    expect(files.filter((file) => fs.existsSync(file))).toHaveLength(4);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("batch limit"),
    );
    await withOwnerRegistry(async () => undefined);
    expect(files.filter((file) => fs.existsSync(file))).toEqual([]);
  });

  it("does not rewrite an unchanged index", async () => {
    const root = fixture();
    await withOwnerRegistry(async (records) => {
      records.push(record(root));
    });
    const file = path.join(root, "registry.json");
    fs.utimesSync(file, 1000, 1000);
    await withOwnerRegistry(async () => undefined);
    expect(fs.statSync(file).mtimeMs).toBe(1_000_000);
  });

  it("does not recover a candidate while another registry writer holds the mutex", async () => {
    const root = fixture();
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let temporary = "";
    const first = withOwnerRegistry(async (records) => {
      temporary = candidate(root, '{"schemaVersion":1,"records":[]}');
      entered();
      await held;
      records.push(record(root));
    });
    await ready;
    let secondEntered = false;
    const second = withOwnerRegistry(async (records) => {
      secondEntered = true;
      expect(records).toHaveLength(1);
      expect(fs.existsSync(temporary)).toBe(false);
    });
    try {
      await vi.waitFor(() =>
        expect(location.registryAttempts).toBeGreaterThanOrEqual(2),
      );
      expect(secondEntered).toBe(false);
      expect(fs.existsSync(temporary)).toBe(true);
    } finally {
      release();
      await Promise.all([first, second]);
    }
    expect(secondEntered).toBe(true);
  });

  it("closes the directory iterator after its bounded entry budget", async () => {
    fixture();
    const read = vi.fn(() => ({ name: "unrelated-entry" }));
    const close = vi.fn();
    vi.spyOn(fs, "opendirSync").mockReturnValue({
      readSync: read,
      closeSync: close,
    } as unknown as fs.Dir);
    syncBuiltinESMExports();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await withOwnerRegistry(async (records) => expect(records).toEqual([]));
    expect(read).toHaveBeenCalledTimes(65_536);
    expect(close).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("directory entry limit"),
    );
  });

  it("preserves authoritative bytes and removes only the verified candidate after rename failure", async () => {
    const root = fixture();
    await withOwnerRegistry(async (records) => {
      records.push(record(root));
    });
    const file = path.join(root, "registry.json");
    const before = fs.readFileSync(file, "utf8");
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw Object.assign(new Error("injected registry rename failure"), {
        code: "EACCES",
      });
    });
    // node:fs 的命名 ESM 导出需要显式同步，才能观察到默认对象上的故障注入。
    syncBuiltinESMExports();
    await expect(
      withOwnerRegistry(async (records) => {
        records.length = 0;
      }),
    ).rejects.toThrow("injected registry rename failure");
    expect(rename).toHaveBeenCalledOnce();
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(fs.readdirSync(root)).toEqual(["registry.json"]);
  });

  it("does not commit or delete a candidate modified after creation", async () => {
    const root = fixture();
    const write = fs.writeFileSync;
    let changed: string | undefined;
    vi.spyOn(fs, "writeFileSync").mockImplementation(((file, data, options) => {
      write(file, data, options);
      if (String(file).endsWith(".tmp")) {
        changed = String(file);
        write(file, "external edit");
      }
    }) as typeof fs.writeFileSync);
    syncBuiltinESMExports();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      withOwnerRegistry(async (records) => {
        records.push(record(root));
      }),
    ).rejects.toMatchObject({ code: "VEXT_OWNER_UNVERIFIED" });
    expect(changed).toBeDefined();
    expect(fs.readFileSync(changed!, "utf8")).toBe("external edit");
    expect(fs.existsSync(path.join(root, "registry.json"))).toBe(false);
  });

  it.each(["complete", "partial"])(
    "handles a real process interruption with a %s candidate",
    async (mode) => {
      const root = fixture();
      const temp = path.join(root, "tmp");
      fs.mkdirSync(temp);
      const entry = path.join(root, "crash.cjs");
      await bundle({
        entryPoints: [
          path.resolve("test/fixtures/owner-registry-crash-child.ts"),
        ],
        outfile: entry,
        bundle: true,
        format: "cjs",
        platform: "node",
        logLevel: "silent",
      });
      const child = fork(entry, [root, mode], {
        execArgv: [],
        stdio: "ignore",
        env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp },
      });
      const deadline = setTimeout(() => child.kill("SIGKILL"), 12_000);
      try {
        await new Promise<void>((resolve, reject) => {
          child.once("error", reject);
          child.once("close", () => resolve());
        });
      } finally {
        clearTimeout(deadline);
      }
      const point = JSON.parse(
        fs.readFileSync(path.join(root, "crash-point.json"), "utf8"),
      );
      expect(point).toMatchObject({ mode, pid: child.pid });
      expect(child.exitCode).not.toBe(0);
      expect(path.relative(root, point.to).startsWith("..")).toBe(false);
      location.directory = path.dirname(point.to);
      const before = fs.readFileSync(point.to, "utf8");
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      await withOwnerRegistry(async (records) => expect(records).toEqual([]));
      expect(fs.readFileSync(point.to, "utf8")).toBe(before);
      expect(fs.existsSync(point.from)).toBe(mode === "partial");
      if (mode === "partial")
        expect(warning).toHaveBeenCalledWith(
          expect.stringContaining(point.from),
        );
      console.log(
        `[registry candidate recovery] mode=${mode}, exited pid=${child.pid}, directory=${location.directory}`,
      );
    },
  );
});
