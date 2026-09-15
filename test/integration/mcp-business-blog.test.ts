import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { MongoClient } from "mongodb";
import { checkMcpConsumerTypes } from "../helpers/mcp-consumer-types.js";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { bootstrap, type BootstrapResult } from "../../src/lib/bootstrap.js";
import {
  createBusinessConsumer,
  repository,
} from "../helpers/mcp-business-consumer.js";

const databaseName = `vext_mcp_${randomUUID().replaceAll("-", "")}`;
const uri = new URL(
  process.env.VEXT_TEST_MONGODB_URI ?? "mongodb://127.0.0.1:27017",
);
uri.pathname = `/${databaseName}`;
const adminToken = `test-${randomUUID()}`;
let consumer: Awaited<ReturnType<typeof createBusinessConsumer>> | undefined;
let runtime: BootstrapResult | undefined;
let database: MongoClient | undefined;
let url: string;
let port: number;
let priorBuilt: string | undefined;

async function request(
  endpoint: string,
  options: { admin?: boolean; method?: string; body?: unknown } = {},
) {
  const response = await fetch(url + endpoint, {
    method: options.method ?? "GET",
    headers: {
      ...(options.admin ? { Authorization: `Bearer ${adminToken}` } : {}),
      ...(options.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await response.json();
  return { response, body, data: body.data };
}
const publicPath = "/api/blog";
const adminPath = "/api/admin/blog";
const input = (slug: string) => ({
  slug,
  title: "A blog post",
  excerpt: "An excerpt",
  content: "Body text",
  tags: ["framework"],
  status: "published",
  featured: false,
  publishedAt: "2026-01-01T00:00:00.000Z",
});

beforeAll(async () => {
  database = new MongoClient(uri.toString(), {
    serverSelectionTimeoutMS: 3000,
  });
  await database.connect();
  await database.db().command({ ping: 1 });
  consumer = await createBusinessConsumer();
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  if (!address || typeof address === "string")
    throw new Error("No local test port");
  port = address.port;
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  await consumer.put(
    "src/config/default.ts",
    `export default ${JSON.stringify(
      {
        port,
        host: "127.0.0.1",
        adapter: "native",
        logger: { level: "silent" },
        accessLog: { enabled: false },
        rateLimit: { enabled: false },
        middlewares: ["blog-auth", "blog-json"],
        blogAdminToken: adminToken,
        locale: { default: "en-US", supported: ["en-US", "zh-CN"] },
        openapi: { enabled: true },
        frontend: {
          enabled: true,
          i18n: {
            enabled: true,
            defaultLocale: "en-US",
            clientLoad: "current",
          },
        },
        database: {
          config: { uri: uri.toString() },
          cursorSecret: "mcp-consumer-cursor-secret-32-bytes-minimum",
          cache: { memory: { enabled: false } },
        },
        cache: { enabled: true, defaultTtl: 300 },
      },
      null,
      2,
    )};\n`,
    "Bind isolated database, auth and bounded cache configuration; no user service is changed",
  );
  const model = await consumer.generate("model", "blog-post", {
    key: "BlogPost",
    collection: "blog_posts",
    language: "ts",
    document: {
      slug: "string",
      title: "string",
      excerpt: "string",
      content: "string",
      status: '"draft" | "published"',
      featured: "boolean",
      tags: "string[]",
      publishedAt: "string | null",
      createdAt: "Date",
      updatedAt: "Date",
    },
    schema: {
      slug: "string:1-80!",
      title: "string:1-160!",
      excerpt: "string:1-500!",
      content: "string:1-20000!",
      status: "enum:draft|published!",
      featured: "boolean!",
      tags: { type: "array", items: { type: "string" } },
      publishedAt: { type: ["string", "null"] },
    },
    indexes: [{ key: { slug: 1 }, unique: true }],
    modelOptions: { timestamps: true },
  });
  expect(
    model.files.some(
      (file) => file.path === "src/types/server/models/blog-post.ts",
    ),
  ).toBe(true);
  await consumer.generate("service", "blog", {
    language: "ts",
    method: "list",
    imports:
      'import type { BlogPostDocument } from "../types/server/models/blog-post.js";',
    parameters: "page = 1, limit = 12",
    body: 'if (!this.app.db) this.app.throw(503, "Blog database is unavailable");\nreturn this.app.db.model<BlogPostDocument>("BlogPost").findAndCount({ status: "published" }, { skip: (page - 1) * limit, limit, sort: { publishedAt: -1, _id: -1 } });',
  });
  await consumer.generate("mock-scenario", "blog", {
    language: "ts",
    data: [
      input("sample-one"),
      {
        ...input("sample-draft"),
        status: "draft",
        title: "PRIVATE_DRAFT_TITLE",
        content: "PRIVATE_DRAFT_CONTENT",
      },
    ],
    target: "shared",
  });
  await consumer.generate(
    "api-route",
    "blog",
    {
      language: "ts",
      method: "get",
      service: "blog",
      serviceMethod: "list",
      serviceArgs:
        "req.valid('query').page ?? 1, req.valid('query').limit ?? 12",
      validate: { query: { page: "number:1-100000?", limit: "number:1-100?" } },
      responses: {
        200: {
          schema: {
            data: { type: "array", items: { type: "object" } },
            total: "number!",
          },
        },
      },
    },
    { roles: { routes: "src/routes/api" } },
  );
  await consumer.call("vext_knowledge_search", {
    ids: ["K10", "K12"],
    locale: "zh",
  });
  for (const locale of ["en-US", "zh-CN"]) {
    const messages = JSON.parse(
      await readFile(
        path.join(
          repository,
          "test/fixtures/mcp-business/blog/src/frontend/locales/blog/admin",
          locale + ".json",
        ),
        "utf8",
      ),
    );
    await consumer.generate("locale", "blog-admin", {
      module: "blog/admin",
      locale,
      messages,
      target: "frontend",
    });
  }
  await consumer.overlayFixture("blog");
  // The final service orchestrates several real use cases; it is deliberately recorded as host integration above.
  await consumer.command([
    path.join(repository, "dist/cli/index.js"),
    "build",
    "--typecheck",
  ]);
  await mkdir(path.join(consumer.root, ".vext/scripts"), { recursive: true });
  await build({
    entryPoints: [path.join(consumer.root, "scripts/seeds/blog.ts")],
    outfile: path.join(consumer.root, ".vext/scripts/blog-seed.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "silent",
  });
  priorBuilt = process.env.VEXT_BUILT;
  process.env.VEXT_BUILT = "1";
  runtime = await bootstrap(consumer.root);
  url = `http://127.0.0.1:${runtime.serverHandle.port}`;
  consumer.history.push({
    action: "start-http",
    pid: process.pid,
    cwd: consumer.root,
    port: runtime.serverHandle.port,
    url,
    owner: "mcp-business-blog.test.ts",
  });
}, 120_000);

afterAll(async () => {
  const errors: unknown[] = [];
  const cleanup = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      errors.push(error);
    }
  };
  await cleanup(async () => {
    if (!runtime) return;
    try {
      await runtime.serverHandle.close();
    } finally {
      await runtime.internals.shutdown(undefined, { skipExit: true });
    }
    const probe = createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(port, "127.0.0.1", resolve);
    });
    await new Promise<void>((resolve, reject) =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );
    consumer?.history.push({
      action: "stop-http",
      pid: process.pid,
      port,
      portReleased: true,
    });
  });
  await cleanup(async () => {
    if (!database) return;
    if (!/^vext_mcp_[a-f0-9]{32}$/u.test(databaseName))
      throw new Error("Unexpected owned database name");
    await database.db(databaseName).dropDatabase();
    consumer?.history.push({
      action: "drop-owned-database",
      database: databaseName,
    });
  });
  await cleanup(async () => {
    await database?.close();
  });
  if (priorBuilt === undefined) delete process.env.VEXT_BUILT;
  else process.env.VEXT_BUILT = priorBuilt;
  await cleanup(async () => {
    await consumer?.close();
  });
  if (consumer && process.env.VEXT_MCP_BUSINESS_EVIDENCE)
    await writeFile(
      process.env.VEXT_MCP_BUSINESS_EVIDENCE,
      JSON.stringify(consumer.history, null, 2),
    );
  if (errors.length)
    throw new AggregateError(errors, "Owned blog consumer cleanup failed");
});

describe.sequential("MCP blog native consumer", () => {
  it("renders public pages and the anonymous admin shell with nested locales", async () => {
    const english = await fetch(url + "/");
    expect(english.status).toBe(200);
    expect(await english.text()).toContain("<h1>Blog</h1>");
    const chinese = await fetch(url + "/?lang=zh-CN");
    expect(chinese.status).toBe(200);
    expect(await chinese.text()).toContain('lang="zh-CN"');
    expect((await fetch(url + "/?search=")).status).toBe(200);
    const admin = await fetch(url + "/admin");
    expect(admin.status).toBe(200);
    expect(admin.headers.get("cache-control")).toContain("no-store");
    const html = await admin.text();
    expect(html).toContain("Admin token");
    expect(html).not.toContain(adminToken);
    expect(html).not.toContain("PRIVATE_DRAFT");
    expect(html).not.toContain("BACKEND_ONLY_LOCALE");
    const missing = await fetch(url + "/api/blog/absent", {
      headers: { "Accept-Language": "zh-CN" },
    });
    expect(missing.status).toBe(404);
    expect((await missing.json()).message).toBe("文章不存在");
    expect((await fetch(url + "/blog-cover.svg")).status).toBe(200);
  });
  it("keeps twenty concurrent reads side-effect free and enforces admin authentication", async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => request(publicPath)),
    );
    for (const response of responses) {
      expect(response.response.status).toBe(200);
      expect(response.data.items).toEqual([]);
      expect(response.data.total).toBe(0);
    }
    expect(await database!.db().collection("blog_posts").countDocuments()).toBe(
      0,
    );
    const denied = await request(adminPath);
    expect(denied.response.status).toBe(401);
    expect(denied.response.headers.get("cache-control")).toContain("no-store");
    expect((await request(adminPath, { admin: true })).response.status).toBe(
      200,
    );
  });

  it("runs explicit and concurrent seeds idempotently without overwriting edits", async () => {
    const seed = () => consumer!.command([".vext/scripts/blog-seed.mjs"]);
    await seed();
    await database!
      .db()
      .collection("blog_posts")
      .updateOne(
        { slug: "sample-one" },
        { $set: { title: "User edited title" } },
      );
    await Promise.all([seed(), seed()]);
    expect(await database!.db().collection("blog_posts").countDocuments()).toBe(
      2,
    );
    expect(
      (
        await database!
          .db()
          .collection("blog_posts")
          .findOne({ slug: "sample-one" })
      )?.title,
    ).toBe("User edited title");
    const admin = await request(adminPath, { admin: true });
    expect(admin.data.total).toBe(2);
    expect(admin.response.headers.get("cache-control")).toContain("no-store");
    await runtime!.app.cache.invalidate("blog-public");
    expect((await request(publicPath)).data.total).toBe(1);
    expect((await request(`${publicPath}/sample-draft`)).response.status).toBe(
      404,
    );
  }, 60_000);

  it("uses model schema, timestamps, unique constraints and native pagination beyond 250 rows", async () => {
    const posts = runtime!.app.db!.model("BlogPost");
    await posts.deleteMany({});
    await expect(
      posts.insertOne({ slug: "invalid", title: 7 }),
    ).rejects.toThrow();
    const rows = Array.from({ length: 330 }, (_, index) => ({
      ...input(`post-${index}`),
      title: `Post ${index}`,
      status: index < 320 ? "published" : "draft",
      tags: [index % 2 ? "odd" : "even"],
      featured: index % 3 === 0,
    }));
    await posts.insertMany(rows);
    await runtime!.app.cache.invalidate("blog-public");
    await expect(posts.insertOne(rows[0])).rejects.toThrow();
    const first = await request(publicPath);
    expect(first.data.total).toBe(320);
    expect(first.data.items).toHaveLength(12);
    expect(first.data.items[0].createdAt).toMatch(/^\d{4}-/u);
    expect((await request(`${publicPath}?page=26`)).data.items).toHaveLength(
      12,
    );
    expect((await request(`${publicPath}?page=27`)).data.items).toHaveLength(8);
    expect((await request(`${publicPath}?page=28`)).data.items).toHaveLength(0);
    expect((await request(`${publicPath}?tag=even`)).data.total).toBe(160);
    expect((await request(`${publicPath}?search=%5B`)).data.total).toBe(0);
    expect((await request(`${publicPath}/stats`)).data.total).toBe(320);
    expect(
      (await request(`${adminPath}/stats`, { admin: true })).data.total,
    ).toBe(330);
    for (const query of [
      "page=0",
      "page=1.5",
      "limit=101",
      "limit=-1",
      "status=hidden",
    ])
      expect((await request(`${publicPath}?${query}`)).response.status).toBe(
        422,
      );
  });

  it("strictly validates writes, keeps PATCH semantics and publishes accurate OpenAPI responses", async () => {
    for (const body of [
      { ...input("bad"), featured: "false" },
      { ...input("bad"), title: null },
      { ...input("bad"), title: "   " },
      { ...input("bad"), tags: [5] },
      { ...input("bad"), status: "wrong" },
      { ...input("bad"), createdAt: "2020-01-01" },
      { ...input("bad"), featured: 0 },
      { ...input("bad"), tags: Array.from({ length: 11 }, () => "tag") },
      { ...input("bad"), tags: ["x".repeat(41)] },
      { ...input("bad"), publishedAt: "not-a-date" },
      { ...input("bad"), readingMinutes: 999 },
    ])
      expect(
        (await request(adminPath, { admin: true, method: "POST", body }))
          .response.status,
      ).toBe(422);
    const created = await request(adminPath, {
      admin: true,
      method: "POST",
      body: {
        slug: "created-draft",
        title: "New draft",
        excerpt: "Excerpt",
        content: "Content",
        tags: ["a", "a"],
      },
    });
    expect(created.response.status, JSON.stringify(created.body)).toBe(201);
    expect(created.data.post.status).toBe("draft");
    expect(created.data.post.tags).toEqual(["a"]);
    expect(
      (
        await request(`${adminPath}/created-draft`, {
          admin: true,
          method: "PATCH",
          body: {},
        })
      ).response.status,
    ).toBe(422);
    const patched = await request(`${adminPath}/created-draft`, {
      admin: true,
      method: "PATCH",
      body: { status: "published" },
    });
    expect(patched.response.status).toBe(200);
    expect(patched.data.post.title).toBe("New draft");
    expect(patched.data.post.publishedAt).toMatch(/^\d{4}-/u);
    const conflict = await request(adminPath, {
      admin: true,
      method: "POST",
      body: input("created-draft"),
    });
    expect(conflict.response.status).toBe(409);
    expect(
      (await request(`${adminPath}/absent`, { admin: true, method: "DELETE" }))
        .response.status,
    ).toBe(404);
    const spec = await (await fetch(url + "/openapi.json")).json();
    expect(spec.paths[adminPath].post.responses["201"]).toBeDefined();
    expect(spec.paths[`${adminPath}/{slug}`].patch).toBeDefined();
    expect(spec.paths[`${adminPath}/{slug}`].put).toBeUndefined();
  });

  it("reports a committed save when cache invalidation fails and allows explicit recovery", async () => {
    const failure = vi
      .spyOn(runtime!.app.cache, "invalidate")
      .mockRejectedValue(new Error("simulated owned cache failure"));
    try {
      const saved = await request(adminPath, {
        admin: true,
        method: "POST",
        body: input("cache-pending"),
      });
      expect(saved.response.status, JSON.stringify(saved.body)).toBe(201);
      expect(saved.data.cacheRefresh).toBe("pending");
      expect(
        await database!
          .db()
          .collection("blog_posts")
          .findOne({ slug: "cache-pending" }),
      ).not.toBeNull();
      expect(
        (await request(`${adminPath}/purge`, { admin: true, method: "POST" }))
          .response.status,
      ).toBe(500);
    } finally {
      failure.mockRestore();
    }
    expect(
      (await request(`${adminPath}/purge`, { admin: true, method: "POST" }))
        .data.cacheRefresh,
    ).toBe("complete");
    await runtime!.app.db!.model("BlogPost").deleteMany({});
    await runtime!.app.cache.invalidate("blog-public");
    expect((await request(publicPath)).data.items).toEqual([]);
    expect(await database!.db().collection("blog_posts").countDocuments()).toBe(
      0,
    );
  });
  it("preserves publication boundaries, stable ties and bounded cache expiry", async () => {
    const posts = runtime!.app.db!.model("BlogPost");
    await posts.insertMany([
      ...Array.from({ length: 25 }, (_, i) => ({
        ...input(`edge-${i}`),
        featured: true,
      })),
      {
        ...input("edge-private"),
        status: "draft",
        featured: true,
        title: "PRIVATE_DRAFT_TITLE",
      },
    ]);
    await runtime!.app.cache.invalidate("blog-public");
    const first = (await request(publicPath)).data.items.map(
      (post: { slug: string }) => post.slug,
    );
    const second = (await request(publicPath + "?page=2")).data.items.map(
      (post: { slug: string }) => post.slug,
    );
    expect(first.filter((slug: string) => second.includes(slug))).toEqual([]);
    expect(
      (await request(publicPath)).data.items.map(
        (post: { slug: string }) => post.slug,
      ),
    ).toEqual(first);
    expect(
      JSON.stringify((await request(publicPath + "/featured")).data),
    ).not.toContain("edge-private");
    const related = (await request(publicPath + "/edge-0/related")).data;
    expect(JSON.stringify(related)).not.toContain("edge-private");
    expect(JSON.stringify(related)).not.toContain('"slug":"edge-0"');
    await Promise.all([
      posts.insertOne(input("edge-new")),
      posts.deleteOne({ slug: "edge-24" }),
    ]);
    await runtime!.app.cache.invalidate("blog-public");
    expect((await request(publicPath)).data.total).toBe(25);
    const cached = await request(publicPath + "/edge-0");
    await posts.updateOne(
      { slug: "edge-0" },
      { $set: { title: "Fresh after TTL" } },
    );
    expect((await request(publicPath + "/edge-0")).data.title).toBe(
      cached.data.title,
    );
    expect(
      (await request(adminPath + "/edge-0", { admin: true })).data.title,
    ).toBe("Fresh after TTL");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect((await request(publicPath + "/edge-0")).data.title).toBe(
      "Fresh after TTL",
    );
    await posts.deleteMany({});
    await runtime!.app.cache.invalidate("blog-public");
  });

  it("consumes the generated typed client without inventing a source import", async () => {
    const generatedPath = path.join(
      consumer!.root,
      "dist/client/api.generated.ts",
    );
    const generated = await readFile(generatedPath, "utf8");
    const probePath = path.join(
      consumer!.root,
      ".vext/scripts/client-probe.ts",
    );
    const source = `import assert from "node:assert/strict";
import { createVextApiClient, isVextApiError } from "vextjs/frontend";
import { contract, type VextGeneratedRouteTypes } from "../../dist/client/api.generated.js";
const api = createVextApiClient<typeof contract, VextGeneratedRouteTypes>(contract, { baseUrl: process.argv[2] });
async function typeChecks() {
  const saved = await api.POST("/api/admin/blog", { body: { title: "Typed", excerpt: "Text", content: "Body" } });
  const state: "complete" | "pending" = saved.cacheRefresh;
  const title: string = saved.post.title;
  await api.PATCH("/api/admin/blog/:slug", { params: { slug: "typed" }, body: { featured: true } });
  // @ts-expect-error The actual generated schema requires a boolean.
  await api.PATCH("/api/admin/blog/:slug", { params: { slug: "typed" }, body: { featured: "false" } });
  return { state, title };
}
void typeChecks;
const page = await api.GET("/api/blog", { query: { page: 1, limit: 12 } });
assert.ok(Array.isArray(page.items));
assert.equal(typeof page.total, "number");
try { await api.GET("/api/admin/blog"); assert.fail("Expected auth failure"); }
catch (error) { assert.ok(isVextApiError(error)); assert.equal(error.status, 401); }
console.log(JSON.stringify({ status: "PASS" }));
`;
    const files = new Map([
      [generatedPath.replaceAll("\\", "/"), generated],
      [probePath.replaceAll("\\", "/"), source],
    ]);
    const diagnostics = checkMcpConsumerTypes(files);
    expect(
      diagnostics.map((item) => ({
        code: item.code,
        message: item.messageText,
      })),
    ).toEqual([]);
    await consumer!.put(
      ".vext/scripts/client-probe.ts",
      source,
      "Host validates the actual post-build typed client",
    );
    await build({
      entryPoints: [probePath],
      outfile: probePath.replace(/\.ts$/u, ".mjs"),
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      logLevel: "silent",
    });
    expect(
      JSON.parse(
        (await consumer!.command([".vext/scripts/client-probe.mjs", url]))
          .stdout,
      ).status,
    ).toBe("PASS");
  });

  it.runIf(process.env.VEXT_PLAYWRIGHT_MODULE)(
    "verifies the real hydrated blog in a browser",
    async () => {
      const posts = runtime!.app.db!.model("BlogPost");
      await posts.insertMany([
        ...Array.from({ length: 24 }, (_, index) => ({
          ...input(`browser-${index}`),
          title: `Browser ${index}`,
        })),
        {
          ...input("browser-private"),
          status: "draft",
          title: "PRIVATE_DRAFT_TITLE",
          content: "PRIVATE_DRAFT_CONTENT",
        },
      ]);
      await runtime!.app.cache.invalidate("blog-public");
      const result = await consumer!.command([
        path.join(repository, "test/fixtures/mcp-business/blog-browser.mjs"),
        url,
        adminToken,
      ]);
      expect(JSON.parse(result.stdout).status).toBe("PASS");
      expect(
        await database!
          .db()
          .collection("blog_posts")
          .countDocuments({ slug: "browser-created" }),
      ).toBe(1);
    },
    90_000,
  );
});
