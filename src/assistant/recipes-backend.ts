import {
  RecipeContext,
  RecipeInputError,
  camelName,
  pascalName,
  indent,
} from "./recipe-context.js";
import { renderJobRecipe } from "./recipes-jobs.js";
import {
  buildRouteOptions,
  renderCodeValue,
  renderTypePropertyKey,
} from "./route-options.js";
import { compileStaticSchema } from "../lib/schema-adapter.js";
import { wrappedRequestSchemaLocations } from "../tooling/project-index/request-schema.js";
import type { VextMcpChangeSetFile } from "./change-set.js";

const HEALTH_RESPONSE = {
  200: { schema: { ok: "boolean!", checkedAt: "string!" } },
};

/** 仅生成业务字段契约；数据库查询/结果类型继续使用 MonSQLize 原生泛型。 */
export function renderTypeFields(
  fields: Record<string, string>,
  q: (value: string) => string,
): string {
  return Object.entries(fields)
    .map(([key, type]) => {
      if (
        !/^(?:(?:string|number|boolean|unknown|Date|null|true|false)(?:\[\])?|"[^"\n]*"|'[^'\n]*')(?:\s*\|\s*(?:(?:string|number|boolean|unknown|Date|null|true|false)(?:\[\])?|"[^"\n]*"|'[^'\n]*'))*$/u.test(
          type,
        )
      )
        throw new RecipeInputError(
          `Type field ${key} requires a supported primitive/array/union. Keep complex existing contracts in their owning module.`,
          "unsupported",
        );
      const property = renderTypePropertyKey(key.replace(/\?$/u, ""), q);
      return `  ${property}${key.endsWith("?") ? "?" : ""}: ${type};`;
    })
    .join("\n");
}

/** JSDoc 字段与 TS 共用允许的类型语法，复用契约仍放在类型目录。 */
function renderJsContract(
  name: string,
  fields: Record<string, string>,
): string {
  renderTypeFields(fields, JSON.stringify);
  return `/**\n * @typedef {Object} ${name}\n${Object.entries(fields)
    .map(([key, type]) => {
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*\??$/u.test(key))
        throw new RecipeInputError(
          "JSDoc contract field names must be identifiers.",
          "unsupported",
        );
      return ` * @property {${type}} ${key.endsWith("?") ? "[" + key.slice(0, -1) + "]" : key}`;
    })
    .join("\n")}\n */`;
}

export function renderService(
  ctx: RecipeContext,
  method = ctx.option("method", "health"),
): VextMcpChangeSetFile[] {
  const file = ctx.filePath("services");
  const ts = ctx.language("services") === "ts";
  const typeName = pascalName(ctx.name);
  const body = ctx.option(
    "body",
    "return { ok: true, checkedAt: new Date().toISOString() };",
  );
  const files: VextMcpChangeSetFile[] = [];
  let imports = ctx.option("imports", "");
  let parameters = ctx.option("parameters", "");
  if ((ctx.has("input") || parameters) && !ctx.has("body"))
    throw new RecipeInputError(
      "Supply a service body that consumes the declared input/parameters.",
      "incomplete",
    );
  let result = "";
  const contracts: string[] = [];
  const contractNames: string[] = [];
  const jsContracts: string[] = [];
  if (ctx.has("input")) {
    const fields = ctx.option<Record<string, string>>("input", {});
    contracts.push(
      `export interface ${typeName}Input {\n${renderTypeFields(fields, (s) => ctx.quote(s))}\n}`,
    );
    contractNames.push(`${typeName}Input`);
    if (!ts) jsContracts.push(renderJsContract(`${typeName}Input`, fields));
    if (parameters)
      throw new RecipeInputError("Use input fields or parameters, not both.");
    parameters = ts ? `input: ${typeName}Input` : "input";
  }
  if (ctx.has("output")) {
    contracts.push(
      `export interface ${typeName}Result {\n${renderTypeFields(ctx.option("output", {}), (s) => ctx.quote(s))}\n}`,
    );
    contractNames.push(`${typeName}Result`);
    if (!ts)
      jsContracts.push(
        renderJsContract(`${typeName}Result`, ctx.option("output", {})),
      );
    result = ts ? `: Promise<${typeName}Result>` : "";
  }
  const typeFile = contracts.length
    ? ctx.filePath("service-types").replace(/\.[jt]s$/u, ts ? ".ts" : ".js")
    : "";
  if (contracts.length) {
    files.push(
      ctx.file(
        typeFile,
        ctx.comment(
          "服务用例的输入与输出契约；持久化文档类型由 model 模块管理。",
          "Service input/output contracts; persistent document types belong to the model module.",
        ) +
          (ts
            ? contracts.join("\n\n")
            : jsContracts.join("\n\n") + "\nexport {};\n"),
        "Keep reusable service contracts in their owning type role.",
      ),
    );
    if (ts)
      imports += `\nimport type { ${contractNames.join(", ")} } from ${ctx.quote(ctx.relative(file, typeFile))};\n`;
  }
  if (ctx.has("body")) {
    if (ts)
      imports += `\nimport type { VextApp } from ${ctx.quote("vextjs")};\n`;
    ctx.scaffold = false;
  }
  const constructor = !ctx.has("body")
    ? ""
    : ts
      ? "  constructor(private readonly app: VextApp) {}\n\n"
      : "  /** @param {import('vextjs').VextApp} app */\n  constructor(app) {\n    this.app = app;\n  }\n\n";
  const jsTags = ts
    ? []
    : [
        ...(ctx.has("input")
          ? [
              `@param {import(${ctx.quote(ctx.relative(file, typeFile))}).${typeName}Input} input`,
            ]
          : []),
        ...(ctx.has("output")
          ? [
              `@returns {Promise<import(${ctx.quote(ctx.relative(file, typeFile))}).${typeName}Result>}`,
            ]
          : []),
      ];
  const jsdoc = jsTags.length
    ? "  /**\n" + jsTags.map((tag) => "   * " + tag).join("\n") + "\n   */\n"
    : "";
  const source = `${imports.trim()}${imports.trim() ? "\n\n" : ""}${ctx.comment("服务用例入口。保持编排靠近业务，重复的纯转换才提取到 utils。", "Service use-case entrypoint. Keep orchestration local; extract pure helpers only when reused.")}export default class ${typeName}Service {\n${constructor}${jsdoc}  async ${method}(${parameters})${result} {\n${indent(body, 4)}\n  }\n}\n`;
  return [
    ...files,
    ...ctx.loaderFacade(
      "services",
      ctx.file(
        file,
        source,
        "Create the use case service without wrapping native database APIs.",
      ),
    ),
  ];
}

export function renderApi(
  ctx: RecipeContext,
  module: boolean,
): VextMcpChangeSetFile[] {
  const wrappedSchemas = wrappedRequestSchemaLocations(ctx.options.validate);
  if (wrappedSchemas.length)
    throw new RecipeInputError(
      `validate.${wrappedSchemas.join("/validate.")} uses a whole-object JSON Schema. The default Vext request validator expects a DSL field map. Supply fields with required markers; custom validators require explicit project integration and runtime evidence.`,
      "incomplete",
    );
  for (const schema of Object.values(
    ctx.option<Record<string, Record<string, unknown>>>("validate", {}),
  )) {
    try {
      compileStaticSchema(schema as Parameters<typeof compileStaticSchema>[0]);
    } catch (error) {
      throw new RecipeInputError(
        String(error) +
          " Verify custom validator/type registries with the host.",
        "incomplete",
      );
    }
  }
  if (module && (ctx.has("handler") || ctx.has("service")))
    throw new RecipeInputError(
      "api-module calls its generated service. Use api-route for a custom handler or existing service.",
    );
  if (
    !module &&
    !ctx.has("service") &&
    (ctx.has("serviceArgs") || ctx.has("serviceMethod"))
  )
    throw new RecipeInputError(
      "serviceArgs/serviceMethod require a target service.",
    );
  if (module && ctx.has("parameters") && !ctx.has("serviceArgs"))
    throw new RecipeInputError(
      "Provide serviceArgs for the declared service parameters.",
      "incomplete",
    );
  if (
    module &&
    ctx.has("input") &&
    !ctx.has("serviceArgs") &&
    !ctx.option<Record<string, unknown>>("validate", {}).body
  )
    throw new RecipeInputError(
      "An input contract requires validate.body or explicit serviceArgs from another validated boundary.",
      "incomplete",
    );
  const files = module
    ? renderService(ctx, ctx.option("serviceMethod", "health"))
    : [];
  const routeFile = ctx.filePath("routes");
  const method = ctx.option("method", "get");
  // API method 与 service method 各自有语义，组合 Recipe 使用 serviceMethod。
  const httpMethod = [
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "head",
    "options",
  ].includes(method)
    ? method
    : "get";
  const localPath = ctx.option("path", "/");
  let handler = ctx.option("handler", "");
  if (handler && ctx.has("service"))
    throw new RecipeInputError("Choose a handler body or a target service.");
  if (!handler && (module || ctx.has("service"))) {
    const entry = module
      ? files.find((file) =>
          file.path.startsWith(ctx.runtimeRoot("services") + "/"),
        )!.path
      : undefined;
    const keys = entry
      ? ctx.serviceKey(entry)
      : ctx.option("service", "").split(".");
    if (keys.some((key) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key)))
      throw new RecipeInputError("service must be a dotted service key.");
    const serviceMethod = ctx.option("serviceMethod", "health");
    const actualMethod = serviceMethod;
    const args = ctx.option(
      "serviceArgs",
      ctx.has("input") ? `req.valid(${ctx.quote("body")})` : "",
    );
    handler = `const result = await app.services${keys.map((key) => `[${ctx.quote(key)}]`).join("")}.${actualMethod}(${args});\nres.json(result);`;
  }
  if (!handler)
    handler = "res.json({ ok: true, checkedAt: new Date().toISOString() });";
  if (
    (ctx.has("handler") || ctx.has("body") || ctx.has("service")) &&
    !ctx.has("responses")
  )
    throw new RecipeInputError(
      "Supply responses for the actual handler/service result before generating an API contract.",
      "incomplete",
    );
  const options = buildRouteOptions(ctx, {
    summary: ctx.option("description", `Read ${ctx.name}`),
    responses: ctx.option("responses", HEALTH_RESPONSE),
  });
  const source = `import { defineRoutes } from ${ctx.quote("vextjs")};\n\n${ctx.comment("HTTP 边界负责请求校验和响应契约；跨请求业务逻辑放在 service。", "The HTTP boundary owns validation and response contracts; shared business logic belongs in services.")}export default defineRoutes((app) => {\n  app.${httpMethod}(\n    ${ctx.quote(localPath)},\n${indent(renderCodeValue(ctx, options), 4)},\n    async (req, res) => {\n${indent(handler, 6)}\n    },\n  );\n});\n`;
  ctx.steps.push(
    `Route path is file-prefix based: inspect the registered ${httpMethod.toUpperCase()} path for ${routeFile} + ${localPath}; validate responses against the actual serialized result.`,
  );
  return [
    ...files,
    ...ctx.loaderFacade(
      "routes",
      ctx.file(
        routeFile,
        source,
        "Create a route that calls its declared use case.",
      ),
    ),
  ];
}

function renderModel(ctx: RecipeContext): VextMcpChangeSetFile[] {
  const file = ctx.filePath("models");
  const ts = ctx.language("models") === "ts";
  const documentName = `${pascalName(ctx.name)}Document`;
  const files: VextMcpChangeSetFile[] = [];
  let imports = ts
    ? `import type { VextModelDefinition } from ${ctx.quote("vextjs")};\n`
    : "";
  if (ctx.has("document")) {
    const typeFile = ctx
      .filePath("server-model-types")
      .replace(/\.[jt]s$/u, ts ? ".ts" : ".js");
    files.push(
      ctx.file(
        typeFile,
        ctx.comment(
          "持久化文档字段；查询能力使用 MonSQLize 的原生泛型。",
          "Persistent document fields; use native MonSQLize generics for queries.",
        ) +
          (ts
            ? `export interface ${documentName} {\n${renderTypeFields(ctx.option("document", {}), (s) => ctx.quote(s))}\n}\n`
            : renderJsContract(documentName, ctx.option("document", {})) +
              "\nexport {};\n"),
        "Own document types separately from service orchestration.",
      ),
    );
    if (ts)
      imports += `import type { ${documentName} } from ${ctx.quote(ctx.relative(file, typeFile))};\n`;
  }
  if (ctx.has("schema")) {
    try {
      compileStaticSchema(ctx.option("schema", {}));
    } catch (error) {
      throw new RecipeInputError(
        String(error) +
          " Verify any project-specific type registry in the host.",
        "incomplete",
      );
    }
  }
  const definition = {
    collection: ctx.option("collection", ctx.name),
    ...(ctx.has("key") ? { key: ctx.options.key } : {}),
    schema: ctx.option("schema", { id: "string:1-!" }),
    ...(ctx.has("connection") ? { connection: ctx.options.connection } : {}),
    ...(ctx.has("indexes") ? { indexes: ctx.options.indexes } : {}),
    ...(ctx.has("modelOptions") ? { options: ctx.options.modelOptions } : {}),
  };
  ctx.prerequisites.push(
    "Configure database on this service; shared model definitions do not create or share live connections. Verify collection/key/connection and indexes against the actual database.",
  );
  ctx.steps.push(
    `Consume the registered model through app.db.model${ts && ctx.has("document") ? `<${documentName}>` : ""}(...). Prefer native findPage/findAndCount/count/aggregate; do not preload a capped list for application-side pagination.`,
  );
  files.push(
    ...ctx.loaderFacade(
      "models",
      ctx.file(
        file,
        `${imports}\n${ctx.comment("只定义模型，不在模块导入时建立数据库连接。显式 connection 覆盖目录推断。", "Define the model without connecting at import time. Explicit connection overrides directory inference.")}${ts ? "" : `/** @type {import('vextjs').VextModelDefinition${ctx.has("document") ? `<import(${ctx.quote(ctx.relative(file, ctx.filePath("server-model-types")))}).${documentName}>` : ""}} */\n`}const ${camelName(ctx.name)}Model = ${renderCodeValue(ctx, definition)}${ts ? ` satisfies VextModelDefinition${ctx.has("document") ? `<${documentName}>` : ""}` : ""};\n\nexport default ${camelName(ctx.name)}Model;\n`,
        "Create a native model definition; leave connection ownership with the app.",
      ),
    ),
  );
  return files;
}

export function renderBackendRecipe(
  name: string,
  ctx: RecipeContext,
): VextMcpChangeSetFile[] {
  if (name === "service") return renderService(ctx);
  if (name === "api-route" || name === "api-module")
    return renderApi(ctx, name === "api-module");
  if (name === "model") return renderModel(ctx);
  if (name === "middleware") {
    const factory = ctx.option("factory", false);
    const tag = factory ? "defineMiddlewareFactory" : "defineMiddleware";
    const shape = renderTypeFields(ctx.option("options", {}), (s) =>
      ctx.quote(s),
    );
    if (ctx.has("options") && !factory)
      throw new RecipeInputError("Middleware options require factory: true.");
    const ts = ctx.language("middlewares") === "ts";
    const handler = `async (req, res, next) => {\n${indent(ctx.option("body", "await next();"), factory ? 4 : 2)}\n${factory ? "  " : ""}}`;
    const source = `import { ${tag} } from ${ctx.quote("vextjs")};\n\n${ctx.comment("中间件负责可复用的请求行为；放行时须等待 next() 完成。", "Middleware owns reusable request behavior; await next() when continuing.")}export default ${tag}${factory && ts ? `<{\n${shape}\n}>` : ""}(${factory ? `(${!ts ? `/** @type {{\n${shape}\n} | undefined} */ ` : ""}options) => {\n${Object.keys(ctx.option("options", {})).length ? `  if (!options) throw new Error(${ctx.quote(ctx.name + " middleware requires options")});\n` : ""}  return ${handler};\n}` : handler});\n`;
    ctx.steps.push(
      `Register ${ctx.name} in config.middlewares or a route's middleware options; creating the file alone does not enable it.`,
    );
    return ctx.loaderFacade(
      "middlewares",
      ctx.file(
        ctx.filePath("middlewares"),
        source,
        "Create a tagged middleware with explicit activation.",
      ),
    );
  }
  if (name === "plugin") {
    if (ctx.has("setup") && !ctx.has("onClose"))
      ctx.prerequisites.push(
        "Review setup resource ownership and supply onClose for resources owned by this plugin; never close borrowed clients.",
      );
    const hooks = ["setup", "onReady", "onClose"]
      .filter((hook) => hook === "setup" || ctx.has(hook))
      .map(
        (hook) =>
          `  async ${hook}(app${hook === "setup" ? ", context" : ""}) {\n${indent(ctx.option(hook, `app.logger.debug(${ctx.quote(ctx.name + " plugin initialized")});`), 4)}\n  },`,
      )
      .join("\n");
    const source = `import { definePlugin } from ${ctx.quote("vextjs")};\n\n${ctx.comment("外部资源在 setup 中建立，在 onClose 中释放自有资源；不在导入期连接。", "Acquire external resources in setup and release owned resources in onClose; never connect at import time.")}export default definePlugin({\n  name: ${ctx.quote(ctx.name)},\n${ctx.has("dependencies") ? `  dependencies: ${renderCodeValue(ctx, ctx.options.dependencies)},\n` : ""}${hooks}\n});\n`;
    return ctx.loaderFacade(
      "plugins",
      ctx.file(
        ctx.filePath("plugins"),
        source,
        "Create a plugin using the actual lifecycle contract.",
      ),
    );
  }
  return renderJobRecipe(ctx);
}
