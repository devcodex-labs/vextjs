import { describe, expect, it } from "vitest";
import {
  countOpenAPIOperations,
  filterCodeDocsItemsBySource,
  filterOpenAPIDocumentBySource,
  resolveDocsSource,
  resolveDocsSources,
} from "../../../src/lib/docs/sources/source-registry.js";
import type {
  ResolvedVextDocsConfig,
  VextDocsOpenAPIDocument,
} from "../../../src/lib/docs/types.js";

const spec: VextDocsOpenAPIDocument = {
  openapi: "3.0.3",
  info: { title: "Source Registry API", version: "1.0.0" },
  tags: [
    { name: "API v1" },
    { name: "API v2" },
    { name: "Admin v1" },
    { name: "General" },
  ],
  "x-tagGroups": [
    { name: "Versions", tags: ["API v1", "API v2"] },
    { name: "Admin", tags: ["Admin v1"] },
    { name: "Empty", tags: ["Missing"] },
  ],
  paths: {
    "/": {
      get: { tags: ["General"], responses: { 200: { description: "OK" } } },
    },
    "/api/v1/info": {
      get: { tags: ["API v1"], responses: { 200: { description: "OK" } } },
      post: {
        tags: ["API v1"],
        responses: { 201: { description: "Created" } },
      },
    },
    "/api/v2/info": {
      get: { tags: ["API v2"], responses: { 200: { description: "OK" } } },
    },
    "/admin/v1/users": {
      get: { tags: ["Admin v1"], responses: { 200: { description: "OK" } } },
    },
  },
};

function config(
  sources: ResolvedVextDocsConfig["sources"] = [],
): ResolvedVextDocsConfig {
  return {
    path: "/docs",
    assetsPath: "/_vext/docs",
    specPath: "/openapi.json",
    specPublicPath: "/openapi.json",
    renderer: "vext",
    ui: {
      title: "Docs",
      tryItOut: true,
      defaultView: "overview",
      theme: "system",
      density: "comfortable",
    },
    code: {
      enabled: "auto",
      services: true,
      utils: true,
      models: true,
      components: true,
      plugins: true,
      middlewares: true,
      locales: false,
      config: false,
      preload: false,
      styles: false,
      scan: "lazy",
    },
    access: { mode: "off", openapiJson: "filtered" },
    tryItOut: { hookGlobal: "VextDocsHooks" },
    sources,
    endpoints: {
      page: "/docs",
      openapi: "/_vext/docs/openapi.json",
      config: "/_vext/docs/config.json",
      code: "/_vext/docs/code.json",
      search: "/_vext/docs/search.json",
      source: "/_vext/docs/source",
      appJs: "/_vext/docs/app.js",
      styleCss: "/_vext/docs/style.css",
    },
  };
}

const codeItems = [
  {
    id: "service:public#list",
    title: "services.public.list",
    sourceFile: "services/public.ts",
  },
  {
    id: "service:admin#list",
    title: "services.admin.list",
    sourceFile: "services/admin.ts",
  },
  {
    id: "model:Product#default",
    title: "models.Product",
    sourceFile: "models/product.ts",
  },
];

describe("docs source registry", () => {
  it("creates a single catch-all source when no versioned namespace exists", () => {
    const sources = resolveDocsSources(
      { ...spec, paths: { "/health": spec.paths!["/"]! } },
      config(),
    );

    expect(sources).toEqual([
      expect.objectContaining({
        id: "all",
        label: "All",
        default: true,
        operationCount: 1,
      }),
    ]);
    expect(resolveDocsSource(sources)?.id).toBe("all");
  });

  it("keeps a single versioned source group as catch-all only", () => {
    const sources = resolveDocsSources(
      { ...spec, paths: { "/api/v1/info": spec.paths!["/api/v1/info"]! } },
      config(),
    );

    expect(sources).toEqual([
      expect.objectContaining({
        id: "all",
        label: "All",
        default: true,
        operationCount: 2,
      }),
    ]);
  });

  it("infers namespaced API sources and keeps the catch-all source first", () => {
    const sources = resolveDocsSources(spec, config());

    expect(sources.map((source) => source.id)).toEqual([
      "all",
      "admin-v1",
      "api-v1",
      "api-v2",
    ]);
    expect(sources.find((source) => source.id === "api-v1")).toMatchObject({
      label: "API v1",
      match: ["/api/v1/**"],
      operationCount: 2,
      auto: true,
    });
    expect(sources.find((source) => source.id === "admin-v1")).toMatchObject({
      label: "Admin v1",
      match: ["/admin/v1/**"],
      operationCount: 1,
    });
  });

  it("normalizes explicit sources, assigns the first default and counts operations", () => {
    const sources = resolveDocsSources(
      spec,
      config([
        {
          id: "public-v1",
          label: "Public v1",
          match: ["/api/v1/**"],
          default: false,
        },
        {
          id: "admin-v1",
          label: "Admin v1",
          match: ["/admin/v1/**"],
          default: false,
        },
      ]),
    );

    expect(sources).toEqual([
      expect.objectContaining({
        id: "public-v1",
        default: true,
        operationCount: 2,
      }),
      expect.objectContaining({
        id: "admin-v1",
        default: false,
        operationCount: 1,
      }),
    ]);
    expect(resolveDocsSource(sources, "missing")).toBeUndefined();
  });

  it("filters OpenAPI paths, tags and tagGroups for selected sources", () => {
    const sources = resolveDocsSources(spec, config());
    const v1 = sources.find((source) => source.id === "api-v1")!;
    const filtered = filterOpenAPIDocumentBySource(spec, v1);

    expect(Object.keys(filtered.paths ?? {})).toEqual(["/api/v1/info"]);
    expect(countOpenAPIOperations(filtered)).toBe(2);
    expect(filtered.tags).toEqual([{ name: "API v1" }]);
    expect(filtered["x-tagGroups"]).toEqual([
      { name: "Versions", tags: ["API v1"] },
    ]);
  });

  it("returns the original OpenAPI document for catch-all sources", () => {
    const filtered = filterOpenAPIDocumentBySource(spec, {
      id: "all",
      label: "All",
      match: ["/api/v1/**"],
      default: true,
    });

    expect(filtered).toBe(spec);
  });

  it("infers root version sources and skips paths without operations", () => {
    const rootVersionSpec: VextDocsOpenAPIDocument = {
      ...spec,
      paths: {
        "/v3/info": {
          get: { tags: ["API v3"], responses: { 200: { description: "OK" } } },
        },
        "/v3/users": {
          get: { tags: ["API v3"], responses: { 200: { description: "OK" } } },
        },
        "/v4/info": {
          get: { tags: ["API v4"], responses: { 200: { description: "OK" } } },
        },
        "/beta/info": {
          get: {
            tags: ["API Beta"],
            responses: { 200: { description: "OK" } },
          },
        },
        "/api/v4/metadata": {
          parameters: [],
        },
        "/api/v5/invalid": null,
      },
    };
    const sources = resolveDocsSources(rootVersionSpec, config());

    expect(sources.map((source) => source.id)).toEqual([
      "all",
      "api-v3",
      "api-v4",
      "api-beta",
    ]);
    expect(sources[1]).toMatchObject({
      label: "API v3",
      match: ["/v3/**"],
      operationCount: 2,
    });
    expect(sources.find((source) => source.id === "api-beta")).toMatchObject({
      label: "API Beta",
      match: ["/beta/**"],
      operationCount: 1,
    });
    const v3 = sources.find((source) => source.id === "api-v3")!;
    const filtered = filterOpenAPIDocumentBySource(rootVersionSpec, v3);
    expect(Object.keys(filtered.paths ?? {})).toEqual([
      "/v3/info",
      "/v3/users",
    ]);
    expect(countOpenAPIOperations(filtered)).toBe(2);
  });

  it("orders numbered version sources before named release channels", () => {
    const mixedOrderSpec: VextDocsOpenAPIDocument = {
      ...spec,
      paths: {
        "/api/beta/info": {
          get: {
            tags: ["API Beta"],
            responses: { 200: { description: "OK" } },
          },
        },
        "/api/v10/info": {
          get: { tags: ["API v10"], responses: { 200: { description: "OK" } } },
        },
        "/api/rc1/info": {
          get: { tags: ["API RC1"], responses: { 200: { description: "OK" } } },
        },
        "/api/v2/info": {
          get: { tags: ["API v2"], responses: { 200: { description: "OK" } } },
        },
        "/api/alpha/info": {
          get: {
            tags: ["API Alpha"],
            responses: { 200: { description: "OK" } },
          },
        },
        "/api/v1/info": {
          get: { tags: ["API v1"], responses: { 200: { description: "OK" } } },
        },
      },
    };
    const sources = resolveDocsSources(mixedOrderSpec, config());

    expect(sources.map((source) => source.id)).toEqual([
      "all",
      "api-v1",
      "api-v2",
      "api-v10",
      "api-alpha",
      "api-beta",
      "api-rc1",
    ]);
    expect(sources.find((source) => source.id === "api-rc1")).toMatchObject({
      label: "API RC1",
    });
  });

  it("merges root and namespaced version patterns under the same API source", () => {
    const mixedVersionSpec: VextDocsOpenAPIDocument = {
      ...spec,
      paths: {
        "/v1/info": {
          get: { tags: ["API v1"], responses: { 200: { description: "OK" } } },
        },
        "/api/v1/users": {
          get: { tags: ["API v1"], responses: { 200: { description: "OK" } } },
        },
        "/api/v2/info": {
          get: { tags: ["API v2"], responses: { 200: { description: "OK" } } },
        },
        "/api/beta/info": {
          get: {
            tags: ["API Beta"],
            responses: { 200: { description: "OK" } },
          },
        },
        "/beta/info": {
          get: {
            tags: ["API Beta"],
            responses: { 200: { description: "OK" } },
          },
        },
      },
    };
    const sources = resolveDocsSources(mixedVersionSpec, config());
    const v1 = sources.find((source) => source.id === "api-v1")!;
    const filtered = filterOpenAPIDocumentBySource(mixedVersionSpec, v1);

    expect(sources.map((source) => source.id)).toEqual([
      "all",
      "api-v1",
      "api-v2",
      "api-beta",
    ]);
    expect(v1).toMatchObject({
      label: "API v1",
      match: ["/v1/**", "/api/v1/**"],
      operationCount: 2,
    });
    expect(Object.keys(filtered.paths ?? {})).toEqual([
      "/v1/info",
      "/api/v1/users",
    ]);
    expect(countOpenAPIOperations(filtered)).toBe(2);
    const beta = sources.find((source) => source.id === "api-beta")!;
    const betaFiltered = filterOpenAPIDocumentBySource(mixedVersionSpec, beta);
    expect(beta).toMatchObject({
      label: "API Beta",
      match: ["/api/beta/**", "/beta/**"],
      operationCount: 2,
    });
    expect(Object.keys(betaFiltered.paths ?? {})).toEqual([
      "/api/beta/info",
      "/beta/info",
    ]);
  });

  it("keeps malformed tag groups while removing empty valid groups", () => {
    const malformedTagGroupsSpec = {
      ...spec,
      "x-tagGroups": [
        "legacy",
        null,
        { name: "Versions", tags: ["API v1", "Missing"] },
        { name: "Invalid", tags: "not-an-array" },
        { name: "Empty", tags: ["Missing"] },
      ],
    } as VextDocsOpenAPIDocument;
    const filtered = filterOpenAPIDocumentBySource(malformedTagGroupsSpec, {
      id: "api-v1",
      label: "API v1",
      match: ["/api/v1/**"],
      default: false,
    });

    expect(filtered["x-tagGroups"]).toEqual([
      "legacy",
      null,
      { name: "Versions", tags: ["API v1"] },
      { name: "Invalid", tags: "not-an-array" },
    ]);
  });

  it("handles empty paths and missing tag metadata", () => {
    const emptySpec = {
      openapi: "3.0.3",
      info: { title: "Empty", version: "1.0.0" },
    } as VextDocsOpenAPIDocument;
    const sources = resolveDocsSources(emptySpec, config());
    const filtered = filterOpenAPIDocumentBySource(
      {
        openapi: "3.0.3",
        info: { title: "No Tags", version: "1.0.0" },
        paths: spec.paths,
      } as VextDocsOpenAPIDocument,
      {
        id: "api-v1",
        label: "API v1",
        match: ["/api/v1/**"],
        default: false,
      },
    );

    expect(countOpenAPIOperations(emptySpec)).toBe(0);
    expect(sources).toEqual([
      expect.objectContaining({ id: "all", operationCount: 0 }),
    ]);
    expect(filtered.tags).toBeUndefined();
    expect(filtered["x-tagGroups"]).toBeUndefined();
  });

  it("supports exact, single-level and recursive path patterns", () => {
    const exact = filterOpenAPIDocumentBySource(spec, {
      id: "exact",
      label: "Exact",
      match: ["/api/v2/info"],
      default: false,
    });
    const single = filterOpenAPIDocumentBySource(spec, {
      id: "single",
      label: "Single",
      match: ["/api/v1/*"],
      default: false,
    });
    const recursive = filterOpenAPIDocumentBySource(spec, {
      id: "recursive",
      label: "Recursive",
      match: ["/api/**"],
      default: false,
    });

    expect(Object.keys(exact.paths ?? {})).toEqual(["/api/v2/info"]);
    expect(Object.keys(single.paths ?? {})).toEqual(["/api/v1/info"]);
    expect(Object.keys(recursive.paths ?? {})).toEqual([
      "/api/v1/info",
      "/api/v2/info",
    ]);
  });

  it("supports wildcard and trimmed source patterns", () => {
    const wildcard = filterOpenAPIDocumentBySource(spec, {
      id: "wildcard",
      label: "Wildcard",
      match: [" * "],
      default: false,
    });

    expect(Object.keys(wildcard.paths ?? {})).toEqual(Object.keys(spec.paths));
  });

  it("keeps code docs only for catch-all sources unless code filters are explicit", () => {
    const all = filterCodeDocsItemsBySource(codeItems, {
      id: "all",
      label: "All",
      match: ["**"],
      default: true,
    });
    const scopedWithoutCodeRules = filterCodeDocsItemsBySource(codeItems, {
      id: "api-v1",
      label: "API v1",
      match: ["/api/v1/**"],
      default: false,
    });
    const scopedWithCodeRules = filterCodeDocsItemsBySource(codeItems, {
      id: "admin",
      label: "Admin",
      match: ["/admin/**"],
      default: false,
      code: { include: ["admin"], exclude: ["model:*"] },
    });
    const scopedWithExcludeOnly = filterCodeDocsItemsBySource(codeItems, {
      id: "exclude-public",
      label: "Exclude Public",
      match: ["/api/**"],
      default: false,
      code: { exclude: ["*public*"] },
    });
    const scopedWithWildcardInclude = filterCodeDocsItemsBySource(codeItems, {
      id: "wildcard",
      label: "Wildcard",
      match: ["/api/**"],
      default: false,
      code: { include: ["*"], exclude: [" "] },
    });
    const scopedWithIncludeOnlyAndMissingFields = filterCodeDocsItemsBySource(
      [
        {},
        {
          id: "service:admin#missing-fields",
        },
      ],
      {
        id: "include-admin",
        label: "Include Admin",
        match: ["/api/**"],
        default: false,
        code: { include: ["admin"] },
      },
    );
    const explicitCatchAllWithCodeRules = filterCodeDocsItemsBySource(
      codeItems,
      {
        id: "public-all",
        label: "Public All",
        match: ["/**"],
        default: false,
        code: { include: ["models/*"] },
      },
    );
    const scopedWithNestedModelGlob = filterCodeDocsItemsBySource(
      [
        ...codeItems,
        {
          id: "model:BillingInvoice#default",
          title: "models.BillingInvoice",
          sourceFile: "models/billing/invoice.ts",
        },
      ],
      {
        id: "models",
        label: "Models",
        match: ["/api/**"],
        default: false,
        code: { include: ["models/**"] },
      },
    );

    expect(all).toHaveLength(3);
    expect(scopedWithoutCodeRules).toEqual([]);
    expect(scopedWithCodeRules.map((item) => item.id)).toEqual([
      "service:admin#list",
    ]);
    expect(scopedWithExcludeOnly.map((item) => item.id)).toEqual([
      "service:admin#list",
      "model:Product#default",
    ]);
    expect(scopedWithWildcardInclude).toHaveLength(3);
    expect(scopedWithIncludeOnlyAndMissingFields).toEqual([
      { id: "service:admin#missing-fields" },
    ]);
    expect(explicitCatchAllWithCodeRules.map((item) => item.id)).toEqual([
      "model:Product#default",
    ]);
    expect(scopedWithNestedModelGlob.map((item) => item.id)).toEqual([
      "model:Product#default",
      "model:BillingInvoice#default",
    ]);
  });
});
