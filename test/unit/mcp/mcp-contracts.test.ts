import { describe, expect, it } from "vitest";
import {
  normalizeDevMcpConfig,
  normalizePolicyPatch,
  normalizeWorkspaceConfig,
  parseMcpToolInput,
} from "../../../src/assistant/contracts.js";

describe("Vext MCP assistant contracts", () => {
  it("rejects invalid enable flags instead of changing their meaning", () => {
    expect(normalizeDevMcpConfig({ enabled: "false" }).ok).toBe(false);
    expect(normalizeDevMcpConfig({ http: { enabled: 1 } }).ok).toBe(false);
  });

  it("canonicalizes the existing service alias and rejects ambiguous roles", () => {
    const result = normalizePolicyPatch({
      roles: { service: "src/domain/services" },
    });
    expect(result.ok && result.value.patch.roles).toEqual({
      services: "src/domain/services",
    });
    expect(
      normalizePolicyPatch({ roles: { imaginary: "src/custom" } }).ok,
    ).toBe(false);
    expect(
      normalizePolicyPatch({ roles: { service: "src/a", services: "src/b" } })
        .ok,
    ).toBe(false);
  });

  it("normalizes dev.mcp defaults without enabling undeclared projects", () => {
    const absent = normalizeDevMcpConfig(undefined, { declared: false });
    expect(absent.ok).toBe(true);
    if (absent.ok) {
      expect(absent.value).toMatchObject({
        declared: false,
        enabled: false,
        sync: "off",
        hosts: [],
        http: { enabled: false, port: 3980 },
      });
    }

    const enabled = normalizeDevMcpConfig(true);
    expect(enabled.ok).toBe(true);
    if (enabled.ok) {
      expect(enabled.value).toMatchObject({
        declared: true,
        enabled: true,
        sync: "auto",
      });
    }
  });

  it("deduplicates known MCP hosts and rejects unknown host/port values", () => {
    const result = normalizeDevMcpConfig({
      hosts: ["codex", "codex", "grok"],
      http: { enabled: true, port: 4099 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hosts).toEqual(["codex", "grok"]);
      expect(result.warnings).toEqual([
        "Duplicate MCP host codex was ignored.",
      ]);
    }

    expect(normalizeDevMcpConfig({ hosts: ["unknown"] }).ok).toBe(false);
    expect(normalizeDevMcpConfig({ http: { port: 0 } }).ok).toBe(false);
  });

  it("normalizes policy patches and rejects unsafe source references", () => {
    const result = normalizePolicyPatch({
      outputLanguage: "zh",
      commentLanguage: "auto",
      commentDetail: "necessary",
      roles: { service: "src/services" },
      architecture: { style: "feature", featureRoot: "src/modules" },
      naming: { file: "kebab-case", component: "PascalCase" },
      rules: [{ id: "require-tests", level: "warning" }],
      sourceRefs: ["docs/guide.md"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.digest).toMatch(/^[a-f0-9]{64}$/);
      expect(result.value.patch.architecture?.featureRoot).toBe("src/modules");
    }

    expect(normalizePolicyPatch({ sourceRefs: ["../outside.md"] }).ok).toBe(
      false,
    );
    expect(
      normalizePolicyPatch({
        rules: [
          { id: "same", level: "warning" },
          { id: "same", level: "error" },
        ],
      }).ok,
    ).toBe(false);
  });

  it("validates monorepo workspace services and shared packages", () => {
    const result = normalizeWorkspaceConfig({
      schemaVersion: 1,
      hosts: ["codex"],
      services: [{ id: "api", root: "apps/api", sharedPackages: ["models"] }],
      sharedPackages: [
        {
          id: "models",
          root: "packages/models",
          kind: "models",
          sourceExports: { user: "src/user.ts" },
        },
      ],
      policyDefaults: { outputLanguage: "zh" },
    });
    expect(result.ok).toBe(true);

    expect(
      normalizeWorkspaceConfig({
        schemaVersion: 1,
        services: [
          { id: "api", root: "apps/api" },
          { id: "api", root: "apps/admin" },
        ],
      }).ok,
    ).toBe(false);
    expect(
      normalizeWorkspaceConfig({
        schemaVersion: 1,
        services: [{ id: "api", root: "C:/outside" }],
      }).ok,
    ).toBe(false);
  });

  it("parses tool inputs before handlers consume them", () => {
    expect(
      parseMcpToolInput("vext_knowledge_search", { query: "job" }).ok,
    ).toBe(true);
    expect(
      parseMcpToolInput("vext_knowledge_search", { query: "job", ids: ["C34"] })
        .ok,
    ).toBe(false);
    expect(
      parseMcpToolInput("vext_generate_changes", {
        recipeId: "RCP-01",
        name: "../bad",
      }).ok,
    ).toBe(false);
    expect(
      parseMcpToolInput("vext_project_inspect", {
        section: "summary",
        refresh: "yes",
      }).ok,
    ).toBe(false);
  });
});
