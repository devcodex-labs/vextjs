import {
  mkdtemp,
  rm,
  writeFile,
  mkdir,
  readFile,
  readdir,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { resolveFrontendConfig } from "../../src/frontend/tooling/config-resolver.js";
import {
  buildClientContract,
  writeClientContractFromRouteManifest,
} from "../../src/frontend/tooling/client-contract-writer.js";
import { buildFrontendClient } from "../../src/frontend/tooling/client-build-compiler.js";
import { createFrontendRenderMiddleware } from "../../src/frontend/runtime/renderer.js";
import { createFrontendDevEventBus } from "../../src/frontend/runtime/dev-events.js";
import {
  VextApiError,
  createVextApiClient,
  deployFrontendAssets,
  isVextApiError,
} from "../../src/frontend/index.js";
import { createFrontendNotFoundHandler } from "../../src/frontend/runtime/static-mount.js";

const tempDirs: string[] = [];
const pendingStreams: Promise<void>[] = [];

afterEach(async () => {
  await Promise.allSettled(pendingStreams.splice(0));
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("frontend config resolver", () => {
  it("defaults to disabled frontend", async () => {
    const rootDir = await tempRoot();
    const config = resolveFrontendConfig(undefined, {
      rootDir,
      mode: "production",
    });

    expect(config.enabled).toBe(false);
    expect(config.framework).toBe("react");
    expect(config.root).toBe(path.join(rootDir, "src", "frontend"));
    expect(config.entry).toBe(
      path.join(rootDir, ".vext", "generated", "frontend", "browser-entry.tsx"),
    );
    expect(config.pages.dir).toBe(
      path.join(rootDir, "src", "frontend", "pages"),
    );
    expect(config.styles.jscss.enabled).toBe(true);
    expect(config.styles.jscss.files).toEqual([
      "**/*.style.ts",
      "**/*.style.js",
      "**/*.css.ts",
    ]);
    expect(config.styles.jscss.dynamicVars).toBe(true);
    expect(config.styles.jscss.recipes).toBe(true);
    expect(config.publicPath).toBe("/");
    expect(config.build.vendorChunks.enabled).toBe(true);
    expect(config.build.budgets.maxInitialJsGzipBytes).toBe(0);
    expect(config.build.budgets.maxInitialJsBrotliBytes).toBe(0);
    expect(config.build.budgets.maxRouteInitialJsBrotliBytes).toBe(0);
    expect(config.build.budgets.maxAppOwnedInitialJsBrotliBytes).toBe(0);
    expect(config.build.diagnostics.performanceReport).toBe(true);
    expect(config.i18n.clientLoad).toBe("current");
    expect(config.deploy.upload.enabled).toBe(false);
    expect(config.deploy.upload.exclude).toEqual(["**/*.map"]);
  });

  it("normalizes enabled frontend paths inside project root", async () => {
    const rootDir = await tempRoot();
    const config = resolveFrontendConfig(true, {
      rootDir,
      mode: "development",
    });

    expect(config.enabled).toBe(true);
    expect(config.outDir).toBe(path.join(rootDir, ".vext", "client"));
    expect(config.spaFallback.exclude).toEqual([
      "/api/**",
      "/openapi.json",
      "/docs/**",
      "/_vext/docs/**",
    ]);
    expect(config.spaFallback.scopes).toEqual([]);
    expect(config.dev.fastRefresh).toBe(true);
    expect(config.build.diagnostics.leakScan).toBe(true);
  });

  it("normalizes B1 frontend page, alias, i18n, and scoped fallback config", async () => {
    const rootDir = await tempRoot();
    const config = resolveFrontendConfig(
      {
        enabled: true,
        pages: { dir: "pages", document: "pages/_document.html" },
        alias: { "@features": "features" },
        i18n: {
          enabled: true,
          defaultLocale: "zh-CN",
          clientLoad: "all",
        },
        build: {
          client: {
            external: ["react"],
            externalRuntime: {
              react: "https://cdn.example.com/react.mjs",
            },
          },
          budgets: {
            maxTotalBytes: 1_000_000,
            maxInitialJsGzipBytes: 120_000,
            maxInitialJsBrotliBytes: 100_000,
            maxRouteInitialJsBrotliBytes: 80_000,
            maxAppOwnedInitialJsBrotliBytes: 70_000,
          },
          diagnostics: {
            performanceReport: false,
          },
        },
        deploy: {
          assetBaseUrl: "https://cdn.example.com/app",
          upload: {
            enabled: true,
            targetDir: ".deploy/cdn",
            prefix: "v1",
          },
        },
        spaFallback: {
          scopes: [{ basePath: "/admin/app", page: "admin/app/shell" }],
        },
      },
      { rootDir, mode: "production" },
    );

    expect(config.pages.document).toBe(
      path.join(rootDir, "src", "frontend", "pages", "_document.html"),
    );
    expect(config.alias["@components"]).toBe(
      path.join(rootDir, "src", "frontend", "components"),
    );
    expect(config.alias["@features"]).toBe(
      path.join(rootDir, "src", "frontend", "features"),
    );
    expect(config.i18n.enabled).toBe(true);
    expect(config.i18n.defaultLocale).toBe("zh-CN");
    expect(config.i18n.clientLoad).toBe("all");
    expect(config.build.budgets.maxInitialJsGzipBytes).toBe(120_000);
    expect(config.build.budgets.maxInitialJsBrotliBytes).toBe(100_000);
    expect(config.build.budgets.maxRouteInitialJsBrotliBytes).toBe(80_000);
    expect(config.build.budgets.maxAppOwnedInitialJsBrotliBytes).toBe(70_000);
    expect(config.build.diagnostics.performanceReport).toBe(false);
    expect(config.deploy.assetBaseUrl).toBe("https://cdn.example.com/app/");
    expect(config.build.client.externalRuntime.react.url).toBe(
      "https://cdn.example.com/react.mjs",
    );
    expect(config.deploy.upload.enabled).toBe(true);
    expect(config.deploy.upload.prefix).toBe("v1");
    expect(config.spaFallback.scopes[0]).toMatchObject({
      basePath: "/admin/app/",
      page: "admin/app/shell",
      ssr: false,
      status: 200,
    });
  });

  it("rejects paths outside project root", async () => {
    const rootDir = await tempRoot();

    expect(() =>
      resolveFrontendConfig(
        { enabled: true, outDir: "../outside" },
        { rootDir, mode: "production" },
      ),
    ).toThrow("config.frontend.outDir");
  });

  it("rejects invalid i18n clientLoad values", async () => {
    const rootDir = await tempRoot();

    expect(() =>
      resolveFrontendConfig(
        {
          enabled: true,
          i18n: { clientLoad: "lazy" as any },
        },
        { rootDir, mode: "production" },
      ),
    ).toThrow('config.frontend.i18n.clientLoad must be "current" or "all"');
  });
});

describe("frontend dev event bus", () => {
  it("serves Vext development events over SSE", async () => {
    const bus = createFrontendDevEventBus();
    let closeHandler: (() => void) | undefined;
    const chunks: string[] = [];
    const res = {
      headers: {} as Record<string, string>,
      streamType: "",
      setHeader(name: string, value: string) {
        this.headers[name] = value;
        return this;
      },
      stream(readable: NodeJS.ReadableStream, contentType: string) {
        this.streamType = contentType;
        readable.on("data", (chunk) => {
          chunks.push(Buffer.from(chunk).toString("utf-8"));
        });
      },
    };

    await bus.middleware(
      {
        method: "GET",
        path: "/__vext/dev/events",
        onClose(handler: () => void) {
          closeHandler = handler;
        },
      } as any,
      res as any,
      async () => {
        throw new Error("next should not be called for dev SSE endpoint");
      },
    );

    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(res.headers.Connection).toBe("keep-alive");
    expect(res.streamType).toBe("text/event-stream; charset=utf-8");
    expect(bus.getClientCount()).toBe(1);

    bus.publish({
      type: "frontend:built",
      action: "fast-refresh",
      entry: "/assets/browser-entry.js",
      styles: ["/assets/browser-entry.css"],
      buildId: "dev-build",
    });
    await Promise.resolve();

    const frame = chunks.join("");
    expect(frame).toContain("retry: 500");
    expect(frame).toContain("event: vext");
    expect(frame).toContain('"type":"frontend:built"');
    expect(frame).toContain('"action":"fast-refresh"');

    closeHandler?.();
    expect(bus.getClientCount()).toBe(0);
    bus.close();
  });

  it("passes non-SSE requests to the next middleware", async () => {
    const bus = createFrontendDevEventBus();
    let nextCalled = false;

    await bus.middleware(
      { method: "GET", path: "/health" } as any,
      {} as any,
      async () => {
        nextCalled = true;
      },
    );

    expect(nextCalled).toBe(true);
    expect(bus.getClientCount()).toBe(0);
    bus.close();
  });
});

describe("frontend client contract", () => {
  it("builds a public client contract from route manifest records", () => {
    const contract = buildClientContract({
      routes: [
        {
          method: "GET",
          path: "/api/hello",
          operationId: "getApiHello",
          docsSummary: "Hello",
          tags: ["example"],
        },
        {
          method: "GET",
          path: "/internal",
          operationId: "getInternal",
          hidden: true,
        },
      ],
    });

    expect(contract.kind).toBe("client-contract");
    expect(contract.routes).toHaveLength(1);
    expect(contract.routes[0]?.path).toBe("/api/hello");
  });

  it("keeps every supported route method in the public client contract", () => {
    const methods = [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
    ] as const;
    const contract = buildClientContract({
      routes: methods.map((method) => ({
        method,
        path: `/api/${method.toLowerCase()}`,
        operationId: `${method.toLowerCase()}Api`,
      })),
    });

    expect(contract.routes.map((route) => route.method)).toEqual(methods);
  });

  it("writes byte-stable client contract artifacts for identical route manifests", async () => {
    const rootDir = await tempRoot();
    const manifestDir = path.join(rootDir, ".vext", "manifest");
    const outDir = path.join(rootDir, ".vext", "client");
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      path.join(manifestDir, "routes.json"),
      JSON.stringify(
        {
          routes: [
            {
              method: "GET",
              path: "/api/stable",
              operationId: "getApiStable",
              docsSummary: "Stable",
              tags: ["contract"],
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    await writeClientContractFromRouteManifest({ rootDir, outDir });
    const firstContract = await readFile(
      path.join(outDir, "client-contract.json"),
      "utf-8",
    );
    const firstModule = await readFile(
      path.join(outDir, "api.generated.ts"),
      "utf-8",
    );

    await writeClientContractFromRouteManifest({ rootDir, outDir });

    expect(
      await readFile(path.join(outDir, "client-contract.json"), "utf-8"),
    ).toBe(firstContract);
    expect(await readFile(path.join(outDir, "api.generated.ts"), "utf-8")).toBe(
      firstModule,
    );
    expect(JSON.parse(firstContract).generatedAt).toBe(
      "1970-01-01T00:00:00.000Z",
    );
  });

  it("keeps frontend API client docs aligned with public exports", async () => {
    const docs = await Promise.all([
      readFile(
        path.join(
          process.cwd(),
          "website",
          "docs",
          "en",
          "frontend",
          "api-client-and-contracts.md",
        ),
        "utf-8",
      ),
      readFile(
        path.join(
          process.cwd(),
          "website",
          "docs",
          "zh",
          "frontend",
          "api-client-and-contracts.md",
        ),
        "utf-8",
      ),
    ]);

    for (const content of docs) {
      expect(content).toContain("createVextApiClient");
      expect(content).not.toContain("createVextFetchAdapter");
    }
    expect(docs[0]).toContain(
      "Contract schema references are currently emitted as `unknown`",
    );
    expect(docs[1]).toContain("契约 schema reference 当前会输出为 `unknown`");
  });
});

describe("frontend client build", () => {
  it("injects bundled CSS and entry script into index.html", async () => {
    const rootDir = await tempRoot();
    const clientDir = path.join(rootDir, "src", "frontend", "entry");
    await mkdir(clientDir, { recursive: true });
    await writeFile(
      path.join(clientDir, "main.js"),
      'import "./styles.css";\ndocument.body.dataset.ready = "1";\n',
    );
    await writeFile(
      path.join(clientDir, "styles.css"),
      "body { color: red; }\n",
    );
    await writeFile(
      path.join(clientDir, "index.html"),
      '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
    );

    const result = await buildFrontendClient({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        entry: "src/frontend/entry/main.js",
        indexHtml: "src/frontend/entry/index.html",
        apiClient: false,
      },
    });

    const html = await readFile(
      path.join(result.config.outDir, "index.html"),
      "utf-8",
    );
    expect(html).toMatch(
      /<link rel="stylesheet" href="\/assets\/main-[^"]+\.css" data-vext-style>/,
    );
    expect(html).toMatch(
      /<script type="module" src="\/assets\/main-[^"]+\.js" data-vext-entry><\/script>/,
    );
    expect(result.renderManifestPath).toBeDefined();
    expect(result.deployManifestPath).toBeDefined();
    expect(result.messagesManifestPath).toBeDefined();
    expect(result.serverRendererPath).toBeDefined();
  });

  it("writes deploy manifest, injects SRI, and uploads only changed assets", async () => {
    const rootDir = await tempRoot();
    await createMinimalFrontend(rootDir);
    await mkdir(path.join(rootDir, "public", "static"), { recursive: true });
    await writeFile(
      path.join(rootDir, "public", "static", "logo.txt"),
      "logo-v1",
    );

    const result = await buildFrontendClient({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        apiClient: false,
        deploy: {
          integrity: true,
          upload: {
            enabled: true,
            targetDir: ".deploy/cdn",
            publicBaseUrl: "https://cdn.example.com/app/",
            prefix: "app/v1",
          },
        },
      },
    });
    const html = await readFile(
      path.join(result.config.outDir, "index.html"),
      "utf-8",
    );
    const deployManifest = JSON.parse(
      await readFile(result.deployManifestPath!, "utf-8"),
    );

    expect(html).toContain('integrity="sha256-');
    expect(deployManifest.kind).toBe("frontend-deploy-manifest");
    expect(
      deployManifest.assets.some((asset: any) => asset.file === "index.html"),
    ).toBe(false);
    expect(
      deployManifest.assets.some(
        (asset: any) =>
          asset.file === "static/logo.txt" &&
          asset.uploadKey === "app/v1/static/logo.txt",
      ),
    ).toBe(true);

    const firstUpload = await deployFrontendAssets({
      config: result.config,
      manifestPath: result.deployManifestPath!,
    });
    expect(firstUpload.uploaded).toBeGreaterThan(0);
    expect(
      existsSync(
        path.join(rootDir, ".deploy", "cdn", "app", "v1", "static", "logo.txt"),
      ),
    ).toBe(true);

    const secondUpload = await deployFrontendAssets({
      config: result.config,
      manifestPath: result.deployManifestPath!,
    });
    expect(secondUpload.uploaded).toBe(0);
    expect(secondUpload.skipped).toBe(deployManifest.assets.length);
  });

  it("renders an import map for configured browser external runtime modules", async () => {
    const rootDir = await tempRoot();
    await createMinimalFrontend(rootDir);

    const result = await buildFrontendClient({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        apiClient: false,
        build: {
          client: {
            external: ["react"],
            externalRuntime: {
              react: "https://cdn.example.com/react.mjs",
            },
          },
        },
      },
    });
    const html = await readFile(
      path.join(result.config.outDir, "index.html"),
      "utf-8",
    );

    expect(html).toContain('<script type="importmap">');
    expect(html).toContain('"react":"https://cdn.example.com/react.mjs"');
  });

  it("fails fast when browser React externals are missing runtime mappings", async () => {
    const rootDir = await tempRoot();
    await createMinimalFrontend(rootDir);

    await expect(
      buildFrontendClient({
        rootDir,
        mode: "production",
        config: {
          enabled: true,
          apiClient: false,
          build: {
            client: {
              external: ["react"],
            },
          },
        },
      }),
    ).rejects.toThrow(
      "frontend browser external runtime mapping is incomplete",
    );
  });

  it("generates page, layout, error, i18n, and render manifests", async () => {
    const rootDir = await tempRoot();
    const frontendDir = path.join(rootDir, "src", "frontend");
    await mkdir(path.join(frontendDir, "pages", "admin"), {
      recursive: true,
    });
    await mkdir(path.join(frontendDir, "pages", "error"), {
      recursive: true,
    });
    await mkdir(path.join(frontendDir, "styles"), { recursive: true });
    await mkdir(path.join(frontendDir, "locales"), { recursive: true });
    await writeFile(
      path.join(frontendDir, "pages", "_document.html"),
      "<!doctype html><html><head>{vext.styles}</head><body>{vext.root}{vext.data}{vext.entry}</body></html>",
    );
    await writeFile(
      path.join(frontendDir, "pages", "index.tsx"),
      "export default function Page() { return null; }\n",
    );
    await writeFile(
      path.join(frontendDir, "pages", "admin", "layout.tsx"),
      "export default function Layout(props) { return props.children; }\n",
    );
    await writeFile(
      path.join(frontendDir, "pages", "admin", "index.tsx"),
      "export default function Admin() { return null; }\n",
    );
    await writeFile(
      path.join(frontendDir, "pages", "error", "default.tsx"),
      "export default function ErrorPage() { return null; }\n",
    );
    await writeFile(
      path.join(frontendDir, "locales", "en-US.ts"),
      "export default { title: 'Hello' };\n",
    );
    await writeFile(
      path.join(frontendDir, "styles", "index.css"),
      ":root { color-scheme: light; }\n",
    );

    const result = await buildFrontendClient({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        apiClient: false,
        i18n: { enabled: true, defaultLocale: "en-US" },
      },
    });

    const renderManifest = JSON.parse(
      await readFile(result.renderManifestPath!, "utf-8"),
    );
    const messagesManifest = JSON.parse(
      await readFile(result.messagesManifestPath!, "utf-8"),
    );
    const generatedRegistry = await readFile(
      path.join(result.generatedDir!, "page-registry.ts"),
      "utf-8",
    );
    const html = await readFile(
      path.join(result.config.outDir, "index.html"),
      "utf-8",
    );

    expect(renderManifest.kind).toBe("frontend-render-manifest");
    expect(renderManifest.pages.map((page: any) => page.id)).toEqual([
      "admin/index",
      "index",
    ]);
    expect(renderManifest.layouts[0]).toMatchObject({
      id: "admin",
      directory: "admin",
    });
    expect(renderManifest.errorPages[0]).toMatchObject({
      id: "error/default",
    });
    expect(renderManifest.serverRenderer).toBe("server/renderer.cjs");
    expect(renderManifest.routeAssets.schemaVersion).toBe(1);
    expect(
      renderManifest.routeAssets.routes.map((route: any) => route.page),
    ).toContain("admin/index");
    expect(
      renderManifest.routeAssets.routes.find(
        (route: any) => route.page === "admin/index",
      )?.initialJsBrotliBytes,
    ).toBeGreaterThan(0);
    expect(messagesManifest.locales[0]).toMatchObject({ locale: "en-US" });
    expect(generatedRegistry).toContain("export const pages");
    expect(html).toContain('id="__VEXT_DATA__"');
    expect(html).toContain("data-vext-root");
    expect(html).not.toContain("%VEXT");
    expect(html).not.toContain("{vext.");
  });

  it("generates i18n clientLoad mode and hydration telemetry in the browser entry", async () => {
    const currentRootDir = await tempRoot();
    await createMinimalFrontend(currentRootDir);
    await mkdir(path.join(currentRootDir, "src", "frontend", "locales"), {
      recursive: true,
    });
    await writeFile(
      path.join(currentRootDir, "src", "frontend", "locales", "en-US.ts"),
      "export default { title: 'Hello' };\n",
    );
    await writeFile(
      path.join(currentRootDir, "src", "frontend", "locales", "zh-CN.ts"),
      "export default { title: '你好' };\n",
    );

    const currentResult = await buildFrontendClient({
      rootDir: currentRootDir,
      mode: "production",
      config: {
        enabled: true,
        apiClient: false,
        i18n: { enabled: true, defaultLocale: "en-US" },
      },
    });
    const currentEntry = await readFile(
      path.join(currentResult.generatedDir!, "browser-entry.tsx"),
      "utf-8",
    );

    expect(currentEntry).toContain('const clientLoad = "current";');
    expect(currentEntry).toContain("markVextHydrationStart(root)");
    expect(currentEntry).toContain('root.dataset.vextHydration = "done"');
    expect(currentEntry).toContain("performance.measure(name, start, end)");

    const allRootDir = await tempRoot();
    await createMinimalFrontend(allRootDir);
    await mkdir(path.join(allRootDir, "src", "frontend", "locales"), {
      recursive: true,
    });
    await writeFile(
      path.join(allRootDir, "src", "frontend", "locales", "en-US.ts"),
      "export default { title: 'Hello' };\n",
    );
    await writeFile(
      path.join(allRootDir, "src", "frontend", "locales", "zh-CN.ts"),
      "export default { title: 'Ni hao' };\n",
    );

    const allResult = await buildFrontendClient({
      rootDir: allRootDir,
      mode: "production",
      config: {
        enabled: true,
        apiClient: false,
        i18n: {
          enabled: true,
          defaultLocale: "en-US",
          clientLoad: "all",
        },
      },
    });
    const allEntry = await readFile(
      path.join(allResult.generatedDir!, "browser-entry.tsx"),
      "utf-8",
    );

    expect(allEntry).toContain('const clientLoad = "all";');
  });

  it("extracts Vext JSCSS modules into the bundled CSS asset", async () => {
    const rootDir = await tempRoot();
    const frontendDir = path.join(rootDir, "src", "frontend");
    await mkdir(path.join(frontendDir, "pages"), { recursive: true });
    await mkdir(path.join(frontendDir, "styles"), { recursive: true });
    await writeFile(
      path.join(frontendDir, "pages", "_document.html"),
      "<!doctype html><html><head>{vext.styles}</head><body>{vext.root}{vext.data}{vext.entry}</body></html>",
    );
    await writeFile(
      path.join(frontendDir, "styles", "card.style.ts"),
      [
        'import { createVar, recipe, setVar, style, vars } from "vextjs/style";',
        'export const accent = createVar("accent", "#0f766e");',
        "export const card = style({",
        "  color: accent,",
        "  padding: 12,",
        "  opacity: 0.9,",
        '  "&:hover": { color: "tomato" },',
        '  "@media (min-width: 640px)": { padding: 16 },',
        '}, "card");',
        "export const action = recipe({",
        '  name: "action",',
        "  base: { borderRadius: 6 },",
        "  variants: {",
        "    tone: {",
        '      primary: { backgroundColor: "black", color: "white" },',
        "    },",
        "  },",
        '  defaultVariants: { tone: "primary" },',
        "});",
        'export const accentStyle = vars(setVar(accent, "#123456"));',
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(frontendDir, "pages", "index.tsx"),
      [
        'import { action, card } from "../styles/card.style";',
        "export default function Page() {",
        "  return <main className={`${card} ${action()}`}>JSCSS</main>;",
        "}",
        "",
      ].join("\n"),
    );

    const result = await buildFrontendClient({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        apiClient: false,
      },
    });

    const generatedCss = await readFile(
      path.join(result.generatedDir!, "vext-jscss.css"),
      "utf-8",
    );
    const browserEntry = await readFile(
      path.join(result.generatedDir!, "browser-entry.tsx"),
      "utf-8",
    );
    const manifest = JSON.parse(await readFile(result.manifestPath!, "utf-8"));
    const cssAssetPath = manifest.assets.find((asset: any) =>
      asset.path.endsWith(".css"),
    )?.path;
    expect(cssAssetPath).toBeDefined();
    const cssAsset = String(cssAssetPath).replace(/^\/+/, "");
    const bundledCss = await readFile(
      path.join(result.config.outDir, cssAsset),
      "utf-8",
    );

    expect(browserEntry).toContain("vext-jscss.css");
    expect(generatedCss).toContain(".vext-card-");
    expect(generatedCss).toContain("color:var(--vext-accent, #0f766e)");
    expect(generatedCss).toContain("padding:12px");
    expect(generatedCss).toContain("@media (min-width: 640px)");
    expect(bundledCss).toContain(".vext-card-");
    expect(bundledCss).toContain(".vext-action-tone-primary-");
  });

  it("honors the frontend size report diagnostics flag", async () => {
    const rootDir = await tempRoot();
    await createMinimalFrontend(rootDir);

    const defaultResult = await buildFrontendClient({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        apiClient: false,
      },
    });

    expect(
      existsSync(path.join(defaultResult.config.outDir, "size-report.json")),
    ).toBe(true);
    const sizeReport = JSON.parse(
      await readFile(
        path.join(defaultResult.config.outDir, "size-report.json"),
        "utf-8",
      ),
    );
    expect(sizeReport.kind).toBe("frontend-size-report");
    expect(sizeReport.totalBytes).toBeGreaterThan(0);
    expect(sizeReport.totalGzipBytes).toBeGreaterThan(0);
    expect(sizeReport.totalBrotliBytes).toBeGreaterThan(0);
    expect(sizeReport.initialJsBrotliBytes).toBeGreaterThan(0);
    expect(sizeReport.appOwnedInitialJsBrotliBytes).toBeGreaterThan(0);
    expect(sizeReport.assets[0]).toHaveProperty("gzipBytes");
    expect(sizeReport.assets[0]).toHaveProperty("brotliBytes");

    const disabledRootDir = await tempRoot();
    await createMinimalFrontend(disabledRootDir);

    const disabledResult = await buildFrontendClient({
      rootDir: disabledRootDir,
      mode: "production",
      config: {
        enabled: true,
        apiClient: false,
        build: {
          diagnostics: {
            sizeReport: false,
          },
        },
      },
    });

    expect(
      existsSync(path.join(disabledResult.config.outDir, "size-report.json")),
    ).toBe(false);
  });

  it("fails with a friendly error when compressed frontend budgets are exceeded", async () => {
    const rootDir = await tempRoot();
    await createMinimalFrontend(rootDir);

    await expect(
      buildFrontendClient({
        rootDir,
        mode: "production",
        config: {
          enabled: true,
          apiClient: false,
          build: {
            budgets: {
              maxInitialJsBrotliBytes: 1,
            },
          },
        },
      }),
    ).rejects.toThrow("maxInitialJsBrotliBytes");
  });

  it("injects React Fast Refresh only into development browser builds", async () => {
    const rootDir = await tempRoot();
    await createMinimalFrontend(rootDir);

    const devResult = await buildFrontendClient({
      rootDir,
      mode: "development",
      config: {
        enabled: true,
        apiClient: false,
      },
    });
    const devBrowserEntry = await readFile(
      path.join(devResult.generatedDir!, "browser-entry.tsx"),
      "utf-8",
    );
    const devBundle = (
      await readTextFiles(devResult.config.outDir, ".js")
    ).join("\n");

    expect(devBrowserEntry).toContain("react-refresh/runtime");
    expect(devBrowserEntry).toContain('EventSource("/__vext/dev/events")');
    expect(devBrowserEntry).toContain("performReactRefresh");
    expect(devBundle).toContain("src/frontend/pages/index.tsx Page");

    const productionResult = await buildFrontendClient({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        apiClient: false,
      },
    });
    const productionBrowserEntry = await readFile(
      path.join(productionResult.generatedDir!, "browser-entry.tsx"),
      "utf-8",
    );
    const productionBundle = (
      await readTextFiles(productionResult.config.outDir, ".js")
    ).join("\n");

    expect(productionBrowserEntry).not.toContain("react-refresh/runtime");
    expect(productionBundle).not.toContain("react-refresh");

    const disabledResult = await buildFrontendClient({
      rootDir,
      mode: "development",
      config: {
        enabled: true,
        apiClient: false,
        dev: { fastRefresh: false },
      },
    });
    const disabledBrowserEntry = await readFile(
      path.join(disabledResult.generatedDir!, "browser-entry.tsx"),
      "utf-8",
    );
    const disabledBundle = (
      await readTextFiles(disabledResult.config.outDir, ".js")
    ).join("\n");

    expect(disabledBrowserEntry).toContain('EventSource("/__vext/dev/events")');
    expect(disabledBrowserEntry).not.toContain("react-refresh/runtime");
    expect(disabledBundle).not.toContain("react-refresh");

    const hotOffResult = await buildFrontendClient({
      rootDir,
      mode: "development",
      config: {
        enabled: true,
        apiClient: false,
        dev: { hot: false },
      },
    });
    const hotOffBrowserEntry = await readFile(
      path.join(hotOffResult.generatedDir!, "browser-entry.tsx"),
      "utf-8",
    );

    expect(hotOffBrowserEntry).not.toContain(
      'EventSource("/__vext/dev/events")',
    );
    expect(hotOffBrowserEntry).not.toContain("react-refresh/runtime");
  }, 30_000);

  it("explains browser boundary leaks before esbuild reports low-level errors", async () => {
    const rootDir = await tempRoot();
    await mkdir(path.join(rootDir, "src", "frontend", "entry"), {
      recursive: true,
    });
    await mkdir(path.join(rootDir, "src", "services"), { recursive: true });
    await writeFile(
      path.join(rootDir, "src", "frontend", "entry", "main.js"),
      'import { db } from "../../services/db.js";\nconsole.log(db);\n',
    );
    await writeFile(
      path.join(rootDir, "src", "services", "db.js"),
      "export const db = {};\n",
    );

    await expect(
      buildFrontendClient({
        rootDir,
        mode: "production",
        config: {
          enabled: true,
          entry: "src/frontend/entry/main.js",
          apiClient: false,
        },
      }),
    ).rejects.toThrow("你跨越了前后端物理边界");
  });

  it("explains server imports written inside generated page sources", async () => {
    const rootDir = await tempRoot();
    await mkdir(path.join(rootDir, "src", "frontend", "pages"), {
      recursive: true,
    });
    await mkdir(path.join(rootDir, "src", "services"), { recursive: true });
    await writeFile(
      path.join(rootDir, "src", "frontend", "pages", "index.tsx"),
      'import { db } from "../../services/db.js";\nexport default function Page() { return db; }\n',
    );
    await writeFile(
      path.join(rootDir, "src", "services", "db.js"),
      "export const db = {};\n",
    );

    await expect(
      buildFrontendClient({
        rootDir,
        mode: "production",
        config: {
          enabled: true,
          apiClient: false,
        },
      }),
    ).rejects.toThrow("src/frontend/pages/index.tsx");
  });
});

describe("frontend render middleware", () => {
  it("binds res.render() to built frontend output", async () => {
    const rootDir = await tempRoot();
    await createMinimalFrontend(rootDir);
    await buildFrontendClient({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        apiClient: false,
      },
    });

    const middleware = createFrontendRenderMiddleware({
      rootDir,
      mode: "production",
      config: { enabled: true },
    });
    const res = createRenderMockResponse();

    await middleware(createMockRequest("/dashboard"), res, async () => {});
    res.render(
      "index",
      { title: "<Dashboard>" },
      {
        status: 202,
        headers: { "X-Render": "yes" },
        nonce: "abc123",
        head: { title: "Dashboard", meta: { robots: "noindex" } },
      },
    );

    expect(res.sent?.status).toBe(202);
    expect(res.sent?.headers["X-Render"]).toBe("yes");
    expect(res.sent?.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(res.sent?.kind).toBe("render");
    expect(res.sent?.html).toContain("<title>Dashboard</title>");
    expect(res.sent?.html).toContain('rel="modulepreload"');
    expect(res.sent?.html).toContain("data-vext-route-preload");
    expect(res.sent?.html).toContain('data-vext-entry nonce="abc123"');
    expect(res.sent?.html).toContain('data-vext-data nonce="abc123"');
    expect(res.sent?.html).toContain('data-vext-page="index"');
    expect(res.sent?.html).toContain('"page":"index"');
    expect(res.sent?.html).toContain("\\u003cDashboard\\u003e");
    expect(res.onSendPayload?.__vextResponseKind).toBe("render");
    expect(res.onSendPayload?.payload.page).toBe("index");
  });

  it("binds res.renderError() to configured error pages", async () => {
    const rootDir = await tempRoot();
    await createMinimalFrontend(rootDir);
    await buildFrontendClient({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        apiClient: false,
      },
    });

    const middleware = createFrontendRenderMiddleware({
      rootDir,
      mode: "production",
      config: { enabled: true },
    });
    const res = createRenderMockResponse();

    await middleware(createMockRequest("/missing"), res as any, async () => {});
    res.renderError(404);

    expect(res.sent?.status).toBe(404);
    expect(res.sent?.html).toContain('data-vext-page="error/404"');
    expect(res.onSendPayload?.__vextResponseKind).toBe("render");
    expect(res.onSendPayload?.payload.page).toBe("error/404");
  });

  it("falls back when custom renderError page is missing and preserves details", async () => {
    const rootDir = await tempRoot();
    await createMinimalFrontend(rootDir);
    await buildFrontendClient({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        apiClient: false,
      },
    });

    const middleware = createFrontendRenderMiddleware({
      rootDir,
      mode: "production",
      config: { enabled: true },
    });
    const res = createRenderMockResponse();

    await middleware(createMockRequest("/missing"), res as any, async () => {});
    res.renderError(404, { resource: "user" }, { page: "error/custom-404" });

    const payload = res.sent?.data as any;
    expect(res.sent?.status).toBe(404);
    expect(res.sent?.html).toContain('data-vext-page="error/404"');
    expect(payload.props.error.details).toEqual({ resource: "user" });
  });

  it("renders React page with nested layout and useVextI18n()", async () => {
    const rootDir = await tempRoot();
    const frontendDir = path.join(rootDir, "src", "frontend");
    await mkdir(path.join(frontendDir, "pages", "admin"), {
      recursive: true,
    });
    await mkdir(path.join(frontendDir, "locales"), { recursive: true });
    await writeFile(
      path.join(frontendDir, "pages", "_document.html"),
      "<!doctype html><html><head>{vext.styles}</head><body>{vext.root}{vext.data}{vext.entry}</body></html>",
    );
    await writeFile(
      path.join(frontendDir, "pages", "admin", "layout.tsx"),
      'export default function AdminLayout(props) { return <section data-layout="admin"><nav>{props.data?.menu}</nav>{props.children}</section>; }\n',
    );
    await writeFile(
      path.join(frontendDir, "pages", "admin", "index.tsx"),
      'import { useVextI18n } from "vextjs/frontend";\nexport default function AdminPage(props) { const i18n = useVextI18n(); return <main><h1>{i18n.title}</h1><span>{props.stats.users}</span></main>; }\n',
    );
    await writeFile(
      path.join(frontendDir, "locales", "en-US.ts"),
      "export default { title: 'Admin Home' };\n",
    );
    await buildFrontendClient({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        apiClient: false,
        i18n: { enabled: true, defaultLocale: "en-US" },
      },
    });

    const middleware = createFrontendRenderMiddleware({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        i18n: { enabled: true, defaultLocale: "en-US" },
      },
    });
    const res = createRenderMockResponse();

    await middleware(createMockRequest("/admin"), res as any, async () => {});
    res.render(
      "admin/index",
      { stats: { users: 7 } },
      { layoutData: { admin: { menu: "Overview" } }, locale: "en-US" },
    );

    expect(res.sent?.html).toContain('data-layout="admin"');
    expect(res.sent?.html).toContain("<h1>Admin Home</h1>");
    expect(res.sent?.html).toContain("<span>7</span>");
    expect(res.sent?.html).toContain("<nav>Overview</nav>");
  });

  it("renders a client shell without server body when ssr is false", async () => {
    const rootDir = await tempRoot();
    await createMinimalFrontend(rootDir);
    await writeFile(
      path.join(rootDir, "src", "frontend", "pages", "index.tsx"),
      'export default function Page() { return <main data-ssr-body="yes">Server body</main>; }\n',
    );
    await buildFrontendClient({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        apiClient: false,
      },
    });

    const middleware = createFrontendRenderMiddleware({
      rootDir,
      mode: "production",
      config: { enabled: true },
    });
    const res = createRenderMockResponse();

    await middleware(
      createMockRequest("/client-only"),
      res as any,
      async () => {},
    );
    res.render("index", {}, { ssr: false });

    expect(res.sent?.html).toContain(
      '<div id="root" data-vext-root data-vext-page="index"></div>',
    );
    expect(res.sent?.html).not.toContain("data-ssr-body");
    expect(res.sent?.html).not.toContain("Server body");
    expect(res.onSendPayload?.payload.options.ssr).toBe(false);
  });

  it("honors global render.ssr=false for client shell rendering", async () => {
    const rootDir = await tempRoot();
    await createMinimalFrontend(rootDir);
    await writeFile(
      path.join(rootDir, "src", "frontend", "pages", "index.tsx"),
      'export default function Page() { return <main data-global-ssr="yes">Global SSR body</main>; }\n',
    );
    await buildFrontendClient({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        apiClient: false,
      },
    });

    const middleware = createFrontendRenderMiddleware({
      rootDir,
      mode: "production",
      config: { enabled: true, render: { ssr: false } },
    });
    const res = createRenderMockResponse();

    await middleware(
      createMockRequest("/global-csr"),
      res as any,
      async () => {},
    );
    res.render("index");

    expect(res.sent?.html).toContain(
      '<div id="root" data-vext-root data-vext-page="index"></div>',
    );
    expect(res.sent?.html).not.toContain("data-global-ssr");
    expect(res.sent?.html).not.toContain("Global SSR body");
  });

  it("falls back to a client shell when SSR exceeds render.timeoutMs", async () => {
    const rootDir = await tempRoot();
    await createMinimalFrontend(rootDir);
    await writeFile(
      path.join(rootDir, "src", "frontend", "pages", "index.tsx"),
      'export default function Page() { const started = Date.now(); while (Date.now() - started < 20) {} return <main data-slow-ssr="yes">Slow SSR body</main>; }\n',
    );
    await buildFrontendClient({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        apiClient: false,
      },
    });

    const middleware = createFrontendRenderMiddleware({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        render: { timeoutMs: 1, fallback: "client" },
      },
    });
    const res = createRenderMockResponse();

    await middleware(createMockRequest("/slow"), res as any, async () => {});
    res.render("index");

    expect(res.sent?.html).toContain('data-vext-page="index"');
    expect(res.sent?.html).not.toContain("data-slow-ssr");
    expect(res.sent?.html).not.toContain("Slow SSR body");
  });

  it("falls back to a client shell when SSR throws and fallback is client", async () => {
    const rootDir = await tempRoot();
    await createMinimalFrontend(rootDir);
    await writeFile(
      path.join(rootDir, "src", "frontend", "pages", "index.tsx"),
      'export default function Page() { throw new Error("SSR boom"); }\n',
    );
    await buildFrontendClient({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        apiClient: false,
      },
    });

    const middleware = createFrontendRenderMiddleware({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        render: { fallback: "client" },
      },
    });
    const res = createRenderMockResponse();

    await middleware(
      createMockRequest("/throw-client"),
      res as any,
      async () => {},
    );
    expect(() => res.render("index")).not.toThrow();
    expect(res.sent?.html).toContain('data-vext-page="index"');
  });

  it("throws when SSR fails and render.fallback is error", async () => {
    const rootDir = await tempRoot();
    await createMinimalFrontend(rootDir);
    await writeFile(
      path.join(rootDir, "src", "frontend", "pages", "index.tsx"),
      'export default function Page() { throw new Error("SSR boom"); }\n',
    );
    await buildFrontendClient({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        apiClient: false,
      },
    });

    const middleware = createFrontendRenderMiddleware({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        render: { fallback: "error" },
      },
    });
    const res = createRenderMockResponse();

    await middleware(
      createMockRequest("/throw-error"),
      res as any,
      async () => {},
    );

    expect(() => res.render("index")).toThrow("SSR boom");
  });

  it("caches production render assets after the first render", async () => {
    const rootDir = await tempRoot();
    await createMinimalFrontend(rootDir);
    const result = await buildFrontendClient({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        apiClient: false,
      },
    });

    const middleware = createFrontendRenderMiddleware({
      rootDir,
      mode: "production",
      config: { enabled: true },
    });
    const firstRes = createRenderMockResponse();
    await middleware(createMockRequest("/"), firstRes as any, async () => {});
    firstRes.render("index", { title: "Cached" });

    await writeFile(
      result.renderManifestPath!,
      JSON.stringify({
        kind: "frontend-render-manifest",
        buildId: "broken",
        generatedAt: "test",
        pages: [{ id: "other", route: "/other", file: "other.tsx" }],
        layouts: [],
        errorPages: [],
        serverRenderer: "server/renderer.cjs",
      }),
    );
    await writeFile(
      path.join(result.config.outDir, "index.html"),
      "<!doctype html><html><body>Broken</body></html>",
    );

    const secondRes = createRenderMockResponse();
    await middleware(
      createMockRequest("/again"),
      secondRes as any,
      async () => {},
    );
    secondRes.render("index", { title: "Cached" });

    expect(secondRes.sent?.html).toContain('data-vext-page="index"');
    expect(secondRes.sent?.html).not.toContain("Broken");
  });
});

describe("frontend api client", () => {
  const contract = {
    schemaVersion: 1,
    kind: "client-contract",
    source: "routes-manifest",
    generatedAt: "test",
    routes: [{ method: "GET", path: "/api/hello", operationId: "getApiHello" }],
    warnings: [],
  } as const;

  it("unwraps standard vext JSON responses", async () => {
    const api = createVextApiClient(contract, {
      baseUrl: "https://example.test",
      fetch: async () =>
        new Response(JSON.stringify({ code: 0, data: { ok: true } }), {
          headers: { "content-type": "application/json" },
        }),
    });

    await expect(api.GET("/api/hello")).resolves.toEqual({ ok: true });
  });

  it("throws VextApiError for non-2xx responses", async () => {
    const api = createVextApiClient(contract, {
      baseUrl: "https://example.test",
      fetch: async () =>
        new Response(JSON.stringify({ code: 404, message: "Missing" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    });

    await expect(api.GET("/api/hello")).rejects.toBeInstanceOf(VextApiError);
    try {
      await api.GET("/api/hello");
    } catch (error) {
      expect(isVextApiError(error)).toBe(true);
      expect((error as VextApiError).status).toBe(404);
    }
  });

  it("exposes HEAD and OPTIONS helpers for generated route methods", async () => {
    const methodContract = {
      schemaVersion: 1,
      kind: "client-contract",
      source: "routes-manifest",
      generatedAt: "test",
      routes: [
        { method: "HEAD", path: "/api/ping", operationId: "headApiPing" },
        {
          method: "OPTIONS",
          path: "/api/options",
          operationId: "optionsApiOptions",
        },
      ],
      warnings: [],
    } as const;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const api = createVextApiClient(methodContract, {
      baseUrl: "https://example.test",
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return new Response(null, { status: 204 });
      },
    });

    await expect(
      api.HEAD("/api/ping", { body: { ignored: true } }),
    ).resolves.toBeNull();
    await expect(
      api.OPTIONS("/api/options", {
        body: { ok: true },
        query: { preflight: "1" },
      }),
    ).resolves.toBeNull();

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe("https://example.test/api/ping");
    expect(calls[0]?.init?.method).toBe("HEAD");
    expect(calls[0]?.init?.body).toBeUndefined();
    expect(calls[1]?.url).toBe("https://example.test/api/options?preflight=1");
    expect(calls[1]?.init?.method).toBe("OPTIONS");
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ ok: true }));
  });
});

describe("frontend static mount", () => {
  it("does not serve SPA fallback without an explicit scope", async () => {
    const rootDir = await tempRoot();
    const outDir = path.join(rootDir, "dist", "client");
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "index.html"), "<main>app</main>");

    let fallbackCalled = 0;
    const handler = createFrontendNotFoundHandler({
      rootDir,
      mode: "production",
      config: { enabled: true },
      fallbackHandler: async (_req, res) => {
        fallbackCalled += 1;
        res.rawJson({ code: 404 }, 404);
      },
    });

    const pageRes = createMockResponse();
    await handler(
      createMockRequest("/dashboard", { accept: "text/html" }),
      pageRes,
      async () => {},
    );
    expect(pageRes.streamed).toBe(false);
    expect(fallbackCalled).toBe(1);
    expect(pageRes.statusCode).toBe(404);

    const jsonRes = createMockResponse();
    await handler(
      createMockRequest("/dashboard", { accept: "application/json" }),
      jsonRes,
      async () => {},
    );
    expect(fallbackCalled).toBe(2);
    expect(jsonRes.statusCode).toBe(404);

    const apiRes = createMockResponse();
    await handler(createMockRequest("/api/missing"), apiRes, async () => {});
    expect(fallbackCalled).toBe(3);
    expect(apiRes.statusCode).toBe(404);
  });

  it("serves scoped SPA fallback from the configured page", async () => {
    const rootDir = await tempRoot();
    await createMinimalFrontend(rootDir);
    await mkdir(path.join(rootDir, "src", "frontend", "pages", "app"), {
      recursive: true,
    });
    await writeFile(
      path.join(rootDir, "src", "frontend", "pages", "app", "shell.tsx"),
      "export default function AppShell() { return null; }\n",
    );
    await buildFrontendClient({
      rootDir,
      mode: "production",
      config: { enabled: true, apiClient: false },
    });

    let fallbackCalled = 0;
    const handler = createFrontendNotFoundHandler({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        spaFallback: {
          scopes: [{ basePath: "/app", page: "app/shell" }],
        },
      },
      fallbackHandler: async (_req, res) => {
        fallbackCalled += 1;
        res.rawJson({ code: 404 }, 404);
      },
    });
    const res = createRenderMockResponse();

    await handler(
      createMockRequest("/app/settings", { accept: "text/html" }),
      res as any,
      async () => {},
    );

    expect(fallbackCalled).toBe(0);
    expect(res.sent?.status).toBe(200);
    expect(res.sent?.headers.Vary).toBe("Accept");
    expect(res.sent?.html).toContain('data-vext-page="app/shell"');
  });

  it("separates scoped SPA fallback SSR and CSR shell modes", async () => {
    const rootDir = await tempRoot();
    await createMinimalFrontend(rootDir);
    await mkdir(path.join(rootDir, "src", "frontend", "pages", "app"), {
      recursive: true,
    });
    await writeFile(
      path.join(rootDir, "src", "frontend", "pages", "app", "shell.tsx"),
      'export default function AppShell() { return <main data-shell-ssr="yes">Shell SSR</main>; }\n',
    );
    await buildFrontendClient({
      rootDir,
      mode: "production",
      config: { enabled: true, apiClient: false },
    });

    const handler = createFrontendNotFoundHandler({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        spaFallback: {
          scopes: [
            { basePath: "/app", page: "app/shell", ssr: false },
            { basePath: "/ssr-app", page: "app/shell", ssr: true },
          ],
        },
      },
      fallbackHandler: async (_req, res) => {
        res.rawJson({ code: 404 }, 404);
      },
    });

    const csrRes = createRenderMockResponse();
    await handler(
      createMockRequest("/app/settings", { accept: "text/html" }),
      csrRes as any,
      async () => {},
    );

    const ssrRes = createRenderMockResponse();
    await handler(
      createMockRequest("/ssr-app/settings", { accept: "text/html" }),
      ssrRes as any,
      async () => {},
    );

    expect(csrRes.sent?.html).toContain('data-vext-page="app/shell"');
    expect(csrRes.sent?.html).not.toContain("data-shell-ssr");
    expect((csrRes.sent?.data as any).options.ssr).toBe(false);
    expect(ssrRes.sent?.html).toContain("data-shell-ssr");
    expect((ssrRes.sent?.data as any).options.ssr).toBe(true);
  });

  it("does not serve SPA fallback for Vext docs system routes", async () => {
    const rootDir = await tempRoot();
    let fallbackCalled = 0;
    let onNotFoundCalled = 0;
    const handler = createFrontendNotFoundHandler({
      rootDir,
      mode: "production",
      config: { enabled: true, spaFallback: true },
      onNotFound: () => {
        onNotFoundCalled += 1;
      },
      fallbackHandler: async (_req, res) => {
        fallbackCalled += 1;
        res.rawJson({ code: 404 }, 404);
      },
    });
    const res = createMockResponse();

    await handler(
      createMockRequest("/_vext/docs/internal", { accept: "text/html" }),
      res,
      async () => {},
    );

    expect(onNotFoundCalled).toBe(0);
    expect(fallbackCalled).toBe(1);
    expect(res.statusCode).toBe(404);
  });

  it("renders HTML 404 error page for non-fallback navigation", async () => {
    const rootDir = await tempRoot();
    await createMinimalFrontend(rootDir);
    await buildFrontendClient({
      rootDir,
      mode: "production",
      config: { enabled: true, apiClient: false },
    });

    const handler = createFrontendNotFoundHandler({
      rootDir,
      mode: "production",
      config: { enabled: true },
      fallbackHandler: async (_req, res) => {
        res.rawJson({ code: 404 }, 404);
      },
    });
    const res = createRenderMockResponse();

    await handler(
      createMockRequest("/missing-page", { accept: "text/html" }),
      res as any,
      async () => {},
    );

    const payload = res.sent?.data as any;
    expect(res.sent?.status).toBe(404);
    expect(res.sent?.headers.Vary).toBe("Accept");
    expect(res.sent?.html).toContain('data-vext-page="error/404"');
    expect(payload.props.error).toMatchObject({
      status: 404,
      code: 404,
      requestId: "req-1",
    });
  });

  it("keeps missing static assets on the JSON 404 path", async () => {
    const rootDir = await tempRoot();
    const outDir = path.join(rootDir, "dist", "client");
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "index.html"), "<main>app</main>");

    let fallbackCalled = 0;
    const handler = createFrontendNotFoundHandler({
      rootDir,
      mode: "production",
      config: { enabled: true },
      fallbackHandler: async (_req, res) => {
        fallbackCalled += 1;
        res.rawJson({ code: 404 }, 404);
      },
    });

    const res = createMockResponse();
    await handler(
      createMockRequest("/assets/missing.js", { accept: "text/html" }),
      res,
      async () => {},
    );

    expect(fallbackCalled).toBe(1);
    expect(res.statusCode).toBe(404);
    expect(res.streamed).toBe(false);
  });

  it("serves conditional static requests without source entity length on 304", async () => {
    const rootDir = await tempRoot();
    const outDir = path.join(rootDir, "dist", "client");
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "index.html"), "<main>app</main>");

    const handler = createFrontendNotFoundHandler({
      rootDir,
      mode: "production",
      config: { enabled: true },
      fallbackHandler: async (_req, res) => {
        res.rawJson({ code: 404 }, 404);
      },
    });

    const firstRes = createMockResponse();
    await handler(createMockRequest("/index.html"), firstRes, async () => {});
    expect(firstRes.headers.ETag).toBeDefined();
    expect(firstRes.headers["Content-Length"]).toBe("16");

    const conditionalRes = createMockResponse();
    await handler(
      createMockRequest("/index.html", {
        "if-none-match": firstRes.headers.ETag,
      }),
      conditionalRes,
      async () => {},
    );

    expect(conditionalRes.statusCode).toBe(304);
    expect(conditionalRes.headers["Content-Length"]).not.toBe("16");
  });
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vext-frontend-"));
  tempDirs.push(dir);
  return dir;
}

async function createMinimalFrontend(rootDir: string): Promise<void> {
  const frontendDir = path.join(rootDir, "src", "frontend");
  await mkdir(path.join(frontendDir, "pages", "error"), {
    recursive: true,
  });
  await mkdir(path.join(frontendDir, "styles"), { recursive: true });
  await writeFile(
    path.join(frontendDir, "pages", "_document.html"),
    "<!doctype html><html><head>{vext.styles}</head><body>{vext.root}{vext.data}{vext.entry}</body></html>",
  );
  await writeFile(
    path.join(frontendDir, "pages", "index.tsx"),
    "export default function Page() { return null; }\n",
  );
  await writeFile(
    path.join(frontendDir, "pages", "error", "404.tsx"),
    "export default function NotFound() { return null; }\n",
  );
  await writeFile(
    path.join(frontendDir, "styles", "index.css"),
    "body { margin: 0; }\n",
  );
}

async function readTextFiles(
  dir: string,
  extension: string,
): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await readTextFiles(filePath, extension)));
      continue;
    }
    if (entry.name.endsWith(extension)) {
      results.push(await readFile(filePath, "utf-8"));
    }
  }
  return results;
}

function createMockRequest(
  pathname: string,
  headers: Record<string, string | undefined> = {},
) {
  return {
    method: "GET",
    path: pathname,
    headers,
    requestId: "req-1",
  } as any;
}

function createMockResponse() {
  const res = {
    headers: {} as Record<string, string>,
    statusCode: 200,
    streamed: false,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    text(_content: string, status?: number) {
      if (status) this.statusCode = status;
    },
    rawJson(_data: unknown, status?: number) {
      if (status) this.statusCode = status;
    },
    stream(readable: NodeJS.ReadableStream) {
      trackReadable(readable);
      this.streamed = true;
    },
  };
  return res as any;
}

function createRenderMockResponse() {
  const res = {
    statusCode: 200,
    sent: undefined as
      | {
          html: string;
          status: number;
          headers: Record<string, string>;
          kind: "html" | "render";
          data?: unknown;
        }
      | undefined,
    onSendPayload: undefined as any,
    _onSend(data: any) {
      this.onSendPayload = data;
    },
    _sendHtml(
      html: string,
      status: number,
      headers: Record<string, string>,
      kind: "html" | "render",
      data?: unknown,
    ) {
      this.statusCode = status;
      this.sent = { html, status, headers, kind, data };
    },
  };
  return res;
}

function trackReadable(readable: NodeJS.ReadableStream): void {
  pendingStreams.push(
    new Promise<void>((resolve) => {
      let settled = false;
      const stream = readable as NodeJS.ReadableStream & {
        off?: (event: string, listener: () => void) => void;
        resume?: () => unknown;
      };
      const done = () => {
        if (settled) return;
        settled = true;
        stream.off?.("close", done);
        stream.off?.("end", done);
        stream.off?.("error", done);
        resolve();
      };

      stream.once("close", done);
      stream.once("end", done);
      stream.once("error", done);
      stream.resume?.();
    }),
  );
}
