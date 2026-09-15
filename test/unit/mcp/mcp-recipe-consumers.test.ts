import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { checkMcpConsumerTypes } from "../../helpers/mcp-consumer-types.js";
import { transform } from "esbuild";
import { runInThisContext } from "node:vm";
import { generateMcpChangeSet } from "../../../src/assistant/change-set.js";
import { inspectVextProject } from "../../../src/assistant/project-inspector.js";
import { VEXT_RECIPE_DEFINITIONS } from "../../../src/assistant/recipe-registry.js";
import { defineJob } from "../../../src/lib/jobs/define-job.js";

const normalize = (file: string) => path.resolve(file).replaceAll("\\", "/");
let root: string;
const sources = new Map<string, string>();
const generated = new Map<string, ReturnType<typeof generateMcpChangeSet>>();

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vext-recipe-consumer-"));
  await mkdir(path.join(root, "src/config"), { recursive: true });
  await writeFile(
    path.join(root, "src/config/default.ts"),
    "export default {};\n",
  );
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "recipe-types",
      version: "1.0.0",
      type: "module",
      dependencies: { vextjs: "2.0.0" },
    }),
  );
  await mkdir(path.join(root, "src/utils/shared"), { recursive: true });
  const subject =
    "/** @param {number} value */\nexport function double(value) { if (value < 0) throw new Error('negative'); return value * 2; }\n";
  await writeFile(path.join(root, "src/utils/shared/double.js"), subject);
  const project = await inspectVextProject({
    rootDir: root,
    frameworkVersion: "2.0.0",
  });
  for (const language of ["ts", "js"] as const) {
    for (const recipe of VEXT_RECIPE_DEFINITIONS) {
      const options = {
        language,
        ...(recipe.name === "test"
          ? {
              target: "src/utils/shared/double.js",
              exportName: "double",
              cases: [
                { name: "positive input", args: [4], expected: 8 },
                { name: "negative input", args: [-1], throws: "negative" },
              ],
            }
          : {}),
        ...(recipe.name === "utility"
          ? {
              description: "Normalize a reused display label.",
              parameters:
                language === "ts"
                  ? "value: string"
                  : "/** @type {string} */ value",
              returnType: "string",
              body: "return value.trim();",
            }
          : {}),
        ...(recipe.name === "type-contract"
          ? { fields: { id: "string", "count?": "number" } }
          : {}),
        ...(recipe.name === "service"
          ? { output: { ok: "boolean", checkedAt: "string" } }
          : {}),
        ...(recipe.name === "job-handler"
          ? {
              queue: { enabled: true, priority: 2 },
              schedule: { interval: 1000 },
            }
          : {}),
      };
      const result = generateMcpChangeSet(
        { recipeId: recipe.id, name: "sample", options },
        project,
      );
      expect(
        result,
        `${recipe.name}/${language}: ${JSON.stringify(result)}`,
      ).toMatchObject({ status: "ready" });
      const base = path.join(root, "virtual", recipe.name, language);
      sources.set(
        normalize(path.join(base, "package.json")),
        '{"type":"module"}',
      );
      if (recipe.name === "test")
        sources.set(
          normalize(path.join(base, "src/utils/shared/double.js")),
          subject,
        );
      for (const file of result.changeSet!.files)
        sources.set(normalize(path.join(base, file.path)), file.content);
      generated.set(`${recipe.name}/${language}`, result);
    }
  }
  // 覆盖需要实际输入的分支，避免仅验证默认 health 掩盖错误 API/JS 类型。
  for (const language of ["ts", "js"] as const) {
    const variants = [
      {
        recipeId: "api-module",
        name: "label",
        options: {
          language,
          method: "post",
          serviceMethod: "format",
          input: { label: "string", "suffix?": "string" },
          output: { label: "string" },
          body: "return { label: input.label.toUpperCase() + (input.suffix ?? '') };",
          validate: { body: { label: "string!", suffix: "string" } },
          responses: { 200: { schema: { label: "string!" } } },
        },
      },
      {
        recipeId: "model",
        name: "post",
        options: {
          language,
          document: { slug: "string", status: '"draft" | "published"' },
          schema: { slug: "string!" },
          indexes: [{ key: { slug: 1 }, unique: true }],
        },
      },
      {
        recipeId: "middleware",
        name: "enabled",
        options: {
          language,
          factory: true,
          options: { enabled: "boolean" },
          body: "if (options.enabled) await next(); else res.json({ enabled: false });",
        },
      },
      {
        recipeId: "job-handler",
        name: "typed-payload",
        options: {
          language,
          payload: { amount: "number!", label: "string!" },
          handler:
            "return { amount: ctx.payload.amount * 2, label: ctx.payload.label.toUpperCase() };",
        },
      },
      {
        recipeId: "reusable-schema",
        name: "paging",
        options: {
          language,
          fields: { page: { type: "integer", minimum: 1 }, cursor: "string" },
        },
      },
    ];
    for (const input of variants) {
      const result = generateMcpChangeSet(input, project);
      expect(result, JSON.stringify(result)).toMatchObject({ status: "ready" });
      for (const file of result.changeSet!.files)
        sources.set(
          normalize(
            path.join(
              root,
              "virtual-options",
              input.recipeId,
              language,
              file.path,
            ),
          ),
          file.content,
        );
    }
  }
}, 60000);

afterAll(async () => {
  if (
    root &&
    path.dirname(root) === tmpdir() &&
    path.basename(root).startsWith("vext-recipe-consumer-")
  )
    await rm(root, { recursive: true, force: true });
});

describe("generated Recipe consumers", () => {
  it("retains ordinary DSL fields named type/properties and infers native field schemas", () => {
    const file = normalize(path.join(root, "dsl/route.ts"));
    const diagnostics = checkMcpConsumerTypes(
      new Map([
        [normalize(path.join(root, "dsl/package.json")), '{"type":"module"}'],
        [
          file,
          `import { defineRoutes } from "vextjs";
export default defineRoutes(app => {
  app.post("/", { validate: { body: { type: "string!", properties: "string!", "title!": { type: "string" }, featured: { type: "boolean" } } } }, (req, res) => {
    const body = req.valid("body");
    const type: string = body.type;
    const properties: string = body.properties;
    const title: string = body.title;
    const featured: boolean | undefined = body.featured;
    // @ts-expect-error: a validated string cannot be used as a number.
    const invalid: number = body.title;
    res.json({ type, properties, title, featured });
  });
});`,
        ],
      ]),
    );
    const messages = diagnostics.map(
      (item) =>
        `${item.code}: ${ts.flattenDiagnosticMessageText(item.messageText, "\n")}`,
    );
    expect(messages, messages.join("\n")).toEqual([]);
  }, 60000);

  it("does not offer a misleading default API candidate for a root JSON Schema", async () => {
    const project = await inspectVextProject({
      rootDir: root,
      frameworkVersion: "2.0.0",
    });
    const result = generateMcpChangeSet(
      {
        recipeId: "api-module",
        name: "root-schema",
        options: {
          method: "post",
          validate: {
            body: {
              type: "object",
              properties: { title: { type: "string" } },
              required: ["title"],
              additionalProperties: false,
            },
          },
        },
      },
      project,
    );
    expect(result.status).toBe("incomplete");
    expect(result.changeSet).toBeUndefined();
    expect(result.diagnostics.join(" ")).toContain("DSL field map");
  });

  it("typechecks TS and checkJs candidates against real framework and React types", () => {
    const diagnostics = checkMcpConsumerTypes(sources);
    const messages = diagnostics.map(
      (item) =>
        `${item.file?.fileName}:${item.start} TS${item.code}: ${ts.flattenDiagnosticMessageText(item.messageText, "\n")}`,
    );
    expect(messages, messages.join("\n")).toEqual([]);
  }, 60000);

  it("rejects an invalid Job queue through the actual public type", () => {
    const file = normalize(path.join(root, "negative/job.ts"));
    const diagnostics = checkMcpConsumerTypes(
      new Map([
        [
          file,
          'import { defineJob } from "vextjs"; export default defineJob({queue: "default", handler() {}});',
        ],
        [
          normalize(path.join(root, "negative/package.json")),
          '{"type":"module"}',
        ],
      ]),
    );
    expect(
      diagnostics.some((item) => item.code === 2559 || item.code === 2322),
    ).toBe(true);
  }, 60000);

  it.each(["ts", "js"] as const)(
    "loads the generated %s service and Job using real native contracts",
    async (language) => {
      const service = generated
        .get(`service/${language}`)!
        .changeSet!.files.find((file) =>
          file.path.startsWith("src/services/"),
        )!;
      const job = generated.get(`job-handler/${language}`)!.changeSet!
        .files[0]!;
      const evaluate = async (content: string) => {
        const compiled = await transform(content, {
          loader: language,
          format: "cjs",
          target: "es2022",
        });
        const module = { exports: {} as { default: unknown } };
        runInThisContext(
          "(function(module, exports, require) {\n" + compiled.code + "\n})",
        )(module, module.exports, (name: string) => {
          if (name === "vextjs") return { defineJob };
          throw new Error(`Unexpected runtime import: ${name}`);
        });
        return module.exports.default;
      };
      const Service = (await evaluate(service.content)) as new () => {
        health(): Promise<{ ok: boolean; checkedAt: string }>;
      };
      const health = await new Service().health();
      expect(health.ok).toBe(true);
      expect(Number.isFinite(Date.parse(health.checkedAt))).toBe(true);
      const definition = (await evaluate(job.content)) as ReturnType<
        typeof defineJob
      >;
      expect(definition.queue).toEqual({ enabled: true, priority: 2 });
      expect(definition.schedule?.interval).toBe(1000);
      expect(Object.isFrozen(definition)).toBe(true);
    },
  );
});
