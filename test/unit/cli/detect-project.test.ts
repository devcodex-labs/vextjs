import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  hasDistBuild,
  inspectDistBuild,
} from "../../../src/cli/utils/detect-project.js";

const tempDirs: string[] = [];

function createProject(): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "vext-dist-check-"));
  tempDirs.push(rootDir);
  writeFile(rootDir, "package.json", '{"type":"module"}\n');
  return rootDir;
}

function writeFile(rootDir: string, relativePath: string, content = ""): void {
  const filePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("inspectDistBuild", () => {
  it("reports missing compiled entry, route, service and preload artifacts", () => {
    const rootDir = createProject();
    writeFile(rootDir, "src/config/default.ts", "export default {};\n");
    writeFile(rootDir, "src/index.ts", "export const ready = true;\n");
    writeFile(rootDir, "src/routes/user.ts", "export default {};\n");
    writeFile(rootDir, "src/services/auth.ts", "export default {};\n");
    writeFile(
      rootDir,
      "src/preload/01-env.ts",
      "process.env.APP_READY = '1';\n",
    );
    writeFile(rootDir, "dist/package.json", '{"type":"commonjs"}\n');
    writeFile(rootDir, "dist/config/default.js", "module.exports = {};\n");

    const result = inspectDistBuild(rootDir);

    expect(result.hasDistDir).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual([
      "dist/index.js",
      "dist/routes/user.js",
      "dist/services/auth.js",
      "dist/preload/01-env.mjs",
    ]);
    expect(hasDistBuild(rootDir)).toBe(false);
  });

  it("accepts a dist tree that mirrors the build runtime surface", () => {
    const rootDir = createProject();
    writeFile(rootDir, "src/config/default.ts", "export default {};\n");
    writeFile(rootDir, "src/index.ts", "export const ready = true;\n");
    writeFile(rootDir, "src/routes/user.ts", "export default {};\n");
    writeFile(rootDir, "src/services/auth.ts", "export default {};\n");
    writeFile(
      rootDir,
      "src/preload/01-env.ts",
      "process.env.APP_READY = '1';\n",
    );

    writeFile(rootDir, "dist/package.json", '{"type":"commonjs"}\n');
    writeFile(rootDir, "dist/config/default.js", "module.exports = {};\n");
    writeFile(rootDir, "dist/index.js", "exports.ready = true;\n");
    writeFile(rootDir, "dist/routes/user.js", "module.exports = {};\n");
    writeFile(rootDir, "dist/services/auth.js", "module.exports = {};\n");
    writeFile(
      rootDir,
      "dist/preload/01-env.mjs",
      "process.env.APP_READY='1';\n",
    );

    expect(inspectDistBuild(rootDir)).toEqual({
      valid: true,
      hasDistDir: true,
      missing: [],
    });
    expect(hasDistBuild(rootDir)).toBe(true);
  });

  it("does not require build-excluded sources or unsupported preload files", () => {
    const rootDir = createProject();
    writeFile(rootDir, "src/config/default.ts", "export default {};\n");
    writeFile(rootDir, "src/config/local.ts", "export default {};\n");
    writeFile(rootDir, "src/routes/user.test.ts", "export default {};\n");
    writeFile(rootDir, "src/client/page.ts", "export default {};\n");
    writeFile(rootDir, "src/preload/README.md", "# preload\n");
    writeFile(rootDir, "dist/package.json", '{"type":"commonjs"}\n');
    writeFile(rootDir, "dist/config/default.js", "module.exports = {};\n");

    expect(inspectDistBuild(rootDir)).toEqual({
      valid: true,
      hasDistDir: true,
      missing: [],
    });
  });
});
