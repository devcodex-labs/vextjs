import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runTypegen } from "../../src/tooling/typegen/index.js";
import { runDoctor } from "../../src/tooling/doctor/index.js";
import { acquireProjectOwner } from "../../src/lib/project/owner.js";
import { writeDevRouteManifest } from "../../src/lib/dev/route-manifest.js";

const roots: string[] = [];
const types = [
  ".vext/types/services.generated.d.ts",
  ".vext/types/app-extensions.generated.d.ts",
  "src/types/generated/index.d.ts",
  ".vext/manifest/services.json",
];
function write(root: string, file: string, content: string) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vext-generated-files-"));
  roots.push(root);
  write(root, "package.json", '{"type":"module"}');
  write(root, "src/config/default.ts", "export default {};");
  write(root, "src/services/alpha.ts", "export default class Alpha {}");
  write(
    root,
    "src/routes/index.ts",
    'import { defineRoutes } from "vextjs"; export default defineRoutes(app => { app.get("/first", { docs: { summary: "First" } }, handler); });',
  );
  return root;
}
function snapshot(root: string, files: string[]) {
  return Object.fromEntries(
    files.map((file) => {
      const target = path.join(root, file);
      return [
        file,
        fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null,
      ];
    }),
  );
}
function typegen(root: string, checkOnly = false) {
  return runTypegen({
    rootDir: root,
    generateServices: true,
    generateAppExtensions: true,
    writeManifest: true,
    checkOnly,
  });
}
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("generated artifact transactions", () => {
  it("keeps all previous declarations when a later output cannot be read or replaced", async () => {
    const root = project();
    expect((await typegen(root)).ok).toBe(true);
    const before = snapshot(root, types);
    write(root, "src/services/beta.ts", "export default class Beta {}");
    fs.unlinkSync(path.join(root, types[2]));
    fs.mkdirSync(path.join(root, types[2]));
    await expect(typegen(root)).rejects.toThrow();
    expect(snapshot(root, [types[0], types[1], types[3]])).toEqual(
      Object.fromEntries(
        [types[0], types[1], types[3]].map((file) => [file, before[file]]),
      ),
    );
    fs.rmdirSync(path.join(root, types[2]));
    write(root, types[2], before[types[2]]!);
    expect((await typegen(root)).ok).toBe(true);
    expect(fs.readFileSync(path.join(root, types[0]), "utf8")).toContain(
      "beta:",
    );
  });

  it("does not publish new type outputs when dependency diagnostics block generation", async () => {
    const root = project();
    await typegen(root);
    const before = snapshot(root, types);
    write(
      root,
      "src/services/alpha.ts",
      "export default class Alpha { constructor(private app: any) {} use() { return this.app.services.beta; } }",
    );
    write(
      root,
      "src/services/beta.ts",
      "export default class Beta { constructor(private app: any) {} use() { return this.app.services.alpha; } }",
    );
    const blocked = await typegen(root);
    expect(blocked.ok).toBe(false);
    expect(blocked.diagnostics.some((item) => item.level === "error")).toBe(
      true,
    );
    expect(snapshot(root, types)).toEqual(before);
  });

  it("keeps checks read-only under a live writer, and reports unreadable targets instead of calling them stale", async () => {
    const root = project();
    const owner = await acquireProjectOwner(root, "dev");
    try {
      const result = await typegen(root, true);
      expect(result.ok).toBe(false);
      expect(result.files.every((file) => file.status === "stale")).toBe(true);
      expect(fs.existsSync(path.join(root, ".vext"))).toBe(false);
      fs.mkdirSync(path.join(root, types[0]), { recursive: true });
      await expect(typegen(root, true)).rejects.toThrow();
      await owner.assertActive();
    } finally {
      await owner.release();
    }
  });

  it("preserves external type edits and avoids changing unaffected files or their manifest", async () => {
    const root = project();
    await typegen(root);
    const receipt = ".vext/freshness/v1/artifacts.json";
    expect(fs.existsSync(path.join(root, receipt))).toBe(true);
    const time = fs.statSync(path.join(root, receipt)).mtimeMs;
    expect(
      (await typegen(root)).files.every((file) => file.status === "unchanged"),
    ).toBe(true);
    expect(fs.statSync(path.join(root, receipt)).mtimeMs).toBe(time);
    write(root, types[0], "// external edit\n");
    const before = snapshot(root, [...types, receipt]);
    await expect(typegen(root)).rejects.toMatchObject({
      code: "VEXT_OUTPUT_CONFLICT",
    });
    expect(snapshot(root, [...types, receipt])).toEqual(before);
  });

  it("commits Doctor outputs together and preserves inspect output when route manifest ownership conflicts", async () => {
    const root = project();
    const options = {
      rootDir: root,
      writeInspect: true,
      writeManifest: true,
      refresh: true,
    };
    await runDoctor(options);
    const inspect = ".vext/inspect/routes.json";
    const manifest = ".vext/manifest/routes.json";
    write(root, manifest, '{"external":true}');
    const before = snapshot(root, [inspect, manifest]);
    write(
      root,
      "src/routes/index.ts",
      'import { defineRoutes } from "vextjs"; export default defineRoutes(app => { app.get("/second", { docs: { summary: "Second" } }, handler); });',
    );
    await expect(runDoctor(options)).rejects.toMatchObject({
      code: "VEXT_OUTPUT_CONFLICT",
    });
    expect(snapshot(root, [inspect, manifest])).toEqual(before);
  });

  it("shares route manifest ownership between Doctor and the runtime collector", async () => {
    const root = project();
    const options = { rootDir: root, writeManifest: true, refresh: true };
    await runDoctor(options);
    const manifest = path.join(root, ".vext", "manifest", "routes.json");
    await writeDevRouteManifest(
      root,
      [
        {
          method: "GET",
          path: "/runtime",
          options: {},
          sourceFile: path.join(root, "src", "routes", "index.ts"),
        },
      ],
      {
        srcDir: path.join(root, "src"),
        outDir: path.join(root, ".vext", "dev"),
      },
    );
    expect(JSON.parse(fs.readFileSync(manifest, "utf8")).routes[0].path).toBe(
      "/runtime",
    );
    await runDoctor(options);
    expect(JSON.parse(fs.readFileSync(manifest, "utf8")).routes[0].path).toBe(
      "/first",
    );
    const receipt = JSON.parse(
      fs.readFileSync(
        path.join(root, ".vext", "freshness", "v1", "artifacts.json"),
        "utf8",
      ),
    );
    expect(
      receipt.scopes.filter(
        (scope: { producer: string }) => scope.producer === "route-manifest",
      ),
    ).toHaveLength(1);
  });

  it("allows read-only Doctor analysis but rejects its write mode while another owner is active", async () => {
    const root = project();
    const owner = await acquireProjectOwner(root, "dev");
    try {
      expect((await runDoctor({ rootDir: root })).ok).toBe(true);
      expect(fs.existsSync(path.join(root, ".vext"))).toBe(false);
      await expect(
        runDoctor({ rootDir: root, writeInspect: true }),
      ).rejects.toMatchObject({ code: "VEXT_OWNER_BUSY" });
      expect(fs.existsSync(path.join(root, ".vext"))).toBe(false);
    } finally {
      await owner.release();
    }
  });
});
