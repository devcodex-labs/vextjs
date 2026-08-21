import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveFrontendConfig } from "../../src/frontend/tooling/config-resolver.js";

const rootDir = path.resolve("test-fixtures/frontend-seo-contract");

describe("frontend SEO config contract", () => {
  it("stays disabled and artifact-free when the application omits SEO", () => {
    const config = resolveFrontendConfig(
      { enabled: true },
      {
        rootDir,
        mode: "production",
      },
    );
    expect(config.seo).toEqual({
      configured: false,
      enabled: false,
      origins: {},
      defaults: {},
      sitemap: false,
      robots: false,
    });
  });

  it("normalizes a finite origin model and explicit sitemap/robots outputs", () => {
    const entries = async () => [{ pathname: "/posts/hello" }] as const;
    const config = resolveFrontendConfig(
      {
        enabled: true,
        seo: {
          publicOrigin: "https://example.com/base/",
          origins: {
            docs: "https://docs.example.com/guide/",
          },
          defaults: { title: "Vext app", canonical: "/" },
          sitemap: { entries, maxUrlsPerFile: 100 },
          robots: {},
        },
      },
      { rootDir, mode: "production" },
    );

    expect(config.seo).toMatchObject({
      configured: true,
      enabled: true,
      publicOrigin: "https://example.com/base",
      origins: { docs: "https://docs.example.com/guide" },
      sitemap: {
        mode: "build",
        path: "/sitemap.xml",
        includeStatic: true,
        entries,
        maxUrlsPerFile: 100,
      },
      robots: {
        mode: "build",
        path: "/robots.txt",
        groups: [{ userAgent: "*", allow: "/" }],
      },
    });
  });

  it("fails closed for unsafe origins, output paths, and missing public URL truth", () => {
    expect(() =>
      resolveFrontendConfig(
        {
          enabled: true,
          seo: {
            publicOrigin: "https://user:pass@example.com/?preview=1",
          },
        },
        { rootDir, mode: "production" },
      ),
    ).toThrow("without userinfo, query, or hash");

    expect(() =>
      resolveFrontendConfig(
        {
          enabled: true,
          seo: {
            publicOrigin: "https://example.com",
            sitemap: { path: "../map.xml" },
          },
        },
        { rootDir, mode: "production" },
      ),
    ).toThrow("root absolute file pathname");

    for (const unsafePath of [
      "/..\\escape.xml",
      "/nested\\escape.xml",
      "/%2e%2e/escape.xml",
    ]) {
      expect(() =>
        resolveFrontendConfig(
          {
            enabled: true,
            seo: {
              publicOrigin: "https://example.com",
              sitemap: { path: unsafePath },
            },
          },
          { rootDir, mode: "production" },
        ),
      ).toThrow("root absolute file pathname");
    }

    expect(() =>
      resolveFrontendConfig(
        { enabled: true, seo: { robots: {} } },
        { rootDir, mode: "production" },
      ),
    ).toThrow("requires publicOrigin or declared origins");
  });
});
