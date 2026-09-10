import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFrontendClient } from "../../src/frontend/tooling/client-build-compiler.js";
import { createJscssArtifacts } from "../../src/frontend/tooling/jscss-extractor.js";
import { resolveFrontendConfig } from "../../src/frontend/tooling/config-resolver.js";
import {
  artifactDigest,
  ARTIFACT_MANIFEST_FILE,
} from "../../src/lib/project/artifact-manifest.js";
import type { VextFrontendUserConfig } from "../../src/frontend/contract/types.js";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(tmpdir(), "vext-frontend-transaction-"));
  save(
    "src/frontend/pages/index.tsx",
    "export default function Page() { return <main>first</main>; }",
  );
  save(
    "src/frontend/pages/_document.html",
    "<html><head>{vext.styles}</head><body>{vext.root}{vext.data}{vext.entry}</body></html>",
  );
  save("public/keep.txt", "public first");
  routes();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function save(file: string, content: string) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
function routes(page = "index") {
  save(
    ".vext/manifest/routes.json",
    JSON.stringify({
      routes: [
        {
          routeId: "home",
          operationId: "home",
          method: "GET",
          path: "/",
          freshness: { mode: "static", source: "route-options", page },
        },
      ],
    }),
  );
}
function build(config: VextFrontendUserConfig = { enabled: true }) {
  return buildFrontendClient({ rootDir: root, mode: "production", config });
}
function snapshot(): Record<string, string> {
  const result: Record<string, string> = {};
  function scan(directory: string) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) scan(file);
      else
        result[path.relative(root, file).replaceAll("\\", "/")] =
          artifactDigest(fs.readFileSync(file));
    }
  }
  scan(path.join(root, "dist/client"));
  scan(path.join(root, ".vext/generated/frontend"));
  const manifest = path.join(root, ARTIFACT_MANIFEST_FILE);
  if (fs.existsSync(manifest))
    result[ARTIFACT_MANIFEST_FILE] = artifactDigest(fs.readFileSync(manifest));
  return result;
}

describe("complete frontend artifact transactions", () => {
  it("preserves both output roles and ownership after browser, SSR, media, static, SEO and budget failures", async () => {
    const initial = await build();
    const htmlPath = path.join(initial.config.outDir, "index.html");
    expect(fs.readFileSync(htmlPath, "utf8")).toContain("first");
    const baseline = snapshot();
    const cases: {
      name: string;
      config?: VextFrontendUserConfig;
      prepare(): void;
      reset?(): void;
    }[] = [
      {
        name: "browser",
        prepare: () =>
          save("src/frontend/pages/index.tsx", "export default = invalid"),
      },
      {
        name: "SSR",
        prepare: () =>
          save(
            "src/frontend/pages/index.tsx",
            'throw new Error("SSR generation failed"); export default function Page() { return <main>second</main>; }',
          ),
      },
      {
        name: "media",
        prepare: () =>
          save(
            "src/frontend/fonts.ts",
            'export const font = defineFont({ src: "https://invalid.test/font.ttf", family: "Remote", license: "OFL-1.1" });',
          ),
        reset: () => fs.unlinkSync(path.join(root, "src/frontend/fonts.ts")),
      },
      {
        name: "static",
        prepare: () => routes("missing"),
        reset: () => routes(),
      },
      {
        name: "SEO",
        prepare: () => {},
        config: {
          enabled: true,
          seo: {
            publicOrigin: "https://example.test",
            robots: false,
            sitemap: {
              entries: () => {
                throw new Error("SEO generation failed");
              },
            },
          },
        },
      },
      {
        name: "budget",
        prepare: () => {},
        config: { enabled: true, build: { budgets: { maxTotalBytes: 1 } } },
      },
    ];
    for (const phase of cases) {
      save(
        "src/frontend/pages/index.tsx",
        "export default function Page() { return <main>second</main>; }",
      );
      phase.prepare();
      try {
        await expect(build(phase.config), phase.name).rejects.toThrow();
        expect(snapshot(), phase.name).toEqual(baseline);
      } finally {
        phase.reset?.();
      }
    }
    await build();
    expect(fs.readFileSync(htmlPath, "utf8")).toContain("second");
    expect(snapshot()).not.toEqual(baseline);
  }, 60_000);

  it("keeps unknown files, removes obsolete owned assets and does zero writes for identical results", async () => {
    const initial = await build();
    const first = snapshot();
    const manifestFile = path.join(root, ARTIFACT_MANIFEST_FILE);
    const timestamp = fs.statSync(manifestFile).mtimeMs;
    save("dist/client/user-note.txt", "user data");
    const withUnknown = snapshot();
    await build();
    expect(snapshot()).toEqual(withUnknown);
    expect(fs.statSync(manifestFile).mtimeMs).toBe(timestamp);
    fs.unlinkSync(path.join(root, "public/keep.txt"));
    save(
      "src/frontend/pages/index.tsx",
      "export default function Page() { return <main>new generation</main>; }",
    );
    await build();
    expect(fs.existsSync(path.join(initial.config.outDir, "keep.txt"))).toBe(
      false,
    );
    expect(
      fs.readFileSync(
        path.join(initial.config.outDir, "user-note.txt"),
        "utf8",
      ),
    ).toBe("user data");
    const next = snapshot();
    const oldAssets = Object.keys(first).filter(
      (file) => file.startsWith("dist/client/assets/") && !(file in next),
    );
    expect(oldAssets.length).toBeGreaterThan(0);
    for (const file of oldAssets)
      expect(fs.existsSync(path.join(root, file))).toBe(false);
    const publicManifest = JSON.parse(
      fs.readFileSync(
        path.join(initial.config.outDir, "public-manifest.json"),
        "utf8",
      ),
    );
    expect(publicManifest.files).not.toContain("user-note.txt");
  }, 30_000);

  it("reports external output edits without replacing any other artifact", async () => {
    await build();
    save("dist/client/manifest.json", "externally changed");
    const baseline = snapshot();
    save(
      "src/frontend/pages/index.tsx",
      "export default function Page() { return <main>changed</main>; }",
    );
    await expect(build()).rejects.toThrow("VEXT_OUTPUT_CONFLICT");
    expect(snapshot()).toEqual(baseline);
  }, 30_000);

  it("keeps native JSCSS top-level await and logical import.meta while leaving final files untouched", async () => {
    const generated = path.join(root, ".vext/generated/frontend");
    save(
      "src/frontend/styles/async.style.ts",
      [
        'import { style } from "vextjs/style";',
        "await Promise.resolve();",
        'if (!import.meta.url.endsWith("/jscss-extract.mjs")) throw new Error("wrong logical URL");',
        'const metadata = import.meta; if (!metadata.url.endsWith("/jscss-extract.mjs")) throw new Error("wrong aliased logical URL");',
        'if (!metadata.filename.endsWith("jscss-extract.mjs")) throw new Error("wrong logical filename");',
        'const file = "./input.mjs";',
        "const { default: color } = await import(file);",
        'export const current = style({ color }, "current");',
      ].join("\n"),
    );
    save(".vext/generated/frontend/input.mjs", 'export default "tomato";');
    save(".vext/generated/frontend/vext-jscss.css", "last good CSS");
    const config = resolveFrontendConfig(
      { enabled: true },
      { rootDir: root, mode: "production" },
    );
    const candidate = await createJscssArtifacts({
      rootDir: root,
      config,
      generatedDir: generated,
    });
    expect(candidate.result.cssText).toContain("tomato");
    expect(
      fs.readFileSync(path.join(generated, "vext-jscss.css"), "utf8"),
    ).toBe("last good CSS");
    expect(fs.existsSync(path.join(generated, "jscss-extract.mjs"))).toBe(
      false,
    );
    expect(
      fs.readdirSync(generated).some((file) => file.startsWith(".vext-exec-")),
    ).toBe(false);
  });
});
