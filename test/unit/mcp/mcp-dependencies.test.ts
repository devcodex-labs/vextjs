import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inspectProjectDependencies } from "../../../src/tooling/project-index/dependencies.js";

let root: string;
const manifest = { name: "app", dependencies: { vextjs: "^2.0.0" } };
function pkg(directory: string, name: string, version: string, extra = {}) {
  fs.mkdirSync(path.join(root, directory), { recursive: true });
  fs.writeFileSync(
    path.join(root, directory, "package.json"),
    JSON.stringify({ name, version, ...extra }),
  );
}
beforeEach(() => {
  root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "vext-dependency-facts-")),
  );
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
});
afterEach(() => {
  expect(path.dirname(fs.realpathSync.native(root))).toBe(
    fs.realpathSync.native(os.tmpdir()),
  );
  expect(path.basename(root)).toMatch(/^vext-dependency-facts-/u);
  fs.rmSync(root, { recursive: true, force: true });
});

describe("dependency identity", () => {
  it("keeps the framework's native API version separate from a consumer's direct import", () => {
    pkg("node_modules/vextjs", "vextjs", "2.0.1", {
      dependencies: { monsqlize: "^1.0.0" },
    });
    pkg("node_modules/vextjs/node_modules/monsqlize", "monsqlize", "1.0.2");
    pkg("node_modules/monsqlize", "monsqlize", "2.0.0");
    const result = inspectProjectDependencies(root, {
      ...manifest,
      dependencies: { ...manifest.dependencies, monsqlize: "^2.0.0" },
    });
    expect(
      result.facts
        .filter((item) => item.name === "monsqlize")
        .map((item) => [item.owner, item.version]),
    ).toEqual([
      ["framework", "1.0.2"],
      ["service", "2.0.0"],
    ]);
  });

  it("reads installed metadata instead of treating declared ranges as installed versions", () => {
    pkg("node_modules/vextjs", "vextjs", "2.0.1", {
      dependencies: { monsqlize: "^1.0.0" },
    });
    pkg("node_modules/vextjs/node_modules/monsqlize", "monsqlize", "1.0.2", {
      exports: { ".": "./danger.js" },
    });
    fs.writeFileSync(
      path.join(root, "node_modules/vextjs/node_modules/monsqlize/danger.js"),
      "throw new Error('must not execute dependency');",
    );
    const result = inspectProjectDependencies(root, manifest);
    expect(result.facts.find((item) => item.name === "vextjs")).toMatchObject({
      declaredRange: "^2.0.0",
      version: "2.0.1",
      state: "resolved",
    });
    expect(
      result.facts.find((item) => item.name === "monsqlize"),
    ).toMatchObject({
      owner: "framework",
      declaredRange: "^1.0.0",
      version: "1.0.2",
    });
    pkg("node_modules/vextjs/node_modules/monsqlize", "monsqlize", "1.0.3");
    expect(inspectProjectDependencies(root, manifest).digest).not.toBe(
      result.digest,
    );
  });

  it("retains unknown resolution and cancellation instead of borrowing the MCP host's dependencies", () => {
    const result = inspectProjectDependencies(root, manifest);
    expect(result.facts.find((item) => item.name === "vextjs")).toMatchObject({
      state: "not-installed",
      version: null,
    });
    expect(
      result.facts.find((item) => item.name === "monsqlize"),
    ).toMatchObject({ state: "not-installed", version: null });
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      inspectProjectDependencies(root, manifest, controller.signal),
    ).toThrow();
  });
});
