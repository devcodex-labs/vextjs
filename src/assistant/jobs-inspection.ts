import path from "node:path";
import type { SourceView } from "../tooling/source-view/types.js";
import { ASSISTANT_SOURCE_ROOT } from "../tooling/project-index/analysis-source.js";
import { StaticModuleGraph } from "../tooling/project-index/static-module-graph.js";
import type { StaticConfigProjection } from "../tooling/project-index/config-projection.js";
import { inspectJobSource } from "../lib/jobs/job-metadata.js";
import { inferJobName } from "../lib/jobs/job-name.js";
import {
  isJobSourceFile,
  resolveJobsDirectory,
} from "../lib/jobs/job-discovery.js";
import { nextJobTime } from "../lib/jobs/schedule.js";
import { defineJob } from "../lib/jobs/define-job.js";
import { validateJobsConfig } from "../lib/config-loader.js";
import type { VextJobDefinitionInput } from "../lib/jobs/types.js";

export function inspectStaticJobs(
  view: SourceView,
  projection: StaticConfigProjection,
  rootDir: string,
) {
  const value: Record<string, unknown> = {};
  const fieldStates: Record<string, string> = {};
  const warnings: string[] = [];
  for (const key of [
    "dir",
    "enabled",
    "include",
    "exclude",
    "timezone",
    "redis",
  ]) {
    const fact = projection.field("jobs." + key);
    fieldStates[key] = fact.state;
    if (fact.state === "known") value[key] = fact.value;
    else if (fact.state !== "absent")
      warnings.push(`jobs.${key}: ${fact.state}; ${fact.reason ?? ""}`);
  }
  const source = projection.sourceFiles.at(-1);
  const issues: {
    code: string;
    severity: "error" | "warning";
    sourceFile?: string;
    message: string;
    recommendedAction: string;
  }[] = [];
  const error = (code: string, message: string, sourceFile = source) =>
    issues.push({
      code,
      severity: "error",
      sourceFile,
      message,
      recommendedAction:
        "Correct the declared Jobs definition/configuration, then verify application startup in the selected deployment mode.",
    });
  const wholeConfig = projection.field("jobs");
  try {
    validateJobsConfig(
      wholeConfig.state === "known" ? wholeConfig.value : value,
      "config.jobs",
    );
  } catch (cause) {
    error("VEXT_MCP_JOBS_CONFIG_INVALID", String(cause));
  }
  let directory = "src/jobs";
  try {
    directory = path
      .relative(
        rootDir,
        resolveJobsDirectory(
          path.join(rootDir, "src"),
          typeof value.dir === "string" ? value.dir : "jobs",
          rootDir,
        ),
      )
      .split(path.sep)
      .join("/");
  } catch (cause) {
    error("VEXT_MCP_JOBS_CONFIG_INVALID", String(cause));
  }
  const selection = {
    include: strings(value.include),
    exclude: strings(value.exclude),
  };
  const files = view
    .list({ rootId: ASSISTANT_SOURCE_ROOT })
    .filter(
      (file) =>
        file.path.startsWith(directory + "/") &&
        isJobSourceFile(path.posix.relative(directory, file.path), selection),
    );
  const graph = files.length ? new StaticModuleGraph(view) : undefined;
  const jobs = files.flatMap((file) => {
    try {
      const inspection = inspectJobSource(
        file.path,
        view.read(file.rootId, file.path)!,
        { graph, rootId: file.rootId },
      );
      warnings.push(...inspection.warnings);
      return inspection.definitions.map((metadata) => {
        const inferredName = inferJobName(
          path.posix.relative(directory, file.path),
          metadata.exportName,
        );
        const name =
          metadata.fieldStates.name === "absent" ||
          (metadata.fieldStates.name === "known" &&
            metadata.definition.name === undefined)
            ? inferredName
            : typeof metadata.definition.name === "string"
              ? metadata.definition.name
              : null;
        return {
          name,
          inferredName,
          sourceFile: file.path,
          exportName: metadata.exportName,
          definitionFile: metadata.definitionFile,
          line: metadata.line,
          fieldStates: metadata.fieldStates,
          staticState: metadata.staticState,
          reasons: metadata.reasons,
          definition: metadata.definition,
          enabled:
            typeof metadata.definition.enabled === "boolean"
              ? metadata.definition.enabled
              : null,
          cron:
            typeof metadata.definition.cron === "string"
              ? metadata.definition.cron
              : null,
          interval:
            typeof metadata.definition.interval === "number"
              ? metadata.definition.interval
              : null,
          timezone:
            typeof metadata.definition.timezone === "string"
              ? metadata.definition.timezone
              : null,
          description:
            typeof metadata.definition.description === "string"
              ? metadata.definition.description
              : null,
          tags: strings(metadata.definition.tags) ?? null,
        };
      });
    } catch (cause) {
      warnings.push(`${file.path}: ${String(cause)}`);
      return [];
    }
  });
  const globallyDisabled = value.enabled === false;
  const discoveryEnabledKnown =
    fieldStates.enabled === "absent" ||
    (fieldStates.enabled === "known" && value.enabled !== false);
  if (discoveryEnabledKnown) {
    const names = new Map<string, string>();
    for (const job of jobs) {
      if (job.name !== null) {
        const previous = names.get(job.name);
        if (previous)
          error(
            "VEXT_MCP_JOBS_DEFINITION_INVALID",
            `Duplicate job name ${job.name}: ${previous} and ${job.sourceFile}. Disabled definitions also require unique names.`,
            job.sourceFile,
          );
        names.set(job.name, job.sourceFile);
      }
      // Validate only known fields; opaque fields remain missing evidence.
      const candidate = Object.fromEntries(
        Object.entries(job.definition).filter(
          ([key]) => job.fieldStates[key] === "known",
        ),
      );
      const scheduleKnown =
        job.fieldStates.cron !== "unknown" &&
        job.fieldStates.interval !== "unknown";
      if (scheduleKnown) {
        try {
          const definition = defineJob({
            ...candidate,
            handler:
              job.fieldStates.handler === "absent"
                ? undefined
                : Object.hasOwn(candidate, "handler")
                  ? candidate.handler
                  : () => {},
          } as unknown as VextJobDefinitionInput);
          if (
            definition.enabled !== false &&
            job.fieldStates.enabled !== "unknown" &&
            job.fieldStates.timezone !== "unknown" &&
            fieldStates.timezone !== "unknown" &&
            fieldStates.timezone !== "invalid" &&
            !nextJobTime(
              definition,
              new Date(),
              typeof value.timezone === "string" ? value.timezone : "UTC",
            )
          ) {
            throw new Error("No representable future scheduled point.");
          }
        } catch (cause) {
          error(
            "VEXT_MCP_JOBS_DEFINITION_INVALID",
            `${job.sourceFile}#${job.exportName}: ${String(cause)}`,
            job.sourceFile,
          );
        }
      }
    }
  }
  const active = jobs.filter(
    (job) => job.enabled !== false && job.fieldStates.enabled !== "unknown",
  );
  const cluster = projection.field("cluster.enabled");
  const prerequisites: string[] = [];
  if (globallyDisabled)
    prerequisites.push(
      "jobs.enabled is false; project scheduling is disabled.",
    );
  else {
    if (!active.length)
      prerequisites.push(
        jobs.length
          ? "No statically known enabled job is present."
          : "No statically proven job definition is present.",
      );
    if (
      discoveryEnabledKnown &&
      cluster.state === "known" &&
      cluster.value === true &&
      active.length &&
      (fieldStates.redis === "absent" ||
        (fieldStates.redis === "known" && value.redis === undefined))
    ) {
      const message =
        "Active scheduled jobs in built-in Cluster require config.jobs.redis; the selected configuration omits it.";
      error("VEXT_MCP_JOBS_CLUSTER_REDIS_REQUIRED", message);
      prerequisites.push(message);
    } else if (cluster.state === "unknown" || cluster.state === "invalid")
      warnings.push(
        `cluster.enabled is ${cluster.state}; Redis prerequisites are not fully known.`,
      );
    prerequisites.push(...warnings);
  }
  if (
    projection.mode === "production" &&
    selection.include?.length &&
    selection.include.every((glob) => /\.(?:ts|mts|cts)$/u.test(glob))
  )
    issues.push({
      code: "VEXT_MCP_JOBS_SOURCE_ONLY_GLOB",
      severity: "warning",
      sourceFile: source,
      message:
        "jobs.include selects only TypeScript source extensions. Globs match actual files; emitted .js/.mjs/.cjs tasks may disappear in production.",
      recommendedAction:
        "Include both source and emitted extensions (for example **/*.{ts,js}), or use the default include. Verify the built task directory; globs are never automatically rewritten.",
    });
  if (!globallyDisabled && warnings.length)
    issues.push({
      code: "VEXT_MCP_JOBS_EVIDENCE_INCOMPLETE",
      severity: "warning",
      sourceFile: source,
      message: warnings.join("\n"),
      recommendedAction:
        "Use explicit immutable defineJob declarations where practical, and verify opaque fields and startup in the host. Static inspection never executes project code.",
    });
  const hasErrors = issues.some((issue) => issue.severity === "error");
  prerequisites.push(
    ...issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => issue.message),
  );
  const state: "enabled" | "partial" | "unknown" = hasErrors
    ? "partial"
    : globallyDisabled
      ? "unknown"
      : warnings.length
        ? "partial"
        : active.length
          ? "enabled"
          : "unknown";
  return {
    jobs,
    fileCount: files.length,
    sourceState: warnings.length ? "partial" : "complete",
    warnings,
    issues,
    config: {
      source: source ?? null,
      profile: projection.profile,
      mode: projection.mode,
      dir: typeof value.dir === "string" ? value.dir : "jobs",
      enabled: value.enabled,
      include: value.include,
      exclude: value.exclude,
      timezone: value.timezone,
      redis: value.redis,
      fieldStates,
    },
    readiness: {
      configuration: { profile: projection.profile, mode: projection.mode },
      activeDeclarationCount: globallyDisabled ? 0 : active.length,
      projectState: state,
      missingPrerequisites: [...new Set(prerequisites)],
      runtimeVerified: false,
      reason:
        state === "enabled"
          ? "Enabled declarations and statically known startup prerequisites were found; host execution is unverified."
          : "Scheduling is disabled, absent, invalid or lacks static evidence. See missing prerequisites and diagnostics.",
    },
  };
}
function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}
