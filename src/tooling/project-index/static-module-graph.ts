import type { Node, Program } from "oxc-parser";
import {
  parseSourceSyntax,
  walkSourceSyntax,
  sourceValueReferences as valueReferences,
} from "../../lib/source-syntax.js";
import { schemaAdapter } from "../../lib/schema-adapter.js";
import { createSourceBindings } from "../../lib/source-bindings.js";
import { isVextRouteMethod } from "../../lib/route-factory-contract.js";
import type { SourceView } from "../source-view/types.js";
import { sourceModuleReferences } from "./module-path.js";

export interface StaticSourceLocation {
  rootId: string;
  file: string;
  start: number;
  end: number;
  symbols: string[];
}

export interface StaticExpression {
  module: StaticModule;
  node: Node;
  symbols: readonly string[];
}

interface ImportBinding {
  source: string;
  name: string;
}
export interface StaticModule {
  rootId: string;
  path: string;
  source: string;
  program: Program;
  bindings: Map<string, Node>;
  imports: Map<string, ImportBinding>;
  exports: Map<string, Node | ImportBinding>;
  invalid: Set<string>;
  parents: WeakMap<Node, Node>;
}

export class StaticProjectionError extends Error {
  readonly completeness = "unknown";
  constructor(
    readonly origin: StaticSourceLocation,
    readonly reason: string,
  ) {
    super(
      `[vextjs] ${origin.file}:${origin.start}-${origin.end} is not statically resolvable: ${reason}${origin.symbols.length ? ` (${origin.symbols.join(" → ")})` : ""}.`,
    );
    this.name = "StaticProjectionError";
  }
}

const nameOf = (node: Node): string | undefined =>
  node.type === "Identifier"
    ? node.name
    : node.type === "Literal"
      ? String(node.value)
      : undefined;

export function unwrapStaticNode(node: Node): Node {
  while (
    node.type === "TSAsExpression" ||
    node.type === "TSSatisfiesExpression" ||
    node.type === "TSNonNullExpression" ||
    node.type === "TSTypeAssertion" ||
    node.type === "ParenthesizedExpression"
  )
    node = node.expression;
  return node;
}

function assignedRoot(node: Node): string | undefined {
  node = unwrapStaticNode(node);
  while (node.type === "MemberExpression") node = node.object;
  return node.type === "Identifier" ? node.name : undefined;
}

function bindingNames(node: Node): string[] {
  if (node.type === "Identifier") return [node.name];
  if (node.type === "AssignmentPattern") return bindingNames(node.left);
  if (node.type === "RestElement") return bindingNames(node.argument);
  if (node.type === "ObjectPattern")
    return node.properties.flatMap((item) =>
      bindingNames(item.type === "Property" ? item.value : item.argument),
    );
  if (node.type === "ArrayPattern")
    return node.elements.flatMap((item) => (item ? bindingNames(item) : []));
  return [];
}

function mayBeMutable(
  node: Node | undefined,
  bindings: ReadonlyMap<string, Node>,
  seen = new Set<string>(),
): boolean {
  if (!node) return true;
  node = unwrapStaticNode(node);
  if (
    node.type === "Literal" ||
    node.type === "TemplateLiteral" ||
    node.type === "UnaryExpression"
  )
    return false;
  if (node.type === "Identifier" && !seen.has(node.name)) {
    seen.add(node.name);
    return mayBeMutable(bindings.get(node.name), bindings, seen);
  }
  return true;
}

function shadowed(name: string, ancestors: readonly Node[]): boolean {
  return ancestors.some((scope) => {
    if (
      (scope.type === "FunctionDeclaration" ||
        scope.type === "FunctionExpression" ||
        scope.type === "ArrowFunctionExpression") &&
      scope.params.some((param) => bindingNames(param).includes(name))
    )
      return true;
    if (scope.type !== "BlockStatement") return false;
    return scope.body.some(
      (item) =>
        item.type === "VariableDeclaration" &&
        item.declarations.some((declaration) =>
          bindingNames(declaration.id).includes(name),
        ),
    );
  });
}

/** 有限值解析器仅消费封存文本；不会 import、eval、加载 tsconfig 或执行用户 helper。 */
export class StaticModuleGraph {
  private readonly modules = new Map<string, StaticModule>();

  constructor(private readonly view: SourceView) {
    for (const record of view.list())
      if (/\.[cm]?[jt]sx?$/u.test(record.path))
        this.module(record.rootId, record.path);
    this.propagateMutability();
  }

  module(rootId: string, file: string): StaticModule {
    const key = `${rootId}:${file}`;
    const existing = this.modules.get(key);
    if (existing) return existing;
    const source = this.view.read(rootId, file);
    if (source === undefined)
      throw new StaticProjectionError(
        { rootId, file, start: 0, end: 0, symbols: [] },
        "module is outside the sealed source graph",
      );
    const program = parseSourceSyntax(file, source);
    const module: StaticModule = {
      rootId,
      path: file,
      source,
      program,
      bindings: new Map(),
      imports: new Map(),
      exports: new Map(),
      invalid: new Set(),
      parents: new WeakMap(),
    };
    this.modules.set(key, module);
    for (const statement of program.body) {
      if (
        statement.type === "ImportDeclaration" &&
        statement.importKind !== "type"
      ) {
        for (const specifier of statement.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.importKind !== "type"
          )
            module.imports.set(specifier.local.name, {
              source: statement.source.value,
              name: nameOf(specifier.imported)!,
            });
          else module.invalid.add(specifier.local.name);
        }
      }
      const declaration =
        statement.type === "ExportNamedDeclaration"
          ? statement.declaration
          : statement;
      if (declaration?.type === "VariableDeclaration") {
        for (const item of declaration.declarations) {
          if (
            declaration.kind === "const" &&
            item.id.type === "Identifier" &&
            item.init
          ) {
            module.bindings.set(item.id.name, item.init);
            if (statement.type === "ExportNamedDeclaration")
              module.exports.set(item.id.name, item.id);
          } else
            for (const name of bindingNames(item.id)) module.invalid.add(name);
        }
      }
      if (declaration?.type === "FunctionDeclaration" && declaration.id)
        module.bindings.set(declaration.id.name, declaration);
      if (statement.type === "ExportDefaultDeclaration")
        module.exports.set("default", statement.declaration);
      if (
        statement.type === "ExportNamedDeclaration" &&
        statement.exportKind !== "type"
      ) {
        for (const specifier of statement.specifiers) {
          if (specifier.exportKind === "type") continue;
          const name = nameOf(specifier.exported)!;
          module.exports.set(
            name,
            statement.source
              ? {
                  source: statement.source.value,
                  name: nameOf(specifier.local)!,
                }
              : specifier.local,
          );
        }
      }
    }
    const lexical = createSourceBindings(program);
    const functions = new Set<Node>();
    const factories = new Map<Node, Node>();
    const isFunction = (node: Node) =>
      [
        "FunctionDeclaration",
        "FunctionExpression",
        "ArrowFunctionExpression",
      ].includes(node.type);
    const localValue = (node: Node): Node => {
      node = unwrapStaticNode(node);
      if (node.type !== "Identifier") return node;
      const declaration = lexical.resolve(node)?.declaration;
      return declaration?.type === "VariableDeclarator" && declaration.init
        ? unwrapStaticNode(declaration.init)
        : (declaration ?? node);
    };
    const frameworkCall = (node: Node, name: string): boolean => {
      if (node.type !== "CallExpression") return false;
      const callee =
        node.callee.type === "MemberExpression"
          ? node.callee.object
          : node.callee;
      return (
        callee.type === "Identifier" &&
        lexical.resolve(callee)?.declaration.type === "ImportDeclaration" &&
        module.imports.get(callee.name)?.source === "vextjs" &&
        module.imports.get(callee.name)?.name === name
      );
    };
    const registration = (node: Node, ancestors: readonly Node[]): boolean => {
      if (
        node.type !== "CallExpression" ||
        node.callee.type !== "MemberExpression"
      )
        return false;
      const callee = node.callee;
      if (
        callee.object.type !== "Identifier" ||
        callee.computed ||
        callee.property.type !== "Identifier" ||
        !isVextRouteMethod(callee.property.name)
      )
        return false;
      const factory = [...ancestors]
        .reverse()
        .find((ancestor) => factories.has(ancestor));
      const param = factory && factories.get(factory);
      return (
        param?.type === "Identifier" &&
        lexical.resolve(callee.object) === lexical.resolve(param)
      );
    };
    // 已知同步入口（模块、defineRoutes工厂、立即调用函数）传播执行阶段。
    // handler本身是延迟入口；未知helper接收的callback不能假设一定延迟。
    let expanded = true;
    while (expanded) {
      expanded = false;
      walkSourceSyntax(program, (node, parent, ancestors) => {
        if (parent) module.parents.set(node, parent);
        if (
          node.type !== "CallExpression" ||
          ancestors.some(
            (ancestor) => isFunction(ancestor) && !functions.has(ancestor),
          )
        )
          return;
        const add = (candidate: Node) => {
          const value = localValue(candidate);
          if (isFunction(value) && !functions.has(value)) {
            functions.add(value);
            expanded = true;
          }
          return value;
        };
        if (frameworkCall(node, "defineRoutes") && node.arguments[0]) {
          const factory = add(node.arguments[0]);
          if (
            factory.type === "FunctionExpression" ||
            factory.type === "ArrowFunctionExpression"
          )
            if (factory.params[0]) factories.set(factory, factory.params[0]);
        } else {
          add(node.callee);
          if (!registration(node, ancestors))
            for (const argument of node.arguments)
              if (isFunction(unwrapStaticNode(argument))) add(argument);
        }
      });
    }
    const origins = (node: Node, seen = new Set<Node>()): Set<string> => {
      const result = new Set<string>();
      walkSourceSyntax(node, (value) => {
        if (isFunction(value)) return false;
        if (
          value.type !== "Identifier" ||
          !lexical.isReference(value) ||
          seen.has(value)
        )
          return;
        seen.add(value);
        const declaration = lexical.resolve(value)?.declaration;
        if (declaration?.type === "ImportDeclaration") result.add(value.name);
        else if (
          declaration?.type === "VariableDeclarator" &&
          declaration.init
        ) {
          if (module.bindings.get(value.name) === declaration.init)
            result.add(value.name);
          else
            for (const name of origins(declaration.init, seen))
              result.add(name);
        }
      });
      return result;
    };
    walkSourceSyntax(program, (node, _parent, ancestors) => {
      const target =
        node.type === "AssignmentExpression"
          ? node.left
          : node.type === "UpdateExpression"
            ? node.argument
            : node.type === "UnaryExpression" && node.operator === "delete"
              ? node.argument
              : undefined;
      if (target) for (const name of origins(target)) module.invalid.add(name);
      if (
        node.type !== "CallExpression" ||
        ancestors.some(
          (ancestor) => isFunction(ancestor) && !functions.has(ancestor),
        )
      )
        return;
      if (frameworkCall(node, "defineRoutes") || registration(node, ancestors))
        return;
      if (
        frameworkCall(node, "schemaAdapter") &&
        node.callee.type === "MemberExpression" &&
        !node.callee.computed &&
        nameOf(node.callee.property) === "compileField"
      )
        return;
      for (const argument of node.arguments) {
        for (const name of origins(argument))
          if (
            module.imports.has(name) ||
            (module.bindings.has(name) &&
              mayBeMutable(module.bindings.get(name), module.bindings))
          )
            module.invalid.add(name);
      }
      // 对象方法同样可能变异接收者，例如 options.values.push(...)。
      if (
        node.callee.type === "MemberExpression" &&
        node.callee.object.type !== "CallExpression"
      )
        for (const name of origins(node.callee.object))
          if (module.bindings.has(name) || module.imports.has(name))
            module.invalid.add(name);
    });
    // 对同模块 const 别名的写入同样使原对象失去不可变证据。
    let changed = true;
    while (changed) {
      changed = false;
      for (const [name, value] of module.bindings) {
        const alias = assignedRoot(value);
        if (alias && (module.invalid.has(name) || module.invalid.has(alias))) {
          if (!module.invalid.has(name)) {
            module.invalid.add(name);
            changed = true;
          }
          if (!module.invalid.has(alias)) {
            module.invalid.add(alias);
            changed = true;
          }
        }
      }
    }
    return module;
  }

  /** import/re-export保持对象身份；在任一封存模块中可变，所有别名都必须撤销静态证据。 */
  private propagateMutability(): void {
    const edges: [StaticModule, string, StaticModule, string][] = [];
    for (const module of this.modules.values()) {
      for (const [name, value] of module.bindings) {
        const alias = assignedRoot(value);
        if (alias) edges.push([module, name, module, alias]);
        const unwrapped = unwrapStaticNode(value);
        if (
          unwrapped.type === "ObjectExpression" ||
          unwrapped.type === "ArrayExpression"
        ) {
          for (const child of valueReferences(unwrapped))
            if (
              module.imports.has(child) ||
              (module.bindings.has(child) &&
                mayBeMutable(module.bindings.get(child), module.bindings))
            )
              edges.push([module, name, module, child]);
        }
      }
      const exportedName = (name: string) => `\0export:${name}`;
      const linkImport = (local: string, binding: ImportBinding) => {
        if (binding.source === "vextjs") return;
        const file = sourceModuleReferences(
          this.view.roots(),
          { rootId: module.rootId, path: module.path },
          binding.source,
        ).find((candidate) =>
          this.view.record(candidate.rootId, candidate.path),
        );
        if (file)
          edges.push([
            module,
            local,
            this.module(file.rootId, file.path),
            exportedName(binding.name),
          ]);
      };
      for (const [name, binding] of module.imports) linkImport(name, binding);
      for (const [name, value] of module.exports) {
        if ("type" in value) {
          const alias = assignedRoot(value);
          if (alias) edges.push([module, exportedName(name), module, alias]);
        } else linkImport(exportedName(name), value);
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const [left, leftName, right, rightName] of edges) {
        if (!left.invalid.has(leftName) && !right.invalid.has(rightName))
          continue;
        if (!left.invalid.has(leftName)) {
          left.invalid.add(leftName);
          changed = true;
        }
        if (!right.invalid.has(rightName)) {
          right.invalid.add(rightName);
          changed = true;
        }
      }
    }
  }

  expression(
    module: StaticModule,
    node: Node,
    symbols: readonly string[] = [],
  ): StaticExpression {
    return { module, node, symbols };
  }

  location(expression: StaticExpression): StaticSourceLocation {
    return {
      rootId: expression.module.rootId,
      file: expression.module.path,
      start: expression.node.start,
      end: expression.node.end,
      symbols: [...expression.symbols],
    };
  }

  private fail(expression: StaticExpression, reason: string): never {
    throw new StaticProjectionError(this.location(expression), reason);
  }

  private imported(
    expression: StaticExpression,
    binding: ImportBinding,
  ): StaticExpression {
    const { module } = expression;
    const file = sourceModuleReferences(
      this.view.roots(),
      { rootId: module.rootId, path: module.path },
      binding.source,
    ).find((candidate) => this.view.record(candidate.rootId, candidate.path));
    if (!file)
      return this.fail(
        expression,
        `import ${JSON.stringify(binding.source)} is missing or outside the declared source roots; opaque/imported schema objects and other call chains are not supported`,
      );
    const target = this.module(file.rootId, file.path);
    const exported = target.exports.get(binding.name);
    if (!exported)
      return this.fail(
        expression,
        `named export ${binding.name} is missing; export * and dynamic imports are not statically projectable`,
      );
    const symbols = [
      ...expression.symbols,
      `${target.rootId}:${target.path}::export(${binding.name})`,
    ];
    if (symbols.length > 128 || expression.symbols.includes(symbols.at(-1)!))
      return this.fail(expression, "circular or excessive module symbol chain");
    const next = this.expression(
      target,
      "type" in exported ? exported : target.program,
      symbols,
    );
    return "type" in exported ? next : this.imported(next, exported);
  }

  resolve(input: StaticExpression): StaticExpression {
    let expression = input;
    for (let depth = 0; depth < 128; depth++) {
      const node = unwrapStaticNode(expression.node);
      expression = { ...expression, node };
      if (
        node.type === "MemberExpression" &&
        !node.computed &&
        !node.optional &&
        node.property.type === "Identifier"
      ) {
        const property = this.object(
          { ...expression, node: node.object },
          "member object",
        ).get(node.property.name);
        if (!property)
          return this.fail(
            expression,
            `member ${node.property.name} is missing`,
          );
        expression = property;
        continue;
      }
      if (node.type !== "Identifier") return expression;
      const { module } = expression;
      const ancestors: Node[] = [];
      for (
        let parent = module.parents.get(node);
        parent;
        parent = module.parents.get(parent)
      )
        ancestors.push(parent);
      if (shadowed(node.name, ancestors))
        return this.fail(
          expression,
          `binding ${node.name} is shadowed by a local declaration; only immutable top-level const values are projected`,
        );
      if (module.invalid.has(node.name))
        return this.fail(
          expression,
          `binding ${node.name} is mutable, reassigned, or unsupported`,
        );
      const symbol = `${module.rootId}:${module.path}#${node.name}`;
      if (expression.symbols.includes(symbol))
        return this.fail(expression, "circular const binding");
      const binding = module.bindings.get(node.name);
      if (binding) {
        expression = this.expression(module, binding, [
          ...expression.symbols,
          symbol,
        ]);
        continue;
      }
      const imported = module.imports.get(node.name);
      if (imported && imported.source !== "vextjs") {
        expression = this.imported(
          { ...expression, symbols: [...expression.symbols, symbol] },
          imported,
        );
        continue;
      }
      return expression;
    }
    return this.fail(
      expression,
      "symbol depth exceeds 128; analysis is incomplete",
    );
  }

  frameworkBinding(expression: StaticExpression, expected: string): boolean {
    const resolved = this.resolve(expression);
    if (resolved.node.type !== "Identifier") return false;
    const binding = resolved.module.imports.get(resolved.node.name);
    return binding?.source === "vextjs" && binding.name === expected;
  }

  object(
    input: StaticExpression,
    label: string,
    depth = 0,
  ): Map<string, StaticExpression> {
    const expression = this.resolve(input);
    if (depth > 128)
      return this.fail(
        expression,
        "object spread depth exceeds 128; analysis is incomplete",
      );
    if (expression.node.type !== "ObjectExpression")
      return this.fail(
        expression,
        `${label}${expression.node.type === "CallExpression" ? " helper calls are not statically projectable; inline the final object or use a same-file const or named imported const" : " must be statically resolvable to an object literal"}`,
      );
    const entries = new Map<string, StaticExpression>();
    for (const property of expression.node.properties) {
      const current = this.expression(
        expression.module,
        property,
        expression.symbols,
      );
      if (property.type === "SpreadElement") {
        for (const [key, value] of this.object(
          { ...current, node: property.argument },
          `${label} spread`,
          depth + 1,
        ))
          entries.set(key, value);
        continue;
      }
      if (property.computed)
        return this.fail(
          current,
          `${label} cannot contain computed property keys`,
        );
      if (property.method || property.kind !== "init")
        return this.fail(
          current,
          `${label} getter/setter/method values are opaque`,
        );
      const key = nameOf(property.key);
      if (key === undefined || key === "__proto__")
        return this.fail(
          current,
          `${label} contains an unsupported property key`,
        );
      entries.set(
        key,
        this.expression(expression.module, property.value, expression.symbols),
      );
    }
    return entries;
  }

  value(
    input: StaticExpression,
    label: string,
    origins?: Map<string, StaticSourceLocation>,
    depth = 0,
  ): unknown {
    const expression = this.resolve(input);
    if (depth > 128)
      return this.fail(
        expression,
        "value depth exceeds 128; analysis is incomplete",
      );
    origins?.set(label, this.location(expression));
    const { node, module, symbols } = expression;
    const child = (node: Node) => this.expression(module, node, symbols);
    if (node.type === "Literal" && !("regex" in node) && !("bigint" in node))
      return node.value;
    if (node.type === "TemplateLiteral" && node.expressions.length === 0)
      return node.quasis[0]!.value.cooked;
    if (
      node.type === "UnaryExpression" &&
      (node.operator === "-" || node.operator === "+") &&
      node.argument.type === "Literal" &&
      typeof node.argument.value === "number"
    )
      return node.operator === "-" ? -node.argument.value : node.argument.value;
    if (node.type === "ObjectExpression")
      return Object.fromEntries(
        [...this.object(expression, label)].map(([key, value]) => [
          key,
          this.value(value, `${label}.${key}`, origins, depth + 1),
        ]),
      );
    if (node.type === "ArrayExpression") {
      const array: unknown[] = [];
      for (const item of node.elements) {
        if (!item)
          return this.fail(
            expression,
            `${label} sparse arrays are not projectable`,
          );
        const value = this.value(
          child(item.type === "SpreadElement" ? item.argument : item),
          `${label}[${array.length}]`,
          origins,
          depth + 1,
        );
        if (item.type === "SpreadElement") {
          if (!Array.isArray(value))
            return this.fail(
              expression,
              `${label} array spread must resolve to an array`,
            );
          array.push(...value);
        } else array.push(value);
      }
      return array;
    }
    if (
      node.type === "MemberExpression" &&
      !node.computed &&
      !node.optional &&
      node.property.type === "Identifier"
    ) {
      const value = this.object(child(node.object), label).get(
        node.property.name,
      );
      if (value) return this.value(value, label, origins, depth + 1);
    }
    if (node.type === "CallExpression" && !node.optional) {
      let call = node;
      let description: string | undefined;
      if (
        call.callee.type === "MemberExpression" &&
        !call.callee.computed &&
        call.callee.property.type === "Identifier" &&
        call.callee.property.name === "description" &&
        call.callee.object.type === "CallExpression"
      ) {
        description = this.stringArgument(
          child(call),
          label + " schemaAdapter.description(...) ",
        );
        call = call.callee.object;
      }
      if (
        call.callee.type === "MemberExpression" &&
        !call.callee.computed &&
        !call.callee.optional &&
        call.callee.property.type === "Identifier" &&
        this.frameworkBinding(child(call.callee.object), "schemaAdapter")
      ) {
        if (call.callee.property.name !== "compileField")
          return this.fail(
            expression,
            `${label} uses an unsupported schemaAdapter call chain`,
          );
        const definition = this.stringArgument(
          child(call),
          label + " schemaAdapter.compileField(...)",
        );
        const builder = schemaAdapter.compileField(definition);
        return description === undefined
          ? builder
          : builder.description(description);
      }
      // 未知链只诊断；不会调用 expression 中的用户函数。
      if (module.source.slice(node.start, node.end).includes("compileField"))
        return this.fail(
          expression,
          `${label} uses an unsupported schemaAdapter call chain; opaque/imported schema objects and other call chains are not supported`,
        );
    }
    return this.fail(
      expression,
      `${label} must be statically resolvable; opaque/imported schema objects and other call chains are not supported`,
    );
  }

  private stringArgument(expression: StaticExpression, label: string): string {
    const { node } = expression;
    if (
      node.type === "CallExpression" &&
      node.arguments.length === 1 &&
      node.arguments[0]!.type !== "SpreadElement"
    ) {
      try {
        const value = this.value(
          { ...expression, node: node.arguments[0]! },
          label,
        );
        if (typeof value === "string") return value;
      } catch (error) {
        if (!(error instanceof StaticProjectionError)) throw error;
      }
    }
    return this.fail(
      expression,
      `${label} requires exactly one statically resolvable string argument`,
    );
  }

  text(expression: StaticExpression): string {
    try {
      const resolved = this.resolve(expression);
      return resolved.module.source.slice(
        resolved.node.start,
        resolved.node.end,
      );
    } catch (error) {
      // handler 函数体不是 schema；不能因不透明 handler 丢失已知的路由合同。
      if (!(error instanceof StaticProjectionError)) throw error;
      return expression.module.source.slice(
        expression.node.start,
        expression.node.end,
      );
    }
  }

  project(
    expression: StaticExpression,
    label: string,
  ):
    | {
        completeness: "complete";
        value: unknown;
        sources: Map<string, StaticSourceLocation>;
      }
    | {
        completeness: "unknown";
        origin: StaticSourceLocation;
        reason: string;
      } {
    const sources = new Map<string, StaticSourceLocation>();
    try {
      return {
        completeness: "complete",
        value: this.value(expression, label, sources),
        sources,
      };
    } catch (error) {
      if (!(error instanceof StaticProjectionError)) throw error;
      return {
        completeness: "unknown",
        origin: error.origin,
        reason: error.reason,
      };
    }
  }
}
