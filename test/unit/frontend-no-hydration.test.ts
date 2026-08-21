import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildFrontendClient } from "../../src/frontend/tooling/client-build-compiler.js";
import {
  createFrontendRenderMiddleware,
  isPageEnvelopeRequest,
} from "../../src/frontend/runtime/renderer.js";
import {
  applyDocumentPolicy,
  resolveDocumentPolicy,
} from "../../src/frontend/runtime/document-policy.js";
import { resolveFrontendConfig } from "../../src/frontend/tooling/config-resolver.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("frontend no-hydration document policy", () => {
  it("removes only framework-owned browser runtime artifacts", async () => {
    const rootDir = await tempRoot();
    const config = resolveFrontendConfig(
      { enabled: true, render: { streaming: "auto" } },
      { rootDir, mode: "production" },
    );
    const request = createRequest(
      "/article",
      {},
      {
        frontend: { hydration: "none" },
      },
    );
    const policy = resolveDocumentPolicy({ config, req: request });
    const html = applyDocumentPolicy(
      [
        '<html><head><link rel="stylesheet" href="/app.css" data-vext-style>',
        '<link rel="modulepreload" href="/route.js" data-vext-route-preload>',
        '<link rel="modulepreload" href="https://cdn.test/react.js" data-vext-external-runtime>',
        '</head><body><div id="root" data-vext-root>SSR</div>',
        '<script src="/analytics.js" data-user-script></script>',
        '<script type="application/json" data-vext-data>{}</script>',
        '<script type="module" src="/entry.js" data-vext-entry></script>',
        "</body></html>",
      ].join(""),
      policy,
    );

    expect(policy).toEqual({
      hydration: "none",
      pageEnvelope: false,
      streaming: false,
    });
    expect(html).toContain('href="/app.css" data-vext-style');
    expect(html).toContain('src="/analytics.js" data-user-script');
    expect(html).toContain('data-vext-hydration="none"');
    expect(html).not.toContain("data-vext-route-preload");
    expect(html).not.toContain("data-vext-external-runtime");
    expect(html).not.toContain("data-vext-data");
    expect(html).not.toContain("data-vext-entry");
  });

  it("rejects no-hydration when effective SSR is disabled", async () => {
    const rootDir = await tempRoot();
    const config = resolveFrontendConfig(
      { enabled: true, render: { ssr: false } },
      { rootDir, mode: "production" },
    );
    const request = createRequest(
      "/article",
      {},
      {
        frontend: { hydration: "none" },
      },
    );

    expect(() => resolveDocumentPolicy({ config, req: request })).toThrow(
      /requires SSR to remain enabled/u,
    );
    expect(() =>
      resolveDocumentPolicy({
        config: { render: { ...config.render, ssr: true } },
        options: { ssr: false },
        req: request,
      }),
    ).toThrow(/requires SSR to remain enabled/u);
  });
});

describe("frontend no-hydration renderer", () => {
  it("returns a full SSR document with SEO/CSS/user scripts and no React/Vext runtime", async () => {
    const rootDir = await tempRoot();
    await createServerOnlyFrontend(rootDir);
    const frontendConfig = {
      enabled: true,
      apiClient: false,
      render: { streaming: "auto" as const },
      seo: {
        publicOrigin: "https://www.example.test/base",
        titleTemplate: "%s | Vext",
      },
    };
    await buildFrontendClient({
      rootDir,
      mode: "production",
      config: frontendConfig,
    });
    const middleware = createFrontendRenderMiddleware({
      rootDir,
      mode: "production",
      config: frontendConfig,
    });
    const request = createRequest(
      "/posts/hello",
      {
        accept: "application/vnd.vext.page+json;v=1",
        "vext-navigation": "1",
      },
      {
        frontend: {
          hydration: "none",
          seo: { description: "Server-only post" },
        },
      },
    );
    const response = createRenderResponse();

    expect(isPageEnvelopeRequest(request)).toBe(false);
    await middleware(request, response as any, async () => {});
    response.render(
      "index",
      { message: "Rendered on the server" },
      {
        seo: {
          title: "Hello",
          openGraph: { type: "article" },
        },
      },
    );

    const html = response.sent?.html ?? "";
    expect(response.rawJsonSent).toBeUndefined();
    expect(response.streamed).toBe(false);
    expect(html).toContain("Rendered on the server");
    expect(html).toContain("Hello | Vext");
    expect(html.match(/<title\b/gu)).toHaveLength(1);
    expect(html).not.toContain("Fallback title");
    expect(html).toContain('name="description" content="Server-only post"');
    expect(html).toContain(
      'rel="canonical" href="https://www.example.test/base/posts/hello"',
    );
    expect(html).toContain('property="og:type" content="article"');
    expect(html).toContain("data-vext-style");
    expect(html).toContain('src="/analytics.js" data-user-script');
    expect(html).toContain('data-vext-hydration="none"');
    expect(html).not.toContain("__VEXT_DATA__");
    expect(html).not.toContain("data-vext-entry");
    expect(html).not.toContain("data-vext-data");
    expect(html).not.toContain("data-vext-route-preload");
    expect(html).not.toContain("data-vext-external-runtime");
  });
});

describe("frontend no-hydration static output", () => {
  it("writes HTML only and keeps sitemap/deploy closure free of a data sidecar", async () => {
    const rootDir = await tempRoot();
    await createServerOnlyFrontend(rootDir);
    await writeRoutesManifest(rootDir, [
      {
        routeId: "route_static",
        method: "GET",
        path: "/static",
        operationId: "getStatic",
        freshness: {
          mode: "static",
          source: "route-options",
          page: "index",
          hydration: "none",
          seo: { title: "Static page" },
        },
      },
    ]);

    const result = await buildFrontendClient({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        apiClient: false,
        seo: {
          publicOrigin: "https://www.example.test",
          titleTemplate: "%s | Vext",
          sitemap: {},
          robots: {},
        },
      },
    });
    const staticManifest = JSON.parse(
      await readFile(result.staticManifestPath!, "utf-8"),
    ) as { artifacts: Array<Record<string, unknown>> };
    const deployManifest = JSON.parse(
      await readFile(result.deployManifestPath!, "utf-8"),
    ) as {
      assets: Array<{ file: string; contentType: string }>;
    };
    const html = await readFile(
      path.join(result.config.outDir, "static", "index.html"),
      "utf-8",
    );

    expect(staticManifest.artifacts).toHaveLength(1);
    expect(staticManifest.artifacts[0]).toMatchObject({
      routePath: "/static",
      html: "static/index.html",
    });
    expect(staticManifest.artifacts[0]).not.toHaveProperty("data");
    expect(
      existsSync(path.join(result.config.outDir, "static", "__vext.page.json")),
    ).toBe(false);
    expect(html).toContain("Server-only page");
    expect(html).toContain("Static page | Vext");
    expect(html.match(/<title\b/gu)).toHaveLength(1);
    expect(html).not.toContain("Fallback title");
    expect(html).toContain(
      'rel="canonical" href="https://www.example.test/static"',
    );
    expect(html).not.toContain("data-vext-entry");
    expect(html).not.toContain("data-vext-data");
    expect(
      await readFile(path.join(result.config.outDir, "sitemap.xml"), "utf-8"),
    ).toContain("https://www.example.test/static");
    expect(result.seoArtifactPaths).toEqual(["sitemap.xml", "robots.txt"]);

    const assets = new Map(
      deployManifest.assets.map((asset) => [asset.file, asset]),
    );
    expect(assets.has("static/__vext.page.json")).toBe(false);
    expect(assets.get("sitemap.xml")?.contentType).toBe(
      "application/xml; charset=utf-8",
    );
    expect(assets.get("robots.txt")?.contentType).toBe(
      "text/plain; charset=utf-8",
    );
  });
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vext-no-hydration-"));
  tempDirs.push(dir);
  return dir;
}

async function createServerOnlyFrontend(rootDir: string): Promise<void> {
  const frontendDir = path.join(rootDir, "src", "frontend");
  await mkdir(path.join(frontendDir, "pages", "error"), { recursive: true });
  await mkdir(path.join(frontendDir, "styles"), { recursive: true });
  await writeFile(
    path.join(frontendDir, "pages", "_document.html"),
    [
      "<!doctype html><html><head><title>Fallback title</title>{vext.styles}</head><body>",
      "{vext.root}{vext.data}{vext.entry}",
      '<script src="/analytics.js" data-user-script></script>',
      "</body></html>",
    ].join(""),
  );
  await writeFile(
    path.join(frontendDir, "pages", "index.tsx"),
    [
      "export default function Page({ message = 'Server-only page' }: { message?: string }) {",
      "  return <main data-server-only>{message}</main>;",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(frontendDir, "pages", "error", "404.tsx"),
    "export default function NotFound() { return <main>Not found</main>; }\n",
  );
  await writeFile(
    path.join(frontendDir, "styles", "index.css"),
    "main { color: #123456; }\n",
  );
}

async function writeRoutesManifest(
  rootDir: string,
  routes: Array<Record<string, unknown>>,
): Promise<void> {
  const manifestDir = path.join(rootDir, ".vext", "manifest");
  await mkdir(manifestDir, { recursive: true });
  await writeFile(
    path.join(manifestDir, "routes.json"),
    `${JSON.stringify(
      {
        routes: routes.map((route) => ({
          docsSummary: "Static",
          tags: [],
          hidden: false,
          schema: { schemaVersion: 1, request: {}, responses: [] },
          layout: { state: "unresolved", paths: [] },
          ...route,
        })),
      },
      null,
      2,
    )}\n`,
  );
}

function createRequest(
  pathname: string,
  headers: Record<string, string> = {},
  routeOptions: Record<string, unknown> = {},
) {
  return {
    method: "GET",
    path: pathname,
    url: pathname,
    route: pathname,
    headers,
    params: {},
    query: {},
    requestId: "req-no-hydration",
    auth: { isAuthenticated: false, roles: [], scopes: [], claims: {} },
    _routeOptions: routeOptions,
  } as any;
}

function createRenderResponse() {
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    sent: undefined as
      | { html: string; status: number; headers: Record<string, string> }
      | undefined,
    rawJsonSent: undefined as unknown,
    streamed: false,
    _onSend() {},
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    redirect() {},
    rawJson(data: unknown) {
      this.rawJsonSent = data;
    },
    stream() {
      this.streamed = true;
    },
    _sendHtml(html: string, status: number, headers: Record<string, string>) {
      this.sent = { html, status, headers };
    },
  };
  return response as typeof response & {
    render: (
      page: string,
      props?: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => void;
  };
}
