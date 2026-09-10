import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { currentProjectOwner, type ProjectOwner } from "./owner.js";
import { listenOwnerEndpoint, ProjectOwnerError } from "./owner-endpoint.js";
import {
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_JOURNAL_FILE,
  ARTIFACT_STATE_DIRECTORY,
  MAX_ARTIFACT_METADATA_BYTES,
  ArtifactError,
  artifactPath,
  artifactRelativePath,
  isArtifactDigest,
  parseArtifactManifest,
  readArtifactFile,
  serializeArtifactManifest,
  type ArtifactManifest,
} from "./artifact-manifest.js";
import {
  commitArtifactFiles,
  recoverArtifactFiles,
  artifactRecoveryPlan,
  conflict,
  digestOrNull,
} from "./artifact-journal.js";
import { prepareArtifactScope, type ArtifactChange } from "./artifact-scope.js";
import { recoverTemporaryArtifacts } from "./temporary-artifact.js";
import {
  assertExplicitOutputDirectory,
  isPathInside,
} from "../path-boundary.js";

export interface ArtifactCandidate {
  path: string;
  contents: Uint8Array | string;
  source?: string;
}

export interface ArtifactTransaction {
  isFresh(inputDigest: string): boolean;
  /** merge 仅用于局部编译；未重新证明完整输入闭包时清除 freshness。 */
  commit(
    files: readonly ArtifactCandidate[],
    options?: { inputDigest?: string; mode?: "replace" | "merge" },
  ): Promise<void>;
}

export interface ArtifactScopeTarget {
  outDir: string;
  producer: string;
}

export interface ArtifactScopeUpdate extends ArtifactScopeTarget {
  files: readonly ArtifactCandidate[];
  inputDigest?: string;
  mode?: "replace" | "merge";
}

export interface ArtifactGroupTransaction {
  isFresh(target: ArtifactScopeTarget, inputDigest: string): boolean;
  /** 全部范围共享一次 journal 和 manifest 提交。 */
  commit(updates: readonly ArtifactScopeUpdate[]): Promise<void>;
}

function pruneDeletedDirectories(
  root: string,
  outputDir: string,
  deleted: string[],
): void {
  const boundary = artifactPath(root, outputDir, true);
  for (const file of deleted) {
    let directory = path.dirname(artifactPath(root, file, true));
    while (
      directory !== boundary &&
      path.relative(boundary, directory) !== ""
    ) {
      if (
        !path.relative(boundary, directory).startsWith(`..${path.sep}`) &&
        path.relative(boundary, directory) !== ".."
      ) {
        try {
          if (fs.lstatSync(directory).isSymbolicLink()) break;
          fs.rmdirSync(directory);
        } catch (error) {
          // 空目录回收不影响文件身份；用户文件或访问限制出现后保留目录。
          if (
            ["ENOENT", "ENOTEMPTY", "EEXIST", "EPERM", "EACCES"].includes(
              String((error as NodeJS.ErrnoException).code),
            )
          )
            break;
          throw error;
        }
      } else break;
      directory = path.dirname(directory);
    }
  }
}

export async function withArtifactTransaction<T>(
  options: {
    rootDir: string;
    outDir: string;
    producer: string;
    owner?: ProjectOwner;
  },
  operation: (transaction: ArtifactTransaction) => Promise<T>,
): Promise<T> {
  const target = { outDir: options.outDir, producer: options.producer };
  return withArtifactGroupTransaction(
    { ...options, outputs: [target] },
    (group) =>
      operation({
        isFresh: (inputDigest) => group.isFresh(target, inputDigest),
        commit: (files, commitOptions = {}) =>
          group.commit([{ ...target, ...commitOptions, files }]),
      }),
  );
}

export async function withArtifactGroupTransaction<T>(
  options: {
    rootDir: string;
    outputs: readonly ArtifactScopeTarget[];
    owner?: ProjectOwner;
  },
  operation: (transaction: ArtifactGroupTransaction) => Promise<T>,
): Promise<T> {
  const owner = options.owner ?? currentProjectOwner(options.rootDir);
  if (!owner)
    throw new ProjectOwnerError(
      "VEXT_OWNER_CLOSED",
      "An artifact transaction requires the current project owner.",
    );
  const root = owner.identity.realRoot;
  const resolvedRoot = fs.realpathSync.native(path.resolve(options.rootDir));
  if (
    (process.platform === "win32"
      ? resolvedRoot.toLowerCase()
      : resolvedRoot) !== root
  )
    throw new ProjectOwnerError(
      "VEXT_OWNER_UNVERIFIED",
      "Artifact owner belongs to another project.",
    );
  if (!options.outputs.length || options.outputs.length > 64)
    throw new ArtifactError(
      "VEXT_OUTPUT_UNVERIFIED",
      "Invalid artifact output scope count.",
    );
  const describe = (target: ArtifactScopeTarget) => {
    if (!isPathInside(root, target.outDir))
      assertExplicitOutputDirectory(root, target.outDir, "artifact output");
    const outputDir = artifactRelativePath(root, target.outDir, true);
    if (
      !/^[a-z][a-z0-9-]{0,47}$/u.test(target.producer) ||
      outputDir.startsWith(`${ARTIFACT_STATE_DIRECTORY}/`) ||
      outputDir === ARTIFACT_STATE_DIRECTORY
    )
      throw new ArtifactError(
        "VEXT_OUTPUT_UNVERIFIED",
        "Invalid artifact producer or output directory.",
      );
    return { id: `${target.producer}:${outputDir}`, outputDir };
  };
  const targets = new Map<string, string>();
  for (const target of options.outputs) {
    const { id, outputDir } = describe(target);
    if (targets.has(id)) conflict(outputDir);
    targets.set(id, outputDir);
  }
  const selectedTarget = (target: ArtifactScopeTarget) => {
    const descriptor = describe(target);
    if (!targets.has(descriptor.id))
      throw new ArtifactError(
        "VEXT_OUTPUT_UNVERIFIED",
        "Artifact scope was not declared before the transaction.",
      );
    return descriptor;
  };
  const recovery = artifactRecoveryPlan(root);
  await owner.reserveOutputs([
    ...options.outputs.map((target) => target.outDir),
    ...recovery.outputs,
    path.join(root, ARTIFACT_STATE_DIRECTORY),
  ]);
  const deadline = Date.now() + 10_000;
  let mutex;
  while (!mutex) {
    await owner.assertActive();
    try {
      mutex = await listenOwnerEndpoint(
        `artifact-transaction:${root}`,
        () => owner.writerIdentity,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      if (Date.now() >= deadline)
        throw new ProjectOwnerError(
          "VEXT_OWNER_BUSY",
          "Another artifact transaction is still active.",
        );
      await delay(15);
    }
  }
  let active = true;
  const assertTransactionActive = () => {
    if (!active || !mutex.active)
      throw new ProjectOwnerError(
        "VEXT_OWNER_CLOSED",
        "Artifact transaction has already closed.",
      );
  };
  try {
    await recoverTemporaryArtifacts(owner);
    if (
      digestOrNull(
        readArtifactFile(
          root,
          ARTIFACT_JOURNAL_FILE,
          MAX_ARTIFACT_METADATA_BYTES,
        ),
      ) !== recovery.digest
    )
      throw new ArtifactError(
        "VEXT_OUTPUT_CONFLICT",
        "Recovery state changed while acquiring output locks; retry the operation.",
      );
    recoverArtifactFiles(root);
    let original = readArtifactFile(
      root,
      ARTIFACT_MANIFEST_FILE,
      MAX_ARTIFACT_METADATA_BYTES,
    );
    let manifest = parseArtifactManifest(original, root);
    const transaction: ArtifactGroupTransaction = {
      isFresh(target, inputDigest) {
        assertTransactionActive();
        const { id } = selectedTarget(target);
        const scope = manifest.scopes.find((item) => item.id === id);
        return (
          isArtifactDigest(inputDigest) &&
          scope?.inputDigest === inputDigest &&
          scope.producerVersion === owner.identity.producerVersion &&
          scope.files.every(
            (file) =>
              digestOrNull(
                readArtifactFile(root, file.path, undefined, true),
              ) === file.sha256,
          )
        );
      },
      async commit(updates) {
        await owner.assertActive();
        assertTransactionActive();
        if (updates.length > targets.size)
          throw new ArtifactError(
            "VEXT_OUTPUT_UNVERIFIED",
            "Too many artifact scope updates.",
          );
        if (
          digestOrNull(
            readArtifactFile(
              root,
              ARTIFACT_MANIFEST_FILE,
              MAX_ARTIFACT_METADATA_BYTES,
            ),
          ) !== digestOrNull(original)
        )
          conflict(ARTIFACT_MANIFEST_FILE);
        const seen = new Set<string>();
        const nextScopes = new Map(
          manifest.scopes.map((scope) => [scope.id, scope]),
        );
        const changes: ArtifactChange[] = [];
        let changed = false;
        for (const update of updates) {
          const { id, outputDir } = selectedTarget(update);
          if (seen.has(id)) conflict(outputDir);
          seen.add(id);
          const prepared = prepareArtifactScope(
            root,
            manifest,
            outputDir,
            update,
            owner.identity.producerVersion,
          );
          nextScopes.set(id, prepared.scope);
          changes.push(...prepared.changes);
          changed ||= prepared.changed;
        }
        if (!changed) return;
        const nextManifest: ArtifactManifest = {
          ...manifest,
          scopes: [...nextScopes.values()].sort((a, b) =>
            a.id.localeCompare(b.id),
          ),
        };
        const updated = serializeArtifactManifest(nextManifest);
        parseArtifactManifest(updated, root);
        changes.push({
          path: ARTIFACT_MANIFEST_FILE,
          before: original,
          after: updated,
        });
        commitArtifactFiles(root, changes);
        for (const outputDir of targets.values())
          pruneDeletedDirectories(
            root,
            outputDir,
            changes
              .filter(
                (change) =>
                  change.after === null &&
                  change.path.startsWith(`${outputDir}/`),
              )
              .map((change) => change.path),
          );
        manifest = nextManifest;
        original = updated;
      },
    };
    return await operation(transaction);
  } finally {
    active = false;
    await mutex.close();
  }
}
