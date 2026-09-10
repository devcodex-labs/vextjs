import type { Node } from "oxc-parser";
import { walkSourceSyntax } from "./source-syntax.js";

type Identifier = Extract<Node, { type: "Identifier" }>;

interface Scope {
  parent?: Scope;
  functionScope: boolean;
  names: Map<string, SourceBinding>;
}

export interface SourceBinding {
  identifier: Identifier;
  declaration: Node;
}

/** 只描述语法中的词法身份，不推断类型或执行值；声明先收集，引用随后解析。 */
export function createSourceBindings(root: Node): {
  resolve: (identifier: Identifier) => SourceBinding | undefined;
  isReference: (identifier: Identifier) => boolean;
} {
  const scopes = new WeakMap<Node, Scope>();
  const declarations = new WeakSet<Node>();
  const parents = new WeakMap<Node, Node>();
  const fallback: Scope = { functionScope: true, names: new Map() };

  const bind = (pattern: Node, declaration: Node, scope: Scope): void => {
    if (pattern.type === "Identifier") {
      declarations.add(pattern);
      scope.names.set(pattern.name, { identifier: pattern, declaration });
    } else if (pattern.type === "TSParameterProperty") {
      bind(pattern.parameter, declaration, scope);
    } else if (pattern.type === "AssignmentPattern") {
      bind(pattern.left, declaration, scope);
    } else if (pattern.type === "RestElement") {
      bind(pattern.argument, declaration, scope);
    } else if (pattern.type === "ObjectPattern") {
      for (const item of pattern.properties)
        bind(
          item.type === "Property" ? item.value : item.argument,
          declaration,
          scope,
        );
    } else if (pattern.type === "ArrayPattern") {
      for (const item of pattern.elements)
        if (item) bind(item, declaration, scope);
    }
  };

  walkSourceSyntax(root, (node, parent) => {
    if (parent) parents.set(node, parent);
    let scope = (parent && scopes.get(parent)) || fallback;
    const isFunction =
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression";
    if (
      (node.type === "FunctionDeclaration" ||
        node.type === "ClassDeclaration") &&
      node.id
    )
      bind(node.id, node, scope);
    if (
      isFunction ||
      node.type === "Program" ||
      node.type === "BlockStatement" ||
      node.type === "CatchClause" ||
      node.type === "ForStatement" ||
      node.type === "ForInStatement" ||
      node.type === "ForOfStatement" ||
      node.type === "SwitchStatement" ||
      node.type === "ClassExpression" ||
      node.type === "ClassDeclaration" ||
      node.type === "StaticBlock"
    ) {
      scope = {
        parent: scope,
        functionScope:
          isFunction || node.type === "Program" || node.type === "StaticBlock",
        names: new Map(),
      };
    }
    scopes.set(node, scope);
    if (isFunction) {
      if (node.type === "FunctionExpression" && node.id)
        bind(node.id, node, scope);
      for (const param of node.params) bind(param, node, scope);
    }
    if (node.type === "ClassExpression" && node.id) bind(node.id, node, scope);
    if (node.type === "CatchClause" && node.param)
      bind(node.param, node, scope);
    if (node.type === "VariableDeclaration") {
      let target = scope;
      if (node.kind === "var")
        while (!target.functionScope && target.parent) target = target.parent;
      for (const declaration of node.declarations)
        bind(declaration.id, declaration, target);
    }
    if (node.type === "ImportDeclaration")
      for (const specifier of node.specifiers)
        bind(specifier.local, node, scope);
  });

  return {
    resolve(identifier) {
      let scope = scopes.get(identifier);
      while (scope) {
        const binding = scope.names.get(identifier.name);
        if (binding) return binding;
        scope = scope.parent;
      }
      return undefined;
    },
    isReference(identifier) {
      if (declarations.has(identifier)) return false;
      const parent = parents.get(identifier);
      if (!parent) return true;
      if (
        parent.type === "MemberExpression" &&
        parent.property === identifier &&
        !parent.computed
      )
        return false;
      if (
        (parent.type === "Property" ||
          parent.type === "MethodDefinition" ||
          parent.type === "PropertyDefinition") &&
        parent.key === identifier &&
        !parent.computed
      )
        return parent.type === "Property" && parent.shorthand;
      if (
        parent.type === "LabeledStatement" ||
        parent.type === "BreakStatement" ||
        parent.type === "ContinueStatement"
      )
        return false;
      // 类型位置的同名标识符不引用运行时值。
      let ancestor: Node | undefined = parent;
      while (ancestor) {
        if (
          ancestor.type.startsWith("TS") &&
          ![
            "TSAsExpression",
            "TSSatisfiesExpression",
            "TSNonNullExpression",
            "TSTypeAssertion",
            "TSParameterProperty",
          ].includes(ancestor.type)
        )
          return false;
        ancestor = parents.get(ancestor);
      }
      return true;
    },
  };
}
