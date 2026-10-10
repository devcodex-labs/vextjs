import { describe, expect, it } from "vitest";
import { createSourceView } from "../../../src/tooling/source-view/view.js";
import { ASSISTANT_SOURCE_ROOT } from "../../../src/tooling/project-index/analysis-source.js";
import { projectStaticConfig } from "../../../src/tooling/project-index/config-projection.js";
import { inspectStaticJobs } from "../../../src/assistant/jobs-inspection.js";
import { inspectJobSource } from "../../../src/lib/jobs/job-metadata.js";

const rootDir = process.cwd();
function inspect(
  files: Record<string, string>,
  mode: "development" | "production" = "development",
) {
  const view = createSourceView({
    roots: [{ id: ASSISTANT_SOURCE_ROOT, kind: "service", realPath: rootDir }],
    rolePolicyVersion: "jobs-test",
    files: Object.entries(files).map(([path, source]) => ({
      rootId: ASSISTANT_SOURCE_ROOT,
      path,
      role: "source",
      bytes: Buffer.from(source),
    })),
  });
  return inspectStaticJobs(view, projectStaticConfig(view, { mode }), rootDir);
}
const task = (definition = "interval: 1000") =>
  `import {defineJob} from "vextjs"; export default defineJob({${definition}, handler() {throw new Error("must not run");}});`;
const config = (value = "{}") => `export default ${value};`;

describe("scheduled Jobs static evidence and startup prerequisites", () => {
  it("requires framework provenance rather than a factory spelling", () => {
    for (const source of [
      task().replace('"vextjs"', '"./unrelated.js"'),
      "export default defineJob({interval:1000,handler(){}});",
    ]) {
      const result = inspectJobSource("jobs/fake.ts", source);
      expect(result.definitions).toEqual([]);
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });
  it("does not invent names/defaults for opaque fields or mutable constants", () => {
    const result = inspect({
      "src/config/default.ts": config(),
      "src/jobs/dynamic.ts": task(
        "name: getName(), interval: getInterval(), enabled: getEnabled()",
      ),
    });
    expect(result.jobs[0]).toMatchObject({
      name: null,
      inferredName: "dynamic",
      interval: null,
      enabled: null,
      staticState: "partial",
      fieldStates: { name: "unknown", interval: "unknown", enabled: "unknown" },
    });
    expect(result.readiness.projectState).toBe("partial");
    expect(
      result.issues.some(
        (issue) => issue.code === "VEXT_MCP_JOBS_EVIDENCE_INCOMPLETE",
      ),
    ).toBe(true);
    expect(
      inspectJobSource(
        "job.ts",
        `import {defineJob} from "vextjs"; let interval=1000; interval=2000; export default defineJob({interval,handler(){}});`,
      ).definitions[0]?.fieldStates.interval,
    ).toBe("unknown");
  });
  it("resolves bounded immutable imports and default/named re-exports without executing modules", () => {
    const result = inspect({
      "src/config/default.ts": config(),
      "src/jobs/facade.ts": 'export {default, daily} from "../shared/task.js";',
      "src/shared/constants.ts":
        'export const NAME="known-name"; export const INTERVAL=60000;',
      "src/shared/task.ts": `import {defineJob} from "vextjs"; import {NAME,INTERVAL} from "./constants.js"; export default defineJob({name:NAME,interval:INTERVAL,handler(){throw new Error("must not run")}}); export const daily=defineJob({cron:"0 9 * * *",handler(){}});`,
    });
    expect(
      result.jobs.map((job) => [job.name, job.interval, job.cron]),
    ).toEqual([
      ["known-name", 60000, null],
      ["facade.daily", null, "0 9 * * *"],
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.jobs[0]?.definitionFile).toBe("src/shared/task.ts");
  });
  it("reports cyclic, out-of-root and dynamic exports as missing evidence", () => {
    for (const files of [
      {
        "src/jobs/a.ts": 'export {default} from "./b.js";',
        "src/jobs/b.ts": 'export {default} from "./a.js";',
      },
      { "src/jobs/a.ts": 'export {default} from "../../../outside.js";' },
      { "src/jobs/a.ts": "export default makeJob();" },
    ]) {
      const result = inspect({ "src/config/default.ts": config(), ...files });
      expect(result.jobs).toEqual([]);
      expect(result.readiness.projectState).toBe("partial");
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });
  it("shares file matching, including underscore directories and the six module extensions", () => {
    const result = inspect({
      "src/config/default.ts": config(),
      ...Object.fromEntries(
        [
          "_hidden.ts",
          "_group/task.ts",
          "active.cjs",
          "types.d.cts",
          "inactive.test.mjs",
          "view.tsx",
        ].map((file) => [
          `src/jobs/${file}`,
          file.endsWith("cjs")
            ? 'const {defineJob}=require("vextjs"); module.exports=defineJob({interval:1000,handler(){}});'
            : task(),
        ]),
      ),
    });
    expect(result.jobs.map((job) => job.name)).toEqual([
      "_group.task",
      "active",
    ]);
  });
  it("distinguishes absent, globally disabled, individually disabled and configured projects", () => {
    expect(
      inspect({ "src/config/default.ts": config() }).readiness.projectState,
    ).toBe("unknown");
    expect(
      inspect({
        "src/config/default.ts": config(
          "{jobs:{enabled:false},cluster:{enabled:true}}",
        ),
        "src/jobs/a.ts": task(),
      }).readiness.projectState,
    ).toBe("unknown");
    expect(
      inspect({
        "src/config/default.ts": config("{cluster:{enabled:true}}"),
        "src/jobs/a.ts": task("interval:1000,enabled:false"),
      }).issues,
    ).toEqual([]);
    const enabled = inspect({
      "src/config/default.ts": config(),
      "src/jobs/a.ts": task(),
    });
    expect(enabled.readiness).toMatchObject({
      projectState: "enabled",
      runtimeVerified: false,
    });
  });
  it("uses selected deployment mode to diagnose missing Redis and source-only globs", () => {
    const files = {
      "src/config/default.ts": config(),
      "src/config/production.ts": config(
        '{cluster:{enabled:true},jobs:{include:["**/*.ts"]}}',
      ),
      "src/jobs/a.ts": task(),
    };
    expect(inspect(files).issues).toEqual([]);
    const result = inspect(files, "production");
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "VEXT_MCP_JOBS_CLUSTER_REDIS_REQUIRED",
        "VEXT_MCP_JOBS_SOURCE_ONLY_GLOB",
      ]),
    );
    expect(result.readiness.projectState).toBe("partial");
    expect(result.config.mode).toBe("production");
  });
  it("diagnoses invalid definitions, timezone/config and duplicate disabled names", () => {
    const result = inspect({
      "src/config/default.ts": config('{jobs:{timezone:"invalid/timezone"}}'),
      "src/jobs/a.ts": task('name:"same",interval:0,enabled:false'),
      "src/jobs/b.ts": task('name:"same",interval:1000,enabled:false'),
    });
    expect(
      result.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.code),
    ).toEqual(
      expect.arrayContaining([
        "VEXT_MCP_JOBS_CONFIG_INVALID",
        "VEXT_MCP_JOBS_DEFINITION_INVALID",
      ]),
    );
  });
  it("rejects statically known non-function handlers and impossible future points", () => {
    const result = inspect({
      "src/config/default.ts": config(),
      "src/jobs/bad-handler.ts":
        'import {defineJob} from "vextjs"; export default defineJob({interval:1000,handler:123});',
      "src/jobs/impossible.ts": task('cron:"0 0 31 2 *"'),
    });
    expect(
      result.issues.filter(
        (issue) => issue.code === "VEXT_MCP_JOBS_DEFINITION_INVALID",
      ),
    ).toHaveLength(2);
    expect(result.readiness.projectState).toBe("partial");
  });
  it("does not trust a project-defined require function as Node require", () => {
    const result = inspectJobSource(
      "fake.cjs",
      'function require(){return {defineJob: (value)=>value};} const {defineJob}=require("vextjs"); module.exports=defineJob({interval:1000,handler(){}});',
    );
    expect(result.definitions).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it("keeps future-point errors conditional on statically enabled discovery and tasks", () => {
    for (const files of [
      {
        "src/config/default.ts": config(),
        "src/jobs/a.ts": task('cron:"0 0 31 2 *",enabled:readFlag()'),
      },
      {
        "src/config/default.ts": config(
          "{cluster:{enabled:true},jobs:{enabled:readFlag()}}",
        ),
        "src/jobs/a.ts": task("interval:0"),
      },
    ]) {
      const result = inspect(files);
      expect(result.readiness.projectState).toBe("partial");
      expect(
        result.issues.filter((issue) => issue.severity === "error"),
      ).toEqual([]);
    }
  });
  it("diagnoses a known invalid schedule even when handler provenance is opaque", () => {
    const result = inspect({
      "src/config/default.ts": config(),
      "src/jobs/a.ts":
        'import {defineJob} from "vextjs"; export default defineJob({interval:0,handler:readHandler()});',
    });
    expect(result.issues.map((issue) => issue.code)).toContain(
      "VEXT_MCP_JOBS_DEFINITION_INVALID",
    );
  });
  it("never treats a dynamic config provider as proven ready", () => {
    const result = inspect({
      "src/config/default.ts": "export default () => ({jobs:{enabled:true}});",
      "src/jobs/a.ts": task(),
    });
    expect(result.readiness.projectState).toBe("partial");
    expect(result.readiness.missingPrerequisites.length).toBeGreaterThan(0);
  });
});
