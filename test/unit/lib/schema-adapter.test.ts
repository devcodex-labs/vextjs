import { describe, expect, it } from "vitest";
import { schemaAdapter } from "../../../src/lib/schema-adapter.js";

describe("schemaAdapter.createI18nError", () => {
  it("keeps legacy {{param}} interpolation compatible", () => {
    schemaAdapter.configure({
      i18n: {
        locales: {
          "en-US": {
            "vext.test.legacy_placeholder": {
              code: 49001,
              message: "Limit {{max}} items",
            },
          },
        },
      },
    });

    const err = schemaAdapter.createI18nError(
      "vext.test.legacy_placeholder",
      { max: 10 },
      400,
      "en-US",
    );

    expect(err.message).toBe("Limit 10 items");
    expect(err.code).toBe(49001);
  });
});

describe("schemaAdapter v3 boundary", () => {
  it("compiles a clean object schema and derives required from the object node", () => {
    const schema = schemaAdapter.compile({
      name: schemaAdapter.compileField("string!").description("Name"),
      nickname: "string?",
      nested: { code: "string!" },
    });

    expect(schema.required).toEqual(["name"]);
    expect(schema.properties?.nested).toMatchObject({
      type: "object",
      required: ["code"],
    });
    expect(JSON.stringify(schema)).not.toMatch(
      /_required|_optional|_customMessages/,
    );
  });

  it("maps canonical path/message without consuming compatibility aliases", () => {
    expect(
      schemaAdapter.mapValidationErrors([
        {
          path: "profile.email",
          message: "Invalid email",
          field: "legacy-field",
        } as { path: string; message: string },
      ]),
    ).toEqual([{ field: "profile.email", message: "Invalid email" }]);
  });

  it("preserves normalized validation data", () => {
    const schema = schemaAdapter.compile({ page: "integer!" });
    const result = schemaAdapter.validate<{ page: number }>(schema, {
      page: "123",
    });

    expect(result.valid).toBe(true);
    expect(result.data).toEqual({ page: 123 });
  });

  it("does not install the legacy String description extension", () => {
    expect(
      Object.getOwnPropertyDescriptor(String.prototype, "description"),
    ).toBeUndefined();
  });
});
