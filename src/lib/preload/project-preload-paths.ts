import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Canonical project source directory for application preloads. */
export const PROJECT_PRELOAD_DIR = "src/preload";

/** Compatibility-only project-root directory used by older applications. */
export const LEGACY_PROJECT_PRELOAD_DIR = "preload";

/** Directory name relative to the configured build output. */
export const PROJECT_PRELOAD_OUTPUT_DIR = "preload";

/** Default production output directory for project preloads. */
export const DIST_PRELOAD_DIR = `dist/${PROJECT_PRELOAD_OUTPUT_DIR}`;

export const PROJECT_PRELOAD_FILE_PATTERN = /\.(ts|mts|js|mjs)$/i;

export type ProjectPreloadDirectoryKind = "canonical" | "legacy";

export interface ProjectPreloadDirectory {
  path: string;
  relativePath: string;
  kind: ProjectPreloadDirectoryKind;
  hasSourceFiles: boolean;
}

/**
 * Resolves a project preload source directory without silently combining the
 * canonical and legacy locations. Preloads are side-effectful and their order
 * is part of application startup, so two populated locations are a migration
 * error rather than an implicit merge.
 */
export function resolveProjectPreloadDirectory(
  rootDir: string,
): ProjectPreloadDirectory | null {
  const canonical = projectPreloadDirectory(
    rootDir,
    PROJECT_PRELOAD_DIR,
    "canonical",
  );
  const legacy = projectPreloadDirectory(
    rootDir,
    LEGACY_PROJECT_PRELOAD_DIR,
    "legacy",
  );

  const canonicalHasFiles = canonical?.hasSourceFiles ?? false;
  const legacyHasFiles = legacy?.hasSourceFiles ?? false;

  if (canonicalHasFiles && legacyHasFiles) {
    throw new Error(
      "[vextjs] preload: found preload files in both src/preload/ and legacy preload/. Move the legacy files into src/preload/ before starting.",
    );
  }

  if (canonicalHasFiles) return canonical;
  if (legacyHasFiles) return legacy;
  return canonical ?? null;
}

export function formatLegacyProjectPreloadWarning(): string {
  return "[vextjs] preload: project-root preload/ is deprecated; move files to src/preload/.";
}

function projectPreloadDirectory(
  rootDir: string,
  relativePath: string,
  kind: ProjectPreloadDirectoryKind,
): ProjectPreloadDirectory | null {
  const directory = join(rootDir, relativePath);
  if (!isDirectory(directory)) return null;
  return {
    path: directory,
    relativePath,
    kind,
    hasSourceFiles: hasProjectPreloadFiles(directory),
  };
}

function hasProjectPreloadFiles(directory: string): boolean {
  return readdirSync(directory, { withFileTypes: true }).some(
    (entry) => entry.isFile() && PROJECT_PRELOAD_FILE_PATTERN.test(entry.name),
  );
}

function isDirectory(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}
