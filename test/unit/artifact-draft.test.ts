import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactDraft } from "../../src/lib/project/artifact-draft.js";
import { createArtifactDraftPlugin } from "../../src/lib/build/artifact-draft-plugin.js";
import { evaluateGeneratedModule } from "../../src/lib/build/generated-module.js";

let root: string;
let output: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(tmpdir(), "vext-draft-"));
  output = path.join(root, "dist");
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});
function draft() {
  return new ArtifactDraft(root, [{ outDir: output, producer: "test" }]);
}

describe("artifact drafts", () => {
  it("rejects overlapping output roles before any generation", () => {
    expect(
      () =>
        new ArtifactDraft(root, [
          { outDir: output, producer: "a" },
          { outDir: path.join(output, "nested"), producer: "b" },
        ]),
    ).toThrow("must not overlap");
    expect(fs.existsSync(output)).toBe(false);
  });

  it("never reads a stale disk output and owns immutable candidate bytes until close", () => {
    fs.mkdirSync(output);
    const file = path.join(output, "index.js");
    fs.writeFileSync(file, "old");
    const current = draft();
    expect(() => current.read(file)).toThrow("missing");
    const contents = Buffer.from("new");
    current.add({ path: file, contents });
    contents[0] = 0;
    const read = current.read(file);
    read[0] = 0;
    expect(current.read(file).toString()).toBe("new");
    expect(fs.readFileSync(file, "utf8")).toBe("old");
    expect(() => current.add({ path: file, contents: "different" })).toThrow(
      "different bytes",
    );
    expect(() =>
      current.add({ path: path.join(root, "outside.js"), contents: "bad" }),
    ).toThrow("outside");
    current.close();
    expect(() => current.read(file)).toThrow("closed");
  });

  it("compiles virtual generated imports at logical paths without writing them", async () => {
    const current = draft();
    const entry = path.join(output, "entry.ts");
    const config = path.join(output, "value.ts");
    current.add({
      path: entry,
      contents: 'import { value } from "./value.js"; export default value;',
    });
    current.add({
      path: config,
      contents: 'export const value: string = "current";',
    });
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      format: "cjs",
      platform: "node",
      write: false,
      plugins: [createArtifactDraftPlugin(current)],
      logLevel: "silent",
    });
    expect(
      evaluateGeneratedModule<{ default: string }>(
        result.outputFiles![0]!.contents,
        entry,
      ).default,
    ).toBe("current");
    expect(fs.existsSync(output)).toBe(false);
    fs.mkdirSync(output);
    fs.writeFileSync(path.join(output, "missing.ts"), "export const old=1");
    current.add(
      { path: entry, contents: 'import "./missing.ts";' },
      { replace: true },
    );
    await expect(
      build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        plugins: [createArtifactDraftPlugin(current)],
        logLevel: "silent",
      }),
    ).rejects.toThrow("Current generated artifact is missing");
  });

  it("resolves real source imports from a generated directory that does not exist yet", async () => {
    const generated = path.join(root, ".vext/generated/frontend");
    const current = new ArtifactDraft(root, [
      { outDir: generated, producer: "test" },
    ]);
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(
      path.join(root, "src/entry.ts"),
      'export default "source";',
    );
    const dependency = path.join(root, "node_modules/candidate-dependency");
    fs.mkdirSync(dependency, { recursive: true });
    fs.writeFileSync(
      path.join(dependency, "package.json"),
      '{"exports":"./index.js"}',
    );
    fs.writeFileSync(
      path.join(dependency, "index.js"),
      'export default "package";',
    );
    const entry = path.join(generated, "entry.ts");
    current.add({
      path: entry,
      contents:
        'import source from "../../../src/entry.ts"; import dependency from "candidate-dependency"; export default source + dependency;',
    });
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      format: "cjs",
      platform: "node",
      write: false,
      plugins: [createArtifactDraftPlugin(current)],
      logLevel: "silent",
    });
    expect(
      evaluateGeneratedModule<{ default: string }>(
        result.outputFiles![0]!.contents,
        entry,
      ).default,
    ).toBe("sourcepackage");
    expect(fs.existsSync(generated)).toBe(false);
  });

  it("evaluates each bundle with its logical location and consumer dependency resolution", async () => {
    const logical = path.join(root, "renderer.cjs");
    fs.writeFileSync(path.join(root, "dep.cjs"), 'exports.value="local"');
    fs.writeFileSync(
      path.join(root, "dynamic.mjs"),
      'export default "dynamic";',
    );
    const code =
      'module.exports = {file: __filename, dir: __dirname, value: require("./dep.cjs").value, dynamic: () => import("./dynamic.mjs")};';
    const loaded = evaluateGeneratedModule<{
      file: string;
      dir: string;
      value: string;
      dynamic: () => Promise<{ default: string }>;
    }>(code, logical);
    expect(loaded.file).toBe(logical);
    expect(loaded.dir).toBe(root);
    expect(loaded.value).toBe("local");
    expect((await loaded.dynamic()).default).toBe("dynamic");
    expect(createRequire(logical).cache[logical]).toBeUndefined();
    expect(evaluateGeneratedModule('module.exports="second";', logical)).toBe(
      "second",
    );
    expect(fs.existsSync(logical)).toBe(false);
  });
});
