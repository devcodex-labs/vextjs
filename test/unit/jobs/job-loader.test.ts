import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { loadJobs } from "../../../src/lib/jobs/job-loader.js";

const framework = pathToFileURL(path.join(process.cwd(), "dist/index.js")).href;
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "vext-scheduled-loader-"));
  try {
    await writeFile(path.join(root, "package.json"), '{"type":"module"}');
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("scheduled job discovery", () => {
  it("loads CommonJS definitions and gives code docs the same task names and schedules", async () => {
    await fixture(async (root) => {
      const src = path.join(root, "src");
      const jobsDir = path.join(src, "jobs");
      await mkdir(jobsDir, { recursive: true });
      await mkdir(path.join(root, "node_modules"));
      await symlink(
        process.cwd(),
        path.join(root, "node_modules/vextjs"),
        "junction",
      );
      const cjs = JSON.stringify("vextjs");
      await writeFile(
        path.join(jobsDir, "single.cjs"),
        `const { defineJob } = require(${cjs}); module.exports = defineJob({ interval: 1000, handler() { globalThis.nativeJobRuns++; } });`,
      );
      await writeFile(
        path.join(jobsDir, "multi.cjs"),
        `const { defineJob } = require(${cjs}); exports.__esModule = true; exports.default = defineJob({ interval: 2000, handler() {} }); exports.daily = defineJob({ cron: "0 9 * * *", handler() {} });`,
      );
      await writeFile(
        path.join(jobsDir, "named.cjs"),
        `const { defineJob } = require(${cjs}); module.exports = defineJob({ name: "explicit", interval: 3000, handler() { globalThis.nativeJobRuns++; } });`,
      );
      // Exercise native CJS loading, including __esModule/default interop;
      // Vitest transforms exports.default and cannot model this CJS namespace.
      const loaderUrl = pathToFileURL(
        path.join(process.cwd(), "dist/lib/jobs/job-loader.js"),
      ).href;
      const docsUrl = pathToFileURL(
        path.join(process.cwd(), "dist/lib/docs/sources/job-source.js"),
      ).href;
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `
        import { loadJobs } from ${JSON.stringify(loaderUrl)};
        import { loadJobCodeDocs } from ${JSON.stringify(docsUrl)};
        import { createScheduledJobs } from ${JSON.stringify(pathToFileURL(path.join(process.cwd(), "dist/lib/jobs/runtime.js")).href)};
        const loaded = await loadJobs({ rootDir: ${JSON.stringify(root)}, srcDir: ${JSON.stringify(src)} });
        const documented = await loadJobCodeDocs({ srcDir: ${JSON.stringify(src)}, source: true });
        const shape = (name, definition) => ({ name, interval: definition.interval, cron: definition.cron });
        const sort = (items) => items.sort((a, b) => a.name.localeCompare(b.name));
        globalThis.nativeJobRuns = 0;
        for (const job of loaded.filter(job => ["single", "explicit"].includes(job.name))) {
          const scheduler = await createScheduledJobs({config:{},logger:{info(){},debug(){},error(){}}},[job],{rootDir:${JSON.stringify(root)},timers:false});
          try { scheduler.start(new Date(0)); await scheduler.tick(new Date(job.definition.interval)); await scheduler.tick(new Date(job.definition.interval)); }
          finally { await scheduler.close(); }
        }
        console.log(JSON.stringify({
          invocations: globalThis.nativeJobRuns,
          loaded: sort(loaded.map(({ name, definition }) => shape(name, definition))),
          documented: sort(documented.map(({ job }) => shape(job.name, job)))
        }));
      `,
        ],
        { cwd: root, timeout: 10000, windowsHide: true },
      );
      const { loaded, documented, invocations } = JSON.parse(stdout) as {
        invocations: number;
        loaded: { name: string; interval?: number; cron?: string }[];
        documented: { name: string; interval?: number; cron?: string }[];
      };
      expect(loaded.map(({ name }) => name).sort()).toEqual([
        "explicit",
        "multi",
        "multi.daily",
        "single",
      ]);
      expect(documented).toEqual(loaded);
      expect(invocations).toBe(2);
    });
  });

  it("discovers default/named exports and applies custom directory and file filters", async () => {
    await fixture(async (root) => {
      const src = path.join(root, "src");
      const tasks = path.join(src, "tasks");
      await mkdir(path.join(tasks, "billing"), { recursive: true });
      await writeFile(
        path.join(tasks, "billing/run.mjs"),
        `import { defineJob } from ${JSON.stringify(framework)}; export default defineJob({ interval: 1000, handler() {} }); export const sweep = defineJob({ interval: 2000, handler() {} });`,
      );
      await writeFile(
        path.join(tasks, "_helper.mjs"),
        'throw new Error("must be ignored")',
      );
      await writeFile(
        path.join(tasks, "types.d.mts"),
        "this declaration must not be imported",
      );
      await writeFile(
        path.join(tasks, "ignored.mjs"),
        'throw new Error("excluded file must not run")',
      );
      const jobs = await loadJobs({
        rootDir: root,
        srcDir: src,
        config: { dir: "tasks", exclude: ["ignored.mjs"] },
      });
      expect(jobs.map((job) => job.name)).toEqual([
        "billing.run",
        "billing.run.sweep",
      ]);
      expect(jobs.map((job) => job.definition.interval)).toEqual([1000, 2000]);
      expect(
        await loadJobs({
          rootDir: root,
          srcDir: src,
          config: { dir: "tasks", include: ["missing/**/*.mjs"] },
        }),
      ).toEqual([]);
      expect(
        await loadJobs({
          rootDir: root,
          srcDir: src,
          config: { dir: "tasks", enabled: false },
        }),
      ).toEqual([]);
    });
  });
  it("reports modules with no exported definition and invalid modules during startup", async () => {
    await fixture(async (root) => {
      const src = path.join(root, "src");
      await mkdir(path.join(src, "jobs"), { recursive: true });
      const file = path.join(src, "jobs/sample.mjs");
      await writeFile(file, "export const helper = 1;");
      await expect(loadJobs({ rootDir: root, srcDir: src })).rejects.toThrow(
        "no defineJob() export",
      );
      await writeFile(file, 'throw new Error("owned startup failure");');
      await expect(loadJobs({ rootDir: root, srcDir: src })).rejects.toThrow(
        "Failed to load job file",
      );
    });
  });
  it("maps source-relative directories into built output", async () => {
    await fixture(async (root) => {
      const out = path.join(root, "dist");
      await mkdir(path.join(out, "tasks"), { recursive: true });
      await writeFile(
        path.join(out, "tasks/cleanup.mjs"),
        `import { defineJob } from ${JSON.stringify(framework)}; export default defineJob({ name: "cleanup", interval: 1000, handler() {} });`,
      );
      const jobs = await loadJobs({
        rootDir: root,
        srcDir: out,
        config: { dir: "tasks" },
      });
      expect(jobs.map((job) => job.name)).toEqual(["cleanup"]);
    });
  });
});
