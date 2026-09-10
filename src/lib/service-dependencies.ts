import type { Node } from "oxc-parser";
import { createSourceBindings, type SourceBinding } from "./source-bindings.js";
import { parseSourceSyntax, walkSourceSyntax } from "./source-syntax.js";

const unwrap = (value: Node): Node => {
  while (
    [
      "TSAsExpression",
      "TSSatisfiesExpression",
      "TSNonNullExpression",
      "TSTypeAssertion",
      "ParenthesizedExpression",
    ].includes(value.type)
  )
    value = (value as Node & { expression: Node }).expression;
  return value;
};
const keyOf = (node: Node): string | null =>
  node.type === "Identifier"
    ? node.name
    : node.type === "Literal" && typeof node.value === "string"
      ? node.value
      : null;
const memberKey = (node: Node): string | null =>
  node.type === "MemberExpression"
    ? !node.computed
      ? keyOf(node.property)
      : node.property.type === "Literal"
        ? keyOf(node.property)
        : null
    : null;

/** 运行时与Doctor共用的有限依赖图。只认默认导出构造函数的注入来源，无法证明则 incomplete。 */
export function collectServiceDependencies(
  source: string,
  filePath: string,
  serviceKey: string,
  knownKeys: ReadonlySet<string>,
): { dependencies: Set<string>; incomplete: boolean } {
  const program = parseSourceSyntax(filePath, source);
  const bindings = createSourceBindings(program);
  const dependencies = new Set<string>();
  let incomplete = false;
  const dereference = (node: Node, seen = new Set<Node>()): Node => {
    node = unwrap(node);
    if (node.type !== "Identifier" || seen.has(node)) return node;
    seen.add(node);
    const declaration = bindings.resolve(node)?.declaration;
    if (declaration?.type === "VariableDeclarator" && declaration.init)
      return dereference(declaration.init, seen);
    return declaration ?? node;
  };
  let exported: Node | undefined;
  for (const statement of program.body) {
    if (statement.type === "ExportDefaultDeclaration")
      exported = statement.declaration;
    if (statement.type === "ExportNamedDeclaration")
      for (const item of statement.specifiers)
        if (keyOf(item.exported) === "default") exported = item.local;
  }
  // CJS直接导出，以及本框架esbuild输出的default getter。只读语法，不调用getter。
  if (!exported) {
    walkSourceSyntax(program, (node, _parent, ancestors) => {
      if (ancestors.some((n) => /Function/.test(n.type))) return false;
      if (
        node.type === "AssignmentExpression" &&
        node.operator === "=" &&
        node.left.type === "MemberExpression"
      ) {
        const left = node.left;
        if (
          (left.object.type === "Identifier" &&
            left.object.name === "exports" &&
            memberKey(left) === "default") ||
          (left.object.type === "Identifier" &&
            left.object.name === "module" &&
            memberKey(left) === "exports" &&
            node.right.type !== "CallExpression")
        )
          exported = node.right;
      }
      if (
        node.type === "CallExpression" &&
        node.callee.type === "Identifier" &&
        /^__export\d*$/.test(node.callee.name) &&
        node.arguments[1]?.type === "ObjectExpression"
      ) {
        const item = node.arguments[1].properties.find(
          (p) => p.type === "Property" && keyOf(p.key) === "default",
        );
        if (
          item?.type === "Property" &&
          item.value.type === "ArrowFunctionExpression" &&
          item.value.body.type !== "BlockStatement"
        )
          exported = item.value.body;
      }
    });
  }
  const definition = exported && dereference(exported);
  if (!definition) return { dependencies, incomplete: true };
  const isClass =
    definition.type === "ClassDeclaration" ||
    definition.type === "ClassExpression";
  const constructor = isClass
    ? definition.body.body.find(
        (item) =>
          item.type === "MethodDefinition" && item.kind === "constructor",
      )
    : undefined;
  const factory =
    constructor?.type === "MethodDefinition"
      ? constructor.value
      : definition.type === "FunctionDeclaration" ||
          definition.type === "FunctionExpression" ||
          definition.type === "ArrowFunctionExpression"
        ? definition
        : undefined;
  if (!isClass && !factory) return { dependencies, incomplete: true };
  if (isClass && definition.superClass) incomplete = true;
  const first = factory?.params[0];
  const parameter =
    first?.type === "TSParameterProperty" ? first.parameter : first;
  const parameterId =
    parameter?.type === "AssignmentPattern" ? parameter.left : parameter;
  const appBinding =
    parameterId?.type === "Identifier"
      ? bindings.resolve(parameterId)
      : undefined;
  if (parameterId && !appBinding) incomplete = true;
  const properties = new Map<string, Node>();
  if (
    first?.type === "TSParameterProperty" &&
    parameterId?.type === "Identifier"
  )
    properties.set(parameterId.name, parameterId);
  const writes = new Set<SourceBinding>();
  const uncertainProperties = new Set<string>();
  const ownsThis = (ancestors: readonly Node[]): boolean => {
    for (let index = ancestors.length - 1; index >= 0; index--) {
      const ancestor = ancestors[index]!;
      if (
        ancestor.type === "FunctionExpression" ||
        ancestor.type === "FunctionDeclaration"
      ) {
        const method = ancestors[index - 1];
        return (
          ancestor === factory ||
          (method?.type === "MethodDefinition" &&
            !method.static &&
            ancestors[index - 2] === (isClass ? definition.body : undefined))
        );
      }
      if (ancestor.type === "PropertyDefinition")
        return (
          !ancestor.static &&
          ancestors[index - 1] === (isClass ? definition.body : undefined)
        );
    }
    return false;
  };
  walkSourceSyntax(definition, (node, _parent, ancestors) => {
    if (
      node !== definition &&
      (node.type === "ClassDeclaration" || node.type === "ClassExpression")
    )
      return false;
    const target =
      node.type === "AssignmentExpression"
        ? node.left
        : node.type === "UpdateExpression"
          ? node.argument
          : undefined;
    if (target?.type === "Identifier") {
      const binding = bindings.resolve(target);
      if (binding) writes.add(binding);
    }
    if (
      target?.type !== "MemberExpression" ||
      target.object.type !== "ThisExpression" ||
      !ownsThis(ancestors)
    )
      return;
    const key = memberKey(target);
    if (key === null) {
      incomplete = true;
      return;
    }
    const directConstructorAssignment =
      node.type === "AssignmentExpression" &&
      node.operator === "=" &&
      ancestors.at(-1)?.type === "ExpressionStatement" &&
      ancestors.at(-2) === factory?.body;
    if (directConstructorAssignment && !properties.has(key))
      properties.set(key, node.right);
    else uncertainProperties.add(key);
  });

  // null为已知非app；undefined为无法证明；数组是从真实app起始的访问路径。
  const pathOf = (
    input: Node,
    ancestors: readonly Node[],
    seen = new Set<Node>(),
  ): (string | null)[] | null | undefined => {
    const node = unwrap(input);
    if (seen.has(node)) return undefined;
    seen.add(node);
    if (node.type === "Identifier") {
      const binding = bindings.resolve(node);
      if (!binding || writes.has(binding)) return undefined;
      if (binding === appBinding) return [];
      if (
        binding.declaration.type === "VariableDeclarator" &&
        binding.declaration.init
      )
        return pathOf(binding.declaration.init, ancestors, seen);
      return undefined;
    }
    if (node.type === "MemberExpression") {
      const key = memberKey(node);
      if (node.object.type === "ThisExpression") {
        if (
          !ownsThis(ancestors) ||
          key === null ||
          uncertainProperties.has(key)
        )
          return undefined;
        const value = properties.get(key);
        return value ? pathOf(value, ancestors, seen) : undefined;
      }
      const parent = pathOf(node.object, ancestors, seen);
      return Array.isArray(parent) ? [...parent, key] : parent;
    }
    if (
      [
        "ObjectExpression",
        "ArrayExpression",
        "Literal",
        "NewExpression",
      ].includes(node.type)
    )
      return null;
    return undefined;
  };

  walkSourceSyntax(definition, (node, parent, ancestors) => {
    if (
      node !== definition &&
      (node.type === "ClassDeclaration" || node.type === "ClassExpression")
    )
      return false;
    if (node.type === "CallExpression" || node.type === "NewExpression") {
      for (const argument of node.arguments) {
        const origin = pathOf(argument, ancestors);
        // Passing the app or its service namespace to opaque code loses complete dependency evidence.
        if (
          Array.isArray(origin) &&
          (origin.length === 0 ||
            (origin.length === 1 && origin[0] === "services"))
        )
          incomplete = true;
      }
    }
    if (node.type !== "MemberExpression") return;
    if (parent?.type === "MemberExpression" && parent.object === node) return;
    const parts = pathOf(node, ancestors);
    if (!Array.isArray(parts)) {
      if (parts === undefined) {
        let current: Node = node;
        while (current.type === "MemberExpression") {
          if (memberKey(current) === "services") incomplete = true;
          current = current.object;
        }
      }
      return;
    }
    if (parts[0] !== "services") return;
    const keys = parts.slice(1);
    const dependency = [...knownKeys]
      .filter((key) => {
        const segments = key.split(".");
        return (
          segments.length <= keys.length &&
          segments.every((part, i) => keys[i] === part)
        );
      })
      .sort((a, b) => b.length - a.length)[0];
    if (dependency && dependency !== serviceKey) dependencies.add(dependency);
    if (!dependency || keys.some((key) => key === null)) incomplete = true;
  });
  return { dependencies, incomplete };
}

/** 同一图在Loader与Doctor使用同一环路判定；自引用由收集器按既有合同排除。 */
export function findServiceDependencyCycles(
  graph: ReadonlyMap<string, ReadonlySet<string>>,
): string[][] {
  const visited = new Set<string>();
  const stack = new Set<string>();
  const cycles: string[][] = [];
  const visit = (key: string, path: string[]): void => {
    if (stack.has(key)) {
      cycles.push([...path.slice(path.indexOf(key)), key]);
      return;
    }
    if (visited.has(key)) return;
    visited.add(key);
    stack.add(key);
    for (const dependency of graph.get(key) ?? [])
      visit(dependency, [...path, key]);
    stack.delete(key);
  };
  for (const key of graph.keys()) visit(key, []);
  return cycles;
}
