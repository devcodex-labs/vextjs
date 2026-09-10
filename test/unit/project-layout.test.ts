import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as ts from "typescript";
import { resolveFrontendConfig } from "../../src/frontend/tooling/config-resolver.js";
import { loadModelCodeDocs } from "../../src/lib/docs/sources/model-source.js";
import {
  shouldExcludeServiceFileName,
  toGeneratedImportPath,
} from "../../src/shared/service-paths.js";

const roots: string[] = [];
async function project(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "vext-layout-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("resolved project role paths", () => {
  it("derives default documents and aliases from custom frontend roles", async () => {
    const rootDir = await project();
    const config = resolveFrontendConfig(
      {
        enabled: true,
        root: "web",
        pages: { dir: "screens" },
        componentsDir: "ui",
        assetsDir: "media",
        styles: { entry: "theme/main.css" },
      },
      { rootDir, mode: "production" },
    );
    expect(config.pages.document).toBe(
      path.join(rootDir, "web/screens/_document.html"),
    );
    expect(config.indexHtml).toBe(config.pages.document);
    expect(config.pages.errorDir).toBe(path.join(rootDir, "web/screens/error"));
    expect(config.alias).toMatchObject({
      "@frontend": path.join(rootDir, "web"),
      "@pages": path.join(rootDir, "web/screens"),
      "@components": path.join(rootDir, "web/ui"),
      "@assets": path.join(rootDir, "web/media"),
      "@styles": path.join(rootDir, "web/theme"),
    });
    expect(config.publicDir).toBe(path.join(rootDir, "public"));
    expect(config.build.server.outFile).toBe(
      path.join(rootDir, "dist/client/server/renderer.cjs"),
    );
  });

  it("preserves explicit project-relative and frontend-relative overrides", async () => {
    const rootDir = await project();
    const config = resolveFrontendConfig(
      {
        enabled: true,
        root: "web",
        indexHtml: "templates/shell.html",
        pages: {
          dir: "screens",
          document: "templates/document.html",
          errorDir: "errors",
        },
        alias: { "@pages": "legacy-pages" },
      },
      { rootDir, mode: "development" },
    );
    expect(config.pages.document).toBe(
      path.join(rootDir, "web/templates/document.html"),
    );
    expect(config.pages.errorDir).toBe(path.join(rootDir, "web/errors"));
    expect(config.indexHtml).toBe(path.join(rootDir, "templates/shell.html"));
    expect(config.alias["@pages"]).toBe(path.join(rootDir, "web/legacy-pages"));
    expect(config.outDir).toBe(path.join(rootDir, ".vext/client"));
  });

  it("allows dot-prefixed role names that are still inside the project", async () => {
    const rootDir = await project();
    expect(
      resolveFrontendConfig({ root: "..web" }, { rootDir, mode: "development" })
        .root,
    ).toBe(path.join(rootDir, "..web"));
  });

  it("rejects a frontend source junction that escapes the service root", async () => {
    const rootDir = await project();
    const outside = await project();
    await symlink(outside, path.join(rootDir, "web"), "junction");
    expect(() =>
      resolveFrontendConfig(
        { enabled: true, root: "web" },
        { rootDir, mode: "development" },
      ),
    ).toThrow(/inside|symbolic links/);
  });

  it("uses a custom models directory without making it part of the database key", async () => {
    const rootDir = await project();
    const srcDir = path.join(rootDir, "src");
    await mkdir(path.join(srcDir, "data/entities/billing"), {
      recursive: true,
    });
    await writeFile(
      path.join(srcDir, "data/entities/billing/invoice.ts"),
      'export default { collection: "invoices", schema: { amount: "number" } };',
    );
    const docs = await loadModelCodeDocs({
      srcDir,
      modelsDir: "data/entities",
      source: true,
    });
    expect(docs).toHaveLength(1);
    expect(docs[0]?.sourceFile).toBe("data/entities/billing/invoice.ts");
    expect(docs[0]?.model).toMatchObject({
      registryKey: "BillingInvoice",
      connection: { database: "billing" },
    });
  });

  it("reads an explicitly configured model root outside src without changing its model key", async () => {
    const rootDir = await project();
    await mkdir(path.join(rootDir, "other"));
    await writeFile(
      path.join(rootDir, "other/user.ts"),
      'export default { collection: "users", schema: { name: "string!" } };',
    );
    const docs = await loadModelCodeDocs({
      srcDir: path.join(rootDir, "src"),
      modelsDir: "../other",
      source: true,
    });
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      sourceFile: "../other/user.ts",
      model: { registryKey: "users" },
    });
  });
});

describe("service declaration module paths", () => {
  it.each(["user.d.ts", "user.d.mts", "user.d.cts"])(
    "excludes %s from convention entries",
    (file) => {
      expect(shouldExcludeServiceFileName(file)).toBe(true);
    },
  );

  it.each([
    ["ts", "js"],
    ["mts", "mjs"],
    ["cts", "cjs"],
    ["js", "js"],
    ["mjs", "mjs"],
    ["cjs", "cjs"],
  ])(
    "generates a .%s import that TypeScript resolves to the original source",
    async (sourceExt, importExt) => {
      const root = await project();
      const source = path.join(root, `src/service.${sourceExt}`);
      const declaration = path.join(root, "src/types/services.generated.d.ts");
      await mkdir(path.dirname(source), { recursive: true });
      await writeFile(source, "export default class Service {}\n");
      const specifier = toGeneratedImportPath(declaration, source);
      expect(specifier).toBe(`../service.${importExt}`);
      const resolved = ts.resolveModuleName(
        specifier,
        declaration,
        {
          module: ts.ModuleKind.NodeNext,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
          allowJs: true,
        },
        ts.sys,
      ).resolvedModule;
      expect(resolved?.resolvedFileName.replaceAll("\\", "/")).toBe(
        source.replaceAll("\\", "/"),
      );
    },
  );
});
