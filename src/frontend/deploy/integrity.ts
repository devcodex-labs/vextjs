import { createHash } from "node:crypto";

export function createSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function createSriSha256(buffer: Buffer): string {
  return `sha256-${createHash("sha256").update(buffer).digest("base64")}`;
}
