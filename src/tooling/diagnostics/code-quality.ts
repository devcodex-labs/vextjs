import { createSourceBindings } from "../../lib/source-bindings.js";
import {
  parseSourceSyntax,
  walkSourceSyntax,
  type SyntaxNode,
} from "../../lib/source-syntax.js";
import { unwrapStaticExpression } from "../project-index/static-values.js";

export interface SourceQualityFacts {
  databaseTypeBypass: boolean;
  eagerRedisAdapter: boolean;
  apiForm: boolean;
  placeholderAssertion: boolean;
}

/** 约定检查只观察实际语法节点；注释、字符串和其他节点中的同名片段不构成证据。 */
export function inspectSourceQuality(
  file: string,
  source: string,
): SourceQualityFacts {
  const program = parseSourceSyntax(file, source);
  const facts: SourceQualityFacts = {
    databaseTypeBypass: false,
    eagerRedisAdapter: false,
    apiForm: false,
    placeholderAssertion: false,
  };
  const bindings = createSourceBindings(program);
  const redisFactories = new Set<SyntaxNode>();
  const expectations = new Set<SyntaxNode>();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type !== "ImportSpecifier") continue;
      const imported =
        specifier.imported.type === "Identifier"
          ? specifier.imported.name
          : specifier.imported.value;
      if (
        imported === "createRedisCacheAdapter" &&
        ["vextjs", "vextjs/cache", "cache-hub"].includes(statement.source.value)
      )
        redisFactories.add(specifier.local);
      if (
        imported === "expect" &&
        ["vitest", "@jest/globals"].includes(statement.source.value)
      )
        expectations.add(specifier.local);
    }
  }
  walkSourceSyntax(program, (node, _parent, ancestors) => {
    if (
      (node.type === "TSTypeAliasDeclaration" ||
        node.type === "TSInterfaceDeclaration") &&
      ["Collection", "Db", "Cursor"].includes(node.id.name)
    )
      facts.databaseTypeBypass = true;
    if (node.type === "TSAsExpression" || node.type === "TSTypeAssertion") {
      const value = unwrapStaticExpression(node.expression);
      if (
        value.type === "MemberExpression" &&
        !value.computed &&
        value.property.type === "Identifier" &&
        value.property.name === "db" &&
        value.object.type === "Identifier" &&
        value.object.name === "app"
      )
        facts.databaseTypeBypass = true;
    }
    if (
      node.type === "JSXOpeningElement" &&
      node.name.type === "JSXIdentifier" &&
      node.name.name === "form"
    ) {
      const attributes = new Map(
        node.attributes.flatMap((attribute) =>
          attribute.type === "JSXAttribute" &&
          attribute.name.type === "JSXIdentifier" &&
          attribute.value?.type === "Literal"
            ? [[attribute.name.name, attribute.value.value] as const]
            : [],
        ),
      );
      facts.apiForm ||=
        String(attributes.get("method")).toLowerCase() === "post" &&
        typeof attributes.get("action") === "string" &&
        String(attributes.get("action")).startsWith("/api");
    }
    if (node.type !== "CallExpression") return;
    if (
      node.callee.type === "Identifier" &&
      redisFactories.has(
        bindings.resolve(node.callee)?.identifier as SyntaxNode,
      ) &&
      !ancestors.some((parent) =>
        [
          "ArrowFunctionExpression",
          "FunctionExpression",
          "FunctionDeclaration",
        ].includes(parent.type),
      )
    )
      facts.eagerRedisAdapter = true;
    if (
      node.callee.type !== "MemberExpression" ||
      node.callee.computed ||
      node.callee.property.type !== "Identifier" ||
      !["toBe", "toEqual", "toStrictEqual"].includes(node.callee.property.name)
    )
      return;
    const assertion = node.callee.object;
    if (
      assertion.type !== "CallExpression" ||
      assertion.callee.type !== "Identifier" ||
      assertion.arguments.length !== 1 ||
      node.arguments.length !== 1
    )
      return;
    const binding = bindings.resolve(assertion.callee);
    if (
      binding
        ? !expectations.has(binding.identifier)
        : assertion.callee.name !== "expect"
    )
      return;
    const actual = assertion.arguments[0]!,
      expected = node.arguments[0]!;
    if (
      actual.type === "Literal" &&
      expected.type === "Literal" &&
      Object.is(actual.value, expected.value)
    )
      facts.placeholderAssertion = true;
  });
  return facts;
}
