import {
  ARTIFACT_STATE_DIRECTORY,
  MAX_ARTIFACT_FILES,
  ArtifactError,
  artifactDigest,
  artifactRelativePath,
  isArtifactDigest,
  readArtifactFile,
  type ArtifactFile,
  type ArtifactManifest,
  type ArtifactScope,
} from "./artifact-manifest.js";
import { conflict, digestOrNull } from "./artifact-journal.js";
import type { ArtifactScopeUpdate } from "./artifact-transaction.js";

export interface ArtifactChange {
  path: string;
  before: Buffer | null;
  after: Buffer | null;
}

export function artifactFileKey(file: string): string {
  return process.platform === "win32" ? file.toLowerCase() : file;
}

/** 计算单个 producer 的完整差异；所有范围检查完成前不修改目标文件。 */
export function prepareArtifactScope(
  root: string,
  manifest: ArtifactManifest,
  outputDir: string,
  update: ArtifactScopeUpdate,
  producerVersion: string,
): { scope: ArtifactScope; changes: ArtifactChange[]; changed: boolean } {
  if (
    update.files.length > MAX_ARTIFACT_FILES ||
    (update.inputDigest !== undefined && !isArtifactDigest(update.inputDigest))
  ) {
    throw new ArtifactError(
      "VEXT_OUTPUT_UNVERIFIED",
      "Invalid artifact candidates or input digest.",
    );
  }
  const id = `${update.producer}:${outputDir}`;
  const scope = manifest.scopes.find((item) => item.id === id);
  const previous = new Map(scope?.files.map((file) => [file.path, file]) ?? []);
  const other = new Set(
    manifest.scopes
      .filter((item) => item.id !== id)
      .flatMap((item) => item.files.map((file) => artifactFileKey(file.path))),
  );
  const next =
    update.mode === "merge"
      ? new Map(previous)
      : new Map<string, ArtifactFile>();
  const contents = new Map<string, Buffer>();
  const candidateKeys = new Set<string>();
  for (const file of update.files) {
    const relative = artifactRelativePath(root, file.path);
    const key = artifactFileKey(relative);
    if (
      !relative.startsWith(`${outputDir}/`) ||
      relative.startsWith(`${ARTIFACT_STATE_DIRECTORY}/`) ||
      other.has(key) ||
      candidateKeys.has(key)
    )
      conflict(relative);
    candidateKeys.add(key);
    const bytes = Buffer.from(file.contents);
    const source =
      file.source === undefined
        ? undefined
        : artifactRelativePath(root, file.source);
    contents.set(relative, bytes);
    next.set(relative, {
      path: relative,
      sha256: artifactDigest(bytes),
      ...(source === undefined ? {} : { source }),
    });
  }
  const changes: ArtifactChange[] = [];
  for (const relative of new Set([...previous.keys(), ...next.keys()])) {
    const before = readArtifactFile(root, relative);
    const actual = digestOrNull(before);
    const recorded = previous.get(relative)?.sha256;
    const desired = next.get(relative)?.sha256 ?? null;
    if (
      before !== null &&
      (recorded === undefined ? actual !== desired : actual !== recorded)
    )
      conflict(relative);
    if (actual === desired) continue;
    const after = desired === null ? null : contents.get(relative);
    if (after === undefined) conflict(relative);
    changes.push({ path: relative, before, after });
  }
  const nextScope: ArtifactScope = {
    id,
    producer: update.producer,
    outputDir,
    producerVersion,
    inputDigest: update.inputDigest ?? null,
    generation: scope?.generation ?? 1,
    files: [...next.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
  const changed =
    changes.length !== 0 ||
    !scope ||
    JSON.stringify(nextScope) !== JSON.stringify(scope);
  if (scope && changed) nextScope.generation++;
  return { scope: nextScope, changes, changed };
}
