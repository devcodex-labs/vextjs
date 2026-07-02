import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { registerDocsEndpoints } from "../../../src/lib/docs/register-docs-endpoints.js";
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
    expect(paths).not.toContain("/_vext/scalar.js");

    const docsRoute = app.routes.find((route) => route.path === "/docs");
    const response = createMockResponse();
    await docsRoute!.chain[0]({}, response);

    expect(response.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(response.body).toContain("Vext Docs");
    expect(response.body).toContain('<link rel="icon" href="data:,">');
    expect(response.body).toContain('id="vext-docs-resizer"');
    expect(response.body).toContain("</aside>\n    <div id=\"vext-docs-resizer\"");
    expect(response.body).toContain('/_vext/docs/style.css?v=');
    expect(response.body).toContain('/_vext/docs/app.js?v=');
    expect(response.body).toContain("20260702-b31");
    expect(response.body).toContain('"theme":"system"');
    expect(response.body).toContain('"density":"comfortable"');
    expect(response.body).toContain('"assetVersion":"20260702-b31"');
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
    expect(appJsResponse.body).toContain("fetch(config.endpoints.openapi");

    const styleCssResponse = createMockResponse();
    await styleCssRoute!.chain[0]({}, styleCssResponse);
    expect(styleCssResponse.headers["Content-Type"]).toBe(
      "text/css; charset=utf-8",
    );
    expect(styleCssResponse.headers["Cache-Control"]).toBe(
      "no-cache, max-age=0, must-revalidate",
    );
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

  it("opens src source files and preload root source files locally", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "vext-docs-source-"));
    try {
      await mkdir(join(rootDir, "src", "utils"), { recursive: true });
      await mkdir(join(rootDir, "preload"), { recursive: true });
      await writeFile(join(rootDir, "src", "utils", "date.ts"), "export const date = 1;");
      await writeFile(join(rootDir, "preload", "bootstrap.ts"), "export const boot = 1;");
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
});
