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
    expect(payload.routeFileCount).toBe(1);
    expect(payload.routes[0]?.operationIdSource).toBe("inferred");
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
});
