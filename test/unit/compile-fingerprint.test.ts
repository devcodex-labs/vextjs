import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCompileFingerprint } from "../../src/lib/build/compile-fingerprint.js";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(tmpdir(), "vext-fingerprint-"));
  write("src/index.ts", "export const value = 1");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function write(file: string, content: string) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
function fingerprint(extra: Record<string, unknown> = {}) {
  return createCompileFingerprint({
    rootDir: root,
    srcDir: path.join(root, "src"),
    entryPoints: ["index.ts"],
    parameters: { mode: "development", ...extra },
  });
}

describe("compile input fingerprints", () => {
  it("compares source bytes even with the same file size and mtime", () => {
    const file = path.join(root, "src/index.ts");
    const initial = fingerprint();
    const stat = fs.statSync(file);
    write("src/index.ts", "export const value = 2");
    fs.utimesSync(file, stat.atime, stat.mtime);
    expect(fingerprint().digest).not.toBe(initial.digest);
    expect(initial.complete).toBe(true);
  });
  it("is stable and includes compiler parameters and newly added package/lock metadata", () => {
    const initial = fingerprint();
    expect(fingerprint()).toEqual(initial);
    expect(fingerprint({ minify: true }).digest).not.toBe(initial.digest);
    write("package.json", '{"type":"module"}');
    expect(fingerprint().digest).not.toBe(initial.digest);
    const afterPackage = fingerprint();
    write("pnpm-lock.yaml", "lockfileVersion: '9.0'");
    expect(fingerprint().digest).not.toBe(afterPackage.digest);
  });
  it("tracks BOM, comments, multiple extends, and transitive references", () => {
    write(
      "tsconfig.json",
      '\uFEFF{ // context\n "extends": ["./config/base", "./config/other.json"], "references": [{"path":"./shared"}], }',
    );
    write("config/base.json", '{"compilerOptions":{"target":"ES2020"}}');
    write("config/other.json", "{}");
    write("shared/tsconfig.json", '{"extends":"../config/shared.json"}');
    write("config/shared.json", "{}");
    const initial = fingerprint();
    expect(initial.complete).toBe(true);
    write("config/base.json", '{"compilerOptions":{"target":"ES2022"}}');
    expect(fingerprint().digest).not.toBe(initial.digest);
    const afterBase = fingerprint();
    write("config/shared.json", '{"compilerOptions":{"strict":true}}');
    expect(fingerprint().digest).not.toBe(afterBase.digest);
  });
  it("includes the resolved installed tsconfig package bytes", () => {
    write("tsconfig.json", '{"extends":"@settings/base/tsconfig.json"}');
    write(
      "node_modules/@settings/base/package.json",
      '{"name":"@settings/base","version":"1.0.0"}',
    );
    write("node_modules/@settings/base/tsconfig.json", "{}");
    const initial = fingerprint();
    expect(initial.complete).toBe(true);
    write(
      "node_modules/@settings/base/tsconfig.json",
      '{"compilerOptions":{"useDefineForClassFields":true}}',
    );
    expect(fingerprint().digest).not.toBe(initial.digest);
  });
  it.each([
    '{"extends":"./missing"}',
    '{"extends":[false]}',
    '{"references":false}',
    '{"references":[{}]}',
    "{bad json}",
  ])("disables cache reuse for incomplete config evidence: %s", (content) => {
    write("tsconfig.json", content);
    expect(fingerprint().complete).toBe(false);
    expect(fingerprint().problems.length).toBeGreaterThan(0);
  });
  it("terminates cyclic extends without pretending the graph is complete", () => {
    write("tsconfig.json", '{"extends":"./base.json"}');
    write("base.json", '{"extends":"./tsconfig.json"}');
    expect(fingerprint().complete).toBe(false);
  });

  it("invalidates after an exported config is redirected, including its new transitive base", () => {
    write("tsconfig.json", '{"extends":"@settings/base/tsconfig.json"}');
    write(
      "node_modules/@settings/base/package.json",
      '{"name":"@settings/base","exports":{"./tsconfig.json":"./a.json"}}',
    );
    write("node_modules/@settings/base/a.json", "{}");
    write(
      "node_modules/@settings/base/b.json",
      '{"extends":"../../../shared.json"}',
    );
    write("shared.json", "{}");
    const first = fingerprint();
    write(
      "node_modules/@settings/base/package.json",
      '{"name":"@settings/base","exports":{"./tsconfig.json":"./b.json"}}',
    );
    const redirected = fingerprint();
    expect(redirected.digest).not.toBe(first.digest);
    write(
      "shared.json",
      '{"compilerOptions":{"useDefineForClassFields":true}}',
    );
    expect(fingerprint().digest).not.toBe(redirected.digest);
  });
});
