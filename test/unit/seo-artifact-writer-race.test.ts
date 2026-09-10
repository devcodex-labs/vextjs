import * as fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withProjectOwner } from "../../src/lib/project/owner.js";
import { withArtifactTransaction } from "../../src/lib/project/artifact-transaction.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fsPromises.rm(dir, { recursive: true, force: true })),
  );
});

describe("SEO artifact writer ownership", () => {
  it("preserves a file created after SEO planning and refuses a partial commit", async () => {
    const { resolveFrontendConfig } =
      await import("../../src/frontend/tooling/config-resolver.js");
    const { createFrontendSeoArtifacts } =
      await import("../../src/frontend/tooling/seo-artifact-writer.js");
    const rootDir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), "vext-seo-race-"),
    );
    tempDirs.push(rootDir);
    const config = resolveFrontendConfig(
      {
        enabled: true,
        seo: {
          publicOrigin: "https://www.example.test",
          sitemap: {},
          robots: {},
        },
      },
      { rootDir, mode: "production" },
    );

    await expect(
      withProjectOwner(rootDir, "build", [config.outDir], () =>
        withArtifactTransaction(
          { rootDir, outDir: config.outDir, producer: "frontend" },
          async (transaction) => {
            const plan = await createFrontendSeoArtifacts({
              rootDir,
              config,
              staticArtifacts: [],
            });
            await fsPromises.mkdir(config.outDir, { recursive: true });
            await fsPromises.writeFile(
              path.join(config.outDir, "robots.txt"),
              "concurrent-owner",
            );
            await transaction.commit(plan.files);
          },
        ),
      ),
    ).rejects.toThrow(/conflict|unowned/i);
    await expect(
      fsPromises.readFile(path.join(config.outDir, "robots.txt"), "utf-8"),
    ).resolves.toBe("concurrent-owner");
    await expect(
      fsPromises.readFile(path.join(config.outDir, "sitemap.xml"), "utf-8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
