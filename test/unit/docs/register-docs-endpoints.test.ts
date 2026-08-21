import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { registerDocsEndpoints } from "../../../src/lib/docs/register-docs-endpoints.js";
import { VEXT_DOCS_FAVICON_SVG } from "../../../src/lib/docs/renderers/vext-assets.js";
import type { VextApp } from "../../../src/types/app.js";

type RegisteredRoute = {
  method: string;
  path: string;
  chain: Array<(req: unknown, res: MockResponse) => unknown>;
};

type MockResponse = {
  headers: Record<string, string>;
  body: unknown;
  setHeader: ReturnType<typeof vi.fn>;
  rawJson: ReturnType<typeof vi.fn>;
  redirect: ReturnType<typeof vi.fn>;
  text: ReturnType<typeof vi.fn>;
};

function createMockResponse(): MockResponse {
  const response: MockResponse = {
    headers: {},
    body: undefined,
    setHeader: vi.fn((name: string, value: string) => {
      response.headers[name] = value;
      return response;
    }),
    rawJson: vi.fn((body: unknown) => {
      response.body = body;
    }),
    redirect: vi.fn((location: string) => {
      response.headers.Location = location;
    }),
    text: vi.fn((body: string) => {
      response.body = body;
    }),
  };
  return response;
}

function createMockApp(): VextApp & { routes: RegisteredRoute[] } {
  const routes: RegisteredRoute[] = [];
  return {
    routes,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    },
    adapter: {
      registerRoute: vi.fn((method: string, path: string, chain: never[]) => {
        routes.push({ method, path, chain });
      }),
    },
  } as unknown as VextApp & { routes: RegisteredRoute[] };
}

function readRepoFile(filePath: string): string {
  return readFileSync(resolve(filePath), "utf8");
}

const spec = {
  openapi: "3.0.0",
  info: { title: "Test API", version: "1.0.0" },
  paths: {
    "/users": {
      get: {
        summary: "List users",
        responses: { 200: { description: "OK" } },
      },
    },
    "/admin": {
      get: {
        summary: "Admin stats",
        responses: { 200: { description: "OK" } },
      },
    },
  },
};

const versionedSpec = {
  openapi: "3.0.0",
  info: { title: "Versioned API", version: "1.0.0" },
  tags: [{ name: "API v1" }, { name: "API v2" }, { name: "Admin" }],
  "x-tagGroups": [
    { name: "Versioned", tags: ["API v1", "API v2"] },
    { name: "Admin", tags: ["Admin"] },
  ],
  paths: {
    "/api/v1/info": {
      get: {
        summary: "API v1 info",
        tags: ["API v1"],
        responses: { 200: { description: "OK" } },
      },
      post: {
        summary: "Create API v1 info",
        tags: ["API v1"],
        responses: { 201: { description: "Created" } },
      },
    },
    "/api/v2/info": {
      get: {
        summary: "API v2 info",
        tags: ["API v2"],
        responses: { 200: { description: "OK" } },
      },
    },
    "/admin/stats": {
      get: {
        summary: "Admin stats",
        tags: ["Admin"],
        responses: { 200: { description: "OK" } },
      },
    },
  },
};

describe("registerDocsEndpoints", () => {
  it("registers Vext docs endpoints without Scalar assets", async () => {
    const app = createMockApp();

    registerDocsEndpoints(app, spec, {
      title: "Test API",
      specPath: "/openapi.json",
      docsPath: "/docs",
    });

    const paths = app.routes.map((route) => route.path);
    expect(paths).toContain("/openapi.json");
    expect(paths).toContain("/docs");
    expect(paths).toContain("/_vext/docs/config.json");
    expect(paths).toContain("/_vext/docs/openapi.json");
    expect(paths).toContain("/_vext/docs/code.json");
    expect(paths).toContain("/_vext/docs/search.json");
    expect(paths).toContain("/_vext/docs/app.js");
    expect(paths).toContain("/_vext/docs/style.css");
    expect(paths).toContain("/_vext/docs/favicon.svg");
    expect(paths).not.toContain("/_vext/scalar.js");

    const docsRoute = app.routes.find((route) => route.path === "/docs");
    const response = createMockResponse();
    await docsRoute!.chain[0]({}, response);

    expect(response.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(response.body).toContain("Vext Docs");
    expect(response.body).toContain('class="vext-docs-brand-mark"');
    expect(response.body).toContain('stroke="#12D6C6"');
    expect(response.body).toContain(
      '<html lang="en" data-vext-docs-theme="system" data-vext-docs-density="comfortable">',
    );
    expect(response.body).toContain(
      '<link rel="icon" type="image/svg+xml" href="/_vext/docs/favicon.svg?v=',
    );
    expect(response.body).not.toContain('href="data:,"');
    expect(response.body).toContain('id="vext-docs-critical-boot"');
    expect(response.body).toContain('localStorage.getItem("vext-docs-theme")');
    expect(response.body).toContain('id="vext-docs-critical-style"');
    expect(response.body).toContain('id="vext-docs-resizer"');
    expect(response.body).toContain(
      '</aside>\n    <div id="vext-docs-resizer"',
    );
    expect(response.body).toContain("/_vext/docs/style.css?v=");
    expect(response.body).toContain("/_vext/docs/app.js?v=");
    const appAssetVersion = response.body.match(
      /\/_vext\/docs\/app\.js\?v=([^"]+)/,
    )?.[1];
    const styleAssetVersion = response.body.match(
      /\/_vext\/docs\/style\.css\?v=([^"]+)/,
    )?.[1];
    const faviconAssetVersion = response.body.match(
      /\/_vext\/docs\/favicon\.svg\?v=([^"]+)/,
    )?.[1];
    expect(appAssetVersion).toBeTruthy();
    expect(styleAssetVersion).toBe(appAssetVersion);
    expect(faviconAssetVersion).toBe(appAssetVersion);
    expect(response.body).toContain('"theme":"system"');
    expect(response.body).toContain('"density":"comfortable"');
    expect(response.body).toContain(`"assetVersion":"${appAssetVersion}"`);
    expect(response.body).toContain('"sameOrigin":"auto"');
    expect(response.body).toContain('"customServer":true');
    expect(response.body).toContain('class="vext-docs-loading"');
    expect(response.body).toContain('class="vext-docs-nav-skeleton"');
    expect(response.body).toContain('id="vext-docs-mobile-nav-toggle"');
    expect(response.body).toContain('id="vext-docs-sidebar-backdrop"');
    expect(response.body).toContain('"accessMode":"off"');
    expect(response.body).not.toContain("Scalar.createApiReference");
  });

  it("serves docs data endpoints", async () => {
    const app = createMockApp();
    registerDocsEndpoints(app, spec, {
      title: "Test API",
      docs: { assetsPath: "/_system/docs" },
    });

    const configRoute = app.routes.find(
      (route) => route.path === "/_system/docs/config.json",
    );
    const openapiRoute = app.routes.find(
      (route) => route.path === "/_system/docs/openapi.json",
    );
    const appJsRoute = app.routes.find(
      (route) => route.path === "/_system/docs/app.js",
    );
    const styleCssRoute = app.routes.find(
      (route) => route.path === "/_system/docs/style.css",
    );
    const faviconRoute = app.routes.find(
      (route) => route.path === "/_system/docs/favicon.svg",
    );

    const configResponse = createMockResponse();
    await configRoute!.chain[0]({}, configResponse);
    expect(configResponse.body).toMatchObject({
      assetsPath: "/_system/docs",
      specPath: "/openapi.json",
      project: {
        name: "vextjs",
        scripts: expect.arrayContaining([
          expect.objectContaining({
            name: "build",
            command: "npm run build",
            group: "production",
          }),
          expect.objectContaining({
            name: "test",
            command: "npm test",
            group: "verification",
          }),
        ]),
      },
    });

    const openapiResponse = createMockResponse();
    await openapiRoute!.chain[0]({}, openapiResponse);
    expect(openapiResponse.body).toEqual(spec);

    const appJsResponse = createMockResponse();
    await appJsRoute!.chain[0]({}, appJsResponse);
    expect(appJsResponse.headers["Content-Type"]).toBe(
      "application/javascript; charset=utf-8",
    );
    expect(appJsResponse.headers["Cache-Control"]).toBe(
      "no-cache, max-age=0, must-revalidate",
    );
    expect(appJsResponse.body).toContain(
      "endpointUrl(config.endpoints.openapi",
    );

    const styleCssResponse = createMockResponse();
    await styleCssRoute!.chain[0]({}, styleCssResponse);
    expect(styleCssResponse.headers["Content-Type"]).toBe(
      "text/css; charset=utf-8",
    );
    expect(styleCssResponse.headers["Cache-Control"]).toBe(
      "no-cache, max-age=0, must-revalidate",
    );

    const faviconResponse = createMockResponse();
    await faviconRoute!.chain[0]({}, faviconResponse);
    expect(faviconResponse.headers["Content-Type"]).toBe(
      "image/svg+xml; charset=utf-8",
    );
    expect(faviconResponse.headers["Cache-Control"]).toBe(
      "no-cache, max-age=0, must-revalidate",
    );
    expect(faviconResponse.body).toContain("<svg");
    expect(faviconResponse.body).toBe(VEXT_DOCS_FAVICON_SVG);
  });

  it("uses assetsPublicPath only for browser-facing docs URLs", async () => {
    const app = createMockApp();
    registerDocsEndpoints(app, spec, {
      title: "Proxy API",
      docs: {
        assetsPath: "/_vext/docs",
        assetsPublicPath: "/admin/_vext/docs",
      },
    });

    const paths = app.routes.map((route) => route.path);
    expect(paths).toContain("/_vext/docs/app.js");
    expect(paths).toContain("/_vext/docs/style.css");
    expect(paths).toContain("/_vext/docs/favicon.svg");
    expect(paths).toContain("/_vext/docs/openapi.json");
    expect(paths).not.toContain("/admin/_vext/docs/app.js");
    expect(paths).not.toContain("/admin/_vext/docs/favicon.svg");
    expect(paths).not.toContain("/admin/_vext/docs/openapi.json");

    const docsRoute = app.routes.find((route) => route.path === "/docs");
    const docsResponse = createMockResponse();
    await docsRoute!.chain[0]({}, docsResponse);
    expect(docsResponse.body).toContain("/admin/_vext/docs/app.js?v=");
    expect(docsResponse.body).toContain("/admin/_vext/docs/style.css?v=");
    expect(docsResponse.body).toContain("/admin/_vext/docs/favicon.svg?v=");
    expect(docsResponse.body).toContain('"assetsPath":"/admin/_vext/docs"');
    expect(docsResponse.body).toContain(
      '"openapi":"/admin/_vext/docs/openapi.json"',
    );

    const configRoute = app.routes.find(
      (route) => route.path === "/_vext/docs/config.json",
    );
    const configResponse = createMockResponse();
    await configRoute!.chain[0]({}, configResponse);
    expect(configResponse.body).toMatchObject({
      assetsPath: "/admin/_vext/docs",
      endpoints: expect.objectContaining({
        appJs: "/admin/_vext/docs/app.js",
        faviconSvg: "/admin/_vext/docs/favicon.svg",
        openapi: "/admin/_vext/docs/openapi.json",
      }),
    });
  });

  it("documents docs asset endpoints including favicon", () => {
    const zhApi = readRepoFile("website/docs/zh/api/config.md");
    const enApi = readRepoFile("website/docs/en/api/config.md");
    const zhGuide = readRepoFile("website/docs/zh/guide/configuration.md");
    const enGuide = readRepoFile("website/docs/en/guide/configuration.md");

    expect(zhApi).toContain("app.js / style.css / favicon.svg");
    expect(enApi).toContain("app.js / style.css / favicon.svg");
    expect(zhGuide).toContain("app.js / style.css / favicon.svg");
    expect(enGuide).toContain("app.js / style.css / favicon.svg");
  });

  it("exposes automatic version sources and filters source data endpoints", async () => {
    const app = createMockApp();
    registerDocsEndpoints(app, versionedSpec, {
      title: "Versioned API",
    });

    const configRoute = app.routes.find(
      (route) => route.path === "/_vext/docs/config.json",
    );
    const openapiRoute = app.routes.find(
      (route) => route.path === "/_vext/docs/openapi.json",
    );
    const searchRoute = app.routes.find(
      (route) => route.path === "/_vext/docs/search.json",
    );

    const configResponse = createMockResponse();
    await configRoute!.chain[0]({}, configResponse);
    expect(configResponse.body).toMatchObject({
      sources: [
        expect.objectContaining({
          id: "all",
          label: "All",
          default: true,
          operationCount: 4,
        }),
        expect.objectContaining({
          id: "api-v1",
          label: "API v1",
          match: ["/api/v1/**"],
          auto: true,
          operationCount: 2,
        }),
        expect.objectContaining({
          id: "api-v2",
          label: "API v2",
          match: ["/api/v2/**"],
          auto: true,
          operationCount: 1,
        }),
      ],
    });

    const v1Response = createMockResponse();
    await openapiRoute!.chain[0]({ query: { source: "api-v1" } }, v1Response);
    expect(v1Response.body).toMatchObject({
      paths: { "/api/v1/info": expect.any(Object) },
      tags: [{ name: "API v1" }],
      "x-tagGroups": [{ name: "Versioned", tags: ["API v1"] }],
    });
    expect(
      (v1Response.body as typeof versionedSpec).paths["/api/v2/info"],
    ).toBeUndefined();
    expect(
      (v1Response.body as typeof versionedSpec).paths["/admin/stats"],
    ).toBeUndefined();

    const searchResponse = createMockResponse();
    await searchRoute!.chain[0](
      { query: { source: "api-v2" } },
      searchResponse,
    );
    expect(searchResponse.body).toEqual(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ kind: "openapi", path: "/api/v2/info" }),
        ]),
      }),
    );
    expect(JSON.stringify(searchResponse.body)).not.toContain("/api/v1/info");
  });

  it("filters explicit docs sources through source access descriptors", async () => {
    const app = createMockApp();
    const resolver = vi.fn(({ descriptor }) => {
      if (descriptor.kind === "source" && descriptor.access === "admin") {
        return false;
      }
      return true;
    });
    registerDocsEndpoints(app, versionedSpec, {
      title: "Versioned API",
      docs: {
        access: { mode: "enforce", resolver },
        sources: [
          { id: "all", label: "All", match: "/**", default: true },
          { id: "api-v1", label: "API v1", match: "/api/v1/**" },
          {
            id: "admin-v1",
            label: "Admin v1",
            match: "/admin/**",
            access: "admin",
          },
          {
            id: "hidden-v2",
            label: "Hidden v2",
            match: "/api/v2/**",
            access: { visible: false },
          },
        ],
      },
    });

    const configRoute = app.routes.find(
      (route) => route.path === "/_vext/docs/config.json",
    );
    const openapiRoute = app.routes.find(
      (route) => route.path === "/_vext/docs/openapi.json",
    );

    const configResponse = createMockResponse();
    await configRoute!.chain[0]({}, configResponse);
    const sourceIds = (
      (configResponse.body as { sources: Array<{ id: string }> }).sources ?? []
    ).map((source) => source.id);
    expect(sourceIds).toEqual(["all", "api-v1"]);
    expect(resolver).toHaveBeenCalledWith(
      expect.objectContaining({
        descriptor: expect.objectContaining({
          kind: "source",
          sourceId: "admin-v1",
          access: "admin",
        }),
      }),
    );

    const hiddenSourceResponse = createMockResponse();
    await openapiRoute!.chain[0](
      { query: { source: "admin-v1" } },
      hiddenSourceResponse,
    );
    expect(hiddenSourceResponse.body).toMatchObject({
      code: 404,
      message: 'Docs source "admin-v1" was not found.',
    });
  });

  it("keeps explicit code-only docs sources visible", async () => {
    const app = createMockApp();
    registerDocsEndpoints(app, versionedSpec, {
      title: "Versioned API",
      docs: {
        sources: [
          { id: "all", label: "All", match: "/**", default: true },
          {
            id: "sdk",
            label: "SDK",
            match: "/sdk/**",
            code: { include: ["services/sdk"] },
          },
        ],
      },
    });

    const configRoute = app.routes.find(
      (route) => route.path === "/_vext/docs/config.json",
    );
    const openapiRoute = app.routes.find(
      (route) => route.path === "/_vext/docs/openapi.json",
    );
    const codeRoute = app.routes.find(
      (route) => route.path === "/_vext/docs/code.json",
    );

    const configResponse = createMockResponse();
    await configRoute!.chain[0]({}, configResponse);
    const sources =
      (
        configResponse.body as {
          sources: Array<{ id: string; operationCount?: number }>;
        }
      ).sources ?? [];
    expect(sources.map((source) => source.id)).toEqual(["all", "sdk"]);
    expect(sources.find((source) => source.id === "sdk")).toMatchObject({
      operationCount: 0,
    });

    const openapiResponse = createMockResponse();
    await openapiRoute!.chain[0]({ query: { source: "sdk" } }, openapiResponse);
    expect(openapiResponse.body).toMatchObject({ paths: {} });

    const codeResponse = createMockResponse();
    await codeRoute!.chain[0]({ query: { source: "sdk" } }, codeResponse);
    expect(codeResponse.body).toMatchObject({ items: [] });
  });

  it("omits project metadata when package.json is unavailable", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "vext-docs-no-package-"));
    try {
      const app = createMockApp();
      registerDocsEndpoints(app, spec, {
        title: "Test API",
        rootDir,
      });

      const configRoute = app.routes.find(
        (route) => route.path === "/_vext/docs/config.json",
      );
      const response = createMockResponse();
      await configRoute!.chain[0]({}, response);

      expect(response.body).not.toHaveProperty("project");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("resolves function specs and non-object request contexts", async () => {
    const app = createMockApp();
    const specProvider = vi.fn(() => spec);
    registerDocsEndpoints(app, specProvider, {
      title: "Test API",
    });

    const openapiRoute = app.routes.find(
      (route) => route.path === "/openapi.json",
    );
    const response = createMockResponse();
    await openapiRoute!.chain[0](null, response);

    expect(specProvider).toHaveBeenCalledOnce();
    expect(response.body).toEqual(spec);
  });

  it("rejects external docs renderer objects", () => {
    const app = createMockApp();
    const render = vi.fn(() => "<html>custom docs</html>");

    expect(() =>
      registerDocsEndpoints(app, spec, {
        title: "Test API",
        docs: {
          renderer: { name: "custom", render } as never,
        },
      }),
    ).toThrow('openapi.docs.renderer only supports "vext"');
    expect(render).not.toHaveBeenCalled();
  });

  it("filters canonical and docs OpenAPI data in enforce mode", async () => {
    const app = createMockApp();
    registerDocsEndpoints(app, spec, {
      title: "Test API",
      docs: {
        access: {
          mode: "enforce",
          resolver: ({ descriptor }) => descriptor.path !== "/admin",
        },
      },
    });

    const canonicalRoute = app.routes.find(
      (route) => route.path === "/openapi.json",
    );
    const docsOpenAPIRoute = app.routes.find(
      (route) => route.path === "/_vext/docs/openapi.json",
    );

    const canonicalResponse = createMockResponse();
    await canonicalRoute!.chain[0]({}, canonicalResponse);
    expect(canonicalResponse.body).toMatchObject({
      paths: { "/users": expect.any(Object) },
    });
    expect(
      (canonicalResponse.body as typeof spec).paths["/admin"],
    ).toBeUndefined();

    const docsResponse = createMockResponse();
    await docsOpenAPIRoute!.chain[0]({}, docsResponse);
    expect((docsResponse.body as typeof spec).paths["/admin"]).toBeUndefined();
  });

  it("filters Code JSDoc and search endpoints in enforce mode", async () => {
    const app = createMockApp();
    registerDocsEndpoints(app, spec, {
      title: "Test API",
      docs: {
        access: {
          mode: "enforce",
          resolver: ({ descriptor }) => descriptor.kind !== "utils",
        },
        code: {
          utils: {
            dir: "test/fixtures/docs-utils",
          },
          services: false,
          models: false,
        },
      },
      srcDir: process.cwd(),
    });

    const codeRoute = app.routes.find(
      (route) => route.path === "/_vext/docs/code.json",
    );
    const searchRoute = app.routes.find(
      (route) => route.path === "/_vext/docs/search.json",
    );

    const codeResponse = createMockResponse();
    await codeRoute!.chain[0]({}, codeResponse);
    expect(codeResponse.body).toEqual(expect.objectContaining({ items: [] }));

    const searchResponse = createMockResponse();
    await searchRoute!.chain[0]({}, searchResponse);
    expect(searchResponse.body).toEqual(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ kind: "openapi", path: "/users" }),
          expect.objectContaining({ kind: "openapi", path: "/admin" }),
        ]),
      }),
    );
    expect(JSON.stringify(searchResponse.body)).not.toContain("utils:");
  });

  it("does not warn when legacy scalar config is absent", () => {
    const app = createMockApp();

    registerDocsEndpoints(app, spec, {
      title: "Test API",
    });

    expect(app.logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("openapi.scalar is deprecated"),
    );
  });

  it("warns when legacy scalar config is an empty object", () => {
    const app = createMockApp();

    registerDocsEndpoints(app, spec, {
      title: "Test API",
      scalar: {},
    });

    expect(app.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("openapi.scalar is deprecated"),
    );
  });

  it("warns when legacy scalar config is still present", () => {
    const app = createMockApp();

    registerDocsEndpoints(app, spec, {
      title: "Test API",
      scalar: { theme: "default" },
    });

    expect(app.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("openapi.scalar is deprecated"),
    );
  });

  it("documents legacy scalar as explicitly configured warning-only config", () => {
    const zhApi = readRepoFile("website/docs/zh/api/config.md");
    const enApi = readRepoFile("website/docs/en/api/config.md");
    const zhGuide = readRepoFile("website/docs/zh/guide/configuration.md");
    const enGuide = readRepoFile("website/docs/en/guide/configuration.md");

    expect(zhApi).toContain(
      "| `scalar`                        | `object`                                  | `undefined`",
    );
    expect(enApi).toContain(
      "| `scalar`                        | `object`                                  | `undefined`",
    );
    expect(zhGuide).toContain(
      "| `openapi.scalar`                        | `object`                 | `undefined`",
    );
    expect(enGuide).toContain(
      "| `openapi.scalar`                        | `object`                 | `undefined`",
    );
    expect(zhApi).toContain("仅显式配置时触发 warning");
    expect(enApi).toContain(
      "only triggers a warning when explicitly configured",
    );
  });

  it("opens src source files and preload root source files locally", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "vext-docs-source-"));
    try {
      await mkdir(join(rootDir, "src", "utils"), { recursive: true });
      await mkdir(join(rootDir, "preload"), { recursive: true });
      await writeFile(
        join(rootDir, "src", "utils", "date.ts"),
        "export const date = 1;",
      );
      await writeFile(
        join(rootDir, "preload", "bootstrap.ts"),
        "export const boot = 1;",
      );
      await writeFile(join(rootDir, "root-file.ts"), "export const root = 1;");

      const app = createMockApp();
      registerDocsEndpoints(app, spec, {
        title: "Test API",
        rootDir,
      });

      const sourceRoute = app.routes.find(
        (route) => route.path === "/_vext/docs/source",
      );
      const localRequest = (file: string) => ({
        query: { file, line: "3" },
        headers: { host: "127.0.0.1:3000" },
        ip: "127.0.0.1",
      });

      const srcResponse = createMockResponse();
      await sourceRoute!.chain[0](localRequest("utils/date.ts"), srcResponse);
      expect(srcResponse.redirect).toHaveBeenCalledWith(
        expect.stringContaining("/src/utils/date.ts:3:1"),
      );

      const preloadResponse = createMockResponse();
      await sourceRoute!.chain[0](
        localRequest("preload/bootstrap.ts"),
        preloadResponse,
      );
      expect(preloadResponse.redirect).toHaveBeenCalledWith(
        expect.stringContaining("/preload/bootstrap.ts:3:1"),
      );

      const rootResponse = createMockResponse();
      await sourceRoute!.chain[0](localRequest("root-file.ts"), rootResponse);
      expect(rootResponse.rawJson).toHaveBeenCalledWith(
        { code: 404, message: "Source file not found." },
        404,
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("supports explicit srcDir source links and falls back to root src", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "vext-docs-source-fallback-"));
    try {
      const srcDir = join(rootDir, "custom-src");
      await mkdir(srcDir, { recursive: true });
      await writeFile(join(srcDir, "helper.ts"), "export const helper = 1;");

      const app = createMockApp();
      registerDocsEndpoints(app, spec, {
        title: "Test API",
        rootDir,
        srcDir,
      });

      const sourceRoute = app.routes.find(
        (route) => route.path === "/_vext/docs/source",
      );
      const localRequest = (file: string) => ({
        query: { file },
        headers: { host: "127.0.0.1:3000" },
        ip: "127.0.0.1",
      });

      const srcDirResponse = createMockResponse();
      await sourceRoute!.chain[0](localRequest("helper.ts"), srcDirResponse);
      expect(srcDirResponse.redirect).toHaveBeenCalledWith(
        expect.stringContaining("/custom-src/helper.ts:1:1"),
      );

      const fallbackApp = createMockApp();
      registerDocsEndpoints(fallbackApp, spec, {
        title: "Test API",
        rootDir,
      });
      const fallbackSourceRoute = fallbackApp.routes.find(
        (route) => route.path === "/_vext/docs/source",
      );
      const fallbackResponse = createMockResponse();
      await fallbackSourceRoute!.chain[0](
        localRequest("helper.ts"),
        fallbackResponse,
      );
      expect(fallbackResponse.rawJson).toHaveBeenCalledWith(
        { code: 404, message: "Source file not found." },
        404,
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("keeps canonical OpenAPI public when explicitly configured", async () => {
    const app = createMockApp();
    registerDocsEndpoints(app, spec, {
      title: "Test API",
      docs: {
        access: {
          mode: "enforce",
          openapiJson: "public",
          resolver: ({ descriptor }) => descriptor.path !== "/admin",
        },
      },
    });

    const canonicalRoute = app.routes.find(
      (route) => route.path === "/openapi.json",
    );
    const docsOpenAPIRoute = app.routes.find(
      (route) => route.path === "/_vext/docs/openapi.json",
    );

    const canonicalResponse = createMockResponse();
    await canonicalRoute!.chain[0]({}, canonicalResponse);
    expect(
      (canonicalResponse.body as typeof spec).paths["/admin"],
    ).toBeDefined();

    const docsResponse = createMockResponse();
    await docsOpenAPIRoute!.chain[0]({}, docsResponse);
    expect((docsResponse.body as typeof spec).paths["/admin"]).toBeUndefined();
  });

  it("filters docs UI OpenAPI, search and source data in visibility-only mode", async () => {
    const app = createMockApp();
    const docsSpec = {
      ...spec,
      tags: [{ name: "users" }, { name: "admin" }],
      "x-tagGroups": [
        { name: "Public", tags: ["users"] },
        { name: "Admin", tags: ["admin"] },
      ],
      paths: {
        "/users": {
          get: {
            tags: ["users"],
            operationId: "listUsers",
            summary: "List users",
            responses: { 200: { description: "OK" } },
          },
        },
        "/admin": {
          get: {
            tags: ["admin"],
            operationId: "adminStats",
            summary: "Admin stats",
            responses: { 200: { description: "OK" } },
          },
        },
      },
    };
    registerDocsEndpoints(app, docsSpec, {
      title: "Test API",
      docs: {
        access: {
          mode: "visibility-only",
          resolver: ({ descriptor }) => descriptor.path !== "/admin",
        },
      },
    });

    const canonicalRoute = app.routes.find(
      (route) => route.path === "/openapi.json",
    );
    const configRoute = app.routes.find(
      (route) => route.path === "/_vext/docs/config.json",
    );
    const docsOpenAPIRoute = app.routes.find(
      (route) => route.path === "/_vext/docs/openapi.json",
    );
    const searchRoute = app.routes.find(
      (route) => route.path === "/_vext/docs/search.json",
    );

    const canonicalResponse = createMockResponse();
    await canonicalRoute!.chain[0]({}, canonicalResponse);
    expect(
      (canonicalResponse.body as typeof docsSpec).paths["/admin"],
    ).toBeDefined();

    const configResponse = createMockResponse();
    await configRoute!.chain[0]({}, configResponse);
    expect(configResponse.body).toMatchObject({
      sources: [
        expect.objectContaining({
          id: "all",
          operationCount: 1,
        }),
      ],
    });

    const docsOpenAPIResponse = createMockResponse();
    await docsOpenAPIRoute!.chain[0]({}, docsOpenAPIResponse);
    expect(
      (docsOpenAPIResponse.body as typeof docsSpec).paths["/users"],
    ).toBeDefined();
    expect(
      (docsOpenAPIResponse.body as typeof docsSpec).paths["/admin"],
    ).toBeUndefined();
    expect(docsOpenAPIResponse.body).toMatchObject({
      tags: [{ name: "users" }],
      "x-tagGroups": [{ name: "Public", tags: ["users"] }],
    });

    const searchResponse = createMockResponse();
    await searchRoute!.chain[0]({}, searchResponse);
    expect(searchResponse.body).toEqual(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ kind: "openapi", path: "/users" }),
        ]),
      }),
    );
    expect(JSON.stringify(searchResponse.body)).not.toContain("/admin");
  });
});
