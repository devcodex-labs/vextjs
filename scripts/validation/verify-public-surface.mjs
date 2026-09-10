import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const portable = (file) => path.relative(root, file).replaceAll("\\", "/");

/** 从声明和命令分发表读取公开面，不加载应用、provider或插件。 */
export function collectPublicSurface() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const entries = Object.entries(manifest.exports).map(([subpath, target]) => [
    subpath === "." ? "vextjs" : "vextjs" + subpath.slice(1),
    path.resolve(
      root,
      target.types.replace(/^\.\/dist\//, "src/").replace(/\.d\.ts$/, ".ts"),
    ),
  ]);
  const configFile = ts.readConfigFile(
    path.join(root, "tsconfig.json"),
    ts.sys.readFile,
  );
  const options = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    root,
  ).options;
  const program = ts.createProgram(
    [
      ...entries.map(([, file]) => file),
      path.join(root, "src/lib/docs/types.ts"),
    ],
    options,
  );
  const checker = program.getTypeChecker();
  const result = new Map();
  function add(id, source) {
    result.set(id, { id, source: portable(source) });
  }
  for (const [entry, file] of entries) {
    const source = program.getSourceFile(file);
    if (!source?.symbol) throw new Error(`Missing public entry: ${file}`);
    for (const symbol of checker.getExportsOfModule(source.symbol)) {
      const target =
        symbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol;
      add(
        `symbol:${entry}#${symbol.name}`,
        target.declarations?.[0]?.getSourceFile().fileName ?? file,
      );
    }
  }
  const appTypes = program.getSourceFile(path.join(root, "src/types/app.ts"));
  const config = checker
    .getExportsOfModule(appTypes.symbol)
    .find((symbol) => symbol.name === "VextConfig");
  if (!config) throw new Error("Missing VextConfig");
  function properties(type, prefix, ancestors = new Set()) {
    if (ancestors.has(type)) return;
    const next = new Set(ancestors).add(type);
    if (type.isUnion()) {
      for (const member of type.types) properties(member, prefix, next);
      return;
    }
    if (
      !(type.flags & ts.TypeFlags.Object) ||
      checker.isArrayType(type) ||
      checker.isTupleType(type) ||
      type.getCallSignatures().length
    )
      return;
    for (const member of checker.getPropertiesOfType(type)) {
      const declaration = member.declarations?.find((node) =>
        portable(node.getSourceFile().fileName).startsWith("src/"),
      );
      if (!declaration) continue;
      const id = prefix ? `${prefix}.${member.name}` : member.name;
      add(`config:${id}`, declaration.getSourceFile().fileName);
      properties(
        checker.getTypeOfSymbolAtLocation(member, declaration),
        id,
        next,
      );
    }
  }
  properties(checker.getDeclaredTypeOfSymbol(config), "");
  const docsTypes = program.getSourceFile(
    path.join(root, "src/lib/docs/types.ts"),
  );
  const sourceKind = checker
    .getExportsOfModule(docsTypes.symbol)
    .find((symbol) => symbol.name === "VextDocsSourceKind");
  const kinds = checker.getDeclaredTypeOfSymbol(sourceKind);
  if (!kinds.isUnion() || kinds.types.some((type) => !type.isStringLiteral()))
    throw new Error("Docs source kinds must be a finite string union");
  for (const type of kinds.types)
    add(`docs-source:${type.value}`, docsTypes.fileName);
  const cli = ts.createSourceFile(
    "index.ts",
    fs.readFileSync(path.join(root, "src/cli/index.ts"), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const commands = [];
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(cli) === "COMMANDS" &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const member of node.initializer.properties)
        commands.push(member.name.getText(cli).replaceAll('"', ""));
    }
    ts.forEachChild(node, visit);
  }
  visit(cli);
  if (commands.length === 0)
    throw new Error("CLI command registry was not found");
  for (const command of commands) {
    const file = path.join(root, `src/cli/${command}.ts`);
    add(`cli:${command}`, file);
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function flags(node) {
      if (ts.isStringLiteral(node) && /^--?[\w-]+$/.test(node.text)) {
        const parent = node.parent;
        if (
          ts.isCaseClause(parent) ||
          (ts.isBinaryExpression(parent) &&
            [
              ts.SyntaxKind.EqualsEqualsEqualsToken,
              ts.SyntaxKind.ExclamationEqualsEqualsToken,
            ].includes(parent.operatorToken.kind)) ||
          (ts.isCallExpression(parent) &&
            ts.isPropertyAccessExpression(parent.expression) &&
            parent.expression.getText(source) === "args.includes")
        )
          add(`cli:${command}:${node.text}`, file);
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(source) === "parseArgs" &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        const options = node.arguments[0].properties.find(
          (member) => member.name?.getText(source) === "options",
        );
        if (options && ts.isObjectLiteralExpression(options.initializer))
          for (const member of options.initializer.properties) {
            add(
              `cli:${command}:--${member.name.getText(source).replaceAll('"', "").replaceAll("'", "")}`,
              file,
            );
            const short = member.initializer?.properties?.find(
              (item) => item.name?.getText(source) === "short",
            );
            if (short && ts.isStringLiteral(short.initializer))
              add(`cli:${command}:-${short.initializer.text}`, file);
          }
      }
      ts.forEachChild(node, flags);
    }
    flags(source);
  }
  for (const flag of ["--help", "-h", "--version", "-v"])
    add(`cli:global:${flag}`, path.join(root, "src/cli/index.ts"));
  return [...result.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function validatePublicSurface(surface, coverage) {
  const failures = [];
  const indexed = new Map(surface.map((item) => [item.id, item]));
  const mapped = new Set();
  for (const group of coverage.groups ?? []) {
    for (const locale of ["en", "zh"]) {
      const file = path.join(
        root,
        "website/docs",
        locale,
        group.document + ".md",
      );
      if (!fs.existsSync(file))
        failures.push(`Missing documentation: ${portable(file)}`);
    }
    if (!group.contract || !group.limits)
      failures.push(`Missing behavior/limitations: ${group.document}`);
    for (const id of group.items) {
      if (mapped.has(id)) failures.push(`Duplicate mapping: ${id}`);
      if (!indexed.has(id))
        failures.push(`Removed surface still mapped: ${id}`);
      mapped.add(id);
    }
  }
  for (const item of surface)
    if (!mapped.has(item.id))
      failures.push(`Unmapped public surface: ${item.id} (${item.source})`);
  return failures;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const surface = collectPublicSurface();
  if (process.argv.includes("--inventory"))
    console.log(JSON.stringify(surface, null, 2));
  else {
    const coverage = JSON.parse(
      fs.readFileSync(
        path.join(root, "test/fixtures/public-surface/coverage.json"),
        "utf8",
      ),
    );
    const failures = validatePublicSurface(surface, coverage);
    console.log(
      JSON.stringify(
        {
          status: failures.length ? "FAIL" : "PASS",
          count: surface.length,
          groups: coverage.groups.length,
          failures,
        },
        null,
        2,
      ),
    );
    process.exitCode = failures.length ? 1 : 0;
  }
}
