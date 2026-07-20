import { afterEach, describe, expect, it } from "vitest";
import {
  __vextGetStyleSheet,
  __vextResetStyleSheet,
  createVar,
  recipe,
  setVar,
  style,
  vars,
} from "../../src/frontend/style/index.js";

afterEach(() => {
  __vextResetStyleSheet();
});

describe("frontend style public examples", () => {
  it("supports the documented recipe and CSS variable examples", () => {
    const colorText = createVar("color-text", "#111827");
    const colorPrimary = createVar("color-primary", "#2563eb");
    const colorDanger = createVar("color-danger", "#dc2626");

    const button = recipe({
      base: style({
        borderRadius: 8,
        padding: "8px 12px",
        color: colorText,
      }),
      variants: {
        intent: {
          primary: style({ background: colorPrimary }),
          danger: style({ background: colorDanger }),
        },
      },
    });

    const accent = createVar("accent");
    const panel = style({
      ...vars(setVar(accent, "#4f46e5")),
      borderColor: accent,
    });

    expect(button({ intent: "primary" })).toContain("vext-recipe-");
    expect(panel).toContain("vext-style-");

    const css = __vextGetStyleSheet();
    expect(css).toContain("color:var(--vext-color-text, #111827)");
    expect(css).toContain("background:var(--vext-color-primary, #2563eb)");
    expect(css).toContain("background:var(--vext-color-danger, #dc2626)");
    expect(css).toContain("--vext-accent:#4f46e5");
    expect(css).toContain("border-color:var(--vext-accent)");
  });
});
