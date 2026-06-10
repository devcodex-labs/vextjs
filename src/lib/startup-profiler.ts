import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface StartupProfileEvent {
  name: string;
  startMs: number;
  durationMs: number;
  phase?: string;
  kind?: "event" | "gap";
  detail?: Record<string, unknown>;
}

export interface StartupProfileSnapshot {
  enabled: boolean;
  startedAt: string;
  startedAtMs?: number;
  elapsedMs: number;
  events: StartupProfileEvent[];
}

export interface StartupProfileEventOptions {
  phase?: string;
  kind?: "event" | "gap";
  detail?: Record<string, unknown>;
}

export interface StartupProfileMergeOptions {
  gapThresholdMs?: number;
}

export interface StartupProfiler {
  readonly enabled: boolean;
  time<T>(
    name: string,
    action: () => Promise<T> | T,
    options?: StartupProfileEventOptions,
  ): Promise<T>;
  mark(
    name: string,
    durationMs?: number,
    options?: StartupProfileEventOptions,
  ): void;
  toJSON(): StartupProfileSnapshot;
}

export interface StartupProfilerOptions {
  enabled?: boolean;
  now?: () => number;
  wallClockNow?: () => number;
}

const DEFAULT_GAP_THRESHOLD_MS = 200;

const SUMMARY_PHASE_ORDER = [
  "main/preflight",
  "main/preload",
  "pre-worker-bootstrap",
  "compile",
  "config",
  "i18n",
  "database",
  "plugins",
  "fetch",
  "middleware",
  "services",
  "routes",
  "openapi",
  "listen",
  "onReady",
  "gap",
] as const;

export function createStartupProfiler(
  options: StartupProfilerOptions = {},
): StartupProfiler {
  const enabled = options.enabled === true;
  const now = options.now ?? (() => performance.now());
  const wallClockNow = options.wallClockNow ?? (() => Date.now());
  const wallClockStartedAtMs = wallClockNow();
  const wallClockStartedAt = new Date(wallClockStartedAtMs);
  const startedAt = now();
  const events: StartupProfileEvent[] = [];

  return {
    enabled,
    async time<T>(
      name: string,
      action: () => Promise<T> | T,
      eventOptions: StartupProfileEventOptions = {},
    ): Promise<T> {
      if (!enabled) {
        return await action();
      }
      const eventStart = now();
      try {
        return await action();
      } finally {
        events.push(
          createEvent(
            name,
            eventStart - startedAt,
            now() - eventStart,
            eventOptions,
          ),
        );
      }
    },
    mark(
      name: string,
      durationMs = 0,
      eventOptions: StartupProfileEventOptions = {},
    ): void {
      if (!enabled) return;
      events.push(
        createEvent(name, now() - startedAt, durationMs, eventOptions),
      );
    },
    toJSON(): StartupProfileSnapshot {
      const elapsedMs = enabled ? roundMs(now() - startedAt) : 0;
      return {
        enabled,
        startedAt: wallClockStartedAt.toISOString(),
        startedAtMs: wallClockStartedAtMs,
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

export function mergeStartupProfiles(
  mainProfile: StartupProfileSnapshot,
  workerProfile: StartupProfileSnapshot,
  options: StartupProfileMergeOptions = {},
): StartupProfileSnapshot {
  const canAlign =
    Number.isFinite(mainProfile.startedAtMs) &&
    Number.isFinite(workerProfile.startedAtMs);
  const workerOffsetMs = canAlign
    ? (workerProfile.startedAtMs as number) -
      (mainProfile.startedAtMs as number)
    : 0;

  const mainEvents = mainProfile.events.map((event) => normalizeEvent(event));
  const workerEvents = workerProfile.events.map((event) =>
    normalizeEvent({
      ...event,
      startMs: canAlign ? event.startMs + workerOffsetMs : event.startMs,
    }),
  );
  const events = [...mainEvents, ...workerEvents].sort(compareEvents);
  const alignedWorkerElapsed = canAlign
    ? workerOffsetMs + workerProfile.elapsedMs
    : workerProfile.elapsedMs;
  const elapsedMs = roundMs(
    Math.max(
      mainProfile.elapsedMs,
      alignedWorkerElapsed,
      ...events.map((event) => event.startMs + event.durationMs),
    ),
  );

  return {
    enabled: mainProfile.enabled || workerProfile.enabled,
    startedAt: mainProfile.startedAt,
    startedAtMs: mainProfile.startedAtMs,
    elapsedMs,
    events: insertGaps(events, options.gapThresholdMs),
  };
}

export function formatStartupSummary(profile: StartupProfileSnapshot): string {
  if (!profile.enabled) {
    return "[vext dev] startup summary disabled";
  }

  const phaseTotals = new Map<string, number>();
  for (const event of profile.events) {
    if (!shouldIncludeInSummary(event)) continue;
    const phase = event.phase ?? inferPhase(event.name);
    phaseTotals.set(
      phase,
      roundMs((phaseTotals.get(phase) ?? 0) + event.durationMs),
    );
  }

  const orderedPhases = [
    ...SUMMARY_PHASE_ORDER,
    ...[...phaseTotals.keys()].filter(
      (phase) => !SUMMARY_PHASE_ORDER.includes(phase as any),
    ),
  ];

  const lines = [
    `[vext dev] startup summary total=${formatMs(profile.elapsedMs)}`,
  ];
  for (const phase of orderedPhases) {
    const durationMs = phaseTotals.get(phase);
    if (durationMs === undefined || durationMs <= 0) continue;
    lines.push(`[vext dev]   ${phase.padEnd(22)} ${formatMs(durationMs)}`);
  }

  if (lines.length === 1) {
    lines.push("[vext dev]   no startup events recorded");
  }

  return lines.join("\n");
}

export function formatStartupProfile(profile: StartupProfileSnapshot): string {
  if (!profile.enabled) {
    return "[vext dev] startup profile disabled";
  }

  const lines = [
    `[vext dev] startup profile details: total=${formatMs(profile.elapsedMs)}`,
    ...profile.events.map((event) => {
      const phase = event.phase ?? inferPhase(event.name);
      const kind = event.kind && event.kind !== "event" ? ` ${event.kind}` : "";
      const detail = formatDetail(event.detail);
      return (
        `[vext dev]   ${event.name}: ${formatMs(event.durationMs)} ` +
        `@ +${formatMs(event.startMs)} [${phase}${kind}]${detail}`
      );
    }),
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

function createEvent(
  name: string,
  startMs: number,
  durationMs: number,
  options: StartupProfileEventOptions = {},
): StartupProfileEvent {
  return {
    name,
    startMs: roundMs(startMs),
    durationMs: roundMs(durationMs),
    phase: options.phase ?? inferPhase(name),
    kind: options.kind ?? "event",
    ...(options.detail ? { detail: options.detail } : {}),
  };
}

function normalizeEvent(event: StartupProfileEvent): StartupProfileEvent {
  return {
    ...event,
    startMs: roundMs(event.startMs),
    durationMs: roundMs(event.durationMs),
    phase: event.phase ?? inferPhase(event.name),
    kind: event.kind ?? "event",
  };
}

function insertGaps(
  events: StartupProfileEvent[],
  thresholdMs = DEFAULT_GAP_THRESHOLD_MS,
): StartupProfileEvent[] {
  if (thresholdMs <= 0) {
    return events;
  }

  const boundaryEvents = events.filter(isGapBoundaryEvent).sort(compareEvents);
  const gaps: StartupProfileEvent[] = [];
  let cursorEnd = 0;
  let previous: StartupProfileEvent | undefined;

  for (const next of boundaryEvents) {
    const gapStart = roundMs(cursorEnd);
    const gapDuration = roundMs(next.startMs - cursorEnd);
    if (gapDuration > thresholdMs) {
      gaps.push(
        createGapEvent(gapStart, gapDuration, previous, next, gaps.length),
      );
    }
    cursorEnd = Math.max(cursorEnd, next.startMs + next.durationMs);
    previous = next;
  }

  return [...events, ...gaps].sort(compareEvents);
}

function createGapEvent(
  startMs: number,
  durationMs: number,
  previous: StartupProfileEvent | undefined,
  next: StartupProfileEvent | undefined,
  index: number,
): StartupProfileEvent {
  const crossesIntoWorker =
    next?.name.startsWith("worker.") &&
    (!previous || previous.name.startsWith("main."));
  const phase = crossesIntoWorker ? "pre-worker-bootstrap" : "gap";
  const nextPhase = next ? (next.phase ?? inferPhase(next.name)) : "unknown";
  const name = crossesIntoWorker
    ? "gap.pre-worker-bootstrap"
    : `gap.${toEventNamePart(nextPhase)}.${index + 1}`;

  return createEvent(name, startMs, durationMs, {
    phase,
    kind: "gap",
    detail: {
      previous: previous?.name,
      next: next?.name,
    },
  });
}

function isGapBoundaryEvent(event: StartupProfileEvent): boolean {
  if (event.kind === "gap") return false;
  if (event.phase === "main/worker") return false;
  if (event.name === "main.worker.ready") return false;
  return true;
}

function shouldIncludeInSummary(event: StartupProfileEvent): boolean {
  if (event.phase === "main/worker") return false;
  if (event.name === "main.worker.ready") return false;
  return true;
}

function compareEvents(a: StartupProfileEvent, b: StartupProfileEvent): number {
  return a.startMs - b.startMs || a.name.localeCompare(b.name);
}

function inferPhase(name: string): string {
  if (name.startsWith("gap.pre-worker-bootstrap"))
    return "pre-worker-bootstrap";
  if (name.startsWith("gap.")) return "gap";
  if (name.startsWith("main.preflight")) return "main/preflight";
  if (name.startsWith("main.preloads")) return "main/preload";
  if (name.startsWith("main.worker")) return "main/worker";
  if (name.startsWith("worker.compile")) return "compile";
  if (
    name.startsWith("worker.config") ||
    name.startsWith("worker.portConflict") ||
    name.startsWith("worker.adapter")
  ) {
    return "config";
  }
  if (name.startsWith("worker.i18n") || name.startsWith("worker.schema")) {
    return "i18n";
  }
  if (name.startsWith("worker.builtinPlugin.monsqlize")) return "database";
  if (name.startsWith("worker.plugins")) return "plugins";
  if (name.startsWith("worker.fetch")) return "fetch";
  if (
    name.startsWith("worker.middlewares") ||
    name.startsWith("worker.builtinMiddlewares")
  ) {
    return "middleware";
  }
  if (name.startsWith("worker.services")) return "services";
  if (
    name.startsWith("worker.routes") ||
    name.startsWith("worker.routeManifest")
  ) {
    return "routes";
  }
  if (name.startsWith("worker.openapi")) return "openapi";
  if (
    name.startsWith("worker.listen") ||
    name.startsWith("worker.handler") ||
    name.startsWith("worker.server")
  ) {
    return "listen";
  }
  if (name.startsWith("worker.onReady")) return "onReady";
  return "other";
}

function toEventNamePart(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function formatMs(value: number): string {
  return `${Math.round(value)}ms`;
}

function formatDetail(detail: Record<string, unknown> | undefined): string {
  if (!detail) return "";
  try {
    return ` ${JSON.stringify(detail)}`;
  } catch {
    return "";
  }
}
