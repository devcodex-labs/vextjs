import type { SyntaxNode } from "../../lib/source-syntax.js";
import { createStaticModuleFromText } from "./static-module-graph.js";

export type StaticValue =
  | { kind: "known"; value: unknown }
  | { kind: "object"; fields: Map<string, StaticValue>; unknownKeys: boolean }
  | { kind: "array"; items: StaticValue[] }
  | { kind: "unknown"; reason: string }
  | { kind: "invalid"; reason: string };

export interface StaticFact {
  state: "known" | "absent" | "unknown" | "invalid";
  value?: unknown;
  sourceRefs: string[];
  reason?: string;
}

export const absentStaticValue = (): StaticValue => ({
  kind: "object",
  fields: new Map(),
  unknownKeys: false,
});
const unknown = (reason: string): StaticValue => ({ kind: "unknown", reason });

export function unwrapStaticExpression(node: SyntaxNode): SyntaxNode {
  let current = node;
  while (
    [
      "TSAsExpression",
      "TSSatisfiesExpression",
      "TSNonNullExpression",
      "TSTypeAssertion",
    ].includes(current.type)
  ) {
    current = (current as SyntaxNode & { expression: SyntaxNode }).expression;
  }
  return current;
}

export function staticKey(node: SyntaxNode): string | undefined {
  if (node.type === "Identifier") return node.name;
  if (
    node.type === "Literal" &&
    (typeof node.value === "string" || typeof node.value === "number")
  )
    return String(node.value);
  return undefined;
}

/** 只解释可证明的字面量/局部常量；不调用用户函数、getter、导入或环境表达式。 */
export function readStaticExpression(
  node: SyntaxNode,
  variables: ReadonlyMap<string, SyntaxNode> = new Map(),
  unsafeVariables: ReadonlySet<string> = new Set(),
): StaticValue {
  let remaining = 20_000;
  const evaluate = (
    input: SyntaxNode,
    seen: ReadonlySet<string>,
    depth: number,
  ): StaticValue => {
    if (--remaining < 0 || depth > 128)
      return unknown("Static expression budget exceeded.");
    const current = unwrapStaticExpression(input);
    if (current.type === "Literal")
      return "regex" in current || "bigint" in current
        ? unknown("Non-JSON literal requires a runtime representation.")
        : { kind: "known", value: current.value };
    if (current.type === "Identifier") {
      if (current.name === "undefined" && !variables.has(current.name))
        return { kind: "known", value: undefined };
      const initializer = variables.get(current.name);
      if (
        !initializer ||
        seen.has(current.name) ||
        unsafeVariables.has(current.name)
      )
        return unknown(`Unproven local value: ${current.name}.`);
      return evaluate(initializer, new Set([...seen, current.name]), depth + 1);
    }
    if (
      current.type === "UnaryExpression" &&
      ["+", "-", "!"].includes(current.operator)
    ) {
      const value = evaluate(current.argument, seen, depth + 1);
      if (value.kind !== "known") return unknown("Dynamic unary expression.");
      if (current.operator === "!")
        return { kind: "known", value: !value.value };
      if (typeof value.value !== "number")
        return unknown("Unproven numeric conversion.");
      return {
        kind: "known",
        value: current.operator === "-" ? -value.value : value.value,
      };
    }
    if (current.type === "TemplateLiteral" && current.expressions.length === 0)
      return { kind: "known", value: current.quasis[0]?.value.cooked ?? "" };
    if (current.type === "ArrayExpression") {
      return {
        kind: "array",
        items: current.elements.map((item) =>
          item
            ? evaluate(item, seen, depth + 1)
            : { kind: "known", value: undefined },
        ),
      };
    }
    if (current.type === "ObjectExpression") {
      const fields = new Map<string, StaticValue>();
      let unknownKeys = false;
      for (const property of current.properties) {
        if (property.type === "SpreadElement") {
          const spread = evaluate(property.argument, seen, depth + 1);
          if (spread.kind === "object") {
            if (spread.unknownKeys) {
              for (const key of fields.keys())
                fields.set(
                  key,
                  unknown("A later dynamic spread may override this field."),
                );
              unknownKeys = true;
            }
            for (const [key, value] of spread.fields) fields.set(key, value);
          } else {
            for (const key of fields.keys())
              fields.set(
                key,
                unknown("A later dynamic spread may override this field."),
              );
            unknownKeys = true;
          }
          continue;
        }
        const key = property.computed
          ? property.key.type === "Literal"
            ? staticKey(property.key)
            : undefined
          : staticKey(property.key);
        if (key === undefined) {
          for (const knownKey of fields.keys())
            fields.set(
              knownKey,
              unknown("A dynamic key may override this field."),
            );
          unknownKeys = true;
          continue;
        }
        fields.set(
          key,
          property.kind !== "init" || property.method
            ? unknown("Methods and accessors are not executed.")
            : evaluate(property.value, seen, depth + 1),
        );
      }
      return { kind: "object", fields, unknownKeys };
    }
    return unknown(`Expression ${current.type} requires runtime evaluation.`);
  };
  return evaluate(node, new Set(), 0);
}

/** 局部常量被赋值或传给不透明调用时，不把其初始对象冒充最终配置。 */
export function readStaticDefault(
  sourceFile: string,
  source: string,
): StaticValue {
  try {
    const module = createStaticModuleFromText(sourceFile, source);
    const { program, bindings: variables, invalid: unsafe } = module;
    const exported = program.body.find(
      (node) => node.type === "ExportDefaultDeclaration",
    );
    if (exported?.type === "ExportDefaultDeclaration")
      return readStaticExpression(exported.declaration, variables, unsafe);
    // 用户 CJS 配置只接受显式 module.exports = 对象；不执行 require。
    for (const statement of program.body) {
      if (
        statement.type !== "ExpressionStatement" ||
        statement.expression.type !== "AssignmentExpression"
      )
        continue;
      const assignment = statement.expression;
      if (
        assignment.operator === "=" &&
        assignment.left.type === "MemberExpression" &&
        !assignment.left.computed &&
        assignment.left.object.type === "Identifier" &&
        assignment.left.object.name === "module" &&
        assignment.left.property.type === "Identifier" &&
        assignment.left.property.name === "exports"
      ) {
        return readStaticExpression(assignment.right, variables, unsafe);
      }
    }
    return unknown("No statically readable default config export.");
  } catch (error) {
    return {
      kind: "invalid",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function staticMember(
  value: StaticValue,
  key: string,
): StaticValue | undefined {
  if (value.kind === "object")
    return (
      value.fields.get(key) ??
      (value.unknownKeys
        ? unknown("A dynamic spread or key may define this field.")
        : undefined)
    );
  if (value.kind === "unknown" || value.kind === "invalid") return value;
  if (value.kind === "array") {
    if (key === "length") return { kind: "known", value: value.items.length };
    if (/^(?:0|[1-9]\d*)$/u.test(key)) return value.items[Number(key)];
  }
  return undefined;
}

export function staticFact(
  value: StaticValue | undefined,
  sourceRefs: string[],
): StaticFact {
  if (value === undefined) return { state: "absent", sourceRefs };
  if (value.kind === "unknown" || value.kind === "invalid")
    return { state: value.kind, reason: value.reason, sourceRefs };
  if (value.kind === "known")
    return { state: "known", value: value.value, sourceRefs };
  if (value.kind === "array") {
    const facts = value.items.map((item) => staticFact(item, sourceRefs));
    const incomplete = facts.find((fact) => fact.state !== "known");
    return (
      incomplete ?? {
        state: "known",
        value: facts.map((fact) => fact.value),
        sourceRefs,
      }
    );
  }
  if (value.unknownKeys)
    return {
      state: "unknown",
      sourceRefs,
      reason: "Object contains unproven fields.",
    };
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, member] of value.fields) {
    const fact = staticFact(member, sourceRefs);
    if (fact.state !== "known") return fact;
    Object.defineProperty(result, key, { value: fact.value, enumerable: true });
  }
  return { state: "known", value: result, sourceRefs };
}

/** 普通对象深合并，数组及标量替换；动态高优先级字段不会恢复成旧的已知值。 */
export function mergeStaticValues(
  base: StaticValue,
  override: StaticValue,
): StaticValue {
  if (override.kind !== "object") return override;
  const fields =
    base.kind === "object"
      ? new Map(base.fields)
      : new Map<string, StaticValue>();
  const unknownKeys =
    override.unknownKeys ||
    (base.kind === "object" ? base.unknownKeys : base.kind !== "known");
  if (override.unknownKeys)
    for (const key of fields.keys())
      fields.set(key, unknown("A later config layer may override this field."));
  for (const [key, value] of override.fields)
    fields.set(
      key,
      fields.has(key) && value.kind === "object"
        ? mergeStaticValues(fields.get(key)!, value)
        : value,
    );
  return { kind: "object", fields, unknownKeys };
}
