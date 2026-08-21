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
  const fileName = path.join(
    root,
    "test",
    "unit",
    "request-validation-type-probe.ts",
  );
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

describe("route validation public types", () => {
  it("infers req.valid() from the route schema and preserves explicit overrides", () => {
    const diagnostics = compileTypeProbe(`
import {
  defineRoutes,
  schemaAdapter,
  type InferVextSchema,
} from "../../src/index.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type _ArrayInference = Expect<Equal<InferVextSchema<readonly ["string"]>, string[]>>;
type _RawNullableInference = Expect<
  Equal<InferVextSchema<{ type: readonly ["string", "null"] }>, string | null>
>;

defineRoutes((app) => {
  app.post("/users/:id", {
    validate: {
      param: { id: "uuid!" },
      query: { page: "integer:1-!" },
      header: { properties: "boolean!" },
      body: {
        type: "string!",
        name: "string:1-50!",
        age: "number:0-!",
        "tags!": ["string"],
        profile: { active: "boolean!" },
      },
    },
  }, async (req, res) => {
    const id: string = req.valid("param").id;
    const page: number = req.valid("query").page;
    const body = req.valid("body");
    const resourceType: string = body.type;
    const hasProperties: boolean = req.valid("header").properties;
    const name: string = body.name;
    const age: number = body.age;
    const tags: string[] = body.tags;
    const active: boolean | undefined = body.profile?.active;
    const cookie: undefined = req.valid("cookie");
    const legacy = req.valid<{ legacy: boolean }>("body");
    const legacyFlag: boolean = legacy.legacy;

    // @ts-expect-error page is inferred as a number.
    const wrongPage: string = req.valid("query").page;
    // @ts-expect-error an unconfigured location is undefined.
    req.valid("cookie").session;

    void id;
    void page;
    void resourceType;
    void hasProperties;
    void name;
    void age;
    void tags;
    void active;
    void cookie;
    void legacyFlag;
    void wrongPage;
    res.json({ ok: true });
  });

  const dynamicBuilder = schemaAdapter.compileField("string!");
  app.post("/builder", {
    validate: { body: { "value!": dynamicBuilder } },
  }, (req, res) => {
    const value: unknown = req.valid("body").value;
    // @ts-expect-error a mutable builder is intentionally not inferred as string.
    const unsafe: string = req.valid("body").value;
    void value;
    void unsafe;
    res.json({ ok: true });
  });
});
`);

    expect(diagnostics.map(formatDiagnostic)).toEqual([]);
  });

  it("distinguishes required slug/id fields from optional fields", () => {
    const diagnostics = compileTypeProbe(`
import { defineRoutes } from "../../src/index.js";

defineRoutes((app) => {
  app.get("/posts/:slug", {
    validate: {
      param: { slug: "string:1-!" },
      query: { preview: "string:1-?" },
    },
  }, (req, res) => {
    const slug: string = req.valid("param").slug;
    const preview: string | undefined = req.valid("query").preview;
    // @ts-expect-error optional query data must not be widened to required.
    const requiredPreview: string = req.valid("query").preview;
    void slug;
    void preview;
    void requiredPreview;
    res.json({ ok: true });
  });
});
`);

    expect(diagnostics.map(formatDiagnostic)).toEqual([]);
  });
});
