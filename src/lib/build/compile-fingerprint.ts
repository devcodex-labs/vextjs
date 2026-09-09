import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { version as esbuildVersion } from "esbuild";
import { parse, type ParseError } from "jsonc-parser";
import packageMetadata from "../../../package.json" with { type: "json" };
import { artifactDigest } from "../project/artifact-manifest.js";

export interface CompileFingerprint {
  digest: string;
  complete: boolean;
  problems: string[];
}

export interface CompileFingerprintOptions {
  rootDir: string;
  srcDir: string;
  entryPoints: readonly string[];
  tsconfig?: string;
  parameters: Record<string, unknown>;
}

const METADATA_NAMES = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
];
const METADATA_LIMIT = 16 * 1024 * 1024;

/**
 * 仅读取内容身份与配置依赖边，编译语义仍由 esbuild 决定。
 * 无法完整解析的 extends/references 允许编译器自行诊断，但绝不产生缓存命中。
 */
export function createCompileFingerprint(
  options: CompileFingerprintOptions,
): CompileFingerprint {
  const files = new Map<string, string | null>();
  const problems = new Set<string>();
  const configurations = new Set<string>();
  const visiting = new Set<string>();
  const directories = new Set<string>();
  const configPackages = new Set<string>();
  const read = (file: string, metadata = true): Buffer | null => {
    const absolute = path.resolve(file);
    try {
      const stat = fs.statSync(absolute);
      if (!stat.isFile() || (metadata && stat.size > METADATA_LIMIT))
        throw new Error("Invalid file or metadata size");
      const bytes = fs.readFileSync(absolute);
      files.set(absolute, artifactDigest(bytes));
      return bytes;
    } catch (error) {
      files.set(absolute, null);
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        problems.add(`Cannot read compile input ${absolute}: ${String(error)}`);
      return null;
    }
  };
  const captureConfigPackage = (
    from: string,
    request: string,
    depth: number,
  ): void => {
    const parts = request.split("/");
    const packageName = parts
      .slice(0, request.startsWith("@") ? 2 : 1)
      .join("/");
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/iu.test(packageName)) {
      problems.add(`Unknown config package request: ${request}`);
      return;
    }
    let ancestor = path.dirname(from);
    let packageRoot: string | undefined;
    while (true) {
      const candidate = path.join(ancestor, "node_modules", packageName);
      read(path.join(candidate, "package.json"));
      try {
        if (fs.statSync(candidate).isDirectory()) {
          packageRoot = candidate;
          break;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          problems.add(`Cannot inspect config package: ${candidate}`);
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
    if (!packageRoot) {
      problems.add(`Missing config package: ${request}`);
      return;
    }
    const real = fs.realpathSync(packageRoot);
    if (configPackages.has(real)) return;
    configPackages.add(real);
    // Node 的 require.resolve 会缓存包映射。包内 JSON 候选与其继承边一起计入，
    // 避免 exports/main 重定向后仅跟踪旧解析路径；这里不解释这些字段的语义。
    const pending = [packageRoot];
    const configs: string[] = [];
    let entries = 0;
    let bytesRead = 0;
    while (pending.length) {
      const directory = fs.opendirSync(pending.pop()!);
      try {
        let entry: fs.Dirent | null;
        while ((entry = directory.readSync()) !== null) {
          if (++entries > 512 || bytesRead > METADATA_LIMIT) {
            problems.add(
              `Config package exceeds its evidence limit: ${packageRoot}`,
            );
            return;
          }
          const file = path.join(directory.path, entry.name);
          if (entry.isSymbolicLink()) {
            problems.add(
              `Linked config package member needs explicit evidence: ${file}`,
            );
            continue;
          }
          if (entry.isDirectory()) pending.push(file);
          else if (entry.isFile() && entry.name.endsWith(".json")) {
            const bytes = read(file);
            bytesRead += bytes?.length ?? 0;
            if (bytesRead > METADATA_LIMIT) {
              problems.add(
                `Config package exceeds its evidence limit: ${packageRoot}`,
              );
              return;
            }
            if (entry.name !== "package.json") configs.push(file);
          }
        }
      } finally {
        directory.closeSync();
      }
    }
    for (const file of configs.sort()) parseConfig(file, true, depth + 1);
  };
  const parseConfig = (file: string, required: boolean, depth = 0): void => {
    const absolute = path.resolve(file);
    if (visiting.has(absolute)) {
      problems.add(`Cyclic tsconfig dependency: ${absolute}`);
      return;
    }
    if (configurations.has(absolute)) {
      if (required && files.get(absolute) === null)
        problems.add(`Missing tsconfig dependency: ${absolute}`);
      return;
    }
    if (depth > 64 || configurations.size >= 512) {
      problems.add("Tsconfig dependency graph exceeds its limit");
      return;
    }
    configurations.add(absolute);
    visiting.add(absolute);
    try {
      const bytes = read(absolute);
      if (bytes === null) {
        if (required) problems.add(`Missing tsconfig dependency: ${absolute}`);
        return;
      }
      const errors: ParseError[] = [];
      const value: unknown = parse(
        bytes.toString("utf8").replace(/^\uFEFF/u, ""),
        errors,
        { allowTrailingComma: true },
      );
      if (
        errors.length ||
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
      ) {
        problems.add(`Invalid JSONC config: ${absolute}`);
        return;
      }
      const record = value as Record<string, unknown>;
      const bases =
        record.extends === undefined
          ? []
          : Array.isArray(record.extends)
            ? record.extends
            : [record.extends];
      for (const base of bases) {
        if (typeof base !== "string" || !base) {
          problems.add(`Unknown extends entry: ${absolute}`);
          continue;
        }
        const candidates: string[] = [];
        if (base.startsWith(".") || path.isAbsolute(base)) {
          const resolved = path.resolve(path.dirname(absolute), base);
          candidates.push(
            resolved,
            `${resolved}.json`,
            path.join(resolved, "tsconfig.json"),
          );
        } else {
          captureConfigPackage(absolute, base, depth);
          const resolver = createRequire(absolute);
          for (const request of [
            base,
            `${base}.json`,
            `${base}/tsconfig.json`,
          ]) {
            try {
              candidates.push(resolver.resolve(request));
            } catch {
              /* 不猜测 package exports 隐藏的配置。 */
            }
          }
        }
        let resolved: string | undefined;
        for (const candidate of candidates) {
          // 缺失候选也计入摘要，后续新增更优先的文件必须让旧缓存失效。
          if (path.extname(candidate) !== ".json") continue;
          const bytes = read(candidate);
          if (bytes !== null) {
            resolved = candidate;
            break;
          }
        }
        if (resolved) parseConfig(resolved, true, depth + 1);
        else
          problems.add(`Unresolved tsconfig extends ${base} from ${absolute}`);
      }
      if (record.references !== undefined) {
        if (!Array.isArray(record.references))
          problems.add(`Unknown references: ${absolute}`);
        else
          for (const reference of record.references) {
            if (
              !reference ||
              typeof reference !== "object" ||
              typeof reference.path !== "string"
            ) {
              problems.add(`Unknown project reference: ${absolute}`);
              continue;
            }
            const target = path.resolve(path.dirname(absolute), reference.path);
            parseConfig(
              path.extname(target) === ".json"
                ? target
                : path.join(target, "tsconfig.json"),
              true,
              depth + 1,
            );
          }
      }
    } finally {
      visiting.delete(absolute);
    }
  };

  const entries = [...options.entryPoints].sort();
  for (const entry of entries) {
    const file = path.resolve(options.srcDir, entry);
    if (read(file, false) === null)
      problems.add(`Missing compiler source: ${file}`);
    let directory = path.dirname(file);
    while (!directories.has(directory)) {
      directories.add(directory);
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  directories.add(path.resolve(options.rootDir));
  for (const directory of [...directories].sort()) {
    for (const name of METADATA_NAMES) read(path.join(directory, name));
    parseConfig(path.join(directory, "tsconfig.json"), false);
  }
  if (options.tsconfig) parseConfig(options.tsconfig, true);
  const sortedProblems = [...problems].sort();
  return {
    digest: artifactDigest(
      JSON.stringify({
        schemaVersion: 2,
        compiler: {
          vextjs: packageMetadata.version,
          esbuild: esbuildVersion,
          contract: "independent-cjs-v2",
        },
        rootDir: path.resolve(options.rootDir),
        srcDir: path.resolve(options.srcDir),
        tsconfig: options.tsconfig ?? null,
        parameters: options.parameters,
        entries,
        files: [...files].sort(([a], [b]) => a.localeCompare(b)),
        problems: sortedProblems,
      }),
    ),
    complete: sortedProblems.length === 0,
    problems: sortedProblems,
  };
}
