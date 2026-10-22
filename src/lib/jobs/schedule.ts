import { Cron } from "croner";
import type { VextJobDefinitionInput } from "./types.js";

/** Croner is the sole calendar authority; every returned point is future. */
export function nextJobTime(
  job: Pick<VextJobDefinitionInput, "cron" | "timezone">,
  from: Date,
  timezone = "UTC",
): Date | null {
  return new Cron(job.cron, {
    paused: true,
    timezone: job.timezone ?? timezone,
  }).nextRun(from);
}
