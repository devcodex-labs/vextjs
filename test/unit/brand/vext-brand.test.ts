import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  VEXT_DOCS_THEME,
  VEXT_FAVICON_SVG,
  VEXT_MARK_SVG,
  renderVextMarkSvg,
} from "../../../src/lib/brand/vext-brand.js";
import {
  VEXT_DOCS_FAVICON_SVG,
  VEXT_DOCS_STYLE_CSS,
} from "../../../src/lib/docs/renderers/vext-assets.js";

function normalize(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string): number => {
    const channels = hex
      .slice(1)
      .match(/.{2}/g)!
      .map((value) => Number.parseInt(value, 16) / 255)
      .map((value) =>
        value <= 0.04045
          ? value / 12.92
          : Math.pow((value + 0.055) / 1.055, 2.4),
      );
    return (
      0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
    );
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("Vext brand source", () => {
  it("keeps website, scaffold, and OpenAPI favicon projections identical", () => {
    const websiteMark = readFileSync(
      resolve("website/docs/public/logo.svg"),
      "utf8",
    );
    const websiteFavicon = readFileSync(
      resolve("website/docs/public/favicon.svg"),
      "utf8",
    );

    expect(normalize(websiteMark)).toBe(normalize(VEXT_MARK_SVG));
    expect(normalize(websiteFavicon)).toBe(normalize(VEXT_FAVICON_SVG));
    expect(normalize(VEXT_DOCS_FAVICON_SVG)).toBe(normalize(VEXT_FAVICON_SVG));
  });

  it("renders the sidebar mark from the same geometry with safe attributes", () => {
    const mark = renderVextMarkSvg({
      className: 'brand" mark',
      ariaHidden: true,
    });

    expect(mark).toContain('class="brand&quot; mark"');
    expect(mark).toContain('aria-hidden="true"');
    expect(mark).toContain('d="M14 14L35 58L58 14"');
  });

  it("uses the Vext palette without the previous blue docs theme", () => {
    expect(VEXT_DOCS_STYLE_CSS).toContain(
      `--vext-bg: ${VEXT_DOCS_THEME.dark.background}`,
    );
    expect(VEXT_DOCS_STYLE_CSS).toContain(
      `--vext-accent: ${VEXT_DOCS_THEME.dark.accent}`,
    );
    expect(VEXT_DOCS_STYLE_CSS).not.toMatch(/#2563eb|#60a5fa/i);
  });

  it("keeps primary text and interactive accents at AA contrast", () => {
    for (const theme of Object.values(VEXT_DOCS_THEME)) {
      expect(
        contrastRatio(theme.text, theme.background),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(theme.accent, theme.background),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
