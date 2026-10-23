/**
 * Behavior lock for the safe glob/matcher wrappers.
 *
 * The expected results in `fixtures/glob-compat.json` were captured from the
 * previous fast-glob@3.3.3 / micromatch@4.0.8 implementation before the wrappers
 * moved to tinyglobby/picomatch. Set `VEXT_UPDATE_GLOB_COMPAT=1` only when an
 * intentional, documented behavior change is accepted.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fg from "../../src/lib/safe-glob.js";
import micromatch from "../../src/lib/safe-micromatch.js";

const fixturePath = path.join(
  path.dirname(
    new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  ),
  "fixtures",
  "glob-compat.json",
);
const update = process.env.VEXT_UPDATE_GLOB_COMPAT === "1";
const expected: Record<string, unknown> = update
  ? {}
  : JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const actual: Record<string, unknown> = {};

const FILES = [
  "a.ts",
  "a.js",
  "b.txt",
  ".hidden.ts",
  "index.html",
  "src/x.ts",
  "src/x.json",
  "src/.dot/y.ts",
  "src/sub/z.mts",
  "src/sub/z.cts",
  "src/sub/z.d.ts",
  "src/sub/z.test.ts",
  "src/sub/z.spec.js",
  "src/sub/_private.ts",
  "src/preload/p.ts",
  "assets/img.png",
  "assets/img.webp",
  "assets/tmp/t.png",
  "assets/.DS_Store",
  "private/p.txt",
  "a/1.js",
  "a/2.js",
  "a/3.js",
  "a/4.js",
  "a/x/q.js",
  "b/w.js",
  "c/k.js",
  "c/k.map",
  "paren(1)/f.ts",
  "brace{x}/g.ts",
];

let root = "";
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "vext-glob-compat-"));
  for (const file of FILES) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), file);
  }
  try {
    fs.symlinkSync(path.join(root, "src"), path.join(root, "linked"), "dir");
  } catch {
    // Symlinks may be unavailable on restricted Windows runners.
  }
});
afterAll(() => {
  if (update) {
    fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
    fs.writeFileSync(fixturePath, `${JSON.stringify(actual, null, 2)}\n`);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

function record(name: string, value: unknown): void {
  actual[name] = value;
  if (!update) expect(value, name).toEqual(expected[name]);
}
const rel = (files: string[]) =>
  files.map((file) => path.relative(root, file).replaceAll("\\", "/")).sort();
const hasLink = () => fs.existsSync(path.join(root, "linked"));

const globCases: Array<[string, string | string[], Record<string, unknown>]> = [
  ["all-files", "**/*", {}],
  ["all-dot", "**/*", { dot: true }],
  ["braces-ext", "**/*.{ts,mts,cts}", {}],
  ["braces-nested", "{src/{sub,.dot},a}/*", { dot: true }],
  ["range", "a/{1..3}.js", {}],
  ["range-step", "a/{1..4..2}.js", {}],
  ["negation-in-list", ["**/*.js", "!a/x/**"], {}],
  ["negation-only-tail", ["a/*", "!a/1.js", "!a/2.js"], {}],
  [
    "ignore-list",
    "**/*",
    { ignore: ["**/*.d.ts", "**/*.test.*", "**/*.spec.*"] },
  ],
  [
    "ignore-dir",
    "**/*",
    { dot: true, ignore: ["assets/**", "src/preload/**"] },
  ],
  [
    "ignore-underscore",
    "**/*.{ts,js,mjs,cjs}",
    { ignore: ["**/_*.{ts,js,mjs,cjs}", "**/*.d.ts"] },
  ],
  ["static-file", "a/1.js", {}],
  ["static-missing", "nope/never.js", {}],
  ["directory-pattern-no-expand", "src", {}],
  ["only-dirs", "src/*", { onlyFiles: false }],
  ["extglob", "**/+(a|b).ts", {}],
  ["charclass", "a/[1-2].js", {}],
  ["dot-dir-explicit", "src/.dot/*", {}],
  ["escaped-paren", "paren\\(1\\)/*", {}],
  ["escaped-brace", "brace\\{x\\}/*", {}],
  ["leading-dot-slash", "./src/*.ts", {}],
  ["json", "**/*.json", { ignore: ["preload/**"] }],
  ["png-webp", "**/*.{png,webp}", { dot: true, ignore: ["**/.DS_Store"] }],
];

describe("safe-glob behavior lock", () => {
  for (const [name, pattern, options] of globCases) {
    it(`relative ${name}`, async () => {
      const opts = { cwd: root, ...options };
      const viaDefault = (await fg(pattern, opts)).slice().sort();
      const viaGlob = (await fg.glob(pattern, opts)).slice().sort();
      const viaSync = fg.sync(pattern, opts).slice().sort();
      expect(viaGlob).toEqual(viaDefault);
      expect(viaSync).toEqual(viaDefault);
      record(
        `glob:${name}`,
        viaDefault.filter((f) => !f.startsWith("linked")),
      );
    });
    it(`absolute ${name}`, async () => {
      const files = await fg(pattern, {
        cwd: root,
        absolute: true,
        ...options,
      });
      for (const file of files) expect(path.isAbsolute(file)).toBe(true);
      expect(files.every((file) => !file.includes("\\"))).toBe(true);
      record(
        `abs:${name}`,
        rel(files).filter((f) => !f.startsWith("linked")),
      );
    });
  }

  it("does not follow symbolic links when disabled", async () => {
    if (!hasLink()) return;
    const files = await fg("**/*", {
      cwd: root,
      dot: true,
      onlyFiles: true,
      followSymbolicLinks: false,
    });
    expect(files.filter((f) => f.startsWith("linked/"))).toEqual([]);
    const followed = await fg("linked/**/*.ts", { cwd: root });
    expect(followed.length).toBeGreaterThan(0);
  });

  it("returns unique results for overlapping patterns", async () => {
    const files = await fg(["a/*.js", "a/1.js", "a/{1,2}.js"], { cwd: root });
    expect(files.length).toBe(new Set(files).size);
    record("glob:dedupe", files.slice().sort());
  });

  it("escapes paths and classifies dynamic patterns like fast-glob", () => {
    const paths = [
      "paren(1)/f.ts",
      "brace{x}/g.ts",
      "a[1]/b",
      "!lead",
      "plain/file.ts",
      "x+(y)",
      "star*?",
    ];
    record(
      "escapePath",
      paths.map((p) => fg.escapePath(p)),
    );
    const dynamic = [
      "*.ts",
      "a/**",
      "a/{b,c}",
      "a/{b}",
      "a/[bc]",
      "+(a|b)",
      "(a|b)",
      "!neg",
      "plain",
      "a\\*",
      "{1..3}",
      "@(x)",
    ];
    record(
      "isDynamicPattern",
      dynamic.map((p) => [p, fg.isDynamicPattern(p)]),
    );
  });

  it("generates deploy tasks with the same grouping", () => {
    const cases: Array<[string[], string[]]> = [
      [["**/*"], []],
      [["**/*"], ["**/*.map", "private/**"]],
      [
        ["{a,b}/**", "c/*.js"],
        ["a/x/**", "!keep"],
      ],
      [["assets/**", "!assets/tmp/**"], ["**/.DS_Store"]],
      [["a/{1..3}.js"], []],
      [["index.html", "assets/*", "**/*.js"], ["c/**"]],
      [["../outside/*", "src/**"], []],
      [["a/{b,}/c/*"], []],
      [["a//b/*"], []],
    ];
    record(
      "generateTasks",
      cases.map(([include, ignore]) =>
        fg.generateTasks(include, { dot: true, ignore }),
      ),
    );
  });
});

describe("safe-micromatch behavior lock", () => {
  const list = FILES;
  const listCases: Array<[string, string | string[], Record<string, unknown>]> =
    [
      ["star", "*.{ts,js}", {}],
      ["globstar", "**/*.ts", {}],
      ["globstar-dot", "**/*.ts", { dot: true }],
      ["negation", ["**/*", "!src/**"], {}],
      ["negation-only", ["!**/*.js"], {}],
      ["ignore", "**/*", { dot: true, ignore: ["assets/**", "**/*.map"] }],
      ["range", "a/{1..3}.js", {}],
      ["extglob", "**/!(*.d).ts", {}],
      ["charclass", "a/[13].js", {}],
      ["reinclude", ["a/*", "!a/*", "a/1.js"], {}],
    ];
  for (const [name, pattern, options] of listCases) {
    it(`list ${name}`, () => {
      record(`mm:${name}`, micromatch(list, pattern, options));
    });
  }

  it("isMatch semantics used by discovery and job selection", () => {
    const probes: Array<[string, string | string[], Record<string, unknown>?]> =
      [
        ["src/x.ts", "**/*.{ts,js,mjs,cjs}"],
        ["src/x.d.ts", ["**/*.d.ts", "**/*.test.*"]],
        ["src/x.test.ts", ["**/*.d.ts", "**/*.test.*"]],
        ["jobs/_helper.ts", ["**/_*", "**/*.d.ts"]],
        [".cache/a.ts", "**/*.ts"],
        [".cache/a.ts", "**/*.ts", { dot: true }],
        ["node_modules", ["node_modules", "dist/**"], { dot: true }],
        ["node_modules/", ["node_modules/", "dist/**"], { dot: true }],
        ["dist/", ["dist/**"], { dot: true }],
        ["dist", ["dist/**"], { dot: true }],
        ["src/a/b", ["src/**"], { dot: true }],
        ["a", ["!a"]],
        ["b", ["!a"]],
        ["x/y.js", ["*.js"]],
        ["x\\y.js", ["x/*.js"]],
        ["a/2.js", "a/{1..3}.js"],
        ["a/4.js", "a/{1..3}.js"],
        ["assets/tmp", ["assets/tmp/**"], { dot: true }],
        ["assets", ["assets/tmp/**"], { dot: true }],
        ["src/sub/z.ts", "src/**/*.ts", { ignore: "src/sub/**" }],
      ];
    record(
      "isMatch",
      probes.map(([value, pattern, options]) => [
        value,
        pattern,
        micromatch.isMatch(value, pattern, options),
      ]),
    );
  });

  it("exposes matcher/makeRe/scan helpers", () => {
    expect(micromatch.matcher("*.ts")("a.ts")).toBe(true);
    expect(micromatch.makeRe("*.ts").test("a.ts")).toBe(true);
    record(
      "scan",
      ["src/**/*.ts", "{a,b}/*", "plain/file", "!neg/*"].map((p) => {
        const { base, glob, isGlob, negated } = micromatch.scan(p);
        return { base, glob, isGlob, negated };
      }),
    );
  });
});
