import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { build } from "esbuild";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  withProjectOwner,
  currentProjectOwner,
} from "../../src/lib/project/owner.js";
import {
  recoverTemporaryArtifacts,
  withTemporaryArtifact,
} from "../../src/lib/project/temporary-artifact.js";
import { evaluateGeneratedEsmString } from "../../src/lib/build/generated-esm.js";
import { withArtifactTransaction } from "../../src/lib/project/artifact-transaction.js";

let root: string;
let logicalPath: string;
let child: ChildProcess | undefined;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(tmpdir(), "vext-temporary-"));
  logicalPath = path.join(root, "generated/extract.mjs");
});
afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>((resolve) =>
      child!.once("exit", () => resolve()),
    );
    child.kill("SIGKILL");
    await exited;
  }
  child = undefined;
  fs.rmSync(root, { recursive: true, force: true });
});
function owned<T>(operation: () => Promise<T>) {
  return withProjectOwner(
    root,
    "build",
    [path.dirname(logicalPath)],
    operation,
  );
}
function receipts() {
  return fs.readdirSync(path.join(root, ".vext/freshness/v1/temporary"));
}
function temporaryFiles() {
  return fs
    .readdirSync(path.dirname(logicalPath))
    .filter((file) => file.startsWith(".vext-exec-"));
}

describe("owned temporary module execution", () => {
  it("leaves an active operation intact and cleans only its verified bytes after failure", async () => {
    await owned(async () => {
      await expect(
        withTemporaryArtifact(
          { rootDir: root, logicalPath, contents: "owned" },
          async (file) => {
            expect(fs.readFileSync(file, "utf8")).toBe("owned");
            await recoverTemporaryArtifacts(currentProjectOwner(root)!);
            expect(fs.existsSync(file)).toBe(true);
            throw new Error("generation failed");
          },
        ),
      ).rejects.toThrow("generation failed");
      expect(temporaryFiles()).toEqual([]);
      expect(receipts()).toEqual([]);
      expect(fs.existsSync(logicalPath)).toBe(false);
    });
    await expect(
      withTemporaryArtifact(
        { rootDir: root, logicalPath, contents: "invalid" },
        async () => {},
      ),
    ).rejects.toThrow("requires a project owner");
  });

  it("preserves an externally modified temporary file and its recovery evidence", async () => {
    let changed = "";
    await owned(async () => {
      await expect(
        withTemporaryArtifact(
          { rootDir: root, logicalPath, contents: "owned" },
          async (file) => {
            changed = file;
            fs.writeFileSync(file, "external");
          },
        ),
      ).rejects.toThrow("externally modified");
      expect(fs.readFileSync(changed, "utf8")).toBe("external");
      expect(receipts()).toHaveLength(1);
      await expect(
        recoverTemporaryArtifacts(currentProjectOwner(root)!),
      ).rejects.toThrow("externally modified");
      // 测试恢复原始归属字节后再恢复；产品不会自行抹掉冲突。
      fs.writeFileSync(changed, "owned");
      await recoverTemporaryArtifacts(currentProjectOwner(root)!);
      expect(receipts()).toEqual([]);
      expect(temporaryFiles()).toEqual([]);
    });
  });

  it("uses native ESM with top-level await and fresh relative imports without leaking worker state", async () => {
    fs.mkdirSync(path.dirname(logicalPath));
    const dependency = path.join(path.dirname(logicalPath), "value.mjs");
    fs.writeFileSync(dependency, 'export default "first";');
    const contents = `
      import value from './value.mjs';
      await Promise.resolve();
      process.env.VEXT_TEMPORARY_TEST = 'worker';
      setInterval(() => {}, 1000);
      export default value + ':' + new URL('./', import.meta.url).pathname;
    `;
    await owned(async () => {
      const first = await evaluateGeneratedEsmString({
        rootDir: root,
        logicalPath,
        contents,
      });
      expect(first.startsWith("first:")).toBe(true);
      expect(first.endsWith("/generated/")).toBe(true);
      fs.writeFileSync(dependency, 'export default "second";');
      const second = await evaluateGeneratedEsmString({
        rootDir: root,
        logicalPath,
        contents,
      });
      expect(second.startsWith("second:")).toBe(true);
      expect(process.env.VEXT_TEMPORARY_TEST).toBeUndefined();
      expect(temporaryFiles()).toEqual([]);
      expect(receipts()).toEqual([]);
    });
  });

  it("terminates infinite execution, aborts promptly and cleans invalid or oversized results", async () => {
    await owned(async () => {
      await expect(
        evaluateGeneratedEsmString({
          rootDir: root,
          logicalPath,
          contents: "while (true) {}",
          timeoutMs: 200,
        }),
      ).rejects.toThrow("timed out");
      const controller = new AbortController();
      const aborted = evaluateGeneratedEsmString({
        rootDir: root,
        logicalPath,
        contents: "while (true) {}",
        signal: controller.signal,
      });
      const timer = setTimeout(
        () => controller.abort(new Error("cancelled")),
        100,
      );
      try {
        await expect(aborted).rejects.toThrow("cancelled");
      } finally {
        clearTimeout(timer);
      }
      await expect(
        evaluateGeneratedEsmString({
          rootDir: root,
          logicalPath,
          contents: "export default {};",
        }),
      ).rejects.toThrow("must be a string");
      await expect(
        evaluateGeneratedEsmString({
          rootDir: root,
          logicalPath,
          contents: 'export default "too long";',
          maxBytes: 2,
        }),
      ).rejects.toThrow("size limit");
      expect(temporaryFiles()).toEqual([]);
      expect(receipts()).toEqual([]);
    });
  });

  it("recovers a real interrupted process before the next artifact transaction", async () => {
    const fixture = path.join(root, "fixture.cjs");
    await build({
      entryPoints: [path.resolve("test/fixtures/temporary-artifact-child.ts")],
      outfile: fixture,
      bundle: true,
      platform: "node",
      format: "cjs",
      logLevel: "silent",
    });
    child = spawn(process.execPath, [fixture, root], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errors = "";
    child.stdout!.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr!.on("data", (chunk) => {
      errors += String(chunk);
    });
    await new Promise<void>((resolve, reject) => {
      child!.once("error", reject);
      child!.once("close", () => resolve());
    });
    expect(errors).toBe("");
    const stopped = JSON.parse(output.trim()) as { pid: number; file: string };
    expect(fs.readFileSync(stopped.file, "utf8")).toContain("interrupted");
    console.info(
      `[temporary recovery] cwd=${root}, PID=${stopped.pid}, exited=true`,
    );
    await owned(() =>
      withArtifactTransaction(
        { rootDir: root, outDir: path.join(root, "dist"), producer: "test" },
        async (transaction) => {
          expect(fs.existsSync(stopped.file)).toBe(false);
          expect(receipts()).toEqual([]);
          await transaction.commit([
            { path: path.join(root, "dist/index.js"), contents: "recovered" },
          ]);
        },
      ),
    );
    expect(fs.readFileSync(path.join(root, "dist/index.js"), "utf8")).toBe(
      "recovered",
    );
  });
});
