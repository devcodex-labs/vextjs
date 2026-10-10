import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { loadJobCodeDocs } from "../../../src/lib/docs/sources/job-source.js";
import { describe, expect, it } from "vitest";
import { inspectJobDefinitions } from "../../../src/lib/jobs/job-metadata.js";
import { inferJobName } from "../../../src/lib/jobs/job-name.js";
import { createProjectWatchLayout } from "../../../src/lib/project/layout.js";
import { classifyChange } from "../../../src/lib/dev/change-classifier.js";

describe("static scheduled job metadata", () => {
  it("reads default and named exports, local constants and import aliases without reading handler fields", () => {
    const definitions = inspectJobDefinitions(
      "sample.ts",
      `
      import { defineJob as task } from "vextjs";
      const everyMinute = 60000;
      const privateTask = task({ interval: 1000, handler() {} });
      const main = task({ interval: everyMinute, handler() { const metadata = { name: "wrong", cron: "wrong", timezone: "wrong" }; } });
      export default main;
      export const cleanup = task({ name: "stable", cron: "0 9 * * *", timezone: "UTC", handler() {} });
    `,
    );
    expect(
      definitions.map(({ exportName, definition }) => ({
        exportName,
        definition,
      })),
    ).toEqual([
      { exportName: "default", definition: { interval: 60000 } },
      {
        exportName: "cleanup",
        definition: { name: "stable", cron: "0 9 * * *", timezone: "UTC" },
      },
    ]);
    expect(inferJobName("billing/index.ts", "default")).toBe("billing");
    expect(inferJobName("billing/index.ts", "cleanup")).toBe("billing.cleanup");
  });
  it("preserves unknown metadata rather than evaluating project code", () => {
    expect(
      inspectJobDefinitions(
        "sample.ts",
        `import { defineJob } from "vextjs"; export default defineJob({ interval: computeInterval(), enabled: process.env.ENABLED, handler() {} });`,
      )[0]!.definition,
    ).toEqual({
      interval: { static: "dynamic" },
      enabled: { static: "dynamic" },
    });
  });
  it("reads CommonJS default and named scheduled job exports", () => {
    expect(
      inspectJobDefinitions(
        "single.cjs",
        `const { defineJob } = require("vextjs"); module.exports = defineJob({ interval: 1000, handler() {} });`,
      )[0]?.definition,
    ).toEqual({ interval: 1000 });
    expect(
      inspectJobDefinitions(
        "sample.cjs",
        `
        const { defineJob } = require("vextjs");
        Object.defineProperty(exports, "__esModule", { value: true });
        const interval = 60000;
        exports.default = defineJob({ interval, handler() {} });
        module.exports.daily = defineJob({ cron: "0 9 * * *", handler() {} });
        exports.hourly = defineJob({ interval: 3600000, handler() {} });
      `,
      ).map(({ exportName, definition }) => ({ exportName, definition })),
    ).toEqual([
      { exportName: "default", definition: { interval: 60000 } },
      { exportName: "daily", definition: { cron: "0 9 * * *" } },
      { exportName: "hourly", definition: { interval: 3600000 } },
    ]);
  });
  it("reads namespace imports and CommonJS factory aliases without evaluating require", () => {
    expect(
      inspectJobDefinitions(
        "named.cjs",
        `
      const { defineJob: task } = require("vextjs");
      const vext = require("vextjs");
      exports.first = task({ interval: 1000, handler() {} });
      exports.second = vext.defineJob({ interval: 2000, handler() {} });
      exports.third = require("vextjs").defineJob({ interval: 3000, handler() {} });
    `,
      ).map(({ definition }) => definition.interval),
    ).toEqual([1000, 2000, 3000]);
    expect(
      inspectJobDefinitions(
        "named.mjs",
        `import * as vext from "vextjs"; export default vext.defineJob({ interval: 1000, handler() {} });`,
      )[0]?.definition.interval,
    ).toBe(1000);
  });
  it("documents only exported jobs with their own schedules and docs tags", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vext-scheduled-docs-"));
    try {
      await mkdir(path.join(root, "jobs"));
      await writeFile(
        path.join(root, "jobs", "sample.ts"),
        `
        import { defineJob } from "vextjs";
        const privateTask = defineJob({ interval: 1000, handler() {} });
        export default defineJob({ interval: 60000, docs: { summary: "Default task", tags: ["maintenance"] }, handler() {} });
        export const daily = defineJob({ cron: "0 9 * * *", timezone: "UTC", handler() {} });
      `,
      );
      const items = await loadJobCodeDocs({ srcDir: root, source: true });
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({
        id: "job:sample#default",
        summary: "Default task",
        tags: ["jobs", "maintenance"],
        job: { name: "sample", interval: 60000 },
      });
      expect(items[1]).toMatchObject({
        id: "job:sample.daily#daily",
        job: { name: "sample.daily", cron: "0 9 * * *", timezone: "UTC" },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("cold-restarts default and custom job directories", () => {
    expect(classifyChange("src/jobs/cleanup.ts").action).toBe("cold");
    const root = process.cwd();
    const layout = createProjectWatchLayout(root, {
      jobsDirectory: "tasks",
    });
    expect(
      classifyChange("src/tasks/cleanup.ts", { rootDir: root, ...layout })
        .action,
    ).toBe("cold");
  });
});

it("inherits runtime selection by field and permits explicit Docs overrides", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vext-jobs-doc-inherit-"));
  try {
    await mkdir(path.join(root, "tasks", "_group"), { recursive: true });
    const task = `import {defineJob} from "vextjs"; export default defineJob({interval:1000,handler(){}});`;
    for (const file of [
      "active.ts",
      "excluded.ts",
      "_hidden.ts",
      "_group/task.ts",
    ])
      await writeFile(path.join(root, "tasks", file), task);
    const jobsConfig = {
      dir: "tasks",
      exclude: ["excluded.ts"],
      timezone: "Asia/Shanghai",
    };
    const items = await loadJobCodeDocs({
      srcDir: root,
      jobsConfig,
      source: true,
    });
    expect(items.map((item) => item.job?.name)).toEqual([
      "_group.task",
      "active",
    ]);
    const overridden = await loadJobCodeDocs({
      srcDir: root,
      jobsConfig,
      source: { exclude: [] },
    });
    expect(overridden.map((item) => item.job?.name)).toEqual([
      "_group.task",
      "active",
      "excluded",
    ]);
    expect(
      await loadJobCodeDocs({ srcDir: root, jobsConfig, source: false }),
    ).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("shows opaque field states and bounded re-export definition locations in Docs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vext-jobs-doc-evidence-"));
  try {
    await mkdir(path.join(root, "jobs"));
    await mkdir(path.join(root, "shared"));
    await writeFile(
      path.join(root, "jobs/facade.ts"),
      'export {default} from "../shared/task.js";',
    );
    await writeFile(
      path.join(root, "shared/task.ts"),
      'import {defineJob} from "vextjs"; export default defineJob({name:getName(),interval:1000,handler(){}});',
    );
    const [item] = await loadJobCodeDocs({ srcDir: root, source: true });
    expect(item).toMatchObject({
      sourceFile: "jobs/facade.ts",
      sourceLocation: { file: "shared/task.ts" },
      job: {
        name: null,
        inferredName: "facade",
        interval: 1000,
        parseState: "partial",
        fieldStates: { name: "unknown", enabled: "absent" },
      },
    });
    expect(item?.id).toBe("job-source:jobs/facade.ts#default");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
