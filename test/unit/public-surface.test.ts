import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  collectPublicSurface,
  validatePublicSurface,
} from "../../scripts/validation/verify-public-surface.mjs";

describe("reviewed public surface coverage", () => {
  it("covers actual package exports, nested config, every CLI parser and Docs source kind", () => {
    const surface = collectPublicSurface();
    const coverage = JSON.parse(
      fs.readFileSync("test/fixtures/public-surface/coverage.json", "utf8"),
    );
    expect(validatePublicSurface(surface, coverage)).toEqual([]);
    for (const id of [
      "cli:create:--template",
      "cli:doctor:--manifest-only",
      "cli:start:--outdir",
      "config:frontend.i18n.clientLoad",
      "docs-source:locale",
      "symbol:vextjs/frontend#useVextI18n",
    ]) {
      expect(
        surface.some((item) => item.id === id),
        id,
      ).toBe(true);
    }
    for (const id of [
      "symbol:vextjs#newApi",
      "config:newOption",
      "cli:newCommand",
      "docs-source:newKind",
    ]) {
      expect(
        validatePublicSurface(
          [...surface, { id, source: "src/new.ts" }],
          coverage,
        ),
      ).toContain(`Unmapped public surface: ${id} (src/new.ts)`);
    }
    const removed = surface[0];
    expect(validatePublicSurface(surface.slice(1), coverage)).toContain(
      `Removed surface still mapped: ${removed.id}`,
    );
  });
});
