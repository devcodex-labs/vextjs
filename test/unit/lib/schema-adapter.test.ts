import { describe, expect, it } from "vitest";
import { schemaAdapter } from "../../../src/lib/schema-adapter.js";

describe("schemaAdapter.createI18nError", () => {
  it("keeps legacy {{param}} interpolation compatible with schema-dsl 2.x", () => {
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
