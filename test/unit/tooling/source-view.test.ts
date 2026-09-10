import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectSourceView } from "../../../src/tooling/source-view/collect.js";
import {
  createSourceView,
  overlaySourceView,
} from "../../../src/tooling/source-view/view.js";
import type {
  RootRef,
  SourceChange,
  SourceInput,
} from "../../../src/tooling/source-view/types.js";

const virtualRoots: RootRef[] = [
  { id: "app", kind: "service", realPath: path.resolve("virtual-source") },
];
const settings = { roots: virtualRoots, rolePolicyVersion: "roles-v1" };
const raw = (
  text: string,
  file = "src/routes/index.ts",
  role = "route",
  rootId = "app",
): SourceInput => ({
  rootId,
  path: file,
  role,
  bytes: Buffer.from(text),
});
const roots: string[] = [];
function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vext-source-view-"));
  roots.push(fs.realpathSync.native(root));
  return root;
}
function diskOptions(root: string, paths = ["index.ts"]) {
  return {
    roots: [{ id: "app", kind: "service" as const, realPath: root }],
    rolePolicyVersion: "roles-v1",
    files: paths.map((file) => ({ rootId: "app", path: file, role: "route" })),
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    expect(fs.realpathSync.native(root)).toBe(root);
    expect(path.dirname(root)).toBe(fs.realpathSync.native(os.tmpdir()));
    expect(path.basename(root)).toMatch(/^vext-source-view-/u);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("sealed source view", () => {
  it("preserves BOM, raw digest, Unicode and source offsets without exposing mutable data", () => {
    const input = raw("\ufeff// 中文\r\nexport const value = '🙂';\n");
    const view = createSourceView({ ...settings, files: [input] });
    const expectedText = Buffer.from(input.bytes).toString("utf8");
    expect(view.record("app", input.path)).toEqual({
      rootId: "app",
      path: input.path,
      role: "route",
      encoding: "utf8",
      bom: true,
      newline: "mixed",
      byteLength: input.bytes.length,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
    });
    input.bytes.fill(0);
    expect(view.read("app", input.path)).toBe(expectedText);
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.list())).toBe(true);
    expect(Object.isFrozen(view.record("app", input.path))).toBe(true);
    expect(() =>
      Object.assign(view.record("app", input.path)!, { role: "other" }),
    ).toThrow();
  });

  it.each([
    ["", "lf"],
    ["one", "lf"],
    ["one\n", "lf"],
    ["one\r\n", "crlf"],
    ["one\r", "mixed"],
    ["one\r\ntwo\n", "mixed"],
  ])("classifies newline form without editing %j", (text, newline) => {
    const view = createSourceView({ ...settings, files: [raw(text!)] });
    expect(view.list()[0]?.newline).toBe(newline);
    expect(view.read("app", "src/routes/index.ts")).toBe(text);
  });

  it("rejects invalid UTF-8 without substituting replacement characters", () => {
    expect(() =>
      createSourceView({
        ...settings,
        files: [{ ...raw(""), bytes: new Uint8Array([0xc0, 0xaf]) }],
      }),
    ).toThrow("not valid UTF-8");
  });

  it("makes revision independent of input order, location, limits and query filters", () => {
    const files = [raw("one", "a.ts"), raw("two", "b.ts")];
    const view = createSourceView({ ...settings, files });
    const relocated = createSourceView({
      ...settings,
      roots: [{ ...virtualRoots[0]!, realPath: path.resolve("relocated") }],
      files: [...files].reverse(),
      limits: { maxFiles: 2, maxFileBytes: 3, maxTotalBytes: 6 },
    });
    expect(view.revision).toBe(relocated.revision);
    expect(view.list({ roles: ["route"] })).toHaveLength(2);
    expect(view.list({ rootId: "absent" })).toEqual([]);
    expect(view.list({ roles: [] })).toEqual([]);
    expect(view.revision).toBe(relocated.revision);
    expect(
      createSourceView({ ...settings, files, rolePolicyVersion: "roles-v2" })
        .revision,
    ).not.toBe(view.revision);
    expect(
      createSourceView({
        ...settings,
        files: [files[0]!, { ...files[1]!, role: "schema" }],
      }).revision,
    ).not.toBe(view.revision);
    expect(
      createSourceView({ ...settings, files: [files[0]!] }).revision,
    ).not.toBe(view.revision);
  });

  it("keeps registered services isolated and preserves case-sensitive source identities", () => {
    const view = createSourceView({
      ...settings,
      roots: [
        ...virtualRoots,
        {
          id: "shared",
          kind: "shared",
          realPath: path.resolve("shared-source"),
        },
      ],
      files: [
        raw("upper", "A.ts"),
        raw("lower", "a.ts"),
        raw("shared", "a.ts", "schema", "shared"),
      ],
    });
    expect(view.read("app", "A.ts")).toBe("upper");
    expect(view.read("app", "a.ts")).toBe("lower");
    expect(view.read("shared", "a.ts")).toBe("shared");
    expect(view.read("unknown", "a.ts")).toBeUndefined();
    expect(view.list({ rootId: "shared" })).toHaveLength(1);
    expect(
      createSourceView({
        ...settings,
        files: [raw("ok", "中文 目录\\文件.ts")],
      }).read("app", "中文 目录/文件.ts"),
    ).toBe("ok");
  });

  it.each([
    "../escape.ts",
    "a/../b.ts",
    "a//b.ts",
    "/absolute.ts",
    "C:relative.ts",
    "a.ts:stream",
    "nul.ts",
    "COM¹.ts",
    "dir/LPT2/file.ts",
    "dir./a.ts",
    "dir /a.ts",
    "\\\\?\\C:\\a.ts",
    "bad\0.ts",
    "bad\ud800.ts",
    "*.ts",
  ])("rejects invalid or ambiguous paths: %j", (file) => {
    expect(() =>
      createSourceView({ ...settings, files: [raw("", file)] }),
    ).toThrow();
  });

  it("rejects unregistered roots and duplicate identities", () => {
    expect(() =>
      createSourceView({
        ...settings,
        files: [raw("", "a.ts", "route", "missing")],
      }),
    ).toThrow("not registered");
    expect(() =>
      createSourceView({
        ...settings,
        files: [raw("", "a.ts"), raw("", "a.ts")],
      }),
    ).toThrow("Duplicate");
    expect(() =>
      createSourceView({
        ...settings,
        roots: [virtualRoots[0]!, virtualRoots[0]!],
        files: [],
      }),
    ).toThrow("Duplicate");
  });

  it("checks byte and file budgets before creating a view", () => {
    expect(() =>
      createSourceView({
        ...settings,
        files: [raw("中文")],
        limits: { maxFileBytes: 5 },
      }),
    ).toThrow("per-file");
    expect(() =>
      createSourceView({
        ...settings,
        files: [raw("one", "a.ts"), raw("two", "b.ts")],
        limits: { maxTotalBytes: 5 },
      }),
    ).toThrow("total byte");
    expect(() =>
      createSourceView({
        ...settings,
        files: [raw("")],
        limits: { maxFiles: 0 },
      }),
    ).toThrow("file count");
    expect(() =>
      createSourceView({
        ...settings,
        files: [],
        limits: { maxFiles: Number.NaN },
      }),
    ).toThrow("Invalid source limit");
  });
});

describe("source overlays", () => {
  it("applies create/replace/delete with CAS and matches a freshly sealed final inventory", () => {
    const base = createSourceView({
      ...settings,
      files: [raw("old", "a.ts"), raw("remove", "b.ts")],
    });
    const changes: SourceChange[] = [
      { kind: "create", ...raw("new", "c.ts") },
      {
        kind: "replace",
        rootId: "app",
        path: "a.ts",
        expectedSha256: base.record("app", "a.ts")!.sha256,
        bytes: Buffer.from("updated"),
      },
      {
        kind: "delete",
        rootId: "app",
        path: "b.ts",
        expectedSha256: base.record("app", "b.ts")!.sha256,
      },
    ];
    const next = overlaySourceView(base, changes);
    expect(next.read("app", "a.ts")).toBe("updated");
    expect(next.read("app", "b.ts")).toBeUndefined();
    expect(next.record("app", "b.ts")).toBeUndefined();
    expect(next.list().map((record) => record.path)).toEqual(["a.ts", "c.ts"]);
    expect(base.read("app", "a.ts")).toBe("old");
    expect(base.read("app", "b.ts")).toBe("remove");
    expect(next.revision).toBe(
      createSourceView({
        ...settings,
        files: [raw("updated", "a.ts"), raw("new", "c.ts")],
      }).revision,
    );
    expect(overlaySourceView(base, [...changes].reverse()).revision).toBe(
      next.revision,
    );
    expect(overlaySourceView(base, [])).toBe(base);
  });

  it("rejects stale edits, duplicate changes and creates over existing files without changing base", () => {
    const base = createSourceView({ ...settings, files: [raw("old", "a.ts")] });
    expect(() =>
      overlaySourceView(base, [{ kind: "create", ...raw("new", "a.ts") }]),
    ).toThrow("already exists");
    expect(() =>
      overlaySourceView(base, [
        {
          kind: "delete",
          rootId: "app",
          path: "a.ts",
          expectedSha256: "0".repeat(64),
        },
      ]),
    ).toThrow("precondition");
    expect(() =>
      overlaySourceView(base, [
        { kind: "create", ...raw("new", "b.ts") },
        { kind: "create", ...raw("other", "b.ts") },
      ]),
    ).toThrow("Duplicate");
    expect(base.read("app", "a.ts")).toBe("old");
  });

  it("checks the final budget before decoding additions, independent of deletion order", () => {
    const base = createSourceView({
      ...settings,
      files: [raw("old", "a.ts")],
      limits: { maxFiles: 1, maxTotalBytes: 3 },
    });
    const changes: SourceChange[] = [
      { kind: "create", ...raw("new", "b.ts") },
      {
        kind: "delete",
        rootId: "app",
        path: "a.ts",
        expectedSha256: base.record("app", "a.ts")!.sha256,
      },
    ];
    expect(overlaySourceView(base, changes).read("app", "b.ts")).toBe("new");
    expect(() => overlaySourceView(base, [changes[0]!])).toThrow("budget");
    expect(() =>
      overlaySourceView(base, [
        {
          kind: "replace",
          rootId: "app",
          path: "a.ts",
          expectedSha256: base.record("app", "a.ts")!.sha256,
          bytes: new Uint8Array([0xff]),
        },
      ]),
    ).toThrow("UTF-8");
    expect(base.read("app", "a.ts")).toBe("old");
  });
});

describe("explicit source collection", () => {
  it("seals actual bytes once; later disk changes and candidate deletes cannot leak into reads", async () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, "index.ts"), "\ufefforiginal\r\n");
    const options = diskOptions(root);
    const view = await collectSourceView(options);
    fs.writeFileSync(path.join(root, "index.ts"), "changed on disk");
    const open = vi.spyOn(fs, "openSync").mockImplementation(() => {
      throw new Error("unexpected I/O");
    });
    expect(view.read("app", "index.ts")).toBe("\ufefforiginal\r\n");
    const next = overlaySourceView(view, [
      {
        kind: "delete",
        rootId: "app",
        path: "index.ts",
        expectedSha256: view.record("app", "index.ts")!.sha256,
      },
    ]);
    expect(next.read("app", "index.ts")).toBeUndefined();
    expect(next.list()).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });

  it("does not load executable sources or discover files absent from the explicit inventory", async () => {
    const root = fixture();
    fs.writeFileSync(
      path.join(root, "index.ts"),
      "throw new Error('must never run');",
    );
    fs.writeFileSync(path.join(root, "secret.ts"), "unselected");
    const view = await collectSourceView(diskOptions(root));
    expect(view.read("app", "index.ts")).toContain("must never run");
    expect(view.read("app", "secret.ts")).toBeUndefined();
    expect(fs.readdirSync(root).sort()).toEqual(["index.ts", "secret.ts"]);
  });

  it("rejects a discovered missing file and bounded oversized or invalid files", async () => {
    const root = fixture();
    await expect(collectSourceView(diskOptions(root))).rejects.toMatchObject({
      code: "VEXT_SOURCE_CHANGED",
    });
    fs.writeFileSync(path.join(root, "index.ts"), "1234");
    await expect(
      collectSourceView({ ...diskOptions(root), limits: { maxFileBytes: 3 } }),
    ).rejects.toMatchObject({ code: "VEXT_SOURCE_LIMIT" });
    fs.writeFileSync(path.join(root, "index.ts"), new Uint8Array([0xff]));
    await expect(collectSourceView(diskOptions(root))).rejects.toThrow("UTF-8");
  });

  it("rejects parent junctions escaping a declared root", async () => {
    const root = fixture();
    const outside = fixture();
    fs.writeFileSync(path.join(outside, "index.ts"), "outside");
    fs.symlinkSync(
      outside,
      path.join(root, "link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      collectSourceView(diskOptions(root, ["link/index.ts"])),
    ).rejects.toThrow("could not verify");
    expect(fs.readFileSync(path.join(outside, "index.ts"), "utf8")).toBe(
      "outside",
    );
  });

  it("rejects two registered aliases of the same physical root", async () => {
    const aliasRoot = fixture();
    const root = fixture();
    const alias = path.join(aliasRoot, "linked");
    fs.symlinkSync(
      root,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      collectSourceView({
        ...diskOptions(root, []),
        roots: [
          { id: "app", kind: "service", realPath: root },
          { id: "shared", kind: "shared", realPath: alias },
        ],
      }),
    ).rejects.toThrow("distinct, verifiable directory identities");
  });

  it("preserves the changed-source category when a file disappears after discovery", async () => {
    const root = fixture();
    const file = path.join(root, "index.ts");
    fs.writeFileSync(file, "original");
    const open = fs.openSync;
    vi.spyOn(fs, "openSync").mockImplementation(((target, flags, mode) => {
      if (String(target) === file) fs.unlinkSync(file);
      return open(target, flags, mode);
    }) as typeof fs.openSync);
    await expect(collectSourceView(diskOptions(root))).rejects.toMatchObject({
      code: "VEXT_SOURCE_CHANGED",
      message: expect.stringContaining("index.ts"),
    });
  });

  it("detects a changed physical root identity before sealing", async () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, "index.ts"), "value");
    const lstat = fs.lstatSync;
    let rootReads = 0;
    vi.spyOn(fs, "lstatSync").mockImplementation(((file, options) => {
      const result = lstat(file, options);
      if (String(file) === root && ++rootReads > 1)
        return Object.assign(result, { ino: BigInt(result.ino) + 1n });
      return result;
    }) as typeof fs.lstatSync);
    await expect(collectSourceView(diskOptions(root))).rejects.toMatchObject({
      code: "VEXT_SOURCE_CHANGED",
    });
  });

  it("cancels before I/O and yields during a multi-file collection", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      collectSourceView({
        ...diskOptions(path.resolve("not-created")),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "VEXT_SOURCE_CANCELLED" });
    const root = fixture();
    const files = Array.from({ length: 33 }, (_, index) => index + ".ts");
    for (const file of files) fs.writeFileSync(path.join(root, file), file);
    const running = new AbortController();
    const immediate = setImmediate(() => running.abort());
    try {
      await expect(
        collectSourceView({
          ...diskOptions(root, files),
          signal: running.signal,
        }),
      ).rejects.toMatchObject({ code: "VEXT_SOURCE_CANCELLED" });
    } finally {
      clearImmediate(immediate);
    }
  });
});
