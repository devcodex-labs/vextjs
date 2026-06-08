import type { LogLevelName } from "./types.js";

export const LEVEL_VALUES: Record<LogLevelName, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Number.POSITIVE_INFINITY,
};

export function normalizeLevel(level: LogLevelName | undefined): LogLevelName {
  const normalized = level ?? "info";
  assertLogLevel(normalized);
  return normalized;
}

export function levelValue(level: LogLevelName): number {
  return LEVEL_VALUES[level];
}

export function isLevelEnabled(
  currentLevelValue: number,
  candidate: LogLevelName,
): boolean {
  return LEVEL_VALUES[candidate] >= currentLevelValue;
}

export function assertLogLevel(level: unknown): asserts level is LogLevelName {
  if (typeof level !== "string" || !(level in LEVEL_VALUES)) {
    throw new Error(
      `[vextjs] logger level must be one of: ${Object.keys(LEVEL_VALUES).join(", ")}, got: "${String(level)}"`,
    );
  }
}
