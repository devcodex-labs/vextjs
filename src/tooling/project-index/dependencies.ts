import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { readProjectFile } from "../../lib/project/read-project-file.js";

/** 仅读取实际解析包的元信息；不会导入入口或遍历 node_modules。 */
export const ANALYSIS_DEPENDENCIES = [
  "vextjs",
  "schema-dsl",
  "response-cache-kit",
  "flex-rate-limit",
  "esbuild",
  "monsqlize",
  "cache-hub",
  "croner",
  "react",
  "react-dom",
  "oxc-parser",
  "ioredis",
  "@modelcontextprotocol/server",
] as const;

export interface ProjectDependencyFact {
  name: string;
  owner: "service" | "framework";
  declaredRange: string | null;
  state: "resolved" | "not-installed" | "unverified";
  version: string | null;
  resolvedRoot: string | null;
  manifestDigest: string | null;
  reason?: string;
}

interface PackageEvidence {
  root: string;
  manifest: Record<string, unknown>;
  digest: string;
}
const digest = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export function inspectProjectDependencies(
  rootDir: string,
  manifest: Record<string, unknown> | null,
  signal?: AbortSignal,
) {
  const evidence: PackageEvidence[] = [];
  const facts: ProjectDependencyFact[] = [];
  let framework: PackageEvidence | undefined;
  const requests = ANALYSIS_DEPENDENCIES.flatMap(
    (name): Array<{ name: string; owner: ProjectDependencyFact["owner"] }> =>
      name === "vextjs"
        ? [{ name, owner: "service" }]
        : [
            { name, owner: "framework" },
            ...(dependencyRange(manifest, name) !== null
              ? [{ name, owner: "service" as const }]
              : []),
          ],
  );
  for (const { name, owner } of requests) {
    signal?.throwIfAborted();
    const ownerRoot = owner === "service" ? rootDir : framework?.root;
    const declaredRange = dependencyRange(
      owner === "service" ? manifest : (framework?.manifest ?? null),
      name,
    );
    const fact: ProjectDependencyFact = {
      name,
      owner,
      declaredRange,
      state: "not-installed",
      version: null,
      resolvedRoot: null,
      manifestDigest: null,
    };
    try {
      const installed =
        name === "vextjs" && manifest?.name === "vextjs"
          ? readPackage(rootDir, name)
          : ownerRoot
            ? resolvePackage(ownerRoot, name)
            : undefined;
      if (installed) {
        evidence.push(installed);
        fact.state = "resolved";
        fact.version = String(installed.manifest.version);
        fact.resolvedRoot = installed.root;
        fact.manifestDigest = installed.digest;
        if (name === "vextjs") framework = installed;
      } else
        fact.reason = ownerRoot
          ? "No installed package was resolved from this owner."
          : "The service's Vext package is unavailable; its transitive dependency version is unknown.";
    } catch (error) {
      fact.state = "unverified";
      fact.reason = String(error);
    }
    facts.push(fact);
  }
  // 依赖元信息和源码一样需要变化检测；不把请求中途更换的安装目录当成当前版本。
  for (const item of evidence) {
    signal?.throwIfAborted();
    const current = readProjectFile(item.root, "package.json", 256 * 1024);
    if (!current || digest(current) !== item.digest)
      throw new Error(
        "Installed dependency metadata changed during inspection. Inspect again.",
      );
  }
  return {
    facts,
    digest: digest(
      JSON.stringify(
        facts.map(({ resolvedRoot: _root, reason: _reason, ...fact }) => fact),
      ),
    ),
  };
}

function resolvePackage(
  ownerRoot: string,
  name: string,
): PackageEvidence | undefined {
  const require = createRequire(path.join(ownerRoot, "package.json"));
  const locations = require.resolve.paths(name) ?? [];
  if (locations.length > 64)
    throw new Error(
      "Dependency resolution search exceeded its directory budget.",
    );
  for (const directory of locations) {
    const packageRoot = path.join(directory, name);
    if (existsSync(path.join(packageRoot, "package.json")))
      return readPackage(packageRoot, name);
  }
  // Plug'n'Play 等宿主解析器可能没有常规 node_modules；仅定位入口，不执行入口。
  try {
    let directory = path.dirname(require.resolve(name));
    for (let depth = 0; depth < 12; depth++) {
      if (existsSync(path.join(directory, "package.json"))) {
        const found = readPackage(directory);
        if (found?.manifest.name === name) return found;
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  } catch (error) {
    if (
      !["MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    )
      throw error;
  }
  return undefined;
}

function readPackage(
  root: string,
  expectedName?: string,
): PackageEvidence | undefined {
  root = realpathSync.native(root);
  const bytes = readProjectFile(root, "package.json", 256 * 1024);
  if (!bytes) return undefined;
  const value: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Installed package metadata must be an object.");
  const manifest = value as Record<string, unknown>;
  if (
    typeof manifest.version !== "string" ||
    (expectedName && manifest.name !== expectedName)
  )
    throw new Error(
      "Installed package name/version does not match the requested dependency.",
    );
  return { root, manifest, digest: digest(bytes) };
}

function dependencyRange(
  manifest: Record<string, unknown> | null,
  name: string,
): string | null {
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const dependencies = manifest?.[field];
    if (
      dependencies &&
      typeof dependencies === "object" &&
      !Array.isArray(dependencies)
    ) {
      const value = (dependencies as Record<string, unknown>)[name];
      if (typeof value === "string") return value;
    }
  }
  return null;
}
