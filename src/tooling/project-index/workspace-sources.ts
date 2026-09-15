import fs from "node:fs";
import path from "node:path";
import { resolvePathInside } from "../../lib/path-boundary.js";
import { declaredExport } from "./source-input.js";
import type { RootRef, SourceView } from "../source-view/types.js";
import { parse, type ParseError } from "jsonc-parser";
import { createHash } from "node:crypto";
import { readProjectFile } from "../../lib/project/read-project-file.js";
import { normalizeSourcePath } from "../source-view/policy.js";
import { SourceViewError } from "../source-view/types.js";

/** Workspace 中与静态源码归属有关的声明；不依赖任何 MCP 宿主或 SDK。 */
export interface WorkspaceSourceDeclarations {
  services?: Array<{ id: string; root: string; sharedPackages?: string[] }>;
  sharedPackages?: Array<{
    id: string;
    root: string;
    kind: "contracts" | "models" | "ui" | "config" | "utility" | "test-support";
    sourceExports: Record<string, string>;
  }>;
}

/** 只投影读取范围，宿主、命名、风格策略仍由其消费者校验；正文须在最终视图复核。 */
export function readWorkspaceSourceDeclarations(rootDir: string) {
  for (const file of ["vext.workspace.json", "vext.workspace.jsonc"]) {
    const bytes = readProjectFile(rootDir, file, 2 * 1024 * 1024);
    if (bytes === null) continue;
    const errors: ParseError[] = [];
    const value: unknown = parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      errors,
      {
        allowTrailingComma: file.endsWith(".jsonc"),
        disallowComments: !file.endsWith(".jsonc"),
      },
    );
    const record = object(value);
    if (errors.length || record.schemaVersion !== 1)
      throw invalid("Invalid workspace source declaration.");
    const workspace: WorkspaceSourceDeclarations = {};
    if (record.services !== undefined)
      workspace.services = entries(record.services).map((entry) => {
        const item = object(entry);
        if (typeof item.id !== "string" || !item.id)
          throw invalid("Service id is required.");
        return {
          id: item.id,
          root: directory(item.root),
          sharedPackages: strings(item.sharedPackages ?? []),
        };
      });
    if (record.sharedPackages !== undefined)
      workspace.sharedPackages = entries(record.sharedPackages).map((entry) => {
        const item = object(entry);
        if (
          typeof item.id !== "string" ||
          !item.id ||
          ![
            "contracts",
            "models",
            "ui",
            "config",
            "utility",
            "test-support",
          ].includes(String(item.kind))
        )
          throw invalid("Invalid shared source package identity.");
        const sourceExports = Object.fromEntries(
          Object.entries(object(item.sourceExports)).map(([key, value]) => [
            key,
            normalizeSourcePath(directory(value)),
          ]),
        );
        return {
          id: item.id,
          root: directory(item.root),
          kind: item.kind as NonNullable<
            WorkspaceSourceDeclarations["sharedPackages"]
          >[number]["kind"],
          sourceExports,
        };
      });
    for (const entries of [
      workspace.services ?? [],
      workspace.sharedPackages ?? [],
    ]) {
      const ids = new Set<string>();
      for (const item of entries) {
        if (ids.has(item.id))
          throw invalid(
            "Workspace source ids must be unique within their collection.",
          );
        ids.add(item.id);
      }
    }
    const packageIds = new Set(
      workspace.sharedPackages?.map((item) => item.id),
    );
    for (const service of workspace.services ?? [])
      if (service.sharedPackages?.some((id) => !packageIds.has(id)))
        throw invalid("A service references an undeclared shared package.");
    return {
      rootDir,
      file,
      digest: createHash("sha256").update(bytes).digest("hex"),
      workspace,
    };
  }
  return undefined;
}

function invalid(message: string) {
  return new SourceViewError("VEXT_SOURCE_UNVERIFIED", message);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid("Workspace source entry must be an object.");
  return value as Record<string, unknown>;
}
function entries(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 100)
    throw invalid("Workspace source arrays must contain at most 100 entries.");
  return value;
}
function strings(value: unknown): string[] {
  const result = entries(value);
  if (result.some((item) => typeof item !== "string" || !item))
    throw invalid("Workspace references must be strings.");
  return result as string[];
}
function directory(value: unknown): string {
  if (value === ".") return ".";
  if (typeof value !== "string")
    throw invalid("Workspace source paths must be strings.");
  return normalizeSourcePath(value);
}

/** 只向上探测有限个明确的 workspace 文件；仅接纳声明了当前服务的最近工作区。 */
export function findWorkspaceSourceDeclarations(rootDir: string) {
  let directory = fs.realpathSync.native(rootDir);
  for (let depth = 0; depth < 9; depth++) {
    const workspace = readWorkspaceSourceDeclarations(directory);
    if (workspace) {
      if (
        depth === 0 ||
        workspace.workspace.services?.some((service) => {
          const target = resolvePathInside(
            directory,
            service.root,
            "workspace service",
            { realpath: true, allowRoot: true },
          );
          return (
            fs.existsSync(target) &&
            path.relative(fs.realpathSync.native(target), rootDir) === ""
          );
        })
      )
        return workspace;
      return undefined;
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

export interface WorkspacePackageSource {
  root: RootRef;
  declaredRoot: string;
  metadataDigest: string;
  consumerFiles: string[];
  consumerDigests: Record<string, string>;
}

/** sourceExports 是源码映射，必须与真实包公开面和声明消费者的依赖同时成立。 */
export function resolveWorkspacePackageSources(
  workspaceRoot: string,
  serviceRoot: string,
  workspace: WorkspaceSourceDeclarations,
): WorkspacePackageSource[] {
  const service = workspace.services?.find(
    (item) =>
      path.relative(path.resolve(workspaceRoot, item.root), serviceRoot) === "",
  );
  const selected =
    workspace.sharedPackages?.filter(
      (item) =>
        workspaceRoot === serviceRoot ||
        service?.sharedPackages?.includes(item.id),
    ) ?? [];
  const names = new Set<string>();
  const metadataCache = new Map<string, ReturnType<typeof packageMetadata>>();
  const readMetadata = (directory: string) => {
    let metadata = metadataCache.get(directory);
    if (!metadata) {
      metadata = packageMetadata(directory);
      metadataCache.set(directory, metadata);
    }
    return metadata;
  };
  return selected.map((item) => {
    const declaredRoot = resolvePathInside(
      workspaceRoot,
      item.root,
      "shared source package",
      { realpath: true },
    );
    const realPath = fs.realpathSync.native(declaredRoot);
    const metadata = readMetadata(realPath);
    if (
      typeof metadata.value.name !== "string" ||
      !metadata.value.name ||
      names.has(metadata.value.name)
    )
      throw invalid("Shared packages require distinct actual package names.");
    names.add(metadata.value.name);
    for (const [key, source] of Object.entries(item.sourceExports)) {
      if (!declaredExport(metadata.value.exports, key))
        throw invalid(
          "Shared source export is not publicly declared: " +
            metadata.value.name +
            " " +
            key,
        );
      if (
        !/\.[cm]?[jt]sx?$/u.test(source) ||
        /(?:^|\/)(?:dist|node_modules|\.vext)(?:\/|$)/u.test(source)
      )
        throw invalid("Shared source exports must identify source modules.");
      const target = resolvePathInside(
        realPath,
        source,
        "shared source export",
        { realpath: true },
      );
      if (!fs.existsSync(target) || !fs.statSync(target).isFile())
        throw invalid("Shared source export is missing: " + source);
    }
    const consumerFiles: string[] = [];
    const consumerDigests: Record<string, string> = {};
    for (const consumer of workspace.services ?? []) {
      if (!consumer.sharedPackages?.includes(item.id)) continue;
      const directory =
        consumer.root === "."
          ? workspaceRoot
          : resolvePathInside(
              workspaceRoot,
              consumer.root,
              "workspace consumer",
              { realpath: true },
            );
      const consumerEvidence = readMetadata(directory);
      const consumerMetadata = consumerEvidence.value;
      const declared = [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
      ].some((key) => {
        const dependencies = consumerMetadata[key];
        return (
          dependencies &&
          typeof dependencies === "object" &&
          typeof (dependencies as Record<string, unknown>)[
            metadata.value.name as string
          ] === "string"
        );
      });
      if (!declared)
        throw invalid(
          "Shared package " +
            metadata.value.name +
            " is absent from consumer " +
            consumer.id +
            " dependencies.",
        );
      const file = path.posix.join(consumer.root, "package.json");
      consumerFiles.push(file);
      consumerDigests[file] = consumerEvidence.digest;
    }
    return {
      root: {
        id: "workspace-package-" + item.id,
        kind: "shared",
        realPath,
        packageName: metadata.value.name,
        sourceExports: item.sourceExports,
      },
      declaredRoot,
      metadataDigest: metadata.digest,
      consumerFiles,
      consumerDigests,
    };
  });
}

export function verifyWorkspacePackageSources(
  view: SourceView,
  packages: readonly WorkspacePackageSource[],
  workspaceRootId: string,
) {
  for (const item of packages) {
    for (const [file, digest] of Object.entries(item.consumerDigests))
      if (view.record(workspaceRootId, file)?.sha256 !== digest)
        throw new SourceViewError(
          "VEXT_SOURCE_CHANGED",
          "Workspace consumer dependencies changed during collection.",
        );
    if (
      view.record(item.root.id, "package.json")?.sha256 !==
        item.metadataDigest ||
      path.relative(
        fs.realpathSync.native(item.declaredRoot),
        item.root.realPath,
      ) !== ""
    )
      throw new SourceViewError(
        "VEXT_SOURCE_CHANGED",
        "Shared package metadata or directory changed during collection.",
      );
  }
}

function packageMetadata(root: string) {
  const bytes = readProjectFile(root, "package.json", 256 * 1024);
  if (!bytes) throw invalid("Declared source package is missing package.json.");
  return {
    value: object(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    ),
    digest: createHash("sha256").update(bytes).digest("hex"),
  };
}
