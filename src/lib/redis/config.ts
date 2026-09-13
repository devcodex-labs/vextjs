export interface VextRedisTargetConfig {
  url?: string;
  uri?: string;
  keyPrefix?: string;
  namespace?: string;
  client?: unknown;
}

export function resolveRedisUrl(
  config: VextRedisTargetConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return config?.url ?? config?.uri ?? env.VEXT_REDIS_URL ?? env.REDIS_URL;
}

export function redactRedisUrl(value: string | undefined): string | undefined {
  if (!value) return value;
  try {
    const url = new URL(value);
    if (url.password) url.password = "***";
    if (url.username) url.username = "***";
    return url.toString();
  } catch {
    return value.replace(/:\/\/([^:@/]+):([^@/]+)@/, "://***:***@");
  }
}

export function assertRedisTarget(
  config: VextRedisTargetConfig | undefined,
  path: string,
): void {
  if (config?.client) return;
  const url = resolveRedisUrl(config);
  if (!url) {
    throw new Error(
      `[vextjs] ${path} requires a Redis target. Configure ${path}.url or set VEXT_REDIS_URL/REDIS_URL.`,
    );
  }
}
