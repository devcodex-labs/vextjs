import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCS_ASSETS_PATH,
  DEFAULT_DOCS_PATH,
  DEFAULT_OPENAPI_SPEC_PATH,
  normalizeDocsConfig,
} from "../../../src/lib/docs/index.js";

describe("docs public contract", () => {
  it("normalizes default docs config", () => {
    const config = normalizeDocsConfig({ title: "Demo API" });

    expect(config.path).toBe(DEFAULT_DOCS_PATH);
    expect(config.assetsPath).toBe(DEFAULT_DOCS_ASSETS_PATH);
    expect(config.assetsPublicPath).toBe(DEFAULT_DOCS_ASSETS_PATH);
    expect(config.specPath).toBe(DEFAULT_OPENAPI_SPEC_PATH);
    expect(config.specPublicPath).toBe(DEFAULT_OPENAPI_SPEC_PATH);
    expect(config.renderer).toBe("vext");
    expect(config.ui.title).toBe("Demo API");
    expect(config.ui.theme).toBe("system");
    expect(config.ui.density).toBe("comfortable");
    expect(config.code.enabled).toBe("auto");
    expect(config.code.services).toBe(true);
    expect(config.code.utils).toBe(true);
    expect(config.code.models).toBe(true);
    expect(config.code.components).toBe(true);
    expect(config.code.plugins).toBe(true);
    expect(config.code.middlewares).toBe(true);
    expect(config.code.locales).toBe(false);
    expect(config.code.config).toBe(false);
    expect(config.code.preload).toBe(false);
    expect(config.code.styles).toBe(false);
    expect(config.access.mode).toBe("off");
    expect(config.tryItOut.hookGlobal).toBe("VextDocsHooks");
    expect(config.tryItOut.hookScript).toBeUndefined();
    expect(config.tryItOut.defaultServer).toBeUndefined();
    expect(config.tryItOut.sameOrigin).toBe("auto");
    expect(config.tryItOut.customServer).toBe(true);
    expect(config.tryItOut.customServerUrl).toBeUndefined();
    expect(config.sources).toEqual([]);
    expect(config.endpoints.appJs).toBe("/_vext/docs/app.js");
    expect(config.publicEndpoints.appJs).toBe("/_vext/docs/app.js");
  });

  it("normalizes explicit docs sources", () => {
    const config = normalizeDocsConfig({
      docs: {
        sources: [
          {
            id: "public-v1",
            label: "Public v1",
            match: ["/api/v1/**"],
            version: "v1",
            description: "Public API version 1",
            code: { include: ["services/public/**"] },
          },
          {
            id: "admin",
            match: "/admin/**",
            default: true,
          },
        ],
      },
    });

    expect(config.sources).toEqual([
      expect.objectContaining({
        id: "public-v1",
        label: "Public v1",
        match: ["/api/v1/**"],
        version: "v1",
        default: false,
        description: "Public API version 1",
        code: { include: ["services/public/**"] },
      }),
      expect.objectContaining({
        id: "admin",
        label: "admin",
        match: ["/admin/**"],
        default: true,
      }),
    ]);
  });

  it("keeps optional static docs sources available when explicitly enabled", () => {
    const config = normalizeDocsConfig({
      docs: {
        code: {
          locales: true,
          config: { enabled: true, dir: "config" },
          preload: true,
          styles: { enabled: true, dir: "frontend/styles" },
        },
      },
    });

    expect(config.code.locales).toBe(true);
    expect(config.code.config).toMatchObject({ enabled: true, dir: "config" });
    expect(config.code.preload).toBe(true);
    expect(config.code.styles).toMatchObject({
      enabled: true,
      dir: "frontend/styles",
    });
  });

  it("keeps legacy docsPath and jsonPublicPath as aliases", () => {
    const config = normalizeDocsConfig({
      docsPath: "/admin/docs",
      jsonPath: "/openapi.json",
      jsonPublicPath: "/admin/openapi.json",
      docs: {
        assetsPath: "/_vext/docs",
        assetsPublicPath: "/admin/_vext/docs",
        ui: {
          defaultView: "api",
          tryItOut: false,
          theme: "dark",
          density: "compact",
        },
        code: { enabled: false, scan: "background" },
        access: { mode: "visibility-only", openapiJson: "public" },
        tryItOut: {
          hookScript: "/docs-hook.js",
          hookGlobal: "CustomDocsHooks",
          defaultServer: "first",
          sameOrigin: false,
          customServer: false,
          customServerUrl: "http://127.0.0.1:3001",
        },
      },
    });

    expect(config.path).toBe("/admin/docs");
    expect(config.assetsPath).toBe("/_vext/docs");
    expect(config.assetsPublicPath).toBe("/admin/_vext/docs");
    expect(config.endpoints.openapi).toBe("/_vext/docs/openapi.json");
    expect(config.publicEndpoints.openapi).toBe(
      "/admin/_vext/docs/openapi.json",
    );
    expect(config.specPublicPath).toBe("/admin/openapi.json");
    expect(config.ui.defaultView).toBe("api");
    expect(config.ui.tryItOut).toBe(false);
    expect(config.ui.theme).toBe("dark");
    expect(config.ui.density).toBe("compact");
    expect(config.code.enabled).toBe(false);
    expect(config.code.scan).toBe("background");
    expect(config.access.mode).toBe("visibility-only");
    expect(config.access.openapiJson).toBe("public");
    expect("cacheKey" in config.access).toBe(false);
    expect(config.tryItOut.hookScript).toBe("/docs-hook.js");
    expect(config.tryItOut.hookGlobal).toBe("CustomDocsHooks");
    expect(config.tryItOut.defaultServer).toBe("first");
    expect(config.tryItOut.sameOrigin).toBe(false);
    expect(config.tryItOut.customServer).toBe(false);
    expect(config.tryItOut.customServerUrl).toBe("http://127.0.0.1:3001");
  });

  it("rejects external renderer objects", () => {
    expect(() =>
      normalizeDocsConfig({
        docs: {
          renderer: {
            name: "custom",
            render: () => "<!doctype html>",
          } as never,
        },
      }),
    ).toThrow('openapi.docs.renderer only supports "vext"');
  });
});
