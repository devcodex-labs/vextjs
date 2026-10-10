import { Cron } from "croner";
import { VextJobDefinitionError } from "./job-errors.js";
import {
  VEXT_JOB_SYMBOL,
  type VextJobDefinition,
  type VextJobDefinitionInput,
} from "./types.js";

export function defineJob(
  definition: VextJobDefinitionInput,
): VextJobDefinition {
  if (
    !definition ||
    typeof definition !== "object" ||
    Array.isArray(definition)
  )
    fail("expects a job definition object");
  const allowed = new Set([
    "name",
    "description",
    "tags",
    "docs",
    "enabled",
    "cron",
    "interval",
    "timezone",
    "handler",
  ]);
  for (const key of Object.keys(definition))
    if (!allowed.has(key)) fail(`does not support "${key}"`);
  if (typeof definition.handler !== "function")
    fail("requires a handler function");
  if (
    definition.name !== undefined &&
    (typeof definition.name !== "string" ||
      !/^[A-Za-z0-9_.:-]+$/u.test(definition.name))
  )
    fail('name must contain letters, numbers, "_", ".", ":" or "-"');
  if (
    definition.enabled !== undefined &&
    typeof definition.enabled !== "boolean"
  )
    fail("enabled must be a boolean");
  for (const key of ["description", "timezone"] as const)
    if (definition[key] !== undefined && typeof definition[key] !== "string")
      fail(`${key} must be a string`);
  if (
    definition.tags !== undefined &&
    (!Array.isArray(definition.tags) ||
      definition.tags.some((tag) => typeof tag !== "string"))
  )
    fail("tags must be an array of strings");
  if ((definition.cron === undefined) === (definition.interval === undefined))
    fail("requires exactly one of cron or interval");
  if (
    definition.interval !== undefined &&
    (!Number.isSafeInteger(definition.interval) || definition.interval < 1)
  )
    fail("interval must be a positive safe integer in milliseconds");
  if (definition.interval !== undefined && definition.timezone !== undefined)
    fail("timezone is only supported with cron");
  validateJobTimezone(definition.timezone);
  if (definition.cron !== undefined) {
    if (typeof definition.cron !== "string" || !definition.cron.trim())
      fail("cron must be a non-empty string");
    try {
      new Cron(definition.cron, {
        paused: true,
        timezone: definition.timezone ?? "UTC",
      });
    } catch (error) {
      fail(
        `invalid cron: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (definition.docs !== undefined) {
    if (
      !definition.docs ||
      typeof definition.docs !== "object" ||
      Array.isArray(definition.docs)
    )
      fail("docs must be an object");
    for (const key of ["summary", "description"] as const)
      if (
        definition.docs[key] !== undefined &&
        typeof definition.docs[key] !== "string"
      )
        fail(`docs.${key} must be a string`);
    if (
      definition.docs.tags !== undefined &&
      (!Array.isArray(definition.docs.tags) ||
        definition.docs.tags.some((tag) => typeof tag !== "string"))
    )
      fail("docs.tags must be an array of strings");
  }
  return Object.freeze({ ...definition, [VEXT_JOB_SYMBOL]: true as const });
}

export function isVextJobDefinition(
  value: unknown,
): value is VextJobDefinition {
  return !!(
    value &&
    typeof value === "object" &&
    (value as VextJobDefinition)[VEXT_JOB_SYMBOL] === true &&
    typeof (value as VextJobDefinition).handler === "function"
  );
}

export function validateJobTimezone(
  timezone: unknown,
  path = "defineJob() timezone",
): void {
  if (timezone === undefined) return;
  if (typeof timezone !== "string" || !timezone.trim())
    throw new VextJobDefinitionError(
      `[vextjs] ${path} must be a non-empty IANA timezone.`,
    );
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    throw new VextJobDefinitionError(
      `[vextjs] ${path}: invalid timezone "${timezone}".`,
    );
  }
}

function fail(message: string): never {
  throw new VextJobDefinitionError(`[vextjs] defineJob() ${message}.`);
}
