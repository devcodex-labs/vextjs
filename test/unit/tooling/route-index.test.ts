import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildRouteIndex } from "../../../src/tooling/project-index/scan-routes.js";
import { runDoctor } from "../../../src/tooling/doctor/index.js";

async function writeProjectFile(
  rootDir: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const fullPath = join(rootDir, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf-8");
}

describe("buildRouteIndex", () => {
  let projectRoot: string;

  afterEach(async () => {
    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("extracts normalized route paths and docs metadata from defineRoutes files", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "vext-route-index-"));

    await writeProjectFile(
      projectRoot,
      "package.json",
      JSON.stringify({ name: "route-index", type: "module" }, null, 2),
    );
    await writeProjectFile(
      projectRoot,
      "tsconfig.json",
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
          },
          include: ["src/**/*.ts", "src/**/*.d.ts"],
        },
        null,
        2,
      ),
    );
    await writeProjectFile(
      projectRoot,
      "src/config/default.ts",
      "export default { port: 3000 }\n",
    );
    await writeProjectFile(
      projectRoot,
      "src/routes/api/v2/index.ts",
      `import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/health", {
    docs: {
      summary: "Health check",
      operationId: "getApiV2Health",
      tags: ["system", "health"],
    },
  }, async (_req, res) => {
    res.json({ ok: true });
  });
});
`,
    );

    const routeEntries = await buildRouteIndex(projectRoot);

    expect(routeEntries).toHaveLength(1);
    expect(routeEntries[0]).toMatchObject({
      fileRelativePath: "src/routes/api/v2/index.ts",
      method: "GET",
      prefix: "/api/v2",
      path: "/api/v2/health",
      docsSummary: "Health check",
      hasDocsSummary: true,
      operationId: "getApiV2Health",
      tags: ["system", "health"],
      hidden: false,
    });
  });

  it("uses the same route file exclusion policy as runtime loading", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "vext-route-index-policy-"));

    await writeProjectFile(
      projectRoot,
      "src/routes/.hidden.ts",
      `import { defineRoutes } from "vextjs";
export default defineRoutes((app) => {
  app.get("/", async (_req, res) => res.json({ hidden: true }));
});
`,
    );
    await writeProjectFile(
      projectRoot,
      "src/routes/users.test.ts",
      `import { defineRoutes } from "vextjs";
export default defineRoutes((app) => {
  app.get("/", async (_req, res) => res.json({ test: true }));
});
`,
    );
    await writeProjectFile(
      projectRoot,
      "src/routes/node_modules/pkg/route.ts",
      `import { defineRoutes } from "vextjs";
export default defineRoutes((app) => {
  app.get("/", async (_req, res) => res.json({ pkg: true }));
});
`,
    );
    await writeProjectFile(
      projectRoot,
      "src/routes/users.ts",
      `import { defineRoutes } from "vextjs";
export default defineRoutes((app) => {
  app.get("/", async (_req, res) => res.json({ ok: true }));
});
`,
    );

    const routeEntries = await buildRouteIndex(projectRoot);

    expect(routeEntries.map((entry) => entry.fileRelativePath)).toEqual([
      "src/routes/users.ts",
    ]);
    expect(routeEntries[0]?.path).toBe("/users");
  });

  it("projects literal RouteOptions.frontend into the build manifest identity", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "vext-route-index-freshness-"));
    await writeProjectFile(
      projectRoot,
      "src/routes/posts/[slug].ts",
      `import { defineRoutes } from "vextjs";
export default defineRoutes((app) => {
  app.get("/", {
    frontend: {
      mode: "static",
      staticParams: [{ slug: "hello", page: 2 }, {}],
      tags: ["posts", "news"],
      page: "posts/detail",
      staticBudget: { maxParams: 4, maxBytes: 4096 },
    },
  }, async (_req, res) => res.render("posts/detail"));
});
`,
    );

    const [entry] = await buildRouteIndex(projectRoot);

    expect(entry?.freshness).toEqual({
      mode: "static",
      source: "route-options",
      staticParams: [{ page: "2", slug: "hello" }, {}],
      tags: ["news", "posts"],
      page: "posts/detail",
      staticBudget: { maxParams: 4, maxBytes: 4096 },
    });
  });

  it("keeps literal response schemas and page-route classification in the static build manifest", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "vext-route-index-contract-"));
    await writeProjectFile(
      projectRoot,
      "src/routes/index.ts",
      `import { defineRoutes } from "vextjs";
export default defineRoutes((app) => {
  app.get("/", {}, async (_req, res) => {
    res.render("index", { message: "Hello" });
  });

  app.get("/api/health", {
    responses: {
      "2XX": {
        schema: {
          type: "object",
          properties: {
            status: { type: "string" },
            timestamp: { type: "number" },
          },
          required: ["status", "timestamp"],
          additionalProperties: false,
        },
      },
    },
    docs: {
      summary: "Health check",
      responses: {
        "2xx": {
          contentType: "application/json",
          description: "Healthy",
        },
      },
    },
  }, async (_req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });
});
`,
    );

    const result = await runDoctor({
      rootDir: projectRoot,
      target: "routes",
      refresh: true,
      writeManifest: true,
    });
    const page = result.routes.find((route) => route.path === "/");
    const api = result.routes.find((route) => route.path === "/api/health");

    expect(page?.docsKind).toBe("frontend-route");
    expect(api?.docsKind).toBe("backend-api");
    expect(api?.schema.responses[0]).toMatchObject({
      status: "2xx",
      contentType: "application/json",
      schema: {
        source: "responses",
        sourcePath: "responses.2xx.schema",
        schema: {
          type: "object",
          properties: {
            status: { type: "string" },
            timestamp: { type: "number" },
          },
          required: ["status", "timestamp"],
          additionalProperties: false,
        },
      },
    });

    const manifest = JSON.parse(
      await readFile(
        join(projectRoot, ".vext", "manifest", "routes.json"),
        "utf-8",
      ),
    ) as { routes: Array<{ path: string; docsKind: string; schema: unknown }> };
    expect(manifest.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/", docsKind: "frontend-route" }),
        expect.objectContaining({
          path: "/api/health",
          docsKind: "backend-api",
          schema: expect.objectContaining({
            responses: expect.arrayContaining([
              expect.objectContaining({
                status: "2xx",
                schema: expect.objectContaining({ source: "responses" }),
              }),
            ]),
          }),
        }),
      ]),
    );
  });
});
