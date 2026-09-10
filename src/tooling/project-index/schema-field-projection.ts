import type { VextSchemaFieldProjectionV1 } from "../../frontend/contract/types.js";

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** 只投影可证明的字段事实，不在框架中另写一套 schema-dsl 转换器。 */
export function projectSchemaFields(
  schema: Record<string, unknown>,
  request: boolean,
): VextSchemaFieldProjectionV1[] {
  const result: VextSchemaFieldProjectionV1[] = [];
  const pending = [{ schema, path: "", required: true }];
  while (pending.length) {
    const field = pending.pop()!;
    const types = Array.isArray(field.schema.type)
      ? field.schema.type
      : [field.schema.type];
    const compound = ["$ref", "oneOf", "anyOf", "allOf", "if", "not"].some(
      (key) => field.schema[key] !== undefined,
    );
    const nullable =
      types.every((type) => typeof type === "string") &&
      !types.includes("null") &&
      field.schema.nullable !== true
        ? false
        : compound ||
            field.schema.enum !== undefined ||
            field.schema.const !== undefined ||
            field.schema.type === undefined
          ? ("unknown" as const)
          : field.schema.nullable === true || types.includes("null");
    const smart =
      request &&
      (compound ||
        types.some(
          (type) =>
            type === "integer" ||
            type === "number" ||
            type === "boolean" ||
            type === "object" ||
            type === "array",
        ));
    result.push({
      path: field.path,
      required: field.required,
      nullable,
      ...(Object.hasOwn(field.schema, "default")
        ? { defaultValue: field.schema.default }
        : {}),
      // 数字字符串的转换及转换后的范围校验不能用一个原始 JSON Schema 精确表达。
      input: smart
        ? {
            completeness: "unknown",
            reason:
              "Default schema-dsl smart coercion runs before these output constraints; raw input acceptance requires runtime validation.",
          }
        : { schema: field.schema, completeness: "complete" },
      output: { schema: field.schema, completeness: "complete" },
      coercion: smart ? "schema-dsl-smart" : "none",
    });
    if (object(field.schema.properties)) {
      const required = Array.isArray(field.schema.required)
        ? field.schema.required
        : [];
      for (const [name, child] of Object.entries(
        field.schema.properties,
      ).reverse())
        if (object(child))
          pending.push({
            schema: child,
            path: `${field.path}/${name.replace(/~/gu, "~0").replace(/\//gu, "~1")}`,
            required: required.includes(name),
          });
    }
    if (object(field.schema.items))
      pending.push({
        schema: field.schema.items,
        path: `${field.path}/*`,
        required: false,
      });
  }
  return result;
}
