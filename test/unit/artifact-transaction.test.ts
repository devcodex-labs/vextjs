import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withProjectOwner } from "../../src/lib/project/owner.js";
import {
  withArtifactTransaction,
  withArtifactGroupTransaction,
  type ArtifactCandidate,
  type ArtifactTransaction,
} from "../../src/lib/project/artifact-transaction.js";
import {
  ARTIFACT_JOURNAL_FILE,
  ARTIFACT_MANIFEST_FILE,
  artifactDigest,
} from "../../src/lib/project/artifact-manifest.js";

let root: string;
let outDir: string;
const children: ChildProcess[] = [];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(tmpdir(), "vext-artifact-test-"));
  outDir = path.join(root, "dist");
});

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Artifact fixture did not exit")),
      5000,
    );
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await waitForExit(child);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

function candidate(name: string, contents: string): ArtifactCandidate {
  return { path: path.join(outDir, name), contents };
}

function transaction<T>(
  action: (value: ArtifactTransaction) => Promise<T>,
  producer = "backend",
  output = outDir,
) {
  return withProjectOwner(root, "build", [output], () =>
    withArtifactTransaction(
      { rootDir: root, outDir: output, producer },
      action,
    ),
  );
}

function read(name: string): string {
  return fs.readFileSync(path.join(outDir, name), "utf8");
}

describe("owned artifact transactions", () => {
  it("commits multiple output roles together and performs zero writes for unchanged scopes", async () => {
    const generated = {
      outDir: path.join(root, ".vext/generated/frontend"),
      producer: "frontend-generated",
    };
    const built = { outDir, producer: "frontend" };
    const outputs = [generated, built];
    const generatedFile = path.join(generated.outDir, "entry.ts");
    const updates = [
      {
        ...generated,
        files: [{ path: generatedFile, contents: "source" }],
        inputDigest: artifactDigest("inputs"),
      },
      {
        ...built,
        files: [candidate("index.js", "compiled")],
        inputDigest: artifactDigest("inputs"),
      },
    ];
    await withProjectOwner(root, "build", [root + "/.vext", outDir], () =>
      withArtifactGroupTransaction(
        { rootDir: root, outputs },
        async (value) => {
          await value.commit(updates);
          expect(fs.readFileSync(generatedFile, "utf8")).toBe("source");
          expect(read("index.js")).toBe("compiled");
          expect(value.isFresh(generated, artifactDigest("inputs"))).toBe(true);
          expect(value.isFresh(built, artifactDigest("inputs"))).toBe(true);
          const rename = vi.spyOn(fs, "renameSync");
          await value.commit(updates);
          expect(rename).not.toHaveBeenCalled();
        },
      ),
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, ARTIFACT_MANIFEST_FILE), "utf8"),
    );
    expect(
      manifest.scopes.map((scope: { generation: number }) => scope.generation),
    ).toEqual([1, 1]);
  });

  it("a conflict in a later scope leaves all earlier scope bytes and the manifest unchanged", async () => {
    const other = path.join(root, ".vext/generated/frontend");
    const outputs = [
      { outDir, producer: "frontend" },
      { outDir: other, producer: "frontend-generated" },
    ];
    const file = path.join(other, "entry.ts");
    const run = (next: boolean) =>
      withProjectOwner(root, "build", [outDir, other], () =>
        withArtifactGroupTransaction({ rootDir: root, outputs }, (value) =>
          value.commit([
            {
              ...outputs[0]!,
              files: [candidate("index.js", next ? "new" : "old")],
            },
            {
              ...outputs[1]!,
              files: [
                { path: file, contents: next ? "new source" : "old source" },
              ],
            },
          ]),
        ),
      );
    await run(false);
    const before = fs.readFileSync(path.join(root, ARTIFACT_MANIFEST_FILE));
    fs.writeFileSync(file, "external edit");
    await expect(run(true)).rejects.toMatchObject({
      code: "VEXT_OUTPUT_CONFLICT",
    });
    expect(read("index.js")).toBe("old");
    expect(fs.readFileSync(file, "utf8")).toBe("external edit");
    expect(fs.readFileSync(path.join(root, ARTIFACT_MANIFEST_FILE))).toEqual(
      before,
    );
  });

  it("a failed replacement in the second scope rolls the first scope back", async () => {
    const secondDir = path.join(root, ".vext/generated/frontend");
    const outputs = [
      { outDir, producer: "frontend" },
      { outDir: secondDir, producer: "frontend-generated" },
    ];
    const secondFile = path.join(secondDir, "entry.ts");
    const run = (contents: string) =>
      withProjectOwner(root, "build", [outDir, secondDir], () =>
        withArtifactGroupTransaction({ rootDir: root, outputs }, (value) =>
          value.commit([
            { ...outputs[0]!, files: [candidate("index.js", contents)] },
            { ...outputs[1]!, files: [{ path: secondFile, contents }] },
          ]),
        ),
      );
    await run("old");
    const before = fs.readFileSync(path.join(root, ARTIFACT_MANIFEST_FILE));
    const rename = fs.renameSync;
    let failed = false;
    vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (!failed && path.relative(secondFile, String(target)) === "") {
        failed = true;
        expect(read("index.js")).toBe("new");
        throw new Error("second scope failed");
      }
      return rename(source, target);
    });
    await expect(run("new")).rejects.toThrow("second scope failed");
    expect(read("index.js")).toBe("old");
    expect(fs.readFileSync(secondFile, "utf8")).toBe("old");
    expect(fs.readFileSync(path.join(root, ARTIFACT_MANIFEST_FILE))).toEqual(
      before,
    );
  });

  it("rejects undeclared and duplicated scopes, cross-scope ownership and a closed group", async () => {
    const target = { outDir, producer: "frontend" };
    const second = { outDir, producer: "backend" };
    await withProjectOwner(root, "build", [outDir], async () => {
      const retained = await withArtifactGroupTransaction(
        { rootDir: root, outputs: [target, second] },
        async (value) => {
          await expect(
            value.commit([{ outDir, producer: "undeclared", files: [] }]),
          ).rejects.toMatchObject({ code: "VEXT_OUTPUT_UNVERIFIED" });
          await expect(
            value.commit([
              { ...target, files: [] },
              { ...target, files: [] },
            ]),
          ).rejects.toMatchObject({ code: "VEXT_OUTPUT_CONFLICT" });
          await expect(
            value.commit([
              { ...target, files: [candidate("same.js", "a")] },
              { ...second, files: [candidate("same.js", "a")] },
            ]),
          ).rejects.toMatchObject({ code: "VEXT_OUTPUT_UNVERIFIED" });
          expect(fs.existsSync(path.join(outDir, "same.js"))).toBe(false);
          await value.commit([
            { ...target, files: [candidate("front.js", "a")] },
            { ...second, files: [candidate("back.js", "b")] },
          ]);
          await value.commit([{ ...target, files: [] }]);
          expect(read("back.js")).toBe("b");
          expect(fs.existsSync(path.join(outDir, "front.js"))).toBe(false);
          return value;
        },
      );
      await expect(retained.commit([])).rejects.toMatchObject({
        code: "VEXT_OWNER_CLOSED",
      });
    });
  });

  it("rejects a retained transaction after its exclusive scope has closed", async () => {
    await withProjectOwner(root, "build", [outDir], async () => {
      const retained = await withArtifactTransaction(
        { rootDir: root, outDir, producer: "backend" },
        async (value) => value,
      );
      await expect(
        retained.commit([candidate("a.js", "late")]),
      ).rejects.toMatchObject({ code: "VEXT_OWNER_CLOSED" });
    });
    expect(fs.existsSync(path.join(outDir, "a.js"))).toBe(false);
  });

  it("preserves unowned files and only removes previously produced stale outputs", async () => {
    fs.mkdirSync(outDir);
    fs.writeFileSync(path.join(outDir, "user.js"), "user data");
    await transaction((value) =>
      value.commit([candidate("a.js", "a"), candidate("a.js.map", "map")]),
    );
    await transaction((value) => value.commit([candidate("b.js", "b")]));
    expect(read("user.js")).toBe("user data");
    expect(read("b.js")).toBe("b");
    expect(fs.existsSync(path.join(outDir, "a.js"))).toBe(false);
    expect(fs.existsSync(path.join(outDir, "a.js.map"))).toBe(false);
  });

  it("does not touch last good artifacts if candidate generation fails", async () => {
    await transaction((value) => value.commit([candidate("a.js", "old")]));
    const manifest = fs.readFileSync(path.join(root, ARTIFACT_MANIFEST_FILE));
    await expect(
      transaction(async () => {
        throw new Error("compiler failed");
      }),
    ).rejects.toThrow("compiler failed");
    expect(read("a.js")).toBe("old");
    expect(fs.readFileSync(path.join(root, ARTIFACT_MANIFEST_FILE))).toEqual(
      manifest,
    );
  });

  it("refuses different unowned output content without deleting other files", async () => {
    fs.mkdirSync(outDir);
    fs.writeFileSync(path.join(outDir, "a.js"), "user");
    await expect(
      transaction((value) =>
        value.commit([candidate("b.js", "b"), candidate("a.js", "generated")]),
      ),
    ).rejects.toMatchObject({ code: "VEXT_OUTPUT_CONFLICT" });
    expect(read("a.js")).toBe("user");
    expect(fs.existsSync(path.join(outDir, "b.js"))).toBe(false);
    expect(fs.existsSync(path.join(root, ARTIFACT_MANIFEST_FILE))).toBe(false);
  });

  it("can adopt exact deterministic output bytes without rewriting the file", async () => {
    fs.mkdirSync(outDir);
    fs.writeFileSync(path.join(outDir, "a.js"), "generated");
    const before = fs.statSync(path.join(outDir, "a.js")).mtimeMs;
    await transaction((value) =>
      value.commit([candidate("a.js", "generated")]),
    );
    expect(fs.statSync(path.join(outDir, "a.js")).mtimeMs).toBe(before);
  });

  it("detects external changes even when size and mtime match", async () => {
    const digest = artifactDigest("source");
    await transaction((value) =>
      value.commit([candidate("a.js", "one")], { inputDigest: digest }),
    );
    const file = path.join(outDir, "a.js");
    const before = fs.statSync(file);
    fs.writeFileSync(file, "two");
    fs.utimesSync(file, before.atime, before.mtime);
    await transaction(async (value) => {
      expect(value.isFresh(digest)).toBe(false);
    });
    await expect(
      transaction((value) => value.commit([candidate("a.js", "new")])),
    ).rejects.toMatchObject({ code: "VEXT_OUTPUT_CONFLICT" });
    expect(read("a.js")).toBe("two");
  });

  it("rebuilds missing owned outputs and invalidates freshness after a partial update", async () => {
    const digest = artifactDigest("source");
    await transaction((value) =>
      value.commit([candidate("a.js", "a"), candidate("b.js", "b")], {
        inputDigest: digest,
      }),
    );
    await transaction(async (value) => {
      expect(value.isFresh(digest)).toBe(true);
    });
    fs.rmSync(path.join(outDir, "a.js"));
    await transaction(async (value) => {
      expect(value.isFresh(digest)).toBe(false);
      await value.commit([candidate("a.js", "a")], { mode: "merge" });
      expect(value.isFresh(digest)).toBe(false);
    });
    expect(read("a.js")).toBe("a");
    expect(read("b.js")).toBe("b");
  });

  it("performs zero file and manifest writes on an unchanged candidate", async () => {
    const files = [candidate("a.js", "a")];
    const digest = artifactDigest("source");
    await transaction((value) => value.commit(files, { inputDigest: digest }));
    const manifest = path.join(root, ARTIFACT_MANIFEST_FILE);
    const before = fs.statSync(manifest).mtimeMs;
    const spy = vi.spyOn(fs, "renameSync");
    await transaction((value) => value.commit(files, { inputDigest: digest }));
    expect(
      spy.mock.calls.filter(
        ([, target]) =>
          String(target).startsWith(root) &&
          !String(target).includes("registry.json"),
      ),
    ).toHaveLength(0);
    expect(fs.statSync(manifest).mtimeMs).toBe(before);
  });

  it("does not allow another producer to overwrite the same artifact", async () => {
    await transaction((value) => value.commit([candidate("a.js", "same")]));
    await expect(
      transaction(
        (value) => value.commit([candidate("a.js", "same")]),
        "frontend",
      ),
    ).rejects.toMatchObject({ code: "VEXT_OUTPUT_CONFLICT" });
    expect(read("a.js")).toBe("same");
  });

  it("serializes transactions sharing the same owner across different output groups", async () => {
    const events: string[] = [];
    await withProjectOwner(root, "build", [outDir], async () => {
      await Promise.all(
        ["a", "b"].map((name) =>
          withArtifactTransaction(
            {
              rootDir: root,
              outDir: path.join(outDir, name),
              producer: "backend",
            },
            async (value) => {
              events.push(`${name}-start`);
              await new Promise((resolve) => setTimeout(resolve, 25));
              await value.commit([
                { path: path.join(outDir, name, "index.js"), contents: name },
              ]);
              events.push(`${name}-end`);
            },
          ),
        ),
      );
    });
    expect(events).toEqual(["a-start", "a-end", "b-start", "b-end"]);
    expect(read("a/index.js")).toBe("a");
    expect(read("b/index.js")).toBe("b");
  });

  it("rolls back earlier outputs when a later atomic replacement fails", async () => {
    await transaction((value) =>
      value.commit([candidate("a.js", "old a"), candidate("b.js", "old b")]),
    );
    const manifest = fs.readFileSync(path.join(root, ARTIFACT_MANIFEST_FILE));
    const rename = fs.renameSync;
    let failed = false;
    vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (
        !failed &&
        path.relative(path.join(outDir, "b.js"), String(target)) === ""
      ) {
        failed = true;
        throw new Error("injected rename failure");
      }
      return rename(source, target);
    });
    await expect(
      transaction((value) =>
        value.commit([candidate("a.js", "new a"), candidate("b.js", "new b")]),
      ),
    ).rejects.toThrow("injected rename failure");
    expect(read("a.js")).toBe("old a");
    expect(read("b.js")).toBe("old b");
    expect(fs.readFileSync(path.join(root, ARTIFACT_MANIFEST_FILE))).toEqual(
      manifest,
    );
    expect(fs.existsSync(path.join(root, ARTIFACT_JOURNAL_FILE))).toBe(false);
    expect(fs.readdirSync(outDir).some((name) => name.endsWith(".tmp"))).toBe(
      false,
    );
  });

  it("preserves the journal and user bytes when an external edit prevents rollback", async () => {
    await transaction((value) =>
      value.commit([candidate("a.js", "old a"), candidate("b.js", "old b")]),
    );
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (path.relative(path.join(outDir, "b.js"), String(target)) === "") {
        fs.writeFileSync(path.join(outDir, "a.js"), "external edit");
        throw new Error("injected failure");
      }
      return rename(source, target);
    });
    await expect(
      transaction((value) =>
        value.commit([candidate("a.js", "new a"), candidate("b.js", "new b")]),
      ),
    ).rejects.toThrow("preserve the recovery journal");
    expect(read("a.js")).toBe("external edit");
    expect(fs.existsSync(path.join(root, ARTIFACT_JOURNAL_FILE))).toBe(true);
    vi.restoreAllMocks();
    await expect(transaction(async () => undefined)).rejects.toMatchObject({
      code: "VEXT_OUTPUT_CONFLICT",
    });
    expect(read("a.js")).toBe("external edit");
  });

  it("rejects malformed and unknown manifests instead of treating them as empty", async () => {
    const target = path.join(root, ARTIFACT_MANIFEST_FILE);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    for (const bytes of ["{", '{"schemaVersion":999}']) {
      fs.writeFileSync(target, bytes);
      await expect(
        transaction((value) => value.commit([candidate("a.js", "new")])),
      ).rejects.toMatchObject({ code: "VEXT_OUTPUT_UNVERIFIED" });
      expect(fs.readFileSync(target, "utf8")).toBe(bytes);
    }
    expect(fs.existsSync(outDir)).toBe(false);
  });

  it("preserves an unknown recovery journal without starting another write", async () => {
    const journal = path.join(root, ARTIFACT_JOURNAL_FILE);
    fs.mkdirSync(path.dirname(journal), { recursive: true });
    fs.writeFileSync(journal, '{"schemaVersion":999}');
    await expect(
      transaction((value) => value.commit([candidate("a.js", "new")])),
    ).rejects.toMatchObject({ code: "VEXT_OUTPUT_UNVERIFIED" });
    expect(fs.readFileSync(journal, "utf8")).toBe('{"schemaVersion":999}');
    expect(fs.existsSync(outDir)).toBe(false);
  });

  it("cleans known preparation bytes after a staging write fails", async () => {
    await transaction((value) => value.commit([candidate("a.js", "old")]));
    const write = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementation((file, data, options) => {
      if (String(file).endsWith("0-after"))
        throw new Error("staging write failed");
      return write(file, data, options);
    });
    await expect(
      transaction((value) => value.commit([candidate("a.js", "new")])),
    ).rejects.toThrow("staging write failed");
    expect(read("a.js")).toBe("old");
    expect(
      fs.readdirSync(path.join(root, ".vext/freshness/v1/transactions")),
    ).toEqual([]);
  });

  it("rejects source, state, and symbolic-link escapes before final output mutation", async () => {
    await expect(
      transaction((value) =>
        value.commit([
          { path: path.join(root, "src/index.js"), contents: "bad" },
        ]),
      ),
    ).rejects.toThrow();
    await expect(
      transaction(
        (value) => value.commit([candidate("a.js", "a")]),
        "backend",
        path.join(root, ".vext/freshness/v1"),
      ),
    ).rejects.toThrow();
    const outside = fs.mkdtempSync(
      path.join(tmpdir(), "vext-artifact-outside-"),
    );
    try {
      fs.symlinkSync(outside, outDir, "junction");
      await expect(
        transaction((value) => value.commit([candidate("a.js", "bad")])),
      ).rejects.toThrow();
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it.each(
    ["preparation", "output", "manifest"].flatMap((phase) => [
      [phase, "single"],
      [phase, "group"],
    ]),
  )(
    "recovers a real writer interrupted during %s (%s) before exposing the next transaction",
    async (phase, grouping) => {
      const grouped = grouping === "group";
      const generatedDir = path.join(root, ".vext/generated/frontend");
      const readSecond = () =>
        fs.readFileSync(
          path.join(grouped ? generatedDir : outDir, "b.js"),
          "utf8",
        );
      if (grouped) {
        await withProjectOwner(root, "build", [outDir, generatedDir], () =>
          withArtifactGroupTransaction(
            {
              rootDir: root,
              outputs: [
                { outDir, producer: "backend" },
                { outDir: generatedDir, producer: "frontend-generated" },
              ],
            },
            (value) =>
              value.commit([
                {
                  outDir,
                  producer: "backend",
                  files: [candidate("a.js", "old a")],
                },
                {
                  outDir: generatedDir,
                  producer: "frontend-generated",
                  files: [
                    {
                      path: path.join(generatedDir, "b.js"),
                      contents: "old b",
                    },
                  ],
                },
              ]),
          ),
        );
      } else
        await transaction((value) =>
          value.commit([
            candidate("a.js", "old a"),
            candidate("b.js", "old b"),
          ]),
        );
      const fixture = path.join(root, "artifact-crash.cjs");
      await build({
        entryPoints: [path.resolve("test/fixtures/artifact-crash-child.ts")],
        outfile: fixture,
        bundle: true,
        platform: "node",
        format: "cjs",
        logLevel: "silent",
      });
      const child = fork(fixture, [root, phase!, grouping!], {
        stdio: "ignore",
      });
      children.push(child);
      await waitForExit(child);
      expect(child.exitCode === 0).toBe(false);
      expect(read("a.js")).toBe(phase === "preparation" ? "old a" : "new a");
      expect(readSecond()).toBe(phase === "manifest" ? "new b" : "old b");
      expect(fs.existsSync(path.join(root, ARTIFACT_JOURNAL_FILE))).toBe(
        phase !== "preparation",
      );
      await transaction(async () => {
        expect(read("a.js")).toBe(phase === "manifest" ? "new a" : "old a");
        expect(readSecond()).toBe(phase === "manifest" ? "new b" : "old b");
      });
      expect(fs.existsSync(path.join(root, ARTIFACT_JOURNAL_FILE))).toBe(false);
      expect(
        fs.readdirSync(path.join(root, ".vext/freshness/v1/transactions")),
      ).toEqual([]);
      process.stdout.write(
        `[artifact-crash] PID ${child.pid} exited; recovered ${root}\n`,
      );
    },
  );
});
