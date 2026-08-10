import { createVar, recipe } from "vextjs/style";

const colorText = createVar("color-text", "#111827");
const colorPrimary = createVar("color-primary", "#2563eb");
const colorDanger = createVar("color-danger", "#dc2626");

export const button = recipe({
  name: "button",
  base: {
    borderRadius: 8,
    padding: "8px 12px",
    border: 0,
    color: colorText,
  },
  variants: {
    intent: {
      primary: { backgroundColor: colorPrimary },
      danger: { backgroundColor: colorDanger },
    },
  },
  defaultVariants: { intent: "primary" },
});
