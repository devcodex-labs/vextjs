import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { bootstrap, type BootstrapResult } from "../../src/lib/bootstrap.js";
import { buildRouteIndex } from "../../src/tooling/project-index/scan-routes.js";
import { runDoctor } from "../../src/tooling/doctor/index.js";
import { createClientContractArtifacts } from "../../src/frontend/tooling/client-contract-writer.js";
import { createVextApiClient } from "../../src/frontend/contract/api-client.js";
import { allocatePort } from "../e2e/helpers.js";

const framework = fileURLToPath(new URL("../../", import.meta.url));
async function write(root: string, name: string, source: string) {
  const file = path.join(root, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, source);
}
async function project(adapter: string, label: string) {
  const root = await mkdtemp(path.join(tmpdir(), "vext-schema-http-"));
  await write(
    root,
    "package.json",
    JSON.stringify({
      name: "shared-schema-http",
      type: "module",
      dependencies: { vextjs: "2.0.0" },
    }),
  );
  await mkdir(path.join(root, "node_modules"));
  await symlink(
    framework,
    path.join(root, "node_modules/vextjs"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await write(
    root,
    "src/config/default.js",
    `export default ${JSON.stringify({ adapter, port: allocatePort(), host: "127.0.0.1", logger: { level: "silent" }, rateLimit: { enabled: false }, requestContext: { enabled: true }, locale: { default: "en-US", supported: ["en-US", "zh-CN"] }, openapi: { enabled: true }, shutdown: { timeout: 2 } })};`,
  );
  await write(
    root,
    "src/schemas/user.js",
    'import { schemaAdapter } from "vextjs"; export const fields = { name: "string:1-40!", age: schemaAdapter.compileField("integer:1-9!").description("User age") }; export const output = { name: "string!", age: "integer!" };',
  );
  await write(
    root,
    "src/schemas/index.js",
    'export { fields as userFields, output } from "./user.js";',
  );
  await write(
    root,
    "src/routes/shared.js",
    `import { defineRoutes } from "vextjs";
import { userFields, output } from "../schemas/index.js";
export default defineRoutes(app => {
  app.post("/", { validate: { body: { ...userFields } }, responses: { 200: { schema: output } }, docs: { summary: "Shared schema", operationId: "createShared" } }, (req,res) => res.json({ ...req.valid("body"), privateField: "omit" }));
  app.get("/denied", { docs: { summary: "Localized error", operationId: "sharedDenied", hidden: true } }, req => req.app.throw("order.payment.denied"));
});`,
  );
  for (const [locale, message] of [
    ["en-US", `${label} denied`],
    ["zh-CN", `${label} 拒绝`],
  ]) {
    await write(
      root,
      `src/locales/order/payment/${locale}.json`,
      JSON.stringify({ denied: { code: 71001, message, statusCode: 409 } }),
    );
  }
  return root;
}
async function stop(runtime: BootstrapResult | undefined) {
  if (!runtime) return;
  try {
    await runtime.serverHandle.close();
  } finally {
    await runtime.internals.shutdown(undefined, { skipExit: true });
  }
}

describe("shared schema across real HTTP and static consumers", () => {
  it.each(["native", "hono", "fastify", "express", "koa"])(
    "keeps %s validation, serialization, IR, Doctor, Docs and typed API aligned",
    async (adapter) => {
      const root = await project(adapter, "A");
      let runtime: BootstrapResult | undefined;
      try {
        const routes = await buildRouteIndex(root);
        const route = routes.find(
          (item) => item.path === "/shared" && item.method === "POST",
        )!;
        expect(route.schema.request.body?.schema).toMatchObject({
          type: "object",
          required: ["name", "age"],
          properties: {
            age: {
              type: "integer",
              minimum: 1,
              maximum: 9,
              description: "User age",
            },
          },
        });
        expect(route.schema.request.body?.projection).toMatchObject({
          completeness: "complete",
        });
        const doctor = await runDoctor({
          rootDir: root,
          target: "routes",
          writeManifest: true,
        });
        expect(doctor.valid).toBe(true);
        expect(
          doctor.routes.find((item) => item.path === "/shared")?.schema,
        ).toEqual(route.schema);
        expect(doctor.sourceFiles).toContain("src/schemas/user.js");
        const draft = await createClientContractArtifacts({
          rootDir: root,
          outDir: path.join(root, ".vext/client"),
        });
        expect(existsSync(draft.result.modulePath)).toBe(false);
        const contractRoute = draft.contract.routes.find(
          (item) => item.path === "/shared",
        )!;
        expect(contractRoute.input?.body?.schema).toEqual(
          route.schema.request.body,
        );
        expect(draft.result.warnings).toEqual([]);
        runtime = await bootstrap(root);
        const base = `http://127.0.0.1:${runtime.serverHandle.port}`;
        const response = await fetch(base + "/shared", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Mina", age: "4" }),
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          code: 0,
          data: { name: "Mina", age: 4 },
        });
        const api = createVextApiClient(draft.contract, { baseUrl: base });
        expect(
          await api.POST("/shared", { body: { name: "Mina", age: 4 } }),
        ).toEqual({ name: "Mina", age: 4 });
        for (const body of ['{"age":4}', '{"name":"Mina","age":20}']) {
          expect(
            (
              await fetch(base + "/shared", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body,
              })
            ).status,
          ).toBe(422);
        }
        expect(
          (
            await fetch(base + "/shared", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{",
            })
          ).status,
        ).toBe(400);
        const openapi = await (await fetch(base + "/openapi.json")).json();
        const operation = openapi.paths["/shared"].post;
        expect(
          operation.requestBody.content["application/json"].schema,
        ).toEqual(route.schema.request.body?.schema);
        expect(
          operation.responses["200"].content["application/json"].schema
            .properties.data,
        ).toEqual(route.schema.responses[0]?.schema?.schema);
        const docs = await fetch(base + "/docs");
        expect(docs.status).toBe(200);
        expect(await docs.text()).toContain("openapi");
        // 同一生成模块由真正的TypeScript检查正确/错误调用，不能只检查字符串包含类型名。
        for (const file of draft.files)
          await write(
            root,
            path.relative(root, file.path),
            String(file.contents),
          );
        const probe = path.join(root, ".vext/client/probe.ts");
        await write(
          root,
          ".vext/client/probe.ts",
          'import { api } from "./api.generated.js";\napi.POST("/shared", { body: { name: "Mina", age: 4 } }).then(user => { const age: number = user.age; void age; });\n// @ts-expect-error wrong schema field type\napi.POST("/shared", { body: { name: "Mina", age: "bad" } });\n',
        );
        const program = ts.createProgram([probe], {
          module: ts.ModuleKind.NodeNext,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
          target: ts.ScriptTarget.ES2022,
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        });
        expect(
          ts
            .getPreEmitDiagnostics(program)
            .map((item) =>
              ts.flattenDiagnosticMessageText(item.messageText, "\n"),
            ),
        ).toEqual([]);
      } finally {
        await stop(runtime);
        expect(path.basename(root)).toMatch(/^vext-schema-http-/);
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("isolates nested backend dictionaries for two bootstrapped apps and independent shutdown", async () => {
    const roots = [await project("native", "A"), await project("native", "B")];
    const runtimes: BootstrapResult[] = [];
    try {
      for (const root of roots) runtimes.push(await bootstrap(root));
      const fetchError = async (index: number, locale: string) => {
        const response = await fetch(
          `http://127.0.0.1:${runtimes[index]!.serverHandle.port}/shared/denied`,
          { headers: { "accept-language": locale } },
        );
        expect(response.status).toBe(409);
        return response.json();
      };
      const errors = await Promise.all([
        fetchError(0, "zh-CN"),
        fetchError(1, "en-US"),
        fetchError(0, "en-US"),
        fetchError(1, "zh-CN"),
      ]);
      expect(errors, JSON.stringify(errors)).toMatchObject([
        { code: 71001, message: "A 拒绝" },
        { code: 71001, message: "B denied" },
        { code: 71001, message: "A denied" },
        { code: 71001, message: "B 拒绝" },
      ]);
      await stop(runtimes[0]);
      expect(await fetchError(1, "en-US")).toMatchObject({
        message: "B denied",
      });
      runtimes.shift();
    } finally {
      for (const runtime of runtimes) await stop(runtime);
      for (const root of roots) {
        expect(path.basename(root)).toMatch(/^vext-schema-http-/);
        await rm(root, { recursive: true, force: true });
      }
    }
  });
});
