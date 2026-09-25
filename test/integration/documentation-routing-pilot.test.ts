import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";
import ts from "typescript";
import { buildRouteIndex } from "../../src/tooling/project-index/scan-routes.js";
import {
  addRequestCloseHandler,
  bindWebRequestLifecycle,
} from "../../src/lib/request-close.js";
import {
  beginResponseSend,
  finishResponseSend,
} from "../../src/lib/response-hooks.js";
import { normalizeErrorForResponse } from "../../src/lib/error-response.js";
import type { VextResponse } from "../../src/types/response.js";
import { createTestApp } from "../../src/testing/index.js";

const root = process.cwd();

async function example(page: string, file: string): Promise<string> {
  const markdown = await readFile(
    path.join(root, "website/docs/zh", page),
    "utf8",
  );
  const blocks = [
    ...markdown.matchAll(/```(?:typescript|ts)\r?\n([\s\S]*?)```/g),
  ];
  const block = blocks.find((match) => match[1]?.startsWith(`// ${file}`));
  if (!block?.[1])
    throw new Error(`Missing documented example: ${page}: ${file}`);
  return block[1];
}

function checkTypeScript(sourceFile: string, label: string) {
  const config = ts.readConfigFile(
    path.join(root, "tsconfig.json"),
    ts.sys.readFile,
  );
  const compilerOptions = ts.convertCompilerOptionsFromJson(
    config.config.compilerOptions,
    root,
  );
  const program = ts.createProgram([sourceFile], {
    ...compilerOptions.options,
    rootDir: root,
    declaration: false,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    baseUrl: root,
    paths: { vextjs: ["src/index.ts"] },
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  expect(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (name) => name,
      getNewLine: () => "\n",
    }),
    `${label} must typecheck against current public types`,
  ).toBe("");
}

async function writeExample(project: string, page: string, file: string) {
  const source = await example(page, file);
  const sourceRoot = path.join(project, "source-contract");
  const sourceFile = path.join(sourceRoot, file);
  await mkdir(path.dirname(sourceFile), { recursive: true });
  await writeFile(sourceFile, source, "utf8");
  checkTypeScript(sourceFile, `${page}: ${file}`);
  if (file.startsWith("src/routes/")) {
    const routes = await buildRouteIndex(sourceRoot);
    expect(
      routes.some(
        (route) => route.fileRelativePath.replaceAll("\\", "/") === file,
      ),
      `${file} must be statically indexable`,
    ).toBe(true);
  }
  await build({
    stdin: {
      contents: source,
      loader: "ts",
      resolveDir: root,
    },
    outfile: path.join(project, file.replace(/\.ts$/, ".mjs")),
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    plugins: [
      {
        name: "current-framework-source",
        setup(builder) {
          builder.onResolve({ filter: /^vextjs$/ }, () => ({
            path: path.join(
              root,
              file.includes("/middlewares/")
                ? "src/lib/define-middleware.ts"
                : "src/lib/define-routes.ts",
            ),
          }));
        },
      },
    ],
  });
  // Runtime loading sees one compiled entry; the TS source already passed indexing.
  await rm(sourceFile);
}

describe("Chinese routing documentation executable examples", () => {
  it("checks the documented frontend options against the exact public type including readonly arrays", async () => {
    const cache = path.join(root, "node_modules/.cache");
    await mkdir(cache, { recursive: true });
    const project = await mkdtemp(path.join(cache, "docs-types-"));
    try {
      const markdown = await readFile(
        path.join(root, "website/docs/zh/api/route-definition.md"),
        "utf8",
      );
      const block = [
        ...markdown.matchAll(/```(?:typescript|ts)\r?\n([\s\S]*?)```/g),
      ].find((match) =>
        match[1]?.startsWith("interface VextRouteFrontendOptions"),
      )?.[1];
      expect(block).toBeDefined();
      const file = path.join(project, "frontend-options.ts");
      await writeFile(
        file,
        `import type { RouteOptions } from "vextjs";\n${block}\ndeclare let documented: VextRouteFrontendOptions;\ndeclare let actual: NonNullable<RouteOptions["frontend"]>;\ndocumented = actual;\nactual = documented;\nconst readonlyOptions = { tags: ["public"], staticParams: [{ id: 1 }] } as const;\nconst accepted: VextRouteFrontendOptions = readonlyOptions;\n`,
        "utf8",
      );
      checkTypeScript(file, "Reference frontend type");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
  it("keeps normal response completion distinct from cancellation and preserves ordinary Error statusCode", () => {
    const request = {};
    const incoming = new AbortController();
    const controller = new AbortController();
    bindWebRequestLifecycle(request, incoming.signal, controller);
    let closed = 0;
    addRequestCloseHandler(request, () => {
      closed += 1;
    });
    const response = { _closeToken: request } as unknown as VextResponse;
    const state = beginResponseSend(response, {
      kind: "json",
      data: {},
      status: 200,
      headers: {},
      requestId: "docs",
      wrapped: false,
    });
    finishResponseSend(response, state);
    finishResponseSend(response, state);
    expect(closed).toBe(1);
    expect(controller.signal.aborted).toBe(false);
    let late = 0;
    addRequestCloseHandler(request, () => {
      late += 1;
    });
    expect(late).toBe(1);
    expect(
      normalizeErrorForResponse(
        Object.assign(new Error("Conflict"), { statusCode: 409 }),
      ).status,
    ).toBe(409);
    expect(normalizeErrorForResponse(new Error("Unknown")).status).toBe(500);
  });
  it("reproduces the six troubleshooting responses from the documented source", async () => {
    const cache = path.join(root, "node_modules/.cache");
    await mkdir(cache, { recursive: true });
    const project = await mkdtemp(path.join(cache, "docs-errors-"));
    let app: Awaited<ReturnType<typeof createTestApp>> | undefined;
    try {
      await writeExample(
        project,
        "guide/error-handling.md",
        "src/routes/error-demo.ts",
      );
      app = await createTestApp({
        rootDir: project,
        services: false,
        middlewares: false,
        config: { response: { hideInternalErrors: true } },
      });
      const missing = await app.request
        .get("/error-demo/missing")
        .set("Accept", "application/json");
      expect(missing.status).toBe(404);
      expect(missing.body).toMatchObject({
        code: "ITEM_NOT_FOUND",
        details: { itemId: "example" },
      });
      const param = await app.request.get("/error-demo/item/abc");
      expect(param.status).toBe(400);
      expect(param.body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "id" })]),
      );
      const valid = await app.request.get("/error-demo/item/1");
      expect(valid.status).toBe(200);
      expect(valid.body.data.id).toBe(1);
      const body = await app.request.post("/error-demo").send({});
      expect(body.status).toBe(422);
      expect(body.body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "email" })]),
      );
      expect(
        (await app.request.post("/error-demo").send({ email: "a@example.com" }))
          .status,
      ).toBe(200);
      const unknown = await app.request.get("/error-demo/unknown");
      expect(unknown.status).toBe(500);
      expect(unknown.body.message).toBe("Internal Server Error");
      expect(unknown.body).not.toHaveProperty("stack");
    } finally {
      await app?.close();
      await rm(project, { recursive: true, force: true });
    }
  });

  it("runs the reference factory binding and cache examples", async () => {
    const cache = path.join(root, "node_modules/.cache");
    await mkdir(cache, { recursive: true });
    const project = await mkdtemp(path.join(cache, "docs-reference-"));
    let app: Awaited<ReturnType<typeof createTestApp>> | undefined;
    try {
      for (const file of [
        "src/routes/binding-demo.ts",
        "src/routes/cache-demo.ts",
      ]) {
        await writeExample(project, "api/route-definition.md", file);
      }
      app = await createTestApp({
        rootDir: project,
        services: false,
        middlewares: false,
      });
      const binding = await app.request.get("/binding-demo");
      expect(binding.status).toBe(200);
      expect(binding.body.data).toEqual({ ok: true });
      const first = await app.request.get("/cache-demo");
      await new Promise((resolve) => setTimeout(resolve, 20));
      const second = await app.request.get("/cache-demo");
      expect(first.status).toBe(200);
      expect(second.body.data).toEqual(first.body.data);
      expect(app.app.cache.stats().hits).toBeGreaterThan(0);
    } finally {
      await app?.close();
      await rm(project, { recursive: true, force: true });
    }
  });

  it("runs documented middleware defaults and route overrides", async () => {
    const cache = path.join(root, "node_modules/.cache");
    await mkdir(cache, { recursive: true });
    const project = await mkdtemp(path.join(cache, "docs-middleware-"));
    let app: Awaited<ReturnType<typeof createTestApp>> | undefined;
    try {
      for (const file of [
        "src/middlewares/audit-log.ts",
        "src/middlewares/response-label.ts",
        "src/config/default.ts",
        "src/routes/middleware-demo.ts",
      ]) {
        await writeExample(project, "guide/middleware.md", file);
      }
      const { default: config } = await import(
        pathToFileURL(path.join(project, "src/config/default.mjs")).href
      );
      app = await createTestApp({ rootDir: project, services: false, config });
      const standard = await app.request.get("/middleware-demo");
      expect(standard.status).toBe(200);
      expect(standard.body.data).toEqual({ ok: true });
      expect(standard.headers["x-audit"]).toBe("visited");
      expect(standard.headers["x-route-label"]).toBe("configured");
      const custom = await app.request.get("/middleware-demo/custom");
      expect(custom.status).toBe(200);
      expect(custom.headers["x-route-label"]).toBe("route");
    } finally {
      await app?.close();
      await rm(project, { recursive: true, force: true });
    }
  });

  it("runs the documented route-demo and its four expected HTTP results", async () => {
    const cache = path.join(root, "node_modules/.cache");
    await mkdir(cache, { recursive: true });
    const project = await mkdtemp(path.join(cache, "docs-routing-"));
    let app: Awaited<ReturnType<typeof createTestApp>> | undefined;
    try {
      await writeExample(
        project,
        "guide/routing.md",
        "src/routes/route-demo.ts",
      );
      app = await createTestApp({
        rootDir: project,
        services: false,
        middlewares: false,
      });
      const valid = await app.request.get("/route-demo/42");
      expect(valid.status).toBe(200);
      expect(valid.body.data).toEqual({ id: 42, valueType: "number" });
      expect((await app.request.get("/route-demo/not-a-number")).status).toBe(
        400,
      );
      const created = await app.request
        .post("/route-demo")
        .send({ name: "Alice" });
      expect(created.status).toBe(201);
      expect(created.body.data).toEqual({ name: "Alice" });
      expect((await app.request.post("/route-demo").send({})).status).toBe(422);
    } finally {
      await app?.close();
      await rm(project, { recursive: true, force: true });
    }
  });
});
