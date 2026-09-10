import {
  lstatSync,
  mkdirSync,
  opendirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { assertRealPathInside } from "../path-boundary.js";
import { readProjectFile } from "./read-project-file.js";
import {
  listenOwnerEndpoint,
  ownerRegistryDirectory,
  ProjectOwnerError,
  requestOwnerEndpoint,
} from "./owner-endpoint.js";

export interface OwnerIdentity {
  protocolVersion: 1;
  realRoot: string;
  instanceId: string;
  pid: number;
  processStartIdentity: string;
  producerVersion: string;
  purpose: "dev" | "build" | "typegen" | "worker";
}

export interface OwnerRecord {
  identity: OwnerIdentity;
  participants: OwnerIdentity[];
  /** 真实输出路径；登记与重叠检查在同一个registry互斥中提交。 */
  outputs?: string[];
}

const MAX_REGISTRY_BYTES = 1024 * 1024;
const REGISTRY_TEMPORARY_PATTERN =
  /^registry\.json\.([0-9a-f]{64})\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/u;
const LEGACY_REGISTRY_TEMPORARY_PATTERN =
  /^registry\.json\.[0-9a-f-]{36}\.tmp$/u;

function registryDigest(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** 仅由已持有registry互斥的调用点使用；名字和原字节共同证明可回收候选。 */
function removeVerifiedRegistryTemporary(
  directory: string,
  name: string,
  digest: string,
): void {
  const bytes = readProjectFile(directory, name, MAX_REGISTRY_BYTES);
  if (bytes === null) return;
  if (registryDigest(bytes) !== digest)
    throw new Error("candidate content differs from its recorded digest");
  const file = path.join(directory, name);
  assertRealPathInside(directory, file, "owner registry temporary");
  rmSync(file);
}

function preserveRegistryTemporary(
  directory: string,
  name: string,
  reason: unknown,
): void {
  console.warn(
    `[vextjs] Preserved unverified owner registry temporary ${path.join(directory, name)}: ${String(reason)}`,
  );
}

function recoverRegistryTemporaries(directory: string): void {
  const entries = opendirSync(directory);
  let examined = 0;
  try {
    for (let scanned = 0; scanned < 65_536; scanned++) {
      const entry = entries.readSync();
      if (!entry) return;
      const candidate = REGISTRY_TEMPORARY_PATTERN.exec(entry.name);
      const legacy = LEGACY_REGISTRY_TEMPORARY_PATTERN.test(entry.name);
      if (!candidate && !legacy) continue;
      if (examined === 16) {
        console.warn(
          "[vextjs] Owner registry temporary recovery reached its batch limit; remaining files are retained for inspection or a later operation.",
        );
        return;
      }
      examined++;
      if (!candidate) {
        preserveRegistryTemporary(
          directory,
          entry.name,
          "legacy candidate has no content digest",
        );
        continue;
      }
      try {
        removeVerifiedRegistryTemporary(directory, entry.name, candidate[1]!);
      } catch (error) {
        preserveRegistryTemporary(directory, entry.name, error);
      }
    }
    console.warn(
      "[vextjs] Owner registry recovery reached its directory entry limit; uninspected files are retained.",
    );
  } finally {
    entries.closeSync();
  }
}

export function identityKey(identity: OwnerIdentity): string {
  return identity.purpose === "worker"
    ? `writer:${identity.realRoot}:${identity.instanceId}`
    : `root:${identity.realRoot}`;
}

export function isOwnerIdentity(value: unknown): value is OwnerIdentity {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.protocolVersion === 1 &&
    typeof record.realRoot === "string" &&
    record.realRoot.length <= 4096 &&
    path.isAbsolute(record.realRoot) &&
    !record.realRoot.includes("\0") &&
    typeof record.instanceId === "string" &&
    /^[0-9a-f-]{36}$/u.test(record.instanceId) &&
    Number.isSafeInteger(record.pid) &&
    (record.pid as number) > 0 &&
    typeof record.processStartIdentity === "string" &&
    record.processStartIdentity.length > 0 &&
    record.processStartIdentity.length <= 100 &&
    typeof record.producerVersion === "string" &&
    record.producerVersion.length > 0 &&
    record.producerVersion.length <= 100 &&
    ["dev", "build", "typegen", "worker"].includes(String(record.purpose))
  );
}

export function sameOwner(a: OwnerIdentity, b: OwnerIdentity): boolean {
  return (
    a.protocolVersion === b.protocolVersion &&
    a.realRoot === b.realRoot &&
    a.instanceId === b.instanceId &&
    a.pid === b.pid &&
    a.purpose === b.purpose &&
    a.processStartIdentity === b.processStartIdentity &&
    a.producerVersion === b.producerVersion
  );
}

/** 只有精确端点可重新独占才证明已释放；PID、mtime 和索引缺失都不是依据。 */
export async function ownerIsAlive(identity: OwnerIdentity): Promise<boolean> {
  try {
    const response = await requestOwnerEndpoint(identityKey(identity), {
      operation: "inspect",
    });
    if (!isOwnerIdentity(response) || !sameOwner(identity, response)) {
      throw new ProjectOwnerError(
        "VEXT_OWNER_UNVERIFIED",
        "Owner endpoint and discovery identity differ.",
      );
    }
    return true;
  } catch (error) {
    if (
      !["ENOENT", "ECONNREFUSED"].includes(
        String((error as NodeJS.ErrnoException).code),
      )
    ) {
      if (error instanceof ProjectOwnerError) throw error;
      throw new ProjectOwnerError(
        "VEXT_OWNER_UNVERIFIED",
        `Cannot verify owner endpoint: ${String(error)}`,
      );
    }
    try {
      const proof = await listenOwnerEndpoint(identityKey(identity), () => ({
        state: "reclaiming",
      }));
      await proof.close();
      return false;
    } catch {
      throw new ProjectOwnerError(
        "VEXT_OWNER_UNVERIFIED",
        "Old owner endpoint cannot be exclusively reclaimed; no takeover was performed.",
      );
    }
  }
}

/** 有界回收临时索引；所有旧写者的 OS 端点都已释放才移除记录。 */
export async function reclaimInactiveOwnerRecords(
  records: OwnerRecord[],
): Promise<void> {
  const deadline = Date.now() + 1000;
  for (
    let index = records.length - 1;
    index >= 0 && Date.now() < deadline;
    index--
  ) {
    const record = records[index]!;
    const proofs = [];
    let allReleased = true;
    try {
      for (const identity of [record.identity, ...record.participants]) {
        try {
          proofs.push(
            await listenOwnerEndpoint(identityKey(identity), () => ({
              state: "reclaiming",
            })),
          );
        } catch {
          // 未响应或权限不明的端点也保留；不靠 PID 或时间推断失效。
          allReleased = false;
          break;
        }
      }
      if (allReleased) records.splice(index, 1);
    } finally {
      for (const proof of proofs.reverse()) await proof.close();
    }
  }
}

/** 短时登记串行化，不在等待输出冲突时持有此互斥。索引损坏不按空表恢复。 */
export async function withOwnerRegistry<T>(
  operation: (records: OwnerRecord[]) => Promise<T>,
): Promise<T> {
  const directory = ownerRegistryDirectory();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink())
    throw new ProjectOwnerError(
      "VEXT_OWNER_UNVERIFIED",
      "Owner registry directory is a symbolic link.",
    );
  const mutexKey = `registry:${directory}`;
  const deadline = Date.now() + 10_000;
  let mutex;
  while (!mutex) {
    try {
      mutex = await listenOwnerEndpoint(mutexKey, () => ({
        protocolVersion: 1,
      }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      if (Date.now() >= deadline)
        throw new ProjectOwnerError(
          "VEXT_OWNER_BUSY",
          "Owner registration is busy; retry after the current operation finishes.",
        );
      await delay(15);
    }
  }
  try {
    const file = path.join(directory, "registry.json");
    assertRealPathInside(directory, file, "owner registry");
    let records: OwnerRecord[] = [];
    try {
      const bytes = readProjectFile(
        directory,
        "registry.json",
        MAX_REGISTRY_BYTES,
      );
      const data: unknown =
        bytes === null
          ? { schemaVersion: 1, records: [] }
          : JSON.parse(bytes.toString("utf8"));
      if (
        !data ||
        typeof data !== "object" ||
        (data as { schemaVersion?: unknown }).schemaVersion !== 1
      )
        throw new Error("Unsupported owner registry version");
      const list = (data as { records?: unknown }).records;
      if (
        !Array.isArray(list) ||
        list.length > 512 ||
        !list.every(
          (item: OwnerRecord) =>
            item &&
            isOwnerIdentity(item.identity) &&
            item.identity.purpose !== "worker" &&
            (item.outputs === undefined ||
              (Array.isArray(item.outputs) &&
                item.outputs.length <= 64 &&
                item.outputs.every(
                  (output) =>
                    typeof output === "string" &&
                    path.isAbsolute(output) &&
                    !output.includes("\0"),
                ))) &&
            Array.isArray(item.participants) &&
            item.participants.length <= 16 &&
            item.participants.every(
              (participant) =>
                isOwnerIdentity(participant) &&
                participant.purpose === "worker" &&
                participant.realRoot === item.identity.realRoot,
            ),
        )
      )
        throw new Error("Invalid owner registry records");
      records = list;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new ProjectOwnerError(
          "VEXT_OWNER_UNVERIFIED",
          `Owner registry must be inspected before recovery: ${String(error)}`,
        );
    }
    // 权威索引损坏时先保留候选作为检查材料；不先清理再发现索引不可读。
    recoverRegistryTemporaries(directory);
    const before = JSON.stringify(records);
    const result = await operation(records);
    if (records.length > 512)
      throw new ProjectOwnerError(
        "VEXT_OWNER_UNVERIFIED",
        "Owner registry capacity exceeded; inspect inactive records.",
      );
    const after = JSON.stringify(records);
    if (after !== before) {
      const content = `${JSON.stringify({ schemaVersion: 1, records })}\n`;
      if (Buffer.byteLength(content) > MAX_REGISTRY_BYTES)
        throw new ProjectOwnerError(
          "VEXT_OWNER_UNVERIFIED",
          "Owner registry exceeds its size limit.",
        );
      const digest = registryDigest(content);
      const temporaryName = `registry.json.${digest}.${randomUUID()}.tmp`;
      const temporary = path.join(directory, temporaryName);
      try {
        writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
        const candidate = readProjectFile(
          directory,
          temporaryName,
          MAX_REGISTRY_BYTES,
        );
        if (candidate === null || registryDigest(candidate) !== digest) {
          throw new ProjectOwnerError(
            "VEXT_OWNER_UNVERIFIED",
            "Owner registry candidate changed before commit.",
          );
        }
        renameSync(temporary, file);
      } finally {
        try {
          removeVerifiedRegistryTemporary(directory, temporaryName, digest);
        } catch (error) {
          preserveRegistryTemporary(directory, temporaryName, error);
        }
      }
    }
    return result;
  } finally {
    await mutex.close();
  }
}
