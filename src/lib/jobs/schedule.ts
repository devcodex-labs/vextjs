import { Cron } from "croner";
import type { VextJobMisfirePolicy, VextJobScheduleConfig } from "./types.js";

export interface ResolveJobDueTimesOptions {
  schedule: VextJobScheduleConfig;
  now?: Date;
  previousTick?: Date;
  defaultTimezone?: string;
  defaultMisfirePolicy?: VextJobMisfirePolicy;
  defaultMaxCatchUp?: number;
}

export function resolveJobDueTimes(options: ResolveJobDueTimesOptions): Date[] {
  const now = options.now ?? new Date();
  const schedule = options.schedule;
  if (schedule.enabled === false) return [];
  if (schedule.startAt && new Date(schedule.startAt).getTime() > now.getTime())
    return [];
  if (schedule.endAt && new Date(schedule.endAt).getTime() < now.getTime())
    return [];

  if (schedule.cron) {
    return resolveCronDueTimes(options);
  }
  if (schedule.interval) {
    return resolveIntervalDueTimes(options);
  }
  return [];
}

export function getNextJobRunTime(options: {
  schedule: VextJobScheduleConfig;
  from?: Date;
  defaultTimezone?: string;
}): Date | undefined {
  const from = options.from ?? new Date();
  const schedule = options.schedule;
  if (schedule.enabled === false) return undefined;
  if (schedule.cron) {
    const cron = new Cron(schedule.cron, {
      paused: true,
      timezone: schedule.timezone ?? options.defaultTimezone,
    });
    const next = cron.nextRun(from);
    return next ?? undefined;
  }
  if (schedule.interval) {
    const start = schedule.startAt ? new Date(schedule.startAt) : from;
    const base = Math.max(start.getTime(), from.getTime());
    return new Date(base + schedule.interval);
  }
  return undefined;
}

function resolveCronDueTimes(options: ResolveJobDueTimesOptions): Date[] {
  const now = options.now ?? new Date();
  const schedule = options.schedule;
  if (!schedule.cron) return [];
  const maxCatchUp = schedule.maxCatchUp ?? options.defaultMaxCatchUp ?? 10;
  const misfirePolicy =
    schedule.misfirePolicy ?? options.defaultMisfirePolicy ?? "skip";
  const cron = new Cron(schedule.cron, {
    paused: true,
    timezone: schedule.timezone ?? options.defaultTimezone,
  });
  const previous = cron
    .previousRuns(Math.max(1, maxCatchUp), now)
    .filter((date) => date.getTime() <= now.getTime());
  const windowStart =
    options.previousTick ??
    new Date(now.getTime() - Math.max(1000, schedule.jitter ?? 0));
  const due = previous.filter((date) => date.getTime() > windowStart.getTime());
  if (misfirePolicy === "catch-up") return due.slice(-maxCatchUp);
  if (misfirePolicy === "fire-once") return due.slice(-1);
  return due.length ? [due[due.length - 1]!] : [];
}

function resolveIntervalDueTimes(options: ResolveJobDueTimesOptions): Date[] {
  const now = options.now ?? new Date();
  const schedule = options.schedule;
  if (!schedule.interval) return [];
  const previousTick =
    options.previousTick ?? new Date(now.getTime() - schedule.interval);
  const start = schedule.startAt ? new Date(schedule.startAt) : previousTick;
  const due: Date[] = [];
  const maxCatchUp = schedule.maxCatchUp ?? options.defaultMaxCatchUp ?? 10;
  let cursor = new Date(start.getTime());
  while (cursor.getTime() <= previousTick.getTime()) {
    cursor = new Date(cursor.getTime() + schedule.interval);
  }
  while (cursor.getTime() <= now.getTime() && due.length < maxCatchUp) {
    due.push(cursor);
    cursor = new Date(cursor.getTime() + schedule.interval);
  }
  const misfirePolicy =
    schedule.misfirePolicy ?? options.defaultMisfirePolicy ?? "skip";
  if (misfirePolicy === "catch-up") return due;
  if (misfirePolicy === "fire-once") return due.slice(-1);
  return due.length ? [due[due.length - 1]!] : [];
}
