import { existsSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import fg from "fast-glob";
import { loadTsMorph } from "../shared/lazy-ts-morph.js";

type TsMorphModule = typeof import("ts-morph");
type SourceFile = import("ts-morph").SourceFile;

const ROUTE_SOURCE_PATTERNS = ["**/*.{ts,js,mjs,cjs}"];
const ROUTE_IGNORE_PATTERNS = [
  "**/_*/**",
  "**/_*",
  "**/*.d.ts",
  "**/*.test.*",
  "**/*.spec.*",
  "**/*.__vext_compiled__*",
];
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

export interface RouteIndexEntry {
  filePath: string;
  fileRelativePath: string;
  prefix: string;
  method: string;
  path: string;
  docsSummary: string | null;
  hasDocsSummary: boolean;
  operationId: string | null;
  tags: string[];
  hidden: boolean;
}

export async function buildRouteIndex(rootDir: string): Promise<RouteIndexEntry[]> {
  const routesDir = join(rootDir, "src", "routes");
  if (!existsSync(routesDir)) {
    return [];
  }

  const routeFiles = await fg(ROUTE_SOURCE_PATTERNS, {
    cwd: routesDir,
    absolute: true,
    onlyFiles: true,
    ignore: ROUTE_IGNORE_PATTERNS,
  });

  if (routeFiles.length === 0) {
    return [];
  }

  const tsMorph = await loadTsMorph();
  const project = createRouteProject(rootDir, routeFiles, tsMorph);

  return routeFiles
    .flatMap((filePath) => {
      const sourceFile = project.getSourceFile(filePath);
      if (!sourceFile) {
        return [];
      }
      return scanRouteEntries(sourceFile, filePath, rootDir, routesDir, tsMorph);
    })
    .sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
}

function createRouteProject(
  rootDir: string,
  routeFiles: string[],
  tsMorph: TsMorphModule,
): import("ts-morph").Project {
  const tsconfigPath = join(rootDir, "tsconfig.json");

  if (existsSync(tsconfigPath)) {
    const project = new tsMorph.Project({
      tsConfigFilePath: tsconfigPath,
      skipAddingFilesFromTsConfig: false,
    });

    for (const filePath of routeFiles) {
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

  for (const filePath of routeFiles) {
    project.addSourceFileAtPath(filePath);
  }

  return project;
}

function scanRouteEntries(
  sourceFile: SourceFile,
  filePath: string,
  rootDir: string,
  routesDir: string,
  tsMorph: TsMorphModule,
): RouteIndexEntry[] {
  const prefix = filePathToRoutePrefix(filePath, routesDir);
  const fileRelativePath = relative(rootDir, filePath).split(sep).join("/");
  const definitions = sourceFile
    .getDescendantsOfKind(tsMorph.SyntaxKind.CallExpression)
    .filter((call) => isDefineRoutesCall(call, tsMorph));
  const entries: RouteIndexEntry[] = [];

  for (const definition of definitions) {
    const factory = definition.getArguments()[0];
    if (!factory || (!tsMorph.Node.isArrowFunction(factory) && !tsMorph.Node.isFunctionExpression(factory))) {
      continue;
    }

    const appParamName = factory.getParameters()[0]?.getName();
    const body = factory.getBody();
    if (!appParamName) continue;

    for (const call of body.getDescendantsOfKind(tsMorph.SyntaxKind.CallExpression)) {
      const expression = call.getExpression();
      if (!tsMorph.Node.isPropertyAccessExpression(expression)) continue;
      if (expression.getExpression().getText() !== appParamName) continue;

      const method = expression.getName();
      if (!HTTP_METHODS.has(method)) continue;

      const [pathArg, optionsArg] = call.getArguments();
      if (
        !pathArg ||
        (!tsMorph.Node.isStringLiteral(pathArg) &&
          !tsMorph.Node.isNoSubstitutionTemplateLiteral(pathArg))
      ) {
        continue;
      }

      const docs = readRouteDocs(optionsArg, tsMorph);
      entries.push({
        filePath,
        fileRelativePath,
        prefix,
        method: method.toUpperCase(),
        path: normalizeRoutePath(prefix, pathArg.getLiteralText()),
        docsSummary: docs.docsSummary,
        hasDocsSummary: docs.hasDocsSummary,
        operationId: docs.operationId,
        tags: docs.tags,
        hidden: docs.hidden,
      });
    }
  }

  return entries;
}

function isDefineRoutesCall(
  call: import("ts-morph").CallExpression,
  tsMorph: TsMorphModule,
): boolean {
  const expression = call.getExpression();
  return tsMorph.Node.isIdentifier(expression) && expression.getText() === "defineRoutes";
}

function readRouteDocs(
  optionsArg: import("ts-morph").Node | undefined,
  tsMorph: TsMorphModule,
): {
  docsSummary: string | null;
  hasDocsSummary: boolean;
  operationId: string | null;
  tags: string[];
  hidden: boolean;
} {
  const empty = {
    docsSummary: null,
    hasDocsSummary: false,
    operationId: null,
    tags: [],
    hidden: false,
  };

  if (!optionsArg || !tsMorph.Node.isObjectLiteralExpression(optionsArg)) {
    return empty;
  }

  const docsProp = optionsArg.getProperty("docs");
  if (!docsProp || !tsMorph.Node.isPropertyAssignment(docsProp)) {
    return empty;
  }

  const docsObject = docsProp.getInitializer();
  if (!docsObject || !tsMorph.Node.isObjectLiteralExpression(docsObject)) {
    return empty;
  }

  const summary = readStringProperty(docsObject, "summary", tsMorph);
  const operationId = readStringProperty(docsObject, "operationId", tsMorph);
  const tags = readStringArrayProperty(docsObject, "tags", tsMorph);
  const hidden = readBooleanProperty(docsObject, "hidden", tsMorph);

  return {
    docsSummary: summary,
    hasDocsSummary: Boolean(summary?.trim()),
    operationId,
    tags,
    hidden,
  };
}

function readStringProperty(
  objectLiteral: import("ts-morph").ObjectLiteralExpression,
  key: string,
  tsMorph: TsMorphModule,
): string | null {
  const prop = objectLiteral.getProperty(key);
  if (!prop || !tsMorph.Node.isPropertyAssignment(prop)) {
    return null;
  }

  const initializer = prop.getInitializer();
  if (!initializer) return null;

  if (
    tsMorph.Node.isStringLiteral(initializer) ||
    tsMorph.Node.isNoSubstitutionTemplateLiteral(initializer)
  ) {
    return initializer.getLiteralText();
  }

  return null;
}

function readStringArrayProperty(
  objectLiteral: import("ts-morph").ObjectLiteralExpression,
  key: string,
  tsMorph: TsMorphModule,
): string[] {
  const prop = objectLiteral.getProperty(key);
  if (!prop || !tsMorph.Node.isPropertyAssignment(prop)) {
    return [];
  }

  const initializer = prop.getInitializer();
  if (!initializer || !tsMorph.Node.isArrayLiteralExpression(initializer)) {
    return [];
  }

  return initializer
    .getElements()
    .filter(
      (item): item is import("ts-morph").StringLiteral | import("ts-morph").NoSubstitutionTemplateLiteral =>
        tsMorph.Node.isStringLiteral(item) || tsMorph.Node.isNoSubstitutionTemplateLiteral(item),
    )
    .map((item) => item.getLiteralText())
    .filter((item) => item.length > 0);
}

function readBooleanProperty(
  objectLiteral: import("ts-morph").ObjectLiteralExpression,
  key: string,
  tsMorph: TsMorphModule,
): boolean {
  const prop = objectLiteral.getProperty(key);
  if (!prop || !tsMorph.Node.isPropertyAssignment(prop)) {
    return false;
  }

  const initializer = prop.getInitializer();
  if (!initializer) return false;
  if (initializer.getKind() === tsMorph.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (initializer.getKind() === tsMorph.SyntaxKind.FalseKeyword) {
    return false;
  }
  return false;
}

function filePathToRoutePrefix(filePath: string, routesDir: string): string {
  let rel = relative(routesDir, filePath);
  rel = rel.split(sep).join("/");

  const ext = extname(rel);
  rel = rel.slice(0, -ext.length);

  if (rel === "index") {
    rel = "";
  } else if (rel.endsWith("/index")) {
    rel = rel.slice(0, -"/index".length);
  }

  rel = rel.replace(/\[([^]]+)]/g, ":$1");

  if (!rel.startsWith("/")) {
    rel = `/${rel}`;
  }

  if (rel.length > 1 && rel.endsWith("/")) {
    rel = rel.slice(0, -1);
  }

  return rel;
}

function normalizeRoutePath(prefix: string, subPath: string): string {
  const cleanPrefix = prefix.endsWith("/") && prefix.length > 1 ? prefix.slice(0, -1) : prefix;
  const cleanSubPath = subPath.startsWith("/") ? subPath.slice(1) : subPath;

  if (!cleanSubPath) {
    return cleanPrefix || "/";
  }

  if (cleanPrefix === "/") {
    return `/${cleanSubPath}`;
  }

  const fullPath = `${cleanPrefix}/${cleanSubPath}`;
  if (fullPath.length > 1 && fullPath.endsWith("/")) {
    return fullPath.slice(0, -1);
  }

  return fullPath;
}


