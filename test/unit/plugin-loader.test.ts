import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPlugins } from "../../src/lib/plugin-loader.js";
import { createHookManager } from "../../src/lib/hooks.js";

describe("plugin-loader", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("preloads import-only packages from the plugin project's node_modules", async () => {
    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "vext-plugin-loader-"),
    );
    tempDirs.push(projectRoot);

    const pluginsDir = path.join(projectRoot, ".vext", "dev", "plugins");
    fs.mkdirSync(pluginsDir, { recursive: true });

    const esmPkgDir = path.join(projectRoot, "node_modules", "esm-only-pkg");
    fs.mkdirSync(esmPkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(esmPkgDir, "package.json"),
      JSON.stringify(
        {
          name: "esm-only-pkg",
          type: "module",
          exports: {
            ".": {
              import: "./index.js",
            },
          },
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(esmPkgDir, "index.js"),
      "export const value = 42;\n",
    );

    fs.writeFileSync(
      path.join(pluginsDir, "esm-only-plugin.js"),
      [
        '"use strict";',
        'const esmOnly = require("esm-only-pkg");',
        "module.exports = {",
        '  name: "esm-only-plugin",',
        "  async setup(app) {",
        '    app.extend("esmOnlyValue", esmOnly.value);',
        "  },",
        "};",
        "",
      ].join("\n"),
    );

    const extensions: Record<string, unknown> = {};
    const app = {
      config: {},
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      hooks: createHookManager(),
      extend(key: string, value: unknown) {
        extensions[key] = value;
      },
      onReady: () => {},
      onClose: () => {},
    } as any;

    await loadPlugins(app, pluginsDir, { setupTimeout: 1_000 });

    expect(extensions.esmOnlyValue).toBe(42);
  });

  it("preloads import-only package subpaths from the plugin project's node_modules", async () => {
    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "vext-plugin-loader-"),
    );
    tempDirs.push(projectRoot);

    const pluginsDir = path.join(projectRoot, ".vext", "dev", "plugins");
    fs.mkdirSync(pluginsDir, { recursive: true });

    const esmPkgDir = path.join(projectRoot, "node_modules", "esm-only-pkg");
    fs.mkdirSync(esmPkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(esmPkgDir, "package.json"),
      JSON.stringify(
        {
          name: "esm-only-pkg",
          type: "module",
          exports: {
            "./subpath": {
              import: "./subpath.js",
            },
          },
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(esmPkgDir, "subpath.js"),
      "export const subpathValue = 84;\n",
    );

    fs.writeFileSync(
      path.join(pluginsDir, "esm-only-subpath-plugin.js"),
      [
        '"use strict";',
        'const subpath = require("esm-only-pkg/subpath");',
        "module.exports = {",
        '  name: "esm-only-subpath-plugin",',
        "  async setup(app) {",
        '    app.extend("esmOnlySubpathValue", subpath.subpathValue);',
        "  },",
        "};",
        "",
      ].join("\n"),
    );

    const extensions: Record<string, unknown> = {};
    const app = {
      config: {},
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      hooks: createHookManager(),
      extend(key: string, value: unknown) {
        extensions[key] = value;
      },
      onReady: () => {},
      onClose: () => {},
    } as any;

    await loadPlugins(app, pluginsDir, { setupTimeout: 1_000 });

    expect(extensions.esmOnlySubpathValue).toBe(84);
  });

  it("emits plugin setup hooks around user plugin setup", async () => {
    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "vext-plugin-loader-"),
    );
    tempDirs.push(projectRoot);

    const pluginsDir = path.join(projectRoot, "src", "plugins");
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginsDir, "observed.js"),
      [
        "export default {",
        '  name: "observed",',
        "  setup(app) {",
        '    app.extend("observed", true);',
        "  },",
        "};",
        "",
      ].join("\n"),
    );

    const extensions: Record<string, unknown> = {};
    const hooks = createHookManager();
    const before = vi.fn();
    const after = vi.fn();
    hooks.on("plugin:beforeSetup", before);
    hooks.on("plugin:afterSetup", after);
    const app = {
      config: {},
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      hooks,
      extend(key: string, value: unknown) {
        extensions[key] = value;
      },
      onReady: () => {},
      onClose: () => {},
    } as any;

    await loadPlugins(app, pluginsDir, { setupTimeout: 1_000 });

    expect(extensions.observed).toBe(true);
    expect(before).toHaveBeenCalledWith(
      expect.objectContaining({
        plugin: "observed",
        sourceFile: expect.stringContaining("observed.js"),
      }),
    );
    expect(after).toHaveBeenCalledWith(
      expect.objectContaining({
        plugin: "observed",
        sourceFile: expect.stringContaining("observed.js"),
        durationMs: expect.any(Number),
      }),
    );
  });
});
