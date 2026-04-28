import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const EXTENSIONS = [".ts", ".js", ".mjs", ".cjs"] as const;

export const CLUSTER_BOOTSTRAP_PATCH_ENV = "VEXT_CLUSTER_BOOTSTRAP_PATCH";

export type BootstrapCommand = "start" | "dev" | "test";

export interface BootstrapConfigContext {
  rootDir: string;
  configDir: string;
  env: string;
  command: BootstrapCommand;
  isBuilt: boolean;
  baseConfig: Readonly<Record<string, unknown>>;
  signal: AbortSignal;
}

export interface BootstrapConfigProvider {
  name: string;
  timeoutMs?: number;
  required?: boolean;
  load(
    ctx: BootstrapConfigContext,
  ): Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
}

export interface BootstrapConfigDefinition {
  providers: BootstrapConfigProvider[];
}

export interface LoadBootstrapConfigOptions {
  rootDir: string;
  configDir: string;
  env: string;
  command: BootstrapCommand;
  isBuilt: boolean;
  baseConfig: Readonly<Record<string, unknown>>;
  processEnv?: NodeJS.ProcessEnv;
}

export function defineBootstrapConfig(
  definition: BootstrapConfigDefinition,
): BootstrapConfigDefinition {
  return definition;
}

function resolveBootstrapConfigFile(configDir: string): string | null {
  for (const ext of EXTENSIONS) {
    const filePath = path.join(configDir, `bootstrap${ext}`);
    if (existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonLike(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((item) => isJsonLike(item));
  }

  if (!isPlainObject(value)) {
    return false;
  }

  return Object.values(value).every((item) => isJsonLike(item));
}

function normalizeDefinition(
  rawExport: unknown,
  filePath: string,
): BootstrapConfigDefinition {
  if (Array.isArray(rawExport)) {
    return { providers: rawExport as BootstrapConfigProvider[] };
  }

  if (
    !rawExport ||
    typeof rawExport !== "object" ||
    !Array.isArray((rawExport as { providers?: unknown[] }).providers)
  ) {
    throw new Error(
      `[vextjs] Bootstrap config file "${filePath}" must export defineBootstrapConfig({ providers: [...] }).`,
    );
  }

  return rawExport as BootstrapConfigDefinition;
}

async function importBootstrapDefinition(
  filePath: string,
): Promise<BootstrapConfigDefinition> {
  const { resolveModuleDefault } = await import("./interop.js");
  const fileUrl = pathToFileURL(filePath).href;
  const mod = (await import(fileUrl)) as Record<string, unknown>;
  const rawExport = resolveModuleDefault<unknown>(mod);
  return normalizeDefinition(rawExport, filePath);
}

async function executeProvider(
  provider: BootstrapConfigProvider,
  ctx: Omit<BootstrapConfigContext, "signal">,
): Promise<Record<string, unknown> | null> {
  if (!provider || typeof provider !== "object") {
    throw new Error("[vextjs] Invalid bootstrap config provider definition.");
  }
  if (!provider.name || typeof provider.name !== "string") {
    throw new Error("[vextjs] Bootstrap config provider must have a non-empty name.");
  }
  if (typeof provider.load !== "function") {
    throw new Error(
      `[vextjs] Bootstrap config provider "${provider.name}" must implement load(ctx).`,
    );
  }

  const timeoutMs = provider.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Provider timeout after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    const patch = await provider.load({
      ...ctx,
      signal: controller.signal,
    });

    if (patch === null || patch === undefined) {
      return null;
    }

    if (!isPlainObject(patch)) {
      throw new Error(
        `[vextjs] Bootstrap config provider "${provider.name}" must return a plain object patch or null.`,
      );
    }

    if (!isJsonLike(patch)) {
      throw new Error(
        `[vextjs] Bootstrap config provider "${provider.name}" returned a non JSON-like patch. Functions, class instances, and symbols are not supported.`,
      );
    }

    return patch;
  } finally {
    clearTimeout(timer);
  }
}

function readInjectedBootstrapConfigPatch(
  processEnv: NodeJS.ProcessEnv | undefined,
): Record<string, unknown> | null {
  const raw = processEnv?.[CLUSTER_BOOTSTRAP_PATCH_ENV];
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[vextjs] Failed to parse ${CLUSTER_BOOTSTRAP_PATCH_ENV}: ${reason}`,
    );
  }

  if (!isPlainObject(parsed) || !isJsonLike(parsed)) {
    throw new Error(
      `[vextjs] ${CLUSTER_BOOTSTRAP_PATCH_ENV} must contain a JSON object patch.`,
    );
  }

  return parsed;
}

export async function loadBootstrapConfigPatch(
  options: LoadBootstrapConfigOptions,
): Promise<Record<string, unknown>> {
  const injectedPatch = readInjectedBootstrapConfigPatch(options.processEnv);
  if (injectedPatch) {
    return injectedPatch;
  }

  const bootstrapFile = resolveBootstrapConfigFile(options.configDir);
  if (!bootstrapFile) {
    return {};
  }

  const definition = await importBootstrapDefinition(bootstrapFile);
  const mergedPatch: Record<string, unknown> = {};

  for (const provider of definition.providers) {
    const required =
      provider.required ?? (options.env === "production" ? true : false);

    try {
      const patch = await executeProvider(provider, {
        rootDir: options.rootDir,
        configDir: options.configDir,
        env: options.env,
        command: options.command,
        isBuilt: options.isBuilt,
        baseConfig: options.baseConfig,
      });

      if (patch) {
        Object.assign(mergedPatch, patch);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const message =
        `[vextjs] Bootstrap config provider "${provider.name}" failed: ${reason}`;

      if (required) {
        throw new Error(message);
      }

      console.warn(`${message} (optional provider, fallback continues)`);
    }
  }

  return mergedPatch;
}

