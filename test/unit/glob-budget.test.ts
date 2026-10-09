import { describe, it, expect } from "vitest";
import { assertGlobBudget } from "../../src/lib/glob-budget.js";
import fg from "../../src/lib/safe-glob.js";
import micromatch from "../../src/lib/safe-micromatch.js";

describe("bounded configuration glob parsing", () => {
  it("accepts normal glob, escaped braces, ranges, character classes and extglobs", () => {
    assertGlobBudget([
      "**/*.{js,ts,tsx}",
      "**/+(a|b).ts",
      "[a-z]/\\{literal\\}.ts",
      "{1..100..2}",
      "{a..z}",
    ]);
    expect(micromatch(["a.ts", "a.js", "b.txt"], "*.{ts,js}")).toEqual([
      "a.ts",
      "a.js",
    ]);
    expect(fg.generateTasks("**/*.{ts,js}")).not.toHaveLength(0);
    expect(micromatch.matcher("*.ts")("a.ts")).toBe(true);
  });
  it.each([
    "{".repeat(101),
    "(".repeat(101),
    "{".repeat(101) + "x" + "}".repeat(101),
    "x".repeat(4097),
    "{1..1000000}",
    "{1..10..0}",
    "{a,b}".repeat(13),
  ])(
    "rejects recursive or explosive input before all parser entry points",
    (pattern) => {
      for (const parse of [
        () => assertGlobBudget(pattern),
        () => fg.sync(pattern),
        () => fg.glob(pattern),
        () => fg.generateTasks(pattern),
        () => fg.isDynamicPattern(pattern),
        () => micromatch.isMatch("a", pattern),
        () => micromatch.makeRe(pattern),
        () => micromatch.matcher(pattern),
        () => micromatch.parse(pattern),
        () => micromatch.scan(pattern),
      ])
        expect(parse).toThrow(/\[vextjs\].*(?:nesting|4096|expansion)/);
    },
  );
  it("guards ignore patterns and malformed character classes as well", () => {
    expect(() =>
      fg.generateTasks("**/*", { ignore: ["{".repeat(101)] }),
    ).toThrow("glob ignore");
    expect(() =>
      micromatch.isMatch("a", "*", { ignore: "{".repeat(101) }),
    ).toThrow("glob ignore");
    expect(() => assertGlobBudget("[" + "{".repeat(101))).toThrow("nesting");
  });
});
