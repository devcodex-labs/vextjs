import { spawn, type ChildProcess } from "node:child_process";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { createImplementationTracker } from "../../../src/assistant/implementation-identity.js";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/** A tiny real compiler consumer reuses local dependencies; no install or package copies. */
it("publishes real ESM builds and refreshes a watched source before completing the manifest", async () => {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(parent, "vext-framework-build-"));
  let child: ChildProcess | undefined;
  let closed:
    | Promise<{ code: number | null; signal: NodeJS.Signals | null }>
    | undefined;
  let output = "";
  let failure: Error | undefined;
  const waitUntil = async (predicate: () => boolean) => {
    const deadline = Date.now() + 20_000;
    while (!predicate()) {
      if (failure) throw failure;
      if (Date.now() > deadline)
        throw new Error("Build validation timed out: " + output);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  const launch = (args: string[]) => {
    output = "";
    failure = undefined;
    child = spawn(
      process.execPath,
      [path.join(root, "scripts/build-framework.mjs"), ...args],
      { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stdout!.on("data", (chunk) => {
      output = (output + chunk).slice(-16_384);
    });
    child.stderr!.on("data", (chunk) => {
      output = (output + chunk).slice(-16_384);
    });
    child.once("error", (error) => {
      failure = error;
    });
    closed = new Promise((resolve) =>
      child!.once("close", (code, signal) => resolve({ code, signal })),
    );
    console.info("[build fixture]", {
      pid: child.pid,
      cwd: root,
      args,
      ports: [],
    });
  };
  try {
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await mkdir(path.join(root, "src/lib/project"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      '{"name":"build-fixture","version":"2.0.0","type":"module"}',
    );
    await writeFile(path.join(root, "package-lock.json"), "{}");
    await writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          outDir: "dist",
          rootDir: "src",
          types: [],
          skipLibCheck: true,
        },
        include: ["src/index.ts", "src/assistant/implementation-identity.ts"],
      }),
    );
    await mkdir(path.join(root, "src/assistant"), { recursive: true });
    await writeFile(
      path.join(root, "src/assistant/implementation-identity.ts"),
      "const COMPILED_INPUT_DIGEST: string | null = null;\nexport const loadedInput = () => COMPILED_INPUT_DIGEST;",
    );
    await writeFile(
      path.join(root, "src/index.ts"),
      "export const answer: number = 1;",
    );
    for (const file of [
      "scripts/build-framework.mjs",
      "scripts/build-cjs.mjs",
      "scripts/implementation-manifest.mjs",
      "src/lib/project/implementation-fingerprint.mjs",
      "src/lib/project/implementation-fingerprint.d.mts",
    ])
      await copyFile(path.join(repo, file), path.join(root, file));
    await symlink(
      path.join(repo, "node_modules"),
      path.join(root, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    launch(["--esm"]);
    const result = await closed!;
    expect(result.code, output).toBe(0);
    expect(await readFile(path.join(root, "dist/index.js"), "utf8")).toContain(
      "answer = 1",
    );
    const firstManifest = JSON.parse(
      await readFile(path.join(root, "dist/.implementation.json"), "utf8"),
    );
    expect(
      await readFile(
        path.join(root, "dist/assistant/implementation-identity.js"),
        "utf8",
      ),
    ).toContain(firstManifest.inputDigest);
    const inspect = createImplementationTracker(path.join(root, "dist"));
    expect(inspect().state).toBe("current");
    launch(["--watch"]);
    await waitUntil(() =>
      output.includes("ESM implementation manifest updated"),
    );
    output = "";
    await writeFile(
      path.join(root, "src/index.ts"),
      "export const answer: number = 2;",
    );
    await waitUntil(() =>
      output.includes("ESM implementation manifest updated"),
    );
    expect(await readFile(path.join(root, "dist/index.js"), "utf8")).toContain(
      "answer = 2",
    );
    expect(inspect().state).toBe("restart-required");
    const nextManifest = JSON.parse(
      await readFile(path.join(root, "dist/.implementation.json"), "utf8"),
    );
    expect(
      await readFile(
        path.join(root, "dist/assistant/implementation-identity.js"),
        "utf8",
      ),
    ).toContain(nextManifest.inputDigest);
    expect(
      JSON.parse(
        await readFile(path.join(root, "dist/.implementation.json"), "utf8"),
      ),
    ).toMatchObject({ state: "complete", formats: ["esm"] });
  } finally {
    if (child && child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
    if (closed)
      console.info("[build fixture stopped]", {
        pid: child?.pid,
        ...(await closed),
        ports: [],
      });
    expect(path.dirname(await realpath(root))).toBe(parent);
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
