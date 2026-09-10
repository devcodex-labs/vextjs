import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ARTIFACT_JOURNAL_FILE,
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_STATE_DIRECTORY,
  MAX_ARTIFACT_FILES,
  MAX_ARTIFACT_METADATA_BYTES,
  ArtifactError,
  artifactDigest,
  artifactPath as resolveArtifactPath,
  isArtifactDigest,
  parseArtifactManifest,
  readArtifactFile as readScopedArtifactFile,
} from "./artifact-manifest.js";

interface JournalEntry {
  path: string;
  before: string | null;
  after: string | null;
}

interface Journal {
  schemaVersion: 1;
  realRoot: string;
  transactionId: string;
  entries: JournalEntry[];
}

// Journal目标由before/after两份完整manifest交叉验证；外部绝对引用仅在此受管范围内执行。
const artifactPath = (root: string, reference: string) =>
  resolveArtifactPath(root, reference, true);
const readArtifactFile = (root: string, reference: string, maxBytes?: number) =>
  readScopedArtifactFile(root, reference, maxBytes, true);

/** 在取得manifest互斥前声明恢复写入范围；互斥内再次核对摘要，禁止事后补锁。 */
export function artifactRecoveryPlan(root: string): {
  digest: string | null;
  outputs: string[];
} {
  const bytes = readArtifactFile(
    root,
    ARTIFACT_JOURNAL_FILE,
    MAX_ARTIFACT_METADATA_BYTES,
  );
  if (!bytes) return { digest: null, outputs: [] };
  const journal = parseJournal(bytes, root);
  const outputs = new Set<string>();
  const changed = new Set(
    journal.entries.slice(0, -1).map((entry) => entry.path),
  );
  for (const kind of ["before", "after"] as const) {
    const manifest = parseArtifactManifest(
      readBlob(root, journal, journal.entries.length - 1, kind),
      root,
    );
    for (const scope of manifest.scopes) {
      if (scope.files.some((file) => changed.has(file.path)))
        outputs.add(artifactPath(root, scope.outputDir));
    }
  }
  return { digest: artifactDigest(bytes), outputs: [...outputs].sort() };
}

export function digestOrNull(bytes: Buffer | null): string | null {
  return bytes === null ? null : artifactDigest(bytes);
}

export function conflict(relative: string): never {
  throw new ArtifactError(
    "VEXT_OUTPUT_CONFLICT",
    `Output changed outside its recorded producer: ${relative}. Preserve or move the conflicting file before retrying; no forced overwrite was performed.`,
  );
}

function transactionDirectory(id: string): string {
  return `${ARTIFACT_STATE_DIRECTORY}/transactions/${id}`;
}

function blobPath(
  journal: Journal,
  index: number,
  kind: "before" | "after",
): string {
  return `${transactionDirectory(journal.transactionId)}/${index}-${kind}`;
}

function temporaryPath(journal: Journal, entry: JournalEntry): string {
  return `${entry.path}.vext-${journal.transactionId}.tmp`;
}

/** 临时文件与最终文件同目录，避免挂载点之间 rename 的 EXDEV。 */
function replaceFile(
  root: string,
  relative: string,
  bytes: Buffer | null,
  journal: Journal,
): void {
  const target = artifactPath(root, relative);
  if (bytes === null) {
    fs.rmSync(target, { force: true });
    return;
  }
  const temporary = artifactPath(
    root,
    temporaryPath(journal, { path: relative, before: null, after: null }),
  );
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, bytes, { flag: "wx" });
  fs.renameSync(temporary, target);
}

function readBlob(
  root: string,
  journal: Journal,
  index: number,
  kind: "before" | "after",
): Buffer | null {
  const digest = journal.entries[index]![kind];
  if (digest === null) return null;
  const bytes = readArtifactFile(root, blobPath(journal, index, kind));
  if (digestOrNull(bytes) !== digest) {
    throw new ArtifactError(
      "VEXT_OUTPUT_UNVERIFIED",
      `Transaction recovery bytes differ: ${blobPath(journal, index, kind)}`,
    );
  }
  return bytes;
}

function parseJournal(
  bytes: Buffer,
  root: string,
  verifyManifest = true,
): Journal {
  try {
    const journal = JSON.parse(bytes.toString("utf8")) as Journal;
    if (
      journal.schemaVersion !== 1 ||
      journal.realRoot !== root ||
      !/^[0-9a-f-]{36}$/u.test(journal.transactionId) ||
      !Array.isArray(journal.entries) ||
      journal.entries.length < 1 ||
      journal.entries.length > MAX_ARTIFACT_FILES + 1
    )
      throw new Error("Invalid recovery journal");
    const paths = new Set<string>();
    for (const entry of journal.entries) {
      if (
        !entry ||
        typeof entry.path !== "string" ||
        paths.has(entry.path) ||
        (entry.before !== null && !isArtifactDigest(entry.before)) ||
        (entry.after !== null && !isArtifactDigest(entry.after))
      )
        throw new Error("Invalid recovery entry");
      artifactPath(root, entry.path);
      paths.add(entry.path);
    }
    const last = journal.entries.at(-1)!;
    if (last.path !== ARTIFACT_MANIFEST_FILE || last.after === null)
      throw new Error("Manifest must commit last");
    if (!verifyManifest) return journal;
    const before = parseArtifactManifest(
      readBlob(root, journal, journal.entries.length - 1, "before"),
      root,
    );
    const after = parseArtifactManifest(
      readBlob(root, journal, journal.entries.length - 1, "after"),
      root,
    );
    const previous = new Map(
      before.scopes
        .flatMap((scope) => scope.files)
        .map((file) => [file.path, file.sha256]),
    );
    const next = new Map(
      after.scopes
        .flatMap((scope) => scope.files)
        .map((file) => [file.path, file.sha256]),
    );
    for (const entry of journal.entries.slice(0, -1)) {
      if (
        (entry.before !== null && previous.get(entry.path) !== entry.before) ||
        (entry.after !== null && next.get(entry.path) !== entry.after) ||
        (entry.after === null && next.has(entry.path)) ||
        entry.path.startsWith(`${ARTIFACT_STATE_DIRECTORY}/`)
      )
        throw new Error("Recovery entry does not match manifest ownership");
    }
    return journal;
  } catch (error) {
    throw new ArtifactError(
      "VEXT_OUTPUT_UNVERIFIED",
      `Inspect the transaction journal before recovery: ${String(error)}`,
    );
  }
}

function cleanupJournal(root: string, journal: Journal): void {
  for (const entry of journal.entries) {
    const relative = temporaryPath(journal, entry);
    const temporary = readArtifactFile(root, relative);
    if (temporary !== null) {
      const digest = artifactDigest(temporary);
      if (digest !== entry.before && digest !== entry.after) conflict(relative);
      fs.rmSync(artifactPath(root, relative));
    }
  }
  // 先移除已结束的活动日志，剩余准备记录可在下一次互斥内有界回收。
  fs.rmSync(artifactPath(root, ARTIFACT_JOURNAL_FILE));
  discardPrepared(root, journal);
}

/** 进程中断恢复；不承诺跨文件原子可见或断电级文件系统事务。 */
function recoverTransaction(root: string): void {
  const bytes = readArtifactFile(
    root,
    ARTIFACT_JOURNAL_FILE,
    MAX_ARTIFACT_METADATA_BYTES,
  );
  if (!bytes) return;
  const journal = parseJournal(bytes, root);
  const committed =
    digestOrNull(
      readArtifactFile(
        root,
        ARTIFACT_MANIFEST_FILE,
        MAX_ARTIFACT_METADATA_BYTES,
      ),
    ) === journal.entries.at(-1)!.after;
  // 先检查全部目标和副本，避免发现后半段冲突时已经部分回滚。
  for (let index = 0; index < journal.entries.length; index++) {
    const entry = journal.entries[index]!;
    const current = digestOrNull(readArtifactFile(root, entry.path));
    if (
      committed
        ? current !== entry.after
        : current !== entry.before && current !== entry.after
    )
      conflict(entry.path);
    readBlob(root, journal, index, "before");
    readBlob(root, journal, index, "after");
  }
  if (!committed) {
    for (let index = journal.entries.length - 1; index >= 0; index--) {
      const entry = journal.entries[index]!;
      if (digestOrNull(readArtifactFile(root, entry.path)) === entry.before)
        continue;
      const temporary = readArtifactFile(root, temporaryPath(journal, entry));
      if (temporary !== null) {
        if (![entry.before, entry.after].includes(artifactDigest(temporary)))
          conflict(temporaryPath(journal, entry));
        fs.rmSync(artifactPath(root, temporaryPath(journal, entry)));
      }
      replaceFile(
        root,
        entry.path,
        readBlob(root, journal, index, "before"),
        journal,
      );
    }
  }
  cleanupJournal(root, journal);
}

export interface ArtifactFileChange {
  path: string;
  before: Buffer | null;
  after: Buffer | null;
}

function preparationPath(journal: Journal): string {
  return `${transactionDirectory(journal.transactionId)}/prepared.json`;
}

function discardPrepared(root: string, journal: Journal): void {
  const bytes = Buffer.from(`${JSON.stringify(journal)}\n`);
  const prepared = readArtifactFile(
    root,
    preparationPath(journal),
    MAX_ARTIFACT_METADATA_BYTES,
  );
  if (prepared && !prepared.equals(bytes)) conflict(preparationPath(journal));
  const removable: string[] = [];
  for (let index = 0; index < journal.entries.length; index++) {
    for (const kind of ["before", "after"] as const) {
      const relative = blobPath(journal, index, kind);
      const existing = readArtifactFile(root, relative);
      if (existing === null) continue;
      if (artifactDigest(existing) !== journal.entries[index]![kind])
        conflict(relative);
      removable.push(relative);
    }
  }
  const pendingJournal = temporaryPath(journal, {
    path: ARTIFACT_JOURNAL_FILE,
    before: null,
    after: null,
  });
  const pendingBytes = readArtifactFile(
    root,
    pendingJournal,
    MAX_ARTIFACT_METADATA_BYTES,
  );
  if (pendingBytes) {
    if (!pendingBytes.equals(bytes)) conflict(pendingJournal);
    removable.push(pendingJournal);
  }
  for (const relative of removable) fs.rmSync(artifactPath(root, relative));
  if (prepared) fs.rmSync(artifactPath(root, preparationPath(journal)));
  try {
    fs.rmdirSync(
      artifactPath(root, transactionDirectory(journal.transactionId)),
    );
  } catch (error) {
    if (
      !["ENOENT", "ENOTEMPTY", "EEXIST"].includes(
        String((error as NodeJS.ErrnoException).code),
      )
    )
      throw error;
  }
}

/** 仅回收受限暂存目录的已声明字节；未知/损坏的准备记录保留供检查。 */
function collectAbandonedPreparations(root: string): void {
  let directory: fs.Dir;
  try {
    directory = fs.opendirSync(
      artifactPath(root, `${ARTIFACT_STATE_DIRECTORY}/transactions`),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const deadline = Date.now() + 100;
  try {
    for (
      let inspected = 0;
      inspected < 128 && Date.now() < deadline;
      inspected++
    ) {
      const entry = directory.readSync();
      if (!entry) break;
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        !/^[0-9a-f-]{36}$/u.test(entry.name)
      )
        continue;
      try {
        const relative = `${transactionDirectory(entry.name)}/prepared.json`;
        const bytes = readArtifactFile(
          root,
          relative,
          MAX_ARTIFACT_METADATA_BYTES,
        );
        if (!bytes) continue;
        const journal = parseJournal(bytes, root, false);
        if (journal.transactionId !== entry.name) continue;
        discardPrepared(root, journal);
      } catch {
        // 这里没有恢复最终输出的许可；不能因清理方便而认领未知暂存数据。
      }
    }
  } finally {
    directory.closeSync();
  }
}

export function recoverArtifactFiles(root: string): void {
  recoverTransaction(root);
  collectAbandonedPreparations(root);
}

/** 调用方已验证 producer 与 manifest CAS，文件系统过程集中在这里。 */
export function commitArtifactFiles(
  root: string,
  changes: ArtifactFileChange[],
): void {
  const journal: Journal = {
    schemaVersion: 1,
    realRoot: root,
    transactionId: randomUUID(),
    entries: changes.map((change) => ({
      path: change.path,
      before: digestOrNull(change.before),
      after: digestOrNull(change.after),
    })),
  };
  const journalBytes = Buffer.from(`${JSON.stringify(journal)}\n`);
  if (journalBytes.length > MAX_ARTIFACT_METADATA_BYTES)
    throw new ArtifactError(
      "VEXT_OUTPUT_UNVERIFIED",
      "Transaction journal exceeds the metadata limit.",
    );
  fs.mkdirSync(
    artifactPath(root, transactionDirectory(journal.transactionId)),
    { recursive: true },
  );
  try {
    // 先记录精确准备清单，进程在复制前值时退出也能安全回收已完成的暂存。
    fs.writeFileSync(
      artifactPath(root, preparationPath(journal)),
      journalBytes,
      { flag: "wx" },
    );
    for (let index = 0; index < changes.length; index++) {
      for (const kind of ["before", "after"] as const) {
        const bytes = changes[index]![kind];
        if (bytes !== null)
          fs.writeFileSync(
            artifactPath(root, blobPath(journal, index, kind)),
            bytes,
            { flag: "wx" },
          );
      }
    }
    // 完整前值就绪后才发布恢复日志并触碰最终输出。
    replaceFile(root, ARTIFACT_JOURNAL_FILE, journalBytes, journal);
  } catch (error) {
    try {
      discardPrepared(root, journal);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Artifact preparation failed; preserve the preparation record.",
      );
    }
    throw error;
  }
  try {
    for (const change of changes) {
      if (
        digestOrNull(readArtifactFile(root, change.path)) !==
        digestOrNull(change.before)
      )
        conflict(change.path);
      replaceFile(root, change.path, change.after, journal);
    }
    cleanupJournal(root, journal);
  } catch (error) {
    try {
      recoverTransaction(root);
    } catch (recoveryError) {
      throw new AggregateError(
        [error, recoveryError],
        "Artifact commit and recovery did not complete; preserve the recovery journal.",
      );
    }
    throw error;
  }
}
