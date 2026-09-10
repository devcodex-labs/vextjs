import { createRequire } from "node:module";
import type { Node, Program, ParserOptions } from "oxc-parser";

export type { Node as SyntaxNode } from "oxc-parser";

let parser: typeof import("oxc-parser") | undefined;

/** 共享语法入口只解析文本，不加载用户模块或项目 parser 配置。 */
export function parseSourceSyntax(
  filename: string,
  source: string,
  options: Pick<ParserOptions, "lang" | "sourceType"> = {},
): Program {
  // defineRoutes 是同步 API；延迟加载使普通 import 和浏览器契约不加载 native parser。
  parser ??= createRequire(
    typeof __filename === "string" ? __filename : import.meta.url,
  )("oxc-parser");
  const result = parser!.parseSync(filename, source, {
    sourceType: "unambiguous",
    astType: "ts",
    preserveParens: false,
    showSemanticErrors: true,
    ...options,
  });
  if (result.errors.length) {
    const error = result.errors[0]!;
    throw new SyntaxError(
      `[vextjs] ${filename}:${error.labels[0]?.start ?? 0}: ${error.message}`,
    );
  }
  return result.program;
}

export function isSyntaxNode(value: unknown): value is Node {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.type === "string" &&
    typeof record.start === "number" &&
    typeof record.end === "number"
  );
}

/** 显式栈避免深层源码耗尽 JS 递归栈；返回 false 可跳过当前子树。 */
export function walkSourceSyntax(
  root: Node,
  visit: (
    node: Node,
    parent: Node | null,
    ancestors: readonly Node[],
  ) => boolean | void,
): void {
  const stack: { node: Node; parent: Node | null; ancestors: Node[] }[] = [
    { node: root, parent: null, ancestors: [] },
  ];
  while (stack.length) {
    const { node, parent, ancestors } = stack.pop()!;
    if (visit(node, parent, ancestors) === false) continue;
    const children = Object.values(node).flatMap((value) =>
      Array.isArray(value)
        ? value.filter(isSyntaxNode)
        : isSyntaxNode(value)
          ? [value]
          : [],
    );
    const nextAncestors = [...ancestors, node];
    for (let i = children.length - 1; i >= 0; i--)
      stack.push({
        node: children[i]!,
        parent: node,
        ancestors: nextAncestors,
      });
  }
}

/** 收集值位置的引用；容器不能掩盖逃逸，属性名、类型名和延迟函数体不算值依赖。 */
export function sourceValueReferences(node: Node): string[] {
  const names = new Set<string>();
  walkSourceSyntax(node, (current, parent) => {
    if (
      current.type.startsWith("TS") &&
      ![
        "TSAsExpression",
        "TSSatisfiesExpression",
        "TSNonNullExpression",
        "TSTypeAssertion",
      ].includes(current.type)
    )
      return false;
    if (
      current.type === "FunctionExpression" ||
      current.type === "ArrowFunctionExpression"
    )
      return false;
    if (current.type !== "Identifier") return;
    if (
      parent?.type === "Property" &&
      parent.key === current &&
      !parent.computed &&
      !parent.shorthand
    )
      return;
    if (
      parent?.type === "MemberExpression" &&
      parent.property === current &&
      !parent.computed
    )
      return;
    names.add(current.name);
  });
  return [...names];
}
