import type { TimestampMode } from "./types.js";
import { quote } from "./utils-json.js";

export function appendTimestampString(
  line: string,
  mode: TimestampMode,
): string {
  if (mode === "none") {
    return line;
  }

  if (mode === "iso") {
    return `${line},"time":${quote(new Date().toISOString())}`;
  }

  return `${line},"time":${Date.now()}`;
}

export function formatPrettyTime(value: unknown): string {
  const date =
    typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : new Date();

  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().replace("T", " ").replace("Z", "");
  }

  return date.toISOString().replace("T", " ").replace("Z", "");
}
