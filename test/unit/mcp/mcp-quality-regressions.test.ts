import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inspectVextProject } from "../../../src/assistant/project-inspector.js";
import { createVextMcpServer } from "../../../src/mcp/server.js";

interface ToolPayload {
  schemaVersion?: number;
  items?: Array<Record<string, unknown>>;
  total?: number;
  nextCursor?: string;
  details?: Record<string, unknown>;
  status: string;
  policy?: { digest: string; patch: { roles?: Record<string, string> } };
  identity?: { projectId: string; contextRevision: string | null };
  data?: {
    identity?: { projectId: string; contextRevision: string | null };
    verdict?: string;
    staticVerdict?: string;
    applyReady?: boolean;
    totalBySeverity?: Record<string, number>;
    totals?: Record<string, number>;
    diagnostics?: unknown[];
    changeSet?: { files: Array<{ path: string; content: string }> };
  };
}

let rootDir: string;
let tempParent: string;
let client: Client;
let server: ReturnType<typeof createVextMcpServer>;

async function put(relative: string, content: string): Promise<void> {
  const target = join(rootDir, relative);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const response = await client.callTool({ name, arguments: args });
  const payload = response.structuredContent as unknown as ToolPayload;
  expect(payload, JSON.stringify(response.content)).toBeDefined();
  return {
    payload,
    data: payload.data,
    isError: response.isError === true || payload.status === "error",
  };
}

async function identity() {
  const response = await call("vext_project_inspect", { section: "identity" });
  expect(response.isError).toBe(false);
  const current = response.data?.identity ?? response.payload.identity;
  expect(current).toBeDefined();
  return {
    projectId: current!.projectId,
    contextRevision: current!.contextRevision,
  };
}

async function validate(files: Array<{ path: string; content: string }>) {
  return call("vext_validate_changes", {
    profile: "strict",
    expectedIdentity: await identity(),
    files: files.map((file) => ({
      ...file,
      action: "create",
      encoding: "utf8",
    })),
  });
}

describe("candidate identity and shared checks", () => {
  it("reports a wrapped request schema while keeping legitimate DSL field names valid", async () => {
    await put(
      "src/routes/schema-boundary.js",
      `import { defineRoutes } from "vextjs";
export default defineRoutes(app => {
  app.post("/wrapped", { validate: { body: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false } }, responses: { 200: { schema: { ok: "boolean!" } } } }, (_req, res) => res.json({ ok: true }));
  app.post("/fields", { validate: { body: { type: "string!", properties: "string!" } }, responses: { 200: { schema: { ok: "boolean!" } } } }, (_req, res) => res.json({ ok: true }));
});`,
    );
    const inspected = await inspectVextProject({
      rootDir,
      frameworkVersion: "2.0.0",
    });
    const findings = inspected.diagnostics.filter(
      (item) => item.code === "VEXT_MCP_REQUEST_SCHEMA_BOUNDARY_REVIEW",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("/wrapped");
    expect(findings[0]?.evidence).toBe("review");
  });

  it("checks a supplied content digest and adds browser dependency checks in strict mode", async () => {
    const invalidDigest = await call("vext_validate_changes", {
      files: [
        {
          path: "src/utils/value.ts",
          content: "export const value = 1;",
          sha256: "0".repeat(64),
        },
      ],
    });
    expect(verdict(invalidDigest)).toBe("invalid");
    const files = [
      {
        path: "src/frontend/lib/data.ts",
        content:
          "import fs from 'node:fs'; export const load = () => fs.readFileSync('data.txt');",
      },
    ];
    expect(
      verdict(
        await call("vext_validate_changes", { profile: "standard", files }),
      ),
    ).toBe("valid");
    expect(
      verdict(
        await call("vext_validate_changes", { profile: "strict", files }),
      ),
    ).toBe("invalid");
  });

  it("requires host evidence for an active custom rule with no executable checker", async () => {
    const result = await call("vext_validate_changes", {
      files: [
        { path: "src/utils/value.ts", content: "export const value = 1;" },
      ],
      policyPatch: { rules: [{ id: "company-review", level: "warning" }] },
    });
    expect(verdict(result)).toBe("incomplete");
    expect(result.data?.applyReady).toBe(false);
  });

  it("requires a current identity before files can be marked applicable", async () => {
    const files = [
      { path: "src/utils/example.ts", content: "export const value = 1;" },
    ];
    const draft = await call("vext_validate_changes", { files });
    expect(verdict(draft)).toBe("valid");
    expect(draft.data?.applyReady).toBe(false);
    expect((await validate(files)).data?.applyReady).toBe(true);
  });

  it("uses service dependency checks for the complete candidate overlay", async () => {
    await put(
      "src/services/left.ts",
      "export default app => ({ run: () => app.services.right.run() });",
    );
    expect(
      verdict(
        await validate([
          {
            path: "src/services/right.ts",
            content:
              "export default app => ({ run: () => app.services.left.run() });",
          },
        ]),
      ),
    ).toBe("invalid");
    await put(
      "src/services/right.ts",
      "export default app => ({ run: () => app.services.left.run() });",
    );
    expect(
      verdict(await call("vext_project_check", { domain: "services" })),
    ).toBe("invalid");
  });

  it("applies user convention overrides to candidate checks without weakening syntax checks", async () => {
    const policyPatch = {
      rules: [
        {
          id: "VEXT_MCP_ROUTE_RESPONSE_SCHEMA_MISSING",
          level: "off",
        },
      ],
    };
    const files = [
      {
        path: "src/routes/example.ts",
        content:
          "export default app => { app.get('/', {}, (req, res) => res.json({})); };",
      },
    ];
    expect(
      verdict(await call("vext_validate_changes", { files, policyPatch })),
    ).toBe("valid");
    expect(
      verdict(
        await call("vext_validate_changes", {
          files: [{ ...files[0], content: "export default { broken: ; };" }],
          policyPatch,
        }),
      ),
    ).toBe("invalid");
  });
});

function verdict(response: Awaited<ReturnType<typeof call>>) {
  return response.data?.staticVerdict ?? response.data?.verdict;
}

beforeEach(async () => {
  tempParent = await realpath(tmpdir());
  rootDir = await mkdtemp(join(tempParent, "vext-mcp-quality-"));
  await put(
    "package.json",
    JSON.stringify({
      name: "quality-fixture",
      type: "module",
      dependencies: { vextjs: "2.0.0" },
    }),
  );
  await put(
    "src/config/default.js",
    "export default { rateLimit: { enabled: false } };\n",
  );
  await put(
    "src/routes/index.js",
    'export default app => { app.get("/a", {}, (req, res) => res.json({ ok: true })); };\n',
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  server = createVextMcpServer({ rootDir, version: "2.0.0" });
  client = new Client(
    { name: "vext-quality-regression", version: "1.0.0" },
    { versionNegotiation: { mode: "legacy" } },
  );
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterEach(async () => {
  // 即使断言或连接关闭失败，也只清理本用例创建的临时目录。
  try {
    await Promise.all([client?.close(), server?.close()]);
  } finally {
    if (rootDir) {
      const target = await realpath(rootDir);
      expect(dirname(target)).toBe(tempParent);
      await rm(target, { recursive: true, force: true });
    }
  }
});

describe("MCP quality regressions: content and project identity", () => {
  it("changes the revision after an equal-length source edit with restored mtime (M03)", async () => {
    const routePath = join(rootDir, "src/routes/index.js");
    const beforeStat = await stat(routePath);
    const before = await identity();
    await put(
      "src/routes/index.js",
      'export default app => { app.get("/b", {}, (req, res) => res.json({ ok: true })); };\n',
    );
    await utimes(routePath, beforeStat.atime, beforeStat.mtime);
    expect((await stat(routePath)).size).toBe(beforeStat.size);
    expect((await identity()).contextRevision).not.toBe(before.contextRevision);
  });

  it("rejects the wrong expected identity in inspect (M03)", async () => {
    const response = await call("vext_project_inspect", {
      section: "identity",
      expectedIdentity: {
        projectId: "0".repeat(64),
        contextRevision: "0".repeat(64),
      },
    });
    expect(response.isError).toBe(true);
  });

  it("retains a known MCP setting beside an unrelated dynamic field (M08)", async () => {
    await put(
      "src/config/default.js",
      "export default { dev: { mcp: { enabled: true } }, database: { uri: process.env.MONGO_URI } };\n",
    );
    const project = await inspectVextProject({
      rootDir,
      frameworkVersion: "2.0.0",
    });
    expect(project.assistant.devMcp.enabled).toBe(true);
  });
});

describe("MCP quality regressions: policy isolation", () => {
  it("applies request policy to inspection and validation without leaking (M09)", async () => {
    await put(
      "vext.workspace.json",
      JSON.stringify({
        schemaVersion: 1,
        policyDefaults: { roles: { mocks: "mocks/data" } },
      }),
    );
    const baseline = await identity();
    const policyPatch = { roles: { services: "src/domain/services" } };
    const scoped = await call("vext_project_inspect", { policyPatch });
    expect(scoped.payload.policy?.patch.roles).toMatchObject({
      services: "src/domain/services",
      mocks: "mocks/data",
    });
    const scopedIdentity = {
      projectId: scoped.payload.identity!.projectId,
      contextRevision: scoped.payload.identity!.contextRevision,
    };
    expect(scopedIdentity.contextRevision).not.toBe(baseline.contextRevision);
    const files = [
      {
        path: "src/domain/services/new.js",
        content: "export default class Service {}",
        action: "create",
        encoding: "utf8",
      },
    ];
    expect(
      verdict(
        await call("vext_validate_changes", {
          files,
          policyPatch,
          expectedIdentity: scopedIdentity,
        }),
      ),
    ).toBe("valid");
    expect(
      (
        await call("vext_validate_changes", {
          files,
          expectedIdentity: scopedIdentity,
        })
      ).isError,
    ).toBe(true);
    expect(await identity()).toEqual(baseline);
    const resource = await client.readResource({
      uri: "vext://project/snapshot",
    });
    const persistent = JSON.parse(
      (resource.contents[0] as { text: string }).text,
    );
    expect(persistent.policy.patch.roles.services).toBeUndefined();
    expect(persistent.identity.contextRevision).toBe(baseline.contextRevision);
  });
});
describe("MCP source inspection projections", () => {
  it("returns real route facts with identity-bound pages and resource parity", async () => {
    await put(
      "src/routes/index.js",
      'export default app => { app.get("/a", {}, (req, res) => res.json({ ok: true })); app.get("/b", {}, (req, res) => res.json({ ok: true })); };',
    );
    const first = await call("vext_project_inspect", {
      section: "routes",
      limit: 1,
    });
    expect(first.payload.schemaVersion).toBe(2);
    expect(first.payload.items?.[0]).toMatchObject({
      method: "GET",
      path: "/a",
      sourceFile: "src/routes/index.js",
    });
    expect(first.payload.total).toBe(2);
    expect(first.payload.nextCursor).toBeTruthy();
    const second = await call("vext_project_inspect", {
      section: "routes",
      cursor: first.payload.nextCursor,
      limit: 1,
    });
    expect(second.payload.items?.[0]?.path).toBe("/b");
    expect(
      (
        await call("vext_project_inspect", {
          section: "services",
          cursor: first.payload.nextCursor,
        })
      ).isError,
    ).toBe(true);
    const resource = await client.readResource({
      uri: "vext://project/routes",
    });
    expect(
      JSON.parse((resource.contents[0] as { text: string }).text).items,
    ).toHaveLength(2);
    await put(
      "src/routes/index.js",
      'export default app => { app.get("/c", {}, (req, res) => res.json({ ok: true })); };',
    );
    expect(
      (
        await call("vext_project_inspect", {
          section: "routes",
          cursor: first.payload.nextCursor,
        })
      ).isError,
    ).toBe(true);
  });

  it("exposes local services, dependency edges, scripts and all requested sections", async () => {
    await put("src/services/blog.js", "export default class Blog {}");
    const services = await call("vext_project_inspect", {
      section: "services",
    });
    expect(services.payload.items?.[0]).toMatchObject({
      serviceKey: "blog",
      sourceFile: "src/services/blog.js",
      callPath: "app.services.blog",
      dependencies: [],
    });
    const all = await call("vext_project_inspect", {
      section: "all",
      limit: 1,
    });
    for (const key of [
      "routes",
      "services",
      "serviceDependencies",
      "middlewares",
      "plugins",
      "models",
      "frontend",
      "config",
      "ownership",
      "scripts",
      "docs",
      "mocks",
      "jobs",
      "structure",
    ])
      expect(all.payload.details).toHaveProperty(key);
    expect(
      (
        await call("vext_capability_check", {
          capability: "C05",
          expectedIdentity: {
            projectId: "0".repeat(64),
            contextRevision: "0".repeat(64),
          },
        })
      ).isError,
    ).toBe(true);
  });

  it("keeps generated observations out of baseline source inspection", async () => {
    await put(
      ".vext/manifest/services.json",
      JSON.stringify({ complete: false }),
    );
    const baseline = await call("vext_project_inspect", {
      sourceMode: "baseline",
      refresh: true,
    });
    const auto = await call("vext_project_inspect", { sourceMode: "auto" });
    expect(JSON.stringify(baseline.payload)).not.toContain(
      "VEXT_MCP_SERVICE_DEPENDENCY_ANALYSIS_INCOMPLETE",
    );
    expect(JSON.stringify(auto.payload)).toContain(
      "VEXT_MCP_SERVICE_DEPENDENCY_ANALYSIS_INCOMPLETE",
    );
    expect(baseline.payload.identity?.contextRevision).toBe(
      auto.payload.identity?.contextRevision,
    );
  });
});

describe("MCP quality regressions: diagnostic coverage", () => {
  it("rejects unknown domains (M05)", async () => {
    expect(
      (await call("vext_project_check", { domain: "nonexistent-domain" }))
        .isError,
    ).toBe(true);
  });

  it("gives all the same scope as the default domain (M05)", async () => {
    const ordinary = await call("vext_project_check", { profile: "strict" });
    const all = await call("vext_project_check", {
      profile: "strict",
      domain: "all",
    });
    expect(all.data?.totals ?? all.data?.totalBySeverity).toEqual(
      ordinary.data?.totals ?? ordinary.data?.totalBySeverity,
    );
    expect(verdict(all)).toBe(verdict(ordinary));
  });

  it("does not change aggregate totals or verdict when display is limited (M05)", async () => {
    await put(
      "src/config/default.js",
      'export default { rateLimit: { store: "redis" } };\n',
    );
    const full = await call("vext_project_check", {
      profile: "strict",
      diagnosticLimit: 500,
    });
    const short = await call("vext_project_check", {
      profile: "strict",
      diagnosticLimit: 1,
    });
    expect(verdict(short)).toBe(verdict(full));
    expect(short.data?.totals ?? short.data?.totalBySeverity).toEqual(
      full.data?.totals ?? full.data?.totalBySeverity,
    );
  });

  it("does not mistake cache.tags for docs.tags (M06)", async () => {
    await put(
      "src/routes/index.js",
      'import { defineRoutes } from "vextjs";\nexport default defineRoutes(app => { app.get("/a", { docs: { summary: "Posts" }, cache: { ttl: 60, tags: ["posts"] } }, (req, res) => res.json([])); });\n',
    );
    const response = await call("vext_project_check", { profile: "standard" });
    expect(JSON.stringify(response.data?.diagnostics)).not.toContain(
      "VEXT_MCP_DEPRECATED_DOCS_TAGS",
    );
  });
});

describe("MCP quality regressions: candidate safety and accepted roles", () => {
  it("rejects invalid TypeScript syntax (M07)", async () => {
    const response = await validate([
      {
        path: "src/services/broken.ts",
        content: "export default class Broken {\n async run( {\n",
      },
    ]);
    expect(verdict(response)).not.toBe("valid");
  });

  it("rejects two creates resolving to one target (M07)", async () => {
    const response = await validate([
      { path: "src/utils/item.ts", content: "export const value = 1;\n" },
      { path: "src/utils/./item.ts", content: "export const value = 2;\n" },
    ]);
    expect(verdict(response)).not.toBe("valid");
  });

  it("enforces byte budgets and Unicode validity before parsing candidates (M07)", async () => {
    expect(
      verdict(
        await validate([
          {
            path: "src/utils/large.js",
            content: "//" + "x".repeat(512 * 1024),
          },
        ]),
      ),
    ).toBe("invalid");
    expect(
      verdict(
        await validate([
          {
            path: "src/utils/invalid.js",
            content:
              "export const text = '" + String.fromCharCode(0xd800) + "';",
          },
        ]),
      ),
    ).toBe("invalid");
  });

  it("keeps source imports distinct from source directory ownership (M07)", async () => {
    await put(
      "vext.workspace.json",
      JSON.stringify({
        schemaVersion: 1,
        services: [
          { id: "api", root: "." },
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
    await put("packages/models/src/index.ts", "export const version = 1;");
    expect(
      verdict(
        await validate([
          {
            path: "apps/peer/src/services/new.ts",
            content: "export const value = 1;",
          },
        ]),
      ),
    ).toBe("invalid");
    expect(
      verdict(
        await validate([
          { path: "packages/models/unrelated.json", content: "{}" },
        ]),
      ),
    ).toBe("invalid");
    expect(
      verdict(
        await validate([
          {
            path: "packages/models/src/new.ts",
            content: "export interface Record { id: string }",
          },
        ]),
      ),
    ).toBe("valid");
  });

  it("resolves imports against the whole candidate and detects real route conflicts (M07)", async () => {
    expect(
      verdict(
        await validate([
          {
            path: "src/utils/use.ts",
            content: "import { value } from './missing.js'; export { value };",
          },
        ]),
      ),
    ).toBe("invalid");
    expect(
      verdict(
        await validate([
          {
            path: "src/utils/use.ts",
            content: "import { value } from './value.js'; export { value };",
          },
          { path: "src/utils/value.ts", content: "export const value = 1;" },
        ]),
      ),
    ).toBe("valid");
    await put(
      "src/routes/posts.ts",
      'export default app => { app.get("/", { responses: { 200: { ok: "boolean!" } } }, (req, res) => res.json({ ok: true })); };',
    );
    expect(
      verdict(
        await validate([
          {
            path: "src/routes/posts/index.ts",
            content:
              'export default app => { app.get("/", { responses: { 200: { ok: "boolean!" } } }, (req, res) => res.json({ ok: true })); };',
          },
        ]),
      ),
    ).toBe("invalid");
  });

  it.each([
    ["mocks/data/blog.ts", "export const posts = [];\n"],
    [
      "docs/architecture.md",
      "# Architecture\n\nServices coordinate use cases.\n",
    ],
    ["scripts/seeds/blog.ts", "export async function seed() { return 0; }\n"],
    [
      "src/validators/blog.ts",
      'export function isPublished(value: unknown) { return value === "published"; }\n',
    ],
    [
      "src/constants/services/blog.ts",
      "export const DEFAULT_PAGE_SIZE = 20;\n",
    ],
    ["src/frontend/hooks/blog.ts", "export const initialPage = 1;\n"],
    ["src/frontend/lib/blog.ts", 'export const postsPath = "/api/posts";\n'],
    [
      "public/icon.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg>\n',
    ],
  ])(
    "accepts the declared default role at %s (M07/M09)",
    async (path, content) => {
      expect(verdict(await validate([{ path, content }]))).toBe("valid");
    },
  );

  it("preserves valid utility candidates (M07)", async () => {
    expect(
      verdict(
        await validate([
          {
            path: "src/utils/normal.ts",
            content: "export const answer = 42;\n",
          },
        ]),
      ),
    ).toBe("valid");
  });

  it.each(["src/routes/index.js", "../outside.ts"])(
    "rejects overwrite or out-of-root create %s (M07)",
    async (path) => {
      expect(
        verdict(
          await validate([{ path, content: "export const value = 1;\n" }]),
        ),
      ).not.toBe("valid");
    },
  );

  it("generates JavaScript in the adopted service directory (M09/M12)", async () => {
    await put(
      "vext.workspace.json",
      JSON.stringify({
        schemaVersion: 1,
        policyDefaults: {
          commentLanguage: "zh",
          roles: { services: "src/domain/services" },
        },
      }),
    );
    const response = await call("vext_generate_changes", {
      recipeId: "service",
      name: "sample",
      expectedIdentity: await identity(),
    });
    expect(response.isError).toBe(false);
    expect(response.data?.changeSet?.files.map((file) => file.path)).toContain(
      "src/domain/services/sample.js",
    );
  });
});
