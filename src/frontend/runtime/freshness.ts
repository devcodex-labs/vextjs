import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { createDigest } from "../contract/schema-ir.js";
import type { VextRouteFreshnessIdentity } from "../contract/types.js";
import type { VextHeaders } from "../../types/headers.js";

export interface VextFrontendFreshnessKey {
  route: string;
  path: string;
  query: Record<string, string>;
  locale: string;
  buildId: string;
  partition: string;
  policy: Pick<
    VextRouteFreshnessIdentity,
    "mode" | "revalidate" | "clientOnly" | "hydration" | "seo"
  >;
}

export interface VextFrontendFreshnessResponse {
  payload: unknown;
  status: number;
  headers: VextHeaders;
}

export interface VextFrontendFreshnessEntry {
  schemaVersion: 1;
  key: VextFrontendFreshnessKey;
  keyDigest: string;
  createdAt: string;
  expiresAt: number | null;
  tags: readonly string[];
  response: VextFrontendFreshnessResponse;
}

export interface VextFrontendFreshnessReadResult {
  state: "miss" | "fresh" | "stale";
  entry?: VextFrontendFreshnessEntry;
}

export interface VextFrontendFreshnessWriteInput {
  key: VextFrontendFreshnessKey;
  tags: readonly string[];
  ttlMs?: number;
  response: VextFrontendFreshnessResponse;
}

export interface VextFrontendFreshnessInvalidation {
  route?: string;
  path?: string;
  tag?: string;
  key?: string;
  locale?: string;
  partition?: string;
}

export interface VextFrontendFreshnessInvalidationResult {
  matched: string[];
  removed: string[];
}

interface FreshnessPointer {
  schemaVersion: 1;
  keyDigest: string;
  entryFile: string;
  updatedAt: string;
}

/**
 * File-backed public frontend freshness store. Entries are immutable, and the
 * only mutable file is a small metadata pointer written via fsync + rename.
 * A failed write therefore leaves the previous pointer (last-known-good)
 * readable for stale serving and restart recovery.
 */
export class VextFrontendFreshnessStore {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(readonly rootDir: string) {}

  async read(
    key: VextFrontendFreshnessKey,
  ): Promise<VextFrontendFreshnessReadResult> {
    const keyDigest = createFreshnessKeyDigest(key);
    const pointer = await this.readPointer(keyDigest);
    if (!pointer) return { state: "miss" };

    const entry = await this.readEntry(pointer.entryFile);
    if (!entry || entry.keyDigest !== keyDigest) return { state: "miss" };
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      return { state: "stale", entry };
    }
    return { state: "fresh", entry };
  }

  async write(
    input: VextFrontendFreshnessWriteInput,
  ): Promise<VextFrontendFreshnessEntry> {
    const keyDigest = createFreshnessKeyDigest(input.key);
    const createdAt = new Date().toISOString();
    const entry: VextFrontendFreshnessEntry = {
      schemaVersion: 1,
      key: input.key,
      keyDigest,
      createdAt,
      expiresAt:
        input.ttlMs === undefined
          ? null
          : Date.now() + Math.max(0, input.ttlMs),
      tags: [...new Set(input.tags)].sort((left, right) =>
        left.localeCompare(right),
      ),
      response: input.response,
    };
    const entryFile = `${keyDigest}.${randomUUID()}.json`;
    await writeFileAtomically(
      path.join(this.entriesDir, entryFile),
      `${JSON.stringify(entry)}\n`,
    );
    await writeFileAtomically(
      path.join(this.pointersDir, `${keyDigest}.json`),
      `${JSON.stringify({
        schemaVersion: 1,
        keyDigest,
        entryFile,
        updatedAt: createdAt,
      } satisfies FreshnessPointer)}\n`,
    );
    return entry;
  }

  async singleFlight<T>(
    key: VextFrontendFreshnessKey,
    operation: () => Promise<T>,
  ): Promise<{ value: T; leader: boolean }> {
    const keyDigest = createFreshnessKeyDigest(key);
    const current = this.inFlight.get(keyDigest) as Promise<T> | undefined;
    if (current) {
      return { value: await current, leader: false };
    }

    const promise = operation().finally(() => {
      this.inFlight.delete(keyDigest);
    });
    this.inFlight.set(keyDigest, promise);
    return { value: await promise, leader: true };
  }

  async invalidate(
    target: VextFrontendFreshnessInvalidation,
  ): Promise<VextFrontendFreshnessInvalidationResult> {
    assertInvalidationTarget(target);
    let names: string[];
    try {
      names = await readdir(this.pointersDir);
    } catch (error) {
      if (isMissing(error)) return { matched: [], removed: [] };
      throw error;
    }

    const matched: string[] = [];
    const removed: string[] = [];
    for (const name of names.filter((item) => item.endsWith(".json"))) {
      const pointer = await this.readPointer(name.slice(0, -".json".length));
      if (!pointer) continue;
      const entry = await this.readEntry(pointer.entryFile);
      if (!entry || !matchesInvalidation(entry, target)) continue;
      matched.push(entry.keyDigest);
      try {
        await rm(path.join(this.pointersDir, name), { force: false });
        removed.push(entry.keyDigest);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    return { matched, removed };
  }

  get rootPath(): string {
    return path.join(this.rootDir, ".vext", "freshness", "v1");
  }

  private get entriesDir(): string {
    return path.join(this.rootPath, "entries");
  }

  private get pointersDir(): string {
    return path.join(this.rootPath, "pointers");
  }

  private async readPointer(
    keyDigest: string,
  ): Promise<FreshnessPointer | null> {
    try {
      const value = JSON.parse(
        await readFile(
          path.join(this.pointersDir, `${keyDigest}.json`),
          "utf-8",
        ),
      ) as FreshnessPointer;
      if (
        value.schemaVersion !== 1 ||
        value.keyDigest !== keyDigest ||
        typeof value.entryFile !== "string" ||
        !value.entryFile.endsWith(".json") ||
        path.basename(value.entryFile) !== value.entryFile
      ) {
        return null;
      }
      return value;
    } catch (error) {
      if (isMissing(error) || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  private async readEntry(
    entryFile: string,
  ): Promise<VextFrontendFreshnessEntry | null> {
    try {
      const value = JSON.parse(
        await readFile(path.join(this.entriesDir, entryFile), "utf-8"),
      ) as VextFrontendFreshnessEntry;
      if (value.schemaVersion !== 1 || typeof value.keyDigest !== "string") {
        return null;
      }
      return value;
    } catch (error) {
      if (isMissing(error) || error instanceof SyntaxError) return null;
      throw error;
    }
  }
}

const stores = new Map<string, VextFrontendFreshnessStore>();

export function getFrontendFreshnessStore(
  rootDir: string,
): VextFrontendFreshnessStore {
  const normalized = path.resolve(rootDir);
  let store = stores.get(normalized);
  if (!store) {
    store = new VextFrontendFreshnessStore(normalized);
    stores.set(normalized, store);
  }
  return store;
}

export async function invalidateFrontendFreshness(
  rootDir: string,
  target: VextFrontendFreshnessInvalidation,
): Promise<VextFrontendFreshnessInvalidationResult> {
  return getFrontendFreshnessStore(rootDir).invalidate(target);
}

export function createFreshnessKeyDigest(
  key: VextFrontendFreshnessKey,
): string {
  return createDigest(key);
}

async function writeFileAtomically(
  filePath: string,
  content: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  const handle = await open(tempPath, "w");
  try {
    await handle.writeFile(content, "utf-8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await rename(tempPath, filePath);
    await fsyncDirectory(path.dirname(filePath));
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function fsyncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Windows cannot fsync directory handles. The fully fsynced temp file and
    // atomic rename still preserve last-known-good pointer semantics there.
  }
}

function matchesInvalidation(
  entry: VextFrontendFreshnessEntry,
  target: VextFrontendFreshnessInvalidation,
): boolean {
  return (
    (target.route === undefined || entry.key.route === target.route) &&
    (target.path === undefined || entry.key.path === target.path) &&
    (target.key === undefined || entry.keyDigest === target.key) &&
    (target.locale === undefined || entry.key.locale === target.locale) &&
    (target.partition === undefined ||
      entry.key.partition === target.partition) &&
    (target.tag === undefined || entry.tags.includes(target.tag))
  );
}

function assertInvalidationTarget(
  target: VextFrontendFreshnessInvalidation,
): void {
  if (
    target.route === undefined &&
    target.path === undefined &&
    target.tag === undefined &&
    target.key === undefined &&
    target.locale === undefined &&
    target.partition === undefined
  ) {
    throw new Error(
      "[vextjs] frontend freshness invalidation requires route, path, tag, key, locale, or partition.",
    );
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
