import { describe, expect, it } from "vitest";
import { transformSync } from "esbuild";
import { analyzeJobDeclaration } from "../../../src/lib/jobs/job-declaration.js";

const options = '{cron:"* * * * * *",handler(){}}';
const sdk = 'import { defineJob } from "vextjs";';

describe("finite Jobs declarations", () => {
  it.each([
    `${sdk} export default defineJob(${options});`,
    `${sdk} const job=defineJob(${options}); const alias=job; export default alias;`,
    `${sdk} const job=defineJob(${options}); export {type job}; export type * from "./types.js"; export default job;`,
    `import {defineJob as job} from "vextjs"; export default job(${options});`,
    `import * as sdk from "vextjs"; export default sdk.defineJob(${options});`,
    `const {defineJob}=require("vextjs"); function helper(n){return n+1;} module.exports=defineJob(${options});`,
    `${sdk} export const label="ordinary"; export function helper(n){return n+1;} export default defineJob({cron:getCron(),handler(){}});`,
    `${sdk} function helper(defineJob){return defineJob({});} export default defineJob(${options});`,
  ])("accepts a finite default without evaluating fields: %s", (source) => {
    const fact = analyzeJobDeclaration("job.ts", source);
    expect(fact.state, fact.reason).toBe("known");
    expect(fact.declarationCardinality).toBe(1);
  });

  it.each([
    `${sdk} export default defineJob(${options}); defineJob(${options});`,
    `${sdk} export default defineJob(${options}); function unused(){return defineJob(${options});}`,
    `${sdk} export default defineJob(${options}); function unused(){const {defineJob:nested}=require("vextjs");return nested(${options});}`,
    `${sdk} export default defineJob(${options}); function unused(){const nested=require("vextjs");return nested.defineJob(${options});}`,
    `require=()=>({defineJob:x=>x});const {defineJob}=require("vextjs");module.exports=defineJob(${options});`,
    `({require}=replacement);const {defineJob}=require("vextjs");module.exports=defineJob(${options});`,
    `for(require of replacements){}const {defineJob}=require("vextjs");module.exports=defineJob(${options});`,
    `export {default} from "../definition.js"; export {default as __esModule} from "../definition.js";`,
    `export {default} from "../definition.js"; export {default as "module.exports"} from "../definition.js";`,
    `${sdk} export default true ? defineJob(${options}) : defineJob(${options});`,
    `${sdk} export default (()=>defineJob(${options}))();`,
    `${sdk} const job=defineJob(${options}); export {job}; export default job;`,
    `${sdk} const job=defineJob(${options}); let alias=job; export {alias}; export default job;`,
    `${sdk} const job=defineJob(${options}); let alias;alias=job;export {alias};export default job;`,
    `${sdk} const job=defineJob(${options}); let alias=0;alias=job;export {alias};export default job;`,
    `${sdk} const job=defineJob(${options}); let value=0;value=job;const alias=value;export {alias};export default job;`,
    `${sdk} let job=defineJob(${options}); export default job;`,
    `function defineJob(x){return x;} export default defineJob(${options});`,
    `const sdk=require("vextjs"); const alias=sdk; Object.assign(alias,{defineJob(){}}); module.exports=sdk.defineJob(${options});`,
    `const {defineJob}=require("vextjs"); module.exports=defineJob(${options}); module.exports.helper=()=>1;`,
    `const {defineJob}=require("vextjs"); exports.default=defineJob(${options});`,
    `const {defineJob}=require("vextjs"); module.exports=defineJob(${options}); function later(){module.exports={};}`,
  ])(
    "rejects extra positions, opaque defaults and mutable exports: %s",
    (source) => {
      expect(analyzeJobDeclaration("job.ts", source).state).not.toBe("known");
    },
  );

  it.each([false, true])(
    "normalizes complete CJS transport, minify=%s",
    (minify) => {
      const input = `${sdk} const job=defineJob(${options}); const alias=job; const set=Object.defineProperty; export const label="ordinary"; export function helper(n){set(n,"value",{value:1});return n;} export default alias;`;
      const code = transformSync(input, {
        format: "cjs",
        platform: "node",
        target: "node20",
        keepNames: true,
        minify,
      }).code;
      const fact = analyzeJobDeclaration("job.cjs", code);
      expect(fact.state, fact.reason).toBe("known");
      expect(fact.format).toBe("cjs-projection");
      const extra = transformSync(
        `${sdk} const job=defineJob(${options}); export const extra=defineJob(${options}); export default job;`,
        { format: "cjs", platform: "node", target: "node20", minify },
      ).code;
      expect(analyzeJobDeclaration("job.cjs", extra).reason).toMatch(
        /multiple/u,
      );
    },
  );

  it("does not bless markers or user getters", () => {
    const source = `const {defineJob}=require("vextjs");const job=defineJob(${options});Object.defineProperty(module.exports,"default",{get(){return job;}});module.exports.__esModule=true;`;
    expect(analyzeJobDeclaration("job.cjs", source).state).toBe("unsupported");
  });
  it("rejects a protected export container escaping through a keepNames function body", () => {
    const input = `${sdk} export default defineJob(${options});`;
    const compiled = transformSync(input, {
      format: "cjs",
      platform: "node",
      target: "node20",
      keepNames: true,
    }).code;
    const container = /var (\w+_exports) = \{\};/u.exec(compiled)![1];
    const injection = `var leak=__name(()=>${container},"leak");Object.defineProperty(leak(),"extra",{enumerable:true,get(){throw new Error("getter executed");}});\n`;
    const code = compiled.replace(
      "module.exports =",
      injection + "module.exports =",
    );
    expect(analyzeJobDeclaration("job.cjs", code).state).toBe("unsupported");
  });
  it.each(["({Object}=replacement);", "for(Object of replacements){}"])(
    "rejects overwritten transport intrinsics: %s",
    (prefix) => {
      const code = transformSync(
        `${sdk}export default defineJob(${options});`,
        { format: "cjs", platform: "node", target: "node20" },
      ).code;
      expect(analyzeJobDeclaration("job.cjs", prefix + code).state).toBe(
        "unsupported",
      );
    },
  );

  it.each([false, true])(
    "preserves verified backend binder and default reexport, minify=%s",
    (minify) => {
      const binder =
        'import bind from "../.vext-dependencies.cjs"; bind(module);';
      const code = transformSync(
        `${binder}${sdk}export default defineJob(${options});`,
        { format: "cjs", platform: "node", target: "node20", minify },
      ).code;
      expect(analyzeJobDeclaration("job.cjs", code).state).toBe("unknown");
      const verified = analyzeJobDeclaration("job.cjs", code, {
        verifiedDependencyScope: (value) =>
          value === "../.vext-dependencies.cjs",
      });
      expect(verified.state, verified.reason).toBe("known");
      const shell = transformSync(
        'export {default} from "../definitions/report.js";',
        { format: "cjs", platform: "node", target: "node20", minify },
      ).code;
      const reexport = analyzeJobDeclaration("job.cjs", shell);
      expect(reexport.state, reexport.reason).toBe("known");
      expect(reexport.reexport).toBe("../definitions/report.js");
      expect(reexport.declarationCardinality).toBe(0);
    },
  );
});
