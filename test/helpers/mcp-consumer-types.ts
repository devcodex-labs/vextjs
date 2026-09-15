import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repository = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);
const normalize = (file: string) => path.resolve(file).replaceAll("\\", "/");

export function checkMcpConsumerTypes(
  files: Map<string, string>,
): ts.Diagnostic[] {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    allowJs: true,
    checkJs: true,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
    typeRoots: [path.join(repository, "node_modules/@types")],
    types: ["node", "react"],
  };
  const host = ts.createCompilerHost(options);
  const original = {
    readFile: host.readFile.bind(host),
    fileExists: host.fileExists.bind(host),
    directoryExists: host.directoryExists!.bind(host),
    getSourceFile: host.getSourceFile.bind(host),
  };
  const directories = new Set<string>();
  for (const file of files.keys()) {
    let dir = path.dirname(file);
    while (path.dirname(dir) !== dir) {
      directories.add(normalize(dir));
      dir = path.dirname(dir);
    }
  }
  host.fileExists = (file) =>
    files.has(normalize(file)) || original.fileExists(file);
  host.directoryExists = (dir) =>
    directories.has(normalize(dir)) || original.directoryExists(dir);
  host.readFile = (file) =>
    files.get(normalize(file)) ?? original.readFile(file);
  host.getSourceFile = (file, target, onError, fresh) =>
    files.has(normalize(file))
      ? ts.createSourceFile(file, files.get(normalize(file))!, target, true)
      : original.getSourceFile(file, target, onError, fresh);
  host.resolveModuleNames = (names, containingFile) =>
    names.map((name) => {
      if (name === "vextjs")
        return {
          resolvedFileName: path.join(repository, "src/index.ts"),
          extension: ts.Extension.Ts,
        };
      if (name === "vextjs/frontend")
        return {
          resolvedFileName: path.join(repository, "src/frontend/index.ts"),
          extension: ts.Extension.Ts,
        };
      const from =
        !name.startsWith(".") && files.has(normalize(containingFile))
          ? path.join(repository, "candidate.ts")
          : containingFile;
      return ts.resolveModuleName(name, from, options, host).resolvedModule;
    });
  const program = ts.createProgram(
    [...files.keys()].filter((file) => /\.[jt]sx?$/u.test(file)),
    options,
    host,
  );
  // 框架源码另有本仓库 tsc；这里检查真实框架/依赖类型下的全部候选，不伪造声明桩。
  return ts
    .getPreEmitDiagnostics(program)
    .filter(
      (diagnostic) =>
        !diagnostic.file || files.has(normalize(diagnostic.file.fileName)),
    );
}
