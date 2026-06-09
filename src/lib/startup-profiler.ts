import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface StartupProfileEvent {
  name: string;
  startMs: number;
  durationMs: number;
}

export interface StartupProfileSnapshot {
  enabled: boolean;
  startedAt: string;
  elapsedMs: number;
  events: StartupProfileEvent[];
}

export interface StartupProfiler {
  readonly enabled: boolean;
  time<T>(name: string, action: () => Promise<T>): Promise<T>;
  mark(name: string, durationMs?: number): void;
  toJSON(): StartupProfileSnapshot;
}

export interface StartupProfilerOptions {
  enabled?: boolean;
  now?: () => number;
}

export function createStartupProfiler(
  options: StartupProfilerOptions = {},
): StartupProfiler {
  const enabled = options.enabled === true;
  const now = options.now ?? (() => performance.now());
  const wallClockStartedAt = new Date();
  const startedAt = now();
  const events: StartupProfileEvent[] = [];

  return {
    enabled,
    async time<T>(name: string, action: () => Promise<T>): Promise<T> {
      if (!enabled) {
        return action();
      }
      const eventStart = now();
      try {
        return await action();
      } finally {
        events.push({
          name,
          startMs: roundMs(eventStart - startedAt),
          durationMs: roundMs(now() - eventStart),
        });
      }
    },
    mark(name: string, durationMs = 0): void {
      if (!enabled) return;
      events.push({
        name,
        startMs: roundMs(now() - startedAt),
        durationMs: roundMs(durationMs),
      });
    },
    toJSON(): StartupProfileSnapshot {
      const elapsedMs = enabled ? roundMs(now() - startedAt) : 0;
      return {
        enabled,
        startedAt: wallClockStartedAt.toISOString(),
        elapsedMs,
        events: [...events],
      };
    },
  };
}

export function createStartupProfilerFromEnv(
  env: Record<string, string | undefined>,
): StartupProfiler {
  return createStartupProfiler({
    enabled:
      env.VEXT_STARTUP_PROFILE === "1" ||
      env.VEXT_STARTUP_PROFILE === "true" ||
      Boolean(env.VEXT_STARTUP_PROFILE_JSON),
  });
}

export function formatStartupProfile(profile: StartupProfileSnapshot): string {
  if (!profile.enabled) {
    return "[vext dev] startup profile disabled";
  }

  const lines = [
    `[vext dev] startup profile: total=${profile.elapsedMs}ms`,
    ...profile.events.map(
      (event) =>
        `[vext dev]   ${event.name}: ${event.durationMs}ms @ +${event.startMs}ms`,
    ),
  ];
  return lines.join("\n");
}

export function writeStartupProfileJson(
  filePath: string,
  profile: StartupProfileSnapshot,
): void {
  const absolutePath = resolve(filePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(profile, null, 2)}\n`, "utf-8");
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}
