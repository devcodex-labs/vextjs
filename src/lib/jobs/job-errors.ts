export class VextJobDefinitionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VextJobDefinitionError";
  }
}

export class VextJobDuplicateNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VextJobDuplicateNameError";
  }
}

export class VextJobPayloadValidationError extends Error {
  readonly errors: unknown;

  constructor(message: string, errors: unknown) {
    super(message);
    this.name = "VextJobPayloadValidationError";
    this.errors = errors;
  }
}

export class VextJobExecutionError extends Error {
  readonly jobName: string;
  readonly runId: string;
  override readonly cause: unknown;

  constructor(jobName: string, runId: string, cause: unknown) {
    super(
      `[vextjs] Job "${jobName}" failed in run ${runId}: ${formatCause(cause)}`,
    );
    this.name = "VextJobExecutionError";
    this.jobName = jobName;
    this.runId = runId;
    this.cause = cause;
  }
}

export class VextJobShutdownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VextJobShutdownError";
  }
}

function formatCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
