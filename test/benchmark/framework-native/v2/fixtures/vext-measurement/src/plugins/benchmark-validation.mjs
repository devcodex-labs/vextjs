import { definePlugin } from "vextjs";

const ORDER_BODY_FIELDS = new Set(["sku", "quantity", "unitPrice", "currency"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOrderBodySchema(schema) {
  return (
    isRecord(schema) &&
    [...ORDER_BODY_FIELDS].every((field) => Object.hasOwn(schema, field))
  );
}

function strictOrderBodyErrors(data) {
  if (!isRecord(data)) return [];
  const errors = [];
  for (const field of Object.keys(data)) {
    if (!ORDER_BODY_FIELDS.has(field)) {
      errors.push({ field, message: "Unknown field" });
    }
  }
  if ("quantity" in data && typeof data.quantity !== "number") {
    errors.push({ field: "quantity", message: "quantity must be a number" });
  }
  if ("unitPrice" in data && typeof data.unitPrice !== "number") {
    errors.push({ field: "unitPrice", message: "unitPrice must be a number" });
  }
  return errors;
}

/**
 * The benchmark contract deliberately uses strict JSON body semantics:
 * unknown fields and decimal strings are validation failures. Vext exposes
 * this through the documented plugin-level validator replacement API, while
 * preserving its normal router, auth, service, logger and error lifecycle.
 */
export default definePlugin({
  name: "framework-native-v2-strict-order-validation",
  setup(app) {
    const originalValidator = app.getValidator();
    app.setValidator({
      compile(schema) {
        const compiled = originalValidator.compile(schema);
        if (!isOrderBodySchema(schema)) return compiled;
        return (data) => {
          const errors = strictOrderBodyErrors(data);
          return errors.length > 0 ? { valid: false, errors } : compiled(data);
        };
      },
    });
  },
});
