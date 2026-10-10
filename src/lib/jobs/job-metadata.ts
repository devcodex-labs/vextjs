import { createSourceBindings } from "../source-bindings.js";
import { type SyntaxNode, walkSourceSyntax } from "../source-syntax.js";
import {
  createStaticModuleFromText,
  type StaticExpression,
  type StaticModule,
  type StaticModuleGraph,
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
  "interval",
  "timezone",
  "handler",
] as const;
export interface StaticJobDefinition {
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
  const module =
    options.graph && options.rootId
      ? options.graph.module(options.rootId, file)
      : createStaticModuleFromText(file, source);
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
    if (statement.type === "ExportAllDeclaration")
      warnings.push(
        `${file}: export * requires runtime verification; exported job identities are unknown.`,
      );
    if (statement.type !== "ExportNamedDeclaration") continue;
    if (statement.declaration?.type === "VariableDeclaration") {
      for (const binding of statement.declaration.declarations)
        if (binding.id.type === "Identifier" && binding.init)
          exports.set(binding.id.name, binding.init);
    }
    for (const specifier of statement.specifiers) {
      if (specifier.type !== "ExportSpecifier") continue;
      const name = staticKey(specifier.exported);
      if (name) exports.set(name, statement.source ? null : specifier.local);
    }
  }
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
        if (options.graph) expression = options.graph.resolve(expression);
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
        !isFactory(expression.module, call.callee)
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
  return { definitions, warnings };
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
const factoryBindingCache = new WeakMap<
  StaticModule,
  ReturnType<typeof collectFactoryBindings>
>();
const lexicalBindingCache = new WeakMap<
  StaticModule,
  ReturnType<typeof createSourceBindings>
>();
function lexicalBindings(module: StaticModule) {
  let bindings = lexicalBindingCache.get(module);
  if (!bindings) {
    bindings = createSourceBindings(module.program);
    lexicalBindingCache.set(module, bindings);
  }
  return bindings;
}
function collectFactoryBindings(module: StaticModule) {
  const factories = new Set<string>();
  const requireFactories = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of module.program.body) {
    if (
      statement.type === "ImportDeclaration" &&
      statement.source.value === "vextjs" &&
      statement.importKind !== "type"
    ) {
      for (const specifier of statement.specifiers) {
        if (
          specifier.type === "ImportSpecifier" &&
          specifier.importKind !== "type" &&
          staticKey(specifier.imported) === "defineJob"
        )
          factories.add(specifier.local.name);
        if (specifier.type === "ImportNamespaceSpecifier")
          namespaces.add(specifier.local.name);
      }
    }
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? statement.declaration
        : statement;
    if (
      declaration?.type !== "VariableDeclaration" ||
      declaration.kind !== "const"
    )
      continue;
    for (const binding of declaration.declarations) {
      if (!isVextRequire(binding.init, module)) continue;
      if (binding.id.type === "Identifier") namespaces.add(binding.id.name);
      if (binding.id.type === "ObjectPattern")
        for (const property of binding.id.properties)
          if (
            property.type === "Property" &&
            staticKey(property.key) === "defineJob" &&
            property.value.type === "Identifier"
          )
            requireFactories.add(property.value.name);
    }
  }
  const mutated = new Set<string>();
  walkSourceSyntax(module.program, (node) => {
    let target: SyntaxNode | undefined =
      node.type === "AssignmentExpression"
        ? node.left
        : node.type === "UpdateExpression"
          ? node.argument
          : undefined;
    while (target?.type === "MemberExpression") target = target.object;
    if (target?.type === "Identifier") mutated.add(target.name);
  });
  return { factories, requireFactories, namespaces, mutated };
}
function isFactory(module: StaticModule, callee: SyntaxNode): boolean {
  let bindings = factoryBindingCache.get(module);
  if (!bindings) {
    bindings = collectFactoryBindings(module);
    factoryBindingCache.set(module, bindings);
  }
  const { factories, requireFactories, namespaces, mutated } = bindings;
  if (callee.type === "Identifier")
    return (
      !mutated.has(callee.name) &&
      (requireFactories.has(callee.name) ||
        (factories.has(callee.name) && !module.invalid.has(callee.name)))
    );
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    staticKey(callee.property) === "defineJob" &&
    ((callee.object.type === "Identifier" &&
      namespaces.has(callee.object.name) &&
      !mutated.has(callee.object.name)) ||
      isVextRequire(callee.object, module))
  );
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
function isVextRequire(
  node: SyntaxNode | null | undefined,
  module: StaticModule,
): boolean {
  return (
    node?.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "require" &&
    !lexicalBindings(module).resolve(node.callee) &&
    node.arguments.length === 1 &&
    node.arguments[0]?.type === "Literal" &&
    node.arguments[0].value === "vextjs"
  );
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
