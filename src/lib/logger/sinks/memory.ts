import type { LogSink } from "../types.js";

export interface MemoryLogSink extends LogSink {
  readonly lines: string[];
  clear(): void;
}

export function createMemoryLogSink(): MemoryLogSink {
  const lines: string[] = [];

  return {
    lines,
    write(line: string): void {
      lines.push(line);
    },
    clear(): void {
      lines.length = 0;
    },
  };
}
