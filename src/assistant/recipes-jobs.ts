import {
  RecipeContext,
  RecipeInputError,
  camelName,
  pascalName,
  indent,
} from "./recipe-context.js";
import { defineJob } from "../lib/jobs/define-job.js";
import { getNextJobRunTime } from "../lib/jobs/schedule.js";
import {
  compileStaticSchema,
  type DslDefinition,
} from "../lib/schema-adapter.js";
import { wrappedRequestSchemaLocations } from "../tooling/project-index/request-schema.js";
import type { VextMcpChangeSetFile } from "./change-set.js";

/** Job metadata, payload schema and inferred types share the native runtime contract. */
export function renderJobRecipe(ctx: RecipeContext): VextMcpChangeSetFile[] {
  const schedule = ctx.option<Record<string, unknown>>("schedule", {});
  if (schedule.cron && schedule.interval)
    throw new RecipeInputError("Job schedule must select cron or interval.");
  if (
    ctx.has("schedule") &&
    schedule.enabled !== false &&
    !schedule.cron &&
    !schedule.interval
  )
    throw new RecipeInputError("An enabled schedule needs cron or interval.");
  if (schedule.timezone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: String(schedule.timezone) });
    } catch {
      throw new RecipeInputError("Invalid schedule timezone.");
    }
  }
  const definition: Record<string, unknown> & { name: string } = {
    name: ctx.option("jobName", ctx.name),
    ...Object.fromEntries(
      [
        "payload",
        "queue",
        "schedule",
        "timeout",
        "retry",
        "concurrency",
        "idempotencyKey",
      ]
        .filter((key) => ctx.has(key))
        .map((key) => [key, ctx.options[key]]),
    ),
  };
  try {
    const validated = defineJob({ ...definition, handler() {} });
    if (validated.schedule?.cron)
      getNextJobRunTime({
        schedule: { ...validated.schedule, enabled: true },
        from: new Date("2026-01-01T00:00:00Z"),
      });
  } catch (error) {
    throw new RecipeInputError(String(error));
  }

  const ts = ctx.language("jobs") === "ts";
  const file = ctx.filePath("jobs");
  const files: VextMcpChangeSetFile[] = [];
  let imports = "";
  let typeArgument = "";
  let payloadProperty = "";
  let handlerDoc = "";
  let declaration = "export default ";
  let exportStatement = "";
  if (ctx.has("payload")) {
    const payload = ctx.option<Record<string, unknown>>("payload", {});
    if (wrappedRequestSchemaLocations({ body: payload }).length)
      throw new RecipeInputError(
        "Job payload requires the default validator's DSL field map; a custom validator needs explicit integration.",
        "incomplete",
      );
    try {
      const compiledPayload = compileStaticSchema(payload as DslDefinition);
      if (hasActiveSchedule(schedule) && hasRequiredPayload(compiledPayload)) {
        throw new RecipeInputError(
          "Scheduled jobs are enqueued without payload by the built-in scheduler. Split required-payload work into manual/enqueue jobs, or make the scheduled job derive its input inside the handler.",
          "incomplete",
        );
      }
    } catch (error) {
      if (error instanceof RecipeInputError) throw error;
      throw new RecipeInputError(String(error), "incomplete");
    }
    const schemaFile = ctx
      .filePath("schemas", `${ctx.name}-payload`)
      .replace(/\.[jt]s$/u, ts ? ".ts" : ".js");
    const typeFile = ctx
      .filePath("job-types")
      .replace(/\.[jt]s$/u, ts ? ".ts" : ".js");
    const schemaName = `${camelName(ctx.name)}PayloadSchema`;
    const payloadName = `${pascalName(ctx.name)}Payload`;
    const schemaSource = JSON.stringify(payload, null, 2);
    files.push(
      ctx.file(
        schemaFile,
        ctx.comment(
          "任务运行校验的唯一字段表；载荷类型从此推导。",
          "The single runtime field map; payload types are inferred from this schema.",
        ) +
          `export const ${schemaName} = ${ts ? schemaSource + " as const" : "/** @type {const} */ (" + schemaSource + ")"};\n`,
        "Share one payload schema with the Job runtime and its types.",
      ),
    );
    const schemaImport = ctx.quote(ctx.relative(typeFile, schemaFile));
    files.push(
      ctx.file(
        typeFile,
        ctx.comment(
          "任务载荷契约复用框架推导，不重复声明运行字段。",
          "Infer the Job payload through the framework without duplicating runtime fields.",
        ) +
          (ts
            ? `import type { InferVextValidation } from ${ctx.quote("vextjs")};\nimport type { ${schemaName} } from ${schemaImport};\n\nexport type ${payloadName} = InferVextValidation<{ body: typeof ${schemaName} }>["body"];\n`
            : `/** @typedef {import("vextjs").InferVextValidation<{ body: typeof import(${schemaImport}).${schemaName} }>["body"]} ${payloadName} */\nexport {};\n`),
        "Keep reusable Job payload types in the server Job type role.",
      ),
    );
    imports = `import { ${schemaName} } from ${ctx.quote(ctx.relative(file, schemaFile))};\n`;
    const variable = `${camelName(ctx.name)}Job`;
    exportStatement = `\nexport default ${variable};\n`;
    if (ts) {
      imports += `import type { VextJobDefinition } from ${ctx.quote("vextjs")};\n`;
      declaration = `const ${variable}: VextJobDefinition<${payloadName}> = `;
      imports += `import type { ${payloadName} } from ${ctx.quote(ctx.relative(file, typeFile))};\n`;
      typeArgument = `<${payloadName}>`;
    } else {
      declaration = `/** @type {import("vextjs").VextJobDefinition<import(${ctx.quote(ctx.relative(file, typeFile))}).${payloadName}>} */\nconst ${variable} = `;
      handlerDoc = `  /** @param {import("vextjs").VextJobContext<import(${ctx.quote(ctx.relative(file, typeFile))}).${payloadName}>} ctx */\n`;
    }
    payloadProperty = `\n  payload: ${schemaName},`;
    delete definition.payload;
  }
  const properties = JSON.stringify(definition, null, 2).slice(1, -1).trimEnd();
  const source = `import { defineJob } from ${ctx.quote("vextjs")};\n${imports}\n${ctx.comment("Job handler 必须保持可重试/幂等，并响应 ctx.signal；调度与多进程协调由应用 Job 配置负责。", "Keep Job work retry-safe/idempotent and honor ctx.signal; app Job configuration owns scheduling and process coordination.")}${declaration}defineJob${typeArgument}({${properties},${payloadProperty}\n${handlerDoc}  async handler(ctx) {\n${indent(ctx.option("handler", `ctx.logger.info({ runId: ctx.runId }, ${ctx.quote("Job handler scaffold invoked")});`), 4)}\n  },\n});\n${exportStatement}`;
  ctx.prerequisites.push(
    "Configure config.jobs and choose the scheduler/worker/store for deployment. Multiple processes/hosts require an appropriate shared store; a local memory store cannot coordinate them.",
  );
  ctx.steps.push(
    `Verify manual run, queue processing or schedule triggers for ${definition.name} using the project's actual Job configuration. Scheduled runs receive no payload unless the handler derives input itself. Confirm retry, cancellation and idempotency behavior; MCP starts no processes.`,
  );
  return [
    ...files,
    ...ctx.loaderFacade(
      "jobs",
      ctx.file(
        file,
        source,
        "Create a native Job with typed payload and object-shaped queue/schedule options.",
      ),
    ),
  ];
}

function hasActiveSchedule(schedule: Record<string, unknown>): boolean {
  return (
    schedule.enabled !== false && Boolean(schedule.cron || schedule.interval)
  );
}

function hasRequiredPayload(schema: { required?: unknown }): boolean {
  return (
    Array.isArray(schema.required) &&
    schema.required.some((field) => typeof field === "string")
  );
}
