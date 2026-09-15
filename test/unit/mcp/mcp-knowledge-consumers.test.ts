import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { checkMcpConsumerTypes } from "../../helpers/mcp-consumer-types.js";
import { DEPENDENCY_KNOWLEDGE } from "../../../src/assistant/knowledge/index.js";
import { inspectKnowledgeDependencies } from "../../../src/assistant/knowledge/context.js";
import { parseMcpToolInput } from "../../../src/assistant/contracts.js";
import {
  searchMcpCatalog,
  buildMcpCatalog,
} from "../../../src/assistant/catalog.js";

const repository = path.resolve(
  fileURLToPath(new URL("../../..", import.meta.url)),
);
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) === tmpdir() &&
      path.basename(root).startsWith("vext-knowledge-")
    )
      rmSync(root, { recursive: true, force: true });
  }
});

function exampleFiles() {
  const files = new Map<string, string>();
  for (const entry of DEPENDENCY_KNOWLEDGE) {
    for (const example of entry.dependency.examples) {
      const base = path.join(repository, "test/virtual-knowledge", example.id);
      for (const [file, code] of Object.entries({
        ...example.supportFiles,
        [example.filePath]: example.code,
      }))
        files.set(path.join(base, file).replaceAll("\\", "/"), code);
    }
  }
  return files;
}

describe("versioned dependency knowledge consumers", () => {
  it("applies domain/kind filters to ID lookups and reports localization limits", () => {
    expect(
      buildMcpCatalog().items.every((item) => item.domains.length > 0),
    ).toBe(true);
    expect(
      searchMcpCatalog({
        ids: ["K05", "K03"],
        domain: "database",
        kinds: ["knowledge"],
      }).matches.map((item) => item.id),
    ).toEqual(["K05"]);
    expect(searchMcpCatalog({ ids: ["K05"], kinds: ["rule"] }).matches).toEqual(
      [],
    );
    expect(
      searchMcpCatalog({ ids: ["K05"], locale: "en" }).localization,
    ).toMatchObject({
      requested: "en",
      status: "partial",
      notice: expect.stringContaining("Full per-entry translation"),
    });
    expect(
      parseMcpToolInput("vext_knowledge_search", {
        query: "model",
        domain: "databaze",
      }).ok,
    ).toBe(false);
  });

  it("typechecks the published examples and their real imports without declaring replacement database APIs", () => {
    const files = exampleFiles();
    expect(files.size).toBeGreaterThanOrEqual(4);
    const errors = checkMcpConsumerTypes(files).map(
      (d) =>
        `${d.file?.fileName}: TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`,
    );
    expect(errors).toEqual([]);
  });

  it("rejects the former two-argument pagination and incorrect return property through native types", () => {
    const files = exampleFiles();
    const service = [...files.keys()].find((file) =>
      file.endsWith("/services/posts.ts"),
    )!;
    files.set(
      service,
      files.get(service)!.replace("result.items", "result.data") +
        '\nexport function wrong(app: VextApp) { return app.db!.model("posts").findPage({}, { limit: 20 }); }\n',
    );
    const errors = checkMcpConsumerTypes(files).filter(
      (d) => d.file?.fileName.replaceAll("\\", "/") === service,
    );
    expect(
      errors.some(
        (d) =>
          d.code === 2339 &&
          ts.flattenDiagnosticMessageText(d.messageText, " ").includes("data"),
      ),
    ).toBe(true);
    expect(errors.some((d) => d.code === 2554)).toBe(true);
  });

  it("separates framework and service resolution and never labels a different installed version as reviewed", () => {
    const root = mkdtempSync(path.join(tmpdir(), "vext-knowledge-"));
    roots.push(root);
    const put = (file: string, value: unknown) => {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), JSON.stringify(value));
    };
    put("package.json", {
      name: "service",
      dependencies: { vextjs: "2.0.0", monsqlize: "^4.0.0" },
    });
    put("node_modules/vextjs/package.json", {
      name: "vextjs",
      version: "2.0.0",
      dependencies: { monsqlize: "^3.3.0" },
    });
    put("node_modules/vextjs/node_modules/monsqlize/package.json", {
      name: "monsqlize",
      version: "3.3.0",
      main: "must-not-execute.js",
    });
    put("node_modules/monsqlize/package.json", {
      name: "monsqlize",
      version: "4.0.0",
      main: "must-not-execute.js",
    });
    const context = inspectKnowledgeDependencies(root);
    expect(context.issue).toBeNull();
    const result = searchMcpCatalog({ ids: ["K05"] }, context.facts).matches[0]!
      .dependency!;
    expect(result.applicability.owners).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          owner: "framework",
          declaredRange: "^3.3.0",
          installedVersion: "3.3.0",
          state: "reviewed-version",
        }),
        expect.objectContaining({
          owner: "service",
          declaredRange: "^4.0.0",
          installedVersion: "4.0.0",
          state: "version-mismatch",
        }),
      ]),
    );
    expect(result.applicability.runtime).toBe("unverified");
  });

  it("does not infer installed versions from catalog ranges and keeps cancellation observable", () => {
    const dependency = searchMcpCatalog({ ids: ["K05"] }).matches[0]!
      .dependency!;
    expect(dependency.applicability).toMatchObject({
      status: "unverified",
      owners: [],
      runtime: "unverified",
    });
    const controller = new AbortController();
    controller.abort(new Error("cancel knowledge"));
    expect(() =>
      inspectKnowledgeDependencies(repository, controller.signal),
    ).toThrow("cancel knowledge");
  });

  it("reports malformed project metadata without fabricating a usable installation", () => {
    const root = mkdtempSync(path.join(tmpdir(), "vext-knowledge-"));
    roots.push(root);
    writeFileSync(path.join(root, "package.json"), "{");
    expect(inspectKnowledgeDependencies(root)).toMatchObject({
      facts: [],
      digest: null,
      issue: expect.any(String),
    });
  });

  it("keeps Job scheduling, payload, Redis and terminal ownership guidance together", () => {
    const text = searchMcpCatalog({
      ids: ["K07", "K08"],
      kinds: ["knowledge"],
      domain: "jobs",
    })
      .matches.map((item) => `${item.summary}\n${item.body}`)
      .join("\n");
    expect(text).toContain("scheduled run 时不提供业务 payload");
    expect(text).toContain("jobs.worker.concurrency");
    expect(text).toContain("迟到或重复 completion 返回 false");
    expect(text).toContain("Lua 原子脚本");
  });
});
