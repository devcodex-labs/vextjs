import path from "node:path";
import {
  analyzeJobDeclaration,
  inspectNamedJobDependencies,
  type JobDeclaration,
} from "./job-declaration.js";
import { isCanonicalDependencyScope } from "./job-source.js";
import { jobModuleCandidates, jobModuleReferences } from "./job-module-path.js";
import type { SourceView } from "../../tooling/source-view/types.js";
import { type SyntaxNode } from "../source-syntax.js";
import {
  createStaticModuleFromText,
  type StaticExpression,
  type StaticModule,
  StaticModuleGraph,
} from "../../tooling/project-index/static-module-graph.js";
import {
  readStaticExpression,
  staticFact,
  staticKey,
  unwrapStaticExpression,
} from "../../tooling/project-index/static-values.js";

export type JobFieldState = "known" | "absent" | "unknown";
export const JOB_FIELDS = [
  "name",
  "description",
  "tags",
  "docs",
  "enabled",
  "cron",
  "leaseTtl",
  "timezone",
  "handler",
] as const;
export interface StaticJobDefinition {
  moduleShapeState: JobDeclaration["state"];
  declarationCardinality: number;
  moduleShapeReason?: string;
  exportName: string;
  line: number;
  definition: Record<string, unknown>;
  fieldStates: Record<string, JobFieldState>;
  staticState: "complete" | "partial";
  reasons: string[];
  definitionFile: string;
}
export interface JobInspectionOptions {
  graph?: StaticModuleGraph;
  rootId?: string;
}
export interface StaticJobInspection {
  definitions: StaticJobDefinition[];
  warnings: string[];
  moduleShape: Pick<
    JobDeclaration,
    "state" | "declarationCardinality" | "reason"
  >;
}
export function createJobStaticGraph(view: SourceView): StaticModuleGraph {
  return new StaticModuleGraph(view, jobModuleReferences);
}

/** No user module, factory or handler is executed to obtain static evidence. */
export function inspectJobDefinitions(
  file: string,
  source: string,
  options: JobInspectionOptions = {},
): StaticJobDefinition[] {
  return inspectJobSource(file, source, options).definitions;
}
export function inspectJobSource(
  file: string,
  source: string,
  options: JobInspectionOptions = {},
): StaticJobInspection {
  let module =
    options.graph && options.rootId
      ? options.graph.module(options.rootId, file)
      : createStaticModuleFromText(file, source);
  const analyze = (input: StaticModule) =>
    analyzeJobDeclaration(input.path, input.source, {
      verifiedDependencyScope(specifier) {
        const target = path.posix.normalize(
          path.posix.join(path.posix.dirname(input.path), specifier),
        );
        if (!options.graph || !options.rootId) return undefined;
        if (path.posix.basename(target) !== ".vext-dependencies.cjs")
          return false;
        try {
          const binder = options.graph.module(options.rootId, target);
          return isCanonicalDependencyScope(
            path.resolve(path.dirname(target)),
            binder.source,
          );
        } catch {
          return undefined;
        }
      },
    });
  const checked = (input: StaticModule): JobDeclaration => {
    const fact = analyze(input);
    const named = inspectNamedJobDependencies(
      input.path,
      fact,
      (importer, specifier) => {
        if (!options.graph || !options.rootId) return;
        for (const target of jobModuleCandidates(importer, specifier)) {
          try {
            return {
              file: target,
              fact: analyze(options.graph.module(options.rootId, target)),
            };
          } catch {
            /* finite sealed view only */
          }
        }
        return undefined;
      },
    );
    return named.state === "known" || fact.state === "unsupported"
      ? fact
      : { ...fact, ...named };
  };
  let declaration = checked(module);
  const seen = new Set<string>();
  while (declaration.state === "known" && declaration.reexport) {
    if (
      !options.graph ||
      !options.rootId ||
      seen.has(module.path) ||
      seen.size >= 64
    ) {
      declaration = {
        ...declaration,
        state: "unknown",
        reason:
          "default dependency graph is unavailable, circular or over budget",
      };
      break;
    }
    seen.add(module.path);
    const candidates = jobModuleCandidates(
      module.path,
      declaration.reexport,
    ).filter(
      (candidate) =>
        /\.[cm]?ts$/iu.test(module.path) || !/\.[cm]?ts$/iu.test(candidate),
    );
    let dependency: StaticModule | undefined;
    for (const candidate of candidates) {
      try {
        dependency = options.graph.module(options.rootId, candidate);
        break;
      } catch {
        /* bounded source view only */
      }
    }
    if (!dependency) {
      declaration = {
        ...declaration,
        state: "unknown",
        reason: "default dependency is unavailable in the source view",
      };
      break;
    }
    module = dependency;
    declaration = checked(module);
  }
  const exports = new Map<string, SyntaxNode | null>();
  const warnings: string[] = [];
  for (const statement of module.program.body) {
    const assignment =
      statement.type === "ExpressionStatement"
        ? statement.expression
        : undefined;
    if (
      assignment?.type === "AssignmentExpression" &&
      assignment.operator === "="
    ) {
      const name = commonJsExportName(assignment.left);
      if (name) exports.set(name, assignment.right);
    }
    if (statement.type === "ExportDefaultDeclaration")
      exports.set("default", statement.declaration);
    if (
      statement.type === "ExportAllDeclaration" &&
      statement.exportKind !== "type"
    )
      warnings.push(
        `${file}: export * requires runtime verification; exported job identities are unknown.`,
      );
    if (
      statement.type !== "ExportNamedDeclaration" ||
      statement.exportKind === "type"
    )
      continue;
    if (statement.declaration?.type === "VariableDeclaration") {
      for (const binding of statement.declaration.declarations)
        if (binding.id.type === "Identifier" && binding.init)
          exports.set(binding.id.name, binding.init);
    }
    for (const specifier of statement.specifiers) {
      if (
        specifier.type !== "ExportSpecifier" ||
        specifier.exportKind === "type"
      )
        continue;
      const name = staticKey(specifier.exported);
      if (name) exports.set(name, statement.source ? null : specifier.local);
    }
  }
  if (declaration.definition) exports.set("default", declaration.definition);
  if (declaration.state !== "known")
    warnings.push(
      `${file}: Job module shape ${declaration.state}: ${declaration.reason}.`,
    );
  const definitions: StaticJobDefinition[] = [];
  for (const [exportName, node] of exports) {
    try {
      let expression: StaticExpression;
      if (!node) {
        if (!options.graph || !options.rootId)
          throw new Error(
            "re-export dependency is unavailable in this source view",
          );
        expression = options.graph.exported(options.rootId, file, exportName);
      } else {
        expression = { module, node, symbols: [] };
        if (node !== declaration.definition && options.graph)
          expression = options.graph.resolve(expression);
        else expression = resolveLocal(expression);
      }
      const call = unwrapStaticExpression(expression.node);
      if (
        [
          "Literal",
          "FunctionExpression",
          "ArrowFunctionExpression",
          "FunctionDeclaration",
        ].includes(call.type)
      )
        continue;

      if (
        call.type !== "CallExpression" ||
        !(
          expression.module === module
            ? declaration
            : analyze(expression.module)
        ).declarationCalls.some(
          (candidate) =>
            candidate.start === call.start && candidate.end === call.end,
        )
      ) {
        warnings.push(
          `${file}#${exportName}: export is not a statically proven vextjs defineJob() value.`,
        );
        continue;
      }
      const definition: Record<string, unknown> = {};
      const fieldStates: Record<string, JobFieldState> = Object.fromEntries(
        JOB_FIELDS.map((key) => [key, "absent"]),
      );
      const reasons: string[] = [];
      const unknown = (key: string, reason: string) => {
        fieldStates[key] = "unknown";
        if (key !== "handler") definition[key] = { static: "dynamic" };
        reasons.push(`${key}: ${reason}`);
      };
      let object: StaticExpression | undefined;
      const argument = call.arguments[0];
      if (argument && argument.type !== "SpreadElement") {
        object = { ...expression, node: argument };
        try {
          object = options.graph
            ? options.graph.resolve(object)
            : resolveLocal(object);
        } catch (error) {
          reasons.push(errorMessage(error));
          object = undefined;
        }
      }
      if (object?.node.type !== "ObjectExpression") {
        for (const key of JOB_FIELDS)
          unknown(key, "definition object is not statically resolvable");
      } else {
        for (const property of object.node.properties) {
          if (property.type !== "Property" || property.computed) {
            for (const key of JOB_FIELDS)
              unknown(
                key,
                "an opaque spread/computed property may override this field",
              );
            continue;
          }
          const key = staticKey(property.key);
          if (!key) continue;
          if (key === "handler") {
            if (property.kind !== "init") {
              unknown(
                key,
                "handler accessor value is unknown; it was not executed",
              );
              continue;
            }
            const handler = unwrapStaticExpression(property.value);
            if (
              handler.type === "ArrowFunctionExpression" ||
              handler.type === "FunctionExpression"
            )
              fieldStates.handler = "known";
            else if (
              ["Literal", "ObjectExpression", "ArrayExpression"].includes(
                handler.type,
              )
            ) {
              fieldStates.handler = "known";
              definition.handler =
                handler.type === "Literal"
                  ? handler.value
                  : { static: "not-function" };
            } else
              unknown(key, "handler binding is opaque; it was not executed");
            continue;
          }
          try {
            const value = options.graph
              ? options.graph.value(
                  { ...object, node: property.value },
                  `Job.${key}`,
                )
              : localValue(object.module, property.value);
            definition[key] = value;
            fieldStates[key] = "known";
          } catch (error) {
            unknown(key, errorMessage(error));
          }
        }
      }
      // An earlier opaque spread does not invalidate a later explicit known field.
      const unresolved = Object.entries(fieldStates)
        .filter(([, state]) => state === "unknown")
        .map(([key]) => key);
      const staticState = unresolved.length ? "partial" : "complete";
      const activeReasons = reasons.filter((reason) =>
        unresolved.some((key) => reason.startsWith(key + ":")),
      );
      if (staticState === "partial")
        warnings.push(
          `${file}#${exportName}: unknown static fields: ${unresolved.join(", ")}.`,
        );
      definitions.push({
        moduleShapeState: declaration.state,
        declarationCardinality: declaration.declarationCardinality,
        moduleShapeReason: declaration.reason,
        exportName,
        definition,
        fieldStates,
        staticState,
        reasons: activeReasons,
        definitionFile: expression.module.path,
        line: expression.module.source.slice(0, call.start).split(/\r?\n/u)
          .length,
      });
    } catch (error) {
      warnings.push(`${file}#${exportName}: ${errorMessage(error)}`);
    }
  }
  if (definitions.length === 0 && warnings.length === 0)
    warnings.push(
      `${file}: no statically proven defineJob() export; runtime rejects empty exports or must resolve a dynamic wrapper.`,
    );
  return {
    definitions,
    warnings,
    moduleShape: {
      state: declaration.state,
      declarationCardinality: declaration.declarationCardinality,
      reason: declaration.reason,
    },
  };
}
function resolveLocal(expression: StaticExpression): StaticExpression {
  const seen = new Set<string>();
  let node = unwrapStaticExpression(expression.node);
  while (node.type === "Identifier") {
    if (seen.has(node.name) || expression.module.invalid.has(node.name))
      throw new Error(`binding ${node.name} is mutable or circular`);
    seen.add(node.name);
    const value = expression.module.bindings.get(node.name);
    if (!value) break;
    node = unwrapStaticExpression(value);
  }
  return { ...expression, node };
}
function localValue(module: StaticModule, node: SyntaxNode): unknown {
  const fact = staticFact(
    readStaticExpression(node, module.bindings, module.invalid),
    [],
  );
  if (fact.state !== "known")
    throw new Error(fact.reason ?? "value is not statically resolvable");
  return fact.value;
}
function commonJsExportName(node: SyntaxNode): string | undefined {
  if (
    node.type !== "MemberExpression" ||
    (node.computed && node.property.type === "Identifier")
  )
    return undefined;
  const key = staticKey(node.property),
    owner = node.object;
  if (owner.type === "Identifier") {
    if (owner.name === "exports") return key;
    if (owner.name === "module" && key === "exports") return "default";
  }
  if (
    owner.type === "MemberExpression" &&
    owner.object.type === "Identifier" &&
    owner.object.name === "module" &&
    staticKey(owner.property) === "exports" &&
    !(owner.computed && owner.property.type === "Identifier")
  )
    return key;
  return undefined;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
