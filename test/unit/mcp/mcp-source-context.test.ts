import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  inspectVextProject,
  getInspectionSources,
} from "../../../src/assistant/project-inspector.js";
import { collectAssistantSources } from "../../../src/tooling/project-index/analysis-source.js";
import { resolveAssistantRoles } from "../../../src/tooling/project-index/roles.js";

let root: string;
let parent: string;
const externalRoots: string[] = [];
async function put(file: string, content: string) {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), content);
}
beforeEach(async () => {
  parent = await realpath(tmpdir());
  root = await mkdtemp(join(parent, "vext-mcp-source-"));
  await put(
    "package.json",
    '{"name":"source-fixture","dependencies":{"vextjs":"2.0.0"}}',
  );
  await put("src/config/default.ts", "export default {};");
});
afterEach(async () => {
  vi.restoreAllMocks();
  expect(dirname(await realpath(root))).toBe(parent);
  await rm(root, { recursive: true, force: true });
  for (const target of externalRoots.splice(0)) {
    expect(dirname(await realpath(target))).toBe(parent);
    await rm(target, { recursive: true, force: true });
  }
});
const inspect = (limits?: { maxFiles?: number }) =>
  inspectVextProject({ rootDir: root, frameworkVersion: "2.0.0", limits });

describe("MCP source evidence", () => {
  it("rejects files added after directory discovery instead of sealing a missing route", async () => {
    await put("src/routes/existing.ts", "export default app => {};");
    const open = fs.openSync;
    let added = false;
    vi.spyOn(fs, "openSync").mockImplementation(((
      ...args: Parameters<typeof fs.openSync>
    ) => {
      if (!added && String(args[0]) === join(root, "package.json")) {
        added = true;
        fs.writeFileSync(
          join(root, "src/routes/late.ts"),
          "export default app => {};",
        );
      }
      return Reflect.apply(open, fs, args);
    }) as typeof fs.openSync);
    await expect(
      collectAssistantSources(root, resolveAssistantRoles()),
    ).rejects.toMatchObject({ code: "VEXT_SOURCE_CHANGED" });
    expect(added).toBe(true);
  });

  it("inherits a declared ancestor workspace without reading a peer service's source", async () => {
    await put(
      "vext.workspace.json",
      JSON.stringify({
        schemaVersion: 1,
        services: [
          { id: "api", root: "apps/api", sharedPackages: ["models"] },
          { id: "peer", root: "apps/peer" },
        ],
        sharedPackages: [
          {
            id: "models",
            root: "packages/models",
            kind: "models",
            sourceExports: { ".": "src/index.ts" },
          },
        ],
        policyDefaults: { commentLanguage: "zh" },
      }),
    );
    await put(
      "apps/api/package.json",
      JSON.stringify({
        name: "api",
        dependencies: { vextjs: "2.0.0", "@fixture/models": "workspace:*" },
      }),
    );
    await put("apps/api/src/config/default.ts", "export default {};");
    await put(
      "apps/peer/src/services/private.ts",
      "throw new Error('not this service');",
    );
    await put(
      "packages/models/package.json",
      JSON.stringify({
        name: "@fixture/models",
        version: "1.0.0",
        exports: { ".": "./dist/index.js" },
      }),
    );
    await put("packages/models/src/index.ts", "export const model = {};");
    const project = await inspectVextProject({
      rootDir: join(root, "apps/api"),
      frameworkVersion: "2.0.0",
    });
    expect(project.identity.sourceState).toBe("complete");
    expect(project.assistant.workspace?.rootDir).toBe(root);
    expect(getInspectionSources(project)?.roots()).toContainEqual(
      expect.objectContaining({
        packageName: "@fixture/models",
        sourceExports: { ".": "src/index.ts" },
      }),
    );
    expect(
      getInspectionSources(project)
        ?.list()
        .some((file) => file.path.includes("private.ts")),
    ).toBe(false);
    await put(
      "packages/models/package.json",
      JSON.stringify({
        name: "@fixture/models",
        version: "1.0.0",
        exports: { "./other": "./dist/index.js" },
      }),
    );
    expect(
      (
        await inspectVextProject({
          rootDir: join(root, "apps/api"),
          frameworkVersion: "2.0.0",
        })
      ).identity.sourceState,
    ).toBe("partial");
  });

  it("does not silently adopt defaults from an invalid workspace policy", async () => {
    await put(
      "vext.workspace.json",
      JSON.stringify({
        schemaVersion: 1,
        policyDefaults: { commentLanguage: 12 },
      }),
    );
    expect((await inspect()).identity.sourceState).toBe("partial");
  });

  it("adopts configured models, locale and frontend paths without evaluating unrelated expressions", async () => {
    await put(
      "src/config/default.ts",
      "export default { database: { models: { dir: '../domain/models' }, uri: process.env.MONGO_URI }, locale: { directory: 'translations' }, frontend: { root: 'web', componentsDir: '../ui', pages: { dir: 'screens', document: '../templates/document.html' } } };",
    );
    await put("domain/models/post.ts", "export default { name: 'post' };");
    await put("translations/blog/detail/en.json", '{"title":"Post"}');
    await put(
      "ui/Button.tsx",
      "export default function Button() { return null; }",
    );
    await put("templates/document.html", "<html><body></body></html>");
    await put(
      "web/screens/index.tsx",
      "export default function Page() { return null; }",
    );
    const project = await inspect();
    expect(project.identity.sourceState).toBe("complete");
    expect(project.snapshot.sections.models).toMatchObject({
      resolvedPath: "domain/models",
      fileCount: 1,
    });
    expect(project.snapshot.sections.locales).toMatchObject({
      resolvedPath: "translations",
      fileCount: 1,
    });
    expect(project.snapshot.sections["frontend-components"]).toMatchObject({
      resolvedPath: "ui",
      fileCount: 1,
    });
    expect(project.snapshot.sections["frontend-pages"]).toMatchObject({
      resolvedPath: "web/screens",
      fileCount: 1,
    });
  });

  it("seals explicitly configured external models as read-only content inputs", async () => {
    const target = await mkdtemp(join(parent, "vext-mcp-declared-models-"));
    externalRoots.push(target);
    await writeFile(
      join(target, "post.ts"),
      "export default { name: 'post' };",
    );
    await put(
      "src/config/default.ts",
      `export default ${JSON.stringify({ database: { models: { dir: target } } })};`,
    );
    const before = await inspect();
    expect(before.identity.sourceState).toBe("complete");
    expect(before.snapshot.sections.models).toMatchObject({
      fileCount: 1,
      readRootId: "configured-models",
    });
    expect(
      before.structureDecisions.find((entry) => entry.role === "models")
        ?.editable,
    ).toBe(false);
    await writeFile(
      join(target, "post.ts"),
      "export default { name: 'user' };",
    );
    expect((await inspect()).identity.contextRevision).not.toBe(
      before.identity.contextRevision,
    );
  });

  it("does not grant external-root status to an undeclared default-directory link", async () => {
    const target = await mkdtemp(join(parent, "vext-mcp-undeclared-models-"));
    externalRoots.push(target);
    await symlink(
      target,
      join(root, "src/models"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect((await inspect()).identity.sourceState).toBe("partial");
    await put(
      "src/config/default.ts",
      "export default { database: { models: { dir: 'models' } } };",
    );
    expect((await inspect()).identity.sourceState).toBe("complete");
  });

  it("does not claim a baseline when a loader directory is dynamic or default config is missing", async () => {
    await put(
      "src/config/default.ts",
      "export default { locale: { directory: process.env.LOCALES } };",
    );
    expect((await inspect()).identity.sourceState).toBe("partial");
  });

  it("includes declarations, private modules and behavior tests excluded by runtime convention loaders", async () => {
    await put(
      "src/types/server/services/blog.d.ts",
      "export interface Blog { id: string }",
    );
    await put("src/utils/_internal.ts", "export const value = 1;");
    await put("test/unit/blog.test.ts", "export const caseName = 'blog';");
    const view = await collectAssistantSources(root, resolveAssistantRoles());
    expect(view.list().map((item) => item.path)).toEqual(
      expect.arrayContaining([
        "src/types/server/services/blog.d.ts",
        "src/utils/_internal.ts",
        "test/unit/blog.test.ts",
      ]),
    );
  });

  it("does not invalidate source identity when generated output or mutable storage changes", async () => {
    const before = await inspect();
    await put(".vext/runtime/snapshot.json", '{"state":"ready"}');
    await put("dist/routes.js", "generated");
    await put("storage/uploads/data.txt", "mutable");
    expect((await inspect()).identity.contextRevision).toBe(
      before.identity.contextRevision,
    );
  });

  it("marks a budget-limited collection incomplete without a reusable revision", async () => {
    const result = await inspect({ maxFiles: 1 });
    expect(result.identity.sourceState).toBe("partial");
    expect(result.identity.contextRevision).toBeNull();
    expect(result.warnings.join(" ")).toContain(
      "Source inventory is incomplete",
    );
    await expect(
      collectAssistantSources(root, resolveAssistantRoles(), {
        limits: { maxFiles: 1 },
      }),
    ).rejects.toMatchObject({ code: "VEXT_SOURCE_LIMIT" });
  });

  it("preserves policy-selected directories even before the directory exists", async () => {
    await put(
      "vext.workspace.json",
      JSON.stringify({
        schemaVersion: 1,
        policyDefaults: { roles: { services: "src/domain/services" } },
      }),
    );
    const section = (await inspect()).snapshot.sections.services!;
    expect(section).toMatchObject({
      resolvedPath: "src/domain/services",
      actualPath: null,
      defaultPath: "src/services",
    });
  });

  it("includes declared workspace service and shared package source in revisions", async () => {
    await put(
      "vext.workspace.json",
      JSON.stringify({
        schemaVersion: 1,
        services: [{ id: "api", root: "apps/api", sharedPackages: ["models"] }],
        sharedPackages: [
          {
            id: "models",
            root: "packages/models",
            kind: "models",
            sourceExports: { ".": "src/index.ts" },
          },
        ],
      }),
    );
    await put(
      "apps/api/package.json",
      JSON.stringify({
        name: "api",
        dependencies: { "@fixture/models": "workspace:*" },
      }),
    );
    await put(
      "packages/models/package.json",
      JSON.stringify({
        name: "@fixture/models",
        version: "1.0.0",
        exports: { ".": "./dist/index.js" },
      }),
    );
    await put("apps/api/src/services/blog.ts", "export const version = 1;");
    await put("packages/models/src/index.ts", "export const version = 1;");
    const before = await inspect();
    expect(before.identity.sourceState).toBe("complete");
    await put("packages/models/src/index.ts", "export const version = 2;");
    const sharedEdit = await inspect();
    expect(sharedEdit.identity.contextRevision).not.toBe(
      before.identity.contextRevision,
    );
    await put("apps/api/src/services/blog.ts", "export const version = 2;");
    expect((await inspect()).identity.contextRevision).not.toBe(
      sharedEdit.identity.contextRevision,
    );
  });

  it("rejects escaped linked directories without reading the linked content", async () => {
    // Windows junctions do not need symlink privilege; the target is an existing ancestor outside this fixture.
    await symlink(
      parent,
      join(root, "src", "external"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const result = await inspect();
    expect(result.identity.sourceState).toBe("partial");
    expect(result.identity.contextRevision).toBeNull();
    expect(result.warnings.join(" ")).toContain("remain inside");
  });

  it("fails cancellation before discovery", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      collectAssistantSources(root, resolveAssistantRoles(), {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "VEXT_SOURCE_CANCELLED" });
  });
});
