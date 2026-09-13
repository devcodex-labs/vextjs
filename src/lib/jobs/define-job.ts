import {
  VEXT_JOB_SYMBOL,
  type VextJobDefinition,
  type VextJobDefinitionInput,
} from "./types.js";

export function defineJob<TPayload = unknown, TResult = unknown>(
  definition: VextJobDefinitionInput<TPayload, TResult>,
): VextJobDefinition<TPayload, TResult> {
  if (
    !definition ||
    typeof definition !== "object" ||
    Array.isArray(definition)
  ) {
    throw new Error("[vextjs] defineJob() expects a job definition object.");
  }
  if (typeof definition.handler !== "function") {
    throw new Error("[vextjs] defineJob() requires a handler function.");
  }
  validateOptionalName(definition.name, "name");
  validateOptionalString(definition.description, "description");
  validateOptionalStringArray(definition.tags, "tags");
  validateOptionalPositiveInteger(definition.timeout, "timeout");
  validateOptionalPositiveInteger(definition.concurrency, "concurrency");
  validateOptionalSchedule(definition.schedule);
  validateOptionalQueue(definition.queue);
  if (
    definition.idempotencyKey !== undefined &&
    typeof definition.idempotencyKey !== "string" &&
    typeof definition.idempotencyKey !== "function"
  ) {
    throw new Error(
      "[vextjs] defineJob() idempotencyKey must be a string or function.",
    );
  }
  if (definition.payload !== undefined && !isPlainObject(definition.payload)) {
    throw new Error(
      "[vextjs] defineJob() payload must be a schema object when provided.",
    );
  }
  if (definition.docs !== undefined) {
    if (!isPlainObject(definition.docs)) {
      throw new Error(
        "[vextjs] defineJob() docs must be an object when provided.",
      );
    }
    validateOptionalString(definition.docs.summary, "docs.summary");
    validateOptionalString(definition.docs.description, "docs.description");
    validateOptionalStringArray(definition.docs.tags, "docs.tags");
  }
  if (definition.retry !== undefined && definition.retry !== false) {
    if (!isPlainObject(definition.retry)) {
      throw new Error("[vextjs] defineJob() retry must be false or an object.");
    }
    validateOptionalPositiveInteger(
      definition.retry.attempts,
      "retry.attempts",
    );
    if (
      definition.retry.delay !== undefined &&
      typeof definition.retry.delay !== "number" &&
      typeof definition.retry.delay !== "function"
    ) {
      throw new Error(
        "[vextjs] defineJob() retry.delay must be a number or function.",
      );
    }
    if (
      typeof definition.retry.delay === "number" &&
      definition.retry.delay < 0
    ) {
      throw new Error("[vextjs] defineJob() retry.delay must be >= 0.");
    }
    if (
      definition.retry.backoff !== undefined &&
      definition.retry.backoff !== "fixed" &&
      definition.retry.backoff !== "exponential"
    ) {
      throw new Error(
        '[vextjs] defineJob() retry.backoff must be "fixed" or "exponential".',
      );
    }
  }
  return Object.freeze({
    ...definition,
    [VEXT_JOB_SYMBOL]: true as const,
  });
}

export function isVextJobDefinition(
  value: unknown,
): value is VextJobDefinition {
  return !!(
    value &&
    typeof value === "object" &&
    (value as { [VEXT_JOB_SYMBOL]?: unknown })[VEXT_JOB_SYMBOL] === true &&
    typeof (value as { handler?: unknown }).handler === "function"
  );
}

function validateOptionalName(value: unknown, key: string): void {
  if (value === undefined) return;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`[vextjs] defineJob() ${key} must be a non-empty string.`);
  }
  if (!/^[A-Za-z0-9_.:-]+$/u.test(value)) {
    throw new Error(
      `[vextjs] defineJob() ${key} may only contain letters, numbers, "_", ".", ":" or "-".`,
    );
  }
}

function validateOptionalString(value: unknown, key: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`[vextjs] defineJob() ${key} must be a string.`);
  }
}

function validateOptionalStringArray(value: unknown, key: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`[vextjs] defineJob() ${key} must be an array of strings.`);
  }
}

function validateOptionalPositiveInteger(value: unknown, key: string): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`[vextjs] defineJob() ${key} must be a positive integer.`);
  }
}

function validateOptionalNonNegativeInteger(value: unknown, key: string): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(
      `[vextjs] defineJob() ${key} must be a non-negative integer.`,
    );
  }
}

function validateOptionalSchedule(value: unknown): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    throw new Error("[vextjs] defineJob() schedule must be an object.");
  }
  const schedule = value as {
    enabled?: unknown;
    cron?: unknown;
    interval?: unknown;
    timezone?: unknown;
    startAt?: unknown;
    endAt?: unknown;
    misfirePolicy?: unknown;
    maxCatchUp?: unknown;
    jitter?: unknown;
    singleton?: unknown;
  };
  if (schedule.enabled !== undefined && typeof schedule.enabled !== "boolean") {
    throw new Error("[vextjs] defineJob() schedule.enabled must be a boolean.");
  }
  validateOptionalString(schedule.cron, "schedule.cron");
  validateOptionalPositiveInteger(schedule.interval, "schedule.interval");
  validateOptionalString(schedule.timezone, "schedule.timezone");
  validateOptionalDateLike(schedule.startAt, "schedule.startAt");
  validateOptionalDateLike(schedule.endAt, "schedule.endAt");
  if (
    schedule.misfirePolicy !== undefined &&
    schedule.misfirePolicy !== "skip" &&
    schedule.misfirePolicy !== "fire-once" &&
    schedule.misfirePolicy !== "catch-up"
  ) {
    throw new Error(
      '[vextjs] defineJob() schedule.misfirePolicy must be "skip", "fire-once", or "catch-up".',
    );
  }
  validateOptionalPositiveInteger(schedule.maxCatchUp, "schedule.maxCatchUp");
  validateOptionalNonNegativeInteger(schedule.jitter, "schedule.jitter");
  if (
    schedule.singleton !== undefined &&
    typeof schedule.singleton !== "boolean"
  ) {
    throw new Error(
      "[vextjs] defineJob() schedule.singleton must be a boolean.",
    );
  }
  if (schedule.cron !== undefined && schedule.interval !== undefined) {
    throw new Error(
      "[vextjs] defineJob() schedule cannot define both cron and interval.",
    );
  }
}

function validateOptionalQueue(value: unknown): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    throw new Error("[vextjs] defineJob() queue must be an object.");
  }
  const queue = value as { enabled?: unknown; priority?: unknown };
  if (queue.enabled !== undefined && typeof queue.enabled !== "boolean") {
    throw new Error("[vextjs] defineJob() queue.enabled must be a boolean.");
  }
  validateOptionalNonNegativeInteger(queue.priority, "queue.priority");
}

function validateOptionalDateLike(value: unknown, key: string): void {
  if (value === undefined) return;
  if (value instanceof Date) return;
  if (typeof value !== "string") {
    throw new Error(`[vextjs] defineJob() ${key} must be a Date or string.`);
  }
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`[vextjs] defineJob() ${key} must be a valid date string.`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
