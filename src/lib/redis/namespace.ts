import { readFileSync } from "node:fs";
import path from "node:path";

export type VextRedisModuleName = "job" | "rate-limit" | "session" | "cache";

export interface VextRedisNamespaceOptions {
  rootDir?: string;
  module: VextRedisModuleName;
  namespace?: string;
  keyPrefix?: string;
  configProfile?: string;
  runtimeMode?: string;
}

const DEFAULT_PROJECT_NAME = "vextjs-app";

export function resolveVextRedisKeyPrefix(
  options: VextRedisNamespaceOptions,
): string {
  const explicitPrefix = normalizeRedisPrefix(options.keyPrefix);
  if (explicitPrefix) return explicitPrefix;

  const namespace = sanitizeRedisNamespace(
    options.namespace ?? createDefaultRedisNamespace(options),
  );
  return `vext:${namespace}:${options.module}:`;
}

export function sanitizeRedisNamespace(value: string): string {
  const sanitized = value
    .trim()
    .replace(/^@+/, "")
    .replace(/[/\\]+/g, ".")
    .replace(/[^A-Za-z0-9_.:-]+/g, "-")
    .replace(/:{2,}/g, ":")
    .replace(/\.{2,}/g, ".")
    .replace(/-+/g, "-")
    .replace(/^[.:-]+|[.:-]+$/g, "");
  return sanitized || DEFAULT_PROJECT_NAME;
}

export function normalizeRedisPrefix(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.endsWith(":") ? trimmed : `${trimmed}:`;
}

function createDefaultRedisNamespace(
  options: VextRedisNamespaceOptions,
): string {
  const projectName =
    readProjectPackageName(options.rootDir) ?? DEFAULT_PROJECT_NAME;
  const profile = options.configProfile ?? process.env.VEXT_CONFIG ?? "default";
  const mode = options.runtimeMode ?? process.env.NODE_ENV ?? "production";
  return `${projectName}:${profile}:${mode}`;
}

function readProjectPackageName(
  rootDir: string | undefined,
): string | undefined {
  if (!rootDir) return undefined;
  try {
    const json = JSON.parse(
      readFileSync(path.join(rootDir, "package.json"), "utf8"),
    ) as { name?: unknown };
    return typeof json.name === "string" && json.name.trim()
      ? json.name
      : undefined;
  } catch {
    return undefined;
  }
}
