import type { BootstrapCommand } from "./bootstrap-config.js";

export type RuntimeMode = "development" | "production" | "test";

export type ConfigProfileSource = "cli" | "env" | "legacy-node-env" | "default";

export interface ResolvedConfigProfile {
  profile: string;
  source: ConfigProfileSource;
  warning?: string;
}

export interface ResolveConfigProfileOptions {
  cliProfile?: string;
  env?: NodeJS.ProcessEnv;
  command?: BootstrapCommand;
  displayCommand?: string;
  defaultProfile?: string;
}

const STANDARD_RUNTIME_MODES = new Set<RuntimeMode>([
  "development",
  "production",
  "test",
]);

const RESERVED_CONFIG_PROFILE_NAMES = new Set([
  "bootstrap",
  "default",
  "local",
]);

export function isStandardRuntimeMode(
  value: string | undefined,
): value is RuntimeMode {
  return STANDARD_RUNTIME_MODES.has(value as RuntimeMode);
}

export function getDefaultRuntimeMode(command?: BootstrapCommand): RuntimeMode {
  switch (command) {
    case "start":
    case "build":
      return "production";
    case "dev":
      return "development";
    case "test":
      return "test";
    default:
      return "development";
  }
}

export function getDefaultConfigProfile(command?: BootstrapCommand): string {
  return getDefaultRuntimeMode(command);
}

export function validateConfigProfileName(
  value: string,
  label = "config profile",
): string {
  const profile = value.trim();
  if (!profile) {
    throw new Error(`[vextjs] ${label} must not be empty.`);
  }
  if (!/^[A-Za-z0-9_-]+$/u.test(profile)) {
    throw new Error(
      `[vextjs] ${label} must be a file basename containing only letters, numbers, "_" or "-", got "${value}".`,
    );
  }
  if (RESERVED_CONFIG_PROFILE_NAMES.has(profile)) {
    throw new Error(`[vextjs] ${label} "${profile}" is reserved.`);
  }
  return profile;
}

export function formatLegacyConfigProfileWarning(
  profile: string,
  command = "start",
): string {
  return (
    `[vextjs] NODE_ENV="${profile}" is treated as a legacy config profile.\n` +
    `[vextjs] Please use "vext ${command} --config ${profile}" or "VEXT_CONFIG=${profile}".`
  );
}

export function resolveConfigProfile(
  options: ResolveConfigProfileOptions = {},
): ResolvedConfigProfile {
  if (options.cliProfile !== undefined) {
    return {
      profile: validateConfigProfileName(options.cliProfile, "--config"),
      source: "cli",
    };
  }

  const env = options.env ?? process.env;
  if (env.VEXT_CONFIG !== undefined) {
    return {
      profile: validateConfigProfileName(env.VEXT_CONFIG, "VEXT_CONFIG"),
      source: "env",
    };
  }

  const nodeEnv = env.NODE_ENV;
  if (nodeEnv && !isStandardRuntimeMode(nodeEnv)) {
    const profile = validateConfigProfileName(
      nodeEnv,
      "legacy NODE_ENV config profile",
    );
    return {
      profile,
      source: "legacy-node-env",
      warning: formatLegacyConfigProfileWarning(
        profile,
        options.displayCommand ?? options.command ?? "start",
      ),
    };
  }

  return {
    profile: validateConfigProfileName(
      options.defaultProfile ?? getDefaultConfigProfile(options.command),
      "default config profile",
    ),
    source: "default",
  };
}

export function printConfigProfileWarning(
  resolved: ResolvedConfigProfile,
  write: (message: string) => void = console.warn,
): void {
  if (resolved.warning) {
    write(resolved.warning);
  }
}
