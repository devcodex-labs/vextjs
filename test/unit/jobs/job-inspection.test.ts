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
const task = (definition = 'cron: "* * * * * *"') =>
  `import {defineJob} from "vextjs"; export default defineJob({${definition}, handler() {throw new Error("must not run");}});`;
const config = (value = "{}") => `export default ${value};`;

describe("scheduled Jobs static evidence and startup prerequisites", () => {
  it.each([
    { fields: "handler:42", error: "handler" },
    { fields: 'name:"invalid name",handler(){}', error: "name" },
    { fields: 'enabled:"yes",handler(){}', error: "enabled" },
    { fields: 'timezone:"Not/AZone",handler(){}', error: "timezone" },
    { fields: "description:42,handler(){}", error: "description" },
    { fields: "tags:[1],handler(){}", error: "tags" },
    { fields: "docs:{summary:false},handler(){}", error: "docs.summary" },
    { fields: "interval:1000,handler(){}", error: "interval" },
    { fields: "interval:readInterval(),handler(){}", error: "interval" },
    { fields: "leaseTtl:10,handler(){}", error: "leaseTtl" },
    { fields: "", error: "handler" },
  ])(
    "diagnoses $error independently of an opaque Cron",
    ({ fields, error }) => {
      const result = inspect({
        "src/config/default.ts": config(),
        "src/jobs/a.ts": `import {defineJob} from "vextjs";export default defineJob({cron:readCron(),${fields}});`,
      });
      expect(result.jobs[0]?.cron).toBeNull();
      expect(result.jobs[0]?.fieldStates.cron).toBe("unknown");
      expect(result.jobs[0]?.runtimeVerified).toBe(false);
      expect(
        result.issues
          .filter((issue) => issue.severity === "error")
          .map((issue) => issue.message)
          .join("\n"),
      ).toContain(error);
    },
  );
  it("keeps a legitimate opaque schedule unknown without leaking a validation witness", () => {
    const result = inspect({
      "src/config/default.ts": config(),
      "src/jobs/a.ts":
        'import {defineJob} from "vextjs";export default defineJob({cron:readCron(),name:readName(),handler:readHandler()});',
    });
    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual(
      [],
    );
    expect(result.jobs[0]).toMatchObject({
      cron: null,
      name: null,
      runtimeVerified: false,
      fieldStates: { cron: "unknown", name: "unknown", handler: "unknown" },
    });
    expect(result.readiness.projectState).toBe("partial");
    expect(JSON.stringify(result)).not.toContain("* * * * *");
  });
  it("classifies named default helper chains and Job aliases at every default shell", () => {
    for (const facade of [false, true]) {
      const entry =
        task() + ' export {default as helper} from "../shared/barrel.js";';
      const files = {
        "src/config/default.ts": config(),
        "src/jobs/main.ts": facade
          ? 'export {default} from "../shared/definition.js";'
          : entry,
        "src/shared/definition.ts": entry,
        "src/shared/barrel.ts": 'export {default} from "./plain.js";',
        "src/shared/plain.ts": "export default function helper() { return 1; }",
      };
      expect(inspect(files).jobs[0]?.moduleShapeState).toBe("known");
      expect(
        inspect({ ...files, "src/shared/plain.ts": task() }).jobs[0]
          ?.moduleShapeState,
      ).toBe("unsupported");
      const missing = { ...files };
      delete (missing as Record<string, string>)["src/shared/plain.ts"];
      expect(inspect(missing).jobs[0]?.moduleShapeState).toBe("unknown");
    }
    expect(
      inspectJobSource(
        "job.ts",
        task() + 'export {default as other} from "./missing.js";',
      ).moduleShape.state,
    ).toBe("unknown");
    for (const value of ['{label:"ordinary"}', "[1,2,3]"]) {
      expect(
        inspect({
          "src/config/default.ts": config(),
          "src/jobs/main.ts":
            task() + 'export {default as helper} from "../shared/helper.js";',
          "src/shared/helper.ts": `export default ${value};`,
        }).jobs[0]?.moduleShapeState,
      ).toBe("known");
    }
  });
  it("does not mistake an accessor function for the effective handler value", () => {
    const fact = inspectJobSource(
      "job.ts",
      'import {defineJob} from "vextjs";export default defineJob({cron:"* * * * * *",get handler(){throw new Error("must not execute")}});',
    );
    expect(fact.moduleShape.state).toBe("known");
    expect(fact.definitions[0]?.fieldStates.handler).toBe("unknown");
    expect(fact.definitions[0]?.staticState).toBe("partial");
  });
  it("follows finite named helper forwards and rejects a named Job behind a default CJS chain", () => {
    const files = {
      "src/config/default.ts": config(),
      "src/jobs/main.ts":
        task() + 'export {value as helper} from "../shared/barrel.js";',
      "src/shared/barrel.ts": 'export {value} from "./plain.js";',
      "src/shared/plain.ts": 'export const value={label:"ordinary"};',
    };
    expect(inspect(files).jobs[0]?.moduleShapeState).toBe("known");
    expect(
      inspect({
        ...files,
        "src/shared/plain.ts":
          'import {defineJob} from "vextjs";export const value=defineJob({cron:"* * * * * *",handler(){}});',
      }).jobs[0]?.moduleShapeState,
    ).toBe("unsupported");
  });
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
        "name: getName(), cron: getCron(), enabled: getEnabled()",
      ),
    });
    expect(result.jobs[0]).toMatchObject({
      name: null,
      inferredName: "dynamic",
      cron: null,
      enabled: null,
      staticState: "partial",
      fieldStates: { name: "unknown", cron: "unknown", enabled: "unknown" },
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
        `import {defineJob} from "vextjs"; let cron="* * * * *"; cron="* * * * * *"; export default defineJob({cron,handler(){}});`,
      ).definitions[0]?.fieldStates.cron,
    ).toBe("unknown");
  });
  it("resolves bounded imports and default reexports without executing modules", () => {
    const result = inspect({
      "src/config/default.ts": config(),
      "src/jobs/facade.ts": 'export {default} from "../shared/task.js";',
      "src/shared/constants.ts":
        'export const NAME="known-name"; export const CRON="* * * * *";',
      "src/shared/task.ts": `import {defineJob} from "vextjs"; import {NAME,CRON} from "./constants.js"; export default defineJob({name:NAME,cron:CRON,handler(){throw new Error("must not run")}}); export function helper(n){return n+1;}`,
    });
    expect(result.jobs.map((job) => [job.name, job.cron])).toEqual([
      ["known-name", "* * * * *"],
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
            ? 'const {defineJob}=require("vextjs"); module.exports=defineJob({cron:"* * * * * *",handler(){}});'
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
        "src/jobs/a.ts": task('cron:"* * * * * *",enabled:false'),
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
  it("reports expected built-in IPC without treating absent Redis as an error", () => {
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
      expect.arrayContaining(["VEXT_MCP_JOBS_SOURCE_ONLY_GLOB"]),
    );
    expect(result.readiness.runtimeVerified).toBe(false);
    expect(result.readiness.missingPrerequisites.join(" ")).toContain(
      "Master IPC",
    );
    expect(result.config.mode).toBe("production");
  });
  it("diagnoses invalid definitions, timezone/config and duplicate disabled names", () => {
    const result = inspect({
      "src/config/default.ts": config('{jobs:{timezone:"invalid/timezone"}}'),
      "src/jobs/a.ts": task('name:"same",cron:"invalid",enabled:false'),
      "src/jobs/b.ts": task('name:"same",cron:"* * * * * *",enabled:false'),
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
        'import {defineJob} from "vextjs"; export default defineJob({cron:"* * * * * *",handler:123});',
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
