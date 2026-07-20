import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/lib/app.js";

const CONFIG_DOCS = [
  new URL("../../website/docs/en/api/config.md", import.meta.url),
  new URL("../../website/docs/zh/api/config.md", import.meta.url),
];

function extractDocumentedDefaultConfig(markdown: string): unknown {
  const sectionStart = markdown.indexOf("## DEFAULT_CONFIG");
  expect(sectionStart).toBeGreaterThanOrEqual(0);

  const section = markdown.slice(sectionStart);
  const fence = section.match(/```typescript\r?\n([\s\S]*?)\r?\n```/);
  expect(fence).not.toBeNull();

  const code = fence![1];
  const commentStart = code.indexOf("//");
  const objectStart = code.indexOf("{", commentStart);
  const objectEnd = code.lastIndexOf("}");
  expect(commentStart).toBeGreaterThanOrEqual(0);
  expect(objectStart).toBeGreaterThan(commentStart);
  expect(objectEnd).toBeGreaterThan(objectStart);

  return runInNewContext(`(${code.slice(objectStart, objectEnd + 1)})`);
}

describe("configuration documentation parity", () => {
  for (const documentUrl of CONFIG_DOCS) {
    it(`${documentUrl.pathname} keeps DEFAULT_CONFIG aligned with runtime`, async () => {
      const markdown = await readFile(documentUrl, "utf8");
      const documented = extractDocumentedDefaultConfig(markdown);

      expect(JSON.parse(JSON.stringify(documented))).toEqual(
        JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
      );
      expect(markdown).toContain("`VEXT_PORT`");
      expect(markdown).toContain("`VEXT_HOST`");
    });
  }
});
