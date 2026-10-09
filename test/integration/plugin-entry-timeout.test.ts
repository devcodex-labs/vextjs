import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { bootstrap } from "../../src/lib/bootstrap.js";
import { devBootstrap } from "../../src/lib/dev/dev-bootstrap.js";
import { createTestApp } from "../../src/testing/index.js";

it.each(["production", "development", "testing"] as const)(
  "enforces configured setup deadline through the %s entry",
  async (mode) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vext-plugin-entry-"));
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV =
      mode === "development"
        ? "development"
        : mode === "testing"
          ? "test"
          : "production";
    try {
      await mkdir(path.join(root, "src/config"), { recursive: true });
      await mkdir(path.join(root, "src/plugins"));
      await writeFile(
        path.join(root, "package.json"),
        '{"name":"plugin-timeout-consumer","type":"module","private":true}',
      );
      await writeFile(
        path.join(root, "tsconfig.json"),
        '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler"},"include":["src/**/*"]}',
      );
      const config = {
        port: 31001,
        host: "127.0.0.1",
        plugin: { setupTimeout: 1 },
        frontend: false,
        logger: { level: "silent" },
        openapi: { enabled: false },
        _testMode: true,
      } as const;
      await writeFile(
        path.join(root, "src/config/default.js"),
        `export default ${JSON.stringify(config)};`,
      );
      await writeFile(
        path.join(root, "src/plugins/slow.js"),
        'export default { name: "slow-entry", async setup() { await new Promise(resolve => setTimeout(resolve, 60)); } };',
      );
      const start =
        mode === "production"
          ? bootstrap(root)
          : mode === "development"
            ? devBootstrap({ projectRoot: root, skipIpc: true })
            : createTestApp({
                rootDir: root,
                config,
                plugins: true,
                services: false,
                routes: false,
                middlewares: false,
              });
      await expect(start).rejects.toThrow(/slow-entry.*timed out.*1ms/s);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
      await rm(root, { recursive: true, force: true });
    }
  },
);
