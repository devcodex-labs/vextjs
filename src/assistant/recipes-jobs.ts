import { RecipeContext, RecipeInputError, indent } from "./recipe-context.js";
import { defineJob } from "../lib/jobs/define-job.js";
import type { VextJobDefinitionInput } from "../lib/jobs/types.js";
import type { VextMcpChangeSetFile } from "./change-set.js";

/** Scaffold the same simple scheduled definition consumed by application startup. */
export function renderJobRecipe(ctx: RecipeContext): VextMcpChangeSetFile[] {
  for (const key of [
    "schedule",
    "queue",
    "payload",
    "timeout",
    "retry",
    "concurrency",
    "idempotencyKey",
    "interval",
  ])
    if (ctx.has(key))
      throw new RecipeInputError(
        `Scheduled Jobs does not support ${key}; use cron and derive business input inside the handler.`,
      );
  const cron = ctx.options.cron;
  if (typeof cron !== "string" || !cron.trim())
    throw new RecipeInputError(
      "Scheduled Jobs requires an explicit cron expression.",
    );
  const definition = {
    name: ctx.option("jobName", ctx.name),
    cron,
    ...Object.fromEntries(
      ["description", "tags", "enabled", "cron", "timezone", "leaseTtl"]
        .filter((key) => ctx.has(key))
        .map((key) => [key, ctx.options[key]]),
    ),
  };
  try {
    defineJob({ ...definition, handler() {} } satisfies VextJobDefinitionInput);
  } catch (error) {
    throw new RecipeInputError(String(error));
  }
  const file = ctx.filePath("jobs");
  const properties = JSON.stringify(definition, null, 2).slice(1, -1).trimEnd();
  const source = `import { defineJob } from ${ctx.quote("vextjs")};\n\n${ctx.comment("随应用就绪后定时执行；自行查询业务数据，并响应 ctx.signal。", "Scheduled after application readiness; derive business input and honor ctx.signal.")}export default defineJob({${properties},\n  async handler(ctx) {\n${indent(ctx.option("handler", `ctx.logger.info({ scheduledAt: ctx.scheduledAt }, ${ctx.quote("Scheduled job invoked")});`), 4)}\n  },\n});\n`;
  ctx.prerequisites.push(
    "Use the same Job definitions in every built-in Cluster worker. Master IPC coordinates one built-in Cluster without Redis; independent applications need shared config.jobs.redis for a shared coordination domain.",
  );
  ctx.steps.push(
    `Verify scheduled execution and overlap skipping for ${definition.name}. No retries, downtime catch-up or immediate startup execution are provided; MCP starts no timers.`,
  );
  return ctx.loaderFacade(
    "jobs",
    ctx.file(file, source, "Create an application-started Cron job."),
  );
}
