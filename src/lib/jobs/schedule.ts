import { Cron } from "croner";
import type { VextJobDefinitionInput } from "./types.js";

/** A strictly future point; interval origins never depend on process startup. */
export function nextJobTime(
  job: Pick<VextJobDefinitionInput, "cron" | "interval" | "timezone">,
  from: Date,
  timezone = "UTC",
): Date | null {
  if (job.interval !== undefined) {
    const next = new Date(
      (Math.floor(from.getTime() / job.interval) + 1) * job.interval,
    );
    return Number.isFinite(next.getTime()) ? next : null;
  }
  return new Cron(job.cron!, {
    paused: true,
    timezone: job.timezone ?? timezone,
  }).nextRun(from);
}
