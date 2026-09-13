import path from "node:path";
import { finalizeConfig, loadRawConfig } from "../config-loader.js";
import { createApp, type AppInternals } from "../app.js";
import { createAppFetch } from "../app-fetch.js";
import { loadI18n } from "../i18n-loader.js";
import { resolveLocaleDirectory } from "../project/layout.js";
import { loadPlugins } from "../plugin-loader.js";
import {
  createMonSQLizePlugin,
  shouldLoadMonSQLize,
} from "../plugins/monsqlize/index.js";
import { loadServices } from "../service-loader.js";
import { resolveBuildLocation } from "../build/build-location.js";
import type { VextApp, VextConfig } from "../../types/app.js";
import { createJobRegistry } from "./job-registry.js";
import { loadJobs } from "./job-loader.js";
import { createJobRunner } from "./job-runner.js";
import { createJobStore } from "./stores/index.js";
import type {
  VextJobRegistry,
  VextJobRunRecord,
  VextJobRunOptions,
  VextJobRunResult,
  VextJobStore,
} from "./types.js";

export interface BootstrapJobRuntimeOptions {
  rootDir?: string;
  built?: boolean;
  outDir?: string;
  configProfile?: string;
  mode?: "production" | "development" | "test";
  store?: VextJobStore;
}

export interface VextJobRuntime {
  app: VextApp;
  config: VextConfig;
  registry: VextJobRegistry;
  store: VextJobStore;
  enqueue(
    jobName: string,
    options?: VextJobRunOptions,
  ): Promise<VextJobRunRecord>;
  run(jobName: string, options?: VextJobRunOptions): Promise<VextJobRunResult>;
  listRuns(
    options?: Parameters<VextJobStore["listRuns"]>[0],
  ): Promise<VextJobRunRecord[]>;
  getRun(runId: string): Promise<VextJobRunRecord | undefined>;
  close(): Promise<void>;
}

export async function bootstrapJobRuntime(
  options: BootstrapJobRuntimeOptions = {},
): Promise<VextJobRuntime> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const isBuilt = options.built === true;
  const srcDir = isBuilt
    ? resolveBuildLocation(rootDir, options.outDir).outDir
    : path.join(rootDir, "src");
  const rawConfig = await loadRawConfig(path.join(srcDir, "config"), {
    rootDir,
    command: "start",
    isBuilt,
    mode: options.mode ?? "production",
    configProfile: options.configProfile,
  });
  rawConfig._testMode = true;
  rawConfig._runtimeMode = options.mode ?? "production";
  const config = finalizeConfig(rawConfig);
  const { app, internals } = createApp(config);
  await initializeJobApp({ app, internals, config, rootDir, srcDir });
  const jobs = await loadJobs({
    rootDir,
    srcDir,
    config: config.jobs,
  });
  const registry = createJobRegistry(jobs);
  const store =
    options.store ?? createJobStore({ rootDir, config: config.jobs });
  await store.init?.();
  const runner = createJobRunner({ app, registry });
  const runWithRecord = async (
    jobName: string,
    runOptions: VextJobRunOptions = {},
  ) => {
    const loaded = registry.get(jobName);
    if (!loaded) throw new Error(`[vextjs] Unknown job "${jobName}".`);
    const runId = runOptions.runId;
    const existing = runId ? await store.getRun(runId) : undefined;
    const record =
      existing ??
      (await store.enqueueRun({
        id: runId,
        jobName,
        payload: runOptions.payload,
        trigger: runOptions.trigger ?? "manual",
        scheduledAt: runOptions.scheduledAt,
        idempotencyKey: resolveIdempotencyKey(
          jobName,
          loaded.definition,
          runOptions.payload,
        ),
      }));
    const result = await runner.run(jobName, {
      ...runOptions,
      runId: record.id,
      payload: runOptions.payload ?? record.payload,
    });
    await store.completeRun(record.id, {
      status: result.status,
      attempts: result.attempts,
      durationMs: result.durationMs,
      finishedAt: new Date().toISOString(),
      result: result.result,
      error: result.error ? formatError(result.error) : undefined,
    });
    return result;
  };
  return {
    app,
    config,
    registry,
    store,
    enqueue: async (jobName, runOptions = {}) => {
      const loaded = registry.get(jobName);
      if (!loaded) throw new Error(`[vextjs] Unknown job "${jobName}".`);
      return store.enqueueRun({
        id: runOptions.runId,
        jobName,
        payload: runOptions.payload,
        trigger: runOptions.trigger ?? "enqueue",
        scheduledAt: runOptions.scheduledAt,
        idempotencyKey:
          runOptions.idempotencyKey ??
          resolveIdempotencyKey(jobName, loaded.definition, runOptions.payload),
        priority: loaded.definition.queue?.priority,
      });
    },
    run: runWithRecord,
    listRuns: (options) => store.listRuns(options),
    getRun: (runId) => store.getRun(runId),
    close: async () => {
      await store.close?.();
      await internals.shutdown(undefined, { skipExit: true });
    },
  };
}

function resolveIdempotencyKey(
  jobName: string,
  definition: { idempotencyKey?: unknown },
  payload: unknown,
): string | undefined {
  const key = definition.idempotencyKey;
  if (typeof key === "string") return key;
  if (typeof key === "function") {
    const value = key({ jobName, payload });
    return value == null ? undefined : String(value);
  }
  return undefined;
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

async function initializeJobApp(options: {
  app: VextApp;
  internals: AppInternals;
  config: VextConfig;
  rootDir: string;
  srcDir: string;
}): Promise<void> {
  const { app, internals, config, rootDir, srcDir } = options;
  const localeLayout = resolveLocaleDirectory(
    rootDir,
    srcDir,
    config.locale?.directory,
  );
  await loadI18n(app, localeLayout.directory, {
    rootDir,
    compiled: localeLayout.compiled,
  });

  if (shouldLoadMonSQLize(config as unknown as Record<string, unknown>)) {
    const monsqlizePlugin = createMonSQLizePlugin(srcDir, rootDir);
    internals.enterPluginSetup();
    try {
      await monsqlizePlugin.setup(app, {
        signal: new AbortController().signal,
      });
    } finally {
      internals.exitPluginSetup();
    }
  }

  app.fetch = createAppFetch(
    app,
    app.hooks as Parameters<typeof createAppFetch>[1],
  ) as unknown as VextApp["fetch"];

  internals.enterPluginSetup();
  try {
    await loadPlugins(app, path.join(srcDir, "plugins"));
  } finally {
    internals.exitPluginSetup();
  }

  await loadServices(app, path.join(srcDir, "services"), { rootDir });
  internals.lockUse();
}
