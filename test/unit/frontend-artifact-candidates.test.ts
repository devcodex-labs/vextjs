import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveFrontendConfig } from "../../src/frontend/tooling/config-resolver.js";
import { createClientContractArtifacts } from "../../src/frontend/tooling/client-contract-writer.js";
import { createFrontendMediaArtifacts } from "../../src/frontend/tooling/media-artifact-writer.js";
import { createFrontendSeoArtifacts } from "../../src/frontend/tooling/seo-artifact-writer.js";
import {
  buildFrontendDeployManifest,
  buildFrontendDeployManifestFromCandidates,
} from "../../src/frontend/deploy/manifest.js";
import type { VextFrontendManifest } from "../../src/frontend/contract/types.js";

let rootDir: string;
beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(tmpdir(), "vext-front-candidates-"));
});
afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true });
});
function save(file: string, content: string | Buffer) {
  const absolute = path.join(rootDir, file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
}

describe("frontend artifact candidate generation", () => {
  it("matches the disk deploy scan for complex positive and negative glob patterns", async () => {
    const files = [
      "index.html",
      "main.js",
      ".hidden.js",
      "assets/a.js",
      "assets/b.css",
      "assets/file-1.js",
      "assets/file-2.js",
      "assets/[name].js",
      "assets/nested/child.js",
      "skip/deep/a.js",
      "source.txt",
      "pages/a/index.html",
    ];
    const config = resolveFrontendConfig(
      { enabled: true },
      { rootDir, mode: "production" },
    );
    const browserManifest: VextFrontendManifest = {
      schemaVersion: 1,
      kind: "frontend-manifest",
      generatedAt: "",
      mode: "production",
      publicPath: "/",
      indexHtml: "/index.html",
      entrypoints: [],
      assets: [],
    };
    for (const file of files) save(`dist/client/${file}`, file);
    save(
      "dist/client/public-manifest.json",
      JSON.stringify({
        schemaVersion: 1,
        kind: "frontend-public-manifest",
        buildId: "test",
        files,
      }),
    );
    const cases = [
      { include: ["**/*"], exclude: ["skip"] },
      { include: ["!assets/a.js", "**/*.js", "assets/a.js"], exclude: [] },
      { include: ["**/*.{js,css}"], exclude: ["**/nested/**"] },
      { include: ["./assets/file-[12].js", "**/index.html"], exclude: [] },
      { include: ["**/+(a|b).{js,css}", ".hidden.js"], exclude: [] },
      { include: ["assets/\\[name\\].js", "main.js"], exclude: [] },
      { include: ["assets/**/*.js"], exclude: ["assets/nested"] },
    ];
    for (const item of cases) {
      Object.assign(config.deploy.upload, item);
      const options = {
        rootDir,
        config,
        mode: "production" as const,
        browserManifest,
      };
      const actual = await buildFrontendDeployManifestFromCandidates(options, {
        files,
        publicFiles: files,
        read: (file) => fs.readFileSync(file),
      });
      const expected = await buildFrontendDeployManifest(options);
      expect(actual, JSON.stringify(item)).toEqual(expected);
    }
  });

  it("returns contract bytes without creating or replacing output files", async () => {
    save(
      ".vext/manifest/routes.json",
      JSON.stringify({
        routes: [{ method: "GET", path: "/health", operationId: "health" }],
      }),
    );
    save("dist/client/client-contract.json", "old contract");
    const options = { rootDir, outDir: path.join(rootDir, "dist/client") };
    const plan = await createClientContractArtifacts(options);
    expect(plan.result.routeCount).toBe(1);
    expect(plan.files).toHaveLength(3);
    expect(
      plan.files.find((file) => file.path.endsWith("client-contract.json"))
        ?.contents,
    ).toContain('"operationId": "health"');
    expect(fs.readFileSync(plan.result.contractPath, "utf8")).toBe(
      "old contract",
    );
    expect(fs.existsSync(plan.result.modulePath)).toBe(false);
    save(".vext/manifest/routes.json", "{");
    await expect(createClientContractArtifacts(options)).rejects.toThrow();
    expect(fs.readFileSync(plan.result.contractPath, "utf8")).toBe(
      "old contract",
    );
  });

  it("returns real media bytes and preserves previous outputs on a later font failure", async () => {
    save(
      "src/frontend/assets/pixel.png",
      await sharp({
        create: { width: 1, height: 1, channels: 3, background: "red" },
      })
        .png()
        .toBuffer(),
    );
    save("dist/client/media-manifest.json", "old media manifest");
    const config = resolveFrontendConfig(
      { enabled: true, media: { images: { widths: [1], formats: ["webp"] } } },
      { rootDir, mode: "production" },
    );
    const options = { rootDir, config, mode: "production" as const };
    const plan = await createFrontendMediaArtifacts(options);
    expect(plan.result.manifest.images).toHaveLength(1);
    const file = plan.files.find((candidate) =>
      candidate.path.endsWith(".webp"),
    )!;
    expect((await sharp(Buffer.from(file.contents)).metadata()).format).toBe(
      "webp",
    );
    expect(fs.existsSync(file.path)).toBe(false);
    expect(fs.readFileSync(plan.result.manifestPath, "utf8")).toBe(
      "old media manifest",
    );
    save(
      "src/frontend/fonts.ts",
      'export const font = defineFont({ src: "https://invalid.test/font.ttf", family: "Remote", license: "OFL-1.1" });',
    );
    await expect(createFrontendMediaArtifacts(options)).rejects.toThrow(
      "remote source",
    );
    expect(fs.readFileSync(plan.result.manifestPath, "utf8")).toBe(
      "old media manifest",
    );
  });

  it("uses the current supplied route contract when producing SEO candidates", async () => {
    save(
      ".vext/manifest/routes.json",
      JSON.stringify({
        routes: [
          {
            method: "GET",
            path: "/hidden",
            routeId: "hidden",
            operationId: "hidden",
            freshness: {
              mode: "static",
              source: "legacy-default",
              seo: { index: false },
            },
          },
        ],
      }),
    );
    const config = resolveFrontendConfig(
      {
        enabled: true,
        seo: { publicOrigin: "https://example.test", sitemap: {}, robots: {} },
      },
      { rootDir, mode: "production" },
    );
    const current = await createClientContractArtifacts({
      rootDir,
      outDir: config.outDir,
    });
    save("dist/client/client-contract.json", JSON.stringify({ routes: [] }));
    save("dist/client/sitemap.xml", "old sitemap");
    const plan = await createFrontendSeoArtifacts({
      rootDir,
      config,
      contract: current.contract,
      staticArtifacts: [
        {
          routeId: "hidden",
          routePath: "/hidden",
          page: "hidden",
          params: {},
          html: "hidden/index.html",
          bytes: 0,
          assets: [],
        },
      ],
    });
    const sitemap = plan.files.find((file) =>
      file.path.endsWith("sitemap.xml"),
    )!;
    expect(sitemap.contents).not.toContain("/hidden");
    expect(fs.readFileSync(sitemap.path, "utf8")).toBe("old sitemap");
    expect(fs.existsSync(path.join(config.outDir, "robots.txt"))).toBe(false);
  });
});
