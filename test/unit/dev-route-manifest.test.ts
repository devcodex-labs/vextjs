import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildDevRouteManifestPayload } from "../../src/lib/dev/route-manifest.js";
import type { RouteMetadata } from "../../src/lib/openapi/types.js";

const tempDirs: string[] = [];

function createTempRoot(): string {
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "vext-route-manifest-"),
  );
  tempDirs.push(rootDir);
  return rootDir;
}

describe("buildDevRouteManifestPayload", () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("maps dev compiled route files back to source-relative paths", () => {
    const rootDir = createTempRoot();
    const sourceFile = path.join(rootDir, "src", "routes", "admin", "users.ts");
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, "export default [];\n");

    const route: RouteMetadata = {
      method: "GET",
      path: "/admin/users",
      options: {
        docs: {
          summary: "List users",
          tags: ["Admin"],
        },
      },
      sourceFile: path.join(
        rootDir,
        ".vext",
        "dev",
        "routes",
        "admin",
        "users.js",
      ),
    };

    const payload = buildDevRouteManifestPayload(rootDir, [route]);

    expect(payload.routes[0]?.fileRelativePath).toBe(
      "src/routes/admin/users.ts",
    );
    expect(payload.routes[0]?.source).toBe("src/routes/admin/users.ts");
    expect(payload.routes[0]?.summary).toBe("List users");
    expect(payload.routeFileCount).toBe(1);
    expect(payload.routes[0]?.operationIdSource).toBe("inferred");
    expect(payload.routes[0]?.docsKind).toBe("backend-api");
  });

  it("preserves frontend document classification for downstream diagnostics", () => {
    const rootDir = createTempRoot();
    const route: RouteMetadata = {
      method: "GET",
      path: "/",
      options: {},
      sourceFile: path.join(rootDir, "src", "routes", "index.ts"),
      docsKind: "frontend-route",
    };

    const payload = buildDevRouteManifestPayload(rootDir, [route]);

    expect(payload.routes[0]).toMatchObject({
      source: "src/routes/index.ts",
      docsKind: "frontend-route",
    });
  });

  it("keeps non-dev source paths as portable project-relative paths", () => {
    const rootDir = createTempRoot();
    const route: RouteMetadata = {
      method: "POST",
      path: "/users",
      options: {
        docs: {
          summary: "Create user",
          operationId: "createUser",
        },
      },
      sourceFile: path.join(rootDir, "src", "routes", "users.ts"),
    };

    const payload = buildDevRouteManifestPayload(rootDir, [route]);

    expect(payload.routes[0]?.fileRelativePath).toBe("src/routes/users.ts");
    expect(payload.routes[0]?.operationId).toBe("createUser");
    expect(payload.routes[0]?.operationIdSource).toBe("explicit");
  });

  it("projects the existing route schemas into a stable contract manifest", () => {
    const rootDir = createTempRoot();
    const route: RouteMetadata = {
      method: "POST",
      path: "/users/:id",
      options: {
        validate: {
          param: { id: "objectId!" },
          query: { include: "boolean?" },
          header: { "x-trace-id": "string!" },
          cookie: { session: "string?" },
          body: {
            name: "string!",
            nickname: { type: ["string", "null"] },
            tags: ["string!"],
          },
        },
        docs: {
          responses: {
            201: {
              contentType: "application/json",
              schema: { id: "objectId!", active: "boolean!" },
            },
            204: { contentType: "text/plain" },
          },
        },
      },
      sourceFile: path.join(rootDir, "src", "routes", "users.ts"),
    };

    const payload = buildDevRouteManifestPayload(rootDir, [route]);
    const record = payload.routes[0];

    expect(record?.routeId).toMatch(/^route_[a-f0-9]{16}$/);
    expect(record?.schema.request.params?.sourcePath).toBe("validate.param");
    expect(
      record?.schema.request.body?.schema.properties?.nickname,
    ).toMatchObject({
      type: "string",
      nullable: true,
    });
    expect(record?.schema.request.cookies?.digest).toHaveLength(64);
    expect(record?.schema.responses).toHaveLength(2);
    expect(record?.schema.responses[0]).toMatchObject({
      status: "201",
      contentType: "application/json",
      schema: { sourcePath: "docs.responses.201.schema" },
    });
    expect(record?.schema.responses[1]).toEqual({
      status: "204",
      contentType: "text/plain",
    });
    expect(record?.freshness).toEqual({
      mode: "dynamic",
      source: "legacy-default",
    });
    expect(record?.layout).toEqual({ state: "unresolved", paths: [] });
  });
});
