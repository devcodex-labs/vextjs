import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import packageMetadata from "../../../package.json" with { type: "json" };
import {
  assertExplicitOutputDirectory,
  assertRealPathInside,
  canonicalPath,
  isPathInside,
  canonicalProjectRoot as canonicalRoot,
} from "../path-boundary.js";
import {
  listenOwnerEndpoint,
  ProjectOwnerError,
  requestOwnerEndpoint,
  type OwnerEndpoint,
} from "./owner-endpoint.js";
import {
  identityKey,
  isOwnerIdentity,
  ownerIsAlive,
  reclaimInactiveOwnerRecords,
  sameOwner,
  withOwnerRegistry,
  type OwnerIdentity,
} from "./owner-registry.js";

export interface ProjectOwnerGrant {
  identity: OwnerIdentity;
  credential: string;
}

export interface ProjectOwner {
  readonly identity: OwnerIdentity;
  readonly writerIdentity: OwnerIdentity;
  assertActive(): Promise<void>;
  reserveOutputs(paths: readonly string[]): Promise<void>;
  run<T>(operation: () => T): T;
  release(): Promise<void>;
  createGrant(): ProjectOwnerGrant;
}

const context = new AsyncLocalStorage<ProjectOwner>();

function createIdentity(
  realRoot: string,
  purpose: OwnerIdentity["purpose"],
): OwnerIdentity {
  return Object.freeze({
    protocolVersion: 1,
    realRoot,
    instanceId: randomUUID(),
    pid: process.pid,
    processStartIdentity: `${process.pid}:${performance.timeOrigin}`,
    producerVersion: packageMetadata.version,
    purpose,
  });
}

function authenticate(value: unknown, credential: string): boolean {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{64}$/u.test(value) &&
    timingSafeEqual(Buffer.from(value, "hex"), Buffer.from(credential, "hex"))
  );
}

export async function acquireProjectOwner(
  rootDir: string,
  purpose: "dev" | "build" | "typegen",
): Promise<ProjectOwner> {
  return acquireOwner(canonicalRoot(rootDir), purpose);
}

/** 部署仅独占实际输出范围；复用registry的祖先重叠检查，不独占整个服务。 */
export async function withOutputDirectoryOwner<T>(
  directory: string,
  operation: () => Promise<T>,
): Promise<T> {
  const parent = context.getStore();
  if (parent) await parent.assertActive();
  const owner = await acquireOwner(
    canonicalPath(directory),
    "deploy",
    parent?.identity,
  );
  try {
    return await operation();
  } finally {
    await owner.release();
  }
}

async function acquireOwner(
  realRoot: string,
  purpose: "dev" | "build" | "typegen" | "deploy",
  parentIdentity?: OwnerIdentity,
): Promise<ProjectOwner> {
  const identity = createIdentity(realRoot, purpose);
  const credential = randomBytes(32).toString("hex");
  const outputs = new Map<string, OwnerEndpoint>();
  let endpoint: OwnerEndpoint | undefined;
  let closing = false;
  let ready = false;
  let released = false;
  let outputQueue: Promise<unknown> = Promise.resolve();

  const assertActive = async () => {
    if (!ready || closing || !endpoint?.active)
      throw new ProjectOwnerError(
        "VEXT_OWNER_CLOSED",
        "Project writer is no longer active.",
      );
  };
  const reserveTargets = async (paths: readonly string[]) => {
    await assertActive();
    if (paths.length > 64)
      throw new ProjectOwnerError(
        "VEXT_OWNER_UNVERIFIED",
        "Too many output targets.",
      );
    const candidates = [
      ...new Set(
        paths.map((target) => {
          const absolute = path.resolve(identity.realRoot, target);
          if (isPathInside(identity.realRoot, absolute))
            assertRealPathInside(identity.realRoot, absolute, "owned output");
          else
            assertExplicitOutputDirectory(
              identity.realRoot,
              absolute,
              "owned output",
            );
          return canonicalPath(absolute);
        }),
      ),
    ].sort();
    const added: string[] = [];
    try {
      await withOwnerRegistry(async (records) => {
        await reclaimInactiveOwnerRecords(records);
        const record = records.find((item) =>
          sameOwner(item.identity, identity),
        );
        if (!record)
          throw new ProjectOwnerError(
            "VEXT_OWNER_UNVERIFIED",
            "Output owner registration changed.",
          );
        for (const other of records) {
          if (sameOwner(other.identity, identity)) continue;
          const overlap = candidates.find((target) =>
            [other.identity.realRoot, ...(other.outputs ?? [])].some(
              (existing) =>
                isPathInside(existing, target, true) ||
                isPathInside(target, existing, true),
            ),
          );
          if (overlap)
            throw new ProjectOwnerError(
              "VEXT_OWNER_BUSY",
              `Output overlaps another writer: ${overlap} (${other.identity.realRoot}).`,
            );
        }
        for (const target of candidates) {
          if (
            [...outputs.keys()].some((existing) =>
              isPathInside(existing, target, true),
            )
          )
            continue;
          if (outputs.size >= 64)
            throw new ProjectOwnerError(
              "VEXT_OWNER_UNVERIFIED",
              "Output target capacity exceeded.",
            );
          await assertActive();
          const lease = await listenOwnerEndpoint(
            `output:${target}`,
            () => identity,
          );
          outputs.set(target, lease);
          added.push(target);
        }
        record.outputs = [...outputs.keys()].sort();
      });
    } catch (error) {
      for (const target of added.reverse()) {
        await outputs.get(target)?.close();
        outputs.delete(target);
      }
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE")
        throw new ProjectOwnerError(
          "VEXT_OWNER_BUSY",
          "An output directory is already owned by another writer.",
        );
      throw error;
    }
  };
  const reserveOutputs = (paths: readonly string[]): Promise<void> => {
    const pending = outputQueue.then(() => reserveTargets(paths));
    outputQueue = pending.catch(() => undefined);
    return pending;
  };

  try {
    await withOwnerRegistry(async (records) => {
      await reclaimInactiveOwnerRecords(records);
      for (let i = records.length - 1; i >= 0; i--) {
        const record = records[i]!;
        // build --upload-assets仍持有自己的项目owner；独立部署scope之间照常互斥。
        if (parentIdentity && sameOwner(record.identity, parentIdentity))
          continue;
        if (
          !isPathInside(identity.realRoot, record.identity.realRoot, true) &&
          !isPathInside(record.identity.realRoot, identity.realRoot, true) &&
          !(record.outputs ?? []).some(
            (output) =>
              isPathInside(output, identity.realRoot, true) ||
              isPathInside(identity.realRoot, output, true),
          )
        )
          continue;
        for (const writer of [record.identity, ...record.participants]) {
          if (await ownerIsAlive(writer))
            throw new ProjectOwnerError(
              "VEXT_OWNER_BUSY",
              `${writer.purpose} writer ${writer.pid} owns an overlapping project: ${writer.realRoot}`,
            );
        }
        records.splice(i, 1);
      }
      endpoint = await listenOwnerEndpoint(
        identityKey(identity),
        async (request, signal) => {
          if (!request || typeof request !== "object") return undefined;
          const input = request as Record<string, unknown>;
          if (input.operation === "inspect") return identity;
          if (!authenticate(input.credential, credential)) return undefined;
          if (input.operation !== "unregister") await assertActive();
          if (input.operation === "assert") return identity;
          if (
            input.operation === "reserve" &&
            Array.isArray(input.paths) &&
            input.paths.every((item) => typeof item === "string")
          ) {
            await reserveOutputs(input.paths as string[]);
            return identity;
          }
          if (
            (input.operation === "register" ||
              input.operation === "unregister") &&
            isOwnerIdentity(input.writer) &&
            input.writer.purpose === "worker" &&
            input.writer.realRoot === identity.realRoot
          ) {
            const writer = input.writer;
            return withOwnerRegistry(async (current) => {
              if (input.operation !== "unregister") await assertActive();
              signal.throwIfAborted();
              const record = current.find((item) =>
                sameOwner(item.identity, identity),
              );
              if (!record)
                throw new ProjectOwnerError(
                  "VEXT_OWNER_UNVERIFIED",
                  "Parent owner registration changed.",
                );
              if (input.operation === "register") {
                if (!(await ownerIsAlive(writer)))
                  throw new ProjectOwnerError(
                    "VEXT_OWNER_UNVERIFIED",
                    "Child writer endpoint is not active.",
                  );
                signal.throwIfAborted();
                if (
                  !record.participants.some((item) => sameOwner(item, writer))
                ) {
                  if (record.participants.length >= 16)
                    throw new ProjectOwnerError(
                      "VEXT_OWNER_BUSY",
                      "Too many child writers.",
                    );
                  record.participants.push(writer);
                }
              } else {
                record.participants = record.participants.filter(
                  (item) => !sameOwner(item, writer),
                );
              }
              return identity;
            });
          }
          return undefined;
        },
      );
      records.push({ identity, participants: [] });
    });
    ready = true;
  } catch (error) {
    await endpoint?.close();
    throw error;
  }

  const owner: ProjectOwner = {
    identity,
    writerIdentity: identity,
    assertActive,
    reserveOutputs,
    run: (operation) => context.run(owner, operation),
    createGrant: () => ({ identity, credential }),
    async release() {
      if (released) return;
      closing = true;
      await outputQueue;
      await withOwnerRegistry(async (records) => {
        const index = records.findIndex((item) =>
          sameOwner(item.identity, identity),
        );
        if (index >= 0) {
          for (const writer of records[index]!.participants) {
            if (await ownerIsAlive(writer))
              throw new ProjectOwnerError(
                "VEXT_OWNER_BUSY",
                "Stop child writers before releasing their parent owner.",
              );
          }
          records.splice(index, 1);
        }
      });
      for (const lease of [...outputs.values()].reverse()) await lease.close();
      outputs.clear();
      await endpoint?.close();
      released = true;
    },
  };
  return owner;
}

/** 子写者先独占自己的端点并登记，防止 parent 崩溃后新实例越过仍存活的旧写者。 */
export async function adoptProjectOwner(
  rootDir: string,
  grant: ProjectOwnerGrant,
): Promise<ProjectOwner> {
  if (
    !grant ||
    !isOwnerIdentity(grant.identity) ||
    grant.identity.purpose === "worker" ||
    canonicalRoot(rootDir) !== grant.identity.realRoot ||
    !/^[0-9a-f]{64}$/u.test(grant.credential)
  ) {
    throw new ProjectOwnerError(
      "VEXT_OWNER_UNVERIFIED",
      "Invalid parent writer grant.",
    );
  }
  const writerIdentity = createIdentity(grant.identity.realRoot, "worker");
  const endpoint = await listenOwnerEndpoint(
    identityKey(writerIdentity),
    () => writerIdentity,
  );
  let closing = false;
  const request = async (
    operation: string,
    extra: Record<string, unknown> = {},
  ) => {
    const response = await requestOwnerEndpoint(identityKey(grant.identity), {
      operation,
      credential: grant.credential,
      writer: writerIdentity,
      ...extra,
    });
    if (!isOwnerIdentity(response) || !sameOwner(response, grant.identity))
      throw new ProjectOwnerError(
        "VEXT_OWNER_UNVERIFIED",
        "Parent owner did not confirm the current writer identity.",
      );
  };
  try {
    await request("register");
  } catch (error) {
    await endpoint.close();
    throw error;
  }
  const owner: ProjectOwner = {
    identity: grant.identity,
    writerIdentity,
    async assertActive() {
      if (closing || !endpoint.active)
        throw new ProjectOwnerError(
          "VEXT_OWNER_CLOSED",
          "Child writer is closed.",
        );
      await request("assert");
    },
    async reserveOutputs(paths) {
      await owner.assertActive();
      await request("reserve", { paths });
    },
    run: (operation) => context.run(owner, operation),
    createGrant() {
      throw new ProjectOwnerError(
        "VEXT_OWNER_UNVERIFIED",
        "Child writers cannot delegate ownership.",
      );
    },
    async release() {
      if (closing) return;
      closing = true;
      try {
        await request("unregister");
      } finally {
        await endpoint.close();
      }
    },
  };
  return owner;
}

export function currentProjectOwner(
  rootDir?: string,
): ProjectOwner | undefined {
  const current = context.getStore();
  if (rootDir === undefined) return current;
  return current?.identity.realRoot === canonicalRoot(rootDir)
    ? current
    : undefined;
}

export async function withProjectOwner<T>(
  rootDir: string,
  purpose: "dev" | "build" | "typegen",
  outputs: readonly string[],
  operation: () => Promise<T>,
): Promise<T> {
  const inherited = currentProjectOwner(rootDir);
  const owner = inherited ?? (await acquireProjectOwner(rootDir, purpose));
  try {
    await owner.assertActive();
    await owner.reserveOutputs(outputs);
    return await owner.run(operation);
  } finally {
    if (!inherited) await owner.release();
  }
}
