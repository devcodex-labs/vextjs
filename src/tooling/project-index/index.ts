import { join, resolve } from "node:path";
import { assertPathInside } from "../../lib/path-boundary.js";
import { SourceViewError, type SourceView } from "../source-view/types.js";
import {
  parseSourceSyntax,
  walkSourceSyntax,
  sourceValueReferences,
  type SyntaxNode,
} from "../../lib/source-syntax.js";
import {
  collectProjectSources,
  PROJECT_SOURCE_ROOT_ID,
  projectSourceDirectory,
  type ProjectSourceOptions,
} from "./source-input.js";
import {
  filePathToServiceKeys,
  toGeneratedImportPath,
} from "../../shared/service-paths.js";
import { getTypegenGeneratedPaths } from "../typegen/generated-paths.js";
import {
  isRuntimeAppExtensionKey,
  renderTypeStringLiteral,
} from "../typegen/property-key.js";

export type ExtensionSourceKind =
  | "setup"
  | "onReady"
  | "onClose"
  | "declaration";
export type InferenceConfidence = "high" | "medium" | "low";

export interface ServiceIndexEntry {
  filePath: string;
  importPath: string;
  serviceKey: string;
  keySegments: string[];
}

export interface AppExtensionIndexEntry {
  pluginFile: string;
  propertyKey: string;
  inferredTypeText: string;
  sourceKind: ExtensionSourceKind;
  confidence: InferenceConfidence;
}

export interface ProjectIndex {
  readonly source: {
    readonly view: SourceView;
    readonly rootId: string;
    readonly rootDir: string;
  };
  serviceEntries: ServiceIndexEntry[];
  appExtensions: AppExtensionIndexEntry[];
  appExtensionIncompleteFiles?: string[];
}

const LIFECYCLE_METHODS: Array<Exclude<ExtensionSourceKind, "declaration">> = [
  "setup",
  "onReady",
  "onClose",
];

export async function buildProjectIndex(
  rootDir: string,
  options: ProjectSourceOptions = {},
): Promise<ProjectIndex> {
  const view = await collectProjectSources(
    rootDir,
    ["service", "plugin"],
    options,
  );
  return buildProjectIndexFromSourceView(rootDir, view, options);
}

/** 只投影封存正文，供 CLI 与候选 Overlay 分析复用。 */
export function buildProjectIndexFromSourceView(
  rootDir: string,
  view: SourceView,
  options: ProjectSourceOptions = {},
): ProjectIndex {
  rootDir = resolve(rootDir);
  const rootId = options.rootId ?? PROJECT_SOURCE_ROOT_ID;
  const servicesDir = join(rootDir, projectSourceDirectory("service", options));
  const pluginsDir = join(rootDir, projectSourceDirectory("plugin", options));
  const paths = getTypegenGeneratedPaths(rootDir);

  const serviceEntries = view
    .list({ rootId, roles: ["service"] })
    .map((record) => {
      const filePath = join(rootDir, record.path);
      assertPathInside(servicesDir, filePath, "indexed service source");
      const keySegments = filePathToServiceKeys(filePath, servicesDir);
      return {
        filePath,
        importPath: toGeneratedImportPath(paths.servicesDts, filePath),
        serviceKey: keySegments.join("."),
        keySegments,
      } satisfies ServiceIndexEntry;
    })
    .sort((a, b) => a.serviceKey.localeCompare(b.serviceKey));

  const appExtensionIncompleteFiles: string[] = [];
  const appExtensions = view
    .list({ rootId, roles: ["plugin"] })
    .flatMap((record) => {
      const filePath = join(rootDir, record.path);
      assertPathInside(pluginsDir, filePath, "indexed plugin source");
      const source = view.read(rootId, record.path);
      if (source === undefined) {
        throw new SourceViewError(
          "VEXT_SOURCE_UNVERIFIED",
          "Indexed plugin source is absent from its sealed view: " +
            record.path +
            ".",
        );
      }
      const scan = scanAppExtensions(filePath, paths.appExtensionsDts, source);
      if (scan.incomplete) appExtensionIncompleteFiles.push(filePath);
      return scan.entries;
    })
    .sort((a, b) => a.propertyKey.localeCompare(b.propertyKey));

  return {
    source: Object.freeze({ view, rootId, rootDir }),
    serviceEntries,
    appExtensions,
    appExtensionIncompleteFiles,
  };
}

function scanAppExtensions(
  pluginFile: string,
  generatedFilePath: string,
  source: string,
): { entries: AppExtensionIndexEntry[]; incomplete: boolean } {
  const program = parseSourceSyntax(pluginFile, source);
  const entries: AppExtensionIndexEntry[] = [];
  let incomplete = false;
  const factories = new Map<string, string>();
  for (const node of program.body) {
    if (node.type !== "ImportDeclaration" || node.source.value !== "vextjs")
      continue;
    for (const specifier of node.specifiers) {
      if (
        specifier.type === "ImportSpecifier" &&
        specifier.importKind !== "type"
      ) {
        factories.set(
          specifier.local.name,
          specifier.imported.type === "Identifier"
            ? specifier.imported.name
            : String(specifier.imported.value),
        );
      }
    }
  }
  const text = (node: SyntaxNode) => source.slice(node.start, node.end);
  const keyOf = (node: SyntaxNode): string | undefined =>
    node.type === "Identifier"
      ? node.name
      : node.type === "Literal" && typeof node.value === "string"
        ? node.value
        : undefined;
  const unwrap = (node: SyntaxNode): SyntaxNode => {
    while (
      node.type === "TSAsExpression" ||
      node.type === "TSSatisfiesExpression" ||
      node.type === "TSNonNullExpression"
    )
      node = node.expression;
    return node;
  };

  for (const node of program.body) {
    if (
      node.type !== "ExportNamedDeclaration" ||
      node.declaration?.type !== "VariableDeclaration"
    )
      continue;
    for (const declaration of node.declaration.declarations) {
      if (
        declaration.id.type !== "Identifier" ||
        declaration.id.name !== "appExtensions"
      )
        continue;
      const init = declaration.init && unwrap(declaration.init);
      if (
        node.declaration.kind !== "const" ||
        init?.type !== "CallExpression" ||
        init.callee.type !== "Identifier" ||
        factories.get(init.callee.name) !== "defineAppExtensions"
      ) {
        incomplete = true;
        continue;
      }
      const type = init.typeArguments?.params[0];
      if (type?.type !== "TSTypeLiteral") {
        incomplete = true;
        continue;
      }
      for (const member of type.members) {
        if (
          member.type !== "TSPropertySignature" &&
          member.type !== "TSMethodSignature"
        ) {
          incomplete = true;
          continue;
        }
        const key = !member.computed ? keyOf(member.key) : undefined;
        if (!key) {
          incomplete = true;
          continue;
        }
        entries.push({
          pluginFile,
          propertyKey: key,
          inferredTypeText: `typeof import("${toGeneratedImportPath(generatedFilePath, pluginFile)}").appExtensions[${renderTypeStringLiteral(key)}]`,
          sourceKind: "declaration",
          confidence: "high",
        });
      }
    }
  }
  const declared = new Set(entries.map((entry) => entry.propertyKey));
  const portableType = (type: SyntaxNode): boolean => {
    let portable = true;
    walkSourceSyntax(type, (node) => {
      // 引用本地类型必须经exported appExtensions声明；不能复制失去作用域的类型名。
      if (
        node.type === "TSTypeQuery" ||
        node.type === "TSImportType" ||
        node.type === "TSTypeParameterDeclaration"
      )
        portable = false;
      if (
        node.type === "TSTypeReference" &&
        (node.typeName.type !== "Identifier" ||
          ![
            "Promise",
            "Array",
            "ReadonlyArray",
            "Record",
            "Map",
            "Set",
            "Date",
          ].includes(node.typeName.name))
      )
        portable = false;
    });
    return portable;
  };
  for (const node of program.body) {
    if (node.type !== "ExportDefaultDeclaration") continue;
    let value = unwrap(node.declaration);
    if (
      value.type === "CallExpression" &&
      value.callee.type === "Identifier" &&
      factories.get(value.callee.name) === "definePlugin"
    ) {
      const argument = value.arguments[0];
      if (!argument || argument.type === "SpreadElement") {
        incomplete = true;
        continue;
      }
      value = unwrap(argument);
    }
    if (value.type !== "ObjectExpression") {
      incomplete = true;
      continue;
    }
    for (const property of value.properties) {
      if (property.type !== "Property") {
        incomplete = true;
        continue;
      }
      const lifecycle = !property.computed ? keyOf(property.key) : undefined;
      if (
        !LIFECYCLE_METHODS.includes(
          lifecycle as (typeof LIFECYCLE_METHODS)[number],
        )
      )
        continue;
      const fn = property.value;
      if (
        fn.type !== "FunctionExpression" &&
        fn.type !== "ArrowFunctionExpression"
      ) {
        incomplete = true;
        continue;
      }
      if (!fn.body) {
        incomplete = true;
        continue;
      }
      const body = fn.body;
      const app = fn.params[0];
      if (app?.type !== "Identifier") {
        incomplete = true;
        continue;
      }
      const bindings = new Map<string, SyntaxNode>();
      const mutable = new Set<string>();
      if (body.type === "BlockStatement")
        for (const statement of body.body) {
          if (
            statement.type === "VariableDeclaration" &&
            statement.kind === "const"
          )
            for (const declaration of statement.declarations) {
              if (declaration.id.type === "Identifier" && declaration.init)
                bindings.set(declaration.id.name, declaration.init);
            }
        }
      walkSourceSyntax(body, (current) => {
        if (
          current.type === "VariableDeclarator" &&
          current.init &&
          unwrap(current.init).type === "Identifier" &&
          (unwrap(current.init) as { name: string }).name === app.name
        )
          incomplete = true;
        if (current.type === "CallExpression") {
          const frameworkCall =
            current.callee.type === "MemberExpression" &&
            current.callee.object.type === "Identifier" &&
            current.callee.object.name === app.name &&
            !current.callee.computed;
          for (const argument of current.arguments)
            for (const reference of sourceValueReferences(argument)) {
              if (reference === app.name) incomplete = true;
              if (
                !frameworkCall &&
                bindings.has(reference) &&
                unwrap(bindings.get(reference)!).type !== "Literal"
              )
                mutable.add(reference);
            }
        }
        if (
          current.type === "AssignmentExpression" ||
          current.type === "UpdateExpression"
        ) {
          let target: SyntaxNode =
            current.type === "AssignmentExpression"
              ? current.left
              : current.argument;
          while (target.type === "MemberExpression") target = target.object;
          if (target.type === "Identifier") mutable.add(target.name);
        }
      });
      let changed = true;
      while (changed) {
        changed = false;
        for (const [name, value] of bindings)
          for (const reference of sourceValueReferences(value)) {
            if (
              !bindings.has(reference) ||
              unwrap(bindings.get(reference)!).type === "Literal"
            )
              continue;
            if (mutable.has(name) || mutable.has(reference)) {
              if (!mutable.has(name) || !mutable.has(reference)) changed = true;
              mutable.add(name);
              mutable.add(reference);
            }
          }
      }
      if (mutable.has(app.name)) incomplete = true;
      const infer = (
        input: SyntaxNode,
        visited = new Set<string>(),
      ): { type: string; confidence: InferenceConfidence } => {
        const value = unwrap(input);
        if (
          value.type === "Identifier" &&
          !visited.has(value.name) &&
          !mutable.has(value.name)
        ) {
          const init = bindings.get(value.name);
          if (init) return infer(init, new Set([...visited, value.name]));
        }
        if (
          value.type === "Literal" &&
          ["string", "number", "boolean"].includes(typeof value.value)
        )
          return { type: typeof value.value, confidence: "medium" };
        if (
          value.type === "UnaryExpression" &&
          value.operator === "-" &&
          value.argument.type === "Literal" &&
          typeof value.argument.value === "number"
        )
          return { type: "number", confidence: "medium" };
        if (value.type === "ObjectExpression") {
          const methods: string[] = [];
          const properties: string[] = [];
          for (const property of value.properties) {
            if (
              property.type !== "Property" ||
              property.computed ||
              property.kind !== "init"
            )
              return { type: "unknown", confidence: "low" };
            const key = keyOf(property.key);
            if (!key) return { type: "unknown", confidence: "low" };
            const renderedKey = /^[A-Za-z_$][\w$]*$/u.test(key)
              ? key
              : renderTypeStringLiteral(key);
            const value = unwrap(property.value);
            if (
              property.method &&
              (value.type === "FunctionExpression" ||
                value.type === "ArrowFunctionExpression")
            ) {
              if (
                value.typeParameters ||
                value.params.some(
                  (param) =>
                    param.type !== "Identifier" ||
                    (param.typeAnnotation &&
                      !portableType(param.typeAnnotation)),
                ) ||
                (value.returnType && !portableType(value.returnType))
              )
                return { type: "unknown", confidence: "low" };
              const params = value.params
                .map((param) => {
                  if (param.type !== "Identifier") return "";
                  return param.typeAnnotation
                    ? text(param)
                    : param.name + ": any";
                })
                .join(", ");
              const returns = value.returnType
                ? text(value.returnType).replace(/^:\s*/u, "")
                : value.async
                  ? "Promise<any>"
                  : "any";
              methods.push(renderedKey + "(" + params + "): " + returns + ";");
            } else {
              const child = infer(value, visited);
              if (child.confidence === "low")
                return { type: "unknown", confidence: "low" };
              properties.push(renderedKey + ": " + child.type + ";");
            }
          }
          return {
            type:
              methods.length + properties.length
                ? "{ " + [...methods, ...properties].join(" ") + " }"
                : "Record<string, unknown>",
            confidence: "medium",
          };
        }
        return { type: "unknown", confidence: "low" };
      };
      walkSourceSyntax(body, (call, _parent, ancestors) => {
        if (
          call.type === "CallExpression" &&
          call.arguments.some(
            (argument) =>
              argument.type === "Identifier" && argument.name === app.name,
          )
        )
          incomplete = true;
        if (
          call.type !== "CallExpression" ||
          call.callee.type !== "MemberExpression" ||
          call.callee.object.type !== "Identifier" ||
          call.callee.object.name !== app.name
        )
          return;
        if (call.callee.computed) {
          incomplete = true;
          return;
        }
        const method = !call.callee.computed
          ? keyOf(call.callee.property)
          : undefined;
        if (method !== "extend") return;
        const keyNode = call.arguments[0];
        const key =
          keyNode?.type === "Literal" && typeof keyNode.value === "string"
            ? keyNode.value
            : undefined;
        if (!key) {
          incomplete = true;
          return;
        }
        if (declared.has(key)) return;
        if (!isRuntimeAppExtensionKey(key)) return;
        const argument = call.arguments[1];
        const conditional = ancestors.some((ancestor) =>
          [
            "IfStatement",
            "ConditionalExpression",
            "SwitchStatement",
            "ForStatement",
            "ForOfStatement",
            "WhileStatement",
            "FunctionExpression",
            "ArrowFunctionExpression",
          ].includes(ancestor.type),
        );
        const inferred =
          argument && argument.type !== "SpreadElement" && !conditional
            ? infer(argument)
            : { type: "unknown", confidence: "low" as const };
        if (inferred.confidence === "low") incomplete = true;
        entries.push({
          pluginFile,
          propertyKey: key,
          inferredTypeText: inferred.type,
          sourceKind: lifecycle as Exclude<ExtensionSourceKind, "declaration">,
          confidence: inferred.confidence,
        });
      });
    }
  }
  return { entries, incomplete };
}
