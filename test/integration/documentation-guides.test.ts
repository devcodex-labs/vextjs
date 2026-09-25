import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import ts from "typescript";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createTestApp } from "../../src/testing/index.js";
import { buildRouteIndex } from "../../src/tooling/project-index/scan-routes.js";
import { loadConfig } from "../../src/lib/config-loader.js";
import { resolvePreloads } from "../../src/cli/utils/preload.js";
import { OpenAPIGenerator } from "../../src/lib/openapi/generator.js";
import type { RouteDefinition } from "../../src/types/route.js";
import type { VextServerHandle } from "../../src/types/adapter.js";

const root = process.cwd();
const cache = path.join(root, "node_modules/.cache");

async function fixture(page: string, sourceFiles?: string[], section?: string) {
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(path.join(cache, "docs-guide-"));
  const sourceRoot = path.join(directory, "source");
  const runtimeRoot = path.join(directory, "runtime");
  const cleanup = async () => {
    const relative = path.relative(cache, directory);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Fixture cleanup escaped its cache root");
    await rm(directory, { recursive: true, force: true });
  };
  try {
    const markdown = await readFile(
      path.join(root, "website/docs/zh", page),
      "utf8",
    );
    const sectionOffset = section ? markdown.indexOf(section) : 0;
    if (sectionOffset < 0)
      throw new Error(`Missing documented section: ${section}`);
    const allBlocks = [
      ...markdown
        .slice(sectionOffset)
        .matchAll(
          /```typescript\r?\n(\/\/ (src\/[^\r\n]+\.ts)\r?\n[\s\S]*?)```/g,
        ),
    ];
    const blocks = sourceFiles
      ? sourceFiles.map((file) => {
          const block = allBlocks.find((match) => match[2] === file);
          if (!block) throw new Error(`Missing documented file: ${file}`);
          return block;
        })
      : allBlocks;
    expect(
      blocks.length,
      `${page} needs complete source examples`,
    ).toBeGreaterThan(1);
    const files: string[] = [];
    for (const match of blocks) {
      const file = path.join(sourceRoot, match[2]!);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, match[1]!, "utf8");
      files.push(file);
    }
    const config = ts.readConfigFile(
      path.join(root, "tsconfig.json"),
      ts.sys.readFile,
    );
    const converted = ts.convertCompilerOptionsFromJson(
      config.config.compilerOptions,
      root,
    );
    const program = ts.createProgram(files, {
      ...converted.options,
      rootDir: root,
      noEmit: true,
      declaration: false,
      skipLibCheck: true,
      baseUrl: root,
      paths: {
        vextjs: ["src/index.ts"],
        "vextjs/adapters/*": ["src/adapters/*/index.ts"],
      },
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    expect(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCurrentDirectory: () => root,
        getCanonicalFileName: (name) => name,
        getNewLine: () => "\n",
      }),
    ).toBe("");
    const indexed = await buildRouteIndex(sourceRoot);
    expect(indexed.length).toBeGreaterThan(0);
    for (const match of blocks) {
      await build({
        stdin: { contents: match[1]!, loader: "ts", resolveDir: root },
        outfile: path.join(runtimeRoot, match[2]!.replace(/\.ts$/, ".mjs")),
        bundle: true,
        platform: "node",
        format: "esm",
        packages: "external",
        plugins: [
          {
            name: "documented-current-source",
            setup(builder) {
              builder.onResolve(
                { filter: /^vextjs\/adapters\/native$/ },
                () => ({
                  path: path.join(root, "src/adapters/native/index.ts"),
                }),
              );
              builder.onResolve({ filter: /^vextjs$/ }, () => ({
                path: "framework",
                namespace: "docs",
              }));
              builder.onLoad({ filter: /.*/, namespace: "docs" }, () => ({
                contents: [
                  ["defineRoutes", "src/lib/define-routes.ts"],
                  ["defineMiddleware", "src/lib/define-middleware.ts"],
                  ["createAuthMiddleware", "src/lib/auth.ts"],
                  ["definePlugin", "src/types/plugin.ts"],
                  ["defineAppExtensions", "src/types/plugin.ts"],
                  ["schemaAdapter", "src/lib/schema-adapter.ts"],
                ]
                  .map(
                    ([name, file]) =>
                      `export { ${name} } from ${JSON.stringify(path.join(root, file!))};`,
                  )
                  .join("\n"),
                loader: "ts",
                resolveDir: root,
              }));
            },
          },
        ],
      });
    }
    const settings = await import(
      pathToFileURL(path.join(runtimeRoot, "src/config/default.mjs")).href
    );
    return { rootDir: runtimeRoot, config: settings.default, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

describe("Chinese guide examples from Markdown", () => {
  it("runs the adapters guide on all built-ins and its custom delegate over HTTP", async () => {
    const project = await fixture("guide/adapters.md", [
      "src/config/default.ts",
      "src/routes/adapter-demo.ts",
      "src/adapters/custom.ts",
    ]);
    try {
      const custom = await import(
        pathToFileURL(path.join(project.rootDir, "src/adapters/custom.mjs"))
          .href
      );
      const adapters = [
        "native",
        "hono",
        "fastify",
        "express",
        "koa",
        custom.myCustomAdapter(),
      ];
      for (const adapter of adapters) {
        let app: Awaited<ReturnType<typeof createTestApp>> | undefined;
        let server: VextServerHandle | undefined;
        try {
          app = await createTestApp({
            rootDir: project.rootDir,
            config: { ...project.config, adapter },
            services: false,
          });
          server = await app.app.adapter.listen(0, "127.0.0.1");
          const base = `http://127.0.0.1:${server.port}`;
          const name = typeof adapter === "string" ? adapter : "my-custom";
          const success = await fetch(`${base}/adapter-demo/u-1`);
          expect(success.status, name).toBe(200);
          expect((await success.json()).data).toEqual({
            id: "u-1",
            adapter: name,
          });
          const created = await fetch(`${base}/adapter-demo`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Alice" }),
          });
          expect(created.status, name).toBe(201);
          expect((await created.json()).data).toEqual({
            name: "Alice",
            adapter: name,
          });
          const invalid = await fetch(`${base}/adapter-demo`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          expect(invalid.status, name).toBe(422);
          await invalid.text();
          const missing = await fetch(`${base}/adapter-demo-missing`);
          expect(missing.status, name).toBe(404);
          await missing.text();
        } finally {
          await server?.close();
          await app?.close();
        }
      }
    } finally {
      await project.cleanup();
    }
  });
  it("runs the i18n guide language, fallback, interpolation and validation examples", async () => {
    const project = await fixture("guide/i18n.md", [
      "src/config/default.ts",
      "src/locales/zh-CN.ts",
      "src/locales/en-US.ts",
      "src/routes/i18n-demo.ts",
    ]);
    let app: Awaited<ReturnType<typeof createTestApp>> | undefined;
    try {
      app = await createTestApp({
        rootDir: project.rootDir,
        config: project.config,
        services: false,
      });
      const zh = await app.request
        .get("/i18n-demo/not-found")
        .set("Accept-Language", "zh-CN");
      expect(zh.status).toBe(404);
      expect(zh.body).toMatchObject({ code: 40001, message: "用户不存在" });
      const en = await app.request
        .get("/i18n-demo/not-found")
        .set("Accept-Language", "en-US");
      expect(en.status).toBe(404);
      expect(en.body).toMatchObject({ code: 40001, message: "User not found" });
      const exactFirst = await app.request
        .get("/i18n-demo/not-found")
        .set("Accept-Language", "zh;q=1,en-US;q=0.5");
      expect(exactFirst.body.message).toBe("User not found");
      const balance = await app.request
        .get("/i18n-demo/balance")
        .set("Accept-Language", "zh-CN");
      expect(balance.status).toBe(400);
      expect(balance.body).toMatchObject({
        code: 20001,
        message: "余额不足，当前余额 50",
      });
      const fallback = await app.request
        .get("/i18n-demo/fallback")
        .set("Accept-Language", "en-US");
      expect(fallback.status).toBe(400);
      expect(fallback.body.message).toBe("仅默认语言的消息");
      const missing = await app.request.get("/i18n-demo/missing-key");
      expect(missing.status).toBe(400);
      expect(missing.body.message).toBe("demo.missing");
      const invalid = await app.request
        .post("/i18n-demo/validated")
        .set("Accept-Language", "en-US")
        .send({});
      expect(invalid.status).toBe(422);
      expect(JSON.stringify(invalid.body)).toContain("is required");
      const valid = await app.request
        .post("/i18n-demo/validated")
        .send({ name: "Alice" });
      expect(valid.status).toBe(200);
      expect(valid.body.data).toEqual({ name: "Alice" });
    } finally {
      await app?.close();
      await project.cleanup();
    }
  });
  it("runs the Fetch guide against its documented upstream over real HTTP", async () => {
    const project = await fixture("guide/fetch.md", [
      "src/config/default.ts",
      "src/routes/fetch-demo.ts",
    ]);
    let upstream: Awaited<ReturnType<typeof createTestApp>> | undefined;
    let app: Awaited<ReturnType<typeof createTestApp>> | undefined;
    let upstreamServer: VextServerHandle | undefined;
    let server: VextServerHandle | undefined;
    try {
      upstream = await createTestApp({
        rootDir: project.rootDir,
        config: project.config,
      });
      upstreamServer = await upstream.app.adapter.listen(0, "127.0.0.1");
      const upstreamBase = `http://127.0.0.1:${upstreamServer.port}`;
      app = await createTestApp({
        rootDir: project.rootDir,
        config: { ...project.config, fetchDemoBaseURL: upstreamBase },
      });
      server = await app.app.adapter.listen(0, "127.0.0.1");
      const base = `http://127.0.0.1:${server.port}`;
      const response = await fetch(`${base}/fetch-demo/users/u-1`, {
        headers: {
          "x-request-id": "fetch-demo-1",
          "x-tenant-id": "tenant-a",
        },
      });
      expect(response.status).toBe(200);
      expect((await response.json()).data.user).toEqual({
        id: "u-1",
        requestId: "fetch-demo-1",
        tenant: "tenant-a",
      });
      const missing = await fetch(`${base}/fetch-demo/users/missing`);
      expect(missing.status).toBe(404);
      await missing.arrayBuffer();
      await server.close();
      server = undefined;
      await upstreamServer.close();
      upstreamServer = undefined;
      await expect(fetch(`${base}/fetch-demo/users/u-1`)).rejects.toThrow();
      await expect(
        fetch(`${upstreamBase}/fetch-demo/upstream/u-1`),
      ).rejects.toThrow();
    } finally {
      await server?.close();
      await upstreamServer?.close();
      await app?.close();
      await upstream?.close();
      await project.cleanup();
    }
  });
  it("runs the OpenAPI guide and projects its actual route contracts", async () => {
    const project = await fixture("guide/openapi.md", [
      "src/config/default.ts",
      "src/routes/users.ts",
    ]);
    let app: Awaited<ReturnType<typeof createTestApp>> | undefined;
    let server: VextServerHandle | undefined;
    try {
      app = await createTestApp({
        rootDir: project.rootDir,
        config: project.config,
        services: false,
      });
      const created = await app.request
        .post("/users")
        .send({ name: "Alice", email: "alice@example.com" });
      expect(created.status).toBe(201);
      expect(created.body.data.id).toEqual(expect.any(String));
      const list = await app.request.get("/users?page=1&limit=20");
      expect(list.status).toBe(200);
      expect(list.body.data).toEqual({ items: [created.body.data], total: 1 });
      expect(
        (
          await app.request
            .post("/users")
            .send({ name: "Alice", email: "invalid" })
        ).status,
      ).toBe(422);
      expect((await app.request.get("/users?page=1.5")).status).toBe(422);
      expect((await app.request.get("/users")).body.data.total).toBe(1);
      // The helper above uses in-memory requests. Exercise the same handler
      // through a real, test-owned TCP listener as separate evidence.
      server = await app.app.adapter.listen(0, "127.0.0.1");
      const baseUrl = `http://${server.host}:${server.port}`;
      const liveCreated = await fetch(`${baseUrl}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Bob", email: "bob@example.com" }),
      });
      expect(liveCreated.status).toBe(201);
      expect((await liveCreated.json()).data.name).toBe("Bob");
      const liveList = await fetch(`${baseUrl}/users?page=1&limit=20`);
      expect(liveList.status).toBe(200);
      expect((await liveList.json()).data.total).toBe(2);
      const invalidPage = await fetch(`${baseUrl}/users?page=1.5`);
      expect(invalidPage.status).toBe(422);
      await invalidPage.arrayBuffer();
      await server.close();
      server = undefined;
      await expect(fetch(`${baseUrl}/users`)).rejects.toThrow();
      const module = await import(
        pathToFileURL(path.join(project.rootDir, "src/routes/users.mjs")).href
      );
      const definition = module.default as RouteDefinition;
      const spec = new OpenAPIGenerator(project.config.openapi).generate(
        definition.routes.map((route) => ({
          method: route.method,
          path: "/users" + (route.path === "/" ? "" : route.path),
          options: route.options,
          sourceFile: "routes/users.ts",
        })),
      );
      expect(spec.paths["/users"]?.get?.summary).toBe("获取用户列表");
      expect(spec.paths["/users"]?.get?.tags).toEqual(["Users"]);
      expect(spec.paths["/users"]?.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "page",
            in: "query",
            schema: expect.objectContaining({
              type: "integer",
              minimum: 1,
              maximum: 1000,
            }),
          }),
        ]),
      );
      expect(
        spec.paths["/users"]?.post?.requestBody?.content["application/json"]
          ?.schema?.required,
      ).toEqual(["name", "email"]);
      expect(spec.paths["/users"]?.post?.responses["201"]?.description).toBe(
        "创建成功",
      );
    } finally {
      await server?.close();
      await app?.close();
      await project.cleanup();
    }
  });
  it("runs cache hits, bypasses, vary and tag invalidation from the guide", async () => {
    const project = await fixture(
      "guide/cache.md",
      ["src/config/default.ts", "src/routes/cache-demo.ts"],
      "## 两文件完整示例与验证",
    );
    let app: Awaited<ReturnType<typeof createTestApp>> | undefined;
    try {
      app = await createTestApp({
        rootDir: project.rootDir,
        config: project.config,
        services: false,
      });
      const first = await app.request.get("/cache-demo");
      expect(first.status).toBe(200);
      expect(first.body.data).toEqual({ executions: 1, language: "default" });
      expect(first.headers["x-cache"]).toBe("MISS");
      const hit = await app.request.get("/cache-demo");
      expect(hit.headers["x-cache"]).toBe("HIT");
      expect(hit.body.data).toEqual(first.body.data);
      const invalidated = await app.request.post("/cache-demo/invalidate");
      expect(invalidated.status).toBe(200);
      expect(invalidated.body.data.invalidated).toBe(true);
      const fresh = await app.request.get("/cache-demo");
      expect(fresh.headers["x-cache"]).toBe("MISS");
      expect(fresh.body.data.executions).toBe(2);
      const bypass = await app.request.get("/cache-demo?refresh=");
      expect(bypass.body.data.executions).toBe(3);
      expect((await app.request.get("/cache-demo")).body.data.executions).toBe(
        2,
      );
      const zh = await app.request
        .get("/cache-demo")
        .set("Accept-Language", "zh-CN");
      expect(zh.body.data.language).toBe("zh-CN");
      expect(zh.headers["x-cache"]).toBe("MISS");
      expect(
        (await app.request.get("/cache-demo").set("Accept-Language", "zh-CN"))
          .headers["x-cache"],
      ).toBe("HIT");
      const query = await app.request.get("/cache-demo?b=2&a=1");
      const reordered = await app.request.get("/cache-demo?a=1&b=2");
      expect(reordered.headers["x-cache"]).toBe("HIT");
      expect(reordered.body.data).toEqual(query.body.data);
      const cookie = await app.request
        .get("/cache-demo")
        .set("Cookie", "session=demo");
      expect(cookie.headers["x-cache"]).toBe("MISS");
      expect(cookie.body.data.executions).toBeGreaterThan(
        query.body.data.executions,
      );
      for (const [name, value] of [
        ["Authorization", "Bearer demo"],
        ["Cache-Control", "no-cache"],
      ]) {
        const request = await app.request.get("/cache-demo").set(name!, value!);
        expect(request.status).toBe(200);
        expect(request.headers["x-cache"], name).toBe("MISS");
        expect(request.headers["cache-control"]).toBe("no-store");
      }
      await app.app.cache.delete("GET:/cache-demo");
      expect((await app.request.get("/cache-demo")).headers["x-cache"]).toBe(
        "MISS",
      );
    } finally {
      await app?.close();
      await project.cleanup();
    }
  });
  it("runs hook observations and cleanup from the guide", async () => {
    const project = await fixture(
      "guide/hooks.md",
      [
        "src/config/default.ts",
        "src/plugins/hook-observer.ts",
        "src/routes/hooks.ts",
      ],
      "## 三文件完整示例",
    );
    let app: Awaited<ReturnType<typeof createTestApp>> | undefined;
    try {
      app = await createTestApp({
        rootDir: project.rootDir,
        config: project.config,
        plugins: true,
        services: false,
      });
      const hello = await app.request.get("/hooks/hello?name=Alice");
      expect(hello.status).toBe(200);
      expect(hello.body.data.message).toBe("Hello, Alice!");
      expect(hello.headers["x-hook-example"]).toBe("active");
      const invalid = await app.request.get("/hooks/hello");
      expect(invalid.status).toBe(422);
      expect(invalid.headers["x-hook-example"]).toBe("active");
      expect((await app.request.get("/hooks/plain")).status).toBe(200);
      const boom = await app.request.get("/hooks/boom");
      expect(boom.status).toBe(500);
      expect(JSON.stringify(boom.body)).not.toContain("demonstration failure");
      expect(app.app.hookStats).toEqual({
        validated: 1,
        rejected: 1,
        handled: 2,
        errors: 1,
      });
      await app.close();
      for (const event of [
        "validation:success",
        "validation:error",
        "handler:after",
        "handler:error",
        "response:before",
      ] as const) {
        expect(app.app.hooks.has(event)).toBe(false);
      }
    } finally {
      await app?.close();
      await project.cleanup();
    }
  });
  it("runs the preload guide before configuration in a fresh Node process", async () => {
    const project = await fixture(
      "guide/preload.md",
      [
        "src/preload/01-bootstrap-port.ts",
        "src/config/default.ts",
        "src/routes/preload-info.ts",
      ],
      "## 完整项目级示例与验证",
    );
    try {
      const preloads = await resolvePreloads(project.rootDir);
      expect(preloads).toHaveLength(1);
      const configUrl = pathToFileURL(
        path.join(project.rootDir, "src/config/default.mjs"),
      ).href;
      const probe = `const {default: config} = await import(${JSON.stringify(configUrl)}); console.log(JSON.stringify({port:config.port,preloadValue:process.env.APP_BOOTSTRAP_PORT}));`;
      for (const enabled of [false, true]) {
        const result = spawnSync(
          process.execPath,
          [
            ...(enabled ? preloads.flatMap((url) => ["--import", url]) : []),
            "--input-type=module",
            "-e",
            probe,
          ],
          {
            cwd: project.rootDir,
            env: { ...process.env, NODE_OPTIONS: "", APP_BOOTSTRAP_PORT: "" },
            encoding: "utf8",
            timeout: 10000,
          },
        );
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual(
          enabled
            ? { port: 3011, preloadValue: "3011" }
            : { port: 3000, preloadValue: "" },
        );
      }
    } finally {
      await project.cleanup();
    }
  });
  it("runs plugin dependencies, middleware, ready and LIFO close from the guide", async () => {
    const project = await fixture(
      "guide/plugins.md",
      [
        "src/config/default.ts",
        "src/plugins/store.ts",
        "src/plugins/consumer.ts",
        "src/routes/plugin-info.ts",
      ],
      "### 完整示例与验证",
    );
    let app: Awaited<ReturnType<typeof createTestApp>> | undefined;
    try {
      app = await createTestApp({
        rootDir: project.rootDir,
        config: project.config,
        plugins: true,
        services: false,
      });
      const state = app.app.demoState as { events: string[] };
      for (const requests of [1, 2]) {
        const response = await app.request.get("/plugin-info");
        expect(response.status).toBe(200);
        expect(response.headers["x-demo-plugin"]).toBe("active");
        expect(response.body.data).toEqual({ requests, ready: true });
      }
      await app.close();
      expect(state.events).toEqual(["consumer", "store"]);
      const consumerPath = path.join(
        project.rootDir,
        "src/plugins/consumer.mjs",
      );
      const consumer = await readFile(consumerPath, "utf8");
      // Different file URLs avoid ESM cache hiding negative fixture mutations.
      await writeFile(
        path.join(project.rootDir, "src/plugins/missing.mjs"),
        consumer
          .replace('name: "demo-consumer"', 'name: "missing-consumer"')
          .replace('["demo-store"]', '["absent-store"]'),
      );
      await expect(
        createTestApp({
          rootDir: project.rootDir,
          config: project.config,
          plugins: true,
          services: false,
        }),
      ).rejects.toThrow(/absent-store/);
      await writeFile(
        path.join(project.rootDir, "src/plugins/duplicate.mjs"),
        consumer,
      );
      await expect(
        createTestApp({
          rootDir: project.rootDir,
          config: project.config,
          plugins: true,
          services: false,
        }),
      ).rejects.toThrow(/already registered/);
    } finally {
      await app?.close();
      await project.cleanup();
    }
  });
  it("loads the configuration guide development, production and CLI layers", async () => {
    const project = await fixture(
      "guide/configuration.md",
      [
        "src/config/default.ts",
        "src/config/production.ts",
        "src/config/local.ts",
        "src/routes/config-info.ts",
      ],
      "## 完整示例",
    );
    try {
      for (const sample of [
        {
          mode: "development" as const,
          command: "dev" as const,
          env: {},
          expected: { port: 8080, logLevel: "info", docsEnabled: true },
        },
        {
          mode: "production" as const,
          command: "start" as const,
          env: {},
          expected: {
            port: project.config.port,
            logLevel: "warn",
            docsEnabled: false,
          },
        },
        {
          mode: "production" as const,
          command: "start" as const,
          env: { VEXT_PORT: "3100" },
          expected: { port: 3100, logLevel: "warn", docsEnabled: false },
        },
      ]) {
        const config = await loadConfig(
          path.join(project.rootDir, "src/config"),
          {
            rootDir: project.rootDir,
            mode: sample.mode,
            command: sample.command,
            configProfile: sample.mode,
            env: sample.env,
          },
        );
        expect(Object.isFrozen(config)).toBe(true);
        expect(Object.isFrozen(config.logger)).toBe(true);
        expect(config.redis.url).toBe(
          sample.mode === "development"
            ? "redis://localhost:6380"
            : project.config.redis.url,
        );
        const app = await createTestApp({
          rootDir: project.rootDir,
          config,
          services: false,
        });
        try {
          const response = await app.request.get("/config-info");
          expect(response.status).toBe(200);
          expect(response.body.data).toEqual(sample.expected);
        } finally {
          await app.close();
        }
      }
    } finally {
      await project.cleanup();
    }
  });
  it("runs the complete manual quick-start API example", async () => {
    const project = await fixture("guide/quick-start.md", [
      "src/config/default.ts",
      "src/routes/index.ts",
      "src/routes/greet.ts",
      "src/services/example.ts",
    ]);
    let app: Awaited<ReturnType<typeof createTestApp>> | undefined;
    try {
      app = await createTestApp({
        rootDir: project.rootDir,
        config: project.config,
      });
      const hello = await app.request.get("/api/hello");
      expect(hello.status).toBe(200);
      expect(hello.body.data.message).toBe("Hello VextJS!");
      const health = await app.request.get("/api/health");
      expect(health.status).toBe(200);
      expect(health.body.data.status).toBe("ok");
      const greet = await app.request.get("/greet/Alice");
      expect(greet.status).toBe(200);
      expect(greet.body.data.message).toBe("Hello, Alice!");
      expect((await app.request.get("/greet/greet/Alice")).status).toBe(404);
      expect((await app.request.get("/")).status).toBe(404);
    } finally {
      await app?.close();
      await project.cleanup();
    }
  });
  it("runs the introduction route and plugin lifecycle", async () => {
    const project = await fixture("guide/introduction.md", [
      "src/config/default.ts",
      "src/routes/index.ts",
      "src/plugins/user-cache.ts",
    ]);
    let app: Awaited<ReturnType<typeof createTestApp>> | undefined;
    try {
      app = await createTestApp({
        rootDir: project.rootDir,
        config: project.config,
        services: false,
        plugins: true,
      });
      const response = await app.request.get("/hello");
      expect(response.status).toBe(200);
      expect(response.body.data.message).toBe("Hello VextJS!");
      const cache = (
        app.app as unknown as {
          userCache: {
            set(key: string, value: unknown): void;
            get(key: string): unknown;
          };
        }
      ).userCache;
      cache.set("example", 42);
      expect(cache.get("example")).toBe(42);
      await app.close();
      expect(cache.get("example")).toBeUndefined();
    } finally {
      await app?.close();
      await project.cleanup();
    }
  });
  it("runs validation examples with conversion, failure ordering and a Zod adapter", async () => {
    const project = await fixture("guide/validation.md", [
      "src/config/default.ts",
      "src/routes/validation.ts",
      "src/routes/translate.ts",
      "src/plugins/zod-validator.ts",
    ]);
    let app: Awaited<ReturnType<typeof createTestApp>> | undefined;
    try {
      app = await createTestApp({
        rootDir: project.rootDir,
        config: project.config,
        services: false,
      });
      const valid = await app.request.post("/validation/users").send({
        name: "Bob",
        email: "bob@example.com",
        age: "42",
        role: "user",
      });
      expect(valid.status).toBe(201);
      expect(valid.body.data.age).toBe(42);
      expect(
        (
          await app.request
            .post("/validation/users")
            .send({ name: "Bob", email: "invalid" })
        ).status,
      ).toBe(422);
      const converted = await app.request
        .get("/validation/items/42")
        .query({ active: "true" });
      expect(converted.status).toBe(200);
      expect(converted.body.data).toEqual({ id: 42, active: true });
      expect(
        (await app.request.get("/validation/items/nope").query({ active: "1" }))
          .status,
      ).toBe(400);
      for (const active of ["1", "0"]) {
        expect(
          (await app.request.get("/validation/items/42").query({ active }))
            .status,
        ).toBe(422);
      }
      expect((await app.request.get("/validation/items/1.5")).status).toBe(400);
      expect(
        (
          await app.request
            .post("/translate")
            .send({ content: "hello", targetLanguages: [{ code: "zh-CN" }] })
        ).status,
      ).toBe(200);
      expect(
        (
          await app.request
            .post("/translate")
            .send({ content: "hello", targetLanguages: [{ code: "" }] })
        ).status,
      ).toBe(422);
      await app.close();
      app = await createTestApp({
        rootDir: project.rootDir,
        config: project.config,
        services: false,
        plugins: true,
      });
      const compiled = app.app
        .getValidator()
        .compile({ name: "string:1-50!", email: "email!" });
      expect(compiled({ name: "Bob", email: "bob@example.com" }).valid).toBe(
        true,
      );
      expect(compiled({ name: "Bob", email: "invalid" }).valid).toBe(false);
      expect(
        (
          await app.request
            .get("/validation/items/42")
            .query({ active: "false" })
        ).body.data,
      ).toEqual({ id: 42, active: false });
    } finally {
      await app?.close();
      await project.cleanup();
    }
  });
  it("runs the services guide and rejects invalid input before creation", async () => {
    const project = await fixture("guide/services.md", [
      "src/config/default.ts",
      "src/routes/users.ts",
      "src/services/user.ts",
    ]);
    let app: Awaited<ReturnType<typeof createTestApp>> | undefined;
    try {
      app = await createTestApp({
        rootDir: project.rootDir,
        config: project.config,
      });
      const list = await app.request.get("/users");
      expect(list.status).toBe(200);
      expect(list.body.data).toEqual({
        items: [],
        total: 0,
        page: 1,
        limit: 20,
      });
      const single = await app.request.get("/users/42");
      expect(single.status).toBe(200);
      expect(single.body.data.id).toBe("42");
      const created = await app.request
        .post("/users")
        .send({ name: "Bob", email: "bob@example.com" });
      expect(created.status).toBe(201);
      expect(created.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.body.data.email).toBe("bob@example.com");
      expect(
        (
          await app.request
            .post("/users")
            .send({ name: "Bob", email: "invalid" })
        ).status,
      ).toBe(422);
    } finally {
      await app?.close();
      await project.cleanup();
    }
  });
  it("runs the project-structure guide route and service mapping", async () => {
    const project = await fixture("guide/project-structure.md", [
      "src/config/default.ts",
      "src/routes/users.ts",
      "src/services/user.ts",
    ]);
    let app: Awaited<ReturnType<typeof createTestApp>> | undefined;
    try {
      app = await createTestApp({
        rootDir: project.rootDir,
        config: project.config,
      });
      const list = await app.request.get("/users/list");
      expect(list.status).toBe(200);
      expect(list.body.data).toEqual([]);
      const single = await app.request.get("/users/42");
      expect(single.status).toBe(200);
      expect(single.body.data).toEqual({ id: "42", name: "Alice" });
      const created = await app.request.post("/users").send({ name: "Bob" });
      expect(created.status).toBe(201);
      expect(created.body.data).toEqual({ id: "1", name: "Bob" });
    } finally {
      await app?.close();
      await project.cleanup();
    }
  });
  it("runs the uploads guide with required fields and independent limits", async () => {
    const project = await fixture("guide/uploads.md");
    let app: Awaited<ReturnType<typeof createTestApp>> | undefined;
    const boundary = "docs-upload-boundary";
    function multipart(
      parts: Array<{ field: string; mime?: string; content?: string }>,
    ) {
      return (
        parts
          .map(({ field, mime = "text/plain", content = "hello" }) =>
            [
              `--${boundary}`,
              `Content-Disposition: form-data; name="${field}"; filename="sample.txt"`,
              `Content-Type: ${mime}`,
              "",
              content,
              "",
            ].join("\r\n"),
          )
          .join("") + `--${boundary}--\r\n`
      );
    }
    try {
      app = await createTestApp({
        rootDir: project.rootDir,
        config: project.config,
        services: false,
      });
      const send = (parts: Parameters<typeof multipart>[0]) =>
        app!.request
          .post("/uploads")
          .type(`multipart/form-data; boundary=${boundary}`)
          .send(multipart(parts));
      const success = await send([{ field: "document" }]);
      expect(success.status).toBe(200);
      expect(success.body.data).toEqual({
        filename: "sample.txt",
        size: 5,
        mimetype: "text/plain",
      });
      const missing = await send([{ field: "other" }]);
      expect(missing.status).toBe(400);
      expect(missing.body.message).toContain(
        "Missing required multipart file field(s): document",
      );
      expect(missing.body.data).toBeUndefined();
      expect(
        (await send([{ field: "document", mime: "application/octet-stream" }]))
          .status,
      ).toBe(415);
      const oversized = await send([
        { field: "document", content: "a".repeat(1025) },
      ]);
      expect(oversized.status).toBe(413);
      expect(oversized.body.message).toContain("exceeds maxFileSize");
      const tooMany = await send([
        { field: "document" },
        { field: "document" },
      ]);
      expect(tooMany.status).toBe(413);
      expect(tooMany.body.message).toBe("Too many files");
      const bodyLimit = await send([
        { field: "document", content: "a".repeat(17000) },
      ]);
      expect(bodyLimit.status).toBe(413);
      expect(bodyLimit.body.message).toBe("Payload Too Large");
      expect((await app.request.post("/uploads").send({})).status).toBe(400);
    } finally {
      await app?.close();
      await project.cleanup();
    }
  });
  it("runs the rate-limit guide defaults, overrides and disabled-global boundary", async () => {
    const project = await fixture("guide/rate-limit.md");
    let app: Awaited<ReturnType<typeof createTestApp>> | undefined;
    try {
      app = await createTestApp({
        rootDir: project.rootDir,
        config: project.config,
        services: false,
      });
      expect((await app.request.get("/limits")).status).toBe(200);
      expect((await app.request.get("/limits")).status).toBe(200);
      const limited = await app.request.get("/limits");
      expect(limited.status).toBe(429);
      expect(limited.body.code).toBe(429);
      expect(limited.body.data).toBeUndefined();
      expect(limited.headers["ratelimit-limit"]).toBe("2");
      expect(Number(limited.headers["ratelimit-reset"])).toBeLessThanOrEqual(
        60,
      );
      expect(Number(limited.headers["retry-after"])).toBeGreaterThanOrEqual(1);
      expect((await app.request.get("/limits/once")).status).toBe(200);
      expect((await app.request.get("/limits/once")).status).toBe(429);
      for (let i = 0; i < 3; i++) {
        const free = await app.request.get("/limits/free");
        expect(free.status).toBe(200);
        expect(free.headers["ratelimit-limit"]).toBeUndefined();
      }
      await app.close();
      app = await createTestApp({
        rootDir: project.rootDir,
        services: false,
        config: {
          ...project.config,
          rateLimit: { ...project.config.rateLimit, enabled: false },
        },
      });
      for (let i = 0; i < 3; i++)
        expect((await app.request.get("/limits/once")).status).toBe(200);
    } finally {
      await app?.close();
      await project.cleanup();
    }
  });
  it("runs the security guide identity and guard flow", async () => {
    const project = await fixture("guide/security.md");
    let app: Awaited<ReturnType<typeof createTestApp>> | undefined;
    try {
      app = await createTestApp({
        rootDir: project.rootDir,
        config: project.config,
        services: false,
      });
      const anonymous = await app.request.get("/account");
      expect(anonymous.status).toBe(401);
      expect(anonymous.body.code).toBe("AUTH_REQUIRED");
      expect(anonymous.headers["x-content-type-options"]).toBe("nosniff");
      const invalid = await app.request
        .get("/account")
        .set("Authorization", "Bearer invalid");
      expect(invalid.status).toBe(401);
      expect(invalid.body.code).toBe("AUTH_INVALID");
      const member = await app.request
        .get("/account")
        .set("Authorization", "Bearer demo-member");
      expect(member.status).toBe(200);
      expect(member.body.data.subject).toBe("member-1");
      const denied = await app.request
        .get("/account/admin")
        .set("Authorization", "Bearer demo-member");
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe("AUTH_FORBIDDEN");
      const admin = await app.request
        .get("/account/admin")
        .set("Authorization", "Bearer demo-admin");
      expect(admin.status).toBe(200);
      expect(admin.body.data.area).toBe("admin");
      expect(admin.headers["x-content-type-options"]).toBe("nosniff");
      const publicResponse = await app.request.get("/account/public");
      expect(publicResponse.status).toBe(200);
      expect(publicResponse.body.data.authenticated).toBe(false);
    } finally {
      await app?.close();
      await project.cleanup();
    }
  });
});
