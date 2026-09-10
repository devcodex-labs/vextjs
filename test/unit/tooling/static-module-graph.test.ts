import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSourceView,
  overlaySourceView,
} from "../../../src/tooling/source-view/view.js";
import { collectProjectSources } from "../../../src/tooling/project-index/source-input.js";
import { StaticModuleGraph } from "../../../src/tooling/project-index/static-module-graph.js";
import { projectSchemaFields } from "../../../src/tooling/project-index/schema-field-projection.js";
import {
  buildRouteIndexFromSourceView,
  projectRouteSourceSnapshot,
} from "../../../src/tooling/project-index/scan-routes.js";

const created: string[] = [];
function root() {
  const value = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "vext-static-graph-")),
  );
  created.push(value);
  return value;
}
function write(directory: string, file: string, source: string) {
  const target = path.join(directory, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, source);
}
afterEach(() => {
  for (const directory of created.splice(0)) {
    expect(path.dirname(directory)).toBe(fs.realpathSync.native(os.tmpdir()));
    expect(path.basename(directory)).toMatch(/^vext-static-graph-/u);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function view(files: Record<string, string>) {
  return createSourceView({
    roots: [{ id: "service", realPath: root(), kind: "service" }],
    rolePolicyVersion: "static-graph-test",
    files: Object.entries(files).map(([file, source]) => ({
      rootId: "service",
      path: file,
      role: "module",
      bytes: Buffer.from(source),
    })),
  });
}

describe("sealed static module graph", () => {
  it("tracks named imports, explicit re-exports and data spreads without evaluating modules", () => {
    const source = view({
      "schema.ts":
        'throw new Error("MUST NOT RUN"); export const name = "string!"; export const base = { name };',
      "barrel.ts": 'export { base as fields } from "./schema.js";',
      "route.ts":
        'import { fields } from "./barrel.js"; export const schema = { ...fields, age: "integer?" };',
    });
    const graph = new StaticModuleGraph(source);
    const module = graph.module("service", "route.ts");
    const result = graph.project(
      graph.expression(module, module.bindings.get("schema")!),
      "body",
    );
    expect(result.completeness).toBe("complete");
    if (result.completeness !== "complete") throw new Error(result.reason);
    expect(result.value).toEqual({ name: "string!", age: "integer?" });
    const origin = result.sources.get("body.name")!;
    expect(origin.file).toBe("schema.ts");
    expect(
      source.read("service", origin.file)!.slice(origin.start, origin.end),
    ).toBe('"string!"');
    expect(origin.symbols).toContain("service:barrel.ts::export(fields)");
    expect(origin.symbols).toContain("service:schema.ts#name");
  });

  it.each([
    [
      "let binding",
      'let schema = { name: "string" }; export const result = schema;',
    ],
    [
      "property reassignment",
      'const schema = { name: "string" }; schema.name = "number"; export const result = schema;',
    ],
    [
      "aliased mutation",
      'const schema = { name: "string" }; const alias = schema; alias.name = "number"; export const result = schema;',
    ],
    [
      "getter",
      'export const result = { get name() { throw new Error("MUST NOT RUN"); } };',
    ],
    ["unknown call", "export const result = dangerousCall();"],
    [
      "escaped mutable value",
      'const schema = { name: "string" }; mutate(schema); export const result = schema;',
    ],
    [
      "escaped inline wrapper",
      'const schema = { name: "string" }; mutate({ wrapper: [schema] }); export const result = schema;',
    ],
    [
      "escaped named wrapper",
      'const schema = { name: "string" }; const wrapper = { schema }; mutate(wrapper); export const result = schema;',
    ],
    [
      "unknown framework method",
      'import { schemaAdapter } from "vextjs"; const schema = { name: "string" }; schemaAdapter.unknown(schema); export const result = schema;',
    ],
    [
      "dynamic property",
      'const fields = { name: "string" }; export const result = fields[process.env.FIELD];',
    ],
    ["circular binding", "const a = b; const b = a; export const result = a;"],
    ["dynamic import", 'export const result = import("./other.js");'],
  ])(
    "retains an unknown result and its exact source for %s",
    (_name, source) => {
      const graph = new StaticModuleGraph(view({ "input.ts": source }));
      const module = graph.module("service", "input.ts");
      const result = graph.project(
        graph.expression(module, module.bindings.get("result")!),
        "body",
      );
      expect(result).toMatchObject({
        completeness: "unknown",
        origin: { file: "input.ts" },
        reason: expect.any(String),
      });
      expect(result).not.toHaveProperty("value");
    },
  );

  it.each(['schema.name = "integer";', "mutate(schema);"])(
    "invalidates shared aliases changed by another module: %s",
    (mutation) => {
      const source = view({
        "schema.ts": 'export const schema = { name: "string!" };',
        "barrel.ts": 'export { schema as fields } from "./schema.js";',
        "mutator.ts": `import { schema } from "./schema.js"; ${mutation}`,
        "route.ts":
          'import { fields } from "./barrel.js"; export const result = fields;',
      });
      const graph = new StaticModuleGraph(source);
      const module = graph.module("service", "route.ts");
      expect(
        graph.project(
          graph.expression(module, module.bindings.get("result")!),
          "body",
        ),
      ).toMatchObject({
        completeness: "unknown",
        reason: expect.stringContaining("mutable"),
      });
    },
  );

  it("resolves immutable object members and preserves uncertain nullability", () => {
    const graph = new StaticModuleGraph(
      view({
        "schema.ts":
          'const shared = { user: { name: "string!" } }; export const result = shared.user;',
      }),
    );
    const module = graph.module("service", "schema.ts");
    expect([
      ...graph
        .object(
          graph.expression(module, module.bindings.get("result")!),
          "body",
        )
        .keys(),
    ]).toEqual(["name"]);
    expect(
      projectSchemaFields(
        {
          type: "object",
          properties: {
            untyped: {},
            ref: { $ref: "#/User" },
            union: { anyOf: [{ type: "null" }, { type: "string" }] },
            text: { type: "string" },
            nullable: { type: ["string", "null"] },
          },
        },
        false,
      ).map((field) => [field.path, field.nullable]),
    ).toEqual([
      ["", false],
      ["/untyped", "unknown"],
      ["/ref", "unknown"],
      ["/union", "unknown"],
      ["/text", false],
      ["/nullable", true],
    ]);
  });

  it("does not follow export stars or read a missing overlay import from disk", async () => {
    const directory = root();
    write(
      directory,
      "src/routes/index.ts",
      'import { defineRoutes } from "vextjs"; import { fields } from "../schemas/index.js"; export default defineRoutes(app => { app.post("/", { validate: { body: fields } }, handler); });',
    );
    write(directory, "src/schemas/index.ts", 'export * from "./fields.js";');
    write(
      directory,
      "src/schemas/fields.ts",
      'export const fields = { name: "string!" };',
    );
    let source = await collectProjectSources(directory, ["route"]);
    expect(() => buildRouteIndexFromSourceView(directory, source)).toThrow(
      /export \*/u,
    );
    write(
      directory,
      "src/schemas/index.ts",
      'export { fields } from "./fields.js";',
    );
    source = await collectProjectSources(directory, ["route"]);
    expect(
      buildRouteIndexFromSourceView(directory, source)[0]!.schema.request.body
        ?.schema,
    ).toMatchObject({ required: ["name"] });
    const file = source.record("project", "src/schemas/fields.ts")!;
    const removed = overlaySourceView(source, [
      {
        kind: "delete",
        rootId: file.rootId,
        path: file.path,
        expectedSha256: file.sha256,
      },
    ]);
    expect(fs.existsSync(path.join(directory, file.path))).toBe(true);
    expect(() => buildRouteIndexFromSourceView(directory, removed)).toThrow(
      /missing|sealed/u,
    );
  });

  it("includes imported private helper bytes in freshness and shares schema builder provenance", async () => {
    const directory = root();
    write(
      directory,
      "src/routes/index.ts",
      'import { defineRoutes } from "vextjs"; import { fields } from "../schemas/_common.js"; export default defineRoutes(app => { app.post("/caf\\u00e9", { validate: { body: { ...fields } } }, handler); });',
    );
    write(
      directory,
      "src/schemas/_common.ts",
      'import { schemaAdapter as s } from "vextjs"; export const fields = { name: s.compileField("string:1-20!").description("Name") };',
    );
    const first = await collectProjectSources(directory, ["route"]);
    const route = buildRouteIndexFromSourceView(directory, first)[0]!;
    expect(route.path).toBe("/café");
    expect(route.schema.request.body?.schema).toMatchObject({
      required: ["name"],
      properties: { name: { maxLength: 20, description: "Name" } },
    });
    expect(route.schema.request.body?.projection).toMatchObject({
      completeness: "complete",
      sources: { ".name": { file: "src/schemas/_common.ts" } },
      fields: expect.arrayContaining([
        {
          path: "/name",
          required: true,
          nullable: false,
          coercion: "none",
          input: {
            completeness: "complete",
            schema: expect.objectContaining({ type: "string" }),
          },
          output: {
            completeness: "complete",
            schema: expect.objectContaining({ maxLength: 20 }),
          },
        },
      ]),
    });
    expect(projectRouteSourceSnapshot(first).files).toContain(
      "src/schemas/_common.ts",
    );
    write(
      directory,
      "src/schemas/_common.ts",
      'export const fields = { name: "string:1-50!" };',
    );
    const second = await collectProjectSources(directory, ["route"]);
    expect(projectRouteSourceSnapshot(first).fingerprint).not.toBe(
      projectRouteSourceSnapshot(second).fingerprint,
    );
    expect(
      buildRouteIndexFromSourceView(directory, first)[0]!.schema.request.body
        ?.schema,
    ).toEqual(route.schema.request.body?.schema);
  });

  it("rejects imported source that escapes the service root before reading it", async () => {
    const directory = root();
    write(
      directory,
      "src/routes/index.ts",
      'import { defineRoutes } from "vextjs"; import { fields } from "../../../outside.js"; export default defineRoutes(app => { app.post("/", { validate: { body: fields } }, handler); });',
    );
    const source = await collectProjectSources(directory, ["route"]);
    expect(() => buildRouteIndexFromSourceView(directory, source)).toThrow(
      /outside the declared source roots/u,
    );
  });

  it("seals explicitly registered shared package schemas, dependency metadata and overlay deletions", async () => {
    const service = root();
    const shared = root();
    write(
      service,
      "package.json",
      '{"dependencies":{"@example/contracts":"workspace:*"}}',
    );
    write(
      shared,
      "package.json",
      '{"name":"@example/contracts","exports":{"./user":{"import":"./dist/user.js","types":"./dist/user.d.ts"}}}',
    );
    write(shared, "src/user.ts", 'export const fields = { name: "string!" };');
    write(
      service,
      "src/routes/index.ts",
      'import { defineRoutes } from "vextjs"; import { fields } from "@example/contracts/user"; export default defineRoutes(app => { app.post("/", { validate: { body: fields } }, handler); });',
    );
    const options = {
      sharedRoots: [
        {
          id: "contracts",
          kind: "shared" as const,
          realPath: shared,
          packageName: "@example/contracts",
          sourceExports: { "./user": "src/user.ts" },
        },
      ],
    };
    const source = await collectProjectSources(service, ["route"], options);
    expect(
      buildRouteIndexFromSourceView(service, source)[0]?.schema.request.body
        ?.schema,
    ).toMatchObject({ required: ["name"] });
    expect(projectRouteSourceSnapshot(source).files).toContain(
      "@shared/contracts/src/user.ts",
    );
    const field = source.record("contracts", "src/user.ts")!;
    const removed = overlaySourceView(source, [
      {
        kind: "delete",
        rootId: "contracts",
        path: field.path,
        expectedSha256: field.sha256,
      },
    ]);
    expect(() => buildRouteIndexFromSourceView(service, removed)).toThrow(
      /missing|sealed/,
    );
    expect(fs.existsSync(path.join(shared, field.path))).toBe(true);
    write(shared, "src/user.ts", 'export const fields = { age: "integer!" };');
    expect(
      projectRouteSourceSnapshot(
        await collectProjectSources(service, ["route"], options),
      ).fingerprint,
    ).not.toBe(projectRouteSourceSnapshot(source).fingerprint);
    write(service, "package.json", "{}");
    await expect(
      collectProjectSources(service, ["route"], options),
    ).rejects.toThrow(/not a declared dependency/);
    write(
      shared,
      "package.json",
      '{"name":"@example/contracts","exports":{"./user":null}}',
    );
    await expect(
      collectProjectSources(service, ["route"], options),
    ).rejects.toThrow(/not a declared package export/);
  });

  it("does not substitute a top-level schema for a locally shadowed binding", async () => {
    const directory = root();
    write(
      directory,
      "src/routes/index.ts",
      'import { defineRoutes } from "vextjs"; const fields = { name: "string!" }; export default defineRoutes(app => { const fields = unknownFactory(); app.post("/", { validate: { body: fields } }, handler); });',
    );
    const source = await collectProjectSources(directory, ["route"]);
    expect(() => buildRouteIndexFromSourceView(directory, source)).toThrow(
      /shadowed/u,
    );
  });
});
