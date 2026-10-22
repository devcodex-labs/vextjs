import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { transformSync } from "esbuild";
import type { LoadJobsOptions } from "../../../src/lib/jobs/job-loader.js";

// Native ESM namespaces have data descriptors; Vitest's transformed namespace
// getters are not the transport this runtime contract accepts.
async function loadJobs(options: LoadJobsOptions, repetitions = 1) {
  const loader = pathToFileURL(
    path.join(process.cwd(), "dist/lib/jobs/job-loader.js"),
  ).href;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
    import {loadJobs} from ${JSON.stringify(loader)};
    globalThis.jobSourceSentinel=0;globalThis.jobExportSentinel=0;
    let result;
    try { for(let pass=0;pass<${repetitions};pass++)result={jobs:await loadJobs(${JSON.stringify(options)})}; }
    catch(error) { result={error:error.message}; }
    console.log(JSON.stringify({...result,sourceSentinel:globalThis.jobSourceSentinel,exportSentinel:globalThis.jobExportSentinel}));
  `,
    ],
    { cwd: options.rootDir, timeout: 10000, windowsHide: true },
  );
  const result = JSON.parse(stdout);
  const globals = globalThis as Record<string, unknown>;
  if (Object.hasOwn(globals, "jobSourceSentinel"))
    globals.jobSourceSentinel = result.sourceSentinel;
  if (Object.hasOwn(globals, "jobExportSentinel"))
    globals.jobExportSentinel = result.exportSentinel;
  if (result.error) throw new Error(result.error);
  return result.jobs as { name: string; definition: { cron: string } }[];
}

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "vext-scheduled-loader-"));
  try {
    await writeFile(path.join(root, "package.json"), '{"type":"module"}');
    await mkdir(path.join(root, "node_modules"));
    await symlink(
      process.cwd(),
      path.join(root, "node_modules/vextjs"),
      "junction",
    );
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("scheduled job discovery", () => {
  it("checks outer user exports even when its default resolves through a compiled projection", async () => {
    await fixture(async (root) => {
      const src = path.join(root, "src");
      await mkdir(path.join(src, "jobs"), { recursive: true });
      await mkdir(path.join(src, "definitions"));
      const plain =
        'import {defineJob} from "vextjs";export default defineJob({cron:"* * * * * *",handler(){}});';
      await writeFile(
        path.join(src, "definitions/compiled.cjs"),
        transformSync(plain, {
          format: "cjs",
          platform: "node",
          target: "node20",
          keepNames: true,
        }).code,
      );
      await writeFile(
        path.join(src, "definitions/other.mjs"),
        'import {defineJob} from "vextjs";export const other=defineJob({cron:"* * * * * *",handler(){}});',
      );
      await writeFile(
        path.join(src, "jobs/main.mjs"),
        'export {default} from "../definitions/compiled.cjs";export {other as alias} from "../definitions/other.mjs";',
      );
      await expect(loadJobs({ rootDir: root, srcDir: src })).rejects.toThrow(
        "Job-valued named",
      );
      await writeFile(
        path.join(src, "definitions/other.mjs"),
        "export const other=new Proxy({}, {get(){globalThis.jobExportSentinel++;},ownKeys(){globalThis.jobExportSentinel++;return []}});",
      );
      await expect(loadJobs({ rootDir: root, srcDir: src })).rejects.toThrow(
        /named.*unknown|named.*opaque|Proxy/u,
      );
    });
  });
  it("rejects extra declaration positions before importing any selected module", async () => {
    await fixture(async (root) => {
      const src = path.join(root, "src");
      await mkdir(path.join(src, "jobs"), { recursive: true });
      const file = path.join(src, "jobs/task.cjs");
      const previous = (globalThis as Record<string, unknown>)
        .jobSourceSentinel;
      (globalThis as Record<string, unknown>).jobSourceSentinel = 0;
      try {
        await writeFile(
          file,
          'globalThis.jobSourceSentinel++; const {defineJob}=require("vextjs");function unused(){const {defineJob:nested}=require("vextjs");return nested({cron:"* * * * * *",handler(){}})}module.exports=defineJob({cron:"* * * * * *",handler(){}});',
        );
        await expect(loadJobs({ rootDir: root, srcDir: src })).rejects.toThrow(
          "multiple SDK",
        );
        expect((globalThis as Record<string, unknown>).jobSourceSentinel).toBe(
          0,
        );
      } finally {
        (globalThis as Record<string, unknown>).jobSourceSentinel = previous;
      }
    });
  });
  it("keeps finite default reexports consistent across cold and repeated loads", async () => {
    await fixture(async (root) => {
      const src = path.join(root, "src");
      await mkdir(path.join(src, "jobs"), { recursive: true });
      await mkdir(path.join(src, "definitions"));
      await writeFile(
        path.join(src, "definitions/task.mjs"),
        'import {defineJob as task} from "vextjs";const value=task({cron:"* * * * * *",handler(){}});export default value;',
      );
      await writeFile(
        path.join(src, "jobs/facade.mjs"),
        'export {default} from "../definitions/task.mjs";',
      );
      expect((await loadJobs({ rootDir: root, srcDir: src }, 2))[0]?.name).toBe(
        "facade",
      );
      for (const alias of ["__esModule", '"module.exports"']) {
        await writeFile(
          path.join(src, "jobs/facade.mjs"),
          `export {default,default as ${alias}} from "../definitions/task.mjs";`,
        );
        await expect(loadJobs({ rootDir: root, srcDir: src })).rejects.toThrow(
          "Job-valued named",
        );
      }
    });
  });
  it("never probes user Proxy or brand getter exports while checking named Jobs", async () => {
    await fixture(async (root) => {
      const src = path.join(root, "src");
      await mkdir(path.join(src, "jobs"), { recursive: true });
      (globalThis as Record<string, unknown>).jobExportSentinel = 0;
      const definitions = [
        "export const helper=new Proxy({}, {get(){globalThis.jobExportSentinel++;return false;},ownKeys(){globalThis.jobExportSentinel++;return []}});",
        'export const helper=Object.defineProperty({},Symbol.for("vextjs.job.definition"),{get(){globalThis.jobExportSentinel++;return false}});',
      ];
      for (const [index, helper] of definitions.entries()) {
        const file = path.join(src, `jobs/task${index}.mjs`);
        await writeFile(
          file,
          `import {defineJob} from "vextjs";${helper}export default defineJob({cron:"* * * * * *",handler(){}});`,
        );
        await expect(
          loadJobs({
            rootDir: root,
            srcDir: src,
            config: { include: [`task${index}.mjs`] },
          }),
        ).rejects.toThrow(/Proxy|accessor/u);
      }
      expect((globalThis as Record<string, unknown>).jobExportSentinel).toBe(0);
      delete (globalThis as Record<string, unknown>).jobExportSentinel;
    });
  });
  it("loads CommonJS definitions and gives code docs the same task names and schedules", async () => {
    await fixture(async (root) => {
      const src = path.join(root, "src");
      const jobsDir = path.join(src, "jobs");
      await mkdir(jobsDir, { recursive: true });
      const cjs = JSON.stringify("vextjs");
      await writeFile(
        path.join(jobsDir, "single.cjs"),
        `const { defineJob } = require(${cjs}); module.exports = defineJob({ cron: "* * * * * *", handler() { globalThis.nativeJobRuns++; } });`,
      );
      await writeFile(
        path.join(jobsDir, "multi.cjs"),
        `const { defineJob } = require(${cjs}); function helper(n){return n+1;} module.exports = defineJob({ cron: "*/2 * * * * *", handler() {} });`,
      );
      await writeFile(
        path.join(jobsDir, "named.cjs"),
        `const { defineJob } = require(${cjs}); module.exports = defineJob({ name: "explicit", cron: "* * * * * *", handler() { globalThis.nativeJobRuns++; } });`,
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
        const shape = (name, definition) => ({ name, cron: definition.cron });
        const sort = (items) => items.sort((a, b) => a.name.localeCompare(b.name));
        globalThis.nativeJobRuns = 0;
        for (const job of loaded.filter(job => ["single", "explicit"].includes(job.name))) {
          const scheduler = await createScheduledJobs({config:{},logger:{info(){},debug(){},error(){}}},[job],{rootDir:${JSON.stringify(root)},timers:false,now:()=>new Date(1000)});
          try { scheduler.start(new Date(0)); await scheduler.tick(new Date(1000)); await scheduler.tick(new Date(1000)); }
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
        loaded: { name: string; cron?: string }[];
        documented: { name: string; cron?: string }[];
      };
      expect(loaded.map(({ name }) => name).sort()).toEqual([
        "explicit",
        "multi",
        "single",
      ]);
      expect(documented).toEqual(loaded);
      expect(invocations).toBe(2);
    });
  });

  it("discovers one default and ordinary helpers with custom directory and filters", async () => {
    await fixture(async (root) => {
      const src = path.join(root, "src");
      const tasks = path.join(src, "tasks");
      await mkdir(path.join(tasks, "billing"), { recursive: true });
      await writeFile(
        path.join(tasks, "billing/run.mjs"),
        `import { defineJob } from "vextjs"; export default defineJob({ cron: "* * * * * *", handler() {} }); export function sweep(n){return n+1;}`,
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
      expect(jobs.map((job) => job.name)).toEqual(["billing.run"]);
      expect(jobs.map((job) => job.definition.cron)).toEqual(["* * * * * *"]);
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
        "default is not a finite SDK Job declaration",
      );
      await writeFile(
        file,
        'import {defineJob} from "vextjs"; throw new Error("owned startup failure"); export default defineJob({cron:"* * * * * *",handler(){}});',
      );
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
        `import { defineJob } from "vextjs"; export default defineJob({ name: "cleanup", cron: "* * * * * *", handler() {} });`,
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
