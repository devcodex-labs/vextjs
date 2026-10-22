import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  readFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { BuildCompiler } from "../../../src/lib/build/build-compiler.js";
import { collectJobSourceSnapshot } from "../../../src/lib/jobs/job-source.js";

const job =
  'import {defineJob} from "vextjs"; export default defineJob({cron:"* * * * * *",handler(){}});';
async function project(
  run: (
    root: string,
    put: (file: string, source: string) => Promise<void>,
  ) => Promise<void>,
) {
  const root = await mkdtemp(path.join(tmpdir(), "vext-job-build-"));
  const put = async (file: string, source: string) => {
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, source);
  };
  try {
    await put("package.json", '{"type":"module"}');
    await mkdir(path.join(root, "node_modules"));
    await symlink(
      process.cwd(),
      path.join(root, "node_modules/vextjs"),
      "junction",
    );
    await run(root, put);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const compiler = (root: string, minify: boolean) =>
  new BuildCompiler({
    rootDir: root,
    srcDir: path.join(root, "src"),
    outDir: path.join(root, "dist"),
    minify,
    sourcemap: false,
  });

describe("Jobs pre-optimization and emitted-input contracts", () => {
  it.each([false, true])(
    "rejects an unused second position before optimization, minify=%s",
    async (minify) => {
      await project(async (root, put) => {
        await put(
          "src/jobs/task.ts",
          job +
            'function unused(){return defineJob({cron:"* * * * * *",handler(){}});}',
        );
        await expect(compiler(root, minify).build()).rejects.toThrow(
          "multiple SDK",
        );
        expect(existsSync(path.join(root, "dist/jobs/task.js"))).toBe(false);
      });
    },
  );
  it.each([false, true])(
    "loads a production CJS default shell and ordinary helper after removing src, minify=%s",
    async (minify) => {
      await project(async (root, put) => {
        await put(
          "src/jobs/main.ts",
          'export {default} from "../definitions/task.js";',
        );
        await put(
          "src/definitions/task.ts",
          job + 'export {default as helper} from "./barrel.js";',
        );
        await put(
          "src/definitions/barrel.ts",
          'export {default} from "./helper.js";',
        );
        await put(
          "src/definitions/helper.ts",
          "export default function helper(){return 1;}",
        );
        expect((await compiler(root, minify).build()).success).toBe(true);
        await rm(path.join(root, "src"), { recursive: true });
        const loader = pathToFileURL(
          path.join(process.cwd(), "dist/lib/jobs/job-loader.js"),
        ).href;
        const { stdout } = await promisify(execFile)(
          process.execPath,
          [
            "--input-type=module",
            "--eval",
            `import {loadJobs} from ${JSON.stringify(loader)};console.log(JSON.stringify((await loadJobs({rootDir:${JSON.stringify(root)},srcDir:${JSON.stringify(path.join(root, "dist"))}})).map(x=>x.name)));`,
          ],
          { cwd: root, windowsHide: true },
        );
        expect(JSON.parse(stdout)).toEqual(["main"]);
      });
    },
  );
  it("uses the actual explicit JS dependency before a same-name TS decoy", async () => {
    await project(async (root, put) => {
      await put(
        "src/jobs/main.ts",
        'export {default} from "../definitions/task.js";',
      );
      await put("src/definitions/task.ts", job);
      await put(
        "src/definitions/task.js",
        job +
          'function unused(){return defineJob({cron:"* * * * * *",handler(){}});}',
      );
      await expect(compiler(root, true).build()).rejects.toThrow(
        "multiple SDK",
      );
    });
  });
  it("rejects source and selection drift before committing an output", async () => {
    await project(async (root, put) => {
      await put("src/jobs/task.ts", job);
      const srcDir = path.join(root, "src");
      const snapshot = await collectJobSourceSnapshot(root, srcDir);
      await put("src/jobs/task.ts", job + "\n// changed");
      await expect(
        new BuildCompiler({
          rootDir: root,
          srcDir,
          outDir: path.join(root, "dist"),
          jobSources: snapshot,
        }).build(),
      ).rejects.toThrow("input changed");
      expect(existsSync(path.join(root, "dist/jobs/task.js"))).toBe(false);
      const second = await collectJobSourceSnapshot(root, srcDir);
      await put("src/jobs/extra.ts", job);
      await expect(second.verify()).rejects.toThrow("selection changed");
      expect(
        await readFile(path.join(srcDir, "jobs/task.ts"), "utf8"),
      ).toContain("changed");
    });
  });
});
