import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { withProjectOwner } from "../project/owner.js";
import {
  withArtifactGroupTransaction,
  type ArtifactScopeUpdate,
} from "../project/artifact-transaction.js";
import {
  ARTIFACT_JOURNAL_FILE,
  ARTIFACT_MANIFEST_FILE,
  MAX_ARTIFACT_METADATA_BYTES,
  ArtifactError,
  artifactDigest,
  artifactRelativePath,
  parseArtifactManifest,
  readArtifactFile,
} from "../project/artifact-manifest.js";
import { artifactFileKey } from "../project/artifact-scope.js";
import { validateConfigProfileName } from "../config-profile.js";
import {
  assertRealPathInside,
  assertSafeProjectOutputDirectory,
  isPathInside,
  normalizeSafeRelativePath,
} from "../path-boundary.js";
import type { VextFrontendUserConfig } from "../../frontend/contract/types.js";

const LOCATION_FILE = ".vext/build-location.json";
const IDENTITY_FILE = ".vext-build.json";
const MAX_IDENTITY_BYTES = 16 * 1024;

export interface BuildIdentity {
  schemaVersion: 1;
  status: "building" | "ready" | "failed";
  outDir: string;
  buildId: string;
  profile: string;
  backend: "compiled" | "source";
}

export interface BuildLocation {
  outDir: string;
  identity?: BuildIdentity;
  /** 结构可读但构建未成功或身份不匹配；重建可恢复，启动不可消费。 */
  failure?: string;
}

function safeOutput(rootDir: string, value: string): string {
  const output = assertSafeProjectOutputDirectory(
    rootDir,
    resolve(rootDir, value),
    "build outdir",
  );
  const metadata = join(rootDir, ".vext");
  // 后端生产清理不得包含运行态，也不得借内部 symlink 覆盖源码。
  const real = assertRealPathInside(rootDir, output, "build outdir");
  for (const protectedRoot of [
    metadata,
    ...["src", "test", "tests", "node_modules", ".git"].map((name) =>
      join(rootDir, name),
    ),
  ]) {
    const protectedReal = existsSync(protectedRoot)
      ? realpathSync(protectedRoot)
      : resolve(protectedRoot);
    if (
      isPathInside(protectedRoot, output, true) ||
      isPathInside(output, protectedRoot, true) ||
      isPathInside(protectedReal, real, true) ||
      isPathInside(real, protectedReal, true)
    ) {
      throw new Error(
        "[vextjs] build outdir must not overlap protected project paths or .vext metadata.",
      );
    }
  }
  return output;
}

function readIdentity(
  rootDir: string,
  file: string,
): { identity: BuildIdentity; bytes: Buffer } | undefined {
  try {
    const bytes = readArtifactFile(
      rootDir,
      artifactRelativePath(rootDir, file),
      MAX_IDENTITY_BYTES,
    );
    if (bytes === null) return undefined;
    const value = JSON.parse(bytes.toString("utf8")) as BuildIdentity;
    if (
      !value ||
      value.schemaVersion !== 1 ||
      !["ready", "building", "failed"].includes(value.status) ||
      !["compiled", "source"].includes(value.backend) ||
      typeof value.buildId !== "string" ||
      !value.buildId ||
      value.buildId.length > 128 ||
      typeof value.outDir !== "string" ||
      typeof value.profile !== "string"
    )
      throw new Error("unsupported or incomplete build identity");
    normalizeSafeRelativePath(value.outDir, "build outdir");
    validateConfigProfileName(value.profile, "build profile");
    safeOutput(rootDir, value.outDir);
    return { identity: value, bytes };
  } catch (error) {
    throw new Error(
      `[vextjs] Invalid ${file}: ${error instanceof Error ? error.message : String(error)}. Select an explicit --outdir to rebuild; resolve recorded ownership conflicts before retrying.`,
    );
  }
}

function readBuildOwnership(rootDir: string): Map<string, string> {
  const realRoot = realpathSync.native(resolve(rootDir));
  const manifest = parseArtifactManifest(
    readArtifactFile(
      rootDir,
      ARTIFACT_MANIFEST_FILE,
      MAX_ARTIFACT_METADATA_BYTES,
    ),
    process.platform === "win32" ? realRoot.toLowerCase() : realRoot,
  );
  return new Map(
    manifest.scopes.flatMap((scope) =>
      scope.files.map(
        (file) => [artifactFileKey(file.path), file.sha256] as const,
      ),
    ),
  );
}

/** CLI、检查与运行时共用目录选择。显式目录可绕过损坏的位置索引重建。 */
export function resolveBuildLocation(
  rootDir: string,
  explicitOutDir = process.env.VEXT_BUILD_OUTDIR,
): BuildLocation {
  const recordedFile =
    explicitOutDir === undefined
      ? readIdentity(rootDir, join(rootDir, LOCATION_FILE))
      : undefined;
  const recorded = recordedFile?.identity;
  const outDir = safeOutput(
    rootDir,
    explicitOutDir ?? recorded?.outDir ?? "dist",
  );
  const markerPath = join(outDir, IDENTITY_FILE);
  const markerFile = readIdentity(rootDir, markerPath);
  const marker = markerFile?.identity;
  const identity = recorded ?? marker;
  const pendingTransaction =
    readArtifactFile(
      rootDir,
      ARTIFACT_JOURNAL_FILE,
      MAX_ARTIFACT_METADATA_BYTES,
    ) !== null;
  const managedFiles = readBuildOwnership(rootDir);
  const selected = [
    { file: markerPath, bytes: markerFile?.bytes },
    ...(explicitOutDir === undefined
      ? [{ file: join(rootDir, LOCATION_FILE), bytes: recordedFile?.bytes }]
      : []),
  ];
  const ownershipMismatch = selected.some(({ file, bytes }) => {
    const digest = managedFiles.get(
      artifactFileKey(artifactRelativePath(rootDir, file)),
    );
    return (
      digest !== undefined &&
      (bytes === undefined || artifactDigest(bytes) !== digest)
    );
  });
  const mismatch =
    identity &&
    (!marker ||
      marker.status !== "ready" ||
      identity.status !== "ready" ||
      marker.buildId !== identity.buildId ||
      marker.profile !== identity.profile ||
      marker.backend !== identity.backend ||
      marker.outDir !== identity.outDir ||
      resolve(rootDir, identity.outDir) !== outDir);
  return {
    outDir,
    identity,
    ...(pendingTransaction || ownershipMismatch || mismatch
      ? {
          failure: pendingTransaction
            ? "an artifact transaction is pending; rebuild to recover before starting"
            : "build identity is missing, incomplete or does not match the last successful build; run vext build",
        }
      : {}),
  };
}

/** 构建开始只选择目录，允许修复损坏/中断的输出身份。 */
export function selectBuildOutput(
  rootDir: string,
  explicitOutDir?: string,
): string {
  const override = explicitOutDir ?? process.env.VEXT_BUILD_OUTDIR;
  const recorded =
    override === undefined
      ? readIdentity(rootDir, join(rootDir, LOCATION_FILE))?.identity
      : undefined;
  if (
    override === undefined &&
    !recorded &&
    readBuildOwnership(rootDir).has(artifactFileKey(LOCATION_FILE))
  ) {
    throw new ArtifactError(
      "VEXT_OUTPUT_UNVERIFIED",
      "The recorded build location is missing; select an explicit --outdir to rebuild.",
    );
  }
  return safeOutput(rootDir, override ?? recorded?.outDir ?? "dist");
}

/** 固定控制文件的旧版本迁移与后续状态写入共用产物事务；不开放任意覆盖接口。 */
async function publishBuildIdentities(
  rootDir: string,
  records: { file: string; value: BuildIdentity }[],
  validateCurrent: () => boolean = () => true,
): Promise<void> {
  const updates: ArtifactScopeUpdate[] = records.map(({ file, value }) => ({
    producer: "build-state",
    outDir: dirname(file),
    mode: "merge",
    files: [{ path: file, contents: `${JSON.stringify(value, null, 2)}\n` }],
  }));
  await withProjectOwner(
    rootDir,
    "build",
    updates.map((update) => update.outDir),
    () =>
      withArtifactGroupTransaction(
        { rootDir, outputs: updates },
        async (transaction) => {
          if (!validateCurrent()) return;
          // 先登记尚未受管的旧控制文件原字节，使后续 journal 能验证与恢复前值。
          // 已受管文件仍受原摘要约束；外部修改不能借迁移重新认证。
          const legacy = updates
            .map((update) => ({
              ...update,
              files: update.files.flatMap((file) => {
                const bytes = readArtifactFile(
                  rootDir,
                  artifactRelativePath(rootDir, file.path),
                  MAX_IDENTITY_BYTES,
                );
                return bytes === null
                  ? []
                  : [{ path: file.path, contents: bytes }];
              }),
            }))
            .filter((update) => update.files.length > 0);
          if (legacy.length) await transaction.commit(legacy);
          await transaction.commit(updates);
        },
      ),
  );
}

function currentBuildIdentity(
  rootDir: string,
  expected: BuildIdentity,
): BuildIdentity {
  const file = join(safeOutput(rootDir, expected.outDir), IDENTITY_FILE);
  const current = readIdentity(rootDir, file)?.identity;
  if (
    !current ||
    current.buildId !== expected.buildId ||
    current.profile !== expected.profile ||
    current.backend !== expected.backend ||
    current.outDir !== expected.outDir
  ) {
    throw new ArtifactError(
      "VEXT_OUTPUT_CONFLICT",
      `Build identity changed before completion: ${file}`,
    );
  }
  return current;
}

export async function beginBuild(
  rootDir: string,
  outDir: string,
  profile: string,
  backend: BuildIdentity["backend"],
): Promise<BuildIdentity> {
  const identity: BuildIdentity = {
    schemaVersion: 1,
    status: "building",
    outDir: relative(rootDir, safeOutput(rootDir, outDir)).replace(/\\/g, "/"),
    buildId: randomUUID(),
    profile: validateConfigProfileName(profile),
    backend,
  };
  await publishBuildIdentities(rootDir, [
    {
      file: join(safeOutput(rootDir, identity.outDir), IDENTITY_FILE),
      value: identity,
    },
  ]);
  return Object.freeze(identity);
}

/** 后端、前端和可选上传全部成功后，一次提交输出身份及位置索引。 */
export async function completeBuild(
  rootDir: string,
  identity: BuildIdentity,
): Promise<void> {
  const ready: BuildIdentity = { ...identity, status: "ready" };
  const outDir = safeOutput(rootDir, identity.outDir);
  await publishBuildIdentities(
    rootDir,
    [
      { file: join(outDir, IDENTITY_FILE), value: ready },
      { file: join(rootDir, LOCATION_FILE), value: ready },
    ],
    () => {
      if (currentBuildIdentity(rootDir, identity).status === "failed") {
        throw new ArtifactError(
          "VEXT_OUTPUT_CONFLICT",
          "A failed build must be rebuilt before completion.",
        );
      }
      return true;
    },
  );
}

/** 只标记本次未完成代；不推进成功位置，也不撤销已经完成的提交。 */
export async function failBuild(
  rootDir: string,
  identity: BuildIdentity,
): Promise<void> {
  await publishBuildIdentities(
    rootDir,
    [
      {
        file: join(safeOutput(rootDir, identity.outDir), IDENTITY_FILE),
        value: { ...identity, status: "failed" },
      },
    ],
    () => currentBuildIdentity(rootDir, identity).status === "building",
  );
}

export function resolveRuntimeBuildDirectory(rootDir: string): string {
  const location = resolveBuildLocation(rootDir);
  if (
    location.failure ||
    (process.env.VEXT_BUILD_ID &&
      process.env.VEXT_BUILD_ID !== location.identity?.buildId)
  ) {
    throw new Error(
      `[vextjs] ${location.failure ?? "build changed between CLI selection and startup; restart after build completes"}`,
    );
  }
  return location.outDir;
}

/** 配置中的显式 frontend.outDir 优先；默认前端目录跟随后端构建位置。 */
export function withBuildFrontendOutDir(
  frontend: VextFrontendUserConfig | undefined,
  outDir: string,
): VextFrontendUserConfig | undefined {
  if (outDir === "dist" || frontend === undefined || frontend === false)
    return frontend;
  const clientOutDir = join(outDir, "client");
  if (frontend === true) return { enabled: true, outDir: clientOutDir };
  return frontend.outDir ? frontend : { ...frontend, outDir: clientOutDir };
}
