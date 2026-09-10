import { describe, expect, it } from "vitest";
import { assertCanonicalRouteFactorySource } from "../../src/lib/route-contract.js";
import { parseSourceSyntax } from "../../src/lib/source-syntax.js";

describe("shared AST route factory contract", () => {
  it("parses regex delimiters and Unicode without confusing registration statements", () => {
    expect(
      assertCanonicalRouteFactorySource(
        '(app) => { const 中文 = /[)};\\/]/; app.get("/🧪", () => 中文); }',
      ),
    ).toBe(1);
    const source = 'const 中文 = "🧪"; const value = 42;';
    const last = parseSourceSyntax("unicode.ts", source).body[1]!;
    expect(source.slice(last.start, last.end)).toBe("const value = 42;");
  });
  it.each([
    '(app) => { const x = `${app.get("/hidden", () => {})}`; }',
    '(app) => { (() => app.get("/nested", () => {}))(); }',
    '(app) => { app?.get("/optional", () => {}); }',
    '(app) => { app["get"]("/computed", () => {}); }',
    '(app) => { app = other; app.get("/rebound", () => {}); }',
    '(app) => { function child(app) { app.get("/shadow", () => {}); } }',
    '(app) => { app.get("/a", () => {}), app.get("/b", () => {}); }',
  ])("rejects hidden or ambiguous registrations: %s", (source) => {
    expect(() => assertCanonicalRouteFactorySource(source)).toThrow(
      /direct top-level/,
    );
  });
  it("does not execute unrelated expressions while parsing", () => {
    expect(
      assertCanonicalRouteFactorySource(
        '(app) => { throw new Error("must not run"); app.get("/", () => {}); }',
      ),
    ).toBe(1);
  });
});
