/** Detect a whole-object JSON Schema where the default request validator expects a DSL field map. */
export function wrappedRequestSchemaLocations(validate: unknown): string[] {
  if (!isRecord(validate)) return [];
  return ["body", "query", "param", "header", "cookie"].filter((location) => {
    const schema = validate[location];
    return (
      isRecord(schema) &&
      schema.type === "object" &&
      isRecord(schema.properties) &&
      (Array.isArray(schema.required) ||
        typeof schema.additionalProperties === "boolean")
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
