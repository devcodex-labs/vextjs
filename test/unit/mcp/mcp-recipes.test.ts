import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateMcpChangeSet } from "../../../src/assistant/change-set.js";
import { inspectVextProject } from "../../../src/assistant/project-inspector.js";
import { VEXT_RECIPE_DEFINITIONS } from "../../../src/assistant/recipe-registry.js";
import {
  resolveAssistantRoles,
  adoptConfiguredRoles,
} from "../../../src/tooling/project-index/roles.js";

let root: string;
async function put(file: string, text: string) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
}
async function project(language: "ts" | "js" = "ts", policyDefaults = {}) {
  await put(
    "package.json",
    JSON.stringify({
      name: "recipe-consumer",
      version: "1.0.0",
      type: "module",
      packageManager: "pnpm@10.0.0",
      scripts: {
        typecheck: "tsc --noEmit",
        "test:unit": "vitest run test/unit",
      },
      dependencies: { vextjs: "2.0.0" },
    }),
  );
  await put(`src/config/default.${language}`, "export default {};\n");
  await put(
    `src/utils/subject.${language}`,
    `export function double(value${language === "ts" ? ": number" : ""}) {\n  if (value < 0) throw new Error("negative");\n  return value * 2;\n}\n`,
  );
  await put(
    "vext.workspace.json",
    JSON.stringify({ schemaVersion: 1, policyDefaults }),
  );
  return inspectVextProject({ rootDir: root, frameworkVersion: "2.0.0" });
}
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vext-recipe-"));
});
afterEach(async () => {
  if (
    path.dirname(root) === tmpdir() &&
    path.basename(root).startsWith("vext-recipe-")
  )
    await rm(root, { recursive: true, force: true });
});

describe("shared Recipe generation", () => {
  it.each(["ts", "js"] as const)(
    "validates all 17 meaningful %s recipe candidates",
    async (language) => {
      const inspected = await project(language);
      const options: Record<string, Record<string, unknown>> = {
        test: {
          target: `src/utils/subject.${language}`,
          exportName: "double",
          cases: [
            { name: "doubles positive input", args: [3], expected: 6 },
            { name: "rejects negatives", args: [-1], throws: "negative" },
          ],
        },
        "type-contract": { fields: { id: "string", "count?": "number" } },
        utility: {
          description:
            "Return a normalized display label without changing internal whitespace.",
          parameters: language === "ts" ? "value: string" : "value",
          body: "return value.trim();",
          returnType: "string",
        },
        "job-handler": {
          queue: { enabled: true, priority: 2 },
          schedule: { interval: 60000, timezone: "Asia/Shanghai" },
          retry: { attempts: 3, delay: 1000, backoff: "exponential" },
        },
      };
      for (const recipe of VEXT_RECIPE_DEFINITIONS) {
        const result = generateMcpChangeSet(
          {
            recipeId: recipe.id,
            name: "sample",
            options: options[recipe.name],
          },
          inspected,
        );
        expect(
          result,
          recipe.name + ": " + JSON.stringify(result),
        ).toMatchObject({ status: "ready" });
        expect(
          result.changeSet?.files.every((file) =>
            /^[a-f0-9]{64}$/u.test(file.sha256!),
          ),
        ).toBe(true);
        if (language === "js")
          expect(
            result.changeSet?.files.some((file) => /\.tsx?$/u.test(file.path)),
            recipe.name,
          ).toBe(false);
      }
    },
  );

  it("inherits parent roles and preserves explicit child overrides", () => {
    const roles = resolveAssistantRoles({
      roles: {
        "server-types": "src/types/backend",
        mocks: "dev/mocks",
        "mock-data": "dev/samples",
      },
    });
    expect(roles.find((role) => role.id === "service-types")?.path).toBe(
      "src/types/backend/services",
    );
    expect(roles.find((role) => role.id === "mock-scenarios")?.path).toBe(
      "dev/mocks/scenarios",
    );
    expect(roles.find((role) => role.id === "mock-data")?.path).toBe(
      "dev/samples",
    );
    const adopted = adoptConfiguredRoles(
      roles,
      {
        directories: {
          frontend: {
            absolutePath: path.join(root, "ui"),
            sourceRefs: [],
            explicit: true,
          },
        },
        files: {},
        unknown: {},
      },
      root,
    );
    expect(adopted.find((role) => role.id === "frontend-layouts")?.path).toBe(
      "ui/layouts",
    );
  });

  it("uses a loader facade for a JS service in the user directory", async () => {
    const inspected = await project("js", {
      commentLanguage: "zh",
      roles: { services: "src/domain/services" },
    });
    const result = generateMcpChangeSet(
      { recipeId: "service", name: "sample" },
      inspected,
    );
    expect(result, JSON.stringify(result)).toMatchObject({ status: "ready" });
    const files = result.changeSet!.files;
    expect(files.map((file) => file.path)).toEqual([
      "src/domain/services/sample.js",
      "src/services/sample.js",
    ]);
    expect(files[0]!.content).toContain("服务用例入口");
    expect(files[1]!.content).toContain("../domain/services/sample.js");
    expect(files.some((file) => file.path.includes("types/"))).toBe(false);
  });

  it("connects an API module to the actual generated service", async () => {
    const result = generateMcpChangeSet(
      {
        recipeId: "api-module",
        name: "billing",
        options: { method: "post", path: "/status", serviceMethod: "status" },
      },
      await project(),
    );
    expect(result, JSON.stringify(result)).toMatchObject({ status: "ready" });
    const route = result.changeSet!.files.find((file) =>
      file.path.includes("routes/"),
    )!.content;
    expect(route).toContain("app.post(");
    expect(route).toContain('app.services["billing"].status()');
    expect(
      result.changeSet!.files.find((file) => file.path.includes("services/"))!
        .content,
    ).toContain("async status()");
  });

  it("renders maintainable route options and service contracts", async () => {
    const result = generateMcpChangeSet(
      {
        recipeId: "api-module",
        name: "blog post",
        options: {
          method: "get",
          path: "/",
          serviceMethod: "list",
          output: { data: "unknown[]", "nextCursor?": "string | null" },
          responses: {
            200: { schema: { data: { type: "array" } } },
          },
          routeOptions: {
            auth: false,
            middlewares: [],
            cache: null,
            docs: { operationId: "listBlogPosts" },
          },
          access: "Public blog list.",
        },
      },
      await project(),
    );
    expect(result, JSON.stringify(result)).toMatchObject({ status: "ready" });
    const typeFile = result.changeSet!.files.find((file) =>
      file.path.includes("types/server/services/"),
    )!.content;
    expect(typeFile).toContain("data: unknown[];");
    expect(typeFile).toContain("nextCursor?: string | null;");
    expect(typeFile).not.toContain('"data": unknown[];');

    const route = result.changeSet!.files.find((file) =>
      file.path.includes("routes/"),
    )!.content;
    expect(route).toContain("auth: false");
    expect(route).toContain("middlewares: []");
    expect(route).toContain("cache: null");
    expect(route).toContain('operationId: "listBlogPosts"');
    expect(route).toContain('access: "Public blog list."');
    expect(route).not.toContain('"responses"');
  });

  it("renders page and page API route options from separate boundaries", async () => {
    const result = generateMcpChangeSet(
      {
        recipeId: "page-and-api",
        name: "admin dashboard",
        options: {
          path: "/admin",
          apiPath: "/data",
          auth: { roles: ["admin"] },
          apiRouteOptions: {
            auth: { roles: ["admin"] },
            cache: false,
          },
        },
      },
      await project(),
    );
    expect(result, JSON.stringify(result)).toMatchObject({ status: "ready" });
    const routes = result
      .changeSet!.files.filter((file) => file.path.includes("routes/"))
      .map((file) => file.content)
      .join("\n");
    expect(routes).toContain("auth: {");
    expect(routes).toContain("roles: [");
    expect(routes).toContain("cache: false");
    expect(routes).toContain("Read admin-dashboard page data");
  });

  it("keeps mock data and scenarios separate and adopts an existing layout", async () => {
    await put("src/mocks/existing.ts", "export const existing = [];\n");
    const result = generateMcpChangeSet(
      {
        recipeId: "mock-scenario",
        name: "blog",
        options: { data: [{ id: "one" }] },
      },
      await project(),
    );
    expect(result, JSON.stringify(result)).toMatchObject({ status: "ready" });
    expect(result.changeSet?.files.map((file) => file.path)).toEqual([
      "src/mocks/data/blog.ts",
      "src/mocks/scenarios/blog.ts",
    ]);
    expect(result.changeSet?.files[1]?.content).toContain(
      'from "../data/blog.js"',
    );
  });

  it("uses role-specific locale defaults for backend and frontend", async () => {
    const inspected = await project("ts", {
      outputLanguage: "zh",
      commentLanguage: "zh",
    });
    const backend = generateMcpChangeSet(
      {
        recipeId: "locale",
        name: "blog",
        options: { target: "backend", module: "blog/posts", locale: "zh-CN" },
      },
      inspected,
    );
    expect(backend, JSON.stringify(backend)).toMatchObject({ status: "ready" });
    const backendMessages = JSON.parse(backend.changeSet!.files[0]!.content);
    expect(backendMessages.validationFailed).toMatchObject({
      code: 10001,
      statusCode: 400,
    });

    const frontend = generateMcpChangeSet(
      {
        recipeId: "locale",
        name: "blog",
        options: { target: "frontend", module: "blog/posts", locale: "zh-CN" },
      },
      inspected,
    );
    expect(frontend, JSON.stringify(frontend)).toMatchObject({
      status: "ready",
    });
    const frontendMessages = JSON.parse(frontend.changeSet!.files[0]!.content);
    expect(frontendMessages).toMatchObject({
      actions: { refresh: "刷新" },
      states: { loading: "加载中…" },
    });
  });

  it("supports feature-owned code through real runtime entrypoints", async () => {
    const inspected = await project("ts", {
      architecture: { style: "feature", featureRoot: "src/features" },
    });
    const result = generateMcpChangeSet(
      { recipeId: "api-module", name: "account" },
      inspected,
    );
    expect(result, JSON.stringify(result)).toMatchObject({ status: "ready" });
    expect(result.changeSet?.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "src/features/account/service.ts",
        "src/features/account/route.ts",
        "src/services/account.ts",
        "src/routes/account.ts",
      ]),
    );
  });

  it("keeps comment language separate from response language and adopts static formatting", async () => {
    await put(
      ".prettierrc.json",
      JSON.stringify({ tabWidth: 4, singleQuote: true }),
    );
    const inspected = await project("ts", {
      outputLanguage: "zh",
      commentLanguage: "en",
      commentDetail: "minimal",
    });
    const result = generateMcpChangeSet(
      { recipeId: "api-route", name: "sample" },
      inspected,
    );
    expect(result.changeSet?.files[0]?.content).toContain("from 'vextjs'");
    expect(result.changeSet?.files[0]?.content).toContain("\n    app.get(");
    expect(result.changeSet?.files[0]?.content).toContain(
      "/** The HTTP boundary",
    );
    expect(result.changeSet?.warnings.join("")).toContain("静态检查");
  });

  it("does not generate fake behavior tests or identity utilities", async () => {
    const inspected = await project();
    for (const recipeId of ["test", "utility", "type-contract"])
      expect(
        generateMcpChangeSet({ recipeId, name: "sample" }, inspected),
      ).toMatchObject({ status: "incomplete" });
  });

  it("rejects ignored or invalid options including string Job queues", async () => {
    const inspected = await project();
    for (const input of [
      { recipeId: "service", options: { invented: true } },
      { recipeId: "job-handler", options: { queue: "default" } },
      {
        recipeId: "job-handler",
        options: { schedule: { cron: "* * * * *", interval: 1000 } },
      },
      { recipeId: "locale", options: { locale: "../../escape" } },
      { recipeId: "api-route", options: { method: "erase" } },
      { recipeId: "api-route", options: { serviceArgs: "req.body" } },
      { recipeId: "api-module", options: { service: "other" } },
      {
        recipeId: "job-handler",
        options: { schedule: { cron: "not a cron" } },
      },
    ])
      expect(
        generateMcpChangeSet({ ...input, name: "sample" }, inspected).status,
        JSON.stringify(input),
      ).toBe("invalid");
    expect(
      generateMcpChangeSet(
        {
          recipeId: "reusable-schema",
          name: "sample",
          options: { fields: { invalid: "not-a-dsl-type!" } },
        },
        inspected,
      ).status,
    ).toBe("incomplete");
    expect(
      generateMcpChangeSet(
        {
          recipeId: "job-handler",
          name: "sample",
          options: {
            payload: { id: "string!" },
            schedule: { interval: 1000 },
          },
        },
        inspected,
      ).status,
    ).toBe("incomplete");
  });

  it("renders children and makes the page actually request its API", async () => {
    const inspected = await project();
    const layout = generateMcpChangeSet(
      { recipeId: "frontend-layout", name: "admin" },
      inspected,
    );
    expect(layout.changeSet?.files[0]?.content).toContain("{children}</div>");
    const module = generateMcpChangeSet(
      { recipeId: "page-and-api", name: "blog" },
      inspected,
    );
    const page = module.changeSet?.files.find((file) =>
      file.path.endsWith(".tsx"),
    )?.content;
    expect(page).toContain('fetch("/blog-api"');
    expect(page).toContain('role="alert"');
    expect(page).toContain("controller.abort()");
    expect(module.changeSet?.requiredHostSteps.join("\n")).toContain(
      "pnpm run typecheck",
    );
    expect(module.changeSet?.requiredHostSteps.join("\n")).not.toContain(
      "npm run build",
    );
  });
});
