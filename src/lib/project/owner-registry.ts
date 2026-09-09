import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { assertRealPathInside } from "../path-boundary.js";
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
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
        throw new Error("Invalid owner registry file or size");
      const data: unknown = JSON.parse(readFileSync(file, "utf8"));
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
      if (Buffer.byteLength(content) > 1024 * 1024)
        throw new ProjectOwnerError(
          "VEXT_OWNER_UNVERIFIED",
          "Owner registry exceeds its size limit.",
        );
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
        renameSync(temporary, file);
      } finally {
        rmSync(temporary, { force: true });
      }
    }
    return result;
  } finally {
    await mutex.close();
  }
}
