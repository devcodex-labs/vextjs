import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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

export interface BuildIdentity {
  schemaVersion: 1;
  status: "building" | "ready";
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
): BuildIdentity | undefined {
  assertRealPathInside(rootDir, file, "build identity");
  if (!existsSync(file)) return undefined;
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as BuildIdentity;
    if (
      !value ||
      value.schemaVersion !== 1 ||
      !["ready", "building"].includes(value.status) ||
      !["compiled", "source"].includes(value.backend) ||
      typeof value.buildId !== "string" ||
      !value.buildId ||
      typeof value.outDir !== "string" ||
      typeof value.profile !== "string"
    )
      throw new Error("unsupported or incomplete build identity");
    normalizeSafeRelativePath(value.outDir, "build outdir");
    validateConfigProfileName(value.profile, "build profile");
    safeOutput(rootDir, value.outDir);
    return value;
  } catch (error) {
    throw new Error(
      `[vextjs] Invalid ${file}: ${error instanceof Error ? error.message : String(error)}. Rebuild with an explicit --outdir to recover.`,
    );
  }
}

/** CLI、检查与运行时共用目录选择。显式目录可绕过损坏的位置索引重建。 */
export function resolveBuildLocation(
  rootDir: string,
  explicitOutDir = process.env.VEXT_BUILD_OUTDIR,
): BuildLocation {
  const recorded =
    explicitOutDir === undefined
      ? readIdentity(rootDir, join(rootDir, LOCATION_FILE))
      : undefined;
  const outDir = safeOutput(
    rootDir,
    explicitOutDir ?? recorded?.outDir ?? "dist",
  );
  const marker = readIdentity(rootDir, join(outDir, IDENTITY_FILE));
  const identity = recorded ?? marker;
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
    ...(mismatch
      ? {
          failure:
            "build identity is missing, incomplete or does not match the last successful build; run vext build",
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
      ? readIdentity(rootDir, join(rootDir, LOCATION_FILE))
      : undefined;
  return safeOutput(rootDir, override ?? recorded?.outDir ?? "dist");
}

function writeIdentity(
  rootDir: string,
  file: string,
  value: BuildIdentity,
): void {
  assertRealPathInside(rootDir, file, "build identity");
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
    });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function beginBuild(
  rootDir: string,
  outDir: string,
  profile: string,
  backend: BuildIdentity["backend"],
): BuildIdentity {
  const identity: BuildIdentity = {
    schemaVersion: 1,
    status: "building",
    outDir: relative(rootDir, safeOutput(rootDir, outDir)).replace(/\\/g, "/"),
    buildId: randomUUID(),
    profile: validateConfigProfileName(profile),
    backend,
  };
  writeIdentity(rootDir, join(outDir, IDENTITY_FILE), identity);
  return identity;
}

/** 后端、前端和可选上传全部成功后才推进位置索引；两文件不匹配时读取端拒绝启动。 */
export function completeBuild(rootDir: string, identity: BuildIdentity): void {
  const ready: BuildIdentity = { ...identity, status: "ready" };
  const outDir = safeOutput(rootDir, identity.outDir);
  writeIdentity(rootDir, join(outDir, IDENTITY_FILE), ready);
  writeIdentity(rootDir, join(rootDir, LOCATION_FILE), ready);
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
