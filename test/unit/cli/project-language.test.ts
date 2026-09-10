import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectProject } from "../../../src/cli/utils/detect-project.js";

const roots: string[] = [];
function project(configFile: string): string {
  const root = mkdtempSync(join(tmpdir(), "vext-language-"));
  roots.push(root);
  write(root, "package.json", '{"name":"language-fixture","type":"module"}');
  write(root, `src/config/${configFile}`, "export default {};");
  return root;
}
function write(root: string, file: string, content: string): void {
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("project language", () => {
  it.each([false, true])(
    "keeps a JS project with tsconfig allowJs=%s runnable as JS",
    (allowJs) => {
      const root = project("default.js");
      write(
        root,
        "tsconfig.json",
        JSON.stringify({ compilerOptions: { allowJs, checkJs: allowJs } }),
      );
      expect(detectProject(root).language).toBe("js");
    },
  );

  it("detects TypeScript source without requiring a tsconfig", () => {
    const root = project("default.ts");
    expect(detectProject(root).language).toBe("ts");
  });

  it.each(["ts", "mts", "cts"])(
    "detects backend .%s sources alongside JavaScript config",
    (extension) => {
      const root = project("default.js");
      write(
        root,
        `src/services/order.${extension}`,
        "export default class Order {};",
      );
      expect(detectProject(root).language).toBe("ts");
    },
  );

  it("does not mistake declarations, tests or standalone preloads for backend TS", () => {
    const root = project("default.js");
    write(root, "tsconfig.json", "{}");
    for (const file of [
      "types.d.ts",
      "types.d.mts",
      "types.d.cts",
      "routes/a.test.ts",
      "preload/instrument.ts",
    ]) {
      write(root, `src/${file}`, "export {};");
    }
    expect(detectProject(root).language).toBe("js");
  });

  it("keeps a client-named backend directory when frontend was not enabled", () => {
    const root = project("default.js");
    write(root, "src/client/page.ts", "export const backendHelper = 1;");
    expect(detectProject(root).language).toBe("ts");
  });

  it.each(["mts", "cts"])(
    "explains an unsupported default.%s config entry",
    (extension) => {
      const root = project(`default.${extension}`);
      expect(() => detectProject(root)).toThrow(`default.${extension}`);
      expect(() => detectProject(root)).toThrow("not supported");
    },
  );
});
