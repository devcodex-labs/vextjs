import type { CallExpression, Expression, Node } from "oxc-parser";
import { parseSourceSyntax, walkSourceSyntax } from "./source-syntax.js";
import type { CanonicalRouteFactoryValidationOptions } from "./route-contract.js";

export const VEXT_ROUTE_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
] as const;
export type VextRouteMethod = (typeof VEXT_ROUTE_METHODS)[number];
const METHODS = new Set<string>(VEXT_ROUTE_METHODS);
export function isVextRouteMethod(value: string): value is VextRouteMethod {
  return METHODS.has(value);
}

/** 同一 AST 合同供运行时函数文本和静态源文件分析使用。 */
export function validateRouteFactorySource(
  source: string,
  label: string,
  options: CanonicalRouteFactoryValidationOptions = {},
): number {
  let program;
  try {
    program = parseSourceSyntax("route-factory.ts", `(${source})`);
  } catch (error) {
    throw new Error(
      `[vextjs] ${label} must have a balanced direct block body: ${String(error)}`,
    );
  }
  const statement = program.body.length === 1 ? program.body[0] : undefined;
  const factory =
    statement?.type === "ExpressionStatement"
      ? statement.expression
      : undefined;
  return collectRouteFactoryRegistrations(factory, label, options).length;
}

/** 已解析的源文件与运行时函数文本共享同一注册约束。 */
export function collectRouteFactoryRegistrations(
  factory: Node | undefined,
  label: string,
  options: CanonicalRouteFactoryValidationOptions = {},
): CallExpression[] {
  if (
    !factory ||
    (factory.type !== "ArrowFunctionExpression" &&
      factory.type !== "FunctionExpression") ||
    factory.params.length !== 1 ||
    factory.params[0]?.type !== "Identifier" ||
    factory.async ||
    factory.generator ||
    !factory.body ||
    factory.body.type !== "BlockStatement"
  ) {
    throw new Error(
      `[vextjs] ${label} must be an inline function with one app parameter and a block body.`,
    );
  }
  const param = factory.params[0].name;
  const fail = (method?: string): never => {
    throw new Error(
      `[vextjs] ${label}${method ? ` ${method.toUpperCase()}` : ""} route registration must use a direct top-level statement with ${param}.method(path, handler) or ${param}.method(path, options, handler); bracket access, extracted/destructured methods, helpers, and runtime control flow are not supported.`,
    );
  };
  const direct = new Set<CallExpression>();
  const collect = (expression: Expression): void => {
    if (
      expression.type === "SequenceExpression" &&
      options.allowCompilerLoweredSequence
    ) {
      for (const child of expression.expressions) collect(child);
    } else if (expression.type === "CallExpression") direct.add(expression);
  };
  for (const item of factory.body.body)
    if (item.type === "ExpressionStatement") collect(item.expression);
  const registrations = new Set<CallExpression>();
  for (const call of direct) {
    const member = call.callee;
    if (
      member.type !== "MemberExpression" ||
      member.object.type !== "Identifier" ||
      member.object.name !== param ||
      member.computed ||
      member.property.type !== "Identifier" ||
      !isVextRouteMethod(member.property.name)
    )
      continue;
    if (member.optional || call.optional) fail();
    if (call.arguments.length !== 2 && call.arguments.length !== 3) {
      throw new Error(
        `[vextjs] ${label} ${member.property.name.toUpperCase()} route call must use exactly (path, handler) or (path, options, handler).`,
      );
    }
    const handler = call.arguments.at(-1)!;
    if (
      options.validateHandler !== false &&
      [
        "Literal",
        "ObjectExpression",
        "ArrayExpression",
        "TemplateLiteral",
        "UnaryExpression",
      ].includes(handler.type)
    ) {
      throw new Error(
        `[vextjs] ${label} ${member.property.name.toUpperCase()} route handler must be a function or a callable reference.`,
      );
    }
    registrations.add(call);
  }
  walkSourceSyntax(factory.body, (node, parent, ancestors) => {
    if (node.type !== "Identifier" || node.name !== param || !parent) return;
    if (
      parent.type === "MemberExpression" &&
      parent.property === node &&
      !parent.computed
    )
      return;
    if (
      parent.type === "Property" &&
      parent.key === node &&
      !parent.computed &&
      !parent.shorthand
    )
      return;
    if (parent.type === "MemberExpression" && parent.object === node) {
      if (
        parent.computed ||
        parent.optional ||
        parent.property.type !== "Identifier"
      )
        return fail();
      if (!isVextRouteMethod(parent.property.name)) return;
      const call = ancestors.at(-2);
      if (
        call?.type !== "CallExpression" ||
        call.callee !== parent ||
        !registrations.has(call)
      )
        fail(parent.property.name);
      return;
    }
    if (
      (parent.type === "AssignmentExpression" && parent.left === node) ||
      parent.type === "UpdateExpression" ||
      (parent.type === "VariableDeclarator" && parent.id === node) ||
      ((parent.type === "FunctionExpression" ||
        parent.type === "ArrowFunctionExpression" ||
        parent.type === "FunctionDeclaration") &&
        parent.params.includes(node))
    )
      fail();
    // handler/options 可以引用 app；collector 的实际执行阶段仍阻止迟到注册。
    if (
      ancestors.some(
        (ancestor: Node) =>
          ancestor.type === "CallExpression" && registrations.has(ancestor),
      )
    )
      return;
    fail();
  });
  return [...registrations];
}
