import { createSourceBindings } from "../source-bindings.js";
import {
  parseSourceSyntax,
  walkSourceSyntax,
  type SyntaxNode,
} from "../source-syntax.js";
import {
  unwrapStaticExpression,
  staticKey,
} from "../../tooling/project-index/static-values.js";
import { readCjsJobProjection } from "./job-cjs-projection.js";

export interface JobDeclaration {
  state: "known" | "unsupported" | "unknown";
  declarationCardinality: number;
  declarationCalls: SyntaxNode[];
  reason?: string;
  format: "esm" | "cjs-direct" | "cjs-projection";
  definition?: SyntaxNode;
  reexport?: string;
  namedExports: string[];
  namedDefaultDependencies: {
    exportName: string;
    source: string;
    importedName?: string;
  }[];
  defaultValueKind: "job" | "ordinary" | "unknown";
  namedValueKinds: Record<string, "job" | "ordinary" | "unknown">;
}

/** Finite authoring grammar, not execution or a whole-program side-effect sandbox. */
export function analyzeJobDeclaration(
  file: string,
  source: string,
  options: {
    verifiedDependencyScope?: (specifier: string) => boolean | undefined;
  } = {},
): JobDeclaration {
  const program = parseSourceSyntax(file, source);
  const lexical = createSourceBindings(program);
  const projection = readCjsJobProjection(program, lexical);
  type Binding = NonNullable<ReturnType<typeof lexical.resolve>>;
  const factories = new Set<Binding["identifier"]>();
  const namespaces = new Set<Binding["identifier"]>();
  const initializers = new Map<
    Binding["identifier"],
    { value: SyntaxNode; kind: string }
  >();
  const imports = new Map<
    Binding["identifier"],
    { source: string; name: string }
  >();
  const writes = new Set<Binding["identifier"]>();
  const initialized = new Set<Binding["identifier"]>();
  const named = new Map<string, SyntaxNode | null>();
  const namedDefaultDependencies: JobDeclaration["namedDefaultDependencies"] =
    [];
  let defaultNode: SyntaxNode | undefined;
  let reexport: string | undefined;
  let format: JobDeclaration["format"] = "esm";
  let reason: string | undefined;
  let missingScopeEvidence = false;
  let mutableNamed = false;

  const identity = (node: SyntaxNode) =>
    node.type === "Identifier" ? lexical.resolve(node)?.identifier : undefined;
  const unbound = (node: SyntaxNode, name: string) =>
    node.type === "Identifier" && node.name === name && !lexical.resolve(node);
  const rewrittenGlobals = new Set<string>();
  const recordGlobalWrite = (target: SyntaxNode | null | undefined): void => {
    if (!target) return;
    if (target.type === "Identifier" && !lexical.resolve(target))
      rewrittenGlobals.add(target.name);
    if (target.type === "ObjectPattern")
      for (const property of target.properties)
        recordGlobalWrite(
          property.type === "Property" ? property.value : property.argument,
        );
    if (target.type === "ArrayPattern")
      for (const element of target.elements) recordGlobalWrite(element);
    if (target.type === "RestElement") recordGlobalWrite(target.argument);
    if (target.type === "AssignmentPattern") recordGlobalWrite(target.left);
  };
  walkSourceSyntax(program, (node) => {
    const target =
      node.type === "AssignmentExpression"
        ? node.left
        : node.type === "UpdateExpression"
          ? node.argument
          : node.type === "ForOfStatement" || node.type === "ForInStatement"
            ? node.left
            : undefined;
    recordGlobalWrite(target);
  });
  const requireSource = (
    value: SyntaxNode | null | undefined,
  ): string | undefined => {
    if (rewrittenGlobals.has("require")) return;
    const projected = value && projection?.namespaceSource(value);
    if (projected) return projected;
    if (
      value?.type !== "CallExpression" ||
      !unbound(value.callee, "require") ||
      value.arguments.length !== 1
    )
      return;
    const argument = value.arguments[0];
    return argument?.type === "Literal" && typeof argument.value === "string"
      ? argument.value
      : undefined;
  };
  const memberKey = (node: SyntaxNode) =>
    node.type === "MemberExpression" &&
    (!node.computed || node.property.type === "Literal")
      ? staticKey(node.property)
      : undefined;
  const moduleExport = (node: SyntaxNode) =>
    node.type === "MemberExpression" &&
    unbound(node.object, "module") &&
    memberKey(node) === "exports";

  // SDK declaration cardinality includes every lexical scope, even uncalled
  // functions. Alias resolution for the effective default remains top-level.
  walkSourceSyntax(program, (node) => {
    if (
      node.type !== "VariableDeclarator" ||
      requireSource(node.init) !== "vextjs"
    )
      return;
    const key = identity(node.id);
    if (key) namespaces.add(key);
    if (node.id.type === "ObjectPattern")
      for (const property of node.id.properties)
        if (
          property.type === "Property" &&
          !property.computed &&
          staticKey(property.key) === "defineJob"
        ) {
          const factory = identity(property.value);
          if (factory) factories.add(factory);
        }
  });

  for (const statement of program.body) {
    if (
      statement.type === "ImportDeclaration" &&
      statement.importKind !== "type"
    ) {
      for (const specifier of statement.specifiers) {
        const key = identity(specifier.local);
        if (!key) continue;
        if (statement.source.value === "vextjs") {
          if (specifier.type === "ImportNamespaceSpecifier")
            namespaces.add(key);
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.importKind !== "type" &&
            staticKey(specifier.imported) === "defineJob"
          )
            factories.add(key);
        }
        if (specifier.type === "ImportDefaultSpecifier")
          imports.set(key, {
            source: String(statement.source.value),
            name: "default",
          });
        if (
          specifier.type === "ImportSpecifier" &&
          specifier.importKind !== "type"
        )
          imports.set(key, {
            source: String(statement.source.value),
            name: staticKey(specifier.imported)!,
          });
      }
    }
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? statement.declaration
        : statement;
    if (declaration?.type === "FunctionDeclaration" && declaration.id) {
      const key = identity(declaration.id);
      if (key) initializers.set(key, { value: declaration, kind: "const" });
      if (statement.type === "ExportNamedDeclaration")
        named.set(declaration.id.name, declaration.id);
    }
    if (declaration?.type === "VariableDeclaration") {
      for (const item of declaration.declarations) {
        if (!item.init) continue;
        const key = identity(item.id);
        if (key) {
          if (initialized.has(key)) writes.add(key);
          initialized.add(key);
          initializers.set(key, { value: item.init, kind: declaration.kind });
        }
        if (requireSource(item.init) === "vextjs") {
          if (key) namespaces.add(key);
          if (item.id.type === "ObjectPattern")
            for (const property of item.id.properties) {
              if (
                property.type === "Property" &&
                !property.computed &&
                staticKey(property.key) === "defineJob"
              ) {
                const factory = identity(property.value);
                if (factory) {
                  if (initialized.has(factory)) writes.add(factory);
                  initialized.add(factory);
                  factories.add(factory);
                }
              }
            }
        }
        if (
          statement.type === "ExportNamedDeclaration" &&
          item.id.type === "Identifier"
        )
          named.set(item.id.name, item.id);
      }
    }
    if (statement.type === "ExportDefaultDeclaration") {
      if (defaultNode || reexport) reason = "multiple default exports";
      defaultNode = statement.declaration;
    }
    if (
      statement.type === "ExportAllDeclaration" &&
      statement.exportKind !== "type"
    )
      reason = "dynamic export-star is unsupported";
    if (statement.type === "ExportNamedDeclaration")
      for (const specifier of statement.specifiers) {
        if (
          specifier.type !== "ExportSpecifier" ||
          statement.exportKind === "type" ||
          specifier.exportKind === "type"
        )
          continue;
        const name = staticKey(specifier.exported);
        if (name === "default") {
          if (defaultNode || reexport) reason = "multiple default exports";
          if (statement.source && staticKey(specifier.local) === "default")
            reexport = String(statement.source.value);
          else if (!statement.source) defaultNode = specifier.local;
          else reason = "default must reexport the dependency default";
        } else if (name) {
          named.set(name, statement.source ? null : specifier.local);
          if (statement.source)
            namedDefaultDependencies.push({
              exportName: name,
              source: String(statement.source.value),
              importedName: staticKey(specifier.local),
            });
        }
      }
    if (
      statement.type === "ExpressionStatement" &&
      statement.expression.type === "AssignmentExpression" &&
      moduleExport(statement.expression.left)
    ) {
      if (defaultNode || reexport || statement.expression.operator !== "=")
        reason = "mutable module.exports is unsupported";
      defaultNode = statement.expression.right;
      format = "cjs-direct";
    }
  }
  if (projection) {
    format = "cjs-projection";
    defaultNode = projection.exports.get("default");
    named.clear();
    for (const [name, value] of projection.exports)
      if (name !== "default") named.set(name, value);
  }
  const isScopeBinding = (node: SyntaxNode): boolean => {
    if (
      node.type !== "CallExpression" ||
      node.arguments.length !== 1 ||
      !node.arguments[0] ||
      !unbound(node.arguments[0], "module")
    )
      return false;
    let callee = unwrapStaticExpression(node.callee);
    if (
      callee.type === "SequenceExpression" &&
      callee.expressions.length === 2 &&
      callee.expressions[0]?.type === "Literal" &&
      callee.expressions[0].value === 0
    )
      callee = callee.expressions[1]!;
    if (
      callee.type !== "MemberExpression" ||
      callee.computed ||
      staticKey(callee.property) !== "default"
    )
      return false;
    const key = identity(callee.object);
    const initializer = key && initializers.get(key);
    const dependency =
      initializer && projection?.namespaceSource(initializer.value);
    if (!dependency) return false;
    const verified = options.verifiedDependencyScope?.(dependency);
    if (
      verified === undefined &&
      /(?:^|\/)\.vext-dependencies\.cjs$/u.test(dependency)
    )
      missingScopeEvidence = true;
    return verified === true;
  };

  const factoryCall = (value: SyntaxNode): boolean => {
    let node = unwrapStaticExpression(value);
    if (
      node.type === "SequenceExpression" &&
      node.expressions.length === 2 &&
      node.expressions[0]?.type === "Literal" &&
      node.expressions[0].value === 0
    )
      node = unwrapStaticExpression(node.expressions[1]!);
    if (node.type === "Identifier") {
      const key = identity(node);
      return !!key && factories.has(key);
    }
    if (node.type !== "MemberExpression" || memberKey(node) !== "defineJob")
      return false;
    const key = identity(node.object);
    return (
      (!!key && namespaces.has(key)) || requireSource(node.object) === "vextjs"
    );
  };
  const calls: SyntaxNode[] = [];
  walkSourceSyntax(program, (node, _parent, ancestors) => {
    if (node.type === "CallExpression" && factoryCall(node.callee))
      calls.push(node);
    let target: SyntaxNode | undefined =
      node.type === "AssignmentExpression"
        ? node.left
        : node.type === "UpdateExpression"
          ? node.argument
          : node.type === "UnaryExpression" && node.operator === "delete"
            ? node.argument
            : undefined;
    while (target?.type === "MemberExpression") target = target.object;
    const key = target && identity(target);
    if (key) writes.add(key);
    if (
      node.type === "AssignmentExpression" &&
      moduleExport(node.left) &&
      !projection?.allowedModuleAssignments.has(node) &&
      !program.body.some(
        (statement) =>
          statement.type === "ExpressionStatement" &&
          statement.expression === node,
      )
    )
      reason ??= "late CommonJS export mutation is unsupported";
    if (node.type !== "Identifier" || !lexical.isReference(node)) return;
    if (
      ancestors.some(
        (item) =>
          item.type === "ImportDeclaration" ||
          (item.type === "VariableDeclarator" &&
            node.start >= item.id.start &&
            node.end <= item.id.end),
      )
    )
      return;
    const binding = identity(node);
    if (binding && (factories.has(binding) || namespaces.has(binding))) {
      const calleeUse = ancestors.some(
        (item) =>
          item.type === "CallExpression" &&
          factoryCall(item.callee) &&
          node.start >= item.callee.start &&
          node.end <= item.callee.end,
      );
      if (!calleeUse)
        reason ??= "SDK binding escapes its finite declaration position";
    }
    if (unbound(node, "exports") || unbound(node, "module")) {
      const directExport = ancestors.some(
        (item) =>
          item.type === "AssignmentExpression" &&
          moduleExport(item.left) &&
          node.start >= item.left.start &&
          node.end <= item.left.end,
      );
      const scopeBinding = projection && ancestors.some(isScopeBinding);
      if (!directExport && !scopeBinding)
        reason ??= "dynamic CommonJS export mutation is unsupported";
    }
  });
  for (const binding of [...factories, ...namespaces])
    if (writes.has(binding)) reason ??= "SDK binding is mutable";

  const resolve = (
    input: SyntaxNode,
    namedAlias = false,
  ): {
    node?: SyntaxNode;
    dependency?: string;
    importedName?: string;
    mutable?: boolean;
  } => {
    let node = unwrapStaticExpression(input);
    let mutable = false;
    const seen = new Set<Binding["identifier"]>();
    while (node.type === "Identifier") {
      const key = identity(node);
      if (!key || seen.has(key) || (!namedAlias && writes.has(key)))
        return { mutable };
      if (writes.has(key)) mutable = true;
      seen.add(key);
      if (seen.size > 64) return { mutable };
      const dependency = imports.get(key);
      if (dependency)
        return {
          dependency: dependency.source,
          importedName: dependency.name,
          mutable,
        };
      const initializer = initializers.get(key);
      if (
        !initializer ||
        (!namedAlias &&
          initializer.kind !== "const" &&
          !(projection && initializer.kind === "var"))
      )
        return { mutable };
      node = unwrapStaticExpression(initializer.value);
    }
    if (node.type === "MemberExpression" && !node.computed) {
      const key = identity(node.object);
      const initializer = key && initializers.get(key);
      const dependency = initializer && requireSource(initializer.value);
      if (key && writes.has(key)) mutable = true;
      if (
        dependency &&
        dependency !== "vextjs" &&
        key &&
        (namedAlias || !writes.has(key))
      )
        return { dependency, importedName: staticKey(node.property), mutable };
    }
    return { node: projection?.unwrapName(node) ?? node, mutable };
  };
  const resolved = defaultNode ? resolve(defaultNode) : {};
  if (resolved.dependency) {
    if (resolved.importedName !== "default")
      reason ??= "default must reexport the dependency default";
    else reexport ??= resolved.dependency;
  }
  if (
    rewrittenGlobals.has("require") ||
    rewrittenGlobals.has("module") ||
    rewrittenGlobals.has("exports")
  )
    reason ??= "CommonJS transport identity is rewritten";
  if (format === "cjs-direct" && resolved.node) {
    const dependency = requireSource(resolved.node);
    if (dependency && dependency !== "vextjs") reexport = dependency;
  }
  const valueKind = (node?: SyntaxNode): "job" | "ordinary" | "unknown" =>
    node?.type === "CallExpression" && factoryCall(node.callee)
      ? "job"
      : node &&
          [
            "Literal",
            "FunctionDeclaration",
            "FunctionExpression",
            "ArrowFunctionExpression",
            "ObjectExpression",
            "ArrayExpression",
            "TemplateLiteral",
            "ClassDeclaration",
            "ClassExpression",
          ].includes(node.type)
        ? "ordinary"
        : "unknown";
  const namedValueKinds: JobDeclaration["namedValueKinds"] = {};
  for (const [exportName, value] of named) {
    if (!value) continue;
    const fact = resolve(value, true);
    if (fact.dependency)
      namedDefaultDependencies.push({
        exportName,
        source: fact.dependency,
        importedName: fact.importedName,
      });
    if (
      fact.dependency &&
      fact.importedName === "default" &&
      fact.dependency === reexport
    )
      reason ??= "a Job-valued named default alias is unsupported";
    const result = fact.node;
    namedValueKinds[exportName] = valueKind(result);
    if (fact.mutable) {
      namedValueKinds[exportName] = "unknown";
      mutableNamed = true;
    }
    if (result?.type === "CallExpression" && factoryCall(result.callee))
      reason ??= "a Job-valued named export is unsupported";
  }
  for (const statement of program.body)
    if (
      statement.type === "ExportNamedDeclaration" &&
      statement.exportKind !== "type" &&
      statement.source
    )
      for (const specifier of statement.specifiers)
        if (
          specifier.type === "ExportSpecifier" &&
          specifier.exportKind !== "type" &&
          staticKey(specifier.exported) !== "default" &&
          staticKey(specifier.local) === "default" &&
          statement.source.value === reexport
        )
          reason ??= "a Job-valued named default reexport alias is unsupported";
  if (calls.length > 1) reason = "multiple SDK Job declaration positions";
  if (reexport && calls.length)
    reason ??= "a default reexport shell must not declare a Job";
  if (
    !reexport &&
    (calls.length !== 1 ||
      resolved.node?.type !== "CallExpression" ||
      !factoryCall(resolved.node.callee))
  )
    reason ??= "default is not a finite SDK Job declaration";
  const unknownNamed = mutableNamed && !reason;
  if (unknownNamed)
    reason = "mutable named export has an unknown effective value";
  return {
    state:
      unknownNamed ||
      (missingScopeEvidence &&
        reason === "dynamic CommonJS export mutation is unsupported")
        ? "unknown"
        : reason
          ? "unsupported"
          : "known",
    declarationCardinality: calls.length,
    declarationCalls: calls,
    reason,
    format,
    definition:
      !reexport &&
      resolved.node?.type === "CallExpression" &&
      factoryCall(resolved.node.callee)
        ? resolved.node
        : undefined,
    reexport,
    namedExports: [...named.keys()],
    namedDefaultDependencies,
    defaultValueKind: valueKind(resolved.node),
    namedValueKinds,
  };
}

/** Bounded provenance for named default values; never execute a helper. */
export function inspectNamedJobDependencies(
  file: string,
  declaration: JobDeclaration,
  dependency: (
    file: string,
    specifier: string,
  ) => { file: string; fact: JobDeclaration } | undefined,
): { state: "known" | "unsupported" | "unknown"; reason?: string } {
  for (const named of declaration.namedDefaultDependencies) {
    let current = dependency(file, named.source);
    let exported = named.importedName ?? "default";
    const seen = new Set<string>();
    let kind: JobDeclaration["defaultValueKind"] = "unknown";
    while (
      current &&
      !seen.has(current.file + "#" + exported) &&
      seen.size < 64
    ) {
      seen.add(current.file + "#" + exported);
      const fact = current.fact;
      kind =
        exported === "default"
          ? fact.defaultValueKind
          : (fact.namedValueKinds[exported] ?? "unknown");
      if (kind !== "unknown") break;
      const forward =
        exported === "default" && fact.reexport
          ? { source: fact.reexport, importedName: "default" }
          : fact.namedDefaultDependencies.find(
              (item) => item.exportName === exported,
            );
      if (!forward) break;
      exported = forward.importedName ?? "default";
      current = dependency(current.file, forward.source);
    }
    if (kind === "job")
      return {
        state: "unsupported",
        reason: `Job-valued named dependency ${named.exportName} is unsupported`,
      };
    if (kind !== "ordinary")
      return {
        state: "unknown",
        reason: `named default dependency ${named.exportName} is unavailable, opaque, circular or over budget`,
      };
  }
  return { state: "known" };
}
