import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectProject, inspectDistBuild } from "./utils/detect-project.js";
import { resolveBuildLocation } from "../lib/build/build-location.js";
import { bootstrapJobRuntime } from "../lib/jobs/job-runtime.js";
import { startJobScheduler } from "../lib/jobs/scheduler.js";
import { startJobWorker } from "../lib/jobs/worker.js";
import type { VextJobRuntime } from "../lib/jobs/job-runtime.js";
import {
  failUnknownCliArgument,
  readRequiredOptionValueOrExit,
} from "./utils/command-args.js";
import {
  patchRuntimeSnapshot,
  writeRuntimeSnapshot,
} from "../lib/runtime-snapshot.js";

interface JobCliOptions {
  json?: boolean;
  configProfile?: string;
  outdir?: string;
  source?: boolean;
  payload?: unknown;
  payloadFile?: string;
  limit?: number;
}

export async function jobCommand(args: string[] = []): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printJobHelp();
    return;
  }
  const rest = args.slice(1);
  switch (subcommand) {
    case "list":
      await withRuntime(
        parseJobOptions(rest, false),
        async (runtime, options) => {
          const items = runtime.registry.toJSON();
          if (options.json)
            console.log(JSON.stringify({ jobs: items }, null, 2));
          else if (items.length === 0) console.log("[vextjs] No jobs found.");
          else
            for (const item of items)
              console.log(`${item.name}\t${item.sourceFile}`);
        },
      );
      return;
    case "inspect": {
      const name = rest[0];
      if (!name || name.startsWith("-"))
        throw new Error("[vextjs] vext job inspect requires a job name.");
      await withRuntime(
        parseJobOptions(rest.slice(1), false),
        async (runtime, options) => {
          const job = runtime.registry
            .toJSON()
            .find((item) => item.name === name);
          if (!job) throw new Error(`[vextjs] Unknown job "${name}".`);
          if (options.json) console.log(JSON.stringify(job, null, 2));
          else {
            console.log(`Job: ${job.name}`);
            console.log(`Source: ${job.sourceFile}#${job.exportName}`);
            if (job.description) console.log(`Description: ${job.description}`);
            if (job.tags?.length) console.log(`Tags: ${job.tags.join(", ")}`);
            if (job.timeout) console.log(`Timeout: ${job.timeout}ms`);
            if (job.concurrency) console.log(`Concurrency: ${job.concurrency}`);
            console.log(
              `Payload schema: ${job.hasPayloadSchema ? "yes" : "no"}`,
            );
          }
        },
      );
      return;
    }
    case "run": {
      const name = rest[0];
      if (!name || name.startsWith("-"))
        throw new Error("[vextjs] vext job run requires a job name.");
      await withRuntime(
        parseJobOptions(rest.slice(1), true),
        async (runtime, options) => {
          const result = await runtime.run(name, { payload: options.payload });
          if (options.json) console.log(JSON.stringify(result, null, 2));
          else {
            console.log(
              `[vextjs] job ${result.jobName} ${result.status} in ${result.durationMs}ms (${result.attempts} attempt(s))`,
            );
            if (result.result !== undefined)
              console.log(formatValue(result.result));
            if (result.error) console.error(formatValue(result.error));
          }
          if (result.status !== "success") process.exitCode = 1;
        },
      );
      return;
    }
    case "enqueue": {
      const name = rest[0];
      if (!name || name.startsWith("-"))
        throw new Error("[vextjs] vext job enqueue requires a job name.");
      await withRuntime(
        parseJobOptions(rest.slice(1), true),
        async (runtime, options) => {
          const record = await runtime.enqueue(name, {
            payload: options.payload,
            trigger: "enqueue",
          });
          if (options.json) console.log(JSON.stringify(record, null, 2));
          else
            console.log(
              `[vextjs] enqueued job ${record.jobName} as ${record.id}`,
            );
        },
      );
      return;
    }
    case "runs":
      await withRuntime(
        parseJobOptions(rest, false),
        async (runtime, options) => {
          const runs = await runtime.listRuns({ limit: options.limit ?? 20 });
          if (options.json) console.log(JSON.stringify({ runs }, null, 2));
          else if (runs.length === 0)
            console.log("[vextjs] No job runs found.");
          else
            for (const run of runs)
              console.log(
                `${run.id}\t${run.jobName}\t${run.status}\t${run.trigger}\t${run.createdAt}`,
              );
        },
      );
      return;
    case "status": {
      const runId = rest[0];
      if (!runId || runId.startsWith("-"))
        throw new Error("[vextjs] vext job status requires a run id.");
      await withRuntime(
        parseJobOptions(rest.slice(1), false),
        async (runtime, options) => {
          const run = await runtime.getRun(runId);
          if (!run) throw new Error(`[vextjs] Unknown job run "${runId}".`);
          if (options.json) console.log(JSON.stringify(run, null, 2));
          else console.log(formatValue(run));
        },
      );
      return;
    }
    case "scheduler":
      await runScheduler(parseJobOptions(rest, false));
      return;
    case "worker":
      await runWorker(parseJobOptions(rest, false));
      return;
    default:
      failUnknownCliArgument(subcommand, printJobHelp);
  }
}

async function withRuntime(
  options: JobCliOptions,
  fn: (runtime: VextJobRuntime, options: JobCliOptions) => Promise<void>,
): Promise<void> {
  const runtime = await createCliJobRuntime(options);
  try {
    await fn(runtime, options);
  } finally {
    await runtime.close();
  }
}

async function runWorker(options: JobCliOptions): Promise<void> {
  const rootDir = detectProject(resolve(process.cwd()), {
    allowBuilt: true,
    outDir: options.outdir,
  }).rootDir;
  const runtime = await createCliJobRuntime(options);
  const controller = new AbortController();
  const stop = async () => {
    if (!controller.signal.aborted) controller.abort();
    await patchRuntimeSnapshotSafe(rootDir, {
      runtimeIdentity: { mode: "job-worker", pid: process.pid },
      summary: { state: "stopped" },
      event: { type: "shutdown" },
    });
    await runtime.close();
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  const jobs = runtime.registry.toJSON();
  if (options.json)
    console.log(JSON.stringify({ status: "ready", jobs }, null, 2));
  else
    console.log(
      `[vextjs] job worker ready (${jobs.length} job(s)). Press Ctrl+C to stop.`,
    );
  await writeRuntimeSnapshotSafe(rootDir, {
    runtimeIdentity: { mode: "job-worker", pid: process.pid },
    summary: {
      state: "ready",
      jobs: jobs.length,
      role: "worker",
    },
    events: [{ type: "ready", role: "worker", jobs: jobs.length }],
  });
  await startJobWorker(runtime, { signal: controller.signal });
}

async function runScheduler(options: JobCliOptions): Promise<void> {
  const rootDir = detectProject(resolve(process.cwd()), {
    allowBuilt: true,
    outDir: options.outdir,
  }).rootDir;
  const runtime = await createCliJobRuntime(options);
  const controller = new AbortController();
  const stop = async () => {
    if (!controller.signal.aborted) controller.abort();
    await patchRuntimeSnapshotSafe(rootDir, {
      runtimeIdentity: { mode: "job-scheduler", pid: process.pid },
      summary: { state: "stopped" },
      event: { type: "shutdown" },
    });
    await runtime.close();
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  const jobs = runtime.registry
    .toJSON()
    .filter((job) => job.schedule?.cron || job.schedule?.interval);
  if (options.json)
    console.log(JSON.stringify({ status: "ready", jobs }, null, 2));
  else
    console.log(
      `[vextjs] job scheduler ready (${jobs.length} scheduled job(s)). Press Ctrl+C to stop.`,
    );
  await writeRuntimeSnapshotSafe(rootDir, {
    runtimeIdentity: { mode: "job-scheduler", pid: process.pid },
    summary: {
      state: "ready",
      jobs: jobs.length,
      role: "scheduler",
    },
    events: [{ type: "ready", role: "scheduler", jobs: jobs.length }],
  });
  await startJobScheduler(runtime, { signal: controller.signal });
}

async function writeRuntimeSnapshotSafe(
  rootDir: string,
  input: Omit<Parameters<typeof writeRuntimeSnapshot>[0], "rootDir">,
): Promise<void> {
  try {
    await writeRuntimeSnapshot({ rootDir, ...input });
  } catch (error) {
    console.warn(
      `[vextjs] runtime snapshot write failed: ${(error as Error).message}`,
    );
  }
}

async function patchRuntimeSnapshotSafe(
  rootDir: string,
  input: Omit<Parameters<typeof patchRuntimeSnapshot>[0], "rootDir">,
): Promise<void> {
  try {
    await patchRuntimeSnapshot({ rootDir, ...input });
  } catch (error) {
    console.warn(
      `[vextjs] runtime snapshot update failed: ${(error as Error).message}`,
    );
  }
}

async function createCliJobRuntime(
  options: JobCliOptions,
): Promise<VextJobRuntime> {
  const rootDir = resolve(process.cwd());
  const project = detectProject(rootDir, {
    allowBuilt: true,
    outDir: options.outdir,
  });
  const location = resolveBuildLocation(project.rootDir, options.outdir);
  if (location.failure) throw new Error(`[vextjs] ${location.failure}`);
  const dist = inspectDistBuild(project.rootDir, location.outDir);
  const built = !options.source && project.language === "ts" && dist.valid;
  return bootstrapJobRuntime({
    rootDir: project.rootDir,
    built,
    outDir: location.outDir,
    configProfile: options.configProfile,
    mode: "production",
  });
}

function parseJobOptions(args: string[], allowPayload: boolean): JobCliOptions {
  const options: JobCliOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    switch (arg) {
      case "--json":
        options.json = true;
        break;
      case "--source":
        options.source = true;
        break;
      case "--config": {
        const value = readRequiredOptionValueOrExit(
          args,
          i,
          "--config",
          "profile",
        );
        options.configProfile = value.value;
        i = value.nextIndex;
        break;
      }
      case "--outdir": {
        const value = readRequiredOptionValueOrExit(
          args,
          i,
          "--outdir",
          "directory",
        );
        options.outdir = value.value;
        i = value.nextIndex;
        break;
      }
      case "--payload": {
        if (!allowPayload) failUnknownCliArgument(arg, printJobHelp);
        const value = readRequiredOptionValueOrExit(
          args,
          i,
          "--payload",
          "JSON",
        );
        options.payload = parsePayload(value.value, "--payload");
        i = value.nextIndex;
        break;
      }
      case "--payload-file": {
        if (!allowPayload) failUnknownCliArgument(arg, printJobHelp);
        const value = readRequiredOptionValueOrExit(
          args,
          i,
          "--payload-file",
          "path",
        );
        options.payloadFile = value.value;
        options.payload = parsePayload(
          readFileSync(resolve(value.value), "utf8"),
          "--payload-file",
        );
        i = value.nextIndex;
        break;
      }
      case "--limit": {
        const value = readRequiredOptionValueOrExit(
          args,
          i,
          "--limit",
          "count",
        );
        const parsed = Number(value.value);
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error("[vextjs] --limit must be a positive integer.");
        }
        options.limit = parsed;
        i = value.nextIndex;
        break;
      }
      case "--help":
      case "-h":
        printJobHelp();
        process.exit(0);
      default:
        failUnknownCliArgument(arg, printJobHelp);
    }
  }
  return options;
}

function parsePayload(value: string, source: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(
      `[vextjs] Invalid JSON from ${source}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function formatValue(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function printJobHelp(): void {
  console.log(`
  Usage: vext job <command> [options]

  Commands:
    job list                       List discovered jobs
    job inspect <name>             Show one job definition
    job run <name>                 Execute one job once with the inline runner
    job enqueue <name>             Queue one job run for workers
    job scheduler                  Start the built-in scheduler
    job worker                     Start a polling worker runtime
    job runs                       List recent job runs
    job status <runId>             Show one job run

  Options:
    --json                         Print machine-readable JSON
    --config <profile>             Load src/config/<profile>
    --outdir <dir>                 Use a custom build output directory
    --source                       Read source files even when a valid build exists
    --payload <json>               Payload for job run
    --payload-file <path>          JSON payload file for job run
    --limit <count>                Limit rows for job runs
    -h, --help                     Show this help message

  Examples:
    $ vext job list
    $ vext job inspect billing.closeInvoice
    $ vext job run billing.closeInvoice --payload '{"invoiceId":"i_1"}'
    $ vext job enqueue billing.closeInvoice --payload '{"invoiceId":"i_1"}'
    $ vext job scheduler
    $ vext job worker
    $ vext job runs --limit 10
`);
}
