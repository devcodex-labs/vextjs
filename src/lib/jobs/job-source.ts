import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  BACKEND_DEPENDENCY_SCOPE,
  backendDependencyScopeArtifact,
} from "../build/backend-dependency-scope.js";
import { parseSourceSyntax, walkSourceSyntax } from "../source-syntax.js";
import { isPathInside } from "../path-boundary.js";
import { collectSourceView } from "../../tooling/source-view/collect.js";
import type {
  SourceView,
  SourceFileRef,
} from "../../tooling/source-view/types.js";
import { jobModuleCandidates } from "./job-module-path.js";
import { readProjectFile } from "../project/read-project-file.js";
import {
  analyzeJobDeclaration,
  inspectNamedJobDependencies,
  type JobDeclaration,
} from "./job-declaration.js";
import { resolveJobsDirectory, scanJobFiles } from "./job-discovery.js";
import { VextJobDefinitionError } from "./job-errors.js";
import type { VextJobsConfig } from "./types.js";

export interface JobSourceSnapshot {
  files: string[];
  view?: SourceView;
  declarations: Map<string, JobDeclaration>;
  projectionFiles: Set<string>;
  projectionTables: Map<string, string[][]>;
  read(file: string): string | undefined;
  verify(): Promise<void>;
}

/** Select once and collect only finite default-reexport dependencies. */
export async function collectJobSourceSnapshot(
  rootDir: string,
  sourceBase: string,
  config: VextJobsConfig = {},
): Promise<JobSourceSnapshot> {
  if (config.enabled === false)
    return {
      files: [],
      declarations: new Map(),
      projectionFiles: new Set(),
      projectionTables: new Map(),
      read() {
        return undefined;
      },
      async verify() {},
    };
  const selection = {
    ...config,
    include: config.include && [...config.include],
    exclude: config.exclude && [...config.exclude],
  };
  const directory = resolveJobsDirectory(
    sourceBase,
    selection.dir ?? "jobs",
    rootDir,
  );
  const files = await scanJobFiles(directory, selection);
  const relative = (file: string) =>
    path.relative(sourceBase, file).split(path.sep).join("/");
  const declarations = new Map<string, JobDeclaration>();
  const dependencies = new Map<string, string>();
  const refs: SourceFileRef[] = files.map((file) => ({
    rootId: "jobs",
    path: relative(file),
    role: "job",
  }));
  const scopeFile = path.join(sourceBase, BACKEND_DEPENDENCY_SCOPE);
  if (files.length && fs.existsSync(scopeFile))
    refs.unshift({
      rootId: "jobs",
      path: BACKEND_DEPENDENCY_SCOPE,
      role: "job-transport",
    });
  let verifiedScope = false;
  const resolveDependency = (importer: string, specifier: string): string => {
    let candidates = jobModuleCandidates(importer, specifier);
    if (!/\.[cm]?ts$/iu.test(importer)) {
      // Native/emitted JS must bind the actual JS file, even beside a .ts file.
      candidates = candidates.filter(
        (candidate) => !/\.[cm]?ts$/iu.test(candidate),
      );
    }
    const target = candidates.find((candidate) =>
      fs.existsSync(path.join(sourceBase, candidate)),
    );
    if (!target)
      throw new VextJobDefinitionError(
        `[vextjs] Job declaration ${importer}: default dependency ${specifier} is unavailable or outside the source root.`,
      );
    return target;
  };
  const view = files.length
    ? await collectSourceView({
        roots: [{ id: "jobs", realPath: sourceBase, kind: "service" }],
        files: refs,
        rolePolicyVersion: "jobs-finite-declaration@1",
        verifyUnchanged: true,
        limits: {
          maxFiles: 2048,
          maxFileBytes: 2 * 1024 * 1024,
          maxTotalBytes: 32 * 1024 * 1024,
        },
        dependencies(input) {
          const source = new TextDecoder("utf-8", { fatal: true }).decode(
            input.bytes,
          );
          if (input.role === "job-transport") {
            verifiedScope = isCanonicalDependencyScope(sourceBase, source);
            return [];
          }
          const declaration = analyzeJobDeclaration(input.path, source, {
            verifiedDependencyScope: (specifier) =>
              verifiedScope &&
              path.posix.normalize(
                path.posix.join(path.posix.dirname(input.path), specifier),
              ) === BACKEND_DEPENDENCY_SCOPE,
          });
          declarations.set(input.path, declaration);
          if (declaration.state !== "known" && input.role !== "job-named-value")
            return [];
          const references: SourceFileRef[] = [];
          if (declaration.reexport) {
            const target = resolveDependency(input.path, declaration.reexport);
            dependencies.set(input.path, target);
            references.push({
              rootId: "jobs",
              path: target,
              role: "job-definition",
            });
          }
          for (const dependency of declaration.namedDefaultDependencies) {
            const target = resolveDependency(input.path, dependency.source);
            references.push({
              rootId: "jobs",
              path: target,
              role: "job-named-value",
            });
          }
          return references;
        },
      })
    : undefined;
  const projectionFiles = new Set<string>();
  const projectionTables = new Map<string, string[][]>();
  const inspect = (file: string, visiting: Set<string>): string[][] => {
    if (visiting.has(file) || visiting.size > 64)
      throw new VextJobDefinitionError(
        `[vextjs] Job declaration ${file}: circular or over-budget default reexport.`,
      );
    const fact = declarations.get(file);
    if (!fact || fact.state !== "known")
      throw new VextJobDefinitionError(
        `[vextjs] Job declaration ${file}: ${fact?.reason ?? "source evidence unavailable"}.`,
      );
    const target = dependencies.get(file);
    const dependencyProjection = target
      ? inspect(target, new Set([...visiting, file]))
      : [];
    const named = inspectNamedJobDependencies(
      file,
      fact,
      (importer, specifier) => {
        const target = resolveDependency(importer, specifier);
        const dependency = declarations.get(target);
        return dependency && { file: target, fact: dependency };
      },
    );
    if (named.state !== "known")
      throw new VextJobDefinitionError(
        `[vextjs] Job declaration ${file}: ${named.reason}.`,
      );
    const tables =
      fact.format === "cjs-projection"
        ? [
            ["default", "__esModule", ...fact.namedExports],
            ...dependencyProjection,
          ]
        : dependencyProjection;
    if (tables.length) projectionFiles.add(file);
    projectionTables.set(file, tables);
    return tables;
  };
  for (const file of files) inspect(relative(file), new Set());
  return {
    files,
    view,
    declarations,
    projectionFiles,
    projectionTables,
    read(file) {
      const name = relative(file);
      const record = view?.record("jobs", name);
      if (!record) return undefined;
      const bytes = readProjectFile(sourceBase, name, 2 * 1024 * 1024);
      if (
        !bytes ||
        createHash("sha256").update(bytes).digest("hex") !== record.sha256
      )
        throw new VextJobDefinitionError(
          `[vextjs] Job compiler input changed: ${name}.`,
        );
      return view!.read("jobs", name);
    },
    async verify() {
      const current = await scanJobFiles(directory, selection);
      if (JSON.stringify(current) !== JSON.stringify(files))
        throw new VextJobDefinitionError(
          "[vextjs] Job selection changed during preparation/build.",
        );
      for (const record of view?.list() ?? []) {
        const bytes = readProjectFile(sourceBase, record.path, 2 * 1024 * 1024);
        const source =
          bytes && new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (source !== view!.read("jobs", record.path))
          throw new VextJobDefinitionError(
            `[vextjs] Job declaration input changed: ${record.path}.`,
          );
      }
    },
  };
}

/** Reconstruct the existing finite binder; filenames/markers cannot bless code. */
export function isCanonicalDependencyScope(
  root: string,
  source: string,
): boolean {
  let pairs: [string, string][] | undefined;
  try {
    const program = parseSourceSyntax(BACKEND_DEPENDENCY_SCOPE, source);
    walkSourceSyntax(program, (node) => {
      if (
        node.type !== "NewExpression" ||
        node.callee.type !== "Identifier" ||
        node.callee.name !== "Map"
      )
        return;
      const argument = node.arguments[0];
      if (
        argument?.type !== "CallExpression" ||
        argument.callee.type !== "MemberExpression" ||
        argument.callee.object.type !== "ArrayExpression"
      )
        return;
      const entries = argument.callee.object.elements;
      const parsed: [string, string][] = [];
      for (const entry of entries) {
        if (entry?.type !== "ArrayExpression" || entry.elements.length !== 2)
          return;
        const [output, input] = entry.elements;
        if (
          output?.type !== "Literal" ||
          input?.type !== "Literal" ||
          typeof output.value !== "string" ||
          typeof input.value !== "string"
        )
          return;
        if (!isPathInside(root, path.resolve(root, output.value))) return;
        parsed.push([output.value, input.value]);
      }
      pairs = parsed;
    });
    if (!pairs) return false;
    const expected = backendDependencyScopeArtifact(
      root,
      pairs.map(([output, input]) => ({
        path: path.resolve(root, output),
        source: path.resolve(root, input),
        contents: "",
      })),
    );
    return String(expected.contents) === source;
  } catch {
    return false;
  }
}
