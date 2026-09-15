import { describe, expect, it } from "vitest";
import { createSourceView } from "../../../src/tooling/source-view/view.js";
import { projectStaticConfig } from "../../../src/tooling/project-index/config-projection.js";
import path from "node:path";

function config(
  files: Record<string, string>,
  mode: "development" | "production" = "development",
) {
  const view = createSourceView({
    roots: [
      {
        id: "project",
        realPath: path.resolve("/virtual-mcp-config"),
        kind: "service",
      },
    ],
    rolePolicyVersion: "config-test",
    files: Object.entries(files).map(([file, source]) => ({
      rootId: "project",
      path: `src/config/${file}`,
      role: "config",
      bytes: Buffer.from(source),
    })),
  });
  return projectStaticConfig(view, { profile: mode, mode });
}

describe("MCP config projection matches runtime layers", () => {
  it("retains middleware when a later layer explicitly sets undefined", () => {
    const projection = config({
      "default.ts": "export default { middlewares: ['auth'] };",
      "local.ts": "export default { middlewares: undefined };",
    });
    expect(projection.field("middlewares")).toMatchObject({
      state: "known",
      value: ["auth"],
    });
  });

  it("does not hide an earlier syntax failure behind a valid override", () => {
    const projection = config({
      "default.ts": "export default { broken: ; };",
      "local.ts": "export default { port: 4000, dev: { mcp: true } };",
    });
    expect(projection.field("port").state).toBe("invalid");
    expect(projection.field("dev.mcp").sourceRefs).toEqual([
      "src/config/default.ts",
    ]);
  });

  it("patches middleware by name while retaining order and replacing options", () => {
    const projection = config({
      "default.ts":
        "export default { middlewares: ['requestId', { name: 'auth', options: { role: 'admin', extra: true } }] };",
      "development.ts":
        "export default { middlewares: [{ name: 'auth', options: { role: 'member' } }, 'audit'] };",
      "local.ts":
        "export default { middlewares: [{ name: 'audit', enabled: false }] };",
    });
    expect(projection.field("middlewares")).toMatchObject({
      state: "known",
      value: [
        "requestId",
        { name: "auth", options: { role: "member" } },
        { name: "audit", enabled: false },
      ],
    });
    expect(projection.field("middlewares.1.options.role")).toMatchObject({
      state: "known",
      value: "member",
    });
  });

  it("does not replace an unknown middleware base with a known partial patch", () => {
    const projection = config({
      "default.ts": "export default { middlewares: process.env.MIDDLEWARES };",
      "local.ts": "export default { middlewares: ['audit'] };",
    });
    expect(projection.field("middlewares").state).toBe("unknown");
  });

  it("keeps dev.mcp statically readable when bootstrap declares no providers", () => {
    const projection = config({
      "default.ts":
        "export default { dev: { mcp: { enabled: true, hosts: ['codex'], sync: 'auto' } } };",
      "bootstrap.ts":
        "import { defineBootstrapConfig } from 'vextjs'; export default defineBootstrapConfig({ providers: [] });",
    });

    expect(projection.providerState).toBe("absent");
    expect(projection.field("dev.mcp")).toMatchObject({
      state: "known",
      value: { enabled: true, hosts: ["codex"], sync: "auto" },
    });
  });

  it("keeps config fields unknown when bootstrap providers may patch them", () => {
    const projection = config({
      "default.ts": "export default { dev: { mcp: true } };",
      "bootstrap.ts":
        "import { defineBootstrapConfig } from 'vextjs'; export default defineBootstrapConfig({ providers: [async () => ({ dev: { mcp: false } })] });",
    });

    expect(projection.providerState).toBe("unknown");
    expect(projection.field("dev.mcp")).toMatchObject({
      state: "unknown",
      reason: "Bootstrap provider may override this field.",
    });
  });

  it("reports duplicate names and respects extension priority and production local exclusion", () => {
    expect(
      config({
        "default.ts": "export default { middlewares: ['auth', 'auth'] };",
      }).field("middlewares").state,
    ).toBe("invalid");
    const files = {
      "default.ts": "export default { port: 3000 };",
      "default.js": "export default { port: 9999 };",
      "local.ts": "export default { port: 4000 };",
    };
    expect(config(files).field("port").value).toBe(4000);
    expect(config(files, "production").field("port").value).toBe(3000);
  });
});
