import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { currentProjectOwner, type ProjectOwner } from "./owner.js";
import { listenOwnerEndpoint, ProjectOwnerError } from "./owner-endpoint.js";
import {
  ARTIFACT_STATE_DIRECTORY,
  ArtifactError,
  artifactDigest,
  artifactPath,
  artifactRelativePath,
  isArtifactDigest,
  readArtifactFile,
} from "./artifact-manifest.js";

const DIRECTORY = `${ARTIFACT_STATE_DIRECTORY}/temporary`;
const MAX_RECEIPTS = 128;

interface TemporaryReceipt {
  schemaVersion: 1;
  realRoot: string;
  id: string;
  file: string;
  sha256: string;
}

function endpointKey(root: string, id: string): string {
  return `temporary-artifact:${root}:${id}`;
}

function readReceipts(root: string): string[] {
  const directory = artifactPath(root, DIRECTORY);
  let handle: fs.Dir;
  try {
    handle = fs.opendirSync(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  try {
    for (let entry; (entry = handle.readSync()); ) {
      if (
        files.length >= MAX_RECEIPTS ||
        !entry.isFile() ||
        !/^[0-9a-f-]{36}\.json$/u.test(entry.name)
      )
        throw new ArtifactError(
          "VEXT_OUTPUT_UNVERIFIED",
          "Invalid temporary artifact receipts.",
        );
      files.push(`${DIRECTORY}/${entry.name}`);
    }
  } finally {
    handle.closeSync();
  }
  return files.sort();
}

function parseReceipt(root: string, file: string): TemporaryReceipt | null {
  const bytes = readArtifactFile(root, file, 16 * 1024);
  if (!bytes) return null;
  try {
    const receipt = JSON.parse(bytes.toString("utf8")) as TemporaryReceipt;
    if (
      receipt.schemaVersion !== 1 ||
      receipt.realRoot !== root ||
      typeof receipt.id !== "string" ||
      !/^[0-9a-f-]{36}$/u.test(receipt.id) ||
      file !== `${DIRECTORY}/${receipt.id}.json` ||
      typeof receipt.file !== "string" ||
      !isArtifactDigest(receipt.sha256) ||
      !new RegExp(`^\\.vext-exec-${receipt.id}\\.(?:mjs|cjs)$`, "u").test(
        path.posix.basename(receipt.file),
      )
    )
      throw new Error("Receipt identity differs");
    artifactPath(root, receipt.file);
    return receipt;
  } catch (error) {
    throw new ArtifactError(
      "VEXT_OUTPUT_UNVERIFIED",
      `Invalid temporary artifact receipt ${file}: ${String(error)}`,
    );
  }
}

function removeTemporary(
  root: string,
  receiptFile: string,
  receipt: TemporaryReceipt,
): void {
  const bytes = readArtifactFile(root, receipt.file);
  if (bytes && artifactDigest(bytes) !== receipt.sha256)
    throw new ArtifactError(
      "VEXT_OUTPUT_CONFLICT",
      `Temporary artifact was externally modified: ${receipt.file}`,
    );
  if (bytes) fs.unlinkSync(artifactPath(root, receipt.file));
  // 文件先删除，收据最后删除；中断后仍有可验证的恢复入口。
  fs.unlinkSync(artifactPath(root, receiptFile));
}

/** 仅由已验证写者恢复；收据提供归属，独占端点提供操作已结束的证据。 */
export async function recoverTemporaryArtifacts(
  owner: ProjectOwner,
): Promise<void> {
  await owner.assertActive();
  const root = owner.identity.realRoot;
  for (const file of readReceipts(root)) {
    const id = path.posix.basename(file, ".json");
    let endpoint;
    try {
      endpoint = await listenOwnerEndpoint(
        endpointKey(root, id),
        () => owner.writerIdentity,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") continue;
      throw error;
    }
    try {
      const receipt = parseReceipt(root, file);
      if (receipt) removeTemporary(root, file, receipt);
    } finally {
      await endpoint.close();
    }
  }
}

/** 原生模块只能从文件执行时使用；不写最终产物，也不按文件名猜测旧文件归属。 */
export async function withTemporaryArtifact<T>(
  options: {
    rootDir: string;
    logicalPath: string;
    contents: Uint8Array | string;
  },
  operation: (filename: string) => Promise<T>,
): Promise<T> {
  const owner = currentProjectOwner(options.rootDir);
  if (!owner)
    throw new ProjectOwnerError(
      "VEXT_OWNER_CLOSED",
      "Temporary artifact execution requires a project owner.",
    );
  await owner.assertActive();
  const root = owner.identity.realRoot;
  const logical = artifactPath(
    root,
    artifactRelativePath(root, options.logicalPath),
  );
  const extension = path.extname(logical);
  if (extension !== ".mjs" && extension !== ".cjs")
    throw new ArtifactError(
      "VEXT_OUTPUT_UNVERIFIED",
      "Temporary module must be .mjs or .cjs.",
    );
  await owner.reserveOutputs([
    // 项目根已由 root owner 独占；一般输出锁仍禁止把整个根作为产物目录。
    ...(path.relative(root, path.dirname(logical)) === ""
      ? []
      : [path.dirname(logical)]),
    path.join(root, DIRECTORY),
  ]);
  await recoverTemporaryArtifacts(owner);
  if (readReceipts(root).length >= MAX_RECEIPTS)
    throw new ArtifactError(
      "VEXT_OUTPUT_UNVERIFIED",
      "Too many active temporary artifacts.",
    );
  const id = randomUUID();
  const file = artifactRelativePath(
    root,
    path.join(path.dirname(logical), `.vext-exec-${id}${extension}`),
  );
  const receiptFile = `${DIRECTORY}/${id}.json`;
  const contents = Buffer.from(options.contents);
  const receipt: TemporaryReceipt = {
    schemaVersion: 1,
    realRoot: root,
    id,
    file,
    sha256: artifactDigest(contents),
  };
  const endpoint = await listenOwnerEndpoint(
    endpointKey(root, id),
    () => owner.writerIdentity,
  );
  let recorded = false;
  let created = false;
  let failure: unknown;
  try {
    fs.mkdirSync(artifactPath(root, DIRECTORY), { recursive: true });
    fs.writeFileSync(
      artifactPath(root, receiptFile),
      `${JSON.stringify(receipt)}\n`,
      { flag: "wx" },
    );
    recorded = true;
    fs.mkdirSync(path.dirname(logical), { recursive: true });
    const handle = fs.openSync(artifactPath(root, file), "wx");
    created = true;
    try {
      fs.writeFileSync(handle, contents);
    } finally {
      fs.closeSync(handle);
    }
    return await operation(artifactPath(root, file));
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      if (recorded) {
        if (created) removeTemporary(root, receiptFile, receipt);
        else fs.unlinkSync(artifactPath(root, receiptFile));
      }
    } catch (cleanupError) {
      if (failure)
        throw new AggregateError(
          [failure, cleanupError],
          "Temporary artifact execution and cleanup failed.",
        );
      throw cleanupError;
    } finally {
      await endpoint.close();
    }
  }
}
