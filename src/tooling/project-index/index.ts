import { existsSync } from "node:fs";
import { join } from "node:path";
import fg from "fast-glob";
import { loadTsMorph } from "../shared/lazy-ts-morph.js";
import {
  filePathToServiceKeys,
  toGeneratedImportPath,
} from "../../shared/service-paths.js";

type TsMorphModule = typeof import("ts-morph");
type SourceFile = import("ts-morph").SourceFile;
type Expression = import("ts-morph").Expression;

type ExtensionSourceKind = "setup" | "onReady" | "onClose";
type InferenceConfidence = "high" | "medium" | "low";

export interface ServiceIndexEntry {
  filePath: string;
  importPath: string;
  serviceKey: string;
  keySegments: string[];
  sourceFile: SourceFile;
}

export interface AppExtensionIndexEntry {
  pluginFile: string;
  propertyKey: string;
  inferredTypeText: string;
  sourceKind: ExtensionSourceKind;
  confidence: InferenceConfidence;
}

export interface ProjectIndex {
  serviceEntries: ServiceIndexEntry[];
  appExtensions: AppExtensionIndexEntry[];
}

const SOURCE_PATTERNS = ["**/*.{ts,js,mjs,cjs}"];
const COMMON_IGNORE_PATTERNS = [
  "**/_*/**",
  "**/_*",
  "**/*.d.ts",
  "**/*.test.*",
  "**/*.spec.*",
  "**/*.__vext_compiled__*",
];

const PORTABLE_SINGLE_IDENTIFIERS = new Set([
  "string",
  "number",
  "boolean",
  "unknown",
  "any",
  "never",
  "void",
  "object",
  "null",
  "undefined",
  "bigint",
  "symbol",
  "Date",
  "RegExp",
  "Error",
  "Promise",
  "Array",
  "ReadonlyArray",
  "Record",
  "Map",
  "Set",
  "URL",
  "Uint8Array",
  "Buffer",
]);

export async function buildProjectIndex(rootDir: string): Promise<ProjectIndex> {
  const servicesDir = join(rootDir, "src", "services");
  const pluginsDir = join(rootDir, "src", "plugins");
  const servicesGeneratedFile = join(
    rootDir,
    "src",
    "types",
    "generated",
    "services.generated.d.ts",
  );
  const appExtensionsGeneratedFile = join(
    rootDir,
    "src",
    "types",
    "generated",
    "app-extensions.generated.d.ts",
  );

  const serviceFiles = existsSync(servicesDir)
    ? await fg(SOURCE_PATTERNS, {
        cwd: servicesDir,
        absolute: true,
        onlyFiles: true,
        ignore: COMMON_IGNORE_PATTERNS,
      })
    : [];

  const pluginFiles = existsSync(pluginsDir)
    ? await fg(SOURCE_PATTERNS, {
        cwd: pluginsDir,
        absolute: true,
        onlyFiles: true,
        ignore: COMMON_IGNORE_PATTERNS,
      })
    : [];

  const allSourceFiles = [...new Set([...serviceFiles, ...pluginFiles])].sort((a, b) =>
    a.localeCompare(b),
  );

  const tsMorph = await loadTsMorph();
  const project = createProject(rootDir, allSourceFiles, tsMorph);

  const serviceEntries = serviceFiles
    .map((filePath) => {
      const sourceFile = project.getSourceFile(filePath);
      if (!sourceFile) {
        return null;
      }

      const keySegments = filePathToServiceKeys(filePath, servicesDir);
      return {
        filePath,
        importPath: toGeneratedImportPath(servicesGeneratedFile, filePath),
        serviceKey: keySegments.join("."),
        keySegments,
        sourceFile,
      } satisfies ServiceIndexEntry;
    })
    .filter((entry): entry is ServiceIndexEntry => entry !== null)
    .sort((a, b) => a.serviceKey.localeCompare(b.serviceKey));

  const appExtensions = pluginFiles
    .flatMap((filePath) => {
      const sourceFile = project.getSourceFile(filePath);
      if (!sourceFile) {
        return [];
      }
      return scanAppExtensions(sourceFile, appExtensionsGeneratedFile, tsMorph);
    })
    .sort((a, b) => a.propertyKey.localeCompare(b.propertyKey));

  return {
    serviceEntries,
    appExtensions,
  };
}

function createProject(
  rootDir: string,
  sourceFiles: string[],
  tsMorph: TsMorphModule,
): import("ts-morph").Project {
  const tsconfigPath = join(rootDir, "tsconfig.json");

  if (existsSync(tsconfigPath)) {
    const project = new tsMorph.Project({
      tsConfigFilePath: tsconfigPath,
      skipAddingFilesFromTsConfig: false,
    });

    for (const filePath of sourceFiles) {
      project.addSourceFileAtPathIfExists(filePath);
    }

    return project;
  }

  const project = new tsMorph.Project({
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      module: tsMorph.ts.ModuleKind.NodeNext,
      moduleResolution: tsMorph.ts.ModuleResolutionKind.NodeNext,
      target: tsMorph.ts.ScriptTarget.ES2022,
      strict: false,
    },
    useInMemoryFileSystem: false,
  });

  for (const filePath of sourceFiles) {
    project.addSourceFileAtPath(filePath);
  }

  return project;
}

function scanAppExtensions(
  sourceFile: SourceFile,
  generatedFilePath: string,
  tsMorph: TsMorphModule,
): AppExtensionIndexEntry[] {
  const entries: AppExtensionIndexEntry[] = [];
  const pluginDefinitions = sourceFile
    .getDescendantsOfKind(tsMorph.SyntaxKind.CallExpression)
    .filter((call) => isDefinePluginCall(call, tsMorph));

  for (const pluginDefinition of pluginDefinitions) {
    const pluginOptions = pluginDefinition.getArguments()[0];
    if (!pluginOptions || !tsMorph.Node.isObjectLiteralExpression(pluginOptions)) {
      continue;
    }

    for (const member of pluginOptions.getProperties()) {
      const lifecycleMethod = getLifecycleMethod(member, tsMorph);
      if (!lifecycleMethod) continue;

      const { name, paramName, body } = lifecycleMethod;
      for (const call of body.getDescendantsOfKind(tsMorph.SyntaxKind.CallExpression)) {
        const expression = call.getExpression();
        if (!tsMorph.Node.isPropertyAccessExpression(expression)) continue;
        if (expression.getName() !== "extend") continue;
        if (expression.getExpression().getText() !== paramName) continue;

        const args = call.getArguments();
        const keyArg = args[0];
        const valueArg = args[1];
        if (!keyArg || !valueArg) continue;
        if (
          !tsMorph.Node.isStringLiteral(keyArg) &&
          !tsMorph.Node.isNoSubstitutionTemplateLiteral(keyArg)
        ) {
          continue;
        }

        const propertyKey = keyArg.getLiteralText();
        if (propertyKey.length === 0) continue;

        const { typeText, confidence } = inferPortableType(
          valueArg as Expression,
          generatedFilePath,
          tsMorph,
        );

        entries.push({
          pluginFile: sourceFile.getFilePath(),
          propertyKey,
          inferredTypeText: typeText,
          sourceKind: name,
          confidence,
        });
      }
    }
  }

  return entries;
}

function isDefinePluginCall(
  call: import("ts-morph").CallExpression,
  tsMorph: TsMorphModule,
): boolean {
  const expression = call.getExpression();
  return tsMorph.Node.isIdentifier(expression) && expression.getText() === "definePlugin";
}

function getLifecycleMethod(
  member: import("ts-morph").ObjectLiteralElementLike,
  tsMorph: TsMorphModule,
): {
  name: ExtensionSourceKind;
  paramName: string;
  body: import("ts-morph").Node;
} | null {
  if (tsMorph.Node.isMethodDeclaration(member)) {
    const name = toExtensionSourceKind(member.getName());
    if (!name) return null;

    const paramName = member.getParameters()[0]?.getName();
    const body = member.getBody();
    if (!paramName || !body) return null;

    return { name, paramName, body };
  }

  if (tsMorph.Node.isPropertyAssignment(member)) {
    const name = toExtensionSourceKind(member.getName());
    if (!name) return null;

    const initializer = member.getInitializer();
    if (
      !initializer ||
      (!tsMorph.Node.isArrowFunction(initializer) &&
        !tsMorph.Node.isFunctionExpression(initializer))
    ) {
      return null;
    }

    const paramName = initializer.getParameters()[0]?.getName();
    const body = initializer.getBody();
    if (!paramName || !body) return null;

    return { name, paramName, body };
  }

  return null;
}

function inferPortableType(
  expr: Expression,
  generatedFilePath: string,
  tsMorph: TsMorphModule,
  visited = new Set<number>(),
): { typeText: string; confidence: InferenceConfidence } {
  if (visited.has(expr.getPos())) {
    return { typeText: "unknown", confidence: "low" };
  }
  visited.add(expr.getPos());

  const type = expr.getType();
  const typeText = type.getText(
    expr,
    tsMorph.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
      tsMorph.TypeFormatFlags.NoTruncation,
  );

  if (isPortableTypeText(typeText)) {
    return { typeText, confidence: "high" };
  }

  if (tsMorph.Node.isIdentifier(expr)) {
    const defs = expr.getDefinitionNodes();
    for (const def of defs) {
      if (tsMorph.Node.isVariableDeclaration(def)) {
        const initializer = def.getInitializer();
        if (initializer) {
          return inferPortableType(initializer, generatedFilePath, tsMorph, visited);
        }
      }

      const imported = typeRefFromImportDefinition(def, tsMorph);
      if (imported) {
        return { typeText: imported, confidence: "medium" };
      }

      const local = typeRefFromDeclaration(def, generatedFilePath, tsMorph);
      if (local) {
        return { typeText: local, confidence: "medium" };
      }
    }
  }

  if (tsMorph.Node.isNewExpression(expr)) {
    const callee = expr.getExpression();
    if (tsMorph.Node.isIdentifier(callee)) {
      const defs = callee.getDefinitionNodes();
      for (const def of defs) {
        const imported = typeRefFromImportDefinition(def, tsMorph);
        if (imported) {
          return { typeText: imported, confidence: "medium" };
        }

        const local = typeRefFromDeclaration(def, generatedFilePath, tsMorph);
        if (local) {
          return { typeText: local, confidence: "medium" };
        }
      }
    }
  }

  return { typeText: "unknown", confidence: "low" };
}

function isPortableTypeText(typeText: string): boolean {
  const text = typeText.trim();
  if (text.length === 0) return false;

  if (
    text.startsWith("{") ||
    text.startsWith("(") ||
    text.startsWith("[") ||
    text.startsWith("import(") ||
    text.includes("=>")
  ) {
    return true;
  }

  if (text.includes("|") || text.includes("&")) {
    return text
      .split(/[|&]/u)
      .map((part) => part.trim())
      .every((part) => isPortableTypeText(part));
  }

  const genericBase = text.split("<")[0]!.trim();
  if (PORTABLE_SINGLE_IDENTIFIERS.has(genericBase)) {
    return true;
  }

  return false;
}

function typeRefFromImportDefinition(
  node: import("ts-morph").Node,
  tsMorph: TsMorphModule,
): string | null {
  if (tsMorph.Node.isImportSpecifier(node)) {
    const importDecl = node.getImportDeclaration();
    const moduleSpecifier = importDecl.getModuleSpecifierValue();
    const exportedName = node.getNameNode().getText();
    return `import("${moduleSpecifier}").${exportedName}`;
  }

  if (tsMorph.Node.isImportClause(node)) {
    const importDecl = node.getParentIfKindOrThrow(
      tsMorph.SyntaxKind.ImportDeclaration,
    );
    const moduleSpecifier = importDecl.getModuleSpecifierValue();
    if (node.getDefaultImport()) {
      return `import("${moduleSpecifier}").default`;
    }
  }

  return null;
}

function typeRefFromDeclaration(
  node: import("ts-morph").Node,
  generatedFilePath: string,
  tsMorph: TsMorphModule,
): string | null {
  if (
    !tsMorph.Node.isClassDeclaration(node) &&
    !tsMorph.Node.isInterfaceDeclaration(node) &&
    !tsMorph.Node.isTypeAliasDeclaration(node)
  ) {
    return null;
  }

  const name = node.getName();
  if (!name) return null;

  const moduleSpecifier = toGeneratedImportPath(
    generatedFilePath,
    node.getSourceFile().getFilePath(),
  );
  return `import("${moduleSpecifier}").${name}`;
}

function toExtensionSourceKind(
  name: string | undefined,
): ExtensionSourceKind | null {
  if (name === "setup") return "setup";
  if (name === "onReady") return "onReady";
  if (name === "onClose") return "onClose";
  return null;
}

