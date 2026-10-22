import { createHash } from "node:crypto";
import { resolveRedisUrl } from "../redis/config.js";
import { resolveVextRedisKeyPrefix } from "../redis/namespace.js";
import type { VextJobsConfig, VextLoadedJob } from "./types.js";

export const JOBS_PROTOCOL_VERSION = 1;
export interface ManifestJob {
  name: string;
  enabled: boolean;
  cron: string;
  timezone: string;
  leaseTtl?: number;
}
export interface JobsManifest {
  version: 1;
  globalEnabled: boolean;
  mode: "local" | "ipc" | "redis";
  jobs: ManifestJob[];
  redis?: { target: string | null; keyPrefix: string };
  digest: string;
}
export interface JobsIdentity {
  epoch: string;
  generation: string;
  slot: number;
}
export interface JobsPacket extends Partial<JobsIdentity> {
  type: string;
  version: 1;
  activationId?: string;
  manifestDigest?: string;
  requestId?: string;
  job?: string;
  scheduledAt?: number;
  token?: string;
  reason?: string;
}

function sealManifest(value: Omit<JobsManifest, "digest">): JobsManifest {
  return {
    ...value,
    digest: createHash("sha256").update(JSON.stringify(value)).digest("hex"),
  };
}

/** Documentation text is excluded; only effective scheduling/coordination facts participate. */
export function createJobsManifest(
  definitions: VextLoadedJob[],
  config: VextJobsConfig | undefined,
  rootDir: string,
  builtin: boolean,
): JobsManifest {
  const redis = config?.redis;
  let target: string | null = null;
  if (redis && !redis.client) {
    const url = resolveRedisUrl(redis);
    if (url) {
      try {
        const parsed = new URL(url);
        target = `${parsed.protocol}//${parsed.hostname}:${parsed.port || "6379"}${!parsed.pathname || parsed.pathname === "/" ? "/0" : parsed.pathname}`;
      } catch {
        /* No enabled Jobs must not connect or resolve an invalid endpoint. */
      }
    }
  }
  return sealManifest({
    version: JOBS_PROTOCOL_VERSION,
    globalEnabled: config?.enabled !== false,
    mode: redis ? "redis" : builtin ? "ipc" : "local",
    jobs: definitions
      .map((job) => ({
        name: job.name,
        enabled: config?.enabled !== false && job.definition.enabled !== false,
        cron: job.definition.cron.trim().replace(/\s+/gu, " "),
        timezone: job.definition.timezone ?? config?.timezone ?? "UTC",
        ...(redis
          ? { leaseTtl: job.definition.leaseTtl ?? redis.leaseTtl ?? 30000 }
          : {}),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    ...(redis
      ? {
          redis: {
            target,
            keyPrefix: resolveVextRedisKeyPrefix({
              ...redis,
              rootDir,
              module: "job",
            }),
          },
        }
      : {}),
  });
}

export function validateJobsManifest(value: unknown): value is JobsManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value as JobsManifest;
  if (
    manifest.version !== 1 ||
    typeof manifest.globalEnabled !== "boolean" ||
    !["local", "ipc", "redis"].includes(manifest.mode) ||
    !Array.isArray(manifest.jobs) ||
    manifest.jobs.length > 2048
  )
    return false;
  const names = new Set<string>();
  for (const job of manifest.jobs) {
    if (
      !job ||
      typeof job.name !== "string" ||
      job.name.length > 512 ||
      !/^[A-Za-z0-9_.:-]+$/u.test(job.name) ||
      names.has(job.name) ||
      typeof job.enabled !== "boolean" ||
      typeof job.cron !== "string" ||
      job.cron.length > 1024 ||
      typeof job.timezone !== "string" ||
      job.timezone.length > 128 ||
      (manifest.mode === "redis" &&
        (!Number.isSafeInteger(job.leaseTtl) || job.leaseTtl! < 1000))
    )
      return false;
    names.add(job.name);
  }
  if ((manifest.mode === "redis") !== !!manifest.redis) return false;
  if (
    manifest.redis &&
    (typeof manifest.redis.keyPrefix !== "string" ||
      manifest.redis.keyPrefix.length > 4096 ||
      (manifest.redis.target !== null &&
        (typeof manifest.redis.target !== "string" ||
          manifest.redis.target.length > 4096)))
  )
    return false;
  const { digest, ...core } = manifest;
  return digest === sealManifest(core).digest;
}

export function isJobsPacket(value: unknown): value is JobsPacket {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const packet = value as JobsPacket;
  return (
    packet.version === 1 &&
    typeof packet.type === "string" &&
    packet.type.startsWith("jobs:") &&
    packet.type.length <= 48 &&
    [
      packet.requestId,
      packet.token,
      packet.activationId,
      packet.epoch,
      packet.generation,
    ].every(
      (item) =>
        item === undefined ||
        (typeof item === "string" && item.length > 0 && item.length <= 128),
    ) &&
    (packet.job === undefined ||
      (typeof packet.job === "string" && packet.job.length <= 512)) &&
    (packet.scheduledAt === undefined ||
      (Number.isSafeInteger(packet.scheduledAt) && packet.scheduledAt >= 0))
  );
}
