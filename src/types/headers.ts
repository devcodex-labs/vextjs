/**
 * HTTP header value used by vext internals and public response APIs.
 *
 * `Set-Cookie` is the primary reason arrays are first-class here: it must be
 * emitted as separate header lines and cannot be comma-joined safely.
 */
export type VextHeaderValue = string | string[];

export type VextHeaders = Record<string, VextHeaderValue>;
