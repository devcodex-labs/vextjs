import { compileStaticSchema } from "../lib/schema-adapter.js";
import { projectLocaleMessages } from "../lib/i18n/messages.js";
import {
  RecipeContext,
  RecipeInputError,
  safeModulePath,
  pascalName,
  camelName,
  indent,
} from "./recipe-context.js";
import { renderTypeFields } from "./recipes-backend.js";
import { getInspectionSources } from "./project-inspector.js";
import { ASSISTANT_SOURCE_ROOT } from "../tooling/project-index/analysis-source.js";
import { normalizeSourcePath } from "../tooling/source-view/policy.js";
import type { VextMcpChangeSetFile } from "./change-set.js";

interface RecipeTestCase {
  name: string;
  args: unknown[];
  expected?: unknown;
  throws?: string;
}

export function renderSupportRecipe(
  name: string,
  ctx: RecipeContext,
): VextMcpChangeSetFile[] {
  if (name === "locale") {
    const backend = ctx.option("target", "frontend") !== "frontend";
    const role = backend ? "locales" : "frontend-locales";
    const module = safeModulePath(ctx.option("module", ctx.name));
    const locale = ctx.option("locale", "en-US");
    try {
      if (Intl.getCanonicalLocales(locale).length !== 1) throw new Error();
    } catch {
      throw new RecipeInputError("locale must be a valid BCP-47 language tag.");
    }
    const messages = ctx.option("messages", {
      example: {
        code: 40000,
        message: ctx.message("示例消息", "Example message"),
      },
    });
    try {
      projectLocaleMessages(
        [
          {
            locale,
            namespace: module.replaceAll("/", "."),
            file: `${module}/${locale}.json`,
            messages,
          },
        ],
        backend ? "flat" : "nested",
      );
    } catch (error) {
      throw new RecipeInputError(String(error));
    }
    ctx.steps.push(
      `Read module-scoped locale keys using ${backend ? "req.t/app.throw" : "useVextI18n"}; verify ${module}/${locale} with the actual loader and check other supported locales for missing keys.`,
    );
    return [
      ctx.file(
        `${ctx.role(role)}/${module}/${locale}.json`,
        JSON.stringify(messages, null, 2),
        "Keep messages in feature/subfeature locale resources.",
      ),
    ];
  }
  if (name === "type-contract") {
    if (!ctx.has("fields"))
      throw new RecipeInputError(
        "Supply the real fields and consumer boundary for the type contract.",
        "incomplete",
      );
    const target = ctx.option("target", "shared");
    const role = (
      {
        server: "server-types",
        service: "service-types",
        model: "server-model-types",
        frontend: "frontend-types",
        shared: "shared-types",
      } as const
    )[target as "shared"];
    const ts = ctx.language(role) === "ts";
    const fields = ctx.option<Record<string, string>>("fields", {});
    const typeBody = renderTypeFields(fields, (s) => ctx.quote(s));
    const typeName = `${pascalName(ctx.name)}Contract`;
    const file = ctx.filePath(role).replace(/\.ts$/u, ".d.ts");
    const source = ts
      ? `${ctx.comment("此契约仅包含消费方需要的业务字段，不复制上游数据库方法类型。", "This contract contains consumer-owned fields; do not copy upstream database method types.")}export interface ${typeName} {\n${typeBody}\n}\n`
      : `/**\n * ${ctx.message("业务数据契约；无运行期副作用。", "Business data contract without runtime side effects.")}\n * @typedef {Object} ${typeName}\n${Object.entries(
          fields,
        )
          .map(
            ([key, type]) =>
              ` * @property {${type}} ${key.endsWith("?") ? `[${key.slice(0, -1)}]` : key}`,
          )
          .join("\n")}\n */\nexport {};\n`;
    ctx.steps.push(
      `Use ${ts ? "import type" : "a JSDoc import type"} from ${file}; keep generated declarations owned by the framework.`,
    );
    return [
      ctx.file(
        file,
        source,
        "Create an explicit application-owned type contract.",
      ),
    ];
  }
  if (name === "test") {
    if (!ctx.has("target") || !ctx.has("cases"))
      throw new RecipeInputError(
        "Supply a real exported function target and at least two independent behavior/boundary cases.",
        "incomplete",
      );
    const target = normalizeSourcePath(ctx.option("target", ""));
    const view = getInspectionSources(ctx.project);
    if (!view?.record(ASSISTANT_SOURCE_ROOT, target))
      throw new RecipeInputError(
        `Test target ${target} is absent from the sealed source context.`,
        "incomplete",
      );
    const cases = ctx.option<RecipeTestCase[]>("cases", []);
    if (
      cases.some(
        (item) =>
          Object.hasOwn(item, "expected") === Object.hasOwn(item, "throws"),
      )
    )
      throw new RecipeInputError(
        "Each test case must provide exactly one of expected or throws.",
      );
    if (
      new Set(
        cases.map((item) =>
          JSON.stringify([item.args, item.expected, item.throws]),
        ),
      ).size < 2
    )
      throw new RecipeInputError(
        "Test cases must cover distinct behavior inputs or boundaries.",
      );
    const role =
      ctx.option("kind", "unit") === "unit" ? "test-unit" : "test-integration";
    const file = ctx.filePath(role, `${ctx.name}.test`);
    const exported = ctx.option("exportName", "default");
    const imports = `import { describe, expect, it } from ${ctx.quote("vitest")};\nimport ${exported === "default" ? "subject" : `{ ${exported} as subject }`} from ${ctx.quote(ctx.relative(file, target))};\n`;
    const tests = cases
      .map((item) => {
        const args = item.args.map((arg) => JSON.stringify(arg)).join(", ");
        const assertion =
          item.throws !== undefined
            ? `await expect(Promise.resolve().then(() => subject(${args}))).rejects.toThrow(${ctx.quote(item.throws)});`
            : `const actual = await subject(${args});\nexpect(actual).toEqual(${JSON.stringify(item.expected, null, 2)});`;
        return `  it(${ctx.quote(item.name)}, async () => {\n${indent(assertion, 4)}\n  });`;
      })
      .join("\n\n");
    ctx.scaffold = false;
    ctx.prerequisites.push(
      "The selected export must be callable, and Vitest must be an existing project test dependency. Confirm both success and failure/boundary cases with the real implementation.",
    );
    return [
      ctx.file(
        file,
        `${imports}\n${ctx.comment("调用真实被测代码；预期由业务行为提供，不由实现结果反推。", "Call the real target; expected values come from business behavior, not from the implementation's output.")}describe(${ctx.quote(ctx.name)}, () => {\n${tests}\n});\n`,
        "Test a real exported function with independent expectations.",
      ),
    ];
  }
  if (name === "utility") {
    if (!ctx.has("body") || !ctx.has("description"))
      throw new RecipeInputError(
        "Supply the pure operation's purpose and implementation; MCP does not invent identity wrappers.",
        "incomplete",
      );
    const target = ctx.option("target", "server");
    const role =
      target === "shared"
        ? "shared-utils"
        : target === "validator"
          ? "validators"
          : "server-utils";
    const ts = ctx.language(role) === "ts";
    ctx.scaffold = false;
    ctx.steps.push(
      "Keep database/cache/request orchestration in the service. Import this helper only where the stated operation is actually reused.",
    );
    return [
      ctx.file(
        ctx.filePath(role),
        `${ctx.comment("", "")}${!ts && ctx.has("returnType") ? `/** @returns {${ctx.options.returnType}} */\n` : ""}export function ${camelName(ctx.name)}(${ctx.option("parameters", "")})${ts && ctx.has("returnType") ? `: ${ctx.options.returnType}` : ""} {\n${indent(ctx.option("body", ""))}\n}\n`,
        "Create the specified pure operation near its consumers.",
      ),
    ];
  }
  if (name === "reusable-schema") {
    const fields = ctx.option<Record<string, unknown>>("fields", {
      id: "string:1-120!",
    });
    try {
      compileStaticSchema(fields as Parameters<typeof compileStaticSchema>[0]);
    } catch (error) {
      throw new RecipeInputError(
        String(error) +
          " Verify any project-specific type registry in the host.",
        "incomplete",
      );
    }
    const schemaName = `${camelName(ctx.name)}Schema`;
    const entries = Object.entries(fields)
      .map(
        ([key, field]) =>
          `  ${ctx.quote(key)}: ${typeof field === "string" ? `schemaAdapter.compileField(${ctx.quote(field)})` : JSON.stringify(field, null, 2).replaceAll("\n", "\n  ")},`,
      )
      .join("\n");
    ctx.steps.push(
      `Import ${schemaName} from ${ctx.filePath("schemas")} into ${ctx.option("consumer", "the actual request/response/Job consumer")} and attach it to ${ctx.option("usage", "request")} validation. Creating a schema alone does not activate validation; preserve app.getValidator() for service-level validation.`,
    );
    return [
      ctx.file(
        ctx.filePath("schemas"),
        `import { schemaAdapter } from ${ctx.quote("vextjs")};\n\n${ctx.comment("复用运行时 schema；必须在实际 validate/responses/Job payload 入口引用。", "Reusable runtime schema; consume it at an actual validate/responses/Job payload boundary.")}export const ${schemaName} = {\n${entries}\n};\n`,
        "Create reusable schema fields for explicit consumer imports.",
      ),
    ];
  }
  const dataFile = ctx.filePath("mock-data");
  const scenarioFile = ctx.filePath("mock-scenarios");
  const symbol = `${camelName(ctx.name)}Data`;
  const data = ctx.option("data", []);
  const scenarios = ctx.option<Record<string, unknown>>("scenarios", {});
  const scenarioEntries = [
    "  default: " + symbol + ",",
    "  empty: [],",
    ...Object.entries(scenarios).map(
      ([key, value]) =>
        `  ${ctx.quote(key)}: ${JSON.stringify(value, null, 2).replaceAll("\n", "\n  ")},`,
    ),
  ];
  if (Object.hasOwn(scenarios, "default") || Object.hasOwn(scenarios, "empty"))
    throw new RecipeInputError(
      "default and empty are reserved built-in mock scenarios.",
    );
  ctx.steps.push(
    `Mock target is ${ctx.option("target", "shared")}. Import ${scenarioFile} only from explicitly selected demo/test entrypoints; choose an existing adapter in ${ctx.role("mock-adapters")} if needed. Do not replace the production service data source or run seeds implicitly.`,
  );
  return [
    ctx.file(
      dataFile,
      `${ctx.comment("显式演示数据，不建立连接、不写库、不作为生产失败回退。", "Explicit demo data: no connections, writes or production failure fallback.")}${ctx.language("mock-data") === "js" && Array.isArray(data) && data.length === 0 ? "/** @type {Array<Record<string, unknown>>} */\n" : ""}export const ${symbol} = ${JSON.stringify(data, null, 2)};\n`,
      "Separate reusable mock data from service code.",
    ),
    ctx.file(
      scenarioFile,
      `import { ${symbol} } from ${ctx.quote(ctx.relative(scenarioFile, dataFile))};\n\nexport const ${camelName(ctx.name)}Scenarios = {\n${scenarioEntries.join("\n")}\n};\n`,
      "Name scenarios separately from raw mock data and adapter integration.",
    ),
  ];
}
