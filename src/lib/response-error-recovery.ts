import type { VextResponse } from "../types/response.js";

interface ResponseErrorRecoveryLogger {
  error(context: Record<string, unknown>, message: string): void;
}

export function discardPendingResponseForError(
  res: VextResponse,
  options: {
    error: unknown;
    logger?: ResponseErrorRecoveryLogger;
  },
): boolean {
  const discarded = res._discardPendingSend?.();
  if (discarded === false && res._isSent()) {
    options.logger?.error(
      { error: toErrorMessage(options.error) },
      "[vextjs] error occurred after the response was already flushed",
    );
    return false;
  }
  return true;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
