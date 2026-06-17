import { HttpError, VextValidationError } from "../types/errors.js";
import { sanitizeErrorDetails } from "./error-details.js";

export interface NormalizeErrorForResponseOptions {
  requestId?: string;
  status?: number;
  code?: string | number;
  message?: string;
  details?: unknown;
  hideInternalErrors?: boolean;
  expose?: boolean;
  stringAsCode?: boolean;
}

export interface NormalizedErrorResponse {
  error: Error;
  status: number;
  body: Record<string, unknown>;
}

export function normalizeErrorForResponse(
  errorOrStatus: unknown,
  options: NormalizeErrorForResponseOptions = {},
): NormalizedErrorResponse {
  if (errorOrStatus instanceof VextValidationError) {
    return applyErrorOverrides(
      {
        error: errorOrStatus,
        status: 422,
        body: {
          code: 422,
          message: errorOrStatus.message,
          errors: errorOrStatus.errors,
          requestId: options.requestId,
        },
      },
      options,
    );
  }

  if (errorOrStatus instanceof HttpError) {
    const body: Record<string, unknown> = {
      code: errorOrStatus.code ?? errorOrStatus.status,
      message: errorOrStatus.message,
      requestId: options.requestId,
    };
    const details = sanitizeErrorDetails(errorOrStatus.details);
    if (details !== undefined) {
      body.details = details;
    }
    return applyErrorOverrides(
      { error: errorOrStatus, status: errorOrStatus.status, body },
      options,
    );
  }

  if (typeof errorOrStatus === "number") {
    const status = normalizeHttpStatus(errorOrStatus, options.status);
    return applyErrorOverrides(
      {
        error: new Error(defaultErrorMessage(status)),
        status,
        body: {
          code: status,
          message: defaultErrorMessage(status),
          requestId: options.requestId,
        },
      },
      options,
    );
  }

  if (typeof errorOrStatus === "string") {
    const parsedStatus = Number.parseInt(errorOrStatus, 10);
    const status = normalizeHttpStatus(
      Number.isNaN(parsedStatus) ? options.status : parsedStatus,
      options.status,
    );
    return applyErrorOverrides(
      {
        error: new Error(errorOrStatus),
        status,
        body: {
          code:
            Number.isNaN(parsedStatus) && options.stringAsCode
              ? errorOrStatus
              : status,
          message: defaultErrorMessage(status),
          requestId: options.requestId,
        },
      },
      options,
    );
  }

  const error =
    errorOrStatus instanceof Error
      ? errorOrStatus
      : new Error(String(errorOrStatus));
  const status = normalizeHttpStatus(readStatus(error), options.status);
  const hideInternalErrors = options.hideInternalErrors ?? true;
  const expose = options.expose === true;
  const body: Record<string, unknown> = {
    code: status,
    message:
      status >= 500 && hideInternalErrors && !expose
        ? "Internal Server Error"
        : error.message || defaultErrorMessage(status),
    requestId: options.requestId,
  };

  const details = sanitizeErrorDetails(readDetails(error));
  if (details !== undefined) {
    body.details = details;
  }
  if (
    status >= 500 &&
    (hideInternalErrors === false || expose) &&
    error.stack
  ) {
    body.stack = error.stack;
  }

  return applyErrorOverrides({ error, status, body }, options);
}

function applyErrorOverrides(
  normalized: NormalizedErrorResponse,
  options: NormalizeErrorForResponseOptions,
): NormalizedErrorResponse {
  const body = { ...normalized.body };
  if (options.requestId !== undefined) {
    body.requestId = options.requestId;
  }
  if (options.code !== undefined) {
    body.code = options.code;
  }
  if (
    options.message !== undefined &&
    (normalized.status < 500 ||
      options.expose === true ||
      options.hideInternalErrors === false)
  ) {
    body.message = options.message;
  }
  if (options.details !== undefined) {
    const details = sanitizeErrorDetails(options.details);
    if (details !== undefined) {
      body.details = details;
    }
  }
  return {
    error: normalized.error,
    status: normalizeHttpStatus(options.status, normalized.status),
    body,
  };
}

function normalizeHttpStatus(
  value: number | undefined,
  fallback = 500,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < 400 || value > 599) return fallback;
  return Math.trunc(value);
}

function readStatus(error: Error): number | undefined {
  const maybe = error as Error & { status?: unknown; statusCode?: unknown };
  return typeof maybe.status === "number"
    ? maybe.status
    : typeof maybe.statusCode === "number"
      ? maybe.statusCode
      : undefined;
}

function readDetails(error: Error): unknown {
  return (error as Error & { details?: unknown }).details;
}

function defaultErrorMessage(status: number): string {
  switch (status) {
    case 400:
      return "Bad Request";
    case 401:
      return "Unauthorized";
    case 403:
      return "Forbidden";
    case 404:
      return "Not Found";
    case 422:
      return "Validation Failed";
    default:
      return status >= 500 ? "Internal Server Error" : "Request Failed";
  }
}
