import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { VextApp } from "../../types/app.js";
import {
  VextJobExecutionError,
  VextJobPayloadValidationError,
} from "./job-errors.js";
import type {
  VextJobRegistry,
  VextJobRunOptions,
  VextJobRunResult,
} from "./types.js";

export interface CreateJobRunnerOptions {
  app: VextApp;
  registry: VextJobRegistry;
}

export function createJobRunner(options: CreateJobRunnerOptions) {
  return {
    run: (jobName: string, runOptions: VextJobRunOptions = {}) =>
      runJob(options.app, options.registry, jobName, runOptions),
  };
}

export async function runJob(
  app: VextApp,
  registry: VextJobRegistry,
  jobName: string,
  options: VextJobRunOptions = {},
): Promise<VextJobRunResult> {
  const loaded = registry.get(jobName);
  if (!loaded) {
    throw new Error(`[vextjs] Unknown job "${jobName}".`);
  }
  const job = loaded.definition;
  const retry = job.retry ?? app.config.jobs?.defaults?.retry;
  const timeoutMs = job.timeout ?? app.config.jobs?.defaults?.timeout;
  const runId = options.runId ?? randomUUID();
  const startedAt = performance.now();
  const maxAttempts = retry === false ? 1 : Math.max(1, retry?.attempts ?? 1);
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;
    const controller = new AbortController();
    const cleanup = linkAbortSignals(controller, options.signal);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs && timeoutMs > 0) {
      timeoutHandle = setTimeout(
        () => controller.abort(new Error("Job timeout")),
        timeoutMs,
      );
    }

    try {
      const payload = validatePayload(
        app,
        loaded.name,
        job.payload,
        options.payload,
      );
      const result = await job.handler({
        app,
        job,
        payload,
        signal: controller.signal,
        attempt,
        runId,
        logger: app.logger.child({ job: loaded.name, runId }),
      });
      return {
        jobName: loaded.name,
        runId,
        status: controller.signal.aborted ? "cancelled" : "success",
        attempts: attempt,
        durationMs: Math.round(performance.now() - startedAt),
        result,
      };
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || controller.signal.aborted) {
        return {
          jobName: loaded.name,
          runId,
          status: controller.signal.aborted ? "timeout" : "failed",
          attempts: attempt,
          durationMs: Math.round(performance.now() - startedAt),
          error:
            error instanceof VextJobPayloadValidationError
              ? error
              : new VextJobExecutionError(loaded.name, runId, error),
        };
      }
      const wait = retryDelay(retry, attempt, error);
      if (wait > 0)
        await delay(wait, undefined, { signal: options.signal }).catch(
          () => undefined,
        );
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      cleanup();
    }
  }

  return {
    jobName: loaded.name,
    runId,
    status: "failed",
    attempts: attempt,
    durationMs: Math.round(performance.now() - startedAt),
    error: new VextJobExecutionError(loaded.name, runId, lastError),
  };
}

function validatePayload(
  app: VextApp,
  jobName: string,
  schema: Record<string, unknown> | undefined,
  payload: unknown,
): unknown {
  if (!schema) return payload;
  const validate = app.getValidator().compile(schema);
  const result = validate(payload ?? {});
  if (!result.valid) {
    throw new VextJobPayloadValidationError(
      `[vextjs] Job "${jobName}" payload validation failed.`,
      result.errors,
    );
  }
  return result.data ?? payload;
}

function retryDelay(retry: unknown, attempt: number, error: unknown): number {
  if (!retry || retry === false || typeof retry !== "object") return 0;
  const value = (
    retry as {
      backoff?: "fixed" | "exponential";
      delay?: number | ((attempt: number, error: unknown) => number);
    }
  ).delay;
  if (typeof value === "function") return Math.max(0, value(attempt, error));
  if (typeof value === "number") {
    const backoff = (retry as { backoff?: "fixed" | "exponential" }).backoff;
    const multiplier =
      backoff === "exponential" ? 2 ** Math.max(0, attempt - 1) : 1;
    return Math.max(0, value * multiplier);
  }
  return 0;
}

function linkAbortSignals(
  controller: AbortController,
  source?: AbortSignal,
): () => void {
  if (!source) return () => undefined;
  if (source.aborted) {
    controller.abort(source.reason);
    return () => undefined;
  }
  const abort = () => controller.abort(source.reason);
  source.addEventListener("abort", abort, { once: true });
  return () => source.removeEventListener("abort", abort);
}
