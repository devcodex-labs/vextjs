import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: false,
  types: ["node"],
};

function compileTypeProbe(source: string): readonly ts.Diagnostic[] {
  const root = process.cwd();
  const fileName = path.join(root, "test", "unit", "adapter-type-probe.ts");
  const normalizedFileName = path.normalize(fileName);
  const host = ts.createCompilerHost(compilerOptions, true);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);

  host.fileExists = (file) =>
    path.normalize(file) === normalizedFileName || fileExists(file);
  host.readFile = (file) =>
    path.normalize(file) === normalizedFileName ? source : readFile(file);
  host.getSourceFile = (file, languageVersion) => {
    const text =
      path.normalize(file) === normalizedFileName ? source : readFile(file);
    return text === undefined
      ? undefined
      : ts.createSourceFile(file, text, languageVersion, true);
  };

  const program = ts.createProgram([fileName], compilerOptions, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter(
      (diagnostic) =>
        diagnostic.file &&
        path.normalize(diagnostic.file.fileName) === normalizedFileName,
    );
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (!diagnostic.file || diagnostic.start === undefined) {
    return message;
  }
  const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(
    diagnostic.start,
  );
  return `${diagnostic.file.fileName}:${line + 1}:${character + 1} ${message}`;
}

describe("VextAdapter public type", () => {
  it("accepts the documented custom adapter shape and rejects the stale shape", () => {
    const diagnostics = compileTypeProbe(`
import type { VextAdapter, VextApp } from "../../src/index.js";

function documentedCustomAdapter(): (app: VextApp) => VextAdapter {
  return (app) => ({
    name: "my-custom",
    registerMiddleware(middleware) {
      void app;
      void middleware;
    },
    registerRoute(method, path, chain, options) {
      void method;
      void path;
      void chain;
      void options;
    },
    registerErrorHandler(handler) {
      void handler;
    },
    registerNotFound(handler) {
      void handler;
    },
    async listen(port, host = "0.0.0.0", options) {
      void options;
      return {
        close: async () => undefined,
        port,
        host,
      };
    },
    buildHandler() {
      return (req, res) => {
        void req;
        res.statusCode = 501;
        res.end();
      };
    },
  });
}

const currentAdapter = documentedCustomAdapter()({} as VextApp);
const currentObjectAdapter: VextAdapter = currentAdapter;

const staleAdapter = {
  name: "stale-custom",
  // @ts-expect-error stale adapters use removed members.
  createServer() {},
  registerMiddleware() {},
  registerRoute() {},
  registerErrorHandler() {},
  registerNotFoundHandler() {},
  registerOpenAPIRoutes() {},
  async listen(port: number, host = "0.0.0.0") {
    return {
      close: async () => undefined,
      port,
      host,
    };
  },
} satisfies VextAdapter;

void currentObjectAdapter;
void staleAdapter;
`);

    expect(diagnostics.map(formatDiagnostic)).toEqual([]);
  });
});
