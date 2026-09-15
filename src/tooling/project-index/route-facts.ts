import { walkSourceSyntax, type SyntaxNode } from "../../lib/source-syntax.js";
import {
  createStaticModuleFromText,
  type StaticModuleGraph,
  type StaticExpression,
} from "./static-module-graph.js";
import { createSourceBindings } from "../../lib/source-bindings.js";
import { collectRouteFactoryRegistrations } from "../../lib/route-factory-contract.js";
import {
  readStaticExpression,
  staticFact,
  staticMember,
  unwrapStaticExpression,
  type StaticFact,
} from "./static-values.js";

export interface StaticRouteFact {
  method: string;
  subPath: string | null;
  definitionFile: string;
  start: number;
  end: number;
  deprecatedDocsTags: boolean;
  returnsJson: boolean | null;
  responses: "present" | "absent" | "unknown" | "invalid";
  fields: Record<string, StaticFact>;
}
export interface StaticRouteFacts {
  state: "complete" | "unknown" | "invalid";
  routes: StaticRouteFact[];
  reason?: string;
}

/** 复用框架真实注册约束，单条路由的 options 与 handler 不跨对象、跨路由串联。 */
export function inspectRouteFacts(
  file: string,
  source: string,
  context?: { graph: StaticModuleGraph; rootId: string },
): StaticRouteFacts {
  let module;
  try {
    module = context
      ? context.graph.module(context.rootId, file)
      : createStaticModuleFromText(file, source);
  } catch (error) {
    return { state: "invalid", routes: [], reason: String(error) };
  }
  let expression: StaticExpression;
  try {
    if (context) expression = context.graph.exported(context.rootId, file);
    else {
      const exported = module.exports.get("default");
      if (!exported || !("type" in exported))
        return {
          state: "unknown",
          routes: [],
          reason: "No locally resolvable default route export.",
        };
      expression = {
        module,
        node: resolveLocalExpression(exported, module.bindings, module.invalid),
        symbols: [],
      };
    }
    let factory = unwrapStaticExpression(expression.node);
    if (factory.type === "CallExpression") {
      const binding =
        factory.callee.type === "Identifier"
          ? expression.module.imports.get(factory.callee.name)
          : undefined;
      const proven = context
        ? context.graph.frameworkBinding(
            { ...expression, node: factory.callee },
            "defineRoutes",
          )
        : binding?.source === "vextjs" && binding.name === "defineRoutes";
      if (
        !proven ||
        factory.arguments.length !== 1 ||
        factory.arguments[0]?.type === "SpreadElement"
      )
        return {
          state: "unknown",
          routes: [],
          reason: "Default export is not a proven Vext defineRoutes call.",
        };
      expression = { ...expression, node: factory.arguments[0]! };
      if (context) expression = context.graph.resolve(expression);
    }
    module = expression.module;
  } catch (error) {
    return { state: "unknown", routes: [], reason: String(error) };
  }
  const variables = module.bindings;
  const factory = resolveLocalExpression(
    expression.node,
    variables,
    module.invalid,
  );
  let calls;
  try {
    calls = collectRouteFactoryRegistrations(factory, file);
  } catch (error) {
    return { state: "unknown", routes: [], reason: String(error) };
  }
  const routes = calls.map((call): StaticRouteFact => {
    const callee = call.callee;
    const options =
      call.arguments.length === 3
        ? readStaticExpression(call.arguments[1]!, variables, module.invalid)
        : undefined;
    const docs =
      options === undefined ? undefined : staticMember(options, "docs");
    const responses =
      options === undefined ? undefined : staticMember(options, "responses");
    const pathFact = staticFact(
      readStaticExpression(call.arguments[0]!, variables, module.invalid),
      [module.path],
    );
    return {
      method:
        callee.type === "MemberExpression" &&
        callee.property.type === "Identifier"
          ? callee.property.name.toUpperCase()
          : "UNKNOWN",
      subPath:
        pathFact.state === "known" && typeof pathFact.value === "string"
          ? pathFact.value
          : null,
      definitionFile: module.path,
      start: call.start,
      end: call.end,
      deprecatedDocsTags: docs?.kind === "object" && docs.fields.has("tags"),
      returnsJson: handlerReturnsJson(
        resolveLocalExpression(
          call.arguments.at(-1)!,
          variables,
          module.invalid,
        ),
      ),
      responses:
        responses === undefined ||
        (responses.kind === "known" && responses.value == null)
          ? "absent"
          : responses.kind === "unknown" || responses.kind === "invalid"
            ? "unknown"
            : responses.kind === "object"
              ? "present"
              : "invalid",
      fields: Object.fromEntries(
        [
          "validate",
          "responses",
          "docs",
          "cache",
          "middlewares",
          "auth",
          "frontend",
        ].map((key) => [
          key,
          staticFact(
            options === undefined ? undefined : staticMember(options, key),
            [module.path],
          ),
        ]),
      ),
    };
  });
  return { state: "complete", routes };
}

function resolveLocalExpression(
  node: SyntaxNode,
  bindings: ReadonlyMap<string, SyntaxNode>,
  invalid: ReadonlySet<string>,
): SyntaxNode {
  const seen = new Set<string>();
  let value = unwrapStaticExpression(node);
  while (
    value.type === "Identifier" &&
    !invalid.has(value.name) &&
    !seen.has(value.name) &&
    bindings.has(value.name)
  ) {
    seen.add(value.name);
    value = unwrapStaticExpression(bindings.get(value.name)!);
  }
  return value;
}

function handlerReturnsJson(handler: SyntaxNode): boolean | null {
  if (
    handler.type !== "ArrowFunctionExpression" &&
    handler.type !== "FunctionExpression" &&
    handler.type !== "FunctionDeclaration"
  )
    return null;
  const response = handler.params[1];
  if (response?.type !== "Identifier" || !handler.body) return false;
  const bindings = createSourceBindings(handler);
  const responseBinding = bindings.resolve(response);
  let found = false;
  walkSourceSyntax(handler.body, (node) => {
    if (
      [
        "FunctionDeclaration",
        "FunctionExpression",
        "ArrowFunctionExpression",
      ].includes(node.type)
    )
      return false;
    if (
      node.type !== "CallExpression" ||
      node.callee.type !== "MemberExpression"
    )
      return;
    const member = node.callee;
    if (
      !member.computed &&
      member.property.type === "Identifier" &&
      member.property.name === "json" &&
      member.object.type === "Identifier" &&
      bindings.resolve(member.object) === responseBinding
    )
      found = true;
  });
  return found;
}
