/** Recipe 的目录、参数和实现共用注册表；公开目录不能宣称不存在的生成能力。 */
export interface RecipeOptionSchema {
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array";
  enum?: readonly unknown[];
  properties?: Record<string, RecipeOptionSchema>;
  additionalProperties?: boolean | RecipeOptionSchema;
  items?: RecipeOptionSchema;
  required?: string[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  anyOf?: RecipeOptionSchema[];
}

const text = (maxLength = 4000): RecipeOptionSchema => ({
  type: "string",
  minLength: 1,
  maxLength,
});
const choice = (...values: string[]): RecipeOptionSchema => ({
  type: "string",
  enum: values,
});
const object = (
  properties: Record<string, RecipeOptionSchema>,
  required?: string[],
): RecipeOptionSchema => ({
  type: "object",
  additionalProperties: false,
  properties,
  ...(required ? { required } : {}),
});
const identifier: RecipeOptionSchema = {
  ...text(120),
  pattern: "^[A-Za-z_$][A-Za-z0-9_$]*$",
};
const jsonObject: RecipeOptionSchema = {
  type: "object",
  additionalProperties: true,
};
const fields: RecipeOptionSchema = {
  type: "object",
  additionalProperties: text(500),
};
const code = text(32000);
const positive: RecipeOptionSchema = {
  type: "integer",
  minimum: 1,
  maximum: 2147483647,
};
const nonnegative: RecipeOptionSchema = { ...positive, minimum: 0 };
const bool: RecipeOptionSchema = { type: "boolean" };
const common = { description: text(), language: choice("ts", "js") };
const boolOrObject: RecipeOptionSchema = {
  anyOf: [bool, jsonObject],
};
const jsonArray: RecipeOptionSchema = {
  type: "array",
  maxItems: 50,
  items: {},
};
const route = {
  method: choice("get", "post", "put", "patch", "delete", "head", "options"),
  path: { ...text(500), pattern: "^/" },
  routeOptions: jsonObject,
  validate: jsonObject,
  responses: jsonObject,
  auth: boolOrObject,
  middlewares: jsonArray,
  cache: boolOrObject,
  docs: jsonObject,
  operationId: text(120),
  security: jsonArray,
  access: text(1000),
  handler: code,
  service: text(250),
  serviceMethod: identifier,
  serviceArgs: code,
};
const service = {
  method: identifier,
  body: code,
  parameters: text(1000),
  input: fields,
  output: fields,
  imports: code,
};
const page = {
  page: text(250),
  props: jsonObject,
  path: { ...text(500), pattern: "^/" },
  routeOptions: jsonObject,
  auth: boolOrObject,
  middlewares: jsonArray,
  cache: boolOrObject,
  docs: jsonObject,
  operationId: text(120),
  security: jsonArray,
  access: text(1000),
};

export interface VextRecipeDefinition {
  id: string;
  name: string;
  summary: string;
  group: "backend" | "frontend" | "support";
  optionsSchema: RecipeOptionSchema;
}

function recipe(
  id: string,
  name: string,
  summary: string,
  group: VextRecipeDefinition["group"],
  properties: Record<string, RecipeOptionSchema>,
): VextRecipeDefinition {
  return {
    id,
    name,
    summary,
    group,
    optionsSchema: object({ ...common, ...properties }),
  };
}

export const VEXT_RECIPE_DEFINITIONS: readonly VextRecipeDefinition[] = [
  recipe(
    "RCP-01",
    "api-route",
    "生成单个 API 路由及请求/响应契约。",
    "backend",
    route,
  ),
  recipe(
    "RCP-02",
    "api-module",
    "生成真实调用 service 的路由与用例候选。",
    "backend",
    { ...service, ...route },
  ),
  recipe(
    "RCP-03",
    "page-route",
    "生成服务端 render 路由与对应页面。",
    "frontend",
    page,
  ),
  recipe(
    "RCP-04",
    "page-and-api",
    "生成页面、API 及加载/错误交互。",
    "frontend",
    {
      ...page,
      apiPath: { ...text(500), pattern: "^/" },
      apiResponses: jsonObject,
      apiRouteOptions: jsonObject,
    },
  ),
  recipe(
    "RCP-05",
    "service",
    "生成用例 service；必要时分离输入/输出类型。",
    "backend",
    service,
  ),
  recipe(
    "RCP-06",
    "model",
    "生成原生 MonSQLize 模型定义与连接定位。",
    "backend",
    {
      collection: text(120),
      key: text(120),
      schema: jsonObject,
      document: fields,
      connection: object({ pool: text(120), database: text(120) }),
      indexes: { type: "array", items: jsonObject, maxItems: 30 },
      modelOptions: jsonObject,
    },
  ),
  recipe("RCP-07", "middleware", "生成中间件 handler 或参数工厂。", "backend", {
    body: code,
    factory: bool,
    options: fields,
  }),
  recipe(
    "RCP-08",
    "plugin",
    "生成 setup/ready/close 生命周期候选。",
    "backend",
    {
      setup: code,
      onReady: code,
      onClose: code,
      dependencies: { type: "array", items: text(120), maxItems: 30 },
    },
  ),
  recipe(
    "RCP-09",
    "locale",
    "生成模块/子模块组织的前后端语言文件。",
    "support",
    {
      target: choice("backend", "server", "frontend"),
      module: text(250),
      locale: text(50),
      messages: jsonObject,
    },
  ),
  recipe(
    "RCP-10",
    "test",
    "依据真实目标与独立预期生成测试；缺少行为信息返回 incomplete。",
    "support",
    {
      target: text(500),
      exportName: identifier,
      kind: choice("unit", "integration"),
      cases: {
        type: "array",
        minItems: 2,
        maxItems: 30,
        items: object(
          {
            name: text(250),
            args: { type: "array", maxItems: 20, items: {} },
            expected: {},
            throws: text(500),
          },
          ["name", "args"],
        ),
      },
    },
  ),
  recipe(
    "RCP-11",
    "type-contract",
    "生成服务端、前端或共享契约；JS 使用 JSDoc。",
    "support",
    {
      target: choice("server", "service", "model", "frontend", "shared"),
      fields,
    },
  ),
  recipe(
    "RCP-12",
    "utility",
    "依据用途与实现生成纯函数；不生成无意义包装。",
    "support",
    {
      target: choice("server", "shared", "validator"),
      parameters: text(1000),
      body: code,
      returnType: text(500),
    },
  ),
  recipe(
    "RCP-13",
    "frontend-component",
    "生成具有明确 props 的组件。",
    "frontend",
    { title: text(250) },
  ),
  recipe(
    "RCP-14",
    "frontend-layout",
    "生成输出 children 的页面入口或复用布局。",
    "frontend",
    { page: text(250), reusable: bool },
  ),
  recipe(
    "RCP-15",
    "reusable-schema",
    "生成供 validate/responses/Job payload 显式使用的 schema。",
    "support",
    {
      fields: jsonObject,
      consumer: text(500),
      usage: choice("request", "response", "job", "domain"),
    },
  ),
  recipe(
    "RCP-16",
    "mock-scenario",
    "分离无副作用 mock 数据与命名场景。",
    "support",
    {
      data: { type: "array", maxItems: 1000, items: jsonObject },
      scenarios: jsonObject,
      target: choice("server", "browser", "shared"),
    },
  ),
  recipe(
    "RCP-17",
    "job-handler",
    "生成 manual/queue/schedule Job；不改应用 store 或启动进程。",
    "backend",
    {
      jobName: text(120),
      payload: jsonObject,
      handler: code,
      queue: object({ enabled: bool, priority: nonnegative }),
      schedule: object({
        enabled: bool,
        cron: text(250),
        interval: positive,
        timezone: text(100),
        startAt: text(100),
        endAt: text(100),
        misfirePolicy: choice("skip", "fire-once", "catch-up"),
        maxCatchUp: positive,
        jitter: nonnegative,
        singleton: bool,
      }),
      timeout: positive,
      concurrency: positive,
      retry: {
        anyOf: [
          { enum: [false] },
          object({
            attempts: positive,
            delay: nonnegative,
            backoff: choice("fixed", "exponential"),
          }),
        ],
      },
      idempotencyKey: text(250),
    },
  ),
];

export function findRecipe(id: string): VextRecipeDefinition | undefined {
  return VEXT_RECIPE_DEFINITIONS.find(
    (recipe) => recipe.id === id || recipe.name === id,
  );
}

/** 只校验数据形状；代码片段作为候选文本，后续统一执行语法/导入/目录检查。 */
export function validateRecipeOptions(
  recipe: VextRecipeDefinition,
  value: unknown,
): string[] {
  const issues: string[] = [];
  try {
    if (Buffer.byteLength(JSON.stringify(value ?? {}), "utf8") > 256 * 1024)
      return ["Recipe options exceed the 256 KiB input budget."];
  } catch {
    return ["Recipe options must be finite JSON data."];
  }
  let visited = 0;
  function check(
    schema: RecipeOptionSchema,
    input: unknown,
    pointer: string,
    depth = 0,
  ): void {
    if (++visited > 10000 || depth > 32) {
      issues.push(`${pointer}: recipe options exceed the structural budget.`);
      return;
    }
    if (schema.anyOf) {
      const start = issues.length;
      for (const branch of schema.anyOf) {
        issues.length = start;
        check(branch, input, pointer, depth + 1);
        if (issues.length === start) return;
      }
      issues.length = start;
      issues.push(`${pointer}: does not match a supported value shape.`);
      return;
    }
    if (schema.enum && !schema.enum.includes(input))
      issues.push(`${pointer}: expected ${schema.enum.join(" | ")}.`);
    const type = Array.isArray(input)
      ? "array"
      : input === null
        ? "null"
        : typeof input;
    if (
      schema.type &&
      (schema.type === "integer"
        ? !Number.isInteger(input)
        : type !== schema.type)
    ) {
      issues.push(`${pointer}: expected ${schema.type}.`);
      return;
    }
    if (
      typeof input === "number" &&
      (!Number.isFinite(input) ||
        (schema.minimum !== undefined && input < schema.minimum) ||
        (schema.maximum !== undefined && input > schema.maximum))
    )
      issues.push(`${pointer}: outside allowed range.`);
    if (
      typeof input === "string" &&
      ((schema.minLength && input.trim().length < schema.minLength) ||
        (schema.maxLength && input.length > schema.maxLength) ||
        (schema.pattern && !new RegExp(schema.pattern, "u").test(input)))
    )
      issues.push(`${pointer}: invalid string value.`);
    if (Array.isArray(input)) {
      if (
        (schema.minItems && input.length < schema.minItems) ||
        input.length > (schema.maxItems ?? 1000)
      )
        issues.push(`${pointer}: invalid item count.`);
      for (const [index, item] of input.entries())
        check(schema.items ?? {}, item, `${pointer}[${index}]`, depth + 1);
    } else if (input !== null && typeof input === "object") {
      for (const required of schema.required ?? [])
        if (!Object.hasOwn(input, required))
          issues.push(`${pointer}.${required}: required.`);
      for (const [key, item] of Object.entries(input)) {
        if (["__proto__", "prototype", "constructor"].includes(key)) {
          issues.push(`${pointer}.${key}: unsupported object key.`);
          continue;
        }
        const child = Object.hasOwn(schema.properties ?? {}, key)
          ? schema.properties![key]
          : undefined;
        if (!child && schema.additionalProperties === false)
          issues.push(`${pointer}.${key}: unsupported option.`);
        check(
          child ??
            (typeof schema.additionalProperties === "object"
              ? schema.additionalProperties
              : {}),
          item,
          `${pointer}.${key}`,
          depth + 1,
        );
      }
    } else if (
      ["undefined", "function", "symbol", "bigint"].includes(typeof input)
    )
      issues.push(`${pointer}: must be JSON data.`);
  }
  check(recipe.optionsSchema, value ?? {}, "options");
  return [...new Set(issues)];
}
