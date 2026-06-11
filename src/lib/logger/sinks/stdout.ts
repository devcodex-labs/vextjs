import type { LogSink } from "../types.js";

export function createStdoutSink(
  stream: NodeJS.WritableStream = process.stdout,
): LogSink {
  return {
    isTTY: isTTYStream(stream),
    write(line: string): void {
      stream.write(line);
    },
  };
}

function isTTYStream(stream: NodeJS.WritableStream): boolean {
  return Boolean((stream as { isTTY?: boolean }).isTTY);
}
