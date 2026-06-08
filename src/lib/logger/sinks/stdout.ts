import type { LogSink } from "../types.js";

export function createStdoutSink(
  stream: NodeJS.WritableStream = process.stdout,
): LogSink {
  return {
    write(line: string): void {
      stream.write(line);
    },
  };
}
