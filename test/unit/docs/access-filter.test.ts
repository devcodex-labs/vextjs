import { describe, expect, it, vi } from "vitest";
import {
  buildDocsMenu,
  createDocsSearchIndex,
  filterCodeDocsForDocs,
  filterOpenAPIDocumentForDocs,
} from "../../../src/lib/docs/index.js";
import type {
  VextCodeDocsDocument,
  ResolvedVextDocsAccessConfig,
  VextDocsOpenAPIDocument,
} from "../../../src/lib/docs/index.js";

const spec: VextDocsOpenAPIDocument = {
  openapi: "3.0.0",
  info: { title: "Test API", version: "1.0.0" },
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
        responses: { 200: { description: "OK" } },
      },
    },
    "/admin": {
      get: {
        tags: ["admin"],
        operationId: "adminStats",
        responses: { 200: { description: "OK" } },
      },
    },
  },
};

function access(
  overrides: Partial<ResolvedVextDocsAccessConfig>,
): ResolvedVextDocsAccessConfig {
  return {
    mode: "off",
    openapiJson: "filtered",
    ...overrides,
  };
}

describe("filterOpenAPIDocumentForDocs", () => {
  it("does not filter when access mode is off", async () => {
    const filtered = await filterOpenAPIDocumentForDocs(
      spec,
      access({ mode: "off", resolver: () => false }),
    );

    expect(filtered).toBe(spec);
  });

  it("filters operations, tags and tagGroups in enforce mode", async () => {
    const filtered = await filterOpenAPIDocumentForDocs(
      spec,
      access({
        mode: "enforce",
        resolver: ({ descriptor }) => descriptor.path !== "/admin",
      }),
    );

    expect(filtered.paths?.["/users"]).toBeDefined();
    expect(filtered.paths?.["/admin"]).toBeUndefined();
    expect(filtered.tags).toEqual([{ name: "users" }]);
    expect(filtered["x-tagGroups"]).toEqual([
      { name: "Public", tags: ["users"] },
    ]);
  });

  it("marks visible operations when try it out is denied", async () => {
    const filtered = await filterOpenAPIDocumentForDocs(
      spec,
      access({
        mode: "enforce",
        resolver: () => ({ visible: true, tryItOut: false }),
      }),
    );

    const operation = filtered.paths?.["/users"]?.get as Record<
      string,
      unknown
    >;
    expect(operation["x-vext-docs-tryItOut"]).toBe(false);
  });

  it("passes route string access metadata to operation descriptors", async () => {
    const resolver = vi.fn(({ descriptor }) => {
      if (descriptor.kind === "operation" && descriptor.access === "admin") {
        return false;
      }
      return true;
    });
    const filtered = await filterOpenAPIDocumentForDocs(
      {
        ...spec,
        paths: {
          "/admin": {
            get: {
              tags: ["admin"],
              operationId: "adminStats",
              "x-vext-docs-access": "admin",
              responses: { 200: { description: "OK" } },
            },
          },
        },
      },
      access({ mode: "enforce", resolver }),
    );

    expect(filtered.paths?.["/admin"]).toBeUndefined();
    expect(resolver).toHaveBeenCalledWith(
      expect.objectContaining({
        descriptor: expect.objectContaining({
          kind: "operation",
          path: "/admin",
          access: "admin",
        }),
      }),
    );
  });

  it("hides operations with route access visible false before resolver", async () => {
    const resolver = vi.fn(() => true);
    const filtered = await filterOpenAPIDocumentForDocs(
      {
        ...spec,
        paths: {
          "/internal": {
            get: {
              tags: ["admin"],
              operationId: "internalStats",
              "x-vext-docs-access": { visible: false },
              responses: { 200: { description: "OK" } },
            },
          },
        },
      },
      access({ mode: "enforce", resolver }),
    );

    expect(filtered.paths?.["/internal"]).toBeUndefined();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("passes route object access metadata and applies try it out restriction", async () => {
    const resolver = vi.fn(({ descriptor }) => {
      if (
        descriptor.kind === "operation" &&
        typeof descriptor.access === "object" &&
        descriptor.access?.group === "admin"
      ) {
        return true;
      }
      return false;
    });
    const filtered = await filterOpenAPIDocumentForDocs(
      {
        ...spec,
        paths: {
          "/admin": {
            get: {
              tags: ["admin"],
              operationId: "adminStats",
              "x-vext-docs-access": {
                group: "admin",
                tryItOut: false,
              },
              responses: { 200: { description: "OK" } },
            },
          },
        },
      },
      access({ mode: "enforce", resolver }),
    );

    const operation = filtered.paths?.["/admin"]?.get as Record<
      string,
      unknown
    >;
    expect(operation["x-vext-docs-tryItOut"]).toBe(false);
    expect(resolver).toHaveBeenCalledWith(
      expect.objectContaining({
        descriptor: expect.objectContaining({
          kind: "operation",
          path: "/admin",
          access: expect.objectContaining({
            group: "admin",
            tryItOut: false,
          }),
        }),
      }),
    );
  });

  it("filters docs view data in visibility-only mode", async () => {
    const filtered = await filterOpenAPIDocumentForDocs(
      spec,
      access({
        mode: "visibility-only",
        resolver: ({ descriptor }) => descriptor.path !== "/admin",
      }),
      undefined,
      { includeVisibilityOnly: true },
    );

    expect(filtered.paths?.["/users"]).toBeDefined();
    expect(filtered.paths?.["/admin"]).toBeUndefined();
  });

  it("keeps canonical data public in visibility-only mode by default", async () => {
    const filtered = await filterOpenAPIDocumentForDocs(
      spec,
      access({
        mode: "visibility-only",
        resolver: ({ descriptor }) => descriptor.path !== "/admin",
      }),
    );

    expect(filtered).toBe(spec);
  });
});

describe("filterCodeDocsForDocs", () => {
  const codeDocs: VextCodeDocsDocument = {
    items: [
      {
        id: "service:users#list",
        kind: "service",
        title: "services.users.list",
        sourceFile: "services/users.ts",
        exportName: "list",
        summary: "List users",
      },
      {
        id: "service:admin#stats",
        kind: "service",
        title: "services.admin.stats",
        sourceFile: "services/admin.ts",
        exportName: "stats",
        summary: "Admin stats",
      },
      {
        id: "utils:date#formatDate",
        kind: "utils",
        title: "utils/date#formatDate",
        sourceFile: "utils/date.ts",
        exportName: "formatDate",
        summary: "Format date",
      },
      {
        id: "model:Product#default",
        kind: "model",
        title: "models.Product",
        sourceFile: "models/product.ts",
        exportName: "default",
        summary: "Product model",
      },
      {
        id: "component:app-shell#AppShell",
        kind: "component",
        title: "components/app-shell#AppShell",
        sourceFile: "frontend/components/app-shell.tsx",
        exportName: "AppShell",
        summary: "Application shell component",
      },
    ],
  };

  it("filters Code JSDoc entries in enforce mode", async () => {
    const filtered = await filterCodeDocsForDocs(
      codeDocs,
      access({
        mode: "enforce",
        resolver: ({ descriptor }) => descriptor.id !== "service:admin#stats",
      }),
    );

    expect(filtered.items.map((item) => item.id)).toEqual([
      "service:users#list",
      "utils:date#formatDate",
      "model:Product#default",
      "component:app-shell#AppShell",
    ]);
  });

  it("filters Code JSDoc entries in visibility-only view mode", async () => {
    const filtered = await filterCodeDocsForDocs(
      codeDocs,
      access({
        mode: "visibility-only",
        resolver: ({ descriptor }) => descriptor.kind !== "utils",
      }),
      undefined,
      { includeVisibilityOnly: true },
    );

    expect(filtered.items.map((item) => item.kind)).toEqual([
      "service",
      "service",
      "model",
      "component",
    ]);
  });

  it("builds search index and menu from filtered docs", async () => {
    const filtered = await filterCodeDocsForDocs(
      codeDocs,
      access({
        mode: "enforce",
        resolver: ({ descriptor }) => descriptor.id !== "service:admin#stats",
      }),
    );
    const search = createDocsSearchIndex(filtered, spec);
    const menu = buildDocsMenu(spec, filtered);

    expect(search.items.map((item) => item.id)).toContain("listUsers");
    expect(search.items.map((item) => item.id)).not.toContain(
      "service:admin#stats",
    );
    expect(JSON.stringify(menu)).not.toContain("service:admin#stats");
    expect(menu.items.map((item) => item.id)).toEqual(
      expect.arrayContaining(["group:backend-api", "group:service"]),
    );
  });

  it("separates backend API and frontend routes while keeping code groups top-level", () => {
    const docsSpec: VextDocsOpenAPIDocument = {
      ...spec,
      tags: [{ name: "users" }, { name: "frontend" }],
      "x-tagGroups": [
        { name: "Backend", tags: ["users"] },
        { name: "Pages", tags: ["frontend"] },
      ],
      paths: {
        "/users": spec.paths?.["/users"] as Record<string, unknown>,
        "/frontend/render": {
          get: {
            tags: ["frontend"],
            operationId: "renderFrontendPage",
            "x-vext-docs-kind": "frontend-route",
            responses: { 200: { description: "HTML page" } },
          },
        },
      },
    };

    const menu = buildDocsMenu(docsSpec, codeDocs);
    const topLevelIds = menu.items.map((item) => item.id);
    const menuText = JSON.stringify(menu);

    expect(topLevelIds).toEqual(
      expect.arrayContaining([
        "group:backend-api",
        "group:frontend-routes",
        "group:service",
        "group:utils",
        "group:model",
        "group:component",
      ]),
    );
    expect(menuText).toContain("GET /frontend/render");
    expect(menuText).toContain("Services");
    expect(menuText).toContain("Utils");
    expect(menuText).toContain("Models");
    expect(menuText).toContain("Components");
  });
});
