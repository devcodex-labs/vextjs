import { afterEach, describe, expect, it, vi } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { typegenCommand } from "../../../src/cli/typegen.js";

const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

const FIXTURES_DIR = join(process.cwd(), "test", "fixtures", "typegen");
const GOLDEN_DIR = join(process.cwd(), "test", "golden", "typegen");

async function copyFixtureToTemp(fixtureName: string): Promise<string> {
  const tempRoot = await mkdtemp(join(tmpdir(), `vext-typegen-${fixtureName}-`));
  const projectRoot = join(tempRoot, "project");
  await cp(join(FIXTURES_DIR, fixtureName), projectRoot, { recursive: true });
  return projectRoot;
}

async function readNormalized(filePath: string): Promise<string> {
  return (await readFile(filePath, "utf-8")).replace(/\r\n/g, "\n").trimEnd();
}

describe("typegenCommand", () => {
  let projectRoot: string;

  afterEach(async () => {
    consoleLog.mockClear();
    consoleWarn.mockClear();
    consoleError.mockClear();

    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("matches golden outputs for the TypeScript fixture and ignores app.extend outside plugin lifecycles", async () => {
    projectRoot = await copyFixtureToTemp("ts-basic");

    await typegenCommand(["--root", projectRoot]);

    const servicesGenerated = await readNormalized(
      join(projectRoot, "src/types/generated/services.generated.d.ts"),
    );
    const appExtensionsGenerated = await readNormalized(
      join(projectRoot, "src/types/generated/app-extensions.generated.d.ts"),
    );
    const expectedServices = await readNormalized(
      join(GOLDEN_DIR, "ts-basic", "services.generated.d.ts"),
    );
    const expectedAppExtensions = await readNormalized(
      join(GOLDEN_DIR, "ts-basic", "app-extensions.generated.d.ts"),
    );

    expect(servicesGenerated).toBe(expectedServices);
    expect(appExtensionsGenerated).toBe(expectedAppExtensions);
    expect(appExtensionsGenerated).not.toContain("ignoredOutsideLifecycle");
  });

  it("matches golden outputs for the JavaScript fixture with graceful fallback", async () => {
    projectRoot = await copyFixtureToTemp("js-basic");

    await typegenCommand(["--root", projectRoot]);

    const servicesGenerated = await readNormalized(
      join(projectRoot, "src/types/generated/services.generated.d.ts"),
    );
    const appExtensionsGenerated = await readNormalized(
      join(projectRoot, "src/types/generated/app-extensions.generated.d.ts"),
    );
    const expectedServices = await readNormalized(
      join(GOLDEN_DIR, "js-basic", "services.generated.d.ts"),
    );
    const expectedAppExtensions = await readNormalized(
      join(GOLDEN_DIR, "js-basic", "app-extensions.generated.d.ts"),
    );

    expect(servicesGenerated).toBe(expectedServices);
    expect(appExtensionsGenerated).toBe(expectedAppExtensions);
  });

  it("falls back to unknown when multiple plugins extend the same key with conflicting types", async () => {
    projectRoot = await copyFixtureToTemp("conflict-case");

    await typegenCommand(["--root", projectRoot, "--app-extensions"]);

    const appExtensionsGenerated = await readNormalized(
      join(projectRoot, "src/types/generated/app-extensions.generated.d.ts"),
    );
    const expectedAppExtensions = await readNormalized(
      join(GOLDEN_DIR, "conflict-case", "app-extensions.generated.d.ts"),
    );

    expect(appExtensionsGenerated).toBe(expectedAppExtensions);
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining('Conflicting inferred types for app.extend("shared")'),
    );
  });

  it("fails in --check mode when generated files are stale", async () => {
    projectRoot = await copyFixtureToTemp("ts-basic");
    const generatedFilePath = join(
      projectRoot,
      "src/types/generated/services.generated.d.ts",
    );
    await mkdir(dirname(generatedFilePath), { recursive: true });
    await writeFile(
      generatedFilePath,
      "// stale file\n",
      "utf-8",
    );

    await expect(
      typegenCommand(["--root", projectRoot, "--services", "--check"]),
    ).rejects.toThrow(/typegen found blocking issues/);
  });
});

